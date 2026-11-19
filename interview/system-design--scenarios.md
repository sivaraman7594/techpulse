### How would you design a URL shortener that handles 10k redirects per second?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/best-practices/caching -->
Observe (requirements): read-heavy (about 100:1), redirect latency under 50 ms, high availability, optional expiry, analytics. Estimate 40 writes/s and 10k reads/s peak; a few TB over five years.

Hypothesise: a key-value lookup from short code to long URL, fronted by caches, with analytics off the hot path.

Design: generate codes from a unique ID in base62 (7 characters is about 3.5 trillion combinations); allocate ID ranges per app server to avoid coordination, or use a Snowflake-style generator. Store `code -> url, expiry, owner` in a partitioned key-value store (DynamoDB, Cassandra, or sharded SQL by code hash). Put Redis and a CDN in front; the hot set is small, so hit rates above 95% are realistic. Use `302` if you need every click counted, `301` if browsers may cache. Emit click events to Kafka and aggregate asynchronously.

Verify: load test redirects with a Zipf distribution, check p99, cold-cache behaviour and ID collisions.

Prevent: abuse and phishing (URL scanning, rate limiting creates, blocklists); unguessable codes if links are private.

Common wrong answers: hashing the URL and truncating without collision handling; incrementing a counter in a single SQL row on every redirect; synchronous analytics writes in the redirect path.

### How would you design a chat application supporting 10 million concurrent users?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/publisher-subscriber -->
Observe: persistent connections, per-conversation ordering, offline delivery, groups, presence.

Hypothesise: a stateful connection tier plus stateless chat services and a partitioned message log.

Design: clients keep a WebSocket to a gateway; at 100k connections per node you need about 100 gateways, behind an L4 balancer. A registry (Redis) maps user to gateway. Sending: the chat service validates, assigns a per-conversation sequence number, persists the message (store keyed by conversation and sequence), then publishes to the recipients' gateways through pub/sub; offline users get a push notification and fetch from their last-seen sequence on reconnect. Delivery is at-least-once with client acks and dedupe by message ID. Presence uses heartbeats with TTL, throttled and fanned out lazily for large contacts lists. Group fan-out for huge groups uses read-time pulls.

Verify: soak test with reconnect storms (everyone reconnects after a gateway deploy), measure fan-out latency and memory per connection.

Prevent: drain connections gradually during deploys; rate-limit senders; cap group sizes.

Wrong answers: polling every second; ordering by client timestamps; one global database row per conversation without partitioning.

### How would you design a news feed for a social network?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view -->
Observe: users follow others; the feed must load in under 200 ms; some accounts have tens of millions of followers.

Hypothesise: precompute feeds for typical users (fan-out on write) but not for celebrities.

Design: store posts in a post store (partitioned by post ID, content cached). On publish, enqueue a fan-out job that inserts the post ID into each active follower's feed, a capped sorted set in Redis (for example the latest 800 entries). For accounts above a follower threshold, skip fan-out; at read time merge the user's precomputed feed with recent posts of followed celebrities. Hydrate IDs from cache, apply ranking in a separate service with a latency budget, and paginate with cursors. Skip fan-out for inactive users and rebuild their feed lazily when they return.

Verify: simulate a celebrity post and measure queue lag and write amplification; check freshness SLO (post visible within 5 seconds).

Prevent: bound feed size, protect the ranking service with timeouts and a chronological fallback.

Wrong answers: pure fan-out on write for everyone (celebrity meltdown), or pure fan-out on read with joins across follows at request time.

### How would you design a payment flow so customers are never charged twice?
<!-- level: advanced; kind: scenario; ref: https://docs.stripe.com/api/idempotent_requests -->
Observe: timeouts between your service and the PSP are ambiguous: the charge may or may not have happened.

Hypothesise: duplicates arise from client retries, queue redeliveries and webhook repeats.

Design: tokenise cards at the PSP so you never touch raw data. The client sends an `Idempotency-Key` per checkout attempt; the server stores it with a request hash and state under a unique constraint and returns the stored result for repeats. The payment is a state machine with transitions recorded in an append-only ledger. When calling the PSP, pass the same idempotency key; on timeout, query by that key rather than blindly retrying. Process PSP webhooks idempotently (event ID dedupe) and verify signatures. Publish domain events through a transactional outbox. A nightly reconciliation compares ledger and PSP settlement data.

