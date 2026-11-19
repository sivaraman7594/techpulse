## 1. Getting Started with Python

### How Python runs your code
<!-- level: basic; ref: https://docs.python.org/3/glossary.html#term-bytecode -->
When you run `python app.py`, the reference implementation (CPython) does not execute your text directly. It first parses the source into an abstract syntax tree, compiles that tree into bytecode (compact instructions for a virtual machine), and then a loop written in C evaluates the bytecode one instruction at a time. Compiled bytecode for imported modules is cached in `__pycache__/*.pyc` files so the next import skips compilation.

This explains several everyday facts: syntax errors are reported before any line runs, a module's top-level code runs once on first import, and "Python is slow" really means "the interpreter loop has overhead per operation". Since 3.11 CPython specialises hot bytecode at runtime (the "Faster CPython" work), and 3.13 added an optional experimental JIT compiler.

Other implementations exist: PyPy (JIT-compiled, often much faster for pure-Python loops), MicroPython (microcontrollers) and GraalPy. Most libraries target CPython.

```python
import dis

def area(w, h):
    return w * h

dis.dis(area)   # shows LOAD_FAST, BINARY_OP, RETURN_VALUE ...
```

Python 3.13 also shipped a new interactive REPL with multi-line editing, colour and paste mode.

#### Interview tip
- Python is "interpreted" in the sense that bytecode is interpreted; it is still compiled first. Saying "Python compiles to bytecode, then the CPython VM runs it" shows you understand the pipeline.

### Names, variables and assignment
<!-- level: basic; ref: https://docs.python.org/3/reference/executionmodel.html#naming-and-binding -->
In Python a variable is a name bound to an object, not a box that holds a value. `x = 10` creates (or finds) an integer object and binds the name `x` to it. Assigning `y = x` binds a second name to the same object; nothing is copied.

Python is dynamically typed: names have no fixed type, objects do. You can rebind `x` to a string later. It is also strongly typed: `"3" + 4` raises `TypeError` instead of silently converting.

Assignment supports several handy forms:

```python
count = 0                     # simple binding
a, b = 1, 2                   # tuple unpacking
a, b = b, a                   # swap without a temp variable
first, *rest = [10, 20, 30]   # star unpacking -> rest == [20, 30]
x = y = []                    # BOTH names point to ONE list
total += 5                    # augmented assignment (rebinds for ints)
```

Naming conventions (PEP 8): `snake_case` for variables and functions, `PascalCase` for classes, `UPPER_CASE` for module-level constants. Python has no true constants; the uppercase name is a convention.

#### Pitfalls
- `x = y = []` makes both names share one list; appending through one is visible through the other.
- Shadowing built-ins (`list = [1, 2]`, `id = 5`) breaks later calls to `list()` or `id()` in that scope.

### Numbers and arithmetic
<!-- level: basic; ref: https://docs.python.org/3/library/stdtypes.html#numeric-types-int-float-complex -->
Python has three built-in numeric types: `int`, `float` and `complex`. Integers have arbitrary precision, so `2 ** 200` just works; there is no overflow. Floats are IEEE-754 double precision, which means some decimal fractions cannot be represented exactly.

Key operators: `/` is true division and always returns a float; `//` is floor division (rounds toward negative infinity); `%` is the matching remainder; `**` is power; `divmod(a, b)` returns both quotient and remainder.

```python
7 / 2          # 3.5
7 // 2         # 3
-7 // 2        # -4  (floors, does not truncate)
0.1 + 0.2      # 0.30000000000000004

from decimal import Decimal
from fractions import Fraction
Decimal("0.1") + Decimal("0.2")    # Decimal('0.3') - use for money
Fraction(1, 3) + Fraction(1, 6)    # Fraction(1, 2)

import math
math.isclose(0.1 + 0.2, 0.3)       # True - compare floats this way
round(2.5), round(3.5)             # (2, 4) banker's rounding
1_000_000                          # underscores for readability
```

#### Pitfalls
- Never compare floats with `==` after arithmetic; use `math.isclose`.
- Build `Decimal` from strings, not floats: `Decimal(0.1)` captures the float's binary error.
- `round()` uses round-half-to-even, which surprises people expecting 2.5 to become 3.

### Strings and f-strings
<!-- level: basic; ref: https://docs.python.org/3/reference/lexical_analysis.html#f-strings -->
A `str` is an immutable sequence of Unicode code points. Because strings are immutable, every "modification" creates a new string, which is why building large text should use `"".join(parts)` rather than repeated `+=` in a loop.

Useful methods include `split`, `join`, `strip`, `replace`, `startswith`, `lower`, `casefold` (for caseless comparison), and since 3.9 `removeprefix` / `removesuffix`.

