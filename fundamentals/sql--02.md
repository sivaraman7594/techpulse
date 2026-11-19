## 3. Schema Design and Constraints

### Choosing data types
<!-- level: basic; ref: https://www.postgresql.org/docs/current/datatype.html -->
The right type saves space, speeds comparisons and prevents bad data. Use exact types for money: `NUMERIC(p,s)` in PostgreSQL, `DECIMAL(p,s)` in SQL Server; never `FLOAT`, whose binary rounding breaks equality and sums. Store dates in date types, not strings: `date`, `timestamptz` (PostgreSQL), `datetime2` and `datetimeoffset` (SQL Server). Prefer `integer` or `bigint` keys sized to expected growth. Text: PostgreSQL `text` and `varchar(n)` perform the same; SQL Server `varchar` is single-byte code-page data and `nvarchar` is Unicode (twice the storage). `uuid` keys avoid central counters but are larger and, if random, fragment indexes.

```sql
CREATE TABLE payments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  amount     numeric(12,2) NOT NULL,
  paid_at    timestamptz   NOT NULL DEFAULT now()
);
```

Pitfalls:
- Storing timestamps without time zone and then mixing zones.
- Oversized `nvarchar(max)` columns that cannot be indexed or are slower.

Interview tip: explain why `FLOAT` is unacceptable for currency.

### Primary keys, surrogate versus natural keys
<!-- level: basic; ref: https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-PRIMARY-KEYS -->
A primary key uniquely identifies each row, cannot be NULL, and gets a unique index automatically. A natural key is real-world data (email, ISBN, national id); a surrogate key is a meaningless generated value (identity, sequence, UUID). Surrogates are stable, compact and good for foreign keys; natural keys can change, collide or be reused. Most designs use a surrogate primary key and enforce the natural key with a `UNIQUE` constraint.

```sql
CREATE TABLE customers (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- SQL Server: bigint IDENTITY(1,1)
  email text NOT NULL UNIQUE
);
```

In SQL Server, the primary key creates a clustered index by default, so a wide or random key (such as a non-sequential GUID) makes every nonclustered index larger and inserts scatter across pages.

Pitfalls:
- Composite natural keys copied into every child table.
- Identity gaps are normal after rollbacks; never rely on gap-free numbering.

Interview tip: say you enforce uniqueness of business keys separately from the surrogate.

### Foreign keys and referential actions
<!-- level: basic; ref: https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK -->
A foreign key guarantees that a child row's value exists in the parent table, enforcing referential integrity in the database rather than hoping every application obeys. Referential actions define what happens when the parent changes: `NO ACTION`/`RESTRICT` blocks, `CASCADE` propagates delete or update, `SET NULL` and `SET DEFAULT` clear the reference.

```sql
CREATE TABLE order_items (
  order_id   bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products(id),
  qty        int    NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, product_id)
);
CREATE INDEX ON order_items (product_id);   -- FK columns are not indexed automatically
```

PostgreSQL and SQL Server do not automatically index the referencing column, so unindexed foreign keys make parent deletes and joins slow.

Pitfalls:
- Cascades that delete far more than intended or create multiple-cascade-path errors in SQL Server.
- Dropping foreign keys for "speed" and getting orphan rows.

Interview tip: always add indexes on foreign key columns used in joins.

### CHECK, UNIQUE, NOT NULL and DEFAULT constraints
<!-- level: basic; ref: https://www.postgresql.org/docs/current/ddl-constraints.html -->
Constraints push business rules into the database where every writer must obey them. `NOT NULL` forbids missing values; `CHECK` validates a boolean expression per row; `UNIQUE` forbids duplicates (NULL handling differs: PostgreSQL allows multiple NULLs, SQL Server allows only one in a plain unique constraint, and filtered indexes or `NULLS NOT DISTINCT` in PostgreSQL 15 and later change this); `DEFAULT` supplies a value on insert. A check constraint is satisfied when the expression is TRUE or UNKNOWN.

```sql
ALTER TABLE products
  ADD CONSTRAINT price_positive CHECK (price >= 0),
  ADD CONSTRAINT sku_unique UNIQUE (sku);
```

Pitfalls:
- A CHECK on a nullable column passes for NULL, so add NOT NULL.
- Adding constraints on huge tables can lock; PostgreSQL supports `NOT VALID` then `VALIDATE CONSTRAINT`.

