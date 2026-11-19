## 1. APIs and traffic control

### REST API design essentials
<!-- level: basic; ref: https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design -->
Model resources as nouns (`/orders/123`), use HTTP methods for semantics (GET read, POST create or action, PUT replace, PATCH partial update, DELETE remove), and return meaningful status codes (200, 201 with `Location`, 204, 400, 401, 403, 404, 409, 422, 429, 5xx). GET, PUT and DELETE are defined as idempotent and GET as safe; POST is neither. Use consistent error bodies with a machine-readable code, message and request ID, and support content negotiation and compression.

```text
POST /v1/orders            -> 201 Created, Location: /v1/orders/123
GET  /v1/orders/123        -> 200 OK
PATCH /v1/orders/123       -> 200 OK
{ "error": { "code": "out_of_stock", "message": "...", "request_id": "r-8" } }
```

Version explicitly (path `/v1` or a header), evolve additively (new optional fields), and document with OpenAPI.

Pitfalls: verbs in URLs, 200 responses carrying errors, leaking internal IDs or database structure, breaking changes without versions.

Interview tip: link design choices to client behaviour, such as retries being safe only for idempotent methods.

### Pagination, filtering and bulk operations
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design#filter-and-paginate-data -->
Never return unbounded lists. Offset pagination (`?offset=1000&limit=20`) is simple but slow for deep pages (the database still skips rows) and unstable when data changes (duplicates or gaps). Keyset (cursor) pagination uses the last seen sort key and stays fast and stable: `WHERE (created_at, id) < (:ts, :id) ORDER BY created_at DESC, id DESC LIMIT 20`. Return an opaque cursor so you can change internals, and cap `limit`.

```text
GET /v1/orders?limit=20&cursor=eyJ0cyI6IjIwMjYt...
-> { "items": [...], "next_cursor": "eyJ0cyI6..." }
```

Support filtering and sorting only on indexed fields. For bulk operations, offer batch endpoints with per-item results or asynchronous jobs (`202 Accepted` plus a status URL) rather than one huge synchronous call.

Pitfalls: total counts on huge tables (expensive; consider estimates); sorting by non-unique columns without a tiebreaker.

Interview tip: explain why `OFFSET` degrades, and answer with keyset pagination.

### REST, gRPC, GraphQL, webhooks and real-time options
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/web-queue-worker -->
REST over HTTP/JSON is ubiquitous, cacheable and easy for public APIs. gRPC uses HTTP/2 and Protocol Buffers: compact, typed contracts, streaming, ideal for internal service-to-service calls (but needs gateways for browsers). GraphQL lets clients request exactly the fields they need, reducing over-fetching for varied clients, at the cost of complex caching, N+1 resolver risks and query-cost control. Webhooks push events to client-provided URLs, so sign them, retry with backoff and make receivers idempotent.

For real-time updates: short polling (simple, wasteful), long polling, Server-Sent Events (one-way server push over HTTP), and WebSockets (bidirectional, stateful connections that need sticky routing and connection-aware scaling).

```text
Mobile feed: REST/GraphQL    Internal calls: gRPC
Live prices: SSE or WebSocket   Partner events: signed webhooks
```

Pitfalls: choosing WebSockets when polling every 30 seconds would do; unbounded GraphQL query depth.

Interview tip: justify each protocol by client type, payload and direction of data flow.

### Rate limiting algorithms
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/rate-limiting-pattern -->
Rate limiting protects services from abuse and overload and enforces fairness or quotas. Fixed window counters are simplest but allow double bursts at window boundaries. Sliding window log is exact but memory heavy; sliding window counter approximates it cheaply. Token bucket refills tokens at a steady rate up to a burst capacity, allowing controlled bursts, and is the most common choice. Leaky bucket smooths output at a constant rate.

```python
def allow(bucket, now, rate, capacity):
    bucket.tokens = min(capacity, bucket.tokens + (now - bucket.ts) * rate)
    bucket.ts = now
    if bucket.tokens >= 1:
        bucket.tokens -= 1
        return True
    return False
```

Respond with `429 Too Many Requests` and `Retry-After`, and expose remaining quota headers. Limit by API key, user, IP and endpoint, with stricter limits on expensive or sensitive routes (login).

Pitfalls: limiting only by IP (shared NATs, botnets); inconsistent limits across instances.

Interview tip: say which algorithm and why: token bucket for burst-tolerant APIs.

### Distributed rate limiting
<!-- level: advanced; ref: https://redis.io/docs/latest/develop/use/patterns/distributed-locks/ -->
With many API instances, counters must be shared or approximated. Central store (Redis) with atomic operations gives accurate limits: use a Lua script to read, refill and decrement atomically so concurrent requests cannot oversell tokens. For lower latency and resilience, enforce locally with a share of the quota and sync periodically (accepting some overshoot), or enforce at the gateway or CDN edge.

