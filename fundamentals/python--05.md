## 11. Concurrency and Parallelism

### Choosing a concurrency model
<!-- level: intermediate; ref: https://docs.python.org/3/library/concurrency.html -->
Concurrency means making progress on several tasks by interleaving them; parallelism means literally running them at the same moment on multiple cores. Python offers several models, and the right choice depends on what your program waits for.

- I/O-bound work (network calls, disk, databases) spends most time waiting. Threads or asyncio overlap the waiting. Threads are simplest to add to existing synchronous code; asyncio scales to tens of thousands of connections with low overhead but requires async-aware libraries throughout.
- CPU-bound pure-Python work (parsing, simulations, image loops) needs real parallelism. In the default CPython build the GIL lets only one thread run Python bytecode at a time, so use processes (`multiprocessing`, `ProcessPoolExecutor`), or move the heavy loop into native code that releases the GIL (NumPy, many compression and crypto libraries).
- Newer options: the free-threaded build (3.13 experimental, officially supported but optional in 3.14) allows true multi-core threads, and subinterpreters (3.14 `concurrent.interpreters`) give isolated interpreters within one process.

A quick decision flow:

1. Measure: is the time spent waiting or computing?
2. Waiting with sync libraries: `ThreadPoolExecutor`.
3. Waiting at high scale or a natively async stack (FastAPI, httpx, asyncpg): asyncio.
4. Computing: `ProcessPoolExecutor` or vectorised/native code.

```python
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor

with ThreadPoolExecutor(max_workers=20) as pool:          # I/O-bound
    pages = list(pool.map(download, urls))

with ProcessPoolExecutor() as pool:                        # CPU-bound
    results = list(pool.map(score_document, docs, chunksize=50))
```

#### Pitfalls
- Adding threads to CPU-bound Python code on the default build often makes it slower due to GIL contention.
- Concurrency adds failure modes (races, deadlocks, partial failures); do not reach for it before profiling.

### Threads, locks and thread safety
<!-- level: intermediate; ref: https://docs.python.org/3/library/threading.html -->
The `threading` module runs functions in OS threads that share the same memory. Sharing is convenient but dangerous: when two threads read-modify-write the same data, updates can be lost. Even with the GIL, `counter += 1` is not atomic because it is several bytecode operations and a thread switch can occur between them.

Synchronisation tools:

- `Lock`: mutual exclusion; use with `with lock:`.
- `RLock`: re-entrant lock, can be acquired repeatedly by the same thread.
- `Event`, `Condition`, `Semaphore`, `Barrier`: signalling and limiting.
- `queue.Queue`: a thread-safe FIFO; the preferred way to pass work between threads (producer/consumer).

```python
import threading, queue

stats_lock = threading.Lock()
processed = 0

def worker(q: queue.Queue) -> None:
    global processed
    while True:
        item = q.get()
        if item is None:              # sentinel to stop
            q.task_done()
            break
        handle(item)
        with stats_lock:
            processed += 1
        q.task_done()

q: queue.Queue = queue.Queue(maxsize=100)    # bounded = back-pressure
threads = [threading.Thread(target=worker, args=(q,), daemon=True) for _ in range(4)]
for t in threads:
    t.start()
for item in load_items():
    q.put(item)
for _ in threads:
    q.put(None)
q.join()
```

Thread-local state (`threading.local()`) gives each thread its own copy of a variable, used for per-thread DB connections.

#### Pitfalls
- Deadlock: two threads acquiring two locks in opposite order. Always acquire locks in a consistent global order and keep critical sections short.
- Daemon threads are killed abruptly at interpreter exit; do not use them for work that must finish (like writing files).
- With the free-threaded build, code that accidentally relied on the GIL for safety may expose new races; protect shared state explicitly.

### concurrent.futures executors
<!-- level: intermediate; ref: https://docs.python.org/3/library/concurrent.futures.html -->
`concurrent.futures` offers one high-level API for running callables in a pool of threads or processes. You submit work and receive `Future` objects representing results that will arrive later. Switching between `ThreadPoolExecutor` and `ProcessPoolExecutor` is usually a one-line change.

Key methods:

- `pool.map(fn, iterable)`: results in input order; the first exception is raised when you reach that result.
- `pool.submit(fn, *args)`: returns a `Future`; combine with `as_completed` to handle results as soon as each finishes.
- `future.result(timeout=...)`: wait for and return the value or re-raise the exception.

```python
from concurrent.futures import ThreadPoolExecutor, as_completed
import httpx

def fetch_status(url: str) -> tuple[str, int]:
    r = httpx.get(url, timeout=5)
    return url, r.status_code

urls = ["https://example.com", "https://example.org"]
failures = []
with ThreadPoolExecutor(max_workers=10) as pool:
    futures = {pool.submit(fetch_status, u): u for u in urls}
    for fut in as_completed(futures):
        url = futures[fut]
        try:
            _, status = fut.result()
            print(url, status)
        except Exception as exc:
            failures.append((url, exc))
```

The `with` block waits for all work on exit (`shutdown(wait=True)`). Python 3.14 added `InterpreterPoolExecutor`, which runs tasks in subinterpreters, each with its own GIL, offering parallelism with lower overhead than processes for suitable workloads.

#### Pitfalls
- Exceptions inside a submitted function are stored in its `Future`; if you never call `result()`, they vanish silently.
- Too many threads waste memory and hammer downstream services; size pools to what the dependency can handle.

### multiprocessing
<!-- level: intermediate; ref: https://docs.python.org/3/library/multiprocessing.html -->
`multiprocessing` runs code in separate OS processes, each with its own interpreter and memory, which sidesteps the GIL and uses all cores for CPU-bound work. The trade-off is cost: starting processes is slow, and every argument and result must be pickled and sent between processes.

How a child starts is the start method:

- `spawn`: fresh interpreter that re-imports your main module. Default on Windows and macOS. Safe but slower to start.
- `fork`: copies the parent process (POSIX only). Fast, but unsafe if the parent has threads or open locks.
- `forkserver`: a clean server process forks children on request. Python 3.14 made this the default on Linux and other POSIX platforms (except macOS), replacing `fork`.

```python
from multiprocessing import Pool
import hashlib

def checksum(path: str) -> tuple[str, str]:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return path, h.hexdigest()

if __name__ == "__main__":                 # required with spawn/forkserver
    paths = list_files("archive/")
    with Pool() as pool:                   # defaults to os.cpu_count() workers
        for path, digest in pool.imap_unordered(checksum, paths, chunksize=16):
            print(digest, path)
```

Minimise data transfer: send file paths or ids rather than large objects, use `chunksize` to batch small tasks, and consider `multiprocessing.shared_memory` or memory-mapped files for large arrays.

#### Pitfalls
- Forgetting the `if __name__ == "__main__":` guard causes recursive process spawning or errors on spawn platforms.
- Lambdas, nested functions and open connections cannot be pickled; worker functions must be importable at module level.
- Code that implicitly relied on `fork` inheriting globals may break under the 3.14 default; pass state explicitly or use an initializer.

### asyncio fundamentals
<!-- level: intermediate; ref: https://docs.python.org/3/library/asyncio-task.html -->
asyncio is single-threaded cooperative concurrency. An event loop runs many coroutines and switches between them only at `await` points, typically while waiting for I/O. Because switches are explicit, there are far fewer race conditions than with threads, and each waiting task costs only a small object instead of an OS thread.

Core vocabulary:

- `async def` defines a coroutine function; calling it creates a coroutine object, which does nothing until awaited or scheduled.
- `await` suspends the current coroutine until the awaited thing completes.
- A Task wraps a coroutine and schedules it on the loop to run concurrently (`asyncio.create_task`).
- `asyncio.run(main())` creates the loop, runs the entry coroutine and closes the loop.

```python
import asyncio
import httpx

async def fetch_json(client: httpx.AsyncClient, url: str) -> dict:
    resp = await client.get(url)          # yields control while waiting
    resp.raise_for_status()
    return resp.json()

async def main() -> None:
    sem = asyncio.Semaphore(20)           # limit concurrency to 20 requests
    async with httpx.AsyncClient(timeout=10) as client:
        async def limited(url):
            async with sem:
                return await fetch_json(client, url)
        urls = [f"https://api.example.com/items/{i}" for i in range(500)]
        results = await asyncio.gather(*(limited(u) for u in urls), return_exceptions=True)
    print(sum(isinstance(r, Exception) for r in results), "failures")

asyncio.run(main())
```