Verify: chaos test by killing the service between PSP call and DB commit; replay webhooks twice; run duplicate requests concurrently.

Prevent: integer minor units for money; strict state transitions; alerting on reconciliation mismatches.

Wrong answers: check-then-charge without a unique constraint; disabling the submit button as the only protection; assuming exactly-once delivery from the queue.

### How would you design a distributed rate limiter used by dozens of API servers?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/rate-limiting-pattern -->
Observe: per-instance in-memory counters allow N times the intended limit when requests spread across N servers.

Hypothesise: you need a shared, atomic counter or a coordinated approximation.

Design: token bucket per (tenant, route) in Redis, updated by a single Lua script (refill by elapsed time using Redis `TIME`, check, decrement) so concurrent requests cannot race. Enforce in a gateway or middleware, return `429` with `Retry-After` and remaining-quota headers. For lower latency and resilience, give each instance a local token allotment refreshed from Redis in batches, accepting small overshoot. Decide failure policy: fail open for ordinary endpoints, fail closed on login and expensive endpoints, with a coarse local limiter as fallback. Shard Redis by key; split very hot tenants.

Verify: load test with many clients and compare the allowed rate with the configured limit; kill Redis and watch behaviour.

Prevent: separate limits per plan, burst allowance, per-IP limits for unauthenticated paths, monitoring of rejection rates.

Wrong answers: read counter then write it back in two commands; relying on sticky sessions to keep one instance per client; using wall-clock time from each app server.

### Your database CPU hits 95% every day at noon. How would you investigate and fix it?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/monitoring-stats.html -->
Observe: correlate CPU with traffic, deploys, cron jobs and specific queries; check slow query log, `pg_stat_statements` (or performance schema), and connection counts.

Hypothesise: a few expensive queries (missing index, N+1, large scans), a scheduled report, or a cache miss storm at peak.

Verify: rank queries by total time; run `EXPLAIN ANALYZE` on the top ones; check whether noon coincides with a batch job or with a promotion.

```sql
SELECT query, calls, total_exec_time, mean_exec_time
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```

Fix: add or correct indexes, rewrite N+1 patterns, add caching for hot reads, move reports to a read replica or warehouse, reschedule batch jobs, add pooling to cut connection overhead. If the workload is truly read-bound, add replicas; only then consider sharding.

Prevent: dashboards for top queries, query review in CI, load tests before launches, alerts on saturation rather than only CPU.

Wrong answers: immediately upgrading the instance size, or sharding before looking at a single query plan.

### After adding a cache, a hot key expiring at the top of the hour takes the database down. What happened and how do you prevent it?
<!-- level: advanced; kind: scenario; ref: https://aws.amazon.com/builders-library/caching-challenges-and-strategies/ -->
Observe: database load spikes exactly when popular entries expire, with many identical queries in flight.

Hypothesise: cache stampede: all requests miss simultaneously and recompute; TTLs aligned because entries were warmed together.

Verify: log misses per key; confirm identical queries in the database's active sessions; correlate with TTL boundaries.

Fix: add request coalescing (single-flight) so only one request rebuilds per key per instance, plus a short distributed lock for cross-instance coordination; serve stale-while-revalidate during rebuilds; add jitter to TTLs; refresh hot keys proactively before they expire; and warm the cache after deploys.

```python
ttl = base_ttl + random.randint(0, base_ttl // 10)
```

Also protect the database with a concurrency limit and load shedding so a cache failure degrades gracefully.

Prevent: test cold-cache and total-cache-loss scenarios, track hit ratio and rebuild concurrency.

Wrong answers: infinite TTLs (stale data forever), or a larger cache, which doesn't address synchronised expiry.

### Users see their own recently saved data disappear for a moment after saving. What is wrong?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/best-practices/data-partitioning-strategies -->
Observe: write succeeds, next page load shows old data, a refresh fixes it.

Hypothesise: reads go to an asynchronous replica that lags behind the leader, violating read-your-writes; or a cache serves the stale value.

Verify: check replica lag metrics; log which node served each read; reproduce by writing then reading immediately; inspect cache keys for the updated entity.

