# Python scenario-based interview questions

### A nightly ETL script that used to finish in 10 minutes now takes 2 hours. How do you find and fix the slowdown?
<!-- level: intermediate; kind: scenario; ref: https://docs.python.org/3/library/profile.html -->
Observe: first establish what changed. Compare data volume (rows per day), code commits, dependency versions, Python version and infrastructure (database, network, disk) between a fast and a slow run. A 12x slowdown with 2x more data strongly suggests something quadratic.

Hypothesise and verify with a profiler rather than guessing:

```bash
python -m cProfile -o etl.prof etl.py --date 2026-11-01
python -c "import pstats; pstats.Stats('etl.prof').sort_stats('cumtime').print_stats(20)"
py-spy record -o flame.svg -- python etl.py    # sampling flame graph, includes waits
```

Typical culprits and fixes:

- O(n squared) logic: `if x in some_list` inside a loop, or repeated `list.index`. Switch to a set or dict.
- N+1 database access: one query per row. Batch with `IN (...)`, bulk inserts (`executemany`, `COPY`), or a join.
- Row-wise pandas `apply` or `iterrows`. Vectorise.
- String concatenation in loops building huge outputs. Use `join` or write incrementally.
- Waiting, not computing: if py-spy shows time in socket reads, the bottleneck is a slow API or database, possibly a missing index after a schema change.

Fix the top hot spot, re-measure, repeat.

Prevent: add per-stage timing logs and metrics (rows processed, seconds per stage), alert on duration regressions, and keep a benchmark with production-sized data in CI for critical paths.

Common wrong answers: "rewrite it in Go" or "add threads" before profiling. Threads will not help a CPU-bound quadratic loop, and a rewrite carries the same algorithmic bug.

### A long-running Python worker's memory grows steadily until the container is OOM-killed. How do you investigate?
<!-- level: advanced; kind: scenario; ref: https://docs.python.org/3/library/tracemalloc.html -->
Observe: plot RSS over time and correlate with workload. Steady growth proportional to jobs processed suggests a leak; a sawtooth that occasionally spikes suggests large individual payloads.

Hypotheses, in order of likelihood in Python:

1. Unbounded caches: a module-level dict, `functools.cache`, or `lru_cache(maxsize=None)` keyed by ever-changing inputs.
2. Accumulating references: lists of results, event listeners never removed, exceptions stored with tracebacks that pin large frames.
3. Native memory: C extensions (image libraries, XML parsers, ML frameworks) allocating outside Python's tracked heap.
4. Fragmentation: memory freed by Python but not returned to the OS, showing as high RSS without growing Python objects.

Verify with snapshots across many iterations:

```python
import tracemalloc, gc

tracemalloc.start(25)
base = tracemalloc.take_snapshot()
for _ in range(1000):
    process_next_job()
gc.collect()
snap = tracemalloc.take_snapshot()
for stat in snap.compare_to(base, "traceback")[:5]:
    print(stat)
    for line in stat.traceback.format()[-6:]:
        print("   ", line)
```

If tracemalloc shows little growth while RSS climbs, the leak is native or fragmentation; use memray (tracks native allocations) or check library issue trackers. `objgraph.show_growth()` helps find which object types multiply.

Fix: bound caches (`maxsize`, TTL caches), clear per-job state, use weak references for registries, stream large payloads instead of loading them whole.

Prevent: memory metrics with alerts, a soak test in CI, and as a safety net configure worker recycling (Celery `worker_max_tasks_per_child`, Gunicorn `max_requests`). Recycling is mitigation, not a fix, so still find the root cause.

### A FastAPI service shows huge latency spikes under load even though CPU usage is low. What is going on and how do you fix it?
<!-- level: advanced; kind: scenario; ref: https://docs.python.org/3/library/asyncio-dev.html -->
Observe: low CPU plus high latency means requests are waiting. In an async service the classic cause is blocking the event loop: one worker's loop is stuck in a synchronous call, so every request on that worker queues behind it.

Hypothesise: look for blocking calls inside `async def` routes or dependencies: `requests.get`, synchronous database drivers, `time.sleep`, file reads, heavy JSON or CPU work, or a sync SDK (cloud storage, payment provider).

Verify:

```python
import asyncio
asyncio.get_running_loop().slow_callback_duration = 0.05   # in debug mode, log >50 ms steps
```

Run with `PYTHONASYNCIODEBUG=1` in staging, use `py-spy dump --pid` during a spike to see the stack the loop thread is stuck in, and compare latency of a trivial `/health` endpoint during load: if it also spikes, the loop is blocked.

Fix options:

- Replace sync clients with async ones (httpx.AsyncClient, asyncpg, async SQLAlchemy, aioboto3).
- If a library has no async version, declare the route with plain `def` so FastAPI runs it in its thread pool, or wrap the call in `await asyncio.to_thread(...)`.
- Move CPU-heavy work to a process pool or a background job queue.
- Share one HTTP client per process for connection pooling, with timeouts.

Prevent: lint for known blocking calls in async code, load-test before releases, and track event-loop lag as a metric.

Common wrong answer: "add more Uvicorn workers". It masks the problem slightly but each worker still stalls; you pay more memory and keep tail latency.

### Your application works on every developer laptop but fails in production with an ImportError after a routine deploy. How do you handle it and prevent it?
<!-- level: intermediate; kind: scenario; ref: https://packaging.python.org/en/latest/guides/installing-using-pip-and-virtual-environments/ -->
Observe: capture the full traceback, the Python version, and the installed package set in the failing container (`python -m pip freeze`, `python -m pip check`). Compare with a developer environment.

Likely hypotheses:

- Unpinned dependencies: `requirements.txt` says `somelib>=2`, and the deploy pulled a new major release that removed or renamed an API, or dropped a transitive dependency your code imported implicitly.
- A different Python version or platform in production (missing wheel, compiled extension mismatch).
- Code importing a package that is installed on laptops by accident but never declared.
- Local shadowing: a file named like a package (`email.py`, `redis.py`) in the working directory.

Verify by recreating the production environment locally from the same image or lock file and running the import.

Fix immediately by rolling back to the last known-good image, not by hot-patching the server. Then pin the offending package and redeploy.

Prevent structurally:

1. Separate abstract requirements (`pyproject.toml`) from a lock file (uv.lock, Poetry lock, or a hashed `requirements.txt` from pip-tools) and install production strictly from the lock.
2. Build an immutable container image in CI and deploy that exact artifact everywhere; never `pip install` at runtime.
3. Run the test suite inside the built image.
4. Use Dependabot/Renovate for controlled, reviewed upgrades.
5. Add `deptry` or similar to catch undeclared imports.

Common wrong answer: "freeze my laptop's environment with `pip freeze`". That captures random leftovers and platform-specific packages; generate locks from declared dependencies instead.

### Two teams' internal libraries require incompatible versions of the same dependency, blocking a service from upgrading. What do you do?
<!-- level: advanced; kind: scenario; ref: https://pip.pypa.io/en/stable/topics/dependency-resolution/ -->
Observe: get the exact conflict from the resolver output, then map the tree (`uv tree --invert --package pydantic` or `pipdeptree -r -p pydantic`). Note whether the conflicting bounds are real (the code truly breaks) or defensive caps someone added.

Hypothesise the options, cheapest first:

1. Check whether newer releases of either library relax the bound. Often the fix is just upgrading the library that pinned too tightly.
2. Inspect the bound: if `lib-a` declares `pydantic<2` only because nobody tested v2, try installing with an override in a branch and run its tests. If they pass, ship a release of `lib-a` with the widened range.
3. If the library genuinely needs the old API, port it, or make it support both versions with a compatibility shim.
4. If ownership is slow, isolate: split the functionality into a separate process or service with its own environment, or run a CLI tool via `pipx`/`uv tool`.

