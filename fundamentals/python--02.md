## 4. Comprehensions and Iteration

### List, dict and set comprehensions
<!-- level: basic; ref: https://docs.python.org/3/tutorial/datastructures.html#list-comprehensions -->
A comprehension builds a collection from an iterable in one expression: an output expression, one or more `for` clauses, and optional `if` filters. It replaces the "create empty list, loop, append" pattern and is usually faster because the loop runs with less interpreter overhead.

```python
orders = [{"id": 1, "amt": 250, "paid": True},
          {"id": 2, "amt": 90, "paid": False},
          {"id": 3, "amt": 410, "paid": True}]

paid_ids = [o["id"] for o in orders if o["paid"]]             # [1, 3]
amount_by_id = {o["id"]: o["amt"] for o in orders}            # dict comprehension
big_statuses = {o["paid"] for o in orders if o["amt"] > 100}  # set comprehension

matrix = [[1, 2], [3, 4]]
flat = [x for row in matrix for x in row]   # clauses read left to right like nested loops

labels = ["high" if o["amt"] > 200 else "low" for o in orders]  # conditional expression
```

Comprehensions have their own scope, so the loop variable does not leak into the surrounding function. Since Python 3.12 (PEP 709) list, dict and set comprehensions are inlined into the enclosing function rather than creating a hidden function object, making them noticeably faster while keeping the isolated scope.

#### Pitfalls
- Readability first: more than two `for` clauses or complex conditions belong in a regular loop or helper function.
- Do not use a comprehension only for side effects (`[print(x) for x in xs]`); it builds a throwaway list.
- The filter `if` goes at the end; an `if/else` that chooses a value goes at the front.

### The iterator protocol
<!-- level: intermediate; ref: https://docs.python.org/3/library/stdtypes.html#iterator-types -->
Iteration in Python is built on two methods:

- An iterable has `__iter__()` returning a new iterator (lists, dicts, files, ranges).
- An iterator has `__next__()` returning the next item or raising `StopIteration`, and its `__iter__()` returns itself.

A `for` loop is roughly: call `iter(obj)`, then call `next()` repeatedly until `StopIteration`.

```python
it = iter([10, 20])
next(it)          # 10
next(it)          # 20
next(it, None)    # None - default instead of StopIteration

class Countdown:
    """Iterable: each loop gets a fresh iterator."""
    def __init__(self, start):
        self.start = start
    def __iter__(self):
        n = self.start
        while n > 0:
            yield n          # a generator is the easiest way to implement __iter__
            n -= 1

for n in Countdown(3):
    print(n)                 # 3 2 1
```

The key practical distinction: iterables can usually be iterated many times, iterators only once. Generators, `map`, `filter`, `zip` and file objects are iterators, so they are exhausted after one pass.

```python
evens = filter(lambda x: x % 2 == 0, range(10))
list(evens)   # [0, 2, 4, 6, 8]
list(evens)   # [] - already exhausted
```

#### Pitfalls
- Passing a generator to a function that loops over it twice (e.g. computing a mean and then a variance) silently gives wrong results the second time. Convert to a list or restructure.

#### Interview tip
- Be ready to implement a class-based iterator with `__iter__` and `__next__` and explain why `__iter__` on an iterator returns `self`.

### Generator functions in depth
<!-- level: intermediate; ref: https://docs.python.org/3/reference/expressions.html#yield-expressions -->
A function containing `yield` becomes a generator function: calling it returns a generator object without running the body. Each `next()` resumes execution until the next `yield`, then freezes the frame (local variables and instruction pointer) until asked again. When the function returns, `StopIteration` is raised.

`yield from iterable` delegates to a sub-iterator, yielding each of its items and returning its return value. It is the clean way to compose or flatten generators.

```python
def read_records(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield line.rstrip("\n").split(",")

def read_many(paths):
    for p in paths:
        yield from read_records(p)       # delegate

def running_avg():
    total = count = 0
    avg = None
    while True:
        value = yield avg                # receive values via send()
        total += value
        count += 1
        avg = total / count

g = running_avg()
next(g)          # prime the generator
g.send(10)       # 10.0
g.send(20)       # 15.0
g.close()        # raises GeneratorExit inside, runs cleanup
```

Generators can also receive values (`send`), exceptions (`throw`) and be closed (`close`); these features were the foundation of early coroutines, though modern async code uses `async def`.

