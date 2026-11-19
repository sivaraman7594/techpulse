### Your application logs deadlock errors a few times a day. How do you find the cause and stop them?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS -->
Observe: capture the deadlock details. SQL Server: the `xml_deadlock_report` extended event (or system_health session) gives the deadlock graph with both statements and the locked resources. PostgreSQL: the server log prints the processes, queries and locks involved.

Hypothesise: two code paths touch the same rows or tables in opposite order; a missing index makes an update lock more rows than needed; a reader and writer collide under locking-based read committed; long transactions widen the window.

Verify: map each statement in the graph to application code; check the plans for scans; list the order of table access in both transactions.

Fix: access tables and rows in one consistent order, shorten transactions, add the index that lets the statements seek, consider row versioning (`READ_COMMITTED_SNAPSHOT`) for reader-writer cycles, and lock up front with `SELECT ... FOR UPDATE` where appropriate. Add retry logic for error 1205 or `40P01`.

Prevent: keep transactions short, code review for lock ordering, load tests with concurrency.

Wrong answer: catching the error and ignoring it, or using `NOLOCK` everywhere, which trades deadlocks for wrong data.

### A report using a LEFT JOIN returns fewer rows than expected customers. What went wrong?
<!-- level: basic; kind: scenario; ref: https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-JOIN -->
Observe: customers without orders are missing from the result even though the query uses LEFT JOIN.

Hypothesise: a filter on the right table sits in the WHERE clause (`WHERE o.status = 'paid'`), which rejects the NULL-extended rows and turns the outer join into an inner join.

Verify: remove the WHERE condition and see the customers reappear; check the plan, where the optimiser may have converted the join to inner.

Fix: move the right-table condition into the ON clause so unmatched left rows survive.

```sql
SELECT c.id, COUNT(o.id) AS paid_orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
GROUP BY c.id;
```

If you only want customers having a paid order, an inner join or `EXISTS` states that intent honestly.

Prevent: review outer joins for WHERE conditions on the optional side, and add a test with a customer who has no orders.

Wrong answer: switching to RIGHT JOIN or FULL JOIN randomly until the count looks right.

### `WHERE id NOT IN (SELECT ...)` returns no rows even though you know unmatched rows exist. Why?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/functions-subquery.html -->
Observe: the query returns an empty set; the inverted `IN` query returns rows.

Hypothesise: the subquery returns at least one NULL. `x NOT IN (1, NULL)` evaluates to UNKNOWN for every x not equal to 1, so no row qualifies.

Verify: `SELECT COUNT(*) FROM child WHERE parent_id IS NULL`, or add `WHERE col IS NOT NULL` to the subquery and watch the rows appear.

Fix: use `NOT EXISTS`, whose semantics are not poisoned by NULLs, and usually produces an efficient anti-join.

```sql
SELECT c.id FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);
```

Alternatively `LEFT JOIN ... WHERE o.id IS NULL`.

Prevent: make the column `NOT NULL` where it should be, and standardise on `NOT EXISTS` for negative membership.

Wrong answer: "the data is wrong, delete the NULLs" without considering whether NULL is meaningful, or adding `ISNULL(col, 0)` which can create false matches.

### A query that used an index became slow after a developer wrapped the column in a function. How do you explain and fix it?
<!-- level: basic; kind: scenario; ref: https://use-the-index-luke.com/sql/where-clause/obfuscation -->
Observe: the plan changed from an index seek to a scan; query is `WHERE YEAR(created_at) = 2026` or `WHERE LOWER(email) = ...`.

Hypothesise: the predicate is no longer sargable. The index stores raw `created_at` values, so the engine must evaluate the function for every row.

Verify: compare plans before and after, and read logical reads (`SET STATISTICS IO ON`) or `EXPLAIN (ANALYZE, BUFFERS)`.

