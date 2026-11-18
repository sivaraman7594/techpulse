# Python interview questions

### What is the difference between a list, tuple, set and dict?
<!-- level: basic; kind: concept; ref: https://docs.python.org/3/tutorial/datastructures.html -->
- **list** `[1, 2, 3]`: ordered, mutable, allows duplicates.
- **tuple** `(1, 2, 3)`: ordered, **immutable**; can be a dict key if its items are hashable.
- **set** `{1, 2, 3}`: unordered, unique items, fast membership tests (`x in s`).
- **dict** `{"a": 1}`: key → value mapping, keys unique and hashable; preserves insertion order (guaranteed since Python 3.7).

### Why is a mutable default argument a bug?
<!-- level: basic; kind: concept; ref: https://docs.python.org/3/tutorial/controlflow.html#default-argument-values -->
Default values are evaluated **once**, when the function is defined — so a mutable default is shared by every call.

```python
def add_item(item, items=[]):     # bug
    items.append(item)
    return items

add_item(1)  # [1]
add_item(2)  # [1, 2]  ← surprise

def add_item(item, items=None):   # fix
    if items is None:
        items = []
    items.append(item)
    return items
```

### What is the GIL, and when do you use threads, processes or asyncio?
<!-- level: intermediate; kind: concept; ref: https://docs.python.org/3/glossary.html#term-global-interpreter-lock -->
In standard CPython, the **Global Interpreter Lock** lets only one thread execute Python bytecode at a time, so threads do not speed up CPU-bound Python code. (Python 3.13 added an experimental free-threaded build without the GIL.)

- **I/O-bound** work (HTTP calls, files, databases): `threading` or `asyncio` — waiting releases the GIL.
- **CPU-bound** work: `multiprocessing` / `ProcessPoolExecutor` (separate processes, separate GILs), or libraries like NumPy that release the GIL in native code.
- **Many concurrent network connections**: `asyncio` scales to thousands of tasks with low overhead.

### What is a decorator? Write a simple one.
<!-- level: intermediate; kind: concept; ref: https://docs.python.org/3/glossary.html#term-decorator -->
A decorator is a function that takes a function and returns a new function that adds behaviour — logging, timing, caching, access checks — without changing the original code.

```python
import functools, time

def timed(func):
    @functools.wraps(func)          # keep the original name/docstring
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return func(*args, **kwargs)
        finally:
            print(f"{func.__name__} took {time.perf_counter() - start:.3f}s")
    return wrapper

@timed
def load_report(): ...
```

### What are generators, and why are they useful?
<!-- level: intermediate; kind: concept; ref: https://docs.python.org/3/howto/functional.html#generators -->
A generator function uses `yield` to produce values one at a time, pausing between them. It is **lazy**: values are produced only when requested, so memory use stays constant even for huge or infinite sequences.

```python
def read_lines(path):
    with open(path) as f:
        for line in f:
            yield line.rstrip("\n")

total = sum(1 for line in read_lines("big.log") if "ERROR" in line)
```

Generator expressions `(x * 2 for x in data)` are the inline form.

### What is the difference between `is` and `==`?
<!-- level: basic; kind: concept; ref: https://docs.python.org/3/reference/expressions.html#is-not -->
- `==` compares **values** (calls `__eq__`).
- `is` compares **identity** — whether both names refer to the same object.

Use `is` only for singletons: `if x is None`. Never rely on `is` for numbers or strings; small integers and some strings are cached by CPython, which makes `is` appear to work by accident.

### What do `*args` and `**kwargs` mean?
<!-- level: basic; kind: concept; ref: https://docs.python.org/3/tutorial/controlflow.html#arbitrary-argument-lists -->
- `*args` collects extra **positional** arguments into a tuple.
- `**kwargs` collects extra **keyword** arguments into a dict.

The same syntax unpacks when calling: `f(*my_list, **my_dict)`. They are common in wrappers and decorators that forward arguments.

```python
def log_call(*args, **kwargs):
    print(args, kwargs)

log_call(1, 2, user="asha")   # (1, 2) {'user': 'asha'}
```

### What is a context manager?
<!-- level: intermediate; kind: concept; ref: https://docs.python.org/3/library/contextlib.html -->
An object used with `with` that guarantees setup and cleanup, even if an exception occurs — closing files, releasing locks, committing or rolling back transactions. It implements `__enter__` and `__exit__`, or you can write one with `@contextmanager`:

```python
from contextlib import contextmanager

@contextmanager
def transaction(conn):
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
```

### What is the difference between a shallow copy and a deep copy?
<!-- level: basic; kind: concept; ref: https://docs.python.org/3/library/copy.html -->
- A **shallow copy** (`list(x)`, `x.copy()`, `copy.copy(x)`) creates a new outer container but shares the nested objects.
- A **deep copy** (`copy.deepcopy(x)`) recursively copies nested objects too.

```python
import copy
a = [[1, 2], [3]]
b = copy.copy(a);     b[0].append(9)   # a is now [[1, 2, 9], [3]]
c = copy.deepcopy(a); c[0].append(7)   # a unchanged
```

### You must process a 20 GB CSV file on a machine with 4 GB of RAM. How?
<!-- level: intermediate; kind: scenario; ref: https://pandas.pydata.org/docs/user_guide/io.html#iterating-through-files-chunk-by-chunk -->
Never load it all at once — **stream** it:
- The `csv` module with a generator reads one row at a time.
- pandas `read_csv(..., chunksize=100_000)` processes chunks and aggregates results; set `usecols` and `dtype` to cut memory.
- Tools built for larger-than-memory data, such as **DuckDB** (SQL directly on the CSV) or **Polars** lazy/streaming mode.
- Convert once to **Parquet** if the file will be queried repeatedly — it is columnar and much smaller.

```python
import pandas as pd
totals = {}
for chunk in pd.read_csv("sales.csv", usecols=["region", "amount"], chunksize=200_000):
    for region, amount in chunk.groupby("region")["amount"].sum().items():
        totals[region] = totals.get(region, 0) + amount
```

### A Python API endpoint calls five external services one after another and is slow. How do you speed it up?
<!-- level: intermediate; kind: scenario; ref: https://docs.python.org/3/library/asyncio-task.html#running-tasks-concurrently -->
1. **Profile** to confirm the time is spent waiting on I/O (logging timings, `cProfile`, APM tracing).
2. Run independent calls **concurrently** — `asyncio.gather` with an async HTTP client (httpx, aiohttp), or a `ThreadPoolExecutor` in sync code.
3. **Reuse connections** with one shared client/session (connection pooling).
4. Add **timeouts** and limited retries so one slow service doesn't block everything.
5. **Cache** responses that don't change often.

```python
async with httpx.AsyncClient(timeout=5) as client:
    user, orders, prefs = await asyncio.gather(
        client.get(f"{USERS}/{uid}"),
        client.get(f"{ORDERS}?user={uid}"),
        client.get(f"{PREFS}/{uid}"),
    )
```