Fix: after a write, route that user's reads to the leader for a short window (for example 5 seconds) or until the replica passes their write's log position; invalidate or update the cache on write (delete key after commit); for single-page apps update local state optimistically from the write response.

```text
write -> leader; response includes version/LSN
subsequent read -> replica with applied_lsn >= version, else leader
```

Prevent: classify reads (must-be-fresh versus tolerate-stale), alert on replica lag, and avoid reading just-written data through replicas.

Wrong answers: switching to synchronous replication for everything (latency and availability cost), or telling users to refresh.

### How would you design a notification system for email, SMS and push at 50 million messages per day?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/competing-consumers -->
Observe: bursty traffic (campaigns), multiple providers with different rate limits, user preferences, deduplication, retries.

Hypothesise: an asynchronous pipeline with per-channel queues and idempotent workers.

Design: services call a notification API with event type, user and template data. The API validates, checks preferences and quiet hours, stores a notification record with an idempotency key, and enqueues to per-channel topics (email, SMS, push), prioritised (OTP above marketing). Channel workers render templates, call providers with timeouts, rate limiters and retries with backoff, fall back to a secondary provider on failure, and update status via provider callbacks. Dead-letter queues capture permanent failures. Track delivery status for analytics and for suppression lists (bounces, unsubscribes).

Verify: load test a campaign burst; fail a provider and watch failover; confirm no duplicates under redelivery.

Prevent: separate queues and capacity for critical traffic; per-user rate caps; compliance (opt-outs).

Wrong answers: sending synchronously inside the request that triggered it; one shared queue where marketing blocks password resets.

### A downstream service is slow and your whole API is timing out. How do you stop the cascade?
<!-- level: advanced; kind: scenario; ref: https://sre.google/sre-book/addressing-cascading-failures/ -->
Observe: latency rises everywhere; thread pools and connection pools are saturated; upstream retries multiply traffic.

Hypothesise: calls to the slow dependency are blocking resources shared by all requests, and retries amplify load.

Verify: traces show most time in one client call; thread dumps show threads waiting on it; request rate to the dependency exceeds baseline.

Fix, immediate: shed or disable the non-critical feature that depends on it (feature flag), lower timeouts, reduce retries, open a circuit breaker. Structural: add timeouts and deadlines everywhere, circuit breakers, bulkheads (separate pools per dependency), bounded queues, retry budgets, and load shedding with priorities; cache or provide fallbacks for non-critical data.

```text
timeout 300 ms, 1 retry with jitter, breaker opens at 50% errors / 20 requests,
fallback: cached recommendations
```

Prevent: failure-injection tests, dependency SLOs, capacity headroom and dependency dashboards.

Wrong answers: increasing timeouts and retries "to be safe", or scaling out callers, which raises pressure on the sick dependency.

### How would you migrate a large production table to a new schema with no downtime?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig -->
Observe: 2 billion rows, a column needs splitting and a type change; locks from `ALTER TABLE` are unacceptable.

Hypothesise: use expand-and-contract with dual write and backfill.

Steps: 1) expand: add the new column or table (nullable, no heavy default) without rewriting the table. 2) deploy code that writes both old and new shapes and reads old. 3) backfill in small batches with throttling and resumable checkpoints. 4) verify counts and checksums; compare reads (shadow reads). 5) switch reads to new with a flag; monitor. 6) stop writing old, wait a release cycle, then contract (drop old column).

```sql
UPDATE t SET new_col = f(old_col)
WHERE id BETWEEN :a AND :b AND new_col IS NULL;   -- batch, sleep, repeat
```

Use online schema change tools (gh-ost, pt-online-schema-change, native concurrent index builds) where needed.

Prevent: migrations are backward compatible with the previous app version; each step is individually reversible.

Wrong answers: one big migration at 2 a.m. with a maintenance window; mixing schema change and incompatible code deploy in one release.

### How would you handle a viral post that overloads a single database partition?
<!-- level: advanced; kind: scenario; ref: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html -->
Observe: one shard's CPU and throttling spike while others idle; reads and counter updates target a single key.

Hypothesise: hot key; the partition key concentrates traffic.

Verify: metrics by partition or key (contributor insights), top keys in logs, throttled request counts.