Fix: rewrite so the column is bare: `created_at >= '2026-01-01' AND created_at < '2027-01-01'`. For case-insensitive lookups use a case-insensitive collation in SQL Server, or in PostgreSQL create an expression index `CREATE INDEX ON users (lower(email))` and query with `lower(email)`; the citext extension is another option. In SQL Server a persisted computed column can be indexed.

Prevent: code review checklist for functions on indexed columns, and test with production-size data.

Wrong answer: adding more indexes on the same column. They cannot be used either, because the expression differs.

### A stored procedure is fast for most customers but times out for a few. Diagnose it.
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/sql/relational-databases/query-processing-architecture-guide#parameter-sensitivity -->
Observe: same procedure, different parameters, huge duration differences; the slow cases involve customers with many rows.

Hypothesise: parameter sniffing. The cached plan was compiled for a parameter with few rows (nested loops and seeks) and is reused for a large customer where a hash join or scan would be better, or the reverse.

Verify: in Query Store compare plans per parameter and see plan regressions; get the actual plan with the slow parameter and compare estimated versus actual rows; check the compiled parameter values in the plan XML.

Fix: options by situation: `OPTION (RECOMPILE)` for infrequent, high-variance queries; `OPTIMIZE FOR UNKNOWN` or a specific representative value; split the procedure into branches for small and large cases; update statistics; in newer versions consider Parameter Sensitive Plan optimisation (SQL Server 2022, compatibility level 160) or Query Store plan forcing as a stopgap. In PostgreSQL, prepared statements can choose a generic plan; `plan_cache_mode = force_custom_plan` may help.

Prevent: monitor with Query Store and test with skewed parameters.

Wrong answer: clearing the whole plan cache periodically.

### Page 5,000 of a paginated list takes seconds while page 1 is instant. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://use-the-index-luke.com/no-offset -->
Observe: latency grows linearly with page number.

Hypothesise: `OFFSET n` has to produce and discard n rows, and a sort may be needed if the ORDER BY has no index.

Verify: look at the plan: rows read at the sort or index scan equals offset plus limit.

Fix: switch to keyset pagination: pass the last seen sort key and use an index to continue.

```sql
SELECT id, created_at, title FROM posts
WHERE (created_at, id) < (:last_created_at, :last_id)
ORDER BY created_at DESC, id DESC LIMIT 20;
```

Support it with an index on `(created_at DESC, id DESC)`. Unique tiebreaker prevents skipped or repeated rows. If users must jump to arbitrary pages, limit depth, add filters, or use a search engine.

Prevent: set a maximum offset in the API and load test deep pages.

Wrong answer: adding more RAM, or caching every page when the data changes constantly. Another wrong answer is paging without a deterministic ORDER BY, which gives inconsistent pages.

### Product wants the top 3 orders per customer. How do you write and tune it?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/tutorial-window.html -->
Observe: the table has tens of millions of rows; a naive correlated subquery is slow.

Hypothesise: a window function with `ROW_NUMBER()` partitioned by customer solves it in one pass, but sorts everything.

Fix: with window functions:

```sql
SELECT * FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY total DESC, id) AS rn
  FROM orders o) x
WHERE rn <= 3;
```

Index `(customer_id, total DESC)` lets the engine avoid a full sort. If you need it for a small set of customers, `CROSS APPLY` (SQL Server) or `LATERAL` (PostgreSQL) with `TOP 3`/`LIMIT 3` seeks per customer and is often faster.

Verify: compare plans and runtime of both forms; check the tie-breaking requirement (use `RANK` or `DENSE_RANK` only if ties should all be returned).

Prevent: document tie rules and add tests with equal totals.

Wrong answer: `GROUP BY customer_id` with `MAX`, which cannot return the other columns of the top rows, or fetching all rows and filtering in the application.

### You must delete 80% of a 500-million-row log table without freezing production. What is your plan?
<!-- level: advanced; kind: scenario; ref: https://www.postgresql.org/docs/current/ddl-partitioning.html -->
Observe: a single `DELETE` would hold locks for hours, generate a huge transaction log and may escalate to a table lock, then take as long to roll back if it fails.

