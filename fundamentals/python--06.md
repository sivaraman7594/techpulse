## 13. Testing with pytest

### pytest basics
<!-- level: basic; ref: https://docs.pytest.org/en/stable/getting-started.html -->
pytest is the de facto standard test runner for Python. Tests are plain functions whose names start with `test_`, in files named `test_*.py` or `*_test.py`. You use the ordinary `assert` statement: pytest rewrites assertions at import time so failures show the actual values of both sides, with no need for `assertEqual`-style methods.

```python
# src/shop/pricing.py
def apply_discount(price: float, percent: float) -> float:
    if not 0 <= percent <= 100:
        raise ValueError("percent must be 0-100")
    return round(price * (1 - percent / 100), 2)

# tests/test_pricing.py
import pytest
from shop.pricing import apply_discount

def test_applies_percentage():
    assert apply_discount(200, 10) == 180.0

def test_rejects_invalid_percent():
    with pytest.raises(ValueError, match="0-100"):
        apply_discount(100, 150)

def test_float_result():
    assert apply_discount(10, 33) == pytest.approx(6.7)
```

Useful command-line options:

```bash
pytest -q                     # quiet
pytest -x                     # stop on first failure
pytest -k "discount and not slow"   # select by name expression
pytest --lf                   # rerun only last failures
pytest -n auto                # parallel (pytest-xdist plugin)
```

A good unit test follows Arrange, Act, Assert, checks one behaviour, has a descriptive name, and runs in milliseconds without network access. pytest also runs existing `unittest` test cases, so migration can be gradual.

#### Pitfalls
- `assert (a, b)` with parentheses is always true (a non-empty tuple); pytest warns about it.
- Tests that depend on execution order or shared global state become flaky; each test should set up what it needs.

### Fixtures
<!-- level: intermediate; ref: https://docs.pytest.org/en/stable/how-to/fixtures.html -->
Fixtures provide test dependencies: data, objects, temporary files, database connections. A test requests a fixture simply by naming it as a parameter, and pytest injects the result. Fixtures can depend on other fixtures, forming a graph that pytest resolves.

Fixtures written with `yield` run teardown code after the test, even when it fails. The `scope` controls how often a fixture is created: `function` (default), `class`, `module`, `package` or `session`. Fixtures placed in `conftest.py` are shared by all tests in that directory and below without imports.

```python
# tests/conftest.py
import sqlite3
import pytest

@pytest.fixture(scope="session")
def schema_sql() -> str:
    return "CREATE TABLE orders (id TEXT PRIMARY KEY, amount REAL)"

@pytest.fixture
def db(schema_sql):
    con = sqlite3.connect(":memory:")
    con.execute(schema_sql)
    yield con                 # test runs here
    con.close()               # teardown

@pytest.fixture
def make_order(db):
    def _make(order_id="A1", amount=100.0):        # factory fixture
        db.execute("INSERT INTO orders VALUES (?, ?)", (order_id, amount))
        return order_id
    return _make

# tests/test_orders.py
def test_total(db, make_order):
    make_order("A1", 100)
    make_order("A2", 50)
    (total,) = db.execute("SELECT SUM(amount) FROM orders").fetchone()
    assert total == 150
```

Built-in fixtures include `tmp_path` (a unique temporary directory as a `Path`), `monkeypatch`, `capsys` (captured output) and `caplog` (captured logs).

#### Pitfalls
- Broad-scoped fixtures holding mutable state leak changes between tests; use session scope only for expensive, read-only resources or reset state per test.
- `autouse=True` fixtures run invisibly for every test; use sparingly so tests stay understandable.

### Parametrisation and markers
<!-- level: intermediate; ref: https://docs.pytest.org/en/stable/how-to/parametrize.html -->
`@pytest.mark.parametrize` runs the same test body with several input sets, each reported as a separate test case. It removes copy-pasted tests and makes edge cases cheap to add. Use `pytest.param(..., id="...")` for readable names and to attach marks to individual cases.