Fix: reads: cache the post and its rendered form at CDN and Redis with short TTL, plus request coalescing. Counters: write sharding (N counter rows, random suffix, summed on read) or buffer increments in memory/Kafka and apply in batches; use approximate counts for display. For storage: split or isolate the hot partition if the datastore supports adaptive splitting; replicate read traffic across replicas.

```text
likes:post9#0 .. likes:post9#15  (random write), read = sum, cached for 5 s
```

Prevent: avoid timestamp-like or low-cardinality partition keys, load test skewed distributions, and put per-key rate limits on counters.

Wrong answers: adding more shards (the hot key still maps to one), or vertical scaling alone.

### How would you add search to an e-commerce site whose catalog lives in PostgreSQL?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/textsearch.html -->
Observe: `LIKE '%term%'` queries scan the table; users expect typo tolerance, relevance, facets and filters.

Hypothesise: a dedicated search index is justified beyond simple needs; PostgreSQL full-text could suffice for modest catalogs.

Design: for small catalogs use `tsvector` with a GIN index and `ts_rank`. At scale, use OpenSearch or Elasticsearch: an indexer consumes change events (CDC from Postgres via Debezium and Kafka, or an outbox) and updates the index asynchronously; the search service queries the index, then hydrates details from cache or database. Handle reindexing by building a new index version and switching an alias. Accept eventual consistency: price and stock shown on results must be re-validated at add-to-cart and checkout.

Verify: relevance tests with judged queries, lag monitoring between database and index, load tests.

Prevent: never make the search index the source of truth; keep a rebuild path; monitor indexing failures.

Wrong answers: dual-writing from the application without reconciliation; relying on the index for transactional stock decisions.

### How would you build an API gateway layer for a growing microservice platform?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/microservices/design/gateway -->
Observe: clients call dozens of services directly, each reimplementing auth, rate limits and logging.

Hypothesise: a gateway centralises cross-cutting concerns and offers a stable external contract.

Design: a gateway (managed or Envoy, Kong, NGINX based) handles TLS termination, authentication (JWT validation), coarse authorisation, rate limiting, request validation, routing, canary traffic splitting, observability headers (trace IDs), and response caching. For clients needing aggregated data, add a backend-for-frontend (BFF) per client type rather than stuffing business logic in the gateway. Keep the gateway stateless and horizontally scaled across zones; configure timeouts, retries only for idempotent routes, and circuit breaking per upstream.

Verify: load test the gateway, test failure of a single upstream and gateway rollout with config rollback.

Prevent: the gateway becoming a bottleneck or monolith: version configs in Git, no business logic, per-team ownership of routes.

Wrong answers: putting orchestration and data joins in the gateway, or a single-instance gateway.

### How would you ensure a webhook delivery system doesn't lose events or overwhelm customers' endpoints?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/retry -->
Observe: customers have endpoints of varying reliability; some are slow or down for hours.

Hypothesise: need durable at-least-once delivery with isolation per customer.

Design: persist each event, then enqueue delivery tasks per subscriber. Workers POST with a short timeout and signed payload (HMAC with timestamp), treating 2xx as success. Retry with exponential backoff and jitter over a bounded period (for example 24 hours to several days), then mark failed and offer manual replay. Isolate customers: per-endpoint concurrency and rate limits plus circuit breakers so a dead endpoint does not occupy shared workers or fill queues for others. Include event ID and sequence so receivers can dedupe and reorder. Provide a delivery log UI and a replay API.

Verify: test with endpoints that hang, return 500, redirect, or respond slowly.

Prevent: SSRF protections (block internal IP ranges), payload size limits, secret rotation.

Wrong answers: fire-and-forget HTTP calls from the request thread; one shared retry queue where a bad endpoint starves others.

### How would you design a system to count unique visitors per page across billions of events?
<!-- level: advanced; kind: scenario; ref: https://redis.io/docs/latest/develop/data-types/probabilistic/hyperloglogs/ -->
Observe: exact distinct counts need memory proportional to unique IDs; events arrive at high volume.

Hypothesise: approximate counting with bounded error is acceptable for dashboards.

