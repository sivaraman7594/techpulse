## 1. Querying and Joins

### NULL and three-valued logic
<!-- level: basic; ref: https://www.postgresql.org/docs/current/functions-comparison.html -->
NULL means "unknown", not zero or empty string. Any comparison with NULL, including `NULL = NULL`, yields UNKNOWN, and a WHERE clause keeps only rows where the condition is TRUE. So `WHERE col <> 5` silently drops rows where col is NULL. Use `IS NULL` and `IS NOT NULL`, and `IS DISTINCT FROM` in PostgreSQL (and in SQL Server 2022 and later) for null-safe comparison. Aggregates other than `COUNT(*)` ignore NULLs, and `COALESCE` supplies a default.

```sql
SELECT id FROM orders WHERE coupon IS NULL;
SELECT COALESCE(discount, 0) AS discount FROM orders;
SELECT 1 WHERE NULL = NULL;        -- returns no rows
```

Pitfalls:
- `NOT IN (subquery)` returns nothing if the subquery contains a single NULL; prefer `NOT EXISTS`.
- `COUNT(col)` and `COUNT(*)` differ when NULLs exist.

Interview tip: explain why `x NOT IN (1, NULL)` is never true.

### Filtering, sorting and limiting rows
<!-- level: basic; ref: https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql -->
Logical processing order is FROM, WHERE, GROUP BY, HAVING, SELECT, ORDER BY, then limiting; this is why a column alias defined in SELECT is usable in ORDER BY but not in WHERE. Without ORDER BY the row order is undefined. PostgreSQL limits with `LIMIT n OFFSET m`; SQL Server uses `TOP (n)` or `OFFSET m ROWS FETCH NEXT n ROWS ONLY`, which requires ORDER BY.

```sql
-- PostgreSQL
SELECT id, total FROM orders ORDER BY total DESC, id LIMIT 10;
-- SQL Server
SELECT id, total FROM orders ORDER BY total DESC, id
OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY;
```

Pitfalls:
- Paging with a non-unique ORDER BY returns duplicates or gaps between pages; add a unique tiebreaker.
- Large OFFSET values scan and discard rows; use keyset pagination for deep pages.

Interview tip: recite the logical processing order.

### INNER and OUTER joins
<!-- level: basic; ref: https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-JOIN -->
A join combines rows from two tables on a condition. INNER JOIN keeps only matching rows. LEFT JOIN keeps every left row, with NULLs for the right side when there is no match; RIGHT is the mirror; FULL OUTER keeps unmatched rows from both. Conditions on the right table of a LEFT JOIN belong in the ON clause: put in WHERE they remove the NULL rows and turn it into an inner join.

```sql
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
GROUP BY c.name;
```

Pitfalls:
- Joining on a non-unique key multiplies rows and inflates sums.
- `COUNT(*)` after a LEFT JOIN counts the NULL-extended row as 1; count a right-side column.

Interview tip: be able to draw which rows each join type returns.

### Self joins, cross joins and anti-joins
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/queries-table-expressions.html -->
A self join joins a table to itself using aliases, useful for hierarchies (employee and manager) or comparing rows. A CROSS JOIN returns the Cartesian product, handy for generating combinations such as every date by every store. An anti-join finds rows with no match, written with `NOT EXISTS` or `LEFT JOIN ... WHERE right.key IS NULL`. A semi-join checks existence without duplicating rows, written with `EXISTS`.

```sql
SELECT e.name, m.name AS manager
FROM employees e LEFT JOIN employees m ON m.id = e.manager_id;

SELECT c.id FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);
```

Pitfalls:
- An accidental cross join from a missing join condition; row counts explode.
- Using `NOT IN` with a nullable column.

Interview tip: say `EXISTS` stops at the first match and avoids duplicate rows that a join would create.

### Set operators
<!-- level: basic; ref: https://www.postgresql.org/docs/current/queries-union.html -->
`UNION` combines result sets and removes duplicates, `UNION ALL` keeps them and is cheaper because it skips the sort or hash step. `INTERSECT` returns rows in both, and `EXCEPT` returns rows in the first but not the second (Oracle calls it MINUS). Both inputs need the same number of columns with compatible types, and column names come from the first query. Set operators treat NULLs as equal for duplicate removal, unlike `=`.

```sql
SELECT email FROM newsletter
EXCEPT
SELECT email FROM unsubscribed;
```

Pitfalls:
- Using `UNION` when `UNION ALL` is correct costs an extra deduplication.
- ORDER BY applies to the whole combined result and appears once at the end.

Interview tip: contrast `EXCEPT` with `NOT IN` regarding NULLs and duplicates.

