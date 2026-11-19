## 1. Requirements and estimation

### Functional and non-functional requirements
<!-- level: basic; ref: https://learn.microsoft.com/en-us/azure/architecture/guide/design-principles/ -->
Every design starts by separating what the system does (functional: post a message, shorten a URL) from how well it must do it (non-functional: latency, availability, durability, consistency, security, cost). Non-functional requirements drive architecture far more than features do. A chat app and an e-commerce checkout may both "store data", but one tolerates lost typing indicators while the other must never lose an order.

Clarify in this order: users and scale, core use cases, read/write ratio, latency targets, consistency needs, data retention, geography, and what is explicitly out of scope. Turn vague words into numbers: "fast" becomes p99 under 300 ms; "reliable" becomes 99.95% monthly availability.

```text
Reads:writes = 100:1, p99 read < 200 ms, 99.9% availability,
data retained 5 years, eventual consistency OK for counters
```

Pitfalls: jumping straight to boxes and technologies; designing for Google scale when requirements say thousands of users.

Interview tip: state assumptions aloud and confirm them; it shows judgement and gives you numbers to size against.

### Back-of-the-envelope estimation
<!-- level: basic; ref: https://sre.google/sre-book/embracing-risk/ -->
Estimation turns requirements into capacity numbers so you can choose between one database and a sharded fleet. Memorise rough orders of magnitude: a day has about 86,400 seconds (round to 100k); 1 million requests per day is roughly 12 requests per second on average; peak is commonly 2-10 times average. A single modern server handles thousands of simple requests per second; an SSD does tens of thousands of random IOPS; memory access is around 100 ns, SSD read around 100 microseconds, a datacenter round trip around 0.5 ms, cross-continent around 100 ms.

```text
100M DAU * 10 reads/day = 1B reads/day ~ 12k reads/s avg, ~40k peak
Writes 1M/day * 1 KB = 1 GB/day ~ 365 GB/year (x3 replication ~ 1.1 TB)
```

Pitfalls: forgetting replication and index overhead; using averages when peak drives sizing; false precision.

Interview tip: show the arithmetic, round aggressively, and finish by saying what the numbers imply (single node suffices, or cache needed, or sharding needed).

### SLIs, SLOs and error budgets
<!-- level: intermediate; ref: https://sre.google/sre-book/service-level-objectives/ -->
A service level indicator (SLI) is a measured quantity such as the fraction of requests that succeed in under 300 ms. A service level objective (SLO) is the target for that indicator over a window, for example 99.9% over 30 days. The gap to 100% is the error budget: 0.1% of 30 days is about 43 minutes of allowed unreliability. An SLA is the contractual promise with consequences, usually looser than the internal SLO.

Error budgets turn reliability into a trade-off: while budget remains, ship features; when it is exhausted, prioritise stability work. Choose SLIs that reflect user experience (availability, latency, correctness, freshness), measured at the edge or load balancer, not CPU.

```text
Availability SLI = good requests / valid requests
99.9% -> 43.8 min/month,  99.99% -> 4.4 min/month
```

Pitfalls: setting 99.999% without paying for it; alerting on causes rather than budget burn.

Interview tip: every extra nine costs roughly an order of magnitude more effort; pick the nines the business needs.

### Latency, throughput and percentiles
<!-- level: basic; ref: https://sre.google/sre-book/monitoring-distributed-systems/ -->
Latency is the time one request takes; throughput is the number of requests completed per unit time. They interact: as utilisation approaches 100%, queues build and latency rises sharply, so run services well below saturation (often 50-70%). Always report percentiles: median hides the slow tail. A page that makes 20 backend calls will hit at least one p99 call about 18% of the time, so tail latency compounds in fan-out architectures.

```text
p50 = 40 ms, p95 = 120 ms, p99 = 900 ms
P(at least one slow among 20 calls) = 1 - 0.99^20 ~ 18%
```

Techniques for the tail: timeouts, hedged requests, caching, load shedding, and avoiding synchronous fan-out.

Pitfalls: averaging percentiles across hosts (compute from histograms instead); measuring only server time and ignoring queueing and network.