Decide failure behaviour: if Redis is down, fail open (availability) for general APIs, fail closed for abuse-sensitive endpoints, and keep a coarse local fallback limiter. Keys should include tenant and window, with TTLs so they expire.

```lua
-- KEYS[1]=bucket key, ARGV: now, rate, capacity
local t = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
-- refill, check, decrement, HSET, EXPIRE ... all in one atomic script
```

Pitfalls: read-modify-write across two Redis calls (race); clock differences between app nodes (use Redis time); hot key for a single large tenant.

Interview tip: explain the trade-off between accuracy, latency and availability when picking central versus local enforcement.

## 2. Idempotency, observability and reliability

### Idempotency keys
<!-- level: intermediate; ref: https://docs.stripe.com/api/idempotent_requests -->
An operation is idempotent if repeating it has the same effect as doing it once. Networks lose responses, so clients retry; without protection a retried payment or order is duplicated. The standard solution is a client-generated idempotency key sent with the request (`Idempotency-Key: <uuid>`). The server stores the key with the request fingerprint and the outcome; a repeat with the same key returns the stored response instead of executing again, and a repeat with the same key but different payload is rejected.

```sql
INSERT INTO idempotency (key, request_hash, status)
VALUES (:k, :h, 'in_progress')
ON CONFLICT (key) DO NOTHING;   -- 0 rows = duplicate: return stored result
```

Implement the key insert and business effect in one transaction, or have the key's state machine (in_progress, completed) cover crashes. Expire keys after a window such as 24 hours.

Pitfalls: concurrent duplicates racing (needs unique constraint), side effects outside the transaction, and keys reused by clients across different operations.

Interview tip: pair idempotency keys with at-least-once queues to achieve "effectively once".

### Metrics, logs and traces
<!-- level: basic; ref: https://opentelemetry.io/docs/concepts/signals/ -->
Observability is the ability to understand internal behaviour from outputs. Metrics are numeric time series (cheap, aggregatable, good for dashboards and alerts). Logs are discrete events with context (rich, expensive; use structured JSON with a request ID). Traces follow a request across services as a tree of spans, showing where time goes. Use correlation: trace and request IDs in logs, exemplars linking metrics to traces.

Instrument with standard approaches: the RED method for services (rate, errors, duration) and USE for resources (utilisation, saturation, errors); Google's four golden signals are latency, traffic, errors and saturation. OpenTelemetry provides vendor-neutral APIs and a collector.

```json
{"ts":"2026-01-05T10:00:01Z","level":"error","trace_id":"4bf92f35",
 "svc":"checkout","msg":"payment declined","order":"o-1"}
```

Pitfalls: high-cardinality metric labels (user IDs) that explode storage; logging secrets and personal data; sampling away the traces you need during incidents.

Interview tip: describe how you would debug "checkout is slow" using all three signals in order.

### Alerting on symptoms and SLO burn rate
<!-- level: intermediate; ref: https://sre.google/workbook/alerting-on-slos/ -->
Alert on user-visible symptoms (error rate, latency, SLO burn) rather than on every cause (CPU, a pod restart). Every page should be urgent, actionable and need a human. Burn-rate alerts compare the speed at which you are consuming error budget with the speed that would exhaust it: a fast burn (for example 14.4x over one hour) pages immediately, a slow burn (for example 1x over three days) opens a ticket. Multi-window rules reduce false positives.

Runbooks link each alert to diagnosis steps and dashboards. After incidents, run blameless postmortems with concrete action items. Track alert quality (precision) and on-call load.

```text
page:   error_budget_burn_1h > 14.4 AND burn_5m > 14.4
ticket: error_budget_burn_3d > 1
```

Pitfalls: alert fatigue from noisy thresholds; dashboards nobody owns; no alert on the monitoring pipeline itself.

Interview tip: say "alert on symptoms, diagnose with causes".

### Timeouts, retries and backoff with jitter
<!-- level: intermediate; ref: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/ -->
Every network call needs a timeout; otherwise slow dependencies consume threads and connections until the caller fails. Set timeouts from the dependency's observed latency (for example above p99.9) and propagate an overall deadline down the call chain so downstream work stops when the caller has given up. Retry only idempotent operations and only transient errors, with exponential backoff and random jitter so clients don't synchronise into retry storms. Limit attempts and use a retry budget (for example retries at most 10% of traffic) to avoid amplification across layers.

```python
for attempt in range(4):
    try: return call(timeout=0.8)
    except Transient:
        sleep(random.uniform(0, min(2.0, 0.1 * 2**attempt)))   # full jitter
raise
```

