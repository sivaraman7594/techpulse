## 8. Modules, Packages and Environments

### Modules and the import system
<!-- level: intermediate; ref: https://docs.python.org/3/reference/import.html -->
A module is a `.py` file (or compiled extension) whose top-level names form a namespace. `import x` does three things: find the module using finders that search `sys.path`, load it by executing its top-level code once in a fresh module object, and bind the name in the importing namespace. The module object is cached in `sys.modules`, so subsequent imports anywhere in the process return the same object without re-running the code.

`sys.path` starts with the script's directory (or the current directory for `-m` and the REPL), then `PYTHONPATH`, then the standard library and `site-packages` of the active environment.

```python
import json                       # binds 'json'
from pathlib import Path          # binds 'Path' only
import numpy as np                # alias
from .utils import slugify        # relative import inside a package

import sys, importlib
sys.modules["json"]               # the cached module object
importlib.reload(my_module)       # re-executes code (dev/REPL use only)
importlib.import_module("plugins.csv_export")   # dynamic import by string
```

Because modules execute top to bottom on first import, keep top-level code to definitions and cheap constants. Side effects at import time (opening DB connections, reading large files) slow startup and make tests brittle.

#### Pitfalls
- Circular imports: if `a` imports `b` while `b` imports `a`, one of them sees a partially initialised module and fails with `ImportError` or `AttributeError`. Fix by moving shared code into a third module, importing inside functions, or importing the module (`import a`) rather than names (`from a import x`).
- Naming your file `random.py` or `json.py` shadows the standard library module for everything in that directory.
- `from module import *` pollutes namespaces; avoid it outside interactive use.

### Packages, __init__.py and __main__
<!-- level: intermediate; ref: https://docs.python.org/3/tutorial/modules.html#packages -->
A package is a directory of modules. A regular package contains an `__init__.py`, which runs when the package is first imported and can expose a curated public API. Directories without `__init__.py` are namespace packages, which can be split across several locations; they are mainly useful for plugin ecosystems, so most projects should include `__init__.py`.

Every module has `__name__`. When run as a script it is `"__main__"`, which is why the guard below lets a file be both importable and executable. A package can contain `__main__.py` so that `python -m package` runs it.

```text
src/
  shopkit/
    __init__.py        # from .cart import Cart ; __all__ = ["Cart"]
    __main__.py        # entry point for: python -m shopkit
    cart.py
    pricing/
      __init__.py
      rules.py         # from ..cart import Cart  (relative import)
```

```python
# cart.py
class Cart: ...

def main() -> None:
    print("demo")

if __name__ == "__main__":     # runs only when executed directly
    main()
```

`__all__` lists the names exported by `from package import *` and documents the public API.

#### Pitfalls
- Running a file inside a package directly (`python shopkit/pricing/rules.py`) breaks relative imports with "attempted relative import with no known parent package". Run it as a module from the project root: `python -m shopkit.pricing.rules`.
- Heavy imports in `__init__.py` make importing any submodule slow; keep it light or use lazy imports with module-level `__getattr__`.

### Virtual environments
<!-- level: basic; ref: https://docs.python.org/3/library/venv.html -->
A virtual environment is an isolated directory with its own `site-packages` and a link or copy of a Python interpreter. Each project gets its own dependency versions, so upgrading a library for project A cannot break project B, and you never need admin rights or touch the system Python.

The `venv` module ships with Python. Activation simply puts the environment's `bin` (or `Scripts` on Windows) directory first on `PATH`; you can also call the environment's interpreter directly without activating.

```bash
python -m venv .venv                 # create
source .venv/bin/activate            # Linux/macOS
.venv\Scripts\activate               # Windows (PowerShell: .venv\Scripts\Activate.ps1)
python -m pip install requests       # always use "python -m pip" to target this interpreter
deactivate

.venv/bin/python -m pytest           # no activation needed
```

Under the hood, a `pyvenv.cfg` file in the environment points to the base interpreter, and `sys.prefix` differs from `sys.base_prefix` when you are inside a venv, which is how tools detect it.