Interview tip: Little's law (concurrency = throughput x latency) is a handy sizing formula for thread pools and connection counts.

### Availability maths and redundancy
<!-- level: intermediate; ref: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/availability.html -->
Components in series multiply availability: two 99.9% components in a chain give about 99.8%. Redundant components in parallel multiply failure probability: two independent 99.9% replicas give 1 - 0.001^2 = 99.9999% in theory. Reality is lower because failures correlate (shared deploys, shared dependencies, same availability zone), and failover itself takes time and can fail.

Practical rules: remove single points of failure at each tier, spread across availability zones, make deployments incremental, and test failover regularly. Hard dependencies in the request path reduce availability; make non-critical ones optional with graceful degradation.

```text
Series:   0.999 * 0.999 = 0.998
Parallel: 1 - (1-0.999)^2 = 0.999999 (ideal, independent)
```

Pitfalls: counting redundancy that shares a fate (same disk, same region, same config push).

Interview tip: say that availability is mostly decided by dependencies and change management, not by hardware reliability.

## 2. Scalability and load balancing

### Vertical versus horizontal scaling
<!-- level: basic; ref: https://learn.microsoft.com/en-us/azure/architecture/best-practices/auto-scaling -->
Vertical scaling (scale up) means a bigger machine: simple, no code changes, but bounded by hardware and a single point of failure. Horizontal scaling (scale out) adds more machines behind a load balancer: nearly unbounded and fault tolerant, but requires stateless services or partitioned state and brings distributed-system complexity.

Start vertically while it is cheap; go horizontal when you need fault tolerance or exceed one machine. Stateless web tiers scale out easily; databases are harder, using read replicas first and then sharding. Autoscaling adjusts instance count from metrics such as CPU, queue depth or request rate, with cooldowns to avoid flapping.

```yaml
# illustrative autoscaling policy
min_instances: 3
max_instances: 30
target_cpu_utilization: 60
scale_in_cooldown_seconds: 300
```

Pitfalls: scaling an app tier that is bottlenecked by the database; scaling on CPU when the bottleneck is I/O or connections.

Interview tip: always name the bottleneck first, then the scaling lever for that specific resource.

### Stateless services and session handling
<!-- level: basic; ref: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/design-your-workload-service-architecture.html -->
A stateless service keeps no request-specific data in local memory or disk between requests, so any instance can serve any request. That allows free scaling, rolling deploys, and instant replacement of failed nodes. State moves to external stores: sessions in Redis or signed tokens, files in object storage, data in databases.

Options for sessions: server-side session in a shared cache (easy revocation, extra hop); signed, self-contained tokens such as JWT (no lookup, hard to revoke, so keep them short-lived); sticky sessions at the load balancer (works but uneven load and fragile on instance loss).

```text
Client -> LB -> any app instance -> Redis (session) / DB / S3
```

Pitfalls: storing uploads or caches on local disk; relying on in-memory counters for rate limiting across instances.

Interview tip: statelessness is the precondition for horizontal scale; explicitly list where each kind of state ends up.

### Load balancing algorithms
<!-- level: intermediate; ref: https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html -->
A load balancer spreads requests across healthy backends. Common algorithms: round robin (simple, ignores load), weighted round robin (heterogeneous capacity), least connections or least outstanding requests (adapts to slow requests), IP hash or consistent hashing (affinity without cookies), and power-of-two-choices (pick two random backends and send to the less loaded; near-optimal with little coordination). Health checks remove failing nodes and connection draining finishes in-flight requests during deploys.

```text
choose(a, b) = a if load[a] < load[b] else b   # power of two choices
```

Layer 4 balancers forward TCP/UDP quickly and are protocol agnostic; layer 7 balancers understand HTTP, enabling routing by path or header, TLS termination, retries and canary splits at a higher CPU cost.

Pitfalls: round robin with long-lived connections (WebSockets, gRPC) causing hot nodes; the balancer itself being a single point of failure.

Interview tip: for gRPC and HTTP/2, mention that connection-level balancing is insufficient; you need request-level balancing.