Design: use HyperLogLog sketches (about 12 KB per counter for roughly 0.8% error in Redis) per page per time bucket; sketches are mergeable, so hourly buckets can be unioned into daily or weekly counts. Ingest events through Kafka, aggregate in a stream processor (Flink, Kafka Streams) keyed by page and window, and write sketches or counts to a store. Where exactness is required (billing), use exact dedupe in a warehouse on a delayed batch basis. Handle late events with watermarks and allow reprocessing from the log.

```bash
redis-cli PFADD page:42:2026-01-05 user-1 user-2
redis-cli PFCOUNT page:42:2026-01-05
```

Verify: compare sketch estimates with exact counts on a sample.

Prevent: define accuracy requirements up front; track cardinality growth.

Wrong answers: storing every visitor ID in a Redis set per page; counting page loads as uniques.

### How would you design file upload and download for large files (several GB) at scale?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/valet-key -->
Observe: proxying large files through app servers ties up connections, memory and bandwidth.

Hypothesise: clients should talk directly to object storage using scoped, short-lived credentials.

Design: the API authenticates the user, creates a file record and returns pre-signed URLs (valet key). Large files use multipart upload with resumable parts and checksums; clients retry failed parts independently. After upload, an event (object created notification) triggers virus scanning, thumbnailing and metadata extraction through a queue, and the record moves from `uploading` to `available`. Downloads use pre-signed URLs or signed CDN URLs with expiry, with range requests support. Enforce size limits, content-type allowlists and lifecycle rules (tiering, expiry). Clean up abandoned multipart uploads.

Verify: test interrupted uploads, resumption, and expired URLs.

Prevent: scan before making files available; separate buckets for untrusted uploads; encryption at rest; per-user quotas.

Wrong answers: base64 in JSON; streaming through the web tier; public buckets with guessable keys.

### How would you design an idempotent, reliable job scheduler for millions of scheduled tasks?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/leader-election -->
Observe: tasks fire at specific times; missing or duplicating them has business impact (billing, reminders).

Hypothesise: partition tasks, poll by due time, and use leases with idempotent execution.

Design: store tasks in a partitioned table indexed by `(partition, run_at)`. Scheduler workers each own a set of partitions (via consistent hashing or leases from etcd or a database). They fetch due tasks in batches using `SELECT ... FOR UPDATE SKIP LOCKED` or conditional updates that set a lease (`locked_until`), then enqueue or execute them. Completion updates status; a lease that expires makes the task available again, so execution is at-least-once; handlers must be idempotent using the task ID. Recurrent tasks compute the next run time transactionally with completion. Monitor lag between due time and actual execution.

```sql
UPDATE tasks SET locked_until = now() + interval '60 seconds', owner = :w
WHERE id IN (SELECT id FROM tasks WHERE run_at <= now() AND locked_until < now()
             ORDER BY run_at LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING *;
```

Prevent: jittering mass schedules (everyone at midnight), clock skew with database time, poison-task limits.

Wrong answers: one cron server (single point of failure); cron on every node with no locking.

### How would you roll out a risky change to a service handling 20,000 requests per second?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/well-architected/ -->
Observe: a rewrite of pricing logic; errors would directly affect revenue.

Hypothesise: progressive delivery with automatic rollback limits blast radius.

Plan: ship behind a feature flag defaulting off. Run shadow traffic: send copies of requests to the new path, compare responses, discard its output. Then canary: 1% of traffic (by user hash for stability), watching SLO metrics (errors, latency, business metrics like conversion); automatically halt and roll back on regression; proceed 5%, 25%, 50%, 100% with bake time. Keep database changes backward compatible (expand-and-contract) so rollback of code is safe. Prepare runbooks and an on-call, and avoid deploying before weekends or peaks.

Verify: define success metrics and comparison thresholds up front; test rollback in staging.

Prevent: small frequent releases, kill switches, automated canary analysis, and cleanup of old flags.

Wrong answers: big-bang deploy at off-peak assuming staging is enough; rollbacks that require data restores because migrations were destructive.

### Your multi-region active-active database shows conflicting writes for the same record. How do you handle it?
<!-- level: advanced; kind: scenario; ref: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html -->
Observe: users in two regions edit the same entity; replicas diverge or last-write-wins silently drops updates.

Hypothesise: concurrent writes with no ownership rule and weak conflict resolution.