#### Pitfalls
- A `with` block inside a generator stays open until the generator is exhausted or closed. An abandoned generator holding a file or DB cursor keeps it open; consume fully or wrap with `contextlib.closing`.
- `return value` in a generator does not yield the value; it becomes `StopIteration.value`.

### Lazy pipelines with generator expressions
<!-- level: intermediate; ref: https://docs.python.org/3/howto/functional.html#generator-expressions-and-list-comprehensions -->
A generator expression looks like a list comprehension in parentheses, `(f(x) for x in xs)`, but produces items lazily. Chaining several of them creates a streaming pipeline where each item flows through all stages before the next is read, keeping memory constant regardless of input size.

```python
import gzip, json

def events(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        yield from f

lines = events("events.jsonl.gz")
parsed = (json.loads(line) for line in lines)
errors = (e for e in parsed if e.get("level") == "ERROR")
services = (e["service"] for e in errors)

from collections import Counter
top = Counter(services).most_common(5)   # only now does data flow

total = sum(o["amt"] for o in orders)    # parentheses optional as sole argument
```

Nothing executes until a consumer (`sum`, `Counter`, a `for` loop, `list`) pulls items. That gives you short-circuiting too: `any(check(x) for x in xs)` stops at the first true result.

When to prefer a list: you need `len()`, indexing, multiple passes, or the data is small and you want simple debugging.

#### Pitfalls
- Exceptions surface at consumption time, far from where the expression was written, which can confuse debugging.
- Late binding: a generator expression evaluates variables used in later clauses when it runs, not when it is created. If you change those variables in between, results change.

### itertools essentials
<!-- level: intermediate; ref: https://docs.python.org/3/library/itertools.html -->
The `itertools` module provides fast, memory-efficient building blocks for iterators, implemented in C. Knowing a handful saves writing fragile loops:

- `chain(a, b)` / `chain.from_iterable(xs)`: concatenate iterables.
- `islice(it, start, stop)`: slice any iterator (e.g. the first 100 lines of a file).
- `groupby(it, key)`: group consecutive items with the same key; input must be sorted by that key.
- `batched(it, n)` (3.12+): chunk into tuples of size n; 3.13 added `strict=True`.
- `pairwise(it)` (3.10+): overlapping pairs `(a, b), (b, c)`.
- `product`, `permutations`, `combinations`: combinatorics without nested loops.
- `accumulate(it, func)`: running totals or maxima.
- `count`, `cycle`, `repeat`: infinite iterators.

```python
from itertools import batched, groupby, islice, pairwise, accumulate
from operator import itemgetter

for batch in batched(range(10), 4):
    print(batch)          # (0,1,2,3) (4,5,6,7) (8,9)

readings = [3, 5, 4, 8]
deltas = [b - a for a, b in pairwise(readings)]     # [2, -1, 4]
list(accumulate(readings))                          # [3, 8, 12, 20]

rows = sorted([("north", 5), ("south", 2), ("north", 1)], key=itemgetter(0))
for region, grp in groupby(rows, key=itemgetter(0)):
    print(region, sum(q for _, q in grp))

with open("big.log") as f:
    head = list(islice(f, 100))
```

#### Pitfalls
- `groupby` on unsorted data produces repeated groups; sort first or use a `defaultdict(list)`.
- The group iterators from `groupby` are invalidated when you advance to the next group; materialise them if you need them later.

### Assignment expressions (the walrus operator)
<!-- level: intermediate; ref: https://docs.python.org/3/reference/expressions.html#assignment-expressions -->
Python 3.8 added `:=` (PEP 572), which assigns a value to a name as part of an expression. It removes duplicated calls and awkward loop structures where you need a value both to test and to use.

```python
import re

# Read a stream in fixed chunks
with open("data.bin", "rb") as f:
    while chunk := f.read(65536):
        process(chunk)

# Test and use a regex match
if (m := re.search(r"order=(\d+)", line)) is not None:
    order_id = int(m.group(1))

# Avoid calling an expensive function twice in a comprehension
results = [y for x in items if (y := transform(x)) is not None]

# Keep the last value for reporting
if any((bad := r)["status"] == "failed" for r in runs):
    print("first failure:", bad["id"])
```

Rules worth remembering: unparenthesised `:=` is not allowed at statement level (`x := 5` alone is a syntax error, intentionally), and in a comprehension the target binds in the enclosing function scope, not the comprehension scope, which is what makes the `any(...)` example work.

#### Pitfalls
- Precedence: `if m := re.match(p, s) is not None` binds the boolean result of `is not None` to `m`. Always parenthesise: `(m := re.match(p, s)) is not None`.
- Overuse hurts readability; use it where it removes duplication, not to compress code.