f-strings (formatted string literals) evaluate expressions inline and support the format mini-language:

```python
name, total, ratio = "Asha", 1234.5, 0.4567
f"{name} paid {total:,.2f}"        # 'Asha paid 1,234.50'
f"{ratio:.1%}"                     # '45.7%'
f"{name!r:>10}"                    # repr, right-aligned in 10 chars
f"{total=}"                        # 'total=1234.5' (3.8+, great for debugging)
f"{'nested' + "quotes"}"           # same quote type allowed inside (3.12+)

path = "report.csv".removesuffix(".csv")   # 'report'
"a,b,,c".split(",")                        # ['a', 'b', '', 'c']
```

Python 3.12 formalised f-string grammar (PEP 701), allowing reused quotes, backslashes and comments inside replacement fields. Python 3.14 added template strings (`t"..."`, PEP 750), which produce a `Template` object instead of a `str` so libraries can safely process interpolations, for example to escape SQL or HTML.

#### Pitfalls
- Never build SQL with f-strings from user input; use parameterised queries.
- `str.strip("abc")` removes any of those characters from both ends, not the substring "abc".

### Control flow
<!-- level: basic; ref: https://docs.python.org/3/tutorial/controlflow.html -->
Python uses indentation, not braces, to define blocks. The core statements are `if/elif/else`, `for`, `while`, `break`, `continue`, `pass` and, since 3.10, `match`.

A `for` loop iterates over any iterable, not over index numbers. Idiomatic helpers replace manual counters:

```python
orders = ["A12", "B07", "C33"]
amounts = [250, 99, 410]

for i, order in enumerate(orders, start=1):
    print(i, order)

for order, amount in zip(orders, amounts, strict=True):   # 3.10+: error on length mismatch
    if amount > 300:
        print("large", order)
        break
else:
    print("no large orders")    # runs only if the loop did NOT break

retries = 0
while retries < 3:
    retries += 1
```

The `else` clause on loops runs when the loop finishes without `break`; it is ideal for search loops. `range(start, stop, step)` produces a lazy sequence of integers and excludes `stop`.

A conditional expression gives a one-line choice: `label = "even" if n % 2 == 0 else "odd"`.

#### Pitfalls
- Modifying a list while iterating over it skips elements; iterate over a copy or build a new list.
- `zip` silently truncates to the shortest input unless you pass `strict=True`.

#### Interview tip
- Explaining `for ... else` correctly is a common screening question: think of `else` as "no break".

### Truthiness, None and comparisons
<!-- level: basic; ref: https://docs.python.org/3/library/stdtypes.html#truth-value-testing -->
Every object has a truth value. Falsy values are `None`, `False`, zero of any numeric type, and empty containers (`""`, `[]`, `{}`, `set()`, `range(0)`). Everything else is truthy unless its class defines `__bool__` or `__len__` to say otherwise.

`None` is the single instance of `NoneType` and represents "no value". Test it with `is None`, because it is a singleton and `==` can be overridden.

The boolean operators `and` and `or` short-circuit and return one of their operands, not necessarily `True`/`False`:

```python
name = user_input or "anonymous"     # fallback when input is empty
config = loaded and loaded.get("db")  # avoids AttributeError when loaded is None

if 0 < age < 120:                     # chained comparison = (0 < age) and (age < 120)
    ...

if items:                             # idiomatic emptiness check
    process(items)

if value is None:                     # not: if not value  (0 and "" are valid values!)
    value = default
```

Comparisons can be chained, and `==` compares values while `is` compares identity.

#### Pitfalls
- `x or default` replaces legitimate falsy values like `0` or `""`. When only `None` should trigger the fallback, use `default if x is None else x`.
- `bool("False")` is `True`: any non-empty string is truthy.

## 2. The Python Data Model

### Everything is an object
<!-- level: basic; ref: https://docs.python.org/3/reference/datamodel.html#objects-values-and-types -->
In Python, integers, functions, classes, modules and even `None` are objects. Every object has three properties:

- Identity: a unique id for its lifetime (`id(obj)`; in CPython this is the memory address).
- Type: determines supported operations (`type(obj)`), and it never changes.
- Value: the data, which may or may not be changeable.

Because functions and classes are objects, you can store them in dicts, pass them as arguments and create them at runtime. This uniformity is what makes decorators, plugin registries and dependency injection so lightweight in Python.