Hypothesise: the table is not partitioned by date, so deletion is the only retirement mechanism.

Fix: depends on the data layout. Best: if partitioned by time, drop or detach old partitions, which is instant. Otherwise, either copy the 20% to keep into a new table (`INSERT ... SELECT` or `CTAS`), rebuild indexes, then swap names in a short transaction; or delete in small batches (for example 10,000 rows) with a pause, committing each, ordered by an indexed column, monitoring log growth and replication lag. In PostgreSQL run `VACUUM` afterwards; in SQL Server consider log backups between batches.

Verify: test the batch size on staging and monitor blocking.

Prevent: partition by time and define a retention job from the beginning.

Wrong answer: one giant DELETE in a transaction, or `TRUNCATE` when you need to keep part of the data.

### Every morning at 9:00 the application freezes for a minute. How do you investigate blocking?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/monitoring-stats.html -->
Observe: during the freeze, list sessions that are waiting and what they wait for. SQL Server: `sys.dm_exec_requests` (`blocking_session_id`), `sys.dm_os_waiting_tasks`. PostgreSQL: `pg_stat_activity` with `pg_blocking_pids(pid)`.

Hypothesise: a scheduled job or report holds locks for long (a batch update in one transaction, an index rebuild, a long-running read under locking isolation); lock escalation to table level; an idle-in-transaction session.

Verify: find the head blocker and its statement and start time; correlate with the job scheduler; check the number of rows it touches and whether the plan scans.

```sql
SELECT pid, pg_blocking_pids(pid) AS blocked_by, wait_event_type, state, query
FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;
```

Fix: batch the job into short transactions, move it off peak, add the missing index, use row versioning for readers, set `lock_timeout` for DDL, and fix applications that leave transactions open.

Prevent: alert on long transactions and blocked sessions.

Wrong answer: killing sessions each morning without addressing the cause.

### Two users buy the last item at the same time and stock goes negative. How do you prevent it?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/transaction-iso.html -->
Observe: the code reads stock, checks it in the application, then writes `stock = newValue`; under concurrency both read 1.

Hypothesise: lost update / check-then-act race in read committed isolation.

Verify: reproduce with two concurrent sessions or a stress test.

Fix: make the check and update a single atomic statement and verify the affected row count:

```sql
UPDATE products SET stock = stock - 1 WHERE id = 5 AND stock > 0;
-- rows affected = 0 means sold out
```

Additionally add `CHECK (stock >= 0)` as a safety net. Alternatives: `SELECT ... FOR UPDATE` (PostgreSQL) or `UPDLOCK` (SQL Server) inside the transaction; optimistic concurrency with a version column; serializable isolation with retry.

Prevent: concurrency tests in CI and invariants in constraints.

Wrong answer: application-level locks or `synchronized` in one server, which fail with multiple instances, or relying on a higher isolation level without checking how it handles this pattern.

### You must add a NOT NULL column with a default to a 300-million-row table on a live system. How do you do it safely?
<!-- level: advanced; kind: scenario; ref: https://www.postgresql.org/docs/current/sql-altertable.html -->
Observe: on older versions this rewrites the table under an exclusive lock.

Hypothesise: PostgreSQL 11 and later add a column with a constant default as metadata-only, so it is instant; volatile defaults (like `random()`) still rewrite. SQL Server 2012 Enterprise and later (and all editions in recent versions) make adding a NOT NULL column with a constant default a metadata operation; older or non-constant cases rewrite.

Verify: test on a copy with similar size; watch lock waits and duration; check version and edition.

Fix: for metadata-only cases run directly with a short `lock_timeout`, so the DDL fails rather than queuing and blocking all traffic. Otherwise add the column as nullable, backfill in batches, add a `CHECK (col IS NOT NULL) NOT VALID` then `VALIDATE CONSTRAINT` (PostgreSQL), then set NOT NULL. Deploy application changes in compatible steps: expand, migrate, contract.

