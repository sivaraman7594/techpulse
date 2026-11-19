## 1. Databases

### Choosing between relational and NoSQL stores
<!-- level: basic; ref: https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/data-store-overview -->
Relational databases (PostgreSQL, MySQL) offer a rich schema, joins, constraints and ACID transactions; they suit structured data with relationships and ad hoc queries, and scale vertically and by read replicas far enough for most products. NoSQL families trade some of that for scale or shape: key-value stores (DynamoDB, Redis) for primary-key lookups at huge scale; document stores (MongoDB) for flexible nested records; wide-column stores (Cassandra) for write-heavy time-ordered data; graph databases for relationship traversal; search engines for text relevance.

Choose from the access patterns, not fashion: if you know your queries up front and need predictable single-digit-millisecond lookups at massive scale, key-value fits; if you need flexible queries and strong consistency, start relational.

```text
Access pattern: "get orders by customer, newest first, page of 20"
-> relational: index (customer_id, created_at DESC)
-> DynamoDB: PK=customer_id, SK=created_at
```

Pitfalls: choosing NoSQL to avoid schema design, then reimplementing joins in code.

Interview tip: "polyglot persistence" is fine, but each additional store costs operations and consistency headaches.

### Indexes and query performance
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/indexes.html -->
An index is an auxiliary structure (usually a B-tree) that lets the database find rows without scanning the table. It speeds reads and slows writes, since every insert or update maintains each index, and costs storage. Composite indexes follow the leftmost-prefix rule: an index on `(a, b)` helps filters on `a` or `a and b`, not on `b` alone. Covering indexes include all queried columns so the table isn't touched. Selective columns benefit most; low-cardinality columns (booleans) rarely do.

```sql
CREATE INDEX idx_orders_cust_created ON orders (customer_id, created_at DESC);
EXPLAIN ANALYZE
SELECT id, total FROM orders
WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20;
```

Use `EXPLAIN` to confirm an index scan rather than a sequential scan.

Pitfalls: functions on indexed columns (`WHERE lower(email) = ...`) bypass the index unless there is an expression index; `OFFSET` pagination gets slower with depth, so use keyset pagination (`WHERE created_at < :last`).

Interview tip: always connect index choices to the query shapes you listed.

### ACID transactions and isolation levels
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/transaction-iso.html -->
ACID means atomicity (all or nothing), consistency (constraints preserved), isolation (concurrent transactions don't see each other's partial work) and durability (committed data survives crashes, via write-ahead logging). Isolation levels trade anomalies for concurrency: read committed prevents dirty reads; repeatable read (snapshot isolation in many engines) prevents non-repeatable reads; serializable prevents all anomalies, including write skew, at the cost of aborts and retries. Defaults differ: PostgreSQL defaults to read committed, MySQL InnoDB to repeatable read.

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1 AND balance >= 100;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

Pitfalls: check-then-act races (read balance, then write) instead of conditional updates or `SELECT ... FOR UPDATE`; holding transactions open across network calls; ignoring serialization-failure retries.

Interview tip: explain a concrete anomaly such as lost update or write skew and the minimal isolation or locking that prevents it.

### Connection pooling and database capacity
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/runtime-config-connection.html -->
Opening a database connection is expensive and each connection consumes memory (and in PostgreSQL a process). With many app instances, total connections can exceed what the database handles even when query load is modest. Pool connections in the app (fixed max size per instance) and use a proxy pooler (PgBouncer, RDS Proxy, ProxySQL) to multiplex thousands of clients over a few server connections.

Size pools small: more connections than cores usually hurts. A common rule of thumb is a pool near (cores x 2) plus disks per database, then measure. Keep transactions short so connections return quickly, and set statement and lock timeouts.

```ini
; pgbouncer.ini
pool_mode = transaction
default_pool_size = 20
max_client_conn = 2000
```

Pitfalls: transaction-mode pooling breaks session state (prepared statements, `SET`, advisory locks); autoscaling app tiers can multiply connections and take the database down.

Interview tip: when asked how to scale a database for traffic spikes, mention pooling before sharding.

### Time-series, search and analytical stores
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/architecture/data-guide/ -->
Operational (OLTP) databases are optimised for many small transactions. Analytics (OLAP) queries scan and aggregate many rows, so columnar warehouses (BigQuery, Snowflake, Redshift, ClickHouse) store data by column with compression and vectorised execution. Time-series databases (Timescale, InfluxDB, Prometheus) optimise append-heavy timestamped data, downsampling and retention. Search engines (Elasticsearch, OpenSearch) maintain inverted indexes for full-text relevance and faceting.

Feed these stores asynchronously from the primary database using change data capture or events, so heavy queries never hit OLTP. Accept that they are eventually consistent copies, not the source of truth.

