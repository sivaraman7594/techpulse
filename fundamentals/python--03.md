## 6. Object-Oriented Python

### Classes and instances
<!-- level: basic; ref: https://docs.python.org/3/tutorial/classes.html -->
A class bundles data (attributes) and behaviour (methods). Calling the class creates an instance: Python calls `__new__` to allocate the object and then `__init__` to initialise it. Methods receive the instance explicitly as their first parameter, by convention `self`.

Attribute lookup on an instance checks the instance's `__dict__` first, then the class, then base classes. That is why class attributes act as shared defaults, and assigning to `self.x` creates an instance attribute that shadows the class one.

```python
class BankAccount:
    bank_name = "TechPulse Bank"          # class attribute: shared

    def __init__(self, owner: str, balance: float = 0.0):
        self.owner = owner                # instance attributes
        self.balance = balance

    def deposit(self, amount: float) -> None:
        if amount <= 0:
            raise ValueError("amount must be positive")
        self.balance += amount

    def __repr__(self) -> str:
        return f"BankAccount(owner={self.owner!r}, balance={self.balance})"

acct = BankAccount("Asha")
acct.deposit(500)          # same as BankAccount.deposit(acct, 500)
acct                       # BankAccount(owner='Asha', balance=500)
vars(acct)                 # {'owner': 'Asha', 'balance': 500}
```

Python has no `private` keyword. A single leading underscore (`_cache`) signals "internal, do not rely on it". Treat the class's public attributes and methods as its API.

#### Pitfalls
- A mutable class attribute (`items = []`) is shared by every instance; initialise per-instance state in `__init__`.
- Not every concept needs a class. Plain functions and modules are idiomatic in Python; use classes when state and behaviour belong together.

### Instance, class and static methods
<!-- level: basic; ref: https://docs.python.org/3/library/functions.html#classmethod -->
Methods come in three flavours, distinguished by what they receive automatically:

- Instance methods receive the instance (`self`) and can read or change its state. This is the default.
- Class methods (`@classmethod`) receive the class (`cls`). They are mainly used as alternative constructors, and because `cls` is the actual class called, they work correctly with subclasses.
- Static methods (`@staticmethod`) receive nothing extra. They are ordinary functions placed in the class namespace for organisation.

```python
from datetime import date

class Invoice:
    tax_rate = 0.18

    def __init__(self, number: str, amount: float, issued: date):
        self.number, self.amount, self.issued = number, amount, issued

    def total(self) -> float:                        # instance method
        return self.amount * (1 + self.tax_rate)

    @classmethod
    def from_csv_row(cls, row: str) -> "Invoice":    # alternative constructor
        number, amount, issued = row.split(",")
        return cls(number, float(amount), date.fromisoformat(issued))

    @staticmethod
    def is_valid_number(number: str) -> bool:        # utility, no state needed
        return number.startswith("INV-")

class ExportInvoice(Invoice):
    tax_rate = 0.0

inv = ExportInvoice.from_csv_row("INV-9,1000,2026-01-05")
type(inv).__name__     # 'ExportInvoice' - cls respected the subclass
inv.total()            # 1000.0
```

#### Interview tip
- When asked "classmethod vs staticmethod", the strongest answer mentions inheritance: a classmethod constructor builds the right subclass, while a staticmethod or hard-coded class name would not.

### Inheritance, MRO and super()
<!-- level: intermediate; ref: https://docs.python.org/3/library/functions.html#super -->
A subclass inherits attributes and methods from its base classes and can override them. Python supports multiple inheritance, so it needs a deterministic order for method lookup: the Method Resolution Order (MRO), computed with the C3 linearisation algorithm. You can inspect it with `Cls.__mro__`. The rule guarantees that a class appears before its bases and that the left-to-right order of bases is preserved.

`super()` does not mean "my parent"; it means "the next class in the MRO of the instance's type". This lets cooperative classes each call `super()` so that every implementation in a diamond runs exactly once.

```python
class Base:
    def save(self):
        print("Base.save")

class TimestampMixin(Base):
    def save(self):
        print("set updated_at")
        super().save()

class AuditMixin(Base):
    def save(self):
        print("write audit log")
        super().save()

class Order(TimestampMixin, AuditMixin):
    pass

Order().save()
# set updated_at -> write audit log -> Base.save
[c.__name__ for c in Order.__mro__]
# ['Order', 'TimestampMixin', 'AuditMixin', 'Base', 'object']
```