Interview tip: a database-level constraint is the only protection that survives multiple applications and manual fixes.

### Normalisation: 1NF, 2NF, 3NF
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/office/troubleshoot/access/database-normalization-description -->
Normalisation organises data to avoid redundancy and update anomalies. 1NF: atomic values and no repeating groups (no comma-separated lists in a column). 2NF: in tables with composite keys, every non-key column depends on the whole key. 3NF: non-key columns depend only on the key, not on other non-key columns (a `city` and `zip` stored with a customer when zip determines city is a transitive dependency). Boyce-Codd normal form tightens 3NF for overlapping candidate keys.

```text
orders(order_id, customer_id, customer_city)   -- city depends on customer: violates 3NF
orders(order_id, customer_id)  customers(customer_id, city)   -- normalised
```

Benefits: a fact is stored once, updates are one place, constraints are meaningful. Cost: more joins.

Pitfalls:
- Treating normal forms as dogma rather than as anomaly prevention.
- Storing JSON blobs or delimited strings to dodge design.

Interview tip: define the three anomalies (insert, update, delete) and give one example.

### Denormalisation and star schemas
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/fabric/data-warehouse/dimensional-modeling-overview -->
Denormalisation deliberately duplicates or pre-joins data to speed reads, accepting more complex writes. Reasonable cases: read-heavy reporting, expensive aggregates stored as summary tables, snapshotting price on an order line because history must not change. Analytical systems use dimensional models: a central fact table (events with numeric measures and foreign keys) surrounded by dimension tables (customer, product, date). The star schema keeps dimensions flat; a snowflake normalises them further.

```sql
SELECT d.year, p.category, SUM(f.amount) AS revenue
FROM fact_sales f
JOIN dim_date d ON d.date_key = f.date_key
JOIN dim_product p ON p.product_key = f.product_key
GROUP BY d.year, p.category;
```

Pitfalls:
- Denormalising before measuring a real performance problem.
- Duplicated data drifting out of sync; keep it consistent with triggers, jobs or application logic.

Interview tip: separate OLTP (normalised, many small writes) from OLAP (denormalised, large scans).

### Modelling many-to-many relationships
<!-- level: basic; ref: https://www.postgresql.org/docs/current/ddl-constraints.html -->
Relational tables cannot store a many-to-many relationship in a column, so use a junction (association) table holding the two foreign keys, ideally as a composite primary key to prevent duplicate pairs. It can also carry attributes of the relationship itself, such as quantity or enrolment date.

```sql
CREATE TABLE student_course (
  student_id bigint REFERENCES students(id),
  course_id  bigint REFERENCES courses(id),
  enrolled_on date NOT NULL DEFAULT current_date,
  PRIMARY KEY (student_id, course_id)
);
CREATE INDEX ON student_course (course_id, student_id);   -- reverse lookups
```

Pitfalls:
- A comma-separated list of ids in one column, which breaks integrity, joins and indexing.
- Missing reverse index, so "all students in a course" scans.

Interview tip: mention the junction table is where relationship attributes live.

### Soft deletes, audit columns and temporal data
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal-tables -->
A soft delete marks rows (`deleted_at` or `is_deleted`) instead of removing them, preserving history and allowing undelete, but every query must filter it, and unique constraints must be scoped (a partial unique index `WHERE deleted_at IS NULL`). Audit columns (`created_at`, `updated_at`, `created_by`) record who changed what. For full history, SQL Server provides system-versioned temporal tables (SQL Server 2016 and later), where the engine keeps old row versions and supports `FOR SYSTEM_TIME AS OF` queries. PostgreSQL has no built-in equivalent; use triggers into a history table or an extension.

```sql
CREATE UNIQUE INDEX uq_user_email_active ON users (email) WHERE deleted_at IS NULL;
```

Pitfalls:
- Forgetting the filter in one query and exposing deleted data.
- Soft-deleted rows growing forever; plan archiving and privacy erasure obligations.

Interview tip: discuss the trade-off versus an archive table or event log.

## 4. Indexes and Execution Plans

### How B-tree indexes work
<!-- level: basic; ref: https://www.postgresql.org/docs/current/indexes-types.html -->
The default index is a B-tree: a balanced, sorted tree where lookups, range scans and ordered reads take logarithmic time, typically three or four page reads even for millions of rows. It serves equality, ranges (`<`, `>`, `BETWEEN`), `ORDER BY`, `MIN/MAX` and prefix matches (`LIKE 'abc%'` under a suitable collation or operator class). Indexes speed reads but cost storage and slow `INSERT`, `UPDATE` and `DELETE`, because each index must be maintained.