Modern tools such as uv, Poetry, PDM and Hatch create and manage environments automatically, but they use the same mechanism.

#### Pitfalls
- Never commit `.venv` to git; commit the dependency declaration and lock file instead.
- Environments are not relocatable: moving or renaming the folder breaks scripts with hard-coded interpreter paths. Recreate instead.
- `pip install` without an active venv may install into the user or system site-packages; many Linux distributions now block this (PEP 668 "externally managed environment").

### Dependencies, pinning and lock files
<!-- level: intermediate; ref: https://packaging.python.org/en/latest/guides/installing-using-pip-and-virtual-environments/ -->
There are two different kinds of dependency information, and mixing them up causes most packaging pain:

- Abstract requirements: what your code needs, with flexible ranges, e.g. `httpx>=0.27`. Libraries declare only these, so they can coexist with other packages.
- Locked requirements: the exact versions (and ideally hashes) of every package, including transitive ones, that were tested together. Applications and deployments install from these for reproducibility.

```text
# pyproject.toml (abstract)
dependencies = ["httpx>=0.27,<1", "pydantic>=2.6"]

# requirements.txt generated as a lock
httpx==0.28.1 --hash=sha256:...
anyio==4.6.2 --hash=sha256:...
```

```bash
python -m pip install -r requirements.txt
python -m pip freeze > requirements.txt    # snapshot (includes everything installed)
python -m pip check                        # report broken/incompatible requirements

uv lock && uv sync                         # uv: resolve to uv.lock, install exactly
```

Version specifiers follow PEP 440: `==`, `>=`, `<`, `!=`, and compatible release `~=1.4` (meaning `>=1.4,<2.0`). PEP 751 (accepted 2025) standardises a cross-tool lock file named `pylock.toml`; adoption across tools is still in progress.