Options: first, avoid conflicts: assign a home region per entity or user (single-writer), routing writes there and replicating elsewhere. Second, make operations commutative: counters as CRDTs, sets as add-wins, event-sourced append-only logs merged by ID. Third, detect and merge: version vectors or hybrid logical clocks, exposing siblings for application-level merge. Fourth, use a strongly consistent store (consensus-based, such as Spanner-like systems) for data with invariants like balances or uniqueness, accepting cross-region write latency.

Verify: partition-test with fault injection; simulate concurrent edits; audit lost updates.

Prevent: classify data by consistency need; document conflict policy per entity; don't rely on wall-clock LWW for important data.

Wrong answers: assuming clocks are synchronised, or using multi-leader replication for data with uniqueness constraints (usernames, inventory).

### How would you design the backend for a ride-hailing app's driver location tracking?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven -->
Observe: 1 million active drivers sending location every 4 seconds is about 250k writes/s; riders need nearby drivers within a second or two.

Hypothesise: location is ephemeral, high-volume and queried geospatially, so it belongs in memory, not in the primary database.

Design: drivers send updates over a lightweight protocol (MQTT, gRPC streaming or HTTP batches) to ingestion services that publish to Kafka partitioned by driver ID or geo cell. A location service updates an in-memory geospatial index (Redis GEO, or a grid using geohash or S2/H3 cells) keyed by cell, with TTLs so offline drivers expire. Nearby search queries the rider's cell and neighbours, filters by availability, then ranks by ETA through a routing service. Persist sampled trails asynchronously to a time-series or object store for analytics and trip history. Shard by region.

Verify: load test with realistic movement; check staleness and cell-boundary behaviour.

Prevent: client-side throttling when stationary, adaptive intervals, battery impact, and regional isolation.

Wrong answers: writing every ping to a relational table; computing nearest drivers with a full scan.

### The on-call receives 200 alerts overnight. How would you fix the alerting?
<!-- level: intermediate; kind: scenario; ref: https://sre.google/sre-book/monitoring-distributed-systems/ -->
Observe: classify alerts from the last weeks: how many were actionable, duplicates, self-resolving, or about causes rather than user impact.

Hypothesise: threshold alerts on infrastructure metrics, per-instance noise, and missing SLO-based alerts cause fatigue.

Fix: define SLOs for key user journeys; page only on symptom-based, SLO burn-rate alerts (fast burn pages, slow burn tickets); aggregate alerts per service rather than per host; route non-urgent signals to tickets or dashboards; deduplicate and group related alerts; add runbooks and ownership labels to each alert; delete alerts nobody acts on. Add a heartbeat alert for the monitoring pipeline itself. Review alert quality weekly: precision (fraction actionable) and time to acknowledge.

Verify: track pages per shift and the share that required action; target fewer than a handful per shift.

Prevent: every new alert needs a runbook and an owner; post-incident reviews check whether detection worked.

Wrong answers: muting alerts permanently, raising thresholds blindly, or paging for CPU above 80% with no user impact.

### How would you secure a public REST API that is being scraped and abused?
<!-- level: intermediate; kind: scenario; ref: https://owasp.org/www-project-api-security/ -->
Observe: unusual request patterns, high rates from a few IP ranges or API keys, enumeration of IDs, credential stuffing on login.

Hypothesise: weak rate limits, predictable IDs, no bot management and missing object-level authorisation.

Verify: analyse access logs by key, IP, user agent, path and response codes; look for sequential ID walks and failed-login spikes.

Fix: require authentication for non-public data; per-key and per-IP token bucket limits with stricter limits on login and search; return `429` with `Retry-After`; enforce object-level authorisation on every endpoint; use unguessable identifiers in addition (not instead); add pagination caps and field-level data minimisation; deploy a WAF and bot detection at the CDN, with challenges for suspicious clients; monitor and block abusive keys; add quotas per plan.

Prevent: threat modelling against the OWASP API Top 10, anomaly alerts, key rotation, and response-size limits.

Wrong answers: blocking by IP only (shared NAT, rotating proxies), hiding endpoints as security, or captcha on every request.

### How would you make a monolith's checkout flow resilient when the inventory service is unavailable?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction -->
Observe: checkout calls inventory synchronously; when inventory is down, all orders fail.