Mixins are small classes providing one capability, combined through multiple inheritance. Keep them stateless or make their `__init__` accept and forward `**kwargs`.

#### Pitfalls
- Calling `Base.save(self)` directly instead of `super().save()` breaks cooperative chains and can run a method twice.
- Deep hierarchies are hard to reason about. Prefer composition (holding a collaborator object) when the relationship is "has a" rather than "is a".

### Properties and encapsulation
<!-- level: intermediate; ref: https://docs.python.org/3/library/functions.html#property -->
In Python you start with plain public attributes. If you later need validation or computation, you convert the attribute into a property without changing the caller's syntax. This is why Python code rarely needs Java-style `get_x()`/`set_x()` methods.

A property is a descriptor that routes attribute access to getter, setter and deleter functions.

```python
class Temperature:
    def __init__(self, celsius: float):
        self.celsius = celsius            # goes through the setter

    @property
    def celsius(self) -> float:
        return self._celsius

    @celsius.setter
    def celsius(self, value: float) -> None:
        if value < -273.15:
            raise ValueError("below absolute zero")
        self._celsius = value

    @property
    def fahrenheit(self) -> float:        # read-only computed attribute
        return self._celsius * 9 / 5 + 32

t = Temperature(25)
t.fahrenheit        # 77.0
t.celsius = -300    # ValueError
t.fahrenheit = 10   # AttributeError: no setter
```

Naming conventions: `_name` means internal by convention. `__name` (two leading underscores) triggers name mangling to `_ClassName__name`, which avoids accidental clashes in subclasses; it is not a security feature.

#### Pitfalls
- Properties should be cheap. If access does I/O or heavy computation, a method (or `cached_property`) communicates the cost better.
- A setter that assigns to `self.celsius` instead of `self._celsius` recurses forever.

### Dunder methods: representation, equality and hashing
<!-- level: intermediate; ref: https://docs.python.org/3/reference/datamodel.html#basic-customization -->
Special ("dunder") methods let your objects plug into Python's syntax and built-ins. The first ones every class should consider:

- `__repr__`: unambiguous developer representation, ideally valid Python to recreate the object. Used in the REPL, logs and debuggers.
- `__str__`: friendly representation for end users; falls back to `__repr__`.
- `__eq__`: value equality. Without it, `==` compares identity.
- `__hash__`: required for use in sets and as dict keys. Equal objects must have equal hashes.
- `__lt__` etc.: ordering, used by `sorted` and `min`/`max`.
- `__bool__`: truthiness.

```python
from functools import total_ordering

@total_ordering
class Version:
    def __init__(self, text: str):
        self.parts = tuple(int(p) for p in text.split("."))

    def __repr__(self):
        return f"Version({'.'.join(map(str, self.parts))!r})"

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented          # let Python try the other side
        return self.parts == other.parts

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return self.parts < other.parts

    def __hash__(self):
        return hash(self.parts)

sorted([Version("1.10.0"), Version("1.2.3")])   # [Version('1.2.3'), Version('1.10.0')]
```

#### Pitfalls
- Defining `__eq__` without `__hash__` makes instances unhashable (Python sets `__hash__ = None`).
- Hashing on mutable fields breaks sets and dicts if the object changes after insertion.
- Return `NotImplemented` (not `False`, not raise) for unsupported types.

### Emulating containers, numbers and callables
<!-- level: intermediate; ref: https://docs.python.org/3/reference/datamodel.html#emulating-container-types -->
Implementing a few more dunder methods makes your objects feel built-in, so they work with `len()`, `in`, indexing, `for` loops, operators and function-call syntax.

- Containers: `__len__`, `__getitem__`, `__setitem__`, `__delitem__`, `__contains__`, `__iter__`.
- Numeric operators: `__add__`, `__mul__`, and reflected versions like `__radd__` used when the left operand does not support the operation; in-place versions like `__iadd__`.
- Callables: `__call__` lets an instance be called like a function, useful for configured strategies.

