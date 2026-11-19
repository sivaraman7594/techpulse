## 5. Transactions, Isolation and Locking

### Transactions and ACID
<!-- level: basic; ref: https://www.postgresql.org/docs/current/tutorial-transactions.html -->
A transaction groups statements into one unit of work. ACID: Atomicity (all or nothing), Consistency (constraints hold before and after), Isolation (concurrent transactions do not see each other's partial work, to a configurable degree), Durability (committed data survives crashes, via the write-ahead log). Databases implement atomicity and durability with a log written before data pages.

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;   -- or ROLLBACK
```

PostgreSQL runs every statement in a transaction (autocommit wraps single statements) and an error aborts the transaction until rollback. SQL Server uses autocommit by default and needs `SET XACT_ABORT ON` so that runtime errors roll back the whole transaction.

Pitfalls:
- Long-held open transactions keep locks, bloat logs and block vacuum.
- Doing user interaction or remote calls inside a transaction.

Interview tip: give the bank transfer example and say what breaks without atomicity.

### Isolation levels and anomalies
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/transaction-iso.html -->
Isolation levels trade consistency for concurrency by allowing or preventing anomalies. Dirty read: seeing uncommitted data. Non-repeatable read: re-reading a row gives a different value. Phantom: re-running a range query returns new rows. Write skew: two transactions each read overlapping data and write different rows, together violating an invariant.

The SQL standard levels are Read Uncommitted, Read Committed, Repeatable Read and Serializable. PostgreSQL defaults to Read Committed, treats Read Uncommitted as Read Committed, and its Repeatable Read is snapshot isolation (prevents phantoms but allows write skew); Serializable adds predicate tracking and can abort with a serialisation failure that the application must retry. SQL Server defaults to Read Committed (locking, or row versioning when `READ_COMMITTED_SNAPSHOT` is on) and also offers Snapshot.

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;  -- PostgreSQL: inside the transaction
```

Pitfalls:
- Assuming higher levels never fail; serialisable requires retry logic.
- Using `NOLOCK` hints and reading uncommitted or duplicated data.

Interview tip: be ready to state which anomalies each level allows.

### MVCC versus lock-based concurrency
<!-- level: advanced; ref: https://www.postgresql.org/docs/current/mvcc-intro.html -->
Multiversion concurrency control keeps several versions of a row so readers see a consistent snapshot without blocking writers, and writers do not block readers. PostgreSQL stores new row versions in the heap and marks old ones dead; `VACUUM` later reclaims them, so long transactions delay cleanup and cause bloat. SQL Server's classic mode uses shared and exclusive locks, so readers and writers block each other; enabling `READ_COMMITTED_SNAPSHOT` or snapshot isolation uses row versions kept in `tempdb`.

```sql
ALTER DATABASE shop SET READ_COMMITTED_SNAPSHOT ON;  -- SQL Server
```

Writers still conflict with writers in both systems: the second update to the same row waits (or fails under snapshot isolation with an update conflict).

Pitfalls:
- Enabling row versioning without watching `tempdb` growth.
- Long-running snapshots holding back cleanup.

Interview tip: say why MVCC improves read concurrency and what it costs in storage maintenance.

### Locks, blocking and lock escalation
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide -->
Locks coordinate access. Shared locks are for reads and exclusive for writes, with intent locks at table and page level signalling finer locks below. Blocking occurs when a session waits for a lock another holds; it is normal briefly but a problem when transactions run long. SQL Server can escalate many row locks to a table lock (around 5,000 locks per statement), blocking everyone. PostgreSQL row locks live in the tuple, escalation does not occur, but DDL takes heavy table locks.

Find blockers with `sys.dm_tran_locks` and `sys.dm_exec_requests` in SQL Server, and `pg_locks` joined with `pg_stat_activity` in PostgreSQL.

```sql
SELECT pid, wait_event_type, wait_event, state, query
FROM pg_stat_activity WHERE wait_event_type = 'Lock';
```

Pitfalls:
- Missing indexes make updates lock and scan more rows than necessary.
- Running schema changes with long lock waits queued ahead of normal traffic; set `lock_timeout`.

Interview tip: describe your steps to find the head blocker.

### Deadlocks
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS -->
A deadlock happens when two transactions each hold a lock the other needs; neither can proceed. The database detects the cycle and kills one transaction as the victim (SQL Server error 1205, PostgreSQL `40P01`), which the application should retry.

Prevention: access objects in a consistent order, keep transactions short, avoid user interaction inside them, add indexes so statements lock fewer rows, use appropriate isolation (row versioning reduces reader-writer deadlocks), and acquire locks up front with `SELECT ... FOR UPDATE`.

```sql
-- Session A: UPDATE t SET x=1 WHERE id=1;  then UPDATE t SET x=1 WHERE id=2;
-- Session B: UPDATE t SET x=1 WHERE id=2;  then UPDATE t SET x=1 WHERE id=1;  -- deadlock
```

SQL Server's deadlock graph (extended events `xml_deadlock_report`) and PostgreSQL's log (`log_lock_waits`, deadlock messages) show the participants.

Pitfalls:
- Treating deadlocks as bugs to hide instead of retrying safely.
- Updating rows in different orders in different code paths.

Interview tip: say consistent ordering is the first fix.

### Optimistic and pessimistic concurrency, SKIP LOCKED
<!-- level: advanced; ref: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE -->
Pessimistic concurrency locks rows when reading with the intention to update: `SELECT ... FOR UPDATE` (PostgreSQL) or `WITH (UPDLOCK, ROWLOCK)` (SQL Server). Optimistic concurrency reads without locking and checks at write time that nothing changed, using a version column or timestamp (`rowversion` in SQL Server) in the WHERE clause; zero rows affected means a conflict to retry or report.

```sql
UPDATE products SET stock = stock - 1, version = version + 1
WHERE id = 5 AND version = 12;     -- check rows affected = 1
```

Work queues use `FOR UPDATE SKIP LOCKED` (PostgreSQL 9.5 and later; `READPAST` in SQL Server) so multiple workers claim different rows without waiting.

```sql
SELECT id FROM jobs WHERE status = 'new'
ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED;
```

Pitfalls:
- Read-then-write without any protection, giving lost updates.
- Pessimistic locks held while waiting on users.

Interview tip: pick optimistic for low contention and pessimistic for high contention.

## 6. Programmability, JSON and Maintenance

### Stored procedures and functions
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/sql/relational-databases/stored-procedures/stored-procedures-database-engine -->
A stored procedure is named, parameterised server-side code (T-SQL, or PL/pgSQL in PostgreSQL). Benefits: fewer round trips, centralised logic, permission control through `EXECUTE` grants, plan reuse. Functions return values and can be used inside queries: scalar functions, inline table-valued functions and multi-statement ones. In SQL Server prefer inline table-valued functions; multi-statement and (before SQL Server 2019 inlining) scalar functions can cripple parallelism and cardinality estimates. PostgreSQL 11 added procedures with `CALL` and transaction control.

```sql
CREATE PROCEDURE dbo.GetOrders @CustomerId int AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, total FROM dbo.Orders WHERE customer_id = @CustomerId;
END;
```

Pitfalls:
- Business logic split unpredictably between app and database.
- Catch-all procedures with optional parameters producing one bad plan.

Interview tip: contrast procedures, functions and views in terms of side effects and composability.

### Views, indexed views and materialised views
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/rules-materializedviews.html -->
A view is a stored query: it simplifies access and restricts columns, but stores no data and the optimiser expands it into the calling query. A materialised view stores the result: PostgreSQL's `CREATE MATERIALIZED VIEW` must be refreshed with `REFRESH MATERIALIZED VIEW [CONCURRENTLY]` (concurrent refresh needs a unique index). SQL Server's indexed view (a view with a unique clustered index, `WITH SCHEMABINDING`) is maintained automatically on every write, at write cost and with many restrictions.

```sql
CREATE MATERIALIZED VIEW daily_sales AS
SELECT date_trunc('day', paid_at) AS day, SUM(amount) AS total
FROM payments GROUP BY 1;
CREATE UNIQUE INDEX ON daily_sales (day);
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales;
```

Pitfalls:
- Stacked views many layers deep hiding expensive joins.
- Reading stale materialised data without telling users.

Interview tip: say when you would choose a materialised view versus caching in the application.

### Triggers
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/trigger-definition.html -->
A trigger runs automatically on `INSERT`, `UPDATE` or `DELETE`. Typical uses: audit logging, maintaining derived columns, enforcing cross-row rules. PostgreSQL has `BEFORE`, `AFTER` and `INSTEAD OF` (on views) triggers, row-level or statement-level, using `NEW` and `OLD`. SQL Server triggers are `AFTER` or `INSTEAD OF` and fire once per statement, exposing the `inserted` and `deleted` tables, so they must handle multi-row changes.

```sql
CREATE TRIGGER trg_audit ON dbo.Products AFTER UPDATE AS
INSERT INTO dbo.ProductAudit (product_id, old_price, new_price, changed_at)
SELECT d.id, d.price, i.price, SYSUTCDATETIME()
FROM deleted d JOIN inserted i ON i.id = d.id WHERE i.price <> d.price;
```

Pitfalls:
- Writing a SQL Server trigger as if it processes one row.
- Hidden side effects and cascading triggers that make behaviour hard to reason about and slow down bulk loads.

Interview tip: prefer constraints and explicit code over triggers when possible; use triggers for audit.

### JSON in SQL Server and PostgreSQL
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/datatype-json.html -->
Both engines can store and query JSON. PostgreSQL has `json` (text, preserved) and `jsonb` (binary, indexable, usually preferred) with operators `->`, `->>`, `@>` and the SQL/JSON path language; a GIN index accelerates containment queries. SQL Server stores JSON as `nvarchar` text (a native `json` type arrived in newer versions such as SQL Server 2025) and offers `JSON_VALUE`, `JSON_QUERY`, `OPENJSON` and `ISJSON`; index a computed column to make lookups fast.

```sql
-- PostgreSQL
SELECT payload->>'email' FROM events WHERE payload @> '{"type":"signup"}';
CREATE INDEX ON events USING gin (payload);
-- SQL Server
SELECT JSON_VALUE(payload, '$.email') FROM dbo.Events;
SELECT * FROM OPENJSON(@json) WITH (id int '$.id', name nvarchar(50) '$.name');
```

Use JSON for sparse or evolving attributes, not for core relational data that needs constraints and joins.

Pitfalls:
- Putting everything in one JSON column and losing integrity.
- Querying unindexed JSON paths at scale.

Interview tip: explain `json` versus `jsonb`.

### Upserts and MERGE
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT -->
An upsert inserts a row or updates it if it already exists. PostgreSQL uses `INSERT ... ON CONFLICT (key) DO UPDATE`, atomic and safe under concurrency; PostgreSQL 15 added the standard `MERGE`. SQL Server has `MERGE`, but it has a history of bugs and race conditions, so many teams prefer separate `UPDATE` then `INSERT` within a transaction using `HOLDLOCK`/`UPDLOCK` hints.

```sql
INSERT INTO inventory (sku, qty) VALUES ('A1', 5)
ON CONFLICT (sku) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty;
```

```sql
-- SQL Server
MERGE dbo.Inventory WITH (HOLDLOCK) AS t
USING (VALUES ('A1', 5)) AS s(sku, qty) ON t.sku = s.sku
WHEN MATCHED THEN UPDATE SET qty = t.qty + s.qty
WHEN NOT MATCHED THEN INSERT (sku, qty) VALUES (s.sku, s.qty);
```

Pitfalls:
- Check-then-insert in application code, which races and creates duplicates.
- MERGE without a unique key, causing errors or double matches.

Interview tip: say a unique constraint is what makes upserts safe.

### SQL injection and dynamic SQL
<!-- level: basic; ref: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html -->
SQL injection occurs when untrusted input is concatenated into SQL text, letting an attacker change the statement. The fix is parameterised queries: the statement and the values travel separately, so input is never parsed as code. Parameters cannot supply identifiers (table or column names); for those, validate against an allowlist and quote with `QUOTENAME` (SQL Server) or `format('%I', ...)` (PostgreSQL).

```sql
-- SQL Server
EXEC sp_executesql N'SELECT id FROM dbo.Users WHERE email = @e', N'@e nvarchar(200)', @e = @email;
-- Never: EXEC('SELECT id FROM Users WHERE email = ''' + @email + '''')
```

Also apply least privilege: the application account should not own the schema or have broad rights, and error messages should not leak details.

Pitfalls:
- Escaping by hand instead of parameterising.
- Parameterising values but concatenating `ORDER BY` columns from user input.

Interview tip: parameterised queries also let the database reuse plans.

## 7. Scaling, Tuning and Alternatives

### Pagination and keyset paging
<!-- level: intermediate; ref: https://use-the-index-luke.com/no-offset -->
OFFSET paging (`OFFSET 100000 LIMIT 20`) makes the database read and discard all skipped rows, so deep pages get slower, and concurrent inserts shift rows between pages. Keyset (seek) pagination remembers the last row's sort key and asks for rows after it, using an index, so cost is constant regardless of depth.

```sql
SELECT id, created_at, title
FROM posts
WHERE (created_at, id) < (:last_created_at, :last_id)
ORDER BY created_at DESC, id DESC
LIMIT 20;
-- supported by: CREATE INDEX ON posts (created_at DESC, id DESC);
```

Row-value comparison works in PostgreSQL; in SQL Server expand it as `created_at < @c OR (created_at = @c AND id < @i)`.

Pitfalls:
- Non-unique sort keys without a tiebreaker.
- Keyset paging cannot jump to an arbitrary page number.

Interview tip: say why OFFSET is O(n) and keyset is index-seek based.

### Bulk loading and batch operations
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/populate.html -->
Row-by-row inserts from an application are slow because of round trips and per-statement overhead. Use bulk paths: `COPY` in PostgreSQL, `BULK INSERT`, `bcp` or `SqlBulkCopy` in SQL Server, which can be minimally logged under suitable recovery model and table conditions. Batch inserts with multi-row `VALUES`. Disable or drop non-essential indexes and constraints during huge loads, load into a staging table, then validate and merge. Update or delete large sets in batches (for example 5,000 to 50,000 rows) to limit lock duration and log growth.

```sql
COPY orders (id, customer_id, total) FROM '/data/orders.csv' WITH (FORMAT csv, HEADER true);
```

```sql
-- SQL Server batched delete
WHILE 1 = 1 BEGIN
  DELETE TOP (10000) FROM dbo.Log WHERE logged_at < DATEADD(DAY, -90, SYSUTCDATETIME());
  IF @@ROWCOUNT = 0 BREAK;
END
```

Pitfalls:
- One giant transaction that fills the log and blocks others.
- Forgetting to rebuild indexes or update statistics afterwards.

Interview tip: mention staging tables and batch sizes.

### Table partitioning
<!-- level: advanced; ref: https://www.postgresql.org/docs/current/ddl-partitioning.html -->
Partitioning splits a large table into smaller physical pieces by a key, commonly time ranges. Benefits: partition pruning (queries touching one month read one partition), fast data retirement (drop or detach a partition instead of a huge `DELETE`), and manageable maintenance. PostgreSQL uses declarative partitioning (range, list, hash) since version 10; SQL Server uses a partition function and scheme (available in all editions since SQL Server 2016 SP1).

```sql
CREATE TABLE events (id bigint, created_at timestamptz NOT NULL, payload jsonb)
PARTITION BY RANGE (created_at);
CREATE TABLE events_2026_11 PARTITION OF events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
```

Primary and unique keys must include the partition key. Queries must filter on the partition key to benefit.

Pitfalls:
- Thousands of tiny partitions slowing planning.
- Expecting partitioning to speed queries that do not filter on the key; it is mainly a manageability tool.

Interview tip: contrast partitioning (one server) with sharding (many servers).

### Replication and high availability
<!-- level: advanced; ref: https://www.postgresql.org/docs/current/high-availability.html -->
Replication copies changes to other servers for availability and read scaling. PostgreSQL streaming replication ships the write-ahead log to physical standbys (hot standbys can serve reads), and logical replication publishes row changes per table, enabling selective copies and version upgrades. SQL Server offers Always On availability groups (replicas with synchronous or asynchronous commit), log shipping, and transactional replication.

Synchronous replication guarantees no committed data loss on failover but adds commit latency; asynchronous is faster but can lose recent transactions and serve slightly stale reads (replication lag). Automatic failover needs a coordinator and fencing to avoid two primaries (split brain).

```sql
SELECT now() - pg_last_xact_replay_timestamp() AS replica_lag;   -- on a standby
```

Pitfalls:
- Reading your own writes from a lagging replica.
- Treating replicas as backups: a bad delete replicates instantly. Keep point-in-time recovery backups.

Interview tip: define RPO and RTO and map them to sync versus async choices.

### Relational versus NoSQL
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/azure/architecture/data-guide/technology-choices/understand-data-store-models -->
Relational databases give a rich query language, joins, constraints and ACID transactions, with schema enforced up front. NoSQL families trade some of that for scale or flexibility: key-value stores for fast lookups and caching, document stores for self-contained aggregates with flexible schema, wide-column stores for massive write-heavy time-ordered data, graph databases for relationship traversals, and search engines for text relevance.

Choose by access patterns, consistency needs and scale. The CAP theorem says that during a network partition a distributed system must choose between consistency and availability; many NoSQL systems default to availability with eventual consistency, though most offer tunable settings, and modern relational and distributed SQL systems also scale out. Note that PostgreSQL's `jsonb` and SQL Server JSON cover many document-style needs inside a relational engine.

Pitfalls:
- Choosing NoSQL for fashion and then reimplementing joins and transactions in application code.
- Ignoring that a single well-tuned relational server handles very large workloads.

Interview tip: justify the choice from query patterns, not technology preference.

### Systematic query tuning
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/performance-tips.html -->
Tune with a method: find the worst queries by total time (not just single slow runs) using `pg_stat_statements` in PostgreSQL or Query Store and DMVs in SQL Server; capture the plan and actual row counts; compare estimates with actuals; then fix the largest cost. Typical fixes in order: make predicates sargable, add or adjust an index (composite order, covering), update statistics, rewrite the query (avoid `SELECT *`, reduce row counts early, replace correlated or row-by-row patterns with set-based logic), then consider schema or caching changes. Change one thing and measure again.

```sql
SELECT query, calls, total_exec_time, mean_exec_time
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```

Pitfalls:
- Tuning on tiny development data that hides the plan problem.
- Fixing with hints before understanding the cause; hints freeze plans that later become wrong.

Interview tip: walk through the sequence out loud: find, measure, diagnose, change, verify.