Pitfalls: retries at every layer multiply load (3 layers x 3 tries = 27 calls); retrying on 4xx; no deadline.

Interview tip: mention that retries are the most common cause of turning a small outage into a big one.

### Circuit breakers, bulkheads and load shedding
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker -->
A circuit breaker tracks failures to a dependency; when failures exceed a threshold it opens and fails calls immediately (or returns a fallback) instead of waiting, then lets a few probe calls through (half-open) to test recovery. This protects callers' resources and gives the dependency room to recover. Bulkheads isolate resources so one failing dependency cannot exhaust everything: separate thread pools, connection pools or instance groups per dependency or tenant. Load shedding rejects excess work early (return 503 or 429 quickly) based on queue length, latency or priority, keeping the service responsive for the traffic it accepts.

```text
CLOSED --failures>threshold--> OPEN --after cooldown--> HALF-OPEN
HALF-OPEN --probe ok--> CLOSED     HALF-OPEN --probe fails--> OPEN
```

Prioritise critical traffic (checkout over recommendations) when shedding and degrade features gracefully.

Pitfalls: thresholds that flap; fallbacks that are themselves heavy; shedding at the wrong layer after expensive work.

Interview tip: tie each pattern to a failure mode: slow dependency, noisy neighbour, overload.

### Disaster recovery: RPO, RTO and multi-region designs
<!-- level: advanced; ref: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/plan-for-disaster-recovery-dr.html -->
RPO (recovery point objective) is the maximum tolerable data loss measured in time; RTO (recovery time objective) is the maximum tolerable downtime. They set the strategy and cost: backup and restore (hours, cheapest), pilot light (core data replicated, compute started on demand), warm standby (scaled-down copy running), and multi-site active-active (near-zero RTO and RPO, highest cost and complexity, with conflict resolution and data residency issues).

Backups are worthless untested: schedule restore drills and measure real RTO. Replicate asynchronously across regions (accepting an RPO above zero) or synchronously where latency permits. Keep infrastructure as code so a region can be rebuilt, and avoid hidden cross-region dependencies.

```text
RPO 15 min, RTO 1 h  -> warm standby + async cross-region replica + runbook
RPO 0,  RTO ~0       -> active-active with quorum or conflict-free data
```

Pitfalls: single-region control planes or DNS providers; failover that was never rehearsed; backups in the same account and region.

Interview tip: ask for RPO and RTO first, then pick the cheapest design that satisfies them.

## 3. Security basics

### Authentication, authorisation and tokens
<!-- level: intermediate; ref: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html -->
Authentication proves who you are; authorisation decides what you may do. Use established protocols: OAuth 2.0 for delegated access and OpenID Connect for login. Short-lived access tokens (JWTs or opaque tokens) plus longer-lived refresh tokens with rotation limit damage from theft. Validate JWT signature, issuer, audience and expiry on every request; opaque tokens need introspection or a cache. Authorise on the server for each resource (RBAC for roles, ABAC or policy engines for fine-grained rules), including object-level checks to stop IDOR, where users read others' records by changing an ID.

```text
Authorization: Bearer <access_token>   (exp 10 min)
refresh_token rotates on use; reuse of an old one revokes the family
```

Pitfalls: storing tokens in `localStorage` where XSS can read them (prefer HttpOnly secure cookies for browsers); accepting `alg: none`; trusting client-side role checks.

Interview tip: note that JWTs are hard to revoke, so keep them short-lived and design for key rotation.

### Encryption, secrets and the API perimeter
<!-- level: intermediate; ref: https://owasp.org/www-project-api-security/ -->
Encrypt in transit (TLS 1.2+ everywhere, including internal traffic, with mTLS between services in zero-trust setups) and at rest (disk or database encryption, with keys managed in a KMS and rotated). Never store secrets in code or images; use a secrets manager, inject at runtime and grant least privilege. Hash passwords with a slow, salted algorithm (Argon2id, bcrypt). Protect the perimeter with an API gateway or WAF: authentication, request size limits, schema validation, rate limiting, and DDoS protection at the CDN.

Walk through the OWASP API Security Top 10 as a checklist: broken object-level authorisation, broken authentication, excessive data exposure, unrestricted resource consumption, security misconfiguration, and unsafe consumption of third-party APIs.

```text
Client --TLS--> CDN/WAF --> API gateway (authn, rate limit) --mTLS--> services
Secrets: KMS/Vault -> injected at runtime, rotated, audited
```

Pitfalls: logging tokens or card numbers; shared long-lived credentials; overly broad IAM roles.

Interview tip: mention defence in depth and least privilege as design principles.

## 4. Design walk-throughs