```python
class Money:
    def __init__(self, paise: int, currency: str = "INR"):
        self.paise, self.currency = paise, currency
    def __add__(self, other):
        if isinstance(other, Money) and other.currency == self.currency:
            return Money(self.paise + other.paise, self.currency)
        return NotImplemented
    def __radd__(self, other):              # makes sum([...]) work (0 + Money)
        return self if other == 0 else NotImplemented
    def __repr__(self):
        return f"Money({self.paise / 100:.2f} {self.currency})"

sum([Money(1050), Money(250)])          # Money(13.00 INR)

class Playlist:
    def __init__(self, songs): self._songs = list(songs)
    def __len__(self): return len(self._songs)
    def __getitem__(self, i): return self._songs[i]   # enables slicing and iteration
    def __contains__(self, s): return s in self._songs

class Threshold:
    def __init__(self, limit): self.limit = limit
    def __call__(self, value): return value > self.limit

is_large = Threshold(1000)
list(filter(is_large, [500, 1500]))     # [1500]
```

#### Interview tip
- If you implement only `__getitem__` with integer indexes, iteration and `in` already work through the legacy sequence protocol, but implementing `__iter__` and `__contains__` explicitly is clearer and faster.

### Abstract base classes
<!-- level: intermediate; ref: https://docs.python.org/3/library/abc.html -->
An abstract base class (ABC) defines an interface that subclasses must implement. Methods marked `@abstractmethod` must be overridden; trying to instantiate a class that still has abstract methods raises `TypeError` at construction time, catching mistakes early.

ABCs suit cases where you own the hierarchy and want shared behaviour plus enforced methods, for example a plugin system with a template method.

```python
from abc import ABC, abstractmethod

class PaymentGateway(ABC):
    def charge(self, amount: int, token: str) -> str:
        self._validate(amount)
        return self._do_charge(amount, token)      # template method

    def _validate(self, amount: int) -> None:
        if amount <= 0:
            raise ValueError("amount must be positive")

    @abstractmethod
    def _do_charge(self, amount: int, token: str) -> str: ...

class FakeGateway(PaymentGateway):
    def _do_charge(self, amount, token):
        return f"fake-txn-{amount}"

FakeGateway().charge(100, "tok")       # 'fake-txn-100'
PaymentGateway()                       # TypeError: can't instantiate abstract class
```

The `collections.abc` module provides ABCs for container protocols (`Iterable`, `Mapping`, `MutableSequence`...). Inheriting from `collections.abc.Mapping` and implementing three methods (`__getitem__`, `__iter__`, `__len__`) gives you `get`, `keys`, `items`, `__contains__` and equality for free.

#### Pitfalls
- ABCs require inheritance (nominal typing). If you only want static type checking of "anything with these methods", a `typing.Protocol` is lighter and works with classes you do not control.

### __slots__ and object memory
<!-- level: advanced; ref: https://docs.python.org/3/reference/datamodel.html#slots -->
By default each instance stores its attributes in a per-instance `__dict__`, a hash table that is flexible but costs memory. Declaring `__slots__` tells Python to reserve fixed storage for a known set of attributes instead and to omit the `__dict__`.

Benefits: noticeably less memory per instance (helpful when you create millions of small objects) and slightly faster attribute access. It also prevents typos from silently creating new attributes.

```python
import sys

class PointDict:
    def __init__(self, x, y):
        self.x, self.y = x, y

class PointSlots:
    __slots__ = ("x", "y")
    def __init__(self, x, y):
        self.x, self.y = x, y

p = PointSlots(1, 2)
p.z = 3            # AttributeError: no slot 'z'

from dataclasses import dataclass

@dataclass(slots=True)      # 3.10+: dataclass generates __slots__ for you
class Tick:
    symbol: str
    price: float
```

How it works: each slot becomes a descriptor on the class that reads and writes a fixed offset inside the instance. Measure the actual saving with `tracemalloc` rather than `sys.getsizeof`, which does not include the `__dict__`.

#### Pitfalls
- Every class in the hierarchy needs `__slots__`, otherwise a subclass reintroduces `__dict__`.
- Slotted classes cannot have arbitrary attributes, which breaks some libraries that monkeypatch instances; add `"__weakref__"` to slots if weak references are needed.

### Descriptors, __init_subclass__ and metaclasses
<!-- level: advanced; ref: https://docs.python.org/3/howto/descriptor.html -->
These are the mechanisms frameworks use to make declarative APIs like Django models or ORMs.