```sql
CREATE INDEX idx_orders_customer ON orders (customer_id);
SELECT * FROM orders WHERE customer_id = 42 ORDER BY created_at;
```

Index only columns that appear in selective predicates, joins and sorts. A low-selectivity index (a boolean column) is rarely used because scanning the table is cheaper.

Pitfalls:
- Indexing every column "just in case", killing write throughput.
- Expecting an index to help `LIKE '%text'`.

Interview tip: state the read-versus-write trade-off.

### Clustered versus non-clustered indexes
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/sql/relational-databases/indexes/clustered-and-nonclustered-indexes-described -->
In SQL Server a clustered index defines the physical order of the table: the leaf level is the data, so there is one per table. Non-clustered indexes hold their key plus a pointer to the row (the clustering key, or a row id in a heap), so a lookup can require a key lookup to fetch other columns. A narrow, unique, ever-increasing clustered key keeps nonclustered indexes small and inserts append-only.

PostgreSQL tables are heaps: all indexes are secondary and point to the tuple location; `CLUSTER` reorders the table once but does not maintain the order. Index-only scans rely on the visibility map.

```sql
-- SQL Server
CREATE CLUSTERED INDEX cx_orders ON orders (id);
CREATE NONCLUSTERED INDEX ix_orders_cust ON orders (customer_id);
```

Pitfalls:
- A wide clustering key such as a long composite or random GUID bloats every index.
- Assuming PostgreSQL maintains clustered order.

Interview tip: explain key lookup cost and how covering indexes remove it.

### Composite indexes and column order
<!-- level: intermediate; ref: https://use-the-index-luke.com/sql/where-clause/the-equals-operator/concatenated-keys -->
A composite index sorts by the first column, then the second within it, and so on. It is usable for predicates on a leftmost prefix of columns, so `(customer_id, created_at)` supports filters on `customer_id` alone or both, but not efficiently on `created_at` alone. Put equality columns first, then the range or sort column; a range condition stops further columns from narrowing the seek.

```sql
CREATE INDEX ix_orders_cust_date ON orders (customer_id, created_at DESC);
-- good: WHERE customer_id = 7 AND created_at >= '2026-01-01' ORDER BY created_at DESC
-- poor: WHERE created_at >= '2026-01-01'
```

An index with the right order can also satisfy `ORDER BY` without a sort step.

Pitfalls:
- Putting the most selective column first by reflex instead of matching the query shapes.
- Redundant indexes (`(a)` and `(a, b)`) that waste write cost.

Interview tip: use the phonebook analogy: sorted by last name, then first name.

### Covering indexes and INCLUDE
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/indexes-index-only-scans.html -->
A covering index contains every column a query needs, so the engine answers from the index alone without visiting the table (PostgreSQL index-only scan, SQL Server avoiding key lookups). `INCLUDE` adds non-key payload columns to the leaf level without making them part of the sort key (SQL Server 2005 and later; PostgreSQL 11 and later), keeping the tree narrower.

```sql
CREATE INDEX ix_orders_cust ON orders (customer_id) INCLUDE (total, status);
SELECT total, status FROM orders WHERE customer_id = 42;   -- index only
```

PostgreSQL index-only scans also need the visibility map to be current, so `VACUUM` matters.

Pitfalls:
- Including many wide columns, making the index nearly a copy of the table.
- `SELECT *` defeating covering.

Interview tip: say how you would eliminate a key lookup flagged in a plan.

### Sargability and index-friendly predicates
<!-- level: intermediate; ref: https://use-the-index-luke.com/sql/where-clause/obfuscation -->
A predicate is sargable (Search ARGument ABLE) if the engine can use an index seek. Wrapping the column in a function or expression usually prevents it, because the stored index values are not transformed. Rewrite so the column stands alone, or create an expression index.

```sql
-- not sargable
WHERE YEAR(created_at) = 2026
WHERE LOWER(email) = 'a@b.com'
WHERE amount + 10 > 100
-- sargable
WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01'
WHERE amount > 90
-- PostgreSQL expression index
CREATE INDEX ON users (lower(email));
```

Implicit conversions also break seeks: comparing a `varchar` column to an `nvarchar` parameter in SQL Server converts the column side.