```text
Postgres --CDC--> Kafka --> OpenSearch (search)
                       \--> Warehouse (BI)
```

Pitfalls: running analytics on the primary; dual-writing from the application, which drifts when one write fails.

Interview tip: "source of truth plus derived views" is the pattern; name how views are rebuilt.

## 2. Replication and sharding

### Leader-follower replication
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/warm-standby.html -->
In leader-follower (primary-replica) replication all writes go to one leader, which streams its log to followers that serve reads. This scales read throughput and provides failover candidates. Replication can be asynchronous (low write latency, but followers lag and a leader crash can lose recent commits), synchronous (no loss, higher latency and availability coupling), or semi-synchronous (wait for at least one follower).

Replica lag causes read-your-writes anomalies: a user updates a profile then reads from a lagging replica and sees old data. Mitigate by reading from the leader briefly after writes, session-pinning, or tracking log positions (wait until a replica reaches the user's last write LSN).

```sql
-- PostgreSQL: how far behind is the replica?
SELECT now() - pg_last_xact_replay_timestamp() AS replica_lag;
```

Pitfalls: promoting a stale replica loses data; split brain when two nodes both think they lead.

Interview tip: say which operations must read the leader and which tolerate lag.

### Failover, quorum and split brain
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/leader-election -->
Failover replaces a failed leader automatically. Detecting failure is hard: a slow node looks dead, and a partitioned leader may keep accepting writes while a new leader is elected elsewhere (split brain), producing conflicting histories. Defences: use a consensus system (Raft or Paxos, in etcd, ZooKeeper, or built into the database) to elect leaders by majority; fence the old leader (revoke its lease, STONITH, token fencing so storage rejects stale writers); and require quorum for writes.

Majority quorum: with N replicas, W write acks and R read acks, strong reads are possible when W + R > N. Three replicas tolerate one failure; five tolerate two.

```text
N=3, W=2, R=2  -> W+R=4 > 3  (reads see latest write)
N=3, W=1, R=1  -> may read stale
```

Pitfalls: failover timers that are too aggressive causing flapping; no fencing; two-node clusters with no tie-breaker.

Interview tip: always mention fencing tokens, not only election.

### Sharding strategies
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/sharding -->
Sharding splits data across independent databases so writes and storage scale horizontally. Strategies: range-based (contiguous key ranges: efficient range scans, prone to hot spots such as the newest range), hash-based (even distribution, loses range locality), directory/lookup-based (flexible mapping, extra hop and a critical lookup service), and geo-based (data residency, locality).

Choose a shard key with high cardinality, even access, and alignment with the dominant query: queries that include the key hit one shard; others scatter-gather. Cross-shard joins and transactions become expensive; design to avoid them, or use sagas.

```text
shard = hash(user_id) % N          # simple, but resharding moves data
shard = ring.lookup(hash(user_id)) # consistent hashing: minimal movement
```

Pitfalls: celebrity or tenant hot keys; choosing a key (like country) with skew; sharding too early, since replicas, caching and partitioning handle a lot first.

Interview tip: explain what happens to a query that lacks the shard key.

### Consistent hashing and rebalancing
<!-- level: advanced; ref: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html -->
With `hash(key) % N`, adding a node changes N and remaps almost every key, causing massive data movement and cache misses. Consistent hashing places nodes and keys on a ring; a key belongs to the next node clockwise, so adding or removing a node moves only about 1/N of keys. Virtual nodes (each physical node placed at many ring positions) smooth the distribution and let you weight heterogeneous machines.

Many systems instead pre-split into a fixed number of partitions (for example 1,024 logical shards) and assign partitions to nodes, so rebalancing moves whole partitions without rehashing keys.

```python
import bisect, hashlib
def h(s): return int(hashlib.md5(s.encode()).hexdigest(), 16)
ring = sorted((h(f"{n}#{v}"), n) for n in nodes for v in range(100))
def owner(key):
    i = bisect.bisect(ring, (h(key), "")) % len(ring); return ring[i][1]
```

Pitfalls: ignoring replication (store each key on the next R nodes); hot keys still hot regardless of hashing.

Interview tip: describe both consistent hashing and fixed logical partitions, and why moving whole partitions is operationally simpler.

### Hot partitions and key design
<!-- level: advanced; ref: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html -->
A hot partition occurs when traffic concentrates on few keys: a viral post, a big tenant, or a monotonically increasing key (timestamps) that always writes to the latest range. The shard serving it saturates while others idle, so aggregate capacity doesn't help.

Remedies: add entropy to keys (write sharding with a random or calculated suffix, reading by scatter-gather across suffixes), split hot ranges automatically, cache hot reads, buffer writes through a queue and aggregate counters (batch increments), or isolate large tenants onto dedicated shards.

```text
likes:post123#0 .. likes:post123#9   # write to random suffix
total = sum(read all 10 suffixes)    # read side aggregates
```

Pitfalls: over-sharding the suffix makes reads expensive; fixing symptoms with bigger instances.

Interview tip: use the phrase "high-cardinality, evenly accessed key" and give a counter-example such as using date as a partition key.

## 3. Consistency and CAP

### CAP theorem and PACELC
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/azure/architecture/guide/design-principles/ -->
When a network partition occurs, a distributed system must choose between consistency (every read sees the latest write or errors) and availability (every request to a live node gets a non-error answer). Partitions are not optional in real networks, so the practical choice is CP or AP when they happen. PACELC extends this: else (no partition), you still trade latency against consistency, because stronger consistency needs coordination across replicas.

Examples: a CP system (etcd, ZooKeeper, a single-leader database with majority writes) refuses minority-side writes; an AP system (Cassandra and DynamoDB in eventual-consistency mode) keeps serving and reconciles later.

```text
Partition: CP -> minority side rejects writes
           AP -> both sides accept writes, reconcile later (conflicts!)
```

Pitfalls: treating CAP as a three-way menu or a permanent label; many systems are tunable per operation.

Interview tip: tie the choice to the business: payments need consistency; a like counter does not.

### Consistency models
<!-- level: advanced; ref: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html -->
Linearizability: operations appear to occur atomically in real-time order, the strongest and slowest. Sequential consistency keeps a single global order but not real-time constraints. Causal consistency preserves cause-and-effect order (replies after the messages they answer). Session guarantees (read-your-writes, monotonic reads, monotonic writes) give a single client a sane view. Eventual consistency promises only that replicas converge if writes stop.

Choose per use case: account balances and uniqueness constraints need strong consistency; timelines and counters tolerate eventual; collaborative edits often use causal ordering and CRDTs or operational transforms.

```python
# DynamoDB-style: choose per read
table.get_item(Key={"id": "42"}, ConsistentRead=True)   # strong, costs more
table.get_item(Key={"id": "42"})                        # eventually consistent
```

Pitfalls: assuming "eventual" means "soon"; unbounded staleness during incidents.

Interview tip: define each model with a one-line user-visible symptom.

### Conflict resolution: last-write-wins, vector clocks and CRDTs
<!-- level: advanced; ref: https://www.allthingsdistributed.com/2007/10/amazons_dynamo.html -->
Multi-leader and leaderless systems accept concurrent writes to the same item, so they need a conflict policy. Last-write-wins (LWW) keeps the highest timestamp: simple, but silently loses data and depends on clock quality. Version vectors (vector clocks) detect true concurrency so the application or user can merge siblings. CRDTs (conflict-free replicated data types) such as counters, sets and registers are designed so merges commute, giving convergence without coordination.

Practical choices: use CRDT counters for likes, add-wins sets for shopping carts, and avoid multi-leader for data with strong invariants. Hybrid logical clocks reduce reliance on wall-clock skew.

```text
Cart A: {milk}  Cart B: {eggs}   -> merge = union {milk, eggs}
Counter: node1=+3, node2=+2      -> value = 5 (G-counter per node)
```

Pitfalls: LWW with unsynchronised clocks; deleted items resurrecting without tombstones.

Interview tip: say that conflicts are better prevented by single-writer ownership than resolved.

### Distributed transactions, sagas and outbox
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/saga -->
Two-phase commit (2PC) gives atomic commits across databases, but it blocks if the coordinator fails and hurts availability, so it is rare across services. A saga breaks a business transaction into local transactions with compensating actions: reserve inventory, charge card, create shipment; if charging fails, release inventory. Sagas can be choreographed (services react to events) or orchestrated (a coordinator drives steps).

The transactional outbox pattern fixes dual-write problems: write business data and an outbox event in one local transaction, and a relay publishes outbox rows to the broker, giving at-least-once delivery. Consumers must be idempotent.

```sql
BEGIN;
INSERT INTO orders (id, status) VALUES (:id, 'PLACED');
INSERT INTO outbox (id, topic, payload) VALUES (:eid, 'order.placed', :json);
COMMIT;
```

Pitfalls: compensations that can themselves fail; invisible intermediate states; skipping idempotency.

Interview tip: say "no distributed transactions; sagas plus outbox plus idempotent consumers".

## 4. Queues and streaming

### Message queues and decoupling
<!-- level: basic; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling -->
A queue sits between producers and consumers so they scale and fail independently. It smooths bursts (queue-based load leveling): producers enqueue quickly while consumers drain at a sustainable rate. It enables asynchronous work such as emails, image processing and webhooks, and absorbs downstream outages.

Core mechanics: producers send messages; consumers receive, process and acknowledge; unacknowledged messages become visible again after a visibility timeout (SQS) or are redelivered (RabbitMQ). Failed messages beyond a retry limit go to a dead-letter queue for inspection.

```python
msg = queue.receive(wait=20, visibility_timeout=60)
try:
    handle(msg.body)
    queue.delete(msg)
except Exception:
    pass   # becomes visible again; DLQ after maxReceiveCount
```

Pitfalls: unbounded queue growth hiding a slow consumer; poison messages that block retries; ordering assumptions.

Interview tip: always name the backpressure story: what happens when consumers can't keep up.

### Delivery guarantees and idempotent consumers
<!-- level: intermediate; ref: https://kafka.apache.org/documentation/#semantics -->
At-most-once delivery may lose messages (ack before processing). At-least-once never loses but may duplicate (ack after processing, retry on failure); this is the common default. Exactly-once effects are achieved not by magic delivery but by combining at-least-once with idempotent processing or transactional writes; Kafka offers idempotent producers and transactions within its ecosystem, but end-to-end effects on external systems still need idempotency.

Make consumers idempotent by deduplicating on a message ID in a table with a unique constraint, using natural idempotent operations (set value, not increment), or conditional updates with version numbers.

```sql
INSERT INTO processed (message_id) VALUES (:id) ON CONFLICT DO NOTHING;
-- proceed only if one row was inserted, in the same transaction as the effect
```

Pitfalls: dedupe store and side effect in different transactions; assuming the broker's "exactly once" covers HTTP calls.

Interview tip: say "exactly-once is at-least-once plus idempotency".

### Kafka-style logs: partitions, consumer groups and ordering
<!-- level: intermediate; ref: https://kafka.apache.org/documentation/#intro_concepts_and_terms -->
A log-based broker such as Apache Kafka stores messages in append-only, partitioned, replicated logs retained by time or size rather than deleted on consumption. Producers choose a partition (usually by key hash), and ordering is guaranteed only within a partition. A consumer group splits partitions among its members, so parallelism is capped by partition count; each group tracks its own offsets, allowing many independent consumers and replay.

```bash
kafka-topics.sh --create --topic orders --partitions 12 --replication-factor 3
kafka-consumer-groups.sh --describe --group billing
```

Use the entity ID (order ID) as the key to keep that entity's events ordered. Rebalances pause consumption briefly; commit offsets after processing for at-least-once semantics.

Pitfalls: too few partitions to scale later (repartitioning breaks key ordering); hot keys; slow consumers triggering rebalance loops; unbounded consumer lag.

Interview tip: contrast with traditional queues: logs allow replay and multiple consumers; queues delete and focus on work distribution.

### Pub/sub, fan-out and event-driven design
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/publisher-subscriber -->
In publish-subscribe, a publisher emits events to a topic without knowing the subscribers; each subscriber receives its own copy. It decouples producers from consumers and supports fan-out (one order event drives email, analytics and inventory). Event-driven design lets services react to facts ("OrderPlaced") rather than being called with commands.

Design events as immutable facts with an ID, type, timestamp, version and enough data for consumers (or a reference to fetch it). Version schemas using a registry and make changes backward compatible, such as adding optional fields.

```json
{"id":"e-91","type":"order.placed","v":2,"ts":"2026-01-05T10:00:00Z",
 "data":{"orderId":"o-1","customerId":"c-7","total":4999}}
```

Pitfalls: hidden coupling through event contracts, event chains that nobody can trace end to end, and consumers depending on ordering across topics.

Interview tip: mention correlation IDs and distributed tracing across async hops.

### Backpressure, retries and dead-letter queues
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/azure/architecture/patterns/competing-consumers -->
Backpressure is how a system tells producers to slow down instead of collapsing: bounded queues that reject or block, rate limits, consumer-driven pull (consumers fetch at their own pace), and autoscaling consumers on queue depth or age of oldest message. Retries handle transient failures; use exponential backoff with jitter and a maximum attempts count. After that, send the message to a dead-letter queue (DLQ) with failure context, alert on DLQ depth, and provide a tool to inspect, fix and redrive.

Competing consumers let several workers read from one queue for parallelism, at the cost of ordering across messages.

```text
retry 1: 1s, retry 2: 2s, retry 3: 4s (each +- random jitter) -> DLQ
```

Pitfalls: infinite retries on a poison message; retrying non-idempotent operations; immediate retries amplifying overload.

Interview tip: the best autoscaling signal for consumers is age of the oldest message, not CPU.