```python
def greet(name):
    return f"hi {name}"

handlers = {"greet": greet, "upper": str.upper}
handlers["greet"]("Ravi")         # 'hi Ravi'

type(greet)                       # <class 'function'>
type(int)                         # <class 'type'>  - classes are objects too
isinstance(True, int)             # True - bool is a subclass of int

greet.owner = "team-a"            # functions can even carry attributes
```

Prefer `isinstance(obj, Cls)` over `type(obj) == Cls` for type checks: it respects inheritance and accepts a tuple of types (or, since 3.10, a union such as `int | float`).

#### Interview tip
- The phrase "the data model" refers to the documented set of special methods (`__len__`, `__iter__`, `__eq__`...) that let your own objects behave like built-ins. Mentioning it signals you know where Python's behaviour is specified.

### Mutability and hashability
<!-- level: basic; ref: https://docs.python.org/3/glossary.html#term-hashable -->
An object is mutable if its value can change after creation (`list`, `dict`, `set`, most user classes) and immutable if it cannot (`int`, `float`, `str`, `tuple`, `frozenset`, `bytes`).

An object is hashable if it has a hash value that never changes during its lifetime and can be compared for equality. Only hashable objects can be dict keys or set members, because dicts and sets locate items by hash. Built-in immutable types are hashable; mutable built-in containers are not.

```python
locations = {}
locations[(12.97, 77.59)] = "Bengaluru"   # tuple key: OK
locations[[12.97, 77.59]] = "x"           # TypeError: unhashable type: 'list'

t = ([1], 2)
hash(t)                                   # TypeError: a tuple is hashable only if its items are

s = "abc"
s2 = s.upper()          # new object; s unchanged
nums = [3, 1, 2]
nums.sort()             # same object changed in place, returns None
```

A rule that follows from this: objects that compare equal must have equal hashes. If you define `__eq__` on a class, Python sets `__hash__` to `None` (making instances unhashable) unless you also define `__hash__`.

#### Pitfalls
- Methods that mutate in place (`list.sort`, `list.append`, `dict.update`) return `None`; `nums = nums.sort()` loses your list.
- An immutable container can still hold mutable items, so "immutable" does not mean "deeply frozen".

### References, aliasing and argument passing
<!-- level: intermediate; ref: https://docs.python.org/3/faq/programming.html#how-do-i-write-a-function-with-output-parameters-call-by-reference -->
Python passes arguments by object reference (sometimes called "call by sharing"). The function parameter becomes a new name bound to the same object the caller passed. Two consequences follow:

- If the function mutates that object, the caller sees the change.
- If the function rebinds the parameter to a new object, the caller does not see it.

```python
def add_tag(tags):
    tags.append("new")      # mutation: visible to caller

def reset(tags):
    tags = []               # rebinding: local only

my_tags = ["a"]
add_tag(my_tags)            # my_tags == ['a', 'new']
reset(my_tags)              # my_tags unchanged
```

Augmented assignment differs by mutability. For a list, `a += [1]` calls `__iadd__`, which extends the list in place, so every alias sees it. For a tuple or int, `+=` creates a new object and rebinds only that name.

```python
a = [1]; b = a
a += [2]        # b is [1, 2] too
x = (1,); y = x
x += (2,)       # y is still (1,)
```

Aliasing bugs are common with nested structures: `grid = [[0] * 3] * 3` creates three references to the same inner list. Use `[[0] * 3 for _ in range(3)]` instead.

#### Interview tip
- Avoid saying "Python is pass-by-value" or "pass-by-reference"; neither is accurate. Describe the mutate vs rebind distinction with an example.

### Memory management: reference counting and garbage collection
<!-- level: intermediate; ref: https://docs.python.org/3/library/gc.html -->
CPython manages memory automatically with two mechanisms.

Reference counting is the primary one. Every object tracks how many references point to it. When the count drops to zero (a name is rebound, a container is cleared, a function returns), the object is freed immediately. This gives predictable cleanup and is why files are often closed promptly even without `with` in CPython (though you should not rely on it).

Reference counting cannot free cycles, for example two objects that refer to each other. A cyclic garbage collector (the `gc` module) periodically scans container objects, finds groups that are only reachable from each other, and frees them. Python 3.14 switched to an incremental collector to reduce pause times on large heaps.

```python
import gc, sys, weakref

class Node:
    def __init__(self):
        self.parent = None
        self.children = []

root, child = Node(), Node()
child.parent = root
root.children.append(child)      # cycle: root <-> child
del root, child                  # refcounts never reach 0
gc.collect()                     # cycle collector frees them

class Cache: ...
c = Cache()
r = weakref.ref(c)               # weak reference does not keep c alive
sys.getrefcount(c)               # includes the temporary argument reference
```

`weakref` lets caches and observer lists refer to objects without keeping them alive.