Python 3.14 added `python -m asyncio ps PID` and `pstree` to inspect running tasks in a live process, which helps debug stuck services.

#### Pitfalls
- Calling a coroutine without `await` just creates an object; Python warns "coroutine was never awaited" and nothing runs.
- Unbounded `gather` over thousands of URLs can overwhelm servers or exhaust sockets; always cap concurrency.

### Structured concurrency: TaskGroup, timeouts and cancellation
<!-- level: advanced; ref: https://docs.python.org/3/library/asyncio-task.html#task-groups -->
Plain `create_task` lets tasks outlive the code that started them, so errors get lost and work leaks. Structured concurrency ties child tasks to a scope. In Python 3.11+, `asyncio.TaskGroup` waits for all children when the `async with` block exits. If any child fails, the others are cancelled and the errors are raised together as an `ExceptionGroup`.

Timeouts use `asyncio.timeout()` (3.11+), a context manager that cancels the block when the deadline passes and raises `TimeoutError`. Cancellation is delivered as `asyncio.CancelledError` at the next `await`.

```python
import asyncio

async def load_dashboard(user_id: int) -> dict:
    async with asyncio.timeout(2.0):                    # overall budget
        async with asyncio.TaskGroup() as tg:
            profile = tg.create_task(get_profile(user_id))
            orders = tg.create_task(get_orders(user_id))
            recs = tg.create_task(get_recommendations(user_id))
    return {"profile": profile.result(), "orders": orders.result(), "recs": recs.result()}

async def get_recommendations(user_id: int) -> list:
    try:
        return await recommender.fetch(user_id)
    except asyncio.CancelledError:
        await metrics.incr("recs.cancelled")             # brief cleanup is fine
        raise                                            # always re-raise
```

To make one dependency optional instead of failing the whole group, catch its error inside its own coroutine and return a fallback.

`gather` is still useful, but `return_exceptions=False` does not cancel the remaining tasks when one fails, which is a common source of orphaned work.

#### Pitfalls
- Swallowing `CancelledError` (for example via a broad `except BaseException`) breaks timeouts and shutdown.
- Fire-and-forget tasks must be referenced (store them in a set) or they may be garbage-collected mid-flight.

### Mixing async and blocking code
<!-- level: advanced; ref: https://docs.python.org/3/library/asyncio-dev.html -->
The event loop runs on one thread, so any blocking call inside a coroutine (`time.sleep`, `requests.get`, a synchronous database driver, heavy CPU work) freezes every other task. Symptoms: latency spikes for unrelated requests, timeouts firing late, health checks failing under load.

Rules of thumb:

- Use async-native libraries in async code: `httpx.AsyncClient` or `aiohttp` instead of `requests`, `asyncpg` or async SQLAlchemy instead of sync drivers, `asyncio.sleep` instead of `time.sleep`.
- Offload unavoidable blocking I/O to a thread with `asyncio.to_thread` (3.9+).
- Offload CPU-heavy work to a process pool with `loop.run_in_executor(process_pool, fn, ...)`.
- From synchronous code (a thread), submit work to a running loop with `asyncio.run_coroutine_threadsafe`.

```python
import asyncio
from concurrent.futures import ProcessPoolExecutor

pool = ProcessPoolExecutor()

async def handle_upload(path: str) -> dict:
    meta = await asyncio.to_thread(read_exif_with_sync_lib, path)   # blocking I/O
    loop = asyncio.get_running_loop()
    thumb = await loop.run_in_executor(pool, make_thumbnail, path)  # CPU-bound
    return {"meta": meta, "thumb": thumb}
```

Debug mode helps find offenders: run with `PYTHONASYNCIODEBUG=1` or `asyncio.run(main(), debug=True)` and the loop logs callbacks that take longer than 100 ms.

#### Pitfalls
- `asyncio.run()` cannot be called while a loop is already running (Jupyter, inside FastAPI); `await` the coroutine instead.
- Wrapping every call in `to_thread` defeats the purpose; it is a bridge, not an architecture.