## 5. Functions

### Parameters: positional, keyword and defaults
<!-- level: basic; ref: https://docs.python.org/3/tutorial/controlflow.html#special-parameters -->
Python functions support several parameter kinds, and choosing them deliberately makes APIs safer and easier to evolve:

- Positional-or-keyword: the default, `def f(a, b)`.
- Positional-only (3.8+): parameters before `/` cannot be passed by name, so you can rename them later without breaking callers.
- Keyword-only: parameters after `*` (or after `*args`) must be passed by name, which makes boolean flags and options self-documenting at the call site.
- Variadic: `*args` collects extra positionals into a tuple, `**kwargs` collects extra keywords into a dict.

```python
def transfer(src, dst, /, amount, *, currency="INR", dry_run=False):
    ...

transfer("acc1", "acc2", 500, dry_run=True)          # OK
transfer("acc1", "acc2", amount=500)                 # OK
transfer(src="acc1", dst="acc2", amount=500)         # TypeError: positional-only
transfer("acc1", "acc2", 500, "USD")                 # TypeError: currency is keyword-only

def call_with(func, /, *args, **kwargs):             # safe forwarding wrapper
    return func(*args, **kwargs)
```

Default values are evaluated once at definition time; use `None` as a sentinel for mutable defaults. Return values: a function without `return` returns `None`; returning several values actually returns a tuple.

#### Interview tip
- Explain why the built-in `len(obj, /)` and many C functions are positional-only: names are implementation details. For your own libraries, keyword-only flags (`*, force=False`) prevent mysterious `f(x, True, False)` calls.

### Scope and the LEGB rule
<!-- level: intermediate; ref: https://docs.python.org/3/reference/executionmodel.html#resolution-of-names -->
When Python looks up a name it searches four scopes in order, known as LEGB:

1. Local: names assigned in the current function.
2. Enclosing: locals of any outer functions (for nested functions).
3. Global: module-level names.
4. Built-in: names like `len`, `print`, `ValueError`.

Scope is decided at compile time: if a function assigns to a name anywhere in its body, that name is local throughout the whole function. Reading it before assignment raises `UnboundLocalError`.

```python
counter = 0

def broken():
    counter += 1        # UnboundLocalError: counter is local because it is assigned

def works():
    global counter      # rebind the module-level name
    counter += 1

def make_counter():
    count = 0
    def increment():
        nonlocal count  # rebind the enclosing function's name
        count += 1
        return count
    return increment

inc = make_counter()
inc(), inc()            # (1, 2)
```

`global` and `nonlocal` are only needed to rebind names; mutating an object (`items.append(x)`) never needs them. Classes are special: a class body creates a namespace, but methods do not see class-level names as an enclosing scope; access them via `self` or the class name.

#### Pitfalls
- Heavy use of `global` makes code hard to test and unsafe with threads; pass state explicitly or wrap it in an object.
- Python 3.13 (PEP 667) clarified `locals()` semantics in functions: it returns an independent snapshot, so writing to it never changes real local variables.

### First-class functions and lambdas
<!-- level: basic; ref: https://docs.python.org/3/howto/functional.html -->
Functions are objects, so they can be passed as arguments, returned from other functions and stored in data structures. A function that takes or returns functions is a higher-order function. This enables strategy-style designs without class hierarchies.

`lambda` creates a small anonymous function limited to a single expression. It is best for short key functions and callbacks.

```python
from operator import attrgetter

def apply_discount(price, rule):
    return rule(price)

flat_50 = lambda p: max(p - 50, 0)
ten_pct = lambda p: p * 0.9
apply_discount(400, ten_pct)          # 360.0

pricing_rules = {"FLAT50": flat_50, "TEN": ten_pct}
apply_discount(400, pricing_rules["FLAT50"])

employees.sort(key=attrgetter("dept", "salary"))   # operator module beats lambdas
names = list(map(str.title, ["asha", "ravi"]))      # unbound method as a function
evens = [n for n in range(10) if n % 2 == 0]        # usually clearer than filter+lambda
```

`map` and `filter` return lazy iterators. In modern Python a comprehension is generally preferred for readability unless you already have a named function to pass.

#### Pitfalls
- Assigning a lambda to a name (`f = lambda x: ...`) is discouraged by PEP 8; use `def` so tracebacks show a real name.
- Lambdas cannot contain statements or annotations, and complex lambdas are hard to debug.