#### Pitfalls
- Memory "leaks" in Python are usually lingering references: global caches, unbounded `lru_cache`, closures, or exception tracebacks that keep frames alive.
- Other implementations (PyPy) do not use reference counting, so cleanup timing differs; always close resources explicitly.

### Structural pattern matching
<!-- level: intermediate; ref: https://docs.python.org/3/tutorial/controlflow.html#match-statements -->
Python 3.10 introduced the `match` statement (PEP 634). It is not just a switch: it matches the shape of data and binds parts of it to names in one step. Patterns can be literals, sequences, mappings, class patterns, alternatives with `|`, captures, the wildcard `_`, and guards with `if`.

It shines when handling messages, parsed JSON, ASTs or commands with several shapes.

```python
def handle(event: dict) -> str:
    match event:
        case {"type": "click", "pos": (x, y)}:
            return f"click at {x},{y}"
        case {"type": "key", "key": "q" | "Q"}:
            return "quit"
        case {"type": "resize", "size": (w, h)} if w > 0 and h > 0:
            return f"resize {w}x{h}"
        case {"type": str(kind)}:
            return f"unhandled {kind}"
        case _:
            return "invalid event"

from dataclasses import dataclass

@dataclass
class Point:
    x: int
    y: int

match Point(0, 5):
    case Point(x=0, y=y):     # class pattern using attributes
        print("on y axis at", y)
```

Mapping patterns match if the listed keys exist (extra keys are ignored). Sequence patterns do not match strings, avoiding a classic trap.

#### Pitfalls
- A bare name in a pattern is a capture, not a comparison: `case RED:` binds anything to `RED`. Use dotted names (`Color.RED`) or literals for constants.
- Do not use `match` for simple value dispatch where a dict lookup is clearer.

## 3. Built-in Collections

### Lists, slicing and sorting
<!-- level: basic; ref: https://docs.python.org/3/tutorial/datastructures.html#more-on-lists -->
A `list` is a dynamic array of references. It over-allocates capacity so `append` is amortised O(1). Indexing and assignment by index are O(1), while `insert(0, x)`, `pop(0)` and `x in lst` are O(n) because elements must shift or be scanned.

Slicing `seq[start:stop:step]` returns a new list (a shallow copy). Negative indexes count from the end. Slice assignment can replace, insert or delete ranges in place.

```python
nums = [5, 3, 8, 1, 9, 2]
nums[1:4]        # [3, 8, 1]
nums[::-1]       # reversed copy
nums[-2:]        # last two
nums[1:3] = []   # delete a range in place

orders = [{"id": 1, "amt": 300}, {"id": 2, "amt": 120}, {"id": 3, "amt": 300}]
by_amount = sorted(orders, key=lambda o: o["amt"], reverse=True)

from operator import itemgetter
orders.sort(key=itemgetter("amt", "id"))   # in place, multi-key
```

`sorted()` returns a new list from any iterable; `list.sort()` sorts in place and returns `None`. Python's sort is stable: equal keys keep their original order, which allows multi-pass sorting (sort by secondary key first, then primary). Use `key=` rather than comparison functions; `functools.cmp_to_key` exists for legacy code.

#### Pitfalls
- Using a list as a queue with `pop(0)` is O(n) per pop; use `collections.deque`.
- For membership tests in a loop, convert the list to a `set` first.

### Tuples and unpacking
<!-- level: basic; ref: https://docs.python.org/3/tutorial/datastructures.html#tuples-and-sequences -->
A `tuple` is an immutable, ordered sequence. Use it for fixed-size records where position has meaning (a coordinate, an RGB value, a database row) and when you need a hashable composite key. A list, by contrast, is for a variable number of homogeneous items.

The comma makes the tuple, not the parentheses: `t = 1, 2` is a tuple and `single = (5,)` needs the trailing comma.

Unpacking works with any iterable and supports a single starred target:

```python
point = (12.9, 77.6)
lat, lon = point

def min_max(values):
    return min(values), max(values)    # returns a tuple
lo, hi = min_max([4, 9, 1])

head, *middle, tail = [1, 2, 3, 4, 5]  # middle == [2, 3, 4]

for name, (lat, lon) in [("BLR", (12.9, 77.6))]:   # nested unpacking
    print(name, lat)

from typing import NamedTuple
class Row(NamedTuple):
    sku: str
    qty: int
r = Row("X1", 3)
r.qty, r[1]          # access by name or position
```

`NamedTuple` (or `collections.namedtuple`) adds field names with no per-instance overhead beyond a tuple. For records with defaults, methods or mutability, a dataclass is usually a better fit.