### Layer 4 versus layer 7 and global load balancing
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/load-balancing-overview -->
Layer 4 (transport) balancers decide by IP and port and can handle millions of connections with minimal latency. Layer 7 (application) balancers parse HTTP, so they can route `/api` to one pool and `/static` to another, terminate TLS, rewrite headers, apply WAF rules and do weighted canary routing. Global load balancing steers users to the nearest or healthiest region using DNS (latency-based or geo routing with short TTLs) or anycast IPs, which advertise one address from many locations.

```text
DNS (geo/latency) -> regional L7 LB -> service pool (multi-AZ)
Failover: health-checked DNS or anycast withdraws a bad region
```

Pitfalls: DNS TTL caching delays failover; clients and resolvers sometimes ignore TTLs; cross-region traffic cost and data residency rules.

Interview tip: mention redundancy for the balancers themselves (managed multi-AZ services, or VRRP/anycast for self-hosted).

### Health checks and graceful degradation
<!-- level: intermediate; ref: https://aws.amazon.com/builders-library/implementing-health-checks/ -->
Health checks decide whether a backend gets traffic. Liveness checks ask "is the process alive" (restart if not); readiness checks ask "can it serve now" (remove from rotation while warming up or when dependencies are down). Shallow checks are cheap but miss broken dependencies; deep checks catch more but can cause cascading outages if a shared dependency blips and every node is declared unhealthy simultaneously.

A safe pattern: readiness reflects local capability, dependency failures degrade features rather than fail the instance, and the balancer has a "fail open" panic threshold, serving to all nodes if too many appear unhealthy.

```yaml
readinessProbe:
  httpGet: { path: /ready, port: 8080 }
  periodSeconds: 5
  failureThreshold: 3
```

Pitfalls: health endpoints that hit the database for every probe; checks that pass while the app cannot serve real traffic.

Interview tip: describe graceful degradation, such as serving cached or default data when a recommendation service is down.

## 3. Caching and CDNs

### Cache-aside, read-through and write patterns
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside -->
In cache-aside the application checks the cache, on a miss reads the database, then populates the cache. Read-through hides this inside the cache layer. Write-through writes to cache and database together (consistent but slower writes). Write-behind (write-back) acknowledges after writing to cache and flushes asynchronously (fast, risk of loss). Write-around skips the cache on writes and lets reads populate it.

```python
def get_user(uid):
    v = cache.get(f"user:{uid}")
    if v is None:
        v = db.fetch_user(uid)
        cache.set(f"user:{uid}", v, ttl=300)
    return v
```

On update, prefer to delete the cached key rather than update it, to avoid races between concurrent writers.

Pitfalls: stale reads after writes, caching null results without a short TTL, unbounded key cardinality.

Interview tip: cache-aside is the default answer for read-heavy workloads; know the failure mode that the cache is optional, so the database must survive cold-cache load.

### Eviction policies and TTLs
<!-- level: basic; ref: https://redis.io/docs/latest/develop/reference/eviction/ -->
A cache is bounded, so it must evict. LRU removes the least recently used entry; LFU the least frequently used (better for stable hot sets); FIFO and random are simpler. Redis offers approximated LRU/LFU variants (`allkeys-lru`, `volatile-ttl`, and so on) configured with `maxmemory-policy`. TTLs bound staleness and memory regardless of policy.

```text
maxmemory 4gb
maxmemory-policy allkeys-lru
```

Choose TTL by how much staleness the business accepts: product descriptions minutes to hours, inventory seconds, permissions seconds or event-based invalidation. Add random jitter to TTLs so keys written together do not expire together.

Pitfalls: a hit rate that looks fine in average but is dominated by a few hot keys; evicting large, expensive-to-rebuild objects first; no memory headroom for fragmentation.

Interview tip: measure hit ratio, evictions and latency; a low hit ratio often means poor key design, not too little memory.

### Cache invalidation and stampedes
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/azure/architecture/best-practices/caching -->
Invalidation strategies: TTL expiry (simple, bounded staleness), explicit delete on write, event-driven invalidation from change data capture, and versioned keys (`product:42:v17`) that make old entries unreachable. A cache stampede (thundering herd) happens when a hot key expires and many requests recompute it simultaneously, overloading the database.

