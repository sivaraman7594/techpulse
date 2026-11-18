# SQL interview questions

### Explain INNER, LEFT, RIGHT and FULL OUTER JOIN.
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/sql/relational-databases/performance/joins -->
- **INNER JOIN**: only rows with a match in both tables.
- **LEFT JOIN**: all rows from the left table, plus matches from the right (NULLs where there is no match).
- **RIGHT JOIN**: the mirror image — all rows from the right table.
- **FULL OUTER JOIN**: all rows from both, matched where possible.
- **CROSS JOIN**: every combination (Cartesian product).

```sql
-- Customers with no orders
SELECT c.Name
FROM Customers c
LEFT JOIN Orders o ON o.CustomerId = c.Id
WHERE o.Id IS NULL;
```

### What is the difference between WHERE and HAVING?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/sql/t-sql/queries/select-having-transact-sql -->
`WHERE` filters **rows before** grouping; `HAVING` filters **groups after** `GROUP BY` and can use aggregates.

```sql
SELECT CustomerId, SUM(Total) AS Spent
FROM Orders
WHERE OrderDate >= '2026-01-01'      -- rows
GROUP BY CustomerId
HAVING SUM(Total) > 10000;            -- groups
```

### What is the difference between a clustered and a non-clustered index?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/sql/relational-databases/indexes/clustered-and-nonclustered-indexes-described -->
- A **clustered index** defines the physical order of the table's rows; the leaf level *is* the data. A table can have only one (in SQL Server it is often the primary key).
- A **non-clustered index** is a separate structure with key values and a pointer to the row. A table can have many.

A **covering index** includes every column a query needs (via key columns or `INCLUDE`), so the query never touches the base table. Indexes speed up reads but slow down writes and use storage, so index for real query patterns.

### What is normalization, and when would you denormalize?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/office/troubleshoot/access/database-normalization-description -->
Normalization organises data to remove redundancy and update anomalies:
- **1NF**: atomic values, no repeating groups.
- **2NF**: every non-key column depends on the whole primary key.
- **3NF**: no non-key column depends on another non-key column.

**Denormalize** deliberately for read performance — reporting tables, data warehouses (star schemas), cached totals — accepting extra storage and the work of keeping copies consistent.

### Find the second (or Nth) highest salary.
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/sql/t-sql/functions/dense-rank-transact-sql -->
Use a window function — it handles ties and generalises to N:

```sql
SELECT DISTINCT Salary
FROM (
    SELECT Salary, DENSE_RANK() OVER (ORDER BY Salary DESC) AS rnk
    FROM Employees
) ranked
WHERE rnk = 2;   -- N
```

`ROW_NUMBER` numbers every row uniquely, `RANK` leaves gaps after ties, and `DENSE_RANK` does not leave gaps. Add `PARTITION BY DepartmentId` for "per department".

### What do ACID and transaction isolation levels mean?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/sql/t-sql/statements/set-transaction-isolation-level-transact-sql -->
**ACID**: **A**tomicity (all or nothing), **C**onsistency (constraints hold), **I**solation (concurrent transactions don't interfere), **D**urability (committed data survives crashes).

Isolation levels trade consistency against concurrency:
- **Read Uncommitted**: can read uncommitted changes (dirty reads).
- **Read Committed** (common default): no dirty reads; a row can change between two reads.
- **Repeatable Read**: rows read can't change, but new rows can appear (phantoms).
- **Serializable**: behaves as if transactions ran one at a time.
- **Snapshot** (SQL Server) / MVCC: readers see a consistent version without blocking writers.

### A query that used to be fast is suddenly slow. How do you troubleshoot?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/sql/relational-databases/performance/monitoring-performance-by-using-the-query-store -->
1. Get the **actual execution plan** — look for scans instead of seeks, key lookups, large row-count estimate mismatches, spills.
2. Check **statistics**: outdated stats cause bad plans → update statistics.
3. **Parameter sniffing**: a plan compiled for an unusual value is reused for typical values. Query Store shows plan changes; fixes include plan forcing, `OPTIMIZE FOR`, or `RECOMPILE` for that query.
4. **Indexes**: missing, or fragmented/dropped by a recent change.
5. **Non-SARGable predicates**: `WHERE YEAR(OrderDate) = 2026` or functions on columns prevent index seeks → rewrite as a range.
6. **Blocking/locking**: check waits and blocking sessions.
7. Data growth: the table may simply be much bigger now — paginate and filter earlier.

### How do you delete duplicate rows but keep one copy?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/sql/t-sql/functions/row-number-transact-sql -->
Number the rows within each duplicate group and delete all but the first:

```sql
WITH d AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY Email ORDER BY CreatedAt) AS rn
    FROM Users
)
DELETE FROM d WHERE rn > 1;   -- SQL Server syntax
```

Then add a **unique constraint/index** on the column so duplicates can't come back. In PostgreSQL, delete using `ctid` or the primary key from the same ranked subquery.