Markers attach metadata to tests: `skip`, `skipif`, `xfail` (expected failure), and custom markers such as `slow` or `integration` that you select or exclude on the command line. Register custom markers in configuration so typos are caught with `--strict-markers`.

```python
import sys
import pytest
from shop.validation import is_valid_pincode

@pytest.mark.parametrize(
    ("pincode", "expected"),
    [
        ("560001", True),
        ("000000", False),
        pytest.param("56000", False, id="too-short"),
        pytest.param(" 560001", False, id="leading-space"),
    ],
)
def test_pincode(pincode, expected):
    assert is_valid_pincode(pincode) is expected

@pytest.mark.skipif(sys.platform == "win32", reason="uses POSIX signals")
def test_graceful_shutdown(): ...

@pytest.mark.slow
def test_full_catalogue_import(): ...
```

```toml
[tool.pytest.ini_options]
markers = ["slow: long-running tests", "integration: needs external services"]
addopts = "--strict-markers"
```

Run `pytest -m "not slow"` locally and the full suite in CI.

#### Pitfalls
- Huge parameter tables hide intent; group cases by behaviour and give them ids.
- `xfail` without `strict=True` lets a test that unexpectedly passes go unnoticed.

### Mocking and monkeypatching
<!-- level: intermediate; ref: https://docs.python.org/3/library/unittest.mock.html -->
Unit tests should not call real payment gateways, send emails or depend on the current time. Test doubles replace those collaborators.

- `monkeypatch` (pytest fixture): set or delete attributes, environment variables and dict items for the duration of one test, then restore them.
- `unittest.mock`: `Mock`/`MagicMock` objects record calls and return configured values; `patch` replaces a name temporarily; `AsyncMock` handles coroutines.

The golden rule of `patch`: replace the name where it is looked up, not where it is defined. If `orders.py` does `from payments import charge`, patch `orders.charge`.

```python
from unittest.mock import patch, Mock
import pytest
import orders

def test_checkout_charges_card(monkeypatch):
    fake_charge = Mock(return_value="txn-1")
    monkeypatch.setattr(orders, "charge", fake_charge)
    monkeypatch.setenv("CURRENCY", "INR")

    result = orders.checkout(cart_id="C9", amount=499)

    assert result.txn_id == "txn-1"
    fake_charge.assert_called_once_with(499, currency="INR")

def test_checkout_handles_gateway_down():
    with patch("orders.charge", side_effect=TimeoutError):
        with pytest.raises(orders.CheckoutFailed):
            orders.checkout(cart_id="C9", amount=499)

def test_spec_catches_typos():
    gateway = Mock(spec=orders.Gateway)   # attributes must exist on the real class
    gateway.chrage(1)                      # AttributeError - typo caught
```

Prefer designing for testability: inject dependencies (pass a client or a clock into the function) so tests can supply fakes without patching internals.

#### Pitfalls
- Over-mocking tests implementation details; refactors break tests even when behaviour is unchanged.
- Mocks without `spec`/`autospec` accept any attribute or signature, so tests pass against APIs that no longer exist.

### Coverage and test strategy
<!-- level: intermediate; ref: https://coverage.readthedocs.io/en/latest/ -->
Coverage measures which lines (and branches) ran during tests. `coverage.py`, usually via the `pytest-cov` plugin, reports it. Coverage reveals untested code; it does not prove the tested code is correct, since a line can execute without any assertion checking its result.

```bash
pytest --cov=shop --cov-branch --cov-report=term-missing
pytest --cov=shop --cov-fail-under=85     # gate in CI
```

A balanced strategy:

- Many fast unit tests for pure logic (pricing, parsing, validation).
- Fewer integration tests against real dependencies in containers (a real PostgreSQL via Docker or Testcontainers) to catch SQL, serialisation and configuration issues that mocks hide.
- A small number of end-to-end tests of critical user journeys.
- Property-based tests with Hypothesis for logic with many inputs: you state invariants and Hypothesis generates and shrinks counterexamples.