Verify every option with the full test suite, not just installation.

```toml
# uv: temporary override while a fix is upstreamed (document why and when to remove)
[tool.uv]
override-dependencies = ["pydantic>=2.7"]
```

Prevent: set a policy for internal libraries: declare minimum supported versions and avoid upper caps unless a known break exists; test libraries against both the oldest and newest allowed versions in CI; and publish a shared constraints file for the platform so services converge on common versions.

Trade-off: overrides unblock you quickly but can produce runtime failures the resolver was protecting you from. Treat them as time-boxed debt with a ticket.

Common wrong answer: vendoring a copy of the dependency under a different name. It works briefly but creates unpatched security debt.

### Design a Python REST API for an order system that external partners will integrate with. What decisions matter most?
<!-- level: advanced; kind: scenario; ref: https://fastapi.tiangolo.com/tutorial/ -->
Start from consumers: partners need stability, clear errors and safe retries more than clever internals.

Key decisions:

1. Resource modelling: `/v1/orders`, `/v1/orders/{id}`, `/v1/orders/{id}/cancel` as an action endpoint. Version in the path (or header) from day one; additive changes only within a version.
2. Validation at the boundary: Pydantic models for requests and separate response models so internal fields never leak. Reject unknown fields if partners must be strict.
3. Idempotency: `POST /orders` with an `Idempotency-Key` header; store key plus response so network retries never create duplicate orders.
4. Consistent errors: one schema (for example RFC 9457 problem details) with machine-readable codes.
5. Pagination: cursor-based (`?cursor=...&limit=50`) rather than offset for large, changing datasets.
6. Auth and limits: OAuth2 client credentials or API keys per partner, rate limiting with `429` and `Retry-After`.
7. Observability: request ids, structured logs, latency and error metrics per partner.
8. Documentation: generated OpenAPI plus examples; publish a changelog and deprecation policy.

```python
from fastapi import FastAPI, Header, HTTPException
app = FastAPI()

@app.post("/v1/orders", status_code=201, response_model=OrderOut)
async def create_order(body: OrderIn, idempotency_key: str = Header(...)):
    if (cached := await idem_store.get(idempotency_key)) is not None:
        return cached
    order = await service.create(body)
    await idem_store.put(idempotency_key, order, ttl=86400)
    return order
```

Trade-offs: synchronous creation is simpler; if fulfilment is slow, return `202 Accepted` with a status URL and send webhooks (signed with HMAC) on state changes.

Common wrong answers: exposing database models directly, using offset pagination on millions of rows, and breaking changes without a version bump.

### You need to aggregate 500 million rows per day stored as Parquet files in object storage. How would you do it in Python?
<!-- level: advanced; kind: scenario; ref: https://arrow.apache.org/docs/python/dataset.html -->
Observe the shape: total size, number and size of files, partitioning (by date?), required latency and how often the job runs. 500M rows of narrow Parquet may be only tens of gigabytes compressed, which a single well-sized machine can process.

Approach in increasing complexity:

1. Single node, columnar engine: DuckDB or Polars read Parquet directly from object storage, push down filters and column selection, and stream in parallel across cores. Often finishes in minutes.

```python
import duckdb
con = duckdb.connect()
con.execute("SET threads TO 16")
result = con.execute("""
    SELECT region, product_id, SUM(amount) AS revenue, COUNT(*) AS orders
    FROM read_parquet('s3://lake/sales/date=2026-11-17/*.parquet')
    WHERE status = 'paid'
    GROUP BY ALL
""").df()
```

```python
import polars as pl
lazy = (pl.scan_parquet("s3://lake/sales/date=2026-11-17/*.parquet")
          .filter(pl.col("status") == "paid")
          .group_by("region", "product_id")
          .agg(pl.col("amount").sum().alias("revenue")))
df = lazy.collect()     # optimiser prunes columns and pushes filters into the scan
```

2. Distributed: if data is terabytes or must join huge tables, use Spark (PySpark), Dask or Ray, or the warehouse itself (BigQuery, Snowflake, Databricks SQL), keeping Python as orchestration.