A descriptor is any object defining `__get__`, `__set__` or `__delete__`, stored as a class attribute. Attribute access on instances is routed through it. Properties, methods, `classmethod`, `staticmethod` and slots are all descriptors. `__set_name__` (3.6+) tells the descriptor which attribute name it was assigned to.

```python
class Positive:
    def __set_name__(self, owner, name):
        self.private = "_" + name
    def __get__(self, obj, objtype=None):
        return self if obj is None else getattr(obj, self.private)
    def __set__(self, obj, value):
        if value <= 0:
            raise ValueError(f"{self.private[1:]} must be > 0")
        setattr(obj, self.private, value)

class LineItem:
    qty = Positive()
    price = Positive()
    def __init__(self, qty, price):
        self.qty, self.price = qty, price      # validated by the descriptor

class Plugin:
    registry = {}
    def __init_subclass__(cls, /, name=None, **kw):   # hook runs for every subclass
        super().__init_subclass__(**kw)
        Plugin.registry[name or cls.__name__] = cls

class CsvExporter(Plugin, name="csv"): ...
Plugin.registry          # {'csv': <class 'CsvExporter'>}
```

A metaclass is the class of a class (`type` by default). Subclassing `type` lets you customise class creation itself. Since `__init_subclass__` and `__set_name__` cover most needs (registration, validation), metaclasses are rarely necessary today.

#### Interview tip
- Know the lookup precedence: data descriptors (define `__set__`) on the class beat the instance `__dict__`, which beats non-data descriptors such as plain functions.

## 7. Dataclasses, Enums and Type Hints

### Dataclasses
<!-- level: basic; ref: https://docs.python.org/3/library/dataclasses.html -->
`@dataclass` (3.7+) generates boilerplate for classes that mainly hold data: `__init__`, `__repr__` and `__eq__` by default, and optionally ordering, hashing, immutability and slots. Fields are declared with type annotations; the annotations are used for code generation but not enforced at runtime.

```python
from dataclasses import dataclass, field, asdict, replace
from datetime import datetime

@dataclass(frozen=True, slots=True, kw_only=True)   # slots/kw_only need 3.10+
class Order:
    order_id: str
    amount: float
    tags: list[str] = field(default_factory=list)   # never a bare [] default
    created: datetime = field(default_factory=datetime.now, compare=False)

    def __post_init__(self):
        if self.amount < 0:
            raise ValueError("negative amount")

o = Order(order_id="A1", amount=99.5)
o2 = replace(o, amount=120.0)       # new instance with one field changed
asdict(o)                           # recursive dict, handy for JSON
o.amount = 5                        # FrozenInstanceError
```

Python 3.13 added `copy.replace()`, a general protocol that also works on dataclasses, named tuples and some built-ins like `datetime`.

Useful options: `order=True` generates comparison methods; `frozen=True` makes instances immutable and hashable; `field(repr=False)` hides secrets from logs; `InitVar` passes init-only values to `__post_init__`.

#### Pitfalls
- Dataclasses do not validate types. If you parse untrusted input (API payloads, config), use Pydantic or attrs with validators.
- A frozen dataclass containing a list is only shallowly immutable.
- Fields without defaults cannot follow fields with defaults unless you use `kw_only=True`.

### Enums
<!-- level: basic; ref: https://docs.python.org/3/library/enum.html -->
An `Enum` defines a fixed set of named constants. Members are singletons, so they can be compared with `is`, iterated, and looked up by name or value. Enums replace "magic strings" that are easy to mistype and give type checkers and IDEs something to verify.

```python
from enum import Enum, StrEnum, IntFlag, auto

class OrderStatus(StrEnum):          # 3.11+: members are also str
    NEW = auto()                     # value 'new' (lower-cased name)
    PAID = auto()
    SHIPPED = auto()

status = OrderStatus("paid")         # lookup by value
status is OrderStatus.PAID           # True
f"status={status}"                   # 'status=paid' - serialises naturally
OrderStatus["SHIPPED"]               # lookup by name
[s.value for s in OrderStatus]       # ['new', 'paid', 'shipped']

class Permission(IntFlag):
    READ = auto()
    WRITE = auto()
    DELETE = auto()

perms = Permission.READ | Permission.WRITE
Permission.WRITE in perms            # True
```