Prevent: a migration review process and staging tests at production size.

Wrong answer: running `ALTER TABLE` in the peak hour and hoping.

### Soft-deleted users block registering the same email again. How do you fix the uniqueness rule?
<!-- level: basic; kind: scenario; ref: https://www.postgresql.org/docs/current/indexes-partial.html -->
Observe: a unique constraint on `email` rejects a new account whose previous owner was soft deleted.

Hypothesise: the constraint covers all rows, including those marked deleted.

Fix: enforce uniqueness only among active rows with a partial (PostgreSQL) or filtered (SQL Server) unique index.

```sql
CREATE UNIQUE INDEX uq_users_email_active ON users (email) WHERE deleted_at IS NULL;
```

Verify: insert a duplicate email for an active user (fails) and for a deleted one (succeeds). Ensure queries filter on `deleted_at IS NULL` so the index is usable.

Prevent: decide the soft-delete policy up front: whether emails are reusable, how privacy deletion works, and how restoring a deleted user handles conflicts.

Wrong answer: appending random suffixes to deleted emails (loses information) or dropping the unique constraint, allowing duplicates among active users.

### You created an index but the query still does a full table scan. Why?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/indexes-examine.html -->
Observe: the plan shows a sequential or clustered index scan.

Hypothesise: the predicate is not sargable (function on column, leading wildcard, implicit type conversion); the column order in a composite index does not match; the predicate is not selective so a scan is cheaper; statistics are stale; the index is partial or filtered and the query does not imply its predicate; the table is small.

Verify: check the plan's predicate and warnings; compare data types of column and parameter; look at `pg_stat_user_indexes` (idx_scan) or SQL Server index usage DMVs; run `ANALYZE` or `UPDATE STATISTICS` and re-check; test with an index hint or `SET enable_seqscan = off` only as a diagnostic.

Fix: rewrite the predicate, align types, reorder or add columns, or accept the scan if the filter returns a large share of rows.

Prevent: review plans with realistic data volumes, and drop unused indexes.

Wrong answer: forcing the index with a hint permanently; if a scan really is cheaper, the hint makes it worse.

### Users read stale data right after saving. The application uses a read replica. What is happening?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/warm-standby.html -->
Observe: after an update, the next page load sometimes shows old values and later shows the new ones.

Hypothesise: asynchronous replication lag: the read goes to a replica that has not yet applied the write.

Verify: measure lag (`pg_last_xact_replay_timestamp()` on a PostgreSQL standby, availability group dashboards or DMVs in SQL Server); reproduce by reading immediately after writing.

Fix: route reads that must see the user's own writes to the primary (read-your-writes), or stick a session to the primary for a short period after a write, or wait until the replica has replayed a given log position (LSN) before reading. Use synchronous replication only where the latency cost is acceptable. Set expectations: replicas are for scalable reads that tolerate staleness.

Prevent: monitor and alert on lag, and classify queries by freshness needs.

Wrong answer: "caching issue" without measuring, or sending all traffic to the primary and losing the benefit of replicas.

### A total revenue report gives numbers far higher than the finance system. What do you check?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/queries-table-expressions.html -->
Observe: sums are inflated by a multiple that varies by order.

Hypothesise: a join fan-out. Joining orders to a one-to-many table (items, payments, shipments) repeats the order total on each child row; summing the repeated value overstates it.

Verify: compare `COUNT(*)` with `COUNT(DISTINCT order_id)` after the join; check the cardinality of each join key; test one order by hand.

Fix: aggregate each many-side table to the grain of the order before joining, or sum at the correct grain.

```sql
SELECT o.id, o.total, p.paid
FROM orders o
LEFT JOIN (SELECT order_id, SUM(amount) AS paid FROM payments GROUP BY order_id) p
  ON p.order_id = o.id;
```