Mitigations: request coalescing (single-flight, one rebuild while others wait), per-key locks with short TTL, stale-while-revalidate (serve slightly stale data while refreshing in the background), probabilistic early refresh, TTL jitter, and pre-warming after deploys.

```python
if (v := cache.get(k)) is None:
    if cache.set(f"lock:{k}", 1, nx=True, ex=10):
        v = rebuild(); cache.set(k, v, ex=300 + jitter())
    else:
        v = wait_or_serve_stale(k)
```

Pitfalls: deleting the key before the database commit (race re-caches old data); distributed locks without expiry.

Interview tip: say "there are two hard things" jokingly, then give a concrete invalidation plan for the scenario.

### Redis versus Memcached and local caches
<!-- level: intermediate; ref: https://redis.io/docs/latest/develop/data-types/ -->
Memcached is a simple, multithreaded, in-memory key-value cache with no persistence and no data structures beyond strings. Redis is a data-structure server: strings, hashes, lists, sets, sorted sets, streams, with atomic operations, Lua scripting, optional persistence (RDB snapshots, AOF), replication, and clustering. Redis is single-threaded for command execution (with I/O threads in newer versions), so very large values or slow commands (`KEYS`, large `SMEMBERS`) block everyone.

Add an in-process cache (for example a small LRU map) in front of a shared cache to cut network hops for ultra-hot keys, accepting per-instance staleness and a bounded size.

```bash
redis-cli SET session:abc '{"u":42}' EX 1800
redis-cli ZADD leaderboard 1500 alice
redis-cli ZREVRANGE leaderboard 0 9 WITHSCORES
```

Pitfalls: treating Redis as the system of record without understanding durability settings; using `KEYS` in production (use `SCAN`).

Interview tip: pick Redis when you need atomic counters, sorted sets, pub/sub or locks; Memcached for plain object caching at large multi-threaded throughput.

### CDNs and HTTP caching headers
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching -->
A content delivery network caches content at edge locations close to users, cutting latency and origin load, and absorbing traffic spikes and DDoS. Static assets (images, JS, CSS, video segments) are the classic use; many CDNs also cache API responses and run edge logic.

Behaviour is controlled by HTTP headers: `Cache-Control: public, max-age=31536000, immutable` for fingerprinted assets; `s-maxage` for shared caches; `stale-while-revalidate`; `ETag`/`Last-Modified` with conditional requests returning `304`; and `Vary` to key the cache by headers like `Accept-Encoding`. Purge by URL or tag, or avoid purging with content-hashed filenames.

```text
Cache-Control: public, max-age=31536000, immutable      # app.3f9c2a.js
Cache-Control: private, no-store                         # account pages
```

Pitfalls: caching personalised responses under a shared key (`private` and `Vary: Cookie`); over-broad `Vary` destroying hit rate; forgetting to include the query string appropriately.

Interview tip: say "version the filename, cache forever, purge nothing".

### Cache hierarchy and what to cache
<!-- level: intermediate; ref: https://aws.amazon.com/builders-library/caching-challenges-and-strategies/ -->
Caches exist at many layers: browser, CDN, reverse proxy, application memory, distributed cache, database buffer pool. Each layer cuts load on the next but adds an invalidation surface. Cache things that are expensive to compute, read much more than they change, and tolerate some staleness: rendered fragments, serialized query results, derived aggregates, permissions lookups, feature flags, and third-party API responses.

Avoid caching highly personalised, rapidly changing, or security-critical data unless keyed carefully. Beware a cache hiding a performance problem: if the database collapses when the cache is cold, the cache has become a hard dependency. Plan for cold start with request coalescing, load shedding and gradual warm-up.

```text
Browser (private) -> CDN (shared) -> L7 proxy -> app LRU -> Redis -> DB
```

Pitfalls: inconsistent caching between layers; "metastable failures", where a cache outage overloads the database and recovery stalls.

Interview tip: discuss expected hit ratio, miss penalty and what happens on total cache loss.