Variants: `Enum` (generic), `IntEnum` and `StrEnum` (interoperate with ints/strings, useful for JSON and databases), `Flag`/`IntFlag` (combinable bit flags). Enums can have methods and properties. Use `@unique` to forbid duplicate values, and pattern-match on members with `case OrderStatus.PAID:`.

#### Pitfalls
- A plain `Enum` member does not equal its value: `OrderStatus.PAID == "paid"` is false for `Enum` but true for `StrEnum`. Be deliberate about which you want.
- Persist `.value`, not the member name, if names might be refactored.

### Type hints and static type checking
<!-- level: intermediate; ref: https://docs.python.org/3/library/typing.html -->
Type hints (PEP 484) annotate parameters, return values and variables with expected types. The interpreter does not enforce them; they are consumed by static type checkers (mypy, pyright, and newer Rust-based tools), IDEs for autocompletion, and runtime libraries such as Pydantic and FastAPI.

Modern syntax keeps hints short: built-in generics such as `list[int]` and `dict[str, float]` (3.9+), and union types with `|` such as `int | None` (3.10+).

```python
from collections.abc import Iterable, Callable

def average(values: Iterable[float]) -> float:
    total = count = 0
    for v in values:
        total += v
        count += 1
    return total / count if count else 0.0

def find_user(user_id: int) -> dict[str, str] | None: ...

Handler = Callable[[str, int], bool]       # function taking (str, int) returning bool
retries: int = 3
```

Gradual typing means you can add hints incrementally; unannotated code is treated as `Any`, which disables checking. Run the checker in CI and tighten settings (for mypy, `--strict`) over time.

Guidelines: accept abstract types (`Iterable`, `Mapping`, `Sequence`) in parameters for flexibility, return concrete types for precision, and avoid `Any` except at true boundaries. Use `typing.cast` or `# type: ignore[code]` sparingly and with a reason.

#### Pitfalls
- Hints are not validation. `def f(x: int)` happily receives a string at runtime.
- `list[int]` is invariant: a function accepting `list[float]` will not type-check with a `list[int]`; accept `Sequence[float]` instead.

### Generics and the type parameter syntax
<!-- level: advanced; ref: https://docs.python.org/3/reference/compound_stmts.html#type-params -->
Generics let one function or class work with many types while preserving type information, so a checker knows that `first([1, 2])` returns an `int` and not "anything".

Python 3.12 (PEP 695) added dedicated syntax: type parameters in square brackets after the name, and the `type` statement for aliases. Before 3.12 you declared `T = TypeVar("T")` at module level and inherited from `Generic[T]`.

```python
# Python 3.12+
def first[T](items: list[T]) -> T:
    return items[0]

class Repository[T]:
    def __init__(self) -> None:
        self._items: dict[int, T] = {}
    def add(self, key: int, item: T) -> None:
        self._items[key] = item
    def get(self, key: int) -> T | None:
        return self._items.get(key)

def largest[N: (int, float)](a: N, b: N) -> N:     # constrained type parameter
    return a if a > b else b

class HasId: id: int
def by_id[E: HasId](items: list[E]) -> dict[int, E]:   # upper bound
    return {e.id: e for e in items}

type JSON = dict[str, "JSON"] | list["JSON"] | str | int | float | bool | None
type Pair[T] = tuple[T, T]                           # generic alias, lazily evaluated

# Pre-3.12 equivalent
from typing import TypeVar, Generic
T = TypeVar("T")
class OldRepo(Generic[T]): ...
```

Python 3.13 added defaults for type parameters (PEP 696), e.g. `class Box[T = int]: ...`. `ParamSpec` (written `**P` in the new syntax) types decorators that preserve a function's signature.

#### Pitfalls
- New syntax is a hard syntax error on older interpreters; libraries supporting older versions must keep `TypeVar`.

### Protocols and structural typing
<!-- level: intermediate; ref: https://docs.python.org/3/library/typing.html#typing.Protocol -->
Python's runtime philosophy is duck typing: if an object has the methods you need, it works. `typing.Protocol` (3.8+, PEP 544) brings that idea to static typing. A protocol describes required methods and attributes; any class that has them matches, without inheriting from the protocol. This is called structural subtyping, as opposed to nominal subtyping with ABCs.