Prevent: state the grain of every query, add reconciliation tests against a trusted total, and be suspicious of joins that increase the row count.

Wrong answer: `SUM(DISTINCT total)`, which also drops legitimately equal values from different orders.

### The SQL Server transaction log filled the disk and the database stopped accepting writes. What now?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/sql/relational-databases/logs/the-transaction-log-sql-server -->
Observe: error 9002; check `sys.databases.log_reuse_wait_desc` to see why the log cannot be truncated.

Hypothesise: common reasons are `LOG_BACKUP` (full recovery model with no log backups), `ACTIVE_TRANSACTION` (a long open transaction), `REPLICATION` or `AVAILABILITY_REPLICA` (replica behind), or a huge batch operation.

Verify: `DBCC OPENTRAN`, the database's recovery model and last log backup time, and replica status.

Fix: immediate relief by freeing disk or adding a log file temporarily. Take a log backup so space can be reused. Resolve the blocking reason (commit or kill the runaway transaction, fix the lagging replica). Do not shrink repeatedly; right-size the log and set a sensible growth increment.

Prevent: schedule frequent log backups in full recovery, alert on log usage and long transactions, batch big modifications.

Wrong answer: switching to simple recovery on a production system that needs point-in-time recovery, or deleting the log file.

### A busy PostgreSQL table is huge and queries are slowing even though row count is stable. What is going on?
<!-- level: advanced; kind: scenario; ref: https://www.postgresql.org/docs/current/routine-vacuuming.html -->
Observe: table and index sizes grow while live rows stay flat; sequential scans read more pages.

Hypothesise: bloat from dead tuples because autovacuum cannot keep up or is blocked: long-running transactions or idle-in-transaction sessions, abandoned replication slots, or autovacuum thresholds too lax for a high-churn table.

Verify: `pg_stat_user_tables` (`n_dead_tup`, `last_autovacuum`); estimate bloat with the `pgstattuple` extension; find old transactions in `pg_stat_activity`; check `pg_replication_slots`.

Fix: end or fix the old transactions; tune per-table autovacuum (`autovacuum_vacuum_scale_factor`, cost limits) for hot tables; run `VACUUM`; for severe bloat use `pg_repack` or `VACUUM FULL` (exclusive lock) in a window; rebuild indexes with `REINDEX CONCURRENTLY`.

Prevent: monitor dead tuple ratio and transaction age, and use HOT-friendly designs with fillfactor for update-heavy tables.

Wrong answer: disabling autovacuum to reduce load.

### A query filtering a JSON event payload got slow as the table grew to 100 million rows. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/datatype-json.html#JSON-INDEXING -->
Observe: `WHERE payload->>'type' = 'signup'` scans the whole table.

Hypothesise: no index supports the JSON path; each row's JSON must be parsed.

Verify: the plan shows a sequential scan with a filter on the JSON expression.

Fix: PostgreSQL: use `jsonb`, then either a GIN index (`USING gin (payload jsonb_path_ops)` for containment queries `payload @> '{"type":"signup"}'`) or a B-tree expression index on the specific key (`CREATE INDEX ON events ((payload->>'type'))`). SQL Server: add a persisted computed column over `JSON_VALUE(payload, '$.type')` and index it. If a field is queried constantly or needs constraints, promote it to a real column.

Prevent: decide which attributes are core (columns) versus optional (JSON), and test queries at scale.

Wrong answer: indexing the entire JSON column with a plain B-tree, or loading everything into the application to filter.

### Find users who logged in on at least 5 consecutive days. How do you solve it?
<!-- level: advanced; kind: scenario; ref: https://www.postgresql.org/docs/current/functions-window.html -->
Observe: a gaps-and-islands problem: consecutive dates form islands; breaks create gaps.

Hypothesise: subtracting a row number from the date gives a constant for each run of consecutive days.