### Subqueries, EXISTS and IN
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/functions-subquery.html -->
A subquery is a query nested inside another. A scalar subquery returns one value; an `IN` or `EXISTS` subquery tests membership; a derived table in FROM acts like a temporary view. A correlated subquery references the outer query and is conceptually run per row, though optimisers often convert it to a join. `EXISTS` returns true as soon as one row is found and ignores the select list; `IN` compares values and has NULL semantics that bite with `NOT IN`.

```sql
SELECT name FROM products p
WHERE EXISTS (SELECT 1 FROM order_items i WHERE i.product_id = p.id);

SELECT name, (SELECT MAX(total) FROM orders o WHERE o.customer_id = c.id) AS biggest
FROM customers c;
```

Pitfalls:
- A scalar subquery returning more than one row fails at runtime.
- Assuming correlated always means slow; check the plan.

Interview tip: modern optimisers treat `IN` and `EXISTS` similarly, so choose for NULL correctness and readability.

### LATERAL and APPLY
<!-- level: advanced; ref: https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-LATERAL -->
LATERAL (PostgreSQL) and CROSS APPLY / OUTER APPLY (SQL Server) let a subquery in FROM reference columns of earlier FROM items, so it runs per outer row. This solves "top N per group" and calls to table-valued functions. `CROSS APPLY` behaves like an inner join (drops outer rows with no result); `OUTER APPLY` keeps them with NULLs, like LEFT JOIN LATERAL ... ON TRUE.

```sql
-- PostgreSQL: latest 3 orders per customer
SELECT c.id, o.id, o.created_at
FROM customers c
CROSS JOIN LATERAL (
  SELECT id, created_at FROM orders
  WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 3) o;
-- SQL Server: CROSS APPLY (SELECT TOP (3) ... WHERE customer_id = c.id ORDER BY ...) o
```

With an index on `(customer_id, created_at DESC)` this is an efficient index seek per customer.

Pitfalls:
- Without a supporting index each outer row triggers a scan.

Interview tip: offer `ROW_NUMBER()` as the alternative for top-N per group.

## 2. Aggregation, CTEs and Window Functions

### GROUP BY and HAVING
<!-- level: basic; ref: https://www.postgresql.org/docs/current/tutorial-agg.html -->
GROUP BY collapses rows sharing the same grouping values into one row per group, so every selected column must be either in GROUP BY or inside an aggregate (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`). WHERE filters rows before grouping; HAVING filters groups after aggregation, so it can reference aggregates. Filter early in WHERE whenever possible because it reduces work. `GROUPING SETS`, `ROLLUP` and `CUBE` compute several grouping levels (subtotals) in one query.

```sql
SELECT customer_id, COUNT(*) AS n, SUM(total) AS spent
FROM orders
WHERE created_at >= '2026-01-01'
GROUP BY customer_id
HAVING SUM(total) > 1000;
```

Pitfalls:
- Putting a non-aggregated condition in HAVING instead of WHERE.
- `AVG` of an integer column in SQL Server truncates; cast to decimal first.

Interview tip: say why `SELECT name, COUNT(*) ... GROUP BY id` can be invalid in SQL Server and standard SQL.

### Conditional aggregation and pivoting
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/functions-aggregate.html -->
Conditional aggregation computes several filtered metrics in one pass over the table with `CASE` inside an aggregate. It also performs manual pivoting from rows to columns portably. PostgreSQL additionally offers `COUNT(*) FILTER (WHERE ...)`, and SQL Server has a `PIVOT` operator, but `CASE` works on both.

```sql
SELECT customer_id,
  SUM(CASE WHEN status = 'paid'     THEN total ELSE 0 END) AS paid,
  SUM(CASE WHEN status = 'refunded' THEN total ELSE 0 END) AS refunded,
  COUNT(*) FILTER (WHERE status = 'open') AS open_orders  -- PostgreSQL
FROM orders GROUP BY customer_id;
```

This is usually better than several separate subqueries, each scanning the table.

Pitfalls:
- Forgetting the `ELSE 0`, making sums NULL when no row matches.
- Pivot column lists that must be static; dynamic pivots need dynamic SQL.

Interview tip: mention single scan versus multiple scans.

### Common table expressions
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/queries-with.html -->
A CTE (`WITH name AS (...)`) names a subquery so a complex query reads top to bottom, and the name can be referenced several times. CTEs are mainly for readability and recursion. In PostgreSQL 12 and later a non-recursive, side-effect-free CTE referenced once is inlined; use `MATERIALIZED` or `NOT MATERIALIZED` to control it. SQL Server never materialises a CTE by default; it is expanded like a view, so referencing it twice may compute it twice.

```sql
WITH recent AS (
  SELECT customer_id, SUM(total) AS spent
  FROM orders WHERE created_at >= now() - interval '30 days'
  GROUP BY customer_id
)
SELECT c.name, r.spent FROM recent r JOIN customers c ON c.id = r.customer_id;
```

Pitfalls:
- Assuming a CTE is a temporary table; if reused heavily, a temp table with an index may be faster.
- Before PostgreSQL 12, every CTE was an optimisation fence.

Interview tip: say CTE versus temp table versus view in one sentence each.

### Recursive CTEs
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/sql/t-sql/queries/with-common-table-expression-transact-sql -->
A recursive CTE has an anchor member, which starts the result, and a recursive member that references the CTE itself, joined with `UNION ALL`. It repeats until the recursive part returns no rows. It handles trees and graphs: org charts, bill of materials, category paths, and number or date series. PostgreSQL requires the keyword `WITH RECURSIVE`; SQL Server uses plain `WITH`.

```sql
WITH RECURSIVE chain AS (
  SELECT id, manager_id, name, 1 AS depth FROM employees WHERE id = 7
  UNION ALL
  SELECT e.id, e.manager_id, e.name, c.depth + 1
  FROM employees e JOIN chain c ON e.id = c.manager_id
)
SELECT * FROM chain;
```

Pitfalls:
- Cycles in data cause infinite recursion; track a visited path or limit depth. SQL Server stops at 100 levels by default (`OPTION (MAXRECURSION n)`).
- Data type mismatch between anchor and recursive columns.

Interview tip: describe the anchor and recursive step and how you guard against cycles.

### Window function basics
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/tutorial-window.html -->
A window function computes a value for each row using a set of related rows, without collapsing them like GROUP BY. The `OVER` clause defines the window: `PARTITION BY` splits into groups, `ORDER BY` orders within each, and an optional frame limits the rows. Aggregates (`SUM`, `AVG`) can be used as window functions, which makes it easy to show row detail next to group totals.

```sql
SELECT id, customer_id, total,
       SUM(total) OVER (PARTITION BY customer_id) AS customer_total,
       total * 100.0 / SUM(total) OVER () AS pct_of_all
FROM orders;
```

Window functions run after WHERE, GROUP BY and HAVING, so you cannot filter on them directly in WHERE; wrap the query in a CTE or subquery.

Pitfalls:
- Filtering a window result in the same SELECT's WHERE clause.
- Forgetting `PARTITION BY` and getting one global window.

Interview tip: explain the difference between GROUP BY and OVER in terms of row count.

### Ranking: ROW_NUMBER, RANK, DENSE_RANK
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/sql/t-sql/functions/ranking-functions-transact-sql -->
`ROW_NUMBER()` gives unique sequential numbers within a partition, breaking ties arbitrarily unless the ORDER BY is unique. `RANK()` gives equal rank to ties and leaves gaps (1, 1, 3). `DENSE_RANK()` gives ties equal rank without gaps (1, 1, 2). `NTILE(n)` splits rows into n buckets. These are the basis for top-N per group and deduplication.

```sql
SELECT * FROM (
  SELECT e.*, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC, id) AS rn
  FROM employees e) t