```python
from hypothesis import given, strategies as st
from shop.codec import encode, decode

@given(st.text())
def test_round_trip(s):
    assert decode(encode(s)) == s     # invariant holds for any string Hypothesis finds
```

Run tests on every push in CI across supported Python versions (a matrix), and include linting (ruff) and type checking (mypy or pyright) in the same pipeline.

#### Pitfalls
- Chasing 100% line coverage invites low-value tests; target critical paths and branches.
- Slow suites get skipped by developers. Keep the default run under a few minutes and mark slow tests.

#### Interview tip
- When asked how you test code that calls external APIs, describe layers: unit tests with fakes, contract or recorded-response tests (e.g. respx or VCR-style), and a few integration tests against a sandbox.

## 14. Python Web Frameworks Overview

### WSGI, ASGI and the framework landscape
<!-- level: basic; ref: https://asgi.readthedocs.io/en/latest/introduction.html -->
Python web frameworks sit on top of a standard interface between servers and applications.

- WSGI (PEP 3333) is the synchronous standard: the server calls your app once per request and waits for the response. Servers: Gunicorn, uWSGI. Frameworks: Flask, Django (classic mode).
- ASGI is the asynchronous successor: apps are async callables that can handle long-lived connections like WebSockets and server-sent events, and many concurrent requests per worker. Servers: Uvicorn, Hypercorn, Granian. Frameworks: FastAPI, Starlette, Django (async views), Litestar.

Choosing a framework:

- Django: batteries-included full-stack framework with ORM, admin, auth, migrations and templating. Best for database-backed products and teams that value convention.
- FastAPI: API-first, async, type-hint-driven validation and automatic OpenAPI docs. Popular for microservices and ML model serving.
- Flask: minimal and flexible; you pick extensions for each concern.

```python
# Minimal ASGI app without any framework, to show the interface
async def app(scope, receive, send):
    assert scope["type"] == "http"
    await send({"type": "http.response.start", "status": 200,
                "headers": [(b"content-type", b"text/plain")]})
    await send({"type": "http.response.body", "body": b"ok"})

# run with: uvicorn module:app
```

In production you typically run several worker processes (Gunicorn managing Uvicorn workers, or Uvicorn with `--workers`), behind a reverse proxy or load balancer that terminates TLS.

#### Pitfalls
- An async framework does not make blocking code fast: a sync database call inside an `async def` route blocks that worker's event loop.

### FastAPI
<!-- level: intermediate; ref: https://fastapi.tiangolo.com/tutorial/ -->
FastAPI builds HTTP APIs from type-annotated Python functions. It uses Starlette for the ASGI layer and Pydantic for validation. From your function signatures it parses path, query and body parameters, validates them, converts types, serialises responses and generates an OpenAPI schema with interactive docs at `/docs`.

Dependency injection via `Depends` provides shared resources (database sessions, current user, settings) and makes them easy to override in tests.

```python
from typing import Annotated
from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

app = FastAPI(title="Orders API")

class OrderIn(BaseModel):
    sku: str = Field(min_length=3)
    qty: int = Field(gt=0, le=100)

class OrderOut(OrderIn):
    id: int

async def get_repo():
    repo = OrderRepo()
    try:
        yield repo
    finally:
        await repo.close()

Repo = Annotated[OrderRepo, Depends(get_repo)]

@app.post("/orders", response_model=OrderOut, status_code=201)
async def create_order(order: OrderIn, repo: Repo) -> OrderOut:
    return await repo.add(order)

@app.get("/orders/{order_id}")
async def get_order(order_id: int, repo: Repo,
                    include_items: Annotated[bool, Query()] = False) -> OrderOut:
    order = await repo.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    return order
```