Design considerations: read only needed columns, partition by date to prune files, avoid many tiny files (compact them), write results incrementally and idempotently (overwrite the day's partition), and validate outputs with row counts and checksums.

Trade-offs: a single DuckDB/Polars node is cheap and simple to operate; clusters add cost and operational complexity but scale horizontally.

Common wrong answers: loading everything into pandas, or iterating rows in Python. Both waste memory and time; pandas also lacks query optimisation.

### A CPU-heavy image-processing script uses only one core on a 16-core machine. How do you parallelise it safely?
<!-- level: intermediate; kind: scenario; ref: https://docs.python.org/3/library/concurrent.futures.html#processpoolexecutor -->
Observe: confirm it is CPU-bound (one core at 100%, little I/O wait) and profile to see where time goes. If most time is inside a native library call that releases the GIL (Pillow, OpenCV, NumPy), threads may already scale; if it is pure Python, threads will not help on the default CPython build because of the GIL.

Plan: images are independent, so this is embarrassingly parallel. Use a process pool and pass file paths, not image data, to minimise pickling.

```python
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from PIL import Image

def make_thumbnail(src: str, dst_dir: str) -> str:
    with Image.open(src) as im:
        im.thumbnail((512, 512))
        out = Path(dst_dir) / Path(src).name
        im.save(out, optimize=True)
    return str(out)

if __name__ == "__main__":
    files = [str(p) for p in Path("in").glob("*.jpg")]
    failures = []
    with ProcessPoolExecutor(max_workers=15) as pool:
        futs = {pool.submit(make_thumbnail, f, "out"): f for f in files}
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception as exc:
                failures.append((futs[fut], exc))
    print(len(failures), "failed")
```

Verify speedup and memory: each process holds its own copy of libraries and images, so 16 workers may exceed RAM. Tune `max_workers` and `chunksize` (with `map`) for many tiny tasks.

Also check native thread oversubscription: libraries like OpenCV or NumPy's BLAS may spawn their own threads per process; limit them (`OMP_NUM_THREADS=1`) when using many processes.

Alternatives: vectorise with NumPy, use a GPU library, or on Python 3.14's free-threaded build use threads if dependencies support it.

Common wrong answers: `threading` for pure-Python CPU work, or sending full arrays between processes, which can make it slower than serial.

### In an asyncio service, background tasks sometimes silently stop and you see "Task was destroyed but it is pending" or "exception was never retrieved" in logs. How do you fix the design?
<!-- level: advanced; kind: scenario; ref: https://docs.python.org/3/library/asyncio-task.html#creating-tasks -->
Observe: these messages mean tasks were created and then abandoned. "Never retrieved" says a task failed and nobody awaited it, so the error was lost. "Destroyed but pending" says the task object was garbage-collected or the loop shut down while it was still running.

Hypotheses:

- Fire-and-forget `asyncio.create_task(send_email(...))` with no stored reference. The event loop keeps only weak references to tasks, so an unreferenced task can be collected mid-flight.
- No error handling or awaiting of background tasks.
- Shutdown that closes the loop without cancelling and awaiting outstanding tasks.

Fix with structured ownership:

```python
import asyncio, logging
log = logging.getLogger(__name__)

class BackgroundTasks:
    def __init__(self):
        self._tasks: set[asyncio.Task] = set()

    def spawn(self, coro, *, name: str):
        task = asyncio.create_task(coro, name=name)
        self._tasks.add(task)
        task.add_done_callback(self._done)
        return task

    def _done(self, task: asyncio.Task):
        self._tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            log.error("background task %s failed", task.get_name(), exc_info=task.exception())

    async def shutdown(self, timeout: float = 10):
        for t in self._tasks:
            t.cancel()
        await asyncio.wait(self._tasks, timeout=timeout)
```

Where tasks belong to a request or job, use `asyncio.TaskGroup` (3.11+) so the scope waits for them and propagates errors. For work that must survive restarts (emails, payments), use a durable queue (Celery, RQ, Arq, cloud queues) instead of in-process tasks.

Prevent: lint for bare `create_task` calls, hook into app lifespan events for clean shutdown, and alert on the asyncio warning log lines.

Common wrong answer: wrapping everything in `try/except Exception: pass`, which hides the failures you need to see.

### Your async web crawler fails with "Too many open files" and the target sites start returning 429. How do you redesign it?
<!-- level: intermediate; kind: scenario; ref: https://docs.python.org/3/library/asyncio-sync.html#asyncio.Semaphore -->
Observe: the crawler likely does `asyncio.gather` over every URL at once, opening thousands of sockets simultaneously. That exhausts file descriptors locally and looks like an attack to the remote host.

Fix the design in layers:

1. Bound concurrency globally with a semaphore or a fixed pool of worker tasks consuming from a queue.
2. Bound per-host concurrency and rate (for example 2 concurrent and 5 requests per second per domain).
3. Reuse one client so connections are pooled and limited.
4. Respect `429` and `Retry-After` with exponential backoff plus jitter; honour robots.txt.
5. Set timeouts on every request.

```python
import asyncio, random
import httpx

async def worker(name, queue, client, results):
    while True:
        url = await queue.get()
        try:
            for attempt in range(5):
                r = await client.get(url)
                if r.status_code != 429:
                    results[url] = r.status_code
                    break
                delay = float(r.headers.get("Retry-After", 2 ** attempt))
                await asyncio.sleep(delay + random.random())
        except httpx.HTTPError as exc:
            results[url] = repr(exc)
        finally:
            queue.task_done()

async def crawl(urls, concurrency=50):
    queue = asyncio.Queue()
    for u in urls:
        queue.put_nowait(u)
    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=20)
    results = {}
    async with httpx.AsyncClient(timeout=10, limits=limits) as client:
        workers = [asyncio.create_task(worker(i, queue, client, results)) for i in range(concurrency)]
        await queue.join()
        for w in workers:
            w.cancel()
    return results
```

Verify by monitoring open descriptors (`lsof`), response code distribution and throughput as you tune concurrency.

Trade-off: higher concurrency improves throughput until the remote side throttles; polite crawlers optimise for steady success rate, not peak speed. Raising the OS file limit (`ulimit -n`) alone treats the symptom.

### A multi-threaded reporting job produces slightly different totals on each run. How do you diagnose and fix it?
<!-- level: intermediate; kind: scenario; ref: https://docs.python.org/3/library/threading.html#lock-objects -->
Observe: non-deterministic results with the same input signal a race condition: multiple threads perform read-modify-write on shared state without synchronisation. Developers often assume the GIL makes this safe, but operations like `total += amount` or `counts[key] = counts.get(key, 0) + 1` span several bytecodes, and a thread switch can happen between the read and the write.

Hypothesise: find all shared mutable state: module-level counters, dicts shared by workers, objects passed to every thread, non-thread-safe clients (some DB connections, pandas objects being mutated).

Verify: reproduce by running the job many times with a small dataset and more threads; races appear more often under contention. Adding a short `time.sleep(0)` in the critical section can make them deterministic for a test.

Fix, in order of preference:

1. Remove shared mutation: each worker computes a partial result and returns it; the main thread merges.

```python
from concurrent.futures import ThreadPoolExecutor
from collections import Counter

def summarise(chunk) -> Counter:
    c = Counter()
    for row in chunk:
        c[row["region"]] += row["amount"]
    return c

with ThreadPoolExecutor(8) as pool:
    total = sum(pool.map(summarise, chunks), Counter())
```

2. If sharing is unavoidable, protect it with a `threading.Lock` held around the full read-modify-write.
3. Use thread-safe structures such as `queue.Queue` for hand-offs.

Prevent: prefer message passing or map-reduce patterns, give each thread its own DB connection, and add a determinism test that runs the job repeatedly. This matters more with free-threaded Python (3.13+), where races become more frequent.

Common wrong answer: "Python has a GIL so it's thread-safe". The GIL protects interpreter internals, not your logic.

### A multiprocessing job occasionally hangs forever on Linux but never on macOS or Windows. What could cause it?
<!-- level: advanced; kind: scenario; ref: https://docs.python.org/3/library/multiprocessing.html#contexts-and-start-methods -->
Observe: get stack traces of the stuck processes with `py-spy dump --pid` for the parent and children. Note that macOS and Windows use the `spawn` start method by default, while Linux used `fork` before Python 3.14, which is a strong clue.

Hypothesis: `fork` copies the parent's memory, including locks, but only the forking thread survives in the child. If another thread (a logging handler thread, a database pool, a gRPC or metrics client) held a lock at fork time, the child inherits a locked lock that nobody will ever release, and the first time the child logs or uses that client it deadlocks. Python 3.12+ warns with a `DeprecationWarning` when forking a multi-threaded process.

Other hypotheses to rule out: a child process killed by the OOM killer (the pool then waits forever on a result in some APIs), large results blocking a pipe while the parent waits on `join()` before reading, or a worker waiting on a queue that is never fed.

Fix:

```python
import multiprocessing as mp

if __name__ == "__main__":
    ctx = mp.get_context("spawn")             # or "forkserver"
    with ctx.Pool(processes=8, maxtasksperchild=200) as pool:
        for result in pool.imap_unordered(process_file, paths, chunksize=8):
            handle(result)
```

- Use `spawn` or `forkserver` explicitly (forkserver is the default on Linux from Python 3.14).
- Create threads, clients and connections inside workers (via an `initializer`), not in the parent before forking.
- Add timeouts to `result()` calls and monitor child exit codes.
- Prefer `concurrent.futures.ProcessPoolExecutor`, which raises `BrokenProcessPool` if a worker dies instead of hanging.

Prevent: run CI on Linux with the same start method as production, and keep the parent process free of background threads before creating pools.

### A CLI tool and a serverless function take many seconds just to start. How do you reduce Python startup time?
<!-- level: intermediate; kind: scenario; ref: https://docs.python.org/3/using/cmdline.html#cmdoption-X -->
Observe: measure where startup time goes. Python has a built-in import profiler:

```bash
python -X importtime -c "import mytool.cli" 2> imports.log
# then sort by cumulative time, or visualise with the 'tuna' tool
```

Typical findings: heavy libraries (pandas, torch, cloud SDKs, matplotlib) imported at module top level even for commands that never use them; import-time side effects (reading config files, connecting to databases, scanning plugins); and large dependency trees.

Fixes:

1. Lazy imports: import heavy modules inside the functions or subcommands that need them.

```python
def export_excel(path):
    import pandas as pd          # only paid for when this command runs
    ...
```

2. Module-level `__getattr__` (PEP 562) in packages to defer loading submodules until first access.
3. Remove import-time work: replace module-level clients with lazily created ones (`functools.cache` on a getter).
4. Trim dependencies: replace a giant SDK used for one call with a smaller client or direct HTTP.
5. Ensure bytecode caching works: read-only file systems or `PYTHONDONTWRITEBYTECODE` force recompilation every start; precompile with `python -m compileall` in the image.
6. For serverless: keep clients in global scope after first creation so warm invocations reuse them, use provisioned concurrency for latency-critical paths, and keep the deployment package small.

Verify by re-running `-X importtime` and timing cold starts.

Trade-off: lazy imports move errors (missing dependency) from startup to first use; cover each command path with a smoke test. Do not micro-optimise imports for long-running servers where startup happens once.

### You inherit a 100,000-line untyped Python codebase with frequent production `AttributeError` and `TypeError` bugs. How do you introduce typing without stopping feature work?
<!-- level: intermediate; kind: scenario; ref: https://mypy.readthedocs.io/en/stable/existing_code.html -->
Observe: categorise recent incidents. If most are None-handling, wrong dict keys or mismatched function arguments, static typing will catch a large share of them.

Plan an incremental rollout:

1. Add a type checker (mypy or pyright) to CI in a permissive mode so it passes on day one: ignore missing imports, do not require annotations everywhere.
2. Make new and changed code typed: enforce stricter settings per module via configuration overrides, so the strict zone grows with normal work.
3. Type the boundaries first: public functions of core modules, API request/response models, data access layers. Replace loose dicts flowing through the system with dataclasses, `TypedDict` or Pydantic models; this alone removes many key-error bugs.
4. Enable `strict_optional` early, because `None` mistakes are the most common bug class.
5. Use tools to bootstrap: `MonkeyType` or pyright's inference to draft annotations; install `types-*` stub packages for libraries.
6. Track a metric (percentage of modules in strict mode, count of `type: ignore`) and celebrate progress.

```toml
[tool.mypy]
python_version = "3.12"
ignore_missing_imports = true
warn_unused_ignores = true

[[tool.mypy.overrides]]
module = ["billing.*", "orders.api.*"]
strict = true
```

Verify value: track production `TypeError`/`AttributeError` counts before and after.

Trade-offs: typing has a learning curve and some dynamic patterns are awkward to express; allow `Any` at genuine boundaries with comments. Runtime validation (Pydantic) is still needed for untrusted input because type hints are not enforced.

Common wrong answer: a "big bang" week of annotating everything, which stalls delivery and produces low-quality `Any`-heavy hints.

### A pandas transformation over 10 million rows takes 40 minutes. How do you speed it up?
<!-- level: intermediate; kind: scenario; ref: https://pandas.pydata.org/docs/user_guide/enhancingperf.html -->
Observe: profile which step is slow. Typical offenders are `df.apply(func, axis=1)`, `iterrows`/`itertuples` loops, string operations on `object` columns, repeated `concat` inside loops, and merges on mismatched key types.

Hypothesise and fix step by step:

1. Vectorise row-wise logic with column operations, `np.where`, `np.select`, or `Series.map` with a dict.

```python
import numpy as np
# Slow: python function per row
df["tier"] = df.apply(lambda r: "gold" if r.spend > 1000 else ("silver" if r.spend > 200 else "bronze"), axis=1)

# Fast: vectorised
df["tier"] = np.select([df.spend > 1000, df.spend > 200], ["gold", "silver"], default="bronze")
```

2. Fix dtypes: convert low-cardinality strings to `category`, use numeric downcasting, and consider the PyArrow-backed string dtype; this cuts memory and speeds groupby.
3. Avoid growing DataFrames in loops; collect parts in a list and `pd.concat` once.
4. Read only needed columns and use Parquet instead of CSV.
5. For group-wise logic use built-in aggregations (`groupby().agg`) rather than `groupby().apply` with Python functions.
6. If still slow, switch engines: Polars or DuckDB run multi-threaded with query optimisation and often deliver large speedups for the same logic.

Verify each change with timing on a representative sample and check outputs are identical (`pd.testing.assert_frame_equal`).

Trade-offs: vectorised expressions can be less readable; add comments or helper functions. Moving to Polars means a new API for the team, but it pays off for recurring heavy jobs.

Common wrong answer: parallelising `apply` across processes first. It multiplies resource usage while the 50x win from vectorisation is left on the table.

### Tests pass locally but fail randomly in CI about 5% of the time. How do you deal with flaky tests?
<!-- level: intermediate; kind: scenario; ref: https://docs.pytest.org/en/stable/explanation/flaky.html -->
Observe: collect data before fixing. Which tests fail, how often, on which runners, and do they fail alone or only in the full suite? Rerun the suite many times and in random order (`pytest-randomly`, `pytest -p randomly`), and run a single suspect test in a loop (`pytest-repeat`, `--count=200`).

Common root causes:

- Order dependence: shared global state, module-level caches, database rows left by another test, monkeypatching that leaks.
- Time: tests using `datetime.now()`, time zones, or sleeping for "long enough" for a thread or async task.
- Concurrency: parallel runs (`pytest-xdist`) sharing a database, port or temp file name.
- External dependencies: real network calls, DNS, rate limits.
- Unordered data: asserting on the order of set iteration or unordered SQL results.
- Resource limits: CI machines are slower, exposing tight timeouts.

Fix the cause, not the symptom:

```python
import pytest
from datetime import datetime, timezone

def test_invoice_due_date(monkeypatch):
    fixed = datetime(2026, 1, 31, tzinfo=timezone.utc)
    monkeypatch.setattr("billing.clock.now", lambda: fixed)   # inject the clock
    assert billing.due_date() == datetime(2026, 2, 28, tzinfo=timezone.utc)

def test_jobs_finish(event_waiter):
    start_job()
    assert event_waiter.wait(timeout=5)     # wait for a signal, not a fixed sleep
```

Use unique temp paths (`tmp_path`), per-worker databases with xdist, sorted comparisons, and fakes for network calls.

Prevent: quarantine known-flaky tests with a tracking ticket rather than ignoring red builds, track flake rate as a metric, and require random ordering in CI.

Common wrong answer: adding automatic reruns (`--reruns 3`) as the fix. Reruns can be a temporary stopgap but they hide real race conditions that also happen in production.

### Your test suite has grown to 40 minutes and developers have stopped running it. How do you make it fast again?
<!-- level: intermediate; kind: scenario; ref: https://docs.pytest.org/en/stable/how-to/usage.html -->
Observe: measure where the time goes.

```bash
pytest --durations=30          # slowest tests and fixtures
pytest --collect-only -q | tail -1    # number of tests; also time the collection phase
```

Typical findings: a few hundred integration tests each creating a fresh database; expensive fixtures with function scope; real `sleep` calls; network calls; heavy imports at collection time; and many redundant end-to-end tests duplicating unit coverage.

Fixes by impact:

1. Parallelise with `pytest-xdist` (`-n auto`), after making tests isolated (unique DB schema per worker, unique temp dirs).
2. Fix fixture scopes: create the database schema once per session and wrap each test in a transaction rolled back at the end.
3. Replace sleeps with event waits or fake clocks.
4. Remove network calls with fakes or recorded responses.
5. Push tests down the pyramid: test business rules as pure unit tests instead of through HTTP and the database.
6. Split the pipeline: fast unit tests on every push, slower integration and end-to-end suites in parallel CI jobs or before merge. Mark them with `@pytest.mark.slow` or `integration`.
7. Run only affected tests locally with tools like `pytest-testmon`.

```python
@pytest.fixture
def db_session(engine):                 # engine is session-scoped
    conn = engine.connect()
    tx = conn.begin()
    session = Session(bind=conn)
    yield session
    session.close()
    tx.rollback()                       # fast cleanup, no recreation
    conn.close()
```

Verify: track total and p95 test duration in CI and set a budget (for example, unit tests under 3 minutes).

Trade-off: transaction-rollback isolation does not exercise commit behaviour; keep a small set of tests that run against real commits.

### A partner's API rate-limits you and sometimes times out. How do you design a robust Python client for it?
<!-- level: intermediate; kind: scenario; ref: https://www.python-httpx.org/advanced/timeouts/ -->
Goals: never hang, never overload the partner, recover from transient failures, and never duplicate side effects.

Design elements:

1. Timeouts on every call, split into connect and read timeouts.
2. Retries only for transient errors (connection errors, 429, 502, 503, 504) with exponential backoff, jitter and a cap. Never blindly retry 400-level validation errors.
3. Honour `Retry-After` on 429.
4. Idempotency: only retry non-idempotent operations (POST payments) if the API supports idempotency keys; send the same key on every attempt.
5. Client-side rate limiting to stay under the quota (a token bucket shared across workers, often in Redis).
6. Circuit breaker: after repeated failures, fail fast for a cooldown so your service stays responsive.
7. Observability: log attempt counts, latency, status codes; metrics per endpoint.

```python
import random, time, uuid
import httpx

RETRYABLE = {429, 502, 503, 504}

def create_shipment(client: httpx.Client, payload: dict, max_attempts: int = 5) -> dict:
    key = str(uuid.uuid4())
    for attempt in range(1, max_attempts + 1):
        try:
            r = client.post("/shipments", json=payload,
                            headers={"Idempotency-Key": key},
                            timeout=httpx.Timeout(10, connect=3))
            if r.status_code not in RETRYABLE:
                r.raise_for_status()
                return r.json()
            wait = float(r.headers.get("Retry-After", 0)) or min(30, 2 ** attempt)
        except (httpx.ConnectError, httpx.ReadTimeout):
            wait = min(30, 2 ** attempt)
        if attempt == max_attempts:
            raise RuntimeError("shipment API unavailable")
        time.sleep(wait * (0.5 + random.random()))
```

Libraries like `tenacity` or `stamina` implement retry policies declaratively.

Trade-offs: aggressive retries increase load on an already struggling service (retry storms); combine them with backoff, a retry budget and circuit breaking. For non-urgent work, push calls to a queue and process them asynchronously.

### You are asked to publish an internal Python library used by 20 teams. How do you set up packaging, versioning and releases?
<!-- level: intermediate; kind: scenario; ref: https://packaging.python.org/en/latest/tutorials/packaging-projects/ -->
Goals: easy installation, predictable upgrades, and minimal dependency conflicts for consumers.

Steps:

1. Project layout: `src/` layout, `pyproject.toml` with a modern build backend, `py.typed` marker so consumers get type hints.
2. Metadata: `requires-python` set to the versions you test; dependencies with lower bounds and no unnecessary upper caps (tight caps cause conflicts across 20 services).
3. Public API: expose a curated API in `__init__.py` with `__all__`; prefix internals with `_`. Everything public is a compatibility promise.
4. Versioning: semantic versioning. Breaking changes only in major releases, preceded by `DeprecationWarning` (or `@warnings.deprecated` in 3.13+) for at least one minor release.
5. CI: test matrix across supported Python versions and against minimum and latest dependency versions; lint and type-check.
6. Release automation: tag-driven pipeline that builds wheel and sdist (`python -m build`), publishes to a private index (Artifactory, Azure Artifacts, AWS CodeArtifact, GitLab registry) using short-lived credentials, and generates a changelog.
7. Documentation: usage examples, migration guides for majors.

```toml
[project]
name = "acme-payments-client"
dynamic = ["version"]              # version from git tags (e.g. hatch-vcs / setuptools-scm)
requires-python = ">=3.10"
dependencies = ["httpx>=0.27", "pydantic>=2.5"]

[project.optional-dependencies]
async = ["anyio>=4"]
```

Consumers pin the library in their lock files and upgrade via Renovate PRs, so they get fixes without surprises.

Trade-offs: a monorepo with path dependencies avoids publishing overhead but couples release cycles. Shared libraries should stay small; large "common" packages become dependency magnets that force everyone to upgrade together.

Common wrong answers: copying the code into each repo, or installing from a git branch, which gives no immutable versions.

### Your team must upgrade a large service from Python 3.9 to Python 3.13 or 3.14. How do you plan it?
<!-- level: advanced; kind: scenario; ref: https://docs.python.org/3/whatsnew/index.html -->
Observe: inventory what can break. Read the "What's New" pages for every version in between, focusing on removals and deprecations: `distutils` removed in 3.12; dead-battery modules (`cgi`, `telnetlib`, `imghdr`, `crypt` and others) removed in 3.13; `datetime.utcnow()` deprecated in 3.12; multiprocessing's default start method on Linux changed to `forkserver` in 3.14; annotations evaluated lazily in 3.14.

Plan:

1. Dependencies first: check every package supports the target version (wheels available, especially compiled ones). Upgrade dependencies on the current Python where possible to shrink the jump.
2. Turn on warnings now: run tests with `-W error::DeprecationWarning` (filtering third-party noise) on 3.9 to surface future breakages early.
3. CI matrix: add the target version as a non-blocking job, fix failures, then make it blocking.
4. Automated modernisation: `pyupgrade` or ruff's `UP` rules convert syntax (e.g. `Optional[X]` to `X | None`) once the minimum version allows.
5. Performance and behaviour check: run benchmarks and a canary deployment; most services get faster (3.11+ improvements), but verify memory and latency.
6. Roll out gradually: canary, then percentage-based, with fast rollback by keeping the old image available.
7. Update base images, linters, type checker targets and `requires-python`.

```bash
python3.13 -m venv .venv313 && .venv313/bin/python -m pip install -r requirements.lock
.venv313/bin/python -W error::DeprecationWarning -m pytest
```

Trade-offs: jumping directly to the newest version maximises support lifetime, but if a critical dependency lags, an intermediate stop (3.12) may be pragmatic. Python versions receive about five years of support, so plan upgrades as recurring work, not crises.

Common wrong answer: upgrading the interpreter and dependencies in one big-bang change without a staged rollout.

### A web request triggers a 5-minute report generation, and users see gateway timeouts. How do you redesign it?
<!-- level: intermediate; kind: scenario; ref: https://docs.celeryq.dev/en/stable/getting-started/introduction.html -->
Observe: HTTP proxies and load balancers typically time out after 30 to 120 seconds, and holding a worker for minutes reduces capacity for everyone. Long work does not belong in the request-response cycle.

Redesign as an asynchronous job:

1. `POST /reports` validates the request, stores a job record (status `queued`) and enqueues a task; returns `202 Accepted` with a job id and status URL.
2. Worker processes (Celery, RQ, Dramatiq, Arq, or a cloud queue with consumers) run the job, update progress, and store the result in object storage.
3. Clients poll `GET /reports/{id}`, or receive a webhook, WebSocket or email when done; the result is a signed download URL.

```python
@app.post("/reports", status_code=202)
def request_report(params: ReportParams, user=Depends(current_user)):
    job = jobs.create(user_id=user.id, params=params.model_dump(), status="queued")
    generate_report.delay(job.id)                     # Celery task
    return {"job_id": job.id, "status_url": f"/reports/{job.id}"}

@celery_app.task(bind=True, acks_late=True, max_retries=3)
def generate_report(self, job_id: str):
    job = jobs.get(job_id)
    if job.status == "done":                          # idempotent on redelivery
        return
    jobs.update(job_id, status="running")
    url = build_and_upload(job.params)
    jobs.update(job_id, status="done", result_url=url)
```

Design concerns: idempotency (tasks may be delivered twice with `acks_late`), retries with backoff, per-user limits so one user cannot flood the queue, deduplication of identical requests, job expiry and cleanup, and monitoring queue depth and age.

Also question whether 5 minutes is necessary: profile the report query, add indexes or pre-aggregated tables, and cache results for common parameters.

Trade-offs: a queue adds infrastructure (broker, workers, monitoring) but isolates slow work and scales independently. FastAPI's `BackgroundTasks` runs in the same process and is lost on restart, so it suits only small, non-critical work.

### A recursive function that walks a nested category tree crashes with RecursionError on some customer data. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://docs.python.org/3/library/sys.html#sys.setrecursionlimit -->
Observe: `RecursionError` means the depth exceeded the interpreter's recursion limit (1000 by default). Check the failing data: is the tree genuinely deep (thousands of levels) or is there a cycle, such as a category that is its own ancestor due to bad data? Cycles are more common than truly deep trees.

Verify by logging the path depth and detecting repeated ids.

Fix:

1. Detect cycles with a visited set and report bad data instead of recursing forever.
2. Convert recursion to iteration with an explicit stack, which handles any depth limited only by memory.

```python
def walk_categories(root_id: int, children: dict[int, list[int]]) -> list[int]:
    order, stack, seen = [], [root_id], set()
    while stack:
        node = stack.pop()
        if node in seen:
            raise ValueError(f"cycle detected at category {node}")
        seen.add(node)
        order.append(node)
        stack.extend(reversed(children.get(node, [])))   # preserve left-to-right order
    return order
```

For trees stored in a database, a recursive CTE (`WITH RECURSIVE`) can compute the hierarchy in SQL with a depth limit.

Why not just raise the limit? `sys.setrecursionlimit(100_000)` can crash the process with a C-level stack overflow (segfault) instead of a clean exception, because the real limit is the thread's C stack size. Recent CPython versions have changed how stack depth is protected, but deep recursion remains fragile and slow due to per-call overhead. Python also has no tail-call optimisation.

Prevent: enforce invariants at write time (reject moves that create cycles), add a maximum depth rule, and include deep and cyclic cases in tests (Hypothesis can generate random trees).

### Users in some countries see daily reports dated one day off. How do you track down and fix the bug?
<!-- level: intermediate; kind: scenario; ref: https://docs.python.org/3/library/datetime.html#aware-and-naive-objects -->
Observe: collect examples with the user's time zone, the event timestamps and the report date shown. Off-by-one-day errors that depend on geography almost always come from mixing naive and aware datetimes or from converting time zones at the wrong step.

Hypotheses:

- Timestamps stored as naive values in server-local time, while servers run in UTC in one region and local time in another.
- Using `datetime.utcnow()` (naive) and then treating the result as local time.
- Grouping by `date(timestamp)` in UTC, when the business day should be in the user's zone: an order at 01:00 IST on 5 March is 19:30 UTC on 4 March.
- Database settings converting timezone-aware columns using the session time zone.
- DST transitions for regions like Europe or the US.

Verify with targeted tests around midnight and DST boundaries.

Fix:

```python
from datetime import datetime, UTC
from zoneinfo import ZoneInfo

def business_date(ts_utc: datetime, tz_name: str):
    if ts_utc.tzinfo is None:
        raise ValueError("naive datetime not allowed")
    return ts_utc.astimezone(ZoneInfo(tz_name)).date()

event = datetime(2026, 3, 4, 19, 30, tzinfo=UTC)
business_date(event, "Asia/Kolkata")     # date(2026, 3, 5)
```

Rules: store instants as timezone-aware UTC (`timestamptz` in PostgreSQL), keep the user's IANA time zone as a separate field, convert only at the edges, and define the business day explicitly per report. In SQL, group with `date_trunc('day', ts AT TIME ZONE 'Asia/Kolkata')`.

Prevent: lint against `utcnow()` and naive `now()`, use aware datetimes everywhere, freeze time in tests (`time-machine`, `freezegun`), and include boundary cases.

Common wrong answer: adding or subtracting a fixed offset like 5.5 hours, which breaks for every other zone and for DST.

### An endpoint returns a 50 MB JSON response and the service's memory and latency spike whenever it is called. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://fastapi.tiangolo.com/advanced/custom-response/ -->
Observe: measure who calls it and why. A 50 MB response means the server builds the full object list in memory, serialises it into one big string (often doubling memory), and the client then parses it all. Multiple concurrent calls multiply that.

Hypothesise the real requirement: do clients need everything at once (an export) or page through records (a UI list)?

Fixes depending on use case:

1. Pagination for interactive use: cursor-based pages of 100 to 1,000 records with filters, so most calls return small responses.
2. Streaming for exports: generate records lazily from a server-side database cursor and stream newline-delimited JSON or CSV, so memory stays constant.

```python
from fastapi.responses import StreamingResponse
import json

@app.get("/v1/orders/export")
async def export_orders(since: str):
    async def rows():
        async for order in repo.iter_orders(since=since, batch_size=1000):   # server-side cursor
            yield json.dumps(order) + "\n"
    return StreamingResponse(rows(), media_type="application/x-ndjson")
```

3. Asynchronous export for very large data: create a job that writes a compressed file to object storage and returns a signed URL.
4. Shrink payloads: return only needed fields, enable gzip or zstd compression, and use a faster serialiser (orjson).
5. Cache results if the data changes rarely.

Verify with load tests measuring peak memory per request and latency.

Trade-offs: streaming responses cannot change the HTTP status after starting, so errors mid-stream must be signalled in-band (a final error record) and clients must handle truncation. Pagination requires stable sort keys to avoid duplicates or gaps.

Common wrong answer: raising container memory limits, which only postpones the outage until data grows again.

### How would you manage configuration and secrets for a Python service deployed to dev, staging and production?
<!-- level: intermediate; kind: scenario; ref: https://docs.pydantic.dev/latest/concepts/pydantic_settings/ -->
Principles: configuration that varies by environment comes from the environment (twelve-factor), the same artifact runs everywhere, secrets never live in source control, and invalid configuration fails at startup rather than at 3 a.m.

Design:

1. A single typed settings object loaded once at startup, validated with `pydantic-settings`.
2. Non-secret defaults in code; environment-specific values from environment variables or a config service.
3. Secrets from a secret manager (Azure Key Vault, AWS Secrets Manager, GCP Secret Manager, Vault), injected as environment variables or mounted files by the platform, ideally using managed identities instead of static credentials.
4. Local development uses a `.env` file listed in `.gitignore`, with a committed `.env.example`.

```python
from pydantic import Field, PostgresDsn, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ORDERS_", env_file=".env")

    environment: str = "dev"
    database_url: PostgresDsn
    payment_api_key: SecretStr                  # masked in repr and logs
    request_timeout_s: float = Field(5.0, gt=0, le=60)
    feature_new_checkout: bool = False

settings = Settings()                            # raises ValidationError if invalid
```

Access settings via dependency injection or a cached getter so tests can override them.

Operational concerns: rotate secrets without redeploying (read them periodically or restart on rotation), scan repositories for leaked secrets (pre-commit hooks, GitHub secret scanning), and never log settings objects with raw secrets.

Trade-offs: environment variables are simple but visible to anything that can read the process environment; mounted files or SDK fetches with short-lived tokens are safer for highly sensitive keys.

Common wrong answers: `config_prod.py` committed with passwords, or branching code on `if env == "prod"` scattered throughout the codebase.

### A batch job fails with UnicodeDecodeError on files coming from several partners. How do you make ingestion robust?
<!-- level: intermediate; kind: scenario; ref: https://docs.python.org/3/howto/unicode.html -->
Observe: note the byte position and the offending bytes from the error, for example `0xe9`. That byte is "é" in Latin-1/cp1252 but invalid as standalone UTF-8, so a partner is probably exporting from Excel or a legacy system in a Windows code page. Also check whether the code opens files without an explicit encoding, which uses the platform default and behaves differently on Windows and Linux.

Fix in layers:

1. Agree on a contract: ask partners for UTF-8. It is the long-term fix.
2. Be explicit: always pass `encoding=` when opening text files.
3. Handle known variants: UTF-8 with BOM (`utf-8-sig`, common from Excel), cp1252, UTF-16.
4. Detect when unknown: try UTF-8 strictly first, fall back to configured per-partner encodings, and as a last resort use a detection library (charset-normalizer) with a confidence threshold.
5. Quarantine instead of crashing: if a file cannot be decoded reliably, move it to a dead-letter location with an alert rather than silently corrupting data.

```python
from pathlib import Path

PARTNER_ENCODINGS = {"acme": ["utf-8-sig", "cp1252"], "default": ["utf-8-sig"]}

def read_partner_file(path: Path, partner: str) -> str:
    raw = path.read_bytes()
    for enc in PARTNER_ENCODINGS.get(partner, PARTNER_ENCODINGS["default"]):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError(f"{path.name}: unsupported encoding for {partner}")
```

Note that cp1252 decodes almost any byte sequence without error, so a successful decode is not proof of correctness; validate content (expected headers, sample known values).

Trade-off: `errors="replace"` keeps the pipeline running but silently replaces characters, corrupting names and addresses; use it only for logs, never for business data.

Prevent: store everything internally as UTF-8, run with `-X utf8` or `PYTHONUTF8=1` until Python makes UTF-8 mode the default, and include non-ASCII fixtures in tests.

### A Django application starts throwing "too many connections" database errors during traffic peaks. How do you investigate and fix it?
<!-- level: advanced; kind: scenario; ref: https://docs.djangoproject.com/en/stable/ref/databases/#persistent-connections -->
Observe: count connections at the database (`pg_stat_activity`) grouped by application and state. Compare with your deployment math: processes times threads (or async tasks) per process times pods, plus Celery workers, cron jobs and admin tools.

Hypotheses:

- Too many workers: 20 pods times 4 Gunicorn workers times 8 threads can need 640 connections, while PostgreSQL might allow 200.
- Connections not reused: `CONN_MAX_AGE=0` opens and closes per request, causing churn; or persistent connections held by idle workers.
- Leaks: background threads or scripts opening connections outside the request cycle and never closing them.
- Long transactions: slow queries or `idle in transaction` sessions holding connections, causing pile-ups.

Fixes:

1. Add a connection pooler: PgBouncer in transaction mode lets many app connections share a small number of server connections. Django 5.1 also added native connection pooling for PostgreSQL via psycopg's pool (`"OPTIONS": {"pool": True}`).
2. Right-size concurrency: align worker and thread counts with what the database can serve; more connections beyond the database's core count usually reduces throughput.
3. Fix slow queries and N+1 patterns so each request holds a connection briefly; add indexes found via `EXPLAIN ANALYZE`.
4. Set timeouts: `statement_timeout` and `idle_in_transaction_session_timeout`.
5. Close connections in long-running non-request code (`django.db.close_old_connections()`).

```python
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": {"options": "-c statement_timeout=5000"},
    }
}
```

Prevent: monitor connection counts and pool wait time, and include the database budget in capacity planning before scaling pods.

Common wrong answer: raising `max_connections` to thousands; each PostgreSQL connection is a process with memory overhead, so this often makes performance worse.

### Should your team adopt free-threaded Python (3.13t/3.14t) for a CPU-heavy service? How do you evaluate it?
<!-- level: advanced; kind: scenario; ref: https://docs.python.org/3/howto/free-threading-python.html -->
Start from the problem: the service is CPU-bound and currently uses multiprocessing (high memory, serialisation overhead) or cannot scale across cores. Free-threaded CPython removes the GIL so threads can run Python bytecode in parallel. In 3.13 it was experimental; in 3.14 it is officially supported but still an optional build.

Evaluation plan:

1. Dependency audit: every compiled extension must support free-threading and publish `cp313t`/`cp314t` wheels. If one does not, the interpreter re-enables the GIL on import (with a warning), and you get no benefit. Check NumPy, your database driver, serialisation and observability libraries.
2. Thread-safety audit: code that relied on the GIL implicitly (shared dicts, global caches, lazy singletons) may now race more often. Review shared state; add locks or redesign with message passing.
3. Benchmark: compare current architecture (processes) against the free-threaded build with threads, measuring throughput, p99 latency and memory. Single-threaded code is somewhat slower on the free-threaded build, so the gain must come from parallelism.
4. Pilot: run a canary with production traffic, watch error rates and crash reports (native extensions are where rare bugs show up).

```python
import sys
print(sys.version, "GIL enabled:", sys._is_gil_enabled())
```

Alternatives to compare: process pools with shared memory, subinterpreters (`concurrent.interpreters` in 3.14), pushing the hot loop into NumPy/Numba/Rust, or simply horizontal scaling with more containers.

Recommendation framing: adopt when dependencies are ready and benchmarks show meaningful gains; otherwise keep it as a tracked experiment. Common wrong answer: "Python no longer has a GIL, so just switch." The default build still has it, and ecosystem readiness determines the real outcome.

### Production incidents are hard to debug because logs are noisy, unstructured and lack context. How would you redesign logging and observability for a Python service?
<!-- level: intermediate; kind: scenario; ref: https://docs.python.org/3/howto/logging-cookbook.html -->
Observe: during the last incident, what question could you not answer? Usually: which request or user hit the error, what happened before it, and how often it occurs.

Design:

1. Structured JSON logs with consistent fields: timestamp, level, logger, message, service, version, environment, request_id/trace_id, user or tenant id (non-sensitive), and duration.
2. Context propagation: generate or accept a request id at the edge; store it in a `contextvars.ContextVar` so it is attached to every log line in that request, including in async code.
3. Levels with discipline: INFO for business events, WARNING for recoverable problems, ERROR with stack traces via `logger.exception`, DEBUG off in production but switchable.
4. Reduce noise: lower third-party loggers to WARNING; sample high-volume success logs.
5. Metrics and traces beside logs: OpenTelemetry for distributed traces, Prometheus-style metrics for rates, errors and durations. Logs explain, metrics alert, traces locate.
6. Never log secrets or full personal data; add redaction filters.

```python
import contextvars, logging, json

request_id = contextvars.ContextVar("request_id", default="-")

class ContextFilter(logging.Filter):
    def filter(self, record):
        record.request_id = request_id.get()
        return True

class JsonFormatter(logging.Formatter):
    def format(self, record):
        payload = {"ts": self.formatTime(record), "level": record.levelname,
                   "logger": record.name, "msg": record.getMessage(),
                   "request_id": record.request_id}
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)
```

Trade-offs: verbose logs cost money in log platforms; decide retention and sampling deliberately. Structured logs are harder to read locally, so use a human-readable formatter in development.

Common wrong answer: adding more `print` statements or logging entire request bodies.

### You must expose an ML model whose inference takes about 2 seconds on GPU through a Python API serving hundreds of requests per minute. How do you design it?
<!-- level: advanced; kind: scenario; ref: https://fastapi.tiangolo.com/async/ -->
Observe the requirements: latency target per request, peak throughput, GPU count and memory, whether requests can be batched, and whether callers can accept asynchronous results.

Design:

1. Separate the API layer from inference workers. A lightweight FastAPI service handles auth, validation and queuing; GPU workers run the model. This lets you scale each independently and keeps the API responsive.
2. Batching: GPUs are far more efficient on batches. Use dynamic batching (collect requests for up to a few milliseconds or until the batch is full) via a serving framework such as NVIDIA Triton, TorchServe, Ray Serve or a model-specific server like vLLM for LLMs.
3. Synchronous vs asynchronous: if 2 to 3 seconds is acceptable, keep a synchronous endpoint with timeouts; for longer or bursty loads, return a job id and deliver results by polling or webhook.
4. Load model once per worker at startup (FastAPI lifespan), never per request; warm up to avoid first-request latency.
5. Back-pressure: bounded queues with `429`/`503` when full, rather than unbounded waiting.
6. Never run inference inside the event loop: use a separate process or server, or `run_in_executor` with a process pool.

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.client = InferenceClient(url="http://triton:8000", timeout=10)
    yield
    await app.state.client.close()

app = FastAPI(lifespan=lifespan)

@app.post("/v1/classify")
async def classify(req: ClassifyIn):
    return await app.state.client.infer(req.text)     # async call to the GPU service
```

Measure: GPU utilisation, queue depth, p50/p95/p99 latency, and cost per thousand requests.

Trade-offs: larger batches raise throughput but add queueing latency; quantisation or smaller models reduce latency at some accuracy cost; caching identical inputs helps when requests repeat.

### You need to remove duplicate customer records from 200 million rows on a machine with 16 GB RAM. How?
<!-- level: advanced; kind: scenario; ref: https://duckdb.org/docs/ -->
Observe: define "duplicate". Exact duplicates (same normalised email) are a hashing problem; fuzzy duplicates (typos in names and addresses) are an entity-resolution problem that needs blocking and similarity scoring. Check data size: 200M rows with a few columns may be 20 to 60 GB, larger than RAM.

Exact duplicates:

1. Normalise keys (lowercase, trim, canonical phone format).
2. Let an out-of-core engine do the work: DuckDB spills to disk when memory is exceeded and can deduplicate with window functions.

```python
import duckdb
con = duckdb.connect("dedupe.duckdb")
con.execute("SET memory_limit = '10GB'; SET temp_directory = '/data/tmp'")
con.execute("""
    COPY (
      SELECT * EXCLUDE (rn) FROM (
        SELECT *, row_number() OVER (
                 PARTITION BY lower(trim(email)) ORDER BY updated_at DESC) AS rn
        FROM read_parquet('customers/*.parquet'))
      WHERE rn = 1
    ) TO 'customers_dedup.parquet' (FORMAT parquet)
""")
```

3. Pure-Python alternative: partition by hash of the key into N files on disk (so each partition fits in memory), then dedupe each partition with a dict. This is the classic external hashing approach.

Fuzzy duplicates: generate candidate pairs only within blocks (same postcode plus first letter of surname), score with string similarity (e.g. rapidfuzz), and use a threshold plus manual review for borderline cases. Libraries like Splink do probabilistic record linkage at scale.

Verify: count rows before and after, sample merged groups for manual review, and keep a mapping table from old ids to surviving ids so downstream references can be updated.

Trade-offs: a Bloom filter uses little memory to detect "probably seen" keys but has false positives, which would delete legitimate records, so it is unsuitable as the sole dedup decision.

Common wrong answer: loading everything into a pandas DataFrame and calling `drop_duplicates`.

### During code review you find a 600-line function full of nested try/except blocks that swallow errors. How do you refactor it safely?
<!-- level: intermediate; kind: scenario; ref: https://docs.python.org/3/tutorial/errors.html#handling-exceptions -->
Observe: understand current behaviour before changing it. Swallowed exceptions (`except Exception: pass` or `return None`) mean the function may be "succeeding" in production while silently producing partial results. Check logs and data for signs of hidden failures.

Plan:

1. Characterisation tests: write tests that pin the current outputs for representative inputs (including weird ones), so refactoring cannot change behaviour unknowingly. Snapshot or approval testing helps for complex outputs.
2. Make failures visible first: replace silent passes with `logger.exception(...)` plus the existing fallback. Deploy and observe which exceptions actually occur. This is low risk and high information.
3. Extract functions: split the body into well-named steps (`parse_input`, `validate`, `price_items`, `persist`), each small and testable. Move pure logic away from I/O.
4. Narrow exception handling: catch specific exceptions at the level that can do something meaningful; let others propagate to a single boundary handler that logs and returns an error.
5. Replace error-code returns with explicit exceptions or result types, and use custom exception classes for business errors.

```python
# Before
try:
    try:
        price = float(row["price"])
    except Exception:
        price = 0
    ...
except Exception:
    pass

# After
class InvalidRow(ValueError): ...

def parse_price(raw: str) -> Decimal:
    try:
        return Decimal(raw)
    except InvalidOperation as e:
        raise InvalidRow(f"bad price {raw!r}") from e
```

6. Refactor in small, reviewable commits, each passing the tests.

Trade-off: surfacing errors may initially increase failure rates that were previously hidden; agree with stakeholders how invalid records should be handled (reject, quarantine, or default) instead of deciding implicitly in code.

Common wrong answer: rewriting the function from scratch in one pull request without tests.

### How would you secure a Python web API against injection and unsafe deserialisation vulnerabilities?
<!-- level: advanced; kind: scenario; ref: https://docs.python.org/3/library/pickle.html -->
Think in terms of untrusted input reaching dangerous sinks. The main Python sinks:

1. SQL: string-built queries enable SQL injection. Always use parameterised queries or an ORM; validate identifiers (column names for sorting) against an allow-list since they cannot be parameterised.

```python
cur.execute("SELECT * FROM orders WHERE customer_id = %s", (customer_id,))   # safe
SORTABLE = {"created", "amount"}
if sort not in SORTABLE:
    raise HTTPException(400, "invalid sort")
```

2. OS commands: never use `shell=True` with user input; pass argument lists to `subprocess.run`.
3. Deserialisation: `pickle`, `marshal`, `shelve` and `yaml.load` with the full loader can execute arbitrary code. Accept only JSON (or `yaml.safe_load`) from untrusted sources; never unpickle data from users, caches shared with untrusted parties, or downloaded model files of unknown origin (prefer safetensors for ML weights).
4. Code evaluation: no `eval`/`exec` on user input; use `ast.literal_eval` for literals or a proper parser.
5. Templates: keep auto-escaping on (Jinja2 `autoescape=True`) to prevent XSS; never render user input as a template (server-side template injection).
6. Paths: resolve and check that user-supplied file paths stay inside an allowed directory to stop path traversal.
7. XML: use `defusedxml` against entity-expansion attacks.
8. SSRF: validate outbound URLs supplied by users against allow-lists.

Process controls: validate all input with Pydantic at the boundary, run static analysis (Bandit or ruff's security rules) in CI, scan dependencies (`pip-audit`), apply least-privilege database accounts, and rate-limit authentication endpoints.

Verify with security tests and periodic penetration testing.

Common wrong answers: "we escape quotes manually" (fragile) or "pickle is fine because it is internal" (internal data often becomes externally influenced over time).

### Your startup is building a new product with a web UI, admin back-office and public API. Django or FastAPI? How do you decide?
<!-- level: intermediate; kind: scenario; ref: https://docs.djangoproject.com/en/stable/ -->
Frame the decision around requirements and team, not popularity.

Django strengths:

- Batteries included: ORM with migrations, authentication, permissions, admin UI, forms, sessions, CSRF protection, i18n.
- The admin alone can save weeks for a back-office.
- Mature conventions make large teams consistent; huge ecosystem (Django REST Framework, Celery integration).
- Async support exists, though much of the ecosystem and ORM usage is still predominantly synchronous.

FastAPI strengths:

- API-first with type-hint-driven validation (Pydantic) and automatic OpenAPI docs.
- Native async, efficient for I/O-heavy services, streaming and WebSockets.
- Lightweight and flexible: you choose the ORM (SQLAlchemy, SQLModel), auth, migrations (Alembic).
- Popular for microservices and ML model serving.

Decision factors:

1. Product shape: a data-heavy app with users, roles and an internal admin favours Django. A set of JSON APIs consumed by a separate frontend (React/mobile) or high-concurrency I/O favours FastAPI.
2. Team experience: productivity with a familiar framework often outweighs theoretical advantages.
3. Time to market: Django's built-ins reduce decisions; FastAPI requires assembling and maintaining more pieces.
4. Performance needs: for most CRUD products the database is the bottleneck, not the framework.

A pragmatic hybrid: Django (with Django Ninja or DRF) for the core product and admin, and FastAPI for specialised high-concurrency or ML services.

Trade-offs to state explicitly: FastAPI's flexibility means more architecture decisions and risk of inconsistency; Django's conventions can feel heavy for tiny services.

Common wrong answer: "FastAPI because it's faster". Raw framework speed rarely determines product success, and blocking database code can erase the async advantage.