WHERE rn <= 3;
```

Use `DENSE_RANK() = N` for "Nth highest salary" when ties should share a rank.

Pitfalls:
- Non-deterministic ordering when the ORDER BY has ties.
- Using `RANK` when you need exactly N rows.

Interview tip: contrast the three functions with a tie example.

### LAG, LEAD and row comparisons
<!-- level: intermediate; ref: https://www.postgresql.org/docs/current/functions-window.html -->
`LAG(expr, n, default)` reads a value from n rows before in the window order, and `LEAD` n rows after. They remove the need for self joins when comparing consecutive rows, such as month-over-month change, time between events, or detecting gaps. `FIRST_VALUE` and `LAST_VALUE` read the window ends; beware `LAST_VALUE` uses the default frame that ends at the current row.

```sql
SELECT month, revenue,
       revenue - LAG(revenue) OVER (ORDER BY month) AS change,
       LEAD(month) OVER (ORDER BY month) AS next_month
FROM monthly_revenue;
```

Pitfalls:
- The first row has no previous value, so LAG returns NULL unless you give a default.
- Missing months in data make "previous row" differ from "previous month".

Interview tip: say how you would find gaps and islands using `ROW_NUMBER` differences or `LAG`.

### Window frames and running totals
<!-- level: advanced; ref: https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-WINDOW-FUNCTIONS -->
The frame decides which rows of the partition an aggregate sees. `ROWS BETWEEN ... AND ...` counts physical rows; `RANGE` includes all peers with the same ORDER BY value; `GROUPS` (PostgreSQL) counts peer groups. With ORDER BY and no explicit frame, the default is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, giving running totals, but ties make peers share the same total and RANGE is slower in SQL Server than ROWS.

```sql
SELECT day, amount,
  SUM(amount) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running,
  AVG(amount) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS moving_avg_7
FROM daily_sales;
```

Pitfalls:
- Relying on the default frame with duplicate order values.
- `LAST_VALUE` returning the current row due to the default frame.

Interview tip: always write the frame explicitly with `ROWS`.