Fix: deduplicate to one row per user per day, number the rows, and group on the difference.

```sql
WITH d AS (
  SELECT DISTINCT user_id, login_date::date AS day FROM logins
), g AS (
  SELECT user_id, day,
         day - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY day))::int AS grp
  FROM d
)
SELECT user_id, MIN(day) AS start_day, COUNT(*) AS streak
FROM g GROUP BY user_id, grp HAVING COUNT(*) >= 5;
```

In SQL Server use `DATEADD(DAY, -ROW_NUMBER() OVER (...), day)` for the group key.

Verify: test with duplicates in a day, gaps and a user with two separate streaks.

Prevent: index `(user_id, login_date)` for the sort.

Wrong answer: a self join per day offset, which does not scale, or forgetting `DISTINCT` so duplicates inflate the streak.

### Two workers sometimes process the same job from a table-based queue. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE -->
Observe: duplicate side effects, such as double emails.

Hypothesis: the workers `SELECT` pending rows and then `UPDATE` them to in-progress as separate steps, so both pick the same row.

Verify: add worker id and timestamps and look for the same job claimed twice.

Fix: claim atomically. PostgreSQL:

```sql
UPDATE jobs SET status = 'running', worker = :w
WHERE id IN (
  SELECT id FROM jobs WHERE status = 'new'
  ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED)
RETURNING id;
```

In SQL Server use `UPDATE TOP (10) ... WITH (ROWLOCK, READPAST, UPDLOCK)` with `OUTPUT`. Index on `(status, id)`. Handle crashed workers with a visibility timeout and heartbeat. Make job handlers idempotent anyway, as delivery is at least once.

Prevent: concurrency tests with many workers.

Wrong answer: using only application-level locking, or relying on a high isolation level without a claim step. For high volume consider a real message broker.

### A security scan reports SQL injection in a search endpoint. How do you fix it properly?
<!-- level: basic; kind: scenario; ref: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html -->
Observe: the code builds `"... WHERE name LIKE '%" + term + "%'"`; input such as `' OR 1=1 --` changes the logic.

Hypothesise: string concatenation of untrusted input into SQL text.

Verify: reproduce safely in a test environment, review all places building SQL dynamically, including ORDER BY and column names.

Fix: use parameterised queries or prepared statements for values: the `LIKE` pattern is passed as a parameter (`'%' + term + '%'` built in code, or concatenated in SQL from the parameter). For dynamic identifiers such as sort columns, map user choices to an allowlist of known column names. Use least-privilege database accounts, with no DDL or access to unrelated tables, and avoid revealing database errors to clients. Escape wildcards deliberately if literal matching is needed.

Prevent: static analysis rules, ORM usage with parameter binding, security tests, and review of any dynamic SQL.

Wrong answer: blacklisting words like `DROP` or escaping quotes by hand, both easily bypassed.

### The application runs out of database connections during traffic peaks. What do you check?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/runtime-config-connection.html -->
Observe: errors such as "too many clients" or pool timeouts; check how many connections exist and their state.

Hypothesise: sessions stuck `idle in transaction`, slow queries holding connections, leaks (connections not returned), pool size times application instances above the server limit, or a thundering herd after a restart.

Verify: `SELECT state, count(*) FROM pg_stat_activity GROUP BY state;` or `sys.dm_exec_sessions` in SQL Server; look at the longest transactions and what they run.

Fix: close or commit transactions promptly, return connections in `finally` blocks, size pools deliberately (a database usually performs best with a connection count near a small multiple of CPU cores), add a pooler such as PgBouncer for PostgreSQL, set statement and idle-in-transaction timeouts, and fix the slow queries that hold connections.

Prevent: monitor pool utilisation and wait time, and load test.

Wrong answer: raising `max_connections` to thousands; memory use and context switching can make the database slower.