Invalid input automatically returns a 422 response describing which field failed. Tests use `TestClient` (or `httpx.AsyncClient` with an ASGI transport) and `app.dependency_overrides` to swap real dependencies for fakes.

#### Pitfalls
- Declaring a route `async def` and then calling blocking libraries stalls the server. If a route must use blocking code, declare it with plain `def`; FastAPI runs those in a thread pool.
- Returning ORM objects directly can leak fields; always declare a response model.

### Pydantic for data validation
<!-- level: intermediate; ref: https://docs.pydantic.dev/latest/ -->
Pydantic validates and converts data using type annotations. You declare a model class; when you construct it from untrusted input (JSON, environment variables, CSV rows), Pydantic checks types and constraints, coerces compatible values (the string "5" to the integer 5 in lax mode), and raises a detailed `ValidationError` listing every problem. Pydantic v2 has its validation core written in Rust, making it much faster than v1.

Main tools: `BaseModel`, `Field` constraints, `field_validator` and `model_validator` for custom rules, `model_dump`/`model_dump_json` for serialisation, `TypeAdapter` for validating non-model types, and the separate `pydantic-settings` package for configuration from environment variables.

```python
from datetime import date
from pydantic import BaseModel, EmailStr, Field, ValidationError, field_validator

class Customer(BaseModel):
    model_config = {"str_strip_whitespace": True, "extra": "forbid"}

    name: str = Field(min_length=1, max_length=80)
    email: EmailStr                      # needs the email-validator extra
    birthday: date | None = None
    tags: list[str] = []                 # safe: Pydantic copies defaults

    @field_validator("tags")
    @classmethod
    def lowercase_tags(cls, v: list[str]) -> list[str]:
        return [t.lower() for t in v]

try:
    c = Customer.model_validate({"name": " Asha ", "email": "asha@example.com",
                                 "birthday": "1990-04-12", "tags": ["VIP"]})
    c.model_dump_json()
except ValidationError as e:
    print(e.errors())
```

Use Pydantic at system boundaries (requests, config, messages), and plain dataclasses internally where validation has already happened.

#### Pitfalls
- v1 and v2 APIs differ (`.dict()` became `.model_dump()`, validators changed); check which version a codebase targets.
- Lax coercion may accept data you intended to reject; enable strict mode for fields where exact types matter.

### Django
<!-- level: intermediate; ref: https://docs.djangoproject.com/en/stable/intro/overview/ -->
Django is a full-stack web framework following a model-template-view pattern. A project is made of apps; each app typically contains models (database tables defined as Python classes), views (functions or classes handling requests), URL routes, templates and an admin configuration.

Key components:

- ORM and migrations: define models in Python; `makemigrations` and `migrate` evolve the schema safely.
- Admin: an automatically generated back-office UI for your models.
- Auth, sessions, forms, CSRF protection and security middleware out of the box.
- Django REST Framework (third-party) or Django Ninja for building JSON APIs.
- Async views and an async ORM interface are supported in modern versions, though much of the ecosystem is still synchronous.

```python
# shop/models.py
from django.db import models

class Product(models.Model):
    sku = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=200)
    price = models.DecimalField(max_digits=10, decimal_places=2)

class Order(models.Model):
    created = models.DateTimeField(auto_now_add=True)
    items = models.ManyToManyField(Product, through="OrderItem")

class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    qty = models.PositiveIntegerField()

# shop/views.py
from django.http import JsonResponse
def recent_orders(request):
    orders = (Order.objects.order_by("-created")
              .prefetch_related("items")[:20])        # avoid N+1 queries
    return JsonResponse({"orders": [o.id for o in orders]})
```

QuerySets are lazy: no SQL runs until you iterate, slice with a step, or call methods like `count()`.

#### Pitfalls
- The N+1 query problem: looping over objects and touching a related field fires one query per row. Use `select_related` (joins for foreign keys) and `prefetch_related` (separate query for many-to-many and reverse relations).
- Never run with `DEBUG = True` in production; it exposes settings and stack traces.
