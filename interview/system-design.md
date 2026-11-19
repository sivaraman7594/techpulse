# System design interview questions
(Full worked designs also come from the CC BY 4.0 System Design Primer.)

### What is the CAP theorem?
<!-- level: intermediate; kind: concept; ref: https://github.com/donnemartin/system-design-primer#cap-theorem -->
In a distributed system, when a **network partition** happens you must choose between:
- **Consistency**: every read sees the latest write (or gets an error).
- **Availability**: every request gets a response, possibly with stale data.

Partitions can't be avoided in real networks, so systems are effectively **CP** (e.g. refuse writes without a quorum) or **AP** (accept writes and reconcile later — eventual consistency). The PACELC extension adds that even without partitions you trade **latency vs consistency**.

### What is the difference between vertical and horizontal scaling?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/azure/architecture/best-practices/auto-scaling -->
- **Vertical** (scale up): a bigger machine — simple, but limited and a single point of failure.
- **Horizontal** (scale out): more machines behind a **load balancer** — near-unlimited and fault-tolerant, but needs **stateless** services (sessions in Redis or tokens), and partitioned or replicated data.

### Explain common caching strategies and the hard parts of caching.
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/azure/architecture/patterns/cache-aside -->
- **Cache-aside**: the app reads the cache, falls back to the database on a miss and populates the cache. Most common.
- **Write-through**: writes go to the cache and the database together.
- **Write-behind**: writes go to the cache and are flushed to the database later — fast but risks data loss.

Hard parts: **invalidation** (TTLs, delete on update), **stampedes** when a hot key expires (locking or early refresh), stale data tolerance, and sizing/eviction (LRU).

### Design a rate limiter for a public API.
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/azure/architecture/patterns/rate-limiting-pattern -->
1. **Requirements**: limit per API key/user/IP (e.g. 100 requests/minute), low latency, works across many servers, return `429 Too Many Requests` with `Retry-After`.
2. **Algorithms**:
   - **Token bucket**: tokens refill at a fixed rate; each request takes one. Allows short bursts. Most common.
   - **Fixed window** counter: simple but allows bursts at window edges.
   - **Sliding window** log/counter: smoother and more accurate.
3. **Distributed state**: keep counters in **Redis** with atomic operations (`INCR` + `EXPIRE`, or a Lua script for token bucket) so all instances share limits.
4. **Placement**: at the API gateway / edge (e.g. Azure API Management, NGINX) or as middleware (ASP.NET Core has built-in rate limiting).
5. **Failure mode**: decide whether to allow or block traffic if Redis is unavailable.

### How do you make a payment API safe to retry?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/azure/architecture/patterns/ -->
Network timeouts mean clients will retry — and a retry must never charge twice.
- **Idempotency keys**: the client sends a unique key per operation; the server stores the key with the result and returns the stored result for repeats.
- **Transactional outbox**: write the business change and an "event to publish" in the same database transaction; a separate process publishes events. This avoids "saved but message lost".
- **Idempotent consumers**: message handlers record processed message ids, because queues deliver at-least-once.
- Use clear state machines (pending → authorised → captured) and reconcile with the payment provider.

### Monolith or microservices — how do you decide?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/architecture/guide/architecture-styles/microservices -->
Start with a **well-structured (modular) monolith** unless you have clear reasons otherwise. It's simpler to build, test, deploy and debug.

Consider **microservices** when:
- separate teams need to deploy independently,
- parts of the system have very different scaling or reliability needs,
- domain boundaries are well understood.

Costs of microservices: network failures, distributed data and transactions, observability, versioning, and operational overhead. Splitting along well-defined module boundaries later is much easier than undoing a premature split.

### How do message queues improve a system, and what pitfalls must you handle?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/azure/architecture/patterns/queue-based-load-leveling -->
Queues **decouple** producers from consumers, **absorb traffic spikes** (load levelling), and let slow work happen in the background.

Handle the pitfalls:
- **At-least-once delivery** → make consumers idempotent.
- **Poison messages** → retry with backoff, then move to a **dead-letter queue** and alert.
- **Ordering** → only guaranteed within a partition/session; design for out-of-order where possible.
- **Monitoring** → queue length and message age show when consumers can't keep up.