### Closures and late binding
<!-- level: intermediate; ref: https://docs.python.org/3/reference/executionmodel.html#binding-of-names -->
A closure is a nested function that remembers variables from its enclosing scope even after the outer function has returned. CPython implements this with cell objects: the inner function's `__closure__` holds references to the cells, which hold the current values.

Closures let you create configured functions, keep private state without a class, and are the mechanism behind decorators.

```python
def make_rate_limiter(max_calls):
    calls = 0
    def allow():
        nonlocal calls
        if calls < max_calls:
            calls += 1
            return True
        return False
    return allow

limit = make_rate_limiter(2)
limit(), limit(), limit()            # (True, True, False)
limit.__closure__[0].cell_contents   # inspect captured state
```

The most famous closure bug is late binding: closures capture variables, not values. The value is looked up when the inner function runs.

```python
handlers = [lambda: i for i in range(3)]
[h() for h in handlers]              # [2, 2, 2]  - all see the final i

handlers = [lambda i=i: i for i in range(3)]   # bind current value as a default
[h() for h in handlers]              # [0, 1, 2]

from functools import partial
handlers = [partial(print, i) for i in range(3)]  # alternative
```

#### Interview tip
- The "lambdas in a loop all return the last value" question is classic. Explain capture-by-variable and give both fixes (default argument or `functools.partial`).

### Decorators in depth
<!-- level: intermediate; ref: https://docs.python.org/3/reference/compound_stmts.html#function-definitions -->
`@decorator` above a `def` is shorthand for `func = decorator(func)`, executed once at definition time. Beyond the basic wrapper pattern, three variants appear constantly in real code.

Decorators with arguments need one more level: a factory that returns the actual decorator.

```python
import functools, time

def retry(times=3, delay=0.5, exceptions=(Exception,)):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(1, times + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions:
                    if attempt == times:
                        raise
                    time.sleep(delay * attempt)
        return wrapper
    return decorator

@retry(times=5, exceptions=(ConnectionError,))
def fetch_rates(): ...
```

Stacking applies bottom-up: with `@a` above `@b`, the result is `a(b(func))`, so `a`'s wrapper runs first at call time.

Registration decorators return the function unchanged and record it, which is how Flask/FastAPI routes and pytest fixtures work:

```python
HANDLERS = {}
def handles(event_type):
    def register(func):
        HANDLERS[event_type] = func
        return func
    return register

@handles("order.created")
def on_order(evt): ...
```

Class decorators receive a class (e.g. `@dataclass`). For async functions, the wrapper itself must be `async def` and `await` the call.

#### Pitfalls
- Forgetting `functools.wraps` loses `__name__`, `__doc__` and `__wrapped__`, breaking introspection, docs and some frameworks.
- Decorating an async function with a sync wrapper returns an un-awaited coroutine; timing or retry logic silently does nothing.

### The functools toolkit
<!-- level: intermediate; ref: https://docs.python.org/3/library/functools.html -->
`functools` contains higher-order tools that every intermediate Python developer should know:

- `partial(func, *args, **kw)`: pre-fill arguments, producing a new callable.
- `cache` (3.9+) and `lru_cache(maxsize=...)`: memoise results by arguments (which must be hashable).
- `cached_property`: compute an attribute once per instance, then store it.
- `wraps`: copy metadata in decorators.
- `singledispatch`: choose an implementation based on the type of the first argument.
- `reduce`: fold an iterable into one value (often clearer as a loop or `sum`/`math.prod`).
- `total_ordering`: derive comparison methods from `__eq__` and one of `__lt__`/`__gt__`.

```python
from functools import cache, lru_cache, partial, singledispatch, cached_property
import json

@cache
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)

@lru_cache(maxsize=1024)
def exchange_rate(currency: str) -> float: ...
exchange_rate.cache_info()        # hits, misses, size
exchange_rate.cache_clear()

compact_json = partial(json.dumps, separators=(",", ":"))

@singledispatch
def to_text(value):
    return str(value)
@to_text.register
def _(value: list):
    return ", ".join(map(to_text, value))

class Report:
    def __init__(self, rows): self.rows = rows
    @cached_property
    def total(self):
        return sum(r["amt"] for r in self.rows)
```

#### Pitfalls
- `lru_cache` on a method caches `self` as part of the key, keeping instances alive; prefer `cached_property` or a cache keyed by ids.
- An unbounded `cache` on a function with many distinct inputs is a memory leak.
- Cached results are shared; returning a mutable object lets callers corrupt the cache.