Pitfalls:
- A leading wildcard `LIKE '%x'`.
- Mismatched parameter types in application code.

Interview tip: give the date-range rewrite as the canonical example.

### Reading execution plans
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/using-explain.html -->
An execution plan shows how the optimiser runs a query: access methods (seq scan, index seek or scan), join algorithms (nested loop, hash, merge), sorts and aggregates, with cost and row estimates. Use `EXPLAIN (ANALYZE, BUFFERS)` in PostgreSQL (ANALYZE actually runs the statement) and the actual execution plan or `SET STATISTICS IO ON` in SQL Server. Compare estimated versus actual rows: large gaps point to stale statistics or non-sargable predicates.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders WHERE customer_id = 42;
```

Look for sequential scans of big tables, key lookups repeated many times, expensive sorts spilling to disk, nested loops over huge row counts, and warnings about implicit conversions or missing indexes.

Pitfalls:
- Judging by cost numbers alone; they are estimates in arbitrary units.
- Running `EXPLAIN ANALYZE` on a data-modifying statement without a transaction and rollback.

Interview tip: say you check estimated versus actual rows first.

### Statistics, cardinality and parameter sniffing
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/sql/relational-databases/query-processing-architecture-guide -->
The optimiser chooses plans from statistics: histograms and distinct counts per column. Stale or insufficient statistics lead to poor row estimates and bad join or access choices. PostgreSQL refreshes them with `ANALYZE` (autovacuum does it automatically); SQL Server auto-updates statistics after enough changes and via `UPDATE STATISTICS`.

Parameter sniffing in SQL Server compiles a plan using the parameter values of the first call and caches it; if later calls have very different selectivity, the plan is poor. PostgreSQL's plan cache for prepared statements can similarly settle on a generic plan after several executions.

```sql
-- SQL Server mitigations
SELECT ... OPTION (RECOMPILE);
SELECT ... OPTION (OPTIMIZE FOR (@cust UNKNOWN));
```

Pitfalls:
- Fixing sniffing by clearing the whole plan cache in production.
- Skewed data where one value covers most rows.

Interview tip: describe a query that is fast for one parameter and slow for another.

### Specialised PostgreSQL indexes: partial, GIN, GiST and BRIN
<!-- level: advanced; ref: https://www.postgresql.org/docs/current/indexes-types.html -->
Beyond B-tree, PostgreSQL offers index types for different data. A partial index covers only rows matching a predicate, shrinking the index and speeding the common case. GIN indexes invert composite values, ideal for `jsonb`, arrays and full-text search. GiST and SP-GiST support geometric, range and nearest-neighbour searches. BRIN stores min/max summaries per block range, tiny and effective for huge append-only tables naturally ordered by a column such as time. Hash indexes handle only equality.

```sql
CREATE INDEX idx_open_orders ON orders (created_at) WHERE status = 'open';
CREATE INDEX idx_docs_gin ON docs USING gin (payload jsonb_path_ops);
CREATE INDEX idx_log_brin ON logs USING brin (logged_at);
```

SQL Server equivalents include filtered indexes, columnstore indexes for analytics, full-text and spatial indexes.

Pitfalls:
- A query predicate that does not imply the partial index predicate, so the index is ignored.
- BRIN on randomly ordered data, which gives no benefit.

Interview tip: match the index type to the access pattern.

### Index maintenance, fragmentation and bloat
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/routine-reindex.html -->
Updates and deletes leave free space and out-of-order pages. SQL Server reports logical fragmentation; use `REORGANIZE` for light fragmentation and `REBUILD` for heavy, with a sensible fill factor for volatile indexes. Fragmentation matters mostly for range scans on spinning disks and less on SSDs. PostgreSQL's MVCC leaves dead tuples, producing table and index bloat that `VACUUM` reclaims for reuse; `REINDEX CONCURRENTLY` rebuilds without blocking writes, and `pg_repack` can compact tables online.

```sql
-- SQL Server
ALTER INDEX ix_orders_cust ON orders REBUILD WITH (ONLINE = ON);  -- edition dependent
-- PostgreSQL
REINDEX INDEX CONCURRENTLY idx_orders_customer;
```

Pitfalls:
- Blindly rebuilding all indexes nightly, generating log and load for little gain.
- Disabling autovacuum.

Interview tip: say statistics freshness often matters more than rebuilding.