Hypothesise: a hard synchronous dependency on a service that could degrade gracefully.

Options: for the browsing path use cached stock data with an "approximate" label. For checkout, decide the business policy: accept the order optimistically, record a reservation request, and confirm asynchronously (oversell risk managed by safety stock and compensation: cancel and refund if stock is insufficient). Alternatively fail fast with a clear message and a circuit breaker, but only for items where overselling is unacceptable. Implement through an outbox event `OrderPlaced`, with the inventory consumer idempotently reserving stock and publishing `StockReserved` or `StockRejected`, driving a saga that compensates.

Verify: kill the inventory service in staging and check order flow, queue buildup and recovery.

Prevent: define per-capability fallbacks, timeouts, and dependency SLOs.

Wrong answers: retrying inventory calls in a tight loop, or marking all products as in stock without any compensation plan.

### Your event consumer is hours behind. How do you diagnose and catch up?
<!-- level: intermediate; kind: scenario; ref: https://kafka.apache.org/documentation/#monitoring -->
Observe: consumer lag metric rising, oldest-message age increasing, maybe periodic rebalances.

Hypothesise: processing slower than ingest (slow downstream call, expensive handler), too few consumers or partitions, a poison message looping, or constant rebalances.

Verify: describe the group per partition to see whether lag is even or concentrated in one partition (hot key or stuck message); profile handler time; check rebalance logs; look at downstream latency and error rates.

```bash
kafka-consumer-groups.sh --bootstrap-server b:9092 --describe --group billing
```

Fix: skip or dead-letter the poison message after bounded retries; optimise the handler (batch writes, remove synchronous calls); scale consumers up to the partition count; increase partitions only with an ordering plan; tune `max.poll.interval.ms` and batch size to stop rebalance loops; temporarily prioritise catch-up by shedding non-critical work. If data is stale-tolerant, consider replaying from a later offset after agreement.

Prevent: alert on lag duration and age, load tests, DLQ with redrive tooling, idempotent handlers.

Wrong answers: adding consumers beyond the partition count (idle), or resetting offsets to latest and silently losing data.

### How would you design a feature flag and configuration system that thousands of services consume?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/external-configuration-store -->
Observe: flags must change within seconds, evaluation must be extremely fast, and a flag service outage must not take down applications.

Hypothesise: evaluate locally against a cached ruleset, with changes pushed or polled.

Design: an admin service stores flags and rules (versioned, audited, with approvals) in a durable database. A distribution layer publishes snapshots to a CDN or object store and streams updates (SSE or long-polling) to SDKs. SDKs keep the full ruleset in memory, evaluate with deterministic hashing (user ID plus flag key) for stable percentage rollouts, and fall back to the last known snapshot, then to hard-coded defaults, if the service is unreachable. Emit exposure events asynchronously for analytics. Support scoped targeting (environment, tenant, attributes) and kill switches.

Verify: test flag service outage, stale snapshot behaviour and propagation latency.

Prevent: flag debt (owners and expiry dates), validation of rule changes, gradual config rollouts, and permissions.

Wrong answers: calling a remote flag service on every request; storing flags only in a database table read per request without caching; no defaults when the service is down.

### How would you design a system that must stay correct while handling inventory for flash sales?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling -->
Observe: 100k users compete for 1,000 items in a minute; overselling is unacceptable, and the database row for the item is a contention point.

Hypothesise: single-row contention and a thundering herd; a queue or atomic counter can serialise the critical operation.

Design: pre-load stock into Redis and decrement atomically with a Lua script (`DECR` guarded to stay non-negative); successful decrements create a time-limited reservation and an order record placed through a queue, so the database sees only 1,000 writes rather than 100k. Rejections return quickly ("sold out"). Waiting-room or token-bucket admission at the edge limits concurrent shoppers. Reservations expire if unpaid and stock returns. Reconcile Redis with the database periodically; the database remains the source of truth, with a conditional update (`UPDATE ... SET stock = stock - 1 WHERE stock > 0`) as the final guard.

Verify: load test with realistic burst; failure-test Redis loss and recover counts from the database.

Prevent: static content on CDN, per-user purchase limits, bot defences.

Wrong answers: read-stock-then-write without atomicity; locking a single database row for the whole checkout; serving the whole spike through the application database.