### Free-threaded Python and subinterpreters
<!-- level: advanced; ref: https://docs.python.org/3/howto/free-threading-python.html -->
PEP 703 introduced a CPython build that can run without the GIL, so threads execute Python bytecode truly in parallel on multiple cores.

- Python 3.13: available as an experimental, separately installed build (often named `python3.13t`).
- Python 3.14: officially supported (PEP 779), but still optional and not the default build. Single-threaded overhead was reduced substantially compared with 3.13.

Internally, the free-threaded build replaces the GIL with finer-grained mechanisms such as per-object locks for built-in containers, biased reference counting and deferred reference counting for widely shared objects. C extensions must declare support; importing one that does not re-enables the GIL at runtime unless overridden with `PYTHON_GIL=0` or `-X gil=0`.

```python
import sys, sysconfig, threading

sysconfig.get_config_var("Py_GIL_DISABLED")   # 1 on a free-threaded build
sys._is_gil_enabled()                         # False when running without the GIL (3.13+)

def crunch(n: int) -> int:
    return sum(i * i for i in range(n))

threads = [threading.Thread(target=crunch, args=(10_000_000,)) for _ in range(8)]
for t in threads: t.start()
for t in threads: t.join()                    # scales across cores on a free-threaded build
```

Subinterpreters are the other path to parallelism: multiple isolated interpreters in one process, each with its own GIL (PEP 684, 3.12). Python 3.14 exposed them through `concurrent.interpreters` (PEP 734) and `InterpreterPoolExecutor`. They share nothing by default, so data is passed explicitly, similar to processes but cheaper.

#### Pitfalls
- Check that your dependencies publish free-threaded wheels before adopting it; one incompatible extension silently restores the GIL.
- Free-threading does not remove the need for locks; it removes the accidental protection the GIL used to provide.

## 12. Performance

### Measure first: profiling CPU and memory
<!-- level: intermediate; ref: https://docs.python.org/3/library/profile.html -->
Performance work starts with measurement because intuition about bottlenecks is usually wrong. Use the right tool for each question:

- `timeit`: micro-benchmarks of small snippets, running them many times to reduce noise.
- `cProfile`: deterministic profiler counting calls and time per function; view results with `pstats` or a visualiser such as snakeviz.
- Sampling profilers (py-spy, Scalene, Austin): low overhead, attach to running processes, show where time goes including native code.
- `tracemalloc`: tracks memory allocations by source line and compares snapshots to find growth.
- `time.perf_counter()`: quick timing around suspicious blocks in real workloads.

```python
import cProfile, pstats, timeit, tracemalloc

timeit.timeit("'-'.join(map(str, range(100)))", number=10_000)

with cProfile.Profile() as prof:          # context manager form (3.8+)
    build_report()
pstats.Stats(prof).sort_stats("cumulative").print_stats(15)

tracemalloc.start()
before = tracemalloc.take_snapshot()
load_catalogue()
after = tracemalloc.take_snapshot()
for stat in after.compare_to(before, "lineno")[:10]:
    print(stat)
```

From the command line: `python -m cProfile -s cumtime app.py`, or `py-spy top --pid 1234` for a live service. Profile with production-like data sizes; an O(n squared) bug is invisible with 100 rows.