#### Pitfalls
- Over-pinning a library (`requests==2.31.0` in a library's metadata) makes it impossible to install alongside others. Pin exactly only in applications.
- `pip freeze` captures whatever happens to be installed, including leftovers; generating locks from declared requirements is cleaner.
- Use the same Python version and platform for locking as for production, since wheels and markers differ.

### pyproject.toml and building distributions
<!-- level: intermediate; ref: https://packaging.python.org/en/latest/guides/writing-pyproject-toml/ -->
`pyproject.toml` is the standard configuration file for Python projects. It contains three main areas: `[build-system]` declares which build backend creates your package (setuptools, hatchling, flit-core, pdm-backend, uv_build...), `[project]` holds standard metadata (name, version, dependencies, entry points), and `[tool.*]` sections configure tools like pytest, ruff and mypy.

Building produces two artifact types: a source distribution (sdist, a `.tar.gz` of the source) and a wheel (`.whl`, a pre-built zip that installs by unpacking, with no code execution). Wheels can be pure Python (`py3-none-any`) or platform-specific when they contain compiled extensions.

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "shopkit"
version = "1.2.0"
requires-python = ">=3.11"
dependencies = ["httpx>=0.27"]

[project.optional-dependencies]
pdf = ["reportlab>=4"]

[project.scripts]
shopkit = "shopkit.cli:main"     # installs a 'shopkit' command

[tool.pytest.ini_options]
testpaths = ["tests"]
```

```bash
python -m build              # creates dist/*.whl and dist/*.tar.gz
python -m twine upload dist/*  # publish (or use trusted publishing in CI)
pip install -e .             # editable install for development
```

The src layout (`src/shopkit/`) prevents tests from accidentally importing the local folder instead of the installed package.

#### Pitfalls
- `setup.py install` and direct `setup.py` invocations are deprecated; use `pip` and `build`.
- Forgetting `requires-python` lets users on old interpreters install a release that cannot run.

### Resolving dependency conflicts
<!-- level: advanced; ref: https://pip.pypa.io/en/stable/topics/dependency-resolution/ -->
A conflict happens when two packages require incompatible versions of a shared dependency, for example `lib-a` needs `protobuf<4` and `lib-b` needs `protobuf>=5`. Since pip 20.3 the resolver backtracks: it tries candidate versions until it finds a consistent set or proves none exists, which is when you see `ResolutionImpossible`.

A systematic approach:

1. Read the error: it names the packages and the conflicting specifiers.
2. Inspect the dependency tree to see who requires what (`pipdeptree`, `uv tree`).
3. Look for versions that overlap: often upgrading the stricter package (newer releases relax bounds) or downgrading the other solves it.
4. If no overlap exists, isolate: split into separate services or environments, or vendor one tool via `pipx`/`uv tool` when it is a CLI.
5. As a last resort, use an override/constraint (`uv` supports overrides; pip supports `-c constraints.txt`) and test thoroughly.

```bash
python -m pip install "lib-a" "lib-b"        # ResolutionImpossible ...
uv tree --invert --package protobuf          # who depends on protobuf?
python -m pip install -c constraints.txt -r requirements.txt
```

Prevention: keep libraries' upper bounds loose, lock applications, update dependencies regularly in small steps (Dependabot/Renovate) instead of yearly big-bang upgrades, and run tests against the lock in CI.

#### Pitfalls
- Very slow resolution usually means too many unbounded candidates; adding reasonable lower bounds speeds it up.
- Forcing installs with `--no-deps` hides the conflict until runtime.

## 9. Errors, Resources and Files

### Exceptions and try/except/else/finally
<!-- level: basic; ref: https://docs.python.org/3/tutorial/errors.html -->
Python reports errors with exceptions. When one is raised, the current block stops and Python unwinds the call stack looking for a matching `except`. If none matches, the program terminates with a traceback.

The full statement has four parts:

- `try`: code that may fail; keep it as small as possible.
- `except SomeError as e`: handle a specific type (and its subclasses).
- `else`: runs only if no exception occurred, keeping success logic out of the `try`.
- `finally`: always runs, for cleanup.

```python
import json

def load_config(path: str) -> dict:
    try:
        f = open(path, encoding="utf-8")
    except FileNotFoundError:
        return {}
    else:
        with f:
            try:
                return json.loads(f.read())
            except json.JSONDecodeError as e:
                raise ValueError(f"bad config {path}: line {e.lineno}") from e
    finally:
        print("load_config finished")

try:
    value = int(user_text)
except (ValueError, TypeError):        # several types
    value = 0
```

All built-in errors inherit from `Exception`, which inherits from `BaseException`. `KeyboardInterrupt`, `SystemExit` and `GeneratorExit` inherit only from `BaseException`, so `except Exception` does not swallow Ctrl+C.

Python 3.14 (PEP 758) allows `except ValueError, TypeError:` without parentheses when not using `as`, and (PEP 765) emits a `SyntaxWarning` for `return`, `break` or `continue` inside `finally`, because they silently discard exceptions.

#### Pitfalls
- Bare `except:` or `except BaseException:` catches `KeyboardInterrupt` and `SystemExit`.
- Catching broadly and continuing (`except Exception: pass`) hides bugs; log with `logger.exception` and re-raise unless you can genuinely recover.

### Raising, custom exceptions and chaining
<!-- level: intermediate; ref: https://docs.python.org/3/library/exceptions.html#exception-context -->
Define custom exceptions so callers can handle your failure modes precisely. A small hierarchy with one base class per library lets users catch everything from you with one clause, or specific cases individually.

When you catch one exception and raise another, Python records the original. `raise New() from err` sets `__cause__` and prints "The above exception was the direct cause...". Without `from`, the original is stored as `__context__` ("During handling... another exception occurred"), which usually signals an accidental error in the handler. `raise New() from None` hides the original when it is irrelevant noise.

```python
class PaymentError(Exception):
    """Base for all payment errors."""

class CardDeclined(PaymentError):
    def __init__(self, code: str, message: str = "card declined"):
        super().__init__(f"{message} ({code})")
        self.code = code

class GatewayUnavailable(PaymentError):
    pass

def charge(amount: int) -> str:
    try:
        return _http_charge(amount)
    except TimeoutError as err:
        raise GatewayUnavailable("payment gateway timed out") from err

try:
    charge(500)
except CardDeclined as e:
    notify_user(e.code)
except PaymentError as e:
    e.add_note(f"amount=500")    # 3.11+: extra context shown in the traceback
    raise                        # bare raise re-raises with the original traceback
```

#### Pitfalls
- Using exceptions for normal control flow in hot loops is slower than a check, though "easier to ask forgiveness than permission" (EAFP) is idiomatic for things like dict lookups and file access.
- Raising generic `Exception("...")` forces callers to parse messages. Raise specific built-ins (`ValueError`, `KeyError`) or your own types.

### Exception groups and except*
<!-- level: advanced; ref: https://docs.python.org/3/tutorial/errors.html#raising-and-handling-multiple-unrelated-exceptions -->
Sometimes several independent failures happen together, for instance three concurrent tasks fail, or a validation pass finds many problems. Python 3.11 (PEP 654) introduced `ExceptionGroup`, which wraps a list of exceptions, and the `except*` syntax, which handles matching members of a group while letting unmatched ones propagate.

Each `except*` clause receives a sub-group containing only the matching exceptions, and more than one clause can run for a single group.

```python
import asyncio

async def fetch(name: str, fail: type[Exception] | None):
    await asyncio.sleep(0.1)
    if fail:
        raise fail(f"{name} failed")
    return name

async def main():
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(fetch("users", None))
            tg.create_task(fetch("orders", TimeoutError))
            tg.create_task(fetch("prices", ValueError))
    except* TimeoutError as eg:
        for exc in eg.exceptions:
            print("retryable:", exc)
    except* ValueError as eg:
        print("bad data:", [str(e) for e in eg.exceptions])

asyncio.run(main())

errors = [ValueError("age < 0"), KeyError("email")]
if errors:
    raise ExceptionGroup("invalid user record", errors)
```

`asyncio.TaskGroup` raises an `ExceptionGroup` when children fail, so modern async code needs `except*` (or catching `ExceptionGroup` directly and inspecting it). Groups can be nested, and `eg.split()` / `eg.subgroup()` filter them.

#### Pitfalls
- A plain `except TimeoutError` does not catch a `TimeoutError` wrapped in a group.
- You cannot mix `except` and `except*` in the same `try` statement, and `break`/`continue`/`return` are not allowed inside `except*` blocks.

### Writing context managers
<!-- level: intermediate; ref: https://docs.python.org/3/library/contextlib.html -->
The `with` statement calls `__enter__` on entry and `__exit__(exc_type, exc, tb)` on exit, even when an exception occurs. If `__exit__` returns a true value the exception is suppressed. This guarantees release of resources: files, locks, network connections, temporary state.

You can write one as a class or, more concisely, with `@contextmanager` around a generator: code before `yield` is setup, the yielded value is bound by `as`, and code after it is teardown (wrap it in `try/finally` so it runs on errors).

```python
import time, os
from contextlib import contextmanager, ExitStack, suppress

class Timer:
    def __enter__(self):
        self.start = time.perf_counter()
        return self
    def __exit__(self, exc_type, exc, tb):
        self.elapsed = time.perf_counter() - self.start
        return False                  # do not suppress exceptions

@contextmanager
def temp_env(**values):
    old = {k: os.environ.get(k) for k in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

with Timer() as t, temp_env(APP_MODE="test"):
    run_job()
print(f"{t.elapsed:.2f}s")

with suppress(FileNotFoundError):
    os.remove("stale.lock")

with ExitStack() as stack:              # dynamic number of resources
    files = [stack.enter_context(open(p)) for p in paths]
```

Async versions use `async with`, `__aenter__`/`__aexit__` and `@asynccontextmanager`.

#### Pitfalls
- Forgetting `try/finally` around `yield` in `@contextmanager` means teardown is skipped when the body raises.

### File I/O, pathlib and encodings
<!-- level: basic; ref: https://docs.python.org/3/library/pathlib.html -->
`open()` returns a file object; always use it in a `with` block so it is closed. Mode letters: `r`, `w` (truncate), `a` (append), `x` (create, fail if exists), plus `b` for binary. Text mode decodes bytes to `str` using an encoding; binary mode returns `bytes`.

Always pass `encoding="utf-8"` in text mode. The default encoding depends on the platform locale (historically cp1252 on Windows), which causes "works on my machine" bugs. PEP 686 plans to make UTF-8 mode the default in Python 3.15; until then, be explicit or run with `-X utf8`.

`pathlib.Path` represents filesystem paths as objects with readable operations and cross-platform separators.

```python
from pathlib import Path

base = Path("data") / "2026" / "orders"          # '/' joins paths
base.mkdir(parents=True, exist_ok=True)

out = base / "summary.txt"
out.write_text("total=42\n", encoding="utf-8")
text = out.read_text(encoding="utf-8")

for csv_path in sorted(base.glob("*.csv")):      # rglob for recursive
    print(csv_path.stem, csv_path.suffix, csv_path.stat().st_size)

with open(base / "big.log", encoding="utf-8", errors="replace") as f:
    for line in f:                                # streams line by line
        ...

data = Path("photo.jpg").read_bytes()
"naïve".encode("utf-8")       # b'na\xc3\xafve'
b"na\xc3\xafve".decode("utf-8")
```

For safe updates, write to a temporary file in the same directory and `os.replace()` it over the target; the replace is atomic on the same filesystem.

#### Pitfalls
- `f.read()` loads the entire file into memory; iterate lines or read chunks for large files.
- Opening CSV files for the `csv` module needs `newline=""` to handle embedded line breaks correctly.

### Logging
<!-- level: intermediate; ref: https://docs.python.org/3/howto/logging.html -->
The `logging` module gives you levels, timestamps, destinations and per-module control that `print` cannot. Its parts:

- Loggers: named objects in a dot-separated hierarchy; create one per module with `logging.getLogger(__name__)`.
- Handlers: where records go (console, file, rotating file, syslog, HTTP).
- Formatters: the record layout.
- Levels: DEBUG, INFO, WARNING, ERROR, CRITICAL; a record passes if its level is at or above the logger's and handler's thresholds.

Libraries should only create loggers and never configure handlers; applications configure logging once at startup.

```python
import logging

logger = logging.getLogger(__name__)

def process(order_id: str) -> None:
    logger.info("processing order %s", order_id)     # lazy %-formatting
    try:
        charge(order_id)
    except Exception:
        logger.exception("charge failed for %s", order_id)   # includes traceback
        raise

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    logging.getLogger("urllib3").setLevel(logging.WARNING)   # quiet a noisy library
    process("A12")
```

For services, emit structured (JSON) logs with request ids so log platforms can filter them, using a JSON formatter or `structlog`, and configure via `logging.config.dictConfig`.

#### Pitfalls
- `logger.info(f"user {user}")` builds the string even when INFO is disabled; prefer `logger.info("user %s", user)`.
- Calling `logging.basicConfig` inside a library, or adding handlers repeatedly, produces duplicate lines.
- Never log secrets, tokens or full personal data.

## 10. Standard Library Highlights

### JSON and CSV
<!-- level: basic; ref: https://docs.python.org/3/library/json.html -->
`json` converts between JSON text and Python objects: objects become dicts, arrays become lists, and `null`/`true`/`false` become `None`/`True`/`False`. `dumps`/`loads` work with strings; `dump`/`load` with files.

`csv` reads and writes delimited files correctly, handling quoting, embedded commas and newlines that naive `split(",")` gets wrong. `DictReader` and `DictWriter` map rows to dicts by header.

```python
import json, csv
from datetime import datetime, date
from decimal import Decimal

order = {"id": "A1", "amount": Decimal("99.50"), "created": datetime(2026, 1, 5, 10, 30)}

def default(o):                      # teach json about extra types
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return str(o)
    raise TypeError(f"not serialisable: {type(o).__name__}")

text = json.dumps(order, default=default, indent=2, ensure_ascii=False)
data = json.loads(text)

with open("orders.csv", newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        print(row["id"], float(row["amount"]))   # every value is a str

with open("out.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=["id", "amount"])
    writer.writeheader()
    writer.writerows([{"id": "A1", "amount": 99.5}])
```

For JSON Lines (one object per line) iterate the file and `json.loads` each line, which streams large logs. Faster third-party libraries like `orjson` are worth it for heavy serialisation.

#### Pitfalls
- JSON object keys are always strings: `json.loads(json.dumps({1: "a"}))` gives `{"1": "a"}`.
- Floats lose precision for money; serialise decimals as strings.
- CSV values come back as strings; convert and validate types explicitly.

### Dates, times and time zones
<!-- level: intermediate; ref: https://docs.python.org/3/library/zoneinfo.html -->
The `datetime` module has `date`, `time`, `datetime` and `timedelta`. The crucial distinction is between naive datetimes (no time zone info) and aware datetimes (with `tzinfo`). Naive values are ambiguous: is "10:00" in UTC, IST or the server's local time? Mixing them raises `TypeError` on comparison.

Best practice: store and compute in UTC with aware datetimes, convert to local time only for display, and use IANA zone names through `zoneinfo` (3.9+). On Windows, install the `tzdata` package for the zone database.

```python
from datetime import datetime, timedelta, UTC     # datetime.UTC alias is 3.11+
from zoneinfo import ZoneInfo

now = datetime.now(UTC)                           # aware, UTC
ist = now.astimezone(ZoneInfo("Asia/Kolkata"))
ny = now.astimezone(ZoneInfo("America/New_York")) # handles DST rules

deadline = now + timedelta(days=3)
(deadline - now).total_seconds()                  # 259200.0

datetime.fromisoformat("2026-03-01T09:30:00+05:30")   # parses offsets (3.11+ accepts most ISO 8601)
ist.isoformat()
ist.strftime("%d %b %Y %H:%M")

datetime.utcnow()   # deprecated since 3.12: returns a NAIVE value - avoid
```

Arithmetic on aware datetimes in the same zone is wall-clock arithmetic: adding `timedelta(days=1)` to 09:00 local time just before a DST change gives 09:00 the next day, which may be 23 or 25 real hours later. Do calendar arithmetic in local time and elapsed-time arithmetic in UTC.

#### Pitfalls
- `datetime.now()` without a tz returns naive local time; servers in different regions then disagree.
- Avoid `pytz` in new code; its `localize` API is easy to misuse, and `zoneinfo` is standard.
- Use `time.monotonic()` or `time.perf_counter()` for measuring durations, never wall-clock time.

### Regular expressions
<!-- level: intermediate; ref: https://docs.python.org/3/howto/regex.html -->
The `re` module matches text against patterns. Core functions: `re.search` (first match anywhere), `re.match` (only at the start), `re.fullmatch` (entire string), `re.findall`/`re.finditer` (all matches), `re.sub` (replace) and `re.split`.

Always write patterns as raw strings (`r"\d+"`) so backslashes reach the regex engine untouched. Named groups (`(?P<name>...)`) make extraction self-documenting, and `re.VERBOSE` lets you comment complex patterns.

```python
import re

LOG_LINE = re.compile(r"""
    (?P<ts>\d{4}-\d{2}-\d{2}T[\d:]+)\s+
    (?P<level>INFO|WARN|ERROR)\s+
    order=(?P<order>[A-Z]\d+)
""", re.VERBOSE)

m = LOG_LINE.search("2026-01-05T10:30:00 ERROR order=A123 payment failed")
if m:
    m["level"], m.group("order")          # ('ERROR', 'A123')

re.findall(r"#(\w+)", "ship #fast #free")             # ['fast', 'free']
re.sub(r"\s+", " ", "too    many   spaces")           # normalise whitespace
re.sub(r"(\d{4})-(\d{2})-(\d{2})", r"\3/\2/\1", "2026-01-05")  # '05/01/2026'
re.split(r"[,;]\s*", "a, b;c")                        # ['a', 'b', 'c']
```

Quantifiers are greedy by default (`.*` grabs as much as possible); add `?` for lazy (`.*?`). Python caches recently used patterns, but compiling module-level constants keeps code clear.

#### Pitfalls
- Catastrophic backtracking: nested quantifiers like `(a+)+$` can take exponential time on malicious input (ReDoS). Keep patterns specific, and limit input length.
- Do not parse HTML, JSON or email addresses fully with regex; use proper parsers or validation libraries.
- `re.match` anchors only at the start, not the end; use `fullmatch` for validation.

### Processes, the OS and command-line tools
<!-- level: intermediate; ref: https://docs.python.org/3/library/subprocess.html -->
Python is widely used for automation, so a few modules are essential:

- `subprocess.run` runs external commands. Pass arguments as a list (no shell), use `check=True` to raise on non-zero exit, `capture_output=True` and `text=True` to get output as strings, and `timeout=` to avoid hangs.
- `os` and `os.environ` for environment variables and low-level operations; `shutil` for copying, moving, archiving and `which`.
- `argparse` builds command-line interfaces with help text, types and subcommands.
- `sys.argv`, `sys.exit(code)` and `sys.stdin`/`stdout` for script plumbing.

```python
import argparse, os, shutil, subprocess, sys

def main() -> int:
    parser = argparse.ArgumentParser(description="Back up a database")
    parser.add_argument("db_name")
    parser.add_argument("--dest", default="backups")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if shutil.which("pg_dump") is None:
        print("pg_dump not found", file=sys.stderr)
        return 2

    cmd = ["pg_dump", "--format=custom", args.db_name]
    if args.dry_run:
        print(" ".join(cmd))
        return 0
    result = subprocess.run(cmd, capture_output=True, check=True, timeout=600,
                            env={**os.environ, "PGCONNECT_TIMEOUT": "10"})
    os.makedirs(args.dest, exist_ok=True)
    with open(os.path.join(args.dest, f"{args.db_name}.dump"), "wb") as f:
        f.write(result.stdout)
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

#### Pitfalls
- `shell=True` with user input enables command injection. If you truly need a shell, quote with `shlex.quote`.
- `capture_output=True` buffers all output in memory; stream large outputs to a file handle via `stdout=`.

### Batteries worth knowing
<!-- level: intermediate; ref: https://docs.python.org/3/library/index.html -->
The standard library covers many needs without extra dependencies. Modules that regularly save time:

- `heapq`: a binary min-heap on a list for priority queues and top-k (`nlargest`, `nsmallest`).
- `bisect`: binary search and insertion into sorted lists.
- `statistics`: mean, median, stdev, quantiles, correlation.
- `secrets`: cryptographically secure tokens (never use `random` for security).
- `uuid`: unique ids; 3.14 added `uuid7()`, which is time-ordered and index-friendly.
- `sqlite3`: an embedded SQL database, great for tools, tests and local caches.
- `tomllib` (3.11+): read TOML config files.
- `hashlib`, `hmac`: hashing and message signing.
- `textwrap`, `difflib`, `pprint`: text utilities.
- `compression.zstd` (3.14): Zstandard compression in the standard library.

```python
import heapq, bisect, secrets, sqlite3, statistics, tomllib

top3 = heapq.nlargest(3, orders, key=lambda o: o["amt"])

grades = [60, 70, 80, 90]
bisect.bisect(grades, 85)                  # 3 -> insertion index

statistics.quantiles([12, 15, 20, 31, 45], n=4)

api_key = secrets.token_urlsafe(32)

with open("pyproject.toml", "rb") as f:   # tomllib needs binary mode
    project = tomllib.load(f)["project"]

con = sqlite3.connect("cache.db")
con.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)")
con.execute("INSERT OR REPLACE INTO kv VALUES (?, ?)", ("token", api_key))  # parameterised
con.commit()
```

#### Pitfalls
- `random` is predictable by design; use `secrets` for passwords, tokens and reset links.
- PEP 594 removed several legacy modules in 3.13 (`cgi`, `telnetlib`, `imghdr` and others); old scripts may need replacements.