```python
from typing import Protocol, runtime_checkable

class SupportsWrite(Protocol):
    def write(self, data: str, /) -> int: ...

def export_report(rows: list[str], out: SupportsWrite) -> None:
    for row in rows:
        out.write(row + "\n")

import io, sys
export_report(["a", "b"], sys.stdout)       # real file: OK
export_report(["a"], io.StringIO())         # StringIO: OK, no inheritance needed

@runtime_checkable
class Closeable(Protocol):
    def close(self) -> None: ...

isinstance(io.StringIO(), Closeable)       # True - checks method presence only
```

Protocols are ideal for dependency injection and testing: your function depends on "something with `send()`" and a test can pass a tiny fake class. They also let you type third-party objects you cannot modify.

#### Pitfalls
- `@runtime_checkable` isinstance checks only verify that the names exist, not their signatures or return types.
- Choose ABCs when you need shared implementation or construction-time enforcement; choose Protocols for interfaces at module boundaries.

### Advanced typing tools
<!-- level: advanced; ref: https://docs.python.org/3/library/typing.html#special-typing-primitives -->
The `typing` module has precise tools for common modelling problems. Version numbers show when each became available in the standard library (most are backported via `typing_extensions`).

- `Literal["r", "w"]`: only specific values allowed (3.8).
- `TypedDict`: types for dict-shaped data like JSON, with `Required`/`NotRequired` (3.11) and `ReadOnly` (3.13) keys.
- `Final`: a name that must not be reassigned (3.8).
- `Self`: return type for methods returning their own class (3.11).
- `@override`: marks a method as overriding a base method so the checker catches renames (3.12).
- `TypeIs` (3.13) and `TypeGuard` (3.10): user-defined narrowing functions.
- `Annotated[T, metadata]`: attach extra metadata used by frameworks like FastAPI and Pydantic (3.9).
- `@warnings.deprecated` (3.13): mark APIs deprecated for both runtime warnings and checkers.

```python
from typing import Literal, TypedDict, NotRequired, Self, TypeIs, Final, override

MAX_RETRIES: Final = 3

class UserPayload(TypedDict):
    id: int
    email: str
    phone: NotRequired[str]

def open_store(mode: Literal["read", "write"]) -> None: ...

class QueryBuilder:
    def where(self, clause: str) -> Self:
        self._where = clause
        return self

def is_str_list(val: list[object]) -> TypeIs[list[str]]:
    return all(isinstance(x, str) for x in val)

class Base:
    def run(self) -> None: ...
class Job(Base):
    @override
    def run(self) -> None: ...
```

#### Pitfalls
- `TypedDict` describes plain dicts; it performs no validation at runtime.

### Annotations at runtime (3.14 deferred evaluation)
<!-- level: advanced; ref: https://docs.python.org/3/library/annotationlib.html -->
Historically, annotations were evaluated eagerly when a function or class was defined. That caused two problems: forward references (a class referring to itself or to a class defined later) needed quotes, and evaluating expensive or circular-import types slowed module import. The workaround was `from __future__ import annotations` (PEP 563), which stores every annotation as a string.

Python 3.14 implements PEP 649 and PEP 749: annotations are evaluated lazily, only when something asks for them. The compiler stores a small function that computes them on demand. Forward references just work without quotes, and imports become cheaper. The new `annotationlib` module lets tools request annotations in different formats: actual values, forward-reference proxies for names that are not yet defined, or source strings.

```python
# Python 3.14: no quotes needed
class Node:
    def add_child(self, child: Node) -> Node:   # Node is not yet fully defined here
        return child

import annotationlib
annotationlib.get_annotations(Node.add_child)                       # evaluated values
annotationlib.get_annotations(Node.add_child,
                              format=annotationlib.Format.STRING)   # source strings

# Recommended way to read annotations on any version
import inspect
inspect.get_annotations(Node.add_child, eval_str=True)
```

Runtime consumers (dataclasses, Pydantic, FastAPI, typer) read annotations, so they benefit directly. `from __future__ import annotations` still works in 3.14 and is planned for eventual deprecation.

#### Pitfalls
- Code that reads `obj.__annotations__` directly can behave differently between versions; use `annotationlib.get_annotations` (3.14) or `inspect.get_annotations` (3.10+).
- With lazy annotations, a typo in a type name is no longer an error at definition time; it surfaces when annotations are evaluated, often inside a framework.