#### Interview tip
- Tuples are slightly faster to create and use less memory than lists, but the real reason to choose one is intent: immutability and fixed structure.

### Dictionaries
<!-- level: basic; ref: https://docs.python.org/3/library/stdtypes.html#mapping-types-dict -->
A `dict` maps hashable keys to values using a hash table, giving average O(1) lookup, insertion and deletion. Since Python 3.7 dicts preserve insertion order as a language guarantee. CPython's "compact dict" layout stores entries in a dense array plus a sparse index table, which is both memory-efficient and ordered.

Common operations:

```python
stock = {"apple": 10, "pear": 4}
stock.get("kiwi", 0)                 # 0 instead of KeyError
stock.setdefault("kiwi", 0)          # insert if missing, return value
stock.pop("pear", None)              # remove safely

for sku, qty in stock.items():       # views reflect live changes
    print(sku, qty)

defaults = {"timeout": 5, "retries": 3}
overrides = {"retries": 5}
config = defaults | overrides        # merge (3.9+): right side wins
defaults |= overrides                # in-place merge

squares = {n: n * n for n in range(5)}
inverted = {v: k for k, v in stock.items()}
```

`keys()`, `values()` and `items()` return view objects; `keys()` and `items()` support set operations like `a.keys() & b.keys()`.

#### Pitfalls
- Changing a dict's size while iterating over it raises `RuntimeError`; iterate over `list(d)` if you must delete.
- Keys `1`, `1.0` and `True` are equal and hash the same, so they collide into one key.
- Avoid `if key in d: v = d[key]` double lookups in hot code; use `d.get(key)` or try/except.

### Sets and frozensets
<!-- level: basic; ref: https://docs.python.org/3/library/stdtypes.html#set-types-set-frozenset -->
A `set` is an unordered collection of unique hashable items, backed by a hash table like dict keys. Membership tests (`x in s`) are average O(1), which makes sets the go-to tool for deduplication and fast lookups. A `frozenset` is the immutable, hashable version, so it can be a dict key or an element of another set.

Sets support mathematical operations, both as operators and methods (methods accept any iterable):

```python
yesterday = {"u1", "u2", "u3"}
today = {"u2", "u3", "u4"}

today & yesterday        # {'u2', 'u3'}  returning users
today - yesterday        # {'u4'}        new users
today | yesterday        # union
today ^ yesterday        # symmetric difference
{"u2"} <= today          # subset test -> True

seen = set()
unique_in_order = [x for x in ["b", "a", "b", "c"] if not (x in seen or seen.add(x))]
unique_in_order_simple = list(dict.fromkeys(["b", "a", "b", "c"]))  # ['b', 'a', 'c']

empty = set()            # NOT {} - that is an empty dict
```

Iteration order of a set is arbitrary and can differ between runs for strings (hash randomisation), so never depend on it. If you need unique items in first-seen order, use `dict.fromkeys(items)`.

#### Pitfalls
- Converting a list to a set to check membership once is slower than scanning the list; the conversion pays off only for repeated lookups.
- Sets of floats inherit floating-point equality issues.

### The collections module
<!-- level: intermediate; ref: https://docs.python.org/3/library/collections.html -->
The `collections` module provides specialised containers that remove a lot of boilerplate:

- `deque`: double-ended queue with O(1) appends and pops at both ends; `maxlen` makes it a ring buffer.
- `Counter`: a dict subclass for counting hashable items, with `most_common()` and arithmetic.
- `defaultdict`: calls a factory to create missing values, ideal for grouping.
- `ChainMap`: views several dicts as one, searching them in order (layered config).
- `OrderedDict`: still useful for `move_to_end` and order-sensitive equality, e.g. LRU caches.
- `namedtuple`: tuple subclass with named fields.

```python
from collections import Counter, defaultdict, deque, ChainMap

words = "to be or not to be".split()
Counter(words).most_common(2)          # [('to', 2), ('be', 2)]

by_status = defaultdict(list)
for order_id, status in [(1, "paid"), (2, "new"), (3, "paid")]:
    by_status[status].append(order_id) # no KeyError on first use

recent = deque(maxlen=3)
for event in range(10):
    recent.append(event)               # keeps only last 3: deque([7, 8, 9])

import os
settings = ChainMap(dict(os.environ), {"LOG_LEVEL": "INFO"})
```

The abstract base classes (`Iterable`, `Mapping`, `Sequence`...) live in `collections.abc` and are used for isinstance checks and for building your own containers.

#### Pitfalls
- Reading a missing key from a `defaultdict` inserts it, which can silently grow the dict; use `.get()` when you only want to look.