### Walk-through: URL shortener
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design -->
Requirements: create short links, redirect with low latency, optional expiry and custom aliases, click analytics; heavy read skew (say 100:1) and high availability for redirects. Estimate: 100M new links per month is about 40 writes/s; 4 billion redirects per month is about 1,500 reads/s average, 10k peak. Storage: 500 bytes x 100M x 12 months x 5 years is about 3 TB, so shard or use a scalable key-value store.

Key generation: base62 of a unique ID (7 chars gives about 3.5 trillion values). Options: a distributed ID generator (Snowflake-style) or pre-allocated ID ranges per app server avoid collisions without coordination; hashing the URL needs collision handling. API: `POST /links`, `GET /{code}` returning `301` (cacheable, loses analytics) or `302` (every click reaches you).

```text
Client -> CDN -> LB -> redirect service -> Redis (code->url) -> KV store
Clicks -> Kafka -> analytics store (async, not on the redirect path)
```

Pitfalls: counters on the hot path; guessable sequential codes (use salt or shuffled alphabet if privacy matters); abuse and phishing, so add URL scanning and rate limits.

Interview tip: cache the code-to-URL mapping aggressively; the redirect path should touch one key.

### Walk-through: chat system
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/publisher-subscriber -->
Requirements: 1:1 and group messaging, delivery in order per conversation, online presence, offline delivery, message history, read receipts; scale to tens of millions of concurrent connections. Clients hold a WebSocket to a gateway tier; because connections are stateful, a connection registry (Redis) maps user to gateway node. A sent message is persisted first, then routed: if the recipient is online, the message goes to their gateway via pub/sub; otherwise it is stored and a push notification is sent.

Ordering: assign a per-conversation sequence number (or use a conversation-partitioned log such as Kafka keyed by conversation ID) so clients can detect gaps and sort. Storage: a wide-column or partitioned store keyed by `(conversation_id, message_seq)`, which suits append and range reads. Delivery is at-least-once with client acknowledgements and dedupe by message ID. Large groups use fan-out on read or hybrid approaches.

```text
Client <-WS-> Gateway --> Chat service --> Log (partition=conv_id) --> Store
                     \--> Presence (Redis, TTL heartbeats) / Push service
```

Pitfalls: relying on timestamps for ordering; single huge group hot-spotting a partition; presence storms (throttle updates).

Interview tip: talk about reconnect storms and how clients resume from last seen sequence.

### Walk-through: news feed and timelines
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view -->
Requirements: users follow others, view a ranked or chronological feed, low read latency, posts appear within seconds. Two core strategies. Fan-out on write (push): when a user posts, insert the post ID into each follower's precomputed feed (a Redis list or sorted set); reads are fast but a celebrity with 50 million followers makes writes explode. Fan-out on read (pull): at read time, fetch recent posts from all followed accounts and merge; writes are cheap but reads are expensive. Real systems use a hybrid: push for normal users, pull for celebrities merged in at read time.

Store post content once in a post store; feeds hold IDs, hydrated from a cache. Rank with a separate service using recency and engagement signals, kept off the critical path where possible. Process fan-out asynchronously through a queue so posting stays fast.

```text
Post -> Post store + Kafka -> Fan-out workers -> feed:{follower} (sorted set by time)
Read: feed IDs (+ celebrity posts pulled) -> hydrate from cache -> rank -> page
```

Pitfalls: unbounded feed length (cap and trim); thundering reads on hot posts (cache); inactive users wasting fan-out work (skip them).

Interview tip: always state the celebrity problem and the hybrid answer.

### Walk-through: payment system
<!-- level: advanced; ref: https://docs.stripe.com/api/idempotent_requests -->
Requirements: charge customers, correctness over speed, no double charges, auditability, reconciliation, PCI-DSS scope minimised. Do not handle raw card data yourself: use a PSP's hosted fields or tokenisation so you store only tokens. Flow: the client creates an order; the server creates a payment intent with an idempotency key; the PSP authorises and later captures; webhooks confirm final status, and the system treats the PSP as an external source of truth that may respond late or ambiguously.

Model payments as a state machine (created, authorised, captured, failed, refunded) with every transition recorded in an append-only ledger using double-entry bookkeeping. Use the outbox pattern to publish events, idempotent consumers, and a periodic reconciliation job comparing the ledger with PSP settlement files to catch mismatches. On timeouts, never assume failure: query the PSP by idempotency key before retrying.

```text
Client -> API (Idempotency-Key) -> Payment service -> PSP
PSP webhook -> verify signature -> state transition (idempotent) -> ledger + outbox
Nightly: ledger vs PSP settlement reconciliation
```

Pitfalls: floating-point money (use integer minor units); dual writes without outbox; trusting client-reported success.

Interview tip: emphasise idempotency, a ledger as the source of truth, and reconciliation as the safety net.