### Adding an index on a busy production table blocked writes. How should you create indexes safely?
<!-- level: intermediate; kind: scenario; ref: https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY -->
Observe: a plain `CREATE INDEX` in PostgreSQL blocks writes to the table for the whole build; in SQL Server an offline build takes locks too.

Hypothesise: the operation was run in a normal transaction at peak load.

Fix: PostgreSQL: `CREATE INDEX CONCURRENTLY`, which avoids blocking writes but takes longer, cannot run inside a transaction block, and can leave an invalid index if it fails (drop and retry). SQL Server: `WITH (ONLINE = ON)` on editions that support it, with `RESUMABLE = ON` for large builds in newer versions. Run during low traffic, monitor progress and I/O, set `lock_timeout` for the brief metadata lock, and verify the index is valid and used after building.

Prevent: include index creation in a reviewed migration process and test duration on a production-sized copy.

Wrong answer: creating several indexes in parallel at peak, or killing the build midway without checking for an invalid leftover index.

### Dashboard queries over 2 billion fact rows take minutes. What are your options?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/sql/relational-databases/indexes/columnstore-indexes-overview -->
Observe: queries scan and aggregate huge volumes by a few dimensions; row-store pages contain many unused columns.

Hypothesise: an OLTP-shaped schema is serving analytical scans; no pre-aggregation; no partition pruning.

Verify: check the plan's rows read versus rows returned, and the column count actually used.

Fix: choose by platform and need. SQL Server: clustered columnstore index, which compresses and reads only needed columns, plus partitioning by date. PostgreSQL: partition by time, use BRIN for ordered data, summary tables or materialised views refreshed on a schedule, or an extension or a dedicated analytical store. Model data as a star schema with narrow facts and conformed dimensions. Pre-aggregate common rollups.

Prevent: separate analytical workload from transactional, set refresh and freshness expectations with users.

Wrong answer: adding B-tree indexes on every dimension column, which barely helps scans of large fractions and hurts loads.

### The execution plan warns about implicit conversion and a seek became a scan. What happened?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/sql/t-sql/data-types/data-type-precedence-transact-sql -->
Observe: SQL Server plan shows `CONVERT_IMPLICIT` on the column side, with a scan instead of a seek.

Hypothesise: data type precedence made the engine convert the column to match the parameter: for example a `varchar` column compared with an `nvarchar` parameter (common with ORMs sending Unicode strings), or `int` column versus `bigint`.

Verify: compare the column definition with the parameter types in the plan XML; check the warning in the plan.

Fix: pass parameters with the same type as the column (for example set the parameter type to `varchar(50)` in the data access layer, or configure the ORM to map to non-Unicode), or change the column type if Unicode is truly needed. Avoid converting the column side in expressions.

Prevent: schema-aware parameter typing in the application, query store monitoring for plan warnings.

Wrong answer: adding another index, which cannot be seeked either, or recompiling the plan repeatedly. In PostgreSQL the analogous problem occurs with casts such as `col::text = ...`, solved the same way: keep column types aligned with comparison values.

### A migration to split a table into two must happen with zero downtime. How do you approach it?
<!-- level: advanced; kind: scenario; ref: https://martinfowler.com/bliki/ParallelChange.html -->
Observe: multiple application versions run during a rolling deploy, so the schema must support both old and new code at once.

Hypothesise: a one-step rename or split would break old instances or block on locks.

Fix: use the expand-and-contract (parallel change) pattern. Expand: create the new table, add triggers or dual writes so changes flow to both. Backfill historical rows in batches with throttling. Verify: compare counts and checksums, shadow reads. Migrate: switch reads to the new table behind a feature flag. Contract: stop writing the old structure, then drop it in a later release after a safe period. Each step is individually reversible.

Prevent: rehearse on production-sized data, define rollback points, and monitor errors, lag and lock waits during each step.

Wrong answer: a single big-bang migration script run during deployment with an exclusive lock, or relying on a maintenance window for a table that takes hours to copy.