#### Pitfalls
- `cProfile` adds overhead per call, inflating code with many tiny functions; confirm with a sampling profiler.
- Micro-optimising a function that takes 2% of runtime cannot give more than a 2% gain (Amdahl's law). Fix the hot spot first.

### Writing faster pure Python
<!-- level: intermediate; ref: https://docs.python.org/3/faq/programming.html#performance -->
Before reaching for C or more hardware, the biggest wins usually come from better algorithms and data structures, and from letting built-ins (implemented in C) do the looping.

High-impact techniques:

- Choose the right structure: membership tests on a `set` or `dict` are O(1) versus O(n) on a list; use `deque` for queues and `heapq` for top-k.
- Avoid repeated work: hoist invariant computations out of loops, cache results (`functools.cache`), and batch I/O (one query for 1,000 ids instead of 1,000 queries).
- Use built-ins and comprehensions: `sum`, `min`, `max`, `sorted`, `any`, `str.join`, and comprehensions run tight loops in C or optimised bytecode.
- Build strings with `"".join(parts)`, not `+=` in loops.
- Stream with generators to reduce memory pressure.

```python
# Slow: O(n*m) list membership + repeated attribute lookups
def active_emails_slow(users, banned_list):
    result = []
    for u in users:
        if u.email not in banned_list:
            result.append(u.email.lower())
    return result

# Fast: O(n) with set lookups and a comprehension
def active_emails(users, banned_list):
    banned = {e.lower() for e in banned_list}
    return [e for u in users if (e := u.email.lower()) not in banned]
```

In tight loops, binding a frequently used global or attribute to a local name helps a little, but the adaptive interpreter (3.11+) has narrowed many such gaps; measure before applying micro-tricks.

#### Pitfalls
- N+1 queries in ORMs dwarf any Python-level micro-optimisation; check database access first.
- Premature optimisation that hurts readability is a net loss. Optimise the measured hot path only.

### Vectorisation and native extensions
<!-- level: advanced; ref: https://numpy.org/doc/stable/user/whatisnumpy.html -->
When pure Python is still too slow for numeric or data work, move the inner loop out of the interpreter.

- NumPy stores homogeneous data in contiguous typed arrays and applies operations to whole arrays in compiled code (vectorisation). This removes per-element interpreter overhead and boxing, often giving 10 to 100 times speedups, and many operations release the GIL.
- pandas and Polars bring the same idea to tables; Polars also parallelises and has a lazy query optimiser.
- Numba JIT-compiles numeric Python functions to machine code with a decorator.
- Cython, or Rust via PyO3/maturin, lets you write extension modules for custom hot paths.

```python
import numpy as np

prices = np.random.default_rng(0).uniform(10, 500, 1_000_000)
qty = np.random.default_rng(1).integers(1, 5, 1_000_000)

# Python loop: about a million interpreter iterations
total_slow = sum(p * q for p, q in zip(prices, qty))

# Vectorised: one call into compiled code
total = float(np.dot(prices, qty))

discounted = np.where(prices > 100, prices * 0.9, prices)  # vectorised conditional
mask = (prices > 50) & (qty >= 2)                           # boolean indexing
bulk_revenue = (prices[mask] * qty[mask]).sum()
```

Think in whole-array operations: replace `if` inside loops with `np.where` or masks, and loops over rows with broadcasting.

#### Pitfalls
- Iterating over a NumPy array element by element in Python is slower than iterating a list, because each element is boxed into a Python object.
- `df.apply(lambda row: ...)` in pandas is a hidden Python loop; prefer vectorised column operations.
- Moving data back and forth between Python objects and arrays repeatedly can erase the gains.

### The Faster CPython work and the JIT
<!-- level: advanced; ref: https://docs.python.org/3/whatsnew/3.13.html -->
Recent CPython versions became significantly faster without code changes, so upgrading is often the cheapest optimisation.

- Python 3.11 introduced the specialising adaptive interpreter (PEP 659). After a few executions, generic bytecode instructions are replaced with type-specialised versions (for example an attribute load specialised for a particular class layout), with a fallback if assumptions break. Typical code ran about 25% faster than 3.10, with cheaper function calls and "zero-cost" exception handling when no exception is raised.
- Python 3.12 inlined comprehensions and improved many internals.
- Python 3.13 added an experimental JIT compiler (PEP 744) using a "copy-and-patch" technique: it stitches pre-compiled machine-code templates for hot traces. It is off by default and required building with `--enable-experimental-jit`.
- Python 3.14 ships the experimental JIT in the official Windows and macOS binaries, enabled with the `PYTHON_JIT=1` environment variable, and adds an incremental garbage collector that shortens pauses. Gains from the JIT are still modest and workload-dependent.

```bash
python -c "import sys; print(sys.version)"
PYTHON_JIT=1 python bench.py        # 3.14 builds that include the JIT
python -m pyperformance run          # standard benchmark suite for comparisons
```

Practical advice: benchmark your real workload on the newest stable version before rewriting code; many teams see double-digit improvements from the 3.10 to 3.12+ upgrade alone. Alternative runtimes like PyPy remain an option for long-running pure-Python workloads.

#### Pitfalls
- Specialisation favours type-stable code; functions called with wildly varying argument types benefit less.
- Do not enable an experimental JIT in production without benchmarks and a rollback plan.
