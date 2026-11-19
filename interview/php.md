# PHP interview questions

### What is the difference between == and === in PHP, and what changed in PHP 8?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/language.operators.comparison.php -->
`===` compares type and value with no conversion. `==` applies type juggling first. Before PHP 8, `0 == "abc"` was true because the string was cast to `0`. From PHP 8.0, a number compared with a non-numeric string is compared as strings, so `0 == "abc"` is false. Numeric strings such as `"1e3" == "1000"` still compare equal numerically.

```php
var_dump(0 == "abc");    // false in PHP 8, true in PHP 7
var_dump("1" == "01");   // true (both numeric)
var_dump(null == false); // true
var_dump(null === false);// false
```

Use `===` by default, especially for `in_array`, `array_search` and `strpos` results (`strpos` can return `0`, which is falsy). Use `hash_equals` for secrets, never `==`, to avoid both juggling bugs and timing leaks.

### How do PHP arrays work internally and what are the practical consequences?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/language.types.array.php -->
A PHP array is an ordered hash map. Keys are integers or strings; numeric-looking string keys such as `"5"` are normalised to ints, and floats or bools are truncated into ints. Insertion order is preserved. Since PHP 7 "packed" arrays (sequential int keys from 0) use a compact representation, which is why lists are cheaper than maps.

Arrays are value types with copy-on-write: assigning copies lazily, only when one side is modified. Passing a large array to a function is therefore cheap unless the function writes to it.

Consequences: `array_key_exists` and `isset` are O(1); `in_array` is O(n), so for repeated membership tests flip into keys with `array_flip` or `array_fill_keys`. Appending with `$a[] = $x` is amortised O(1), while `array_shift` re-indexes and is O(n). Be careful with references (`foreach ($a as &$v)`) because the reference survives the loop; `unset($v)` afterwards.

### Explain how PHP's request lifecycle works under PHP-FPM versus long-running runtimes.
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/install.fpm.php -->
Under PHP-FPM each request is handled by a worker process from a pool. The worker runs the script, builds variables, and at request end all userland state (globals, objects, open non-persistent resources) is discarded. That "shared-nothing" model makes leaks and cross-request contamination rare, but you pay bootstrap cost each time, mitigated by OPcache, which keeps compiled opcodes in shared memory.

Long-running runtimes (Swoole, RoadRunner, FrankenPHP worker mode, ReactPHP) boot the application once and reuse it. This gives much lower latency, but static properties, singletons, and container services now persist between requests. Typical bugs: user data leaking via a static cache, database connections going stale, memory growth.

Interview tip: mention `pm.max_children` sizing (memory per worker divided into available RAM) and `pm.max_requests` as a safety valve against slow leaks.

### What are PHP's visibility modifiers and what do readonly properties and promotion add?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/language.oop5.visibility.php -->
`public` is accessible anywhere, `protected` in the class and subclasses, `private` only inside the declaring class. Constructor property promotion (PHP 8.0) declares and assigns properties from constructor parameters. `readonly` properties (PHP 8.1) can be initialised once, from inside the class scope, and never modified after; PHP 8.2 added `readonly class`.

```php
final class Money {
    public function __construct(
        public readonly int $amount,
        public readonly string $currency,
    ) {}
    public function add(Money $o): static {
        return new static($this->amount + $o->amount, $this->currency);
    }
}
```

This gives cheap immutable value objects. Note that readonly is shallow: a readonly property holding an object still lets you mutate that object's own state. Cloning a readonly object and changing its properties was not possible until PHP 8.3 relaxed re-initialisation inside `__clone`.

### What is the difference between abstract classes, interfaces and traits?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/language.oop5.traits.php -->
An interface is a contract of method signatures (and constants) with no state; a class can implement many. An abstract class can hold state and partial implementation but a class extends only one. A trait is a compile-time copy-paste mechanism for horizontal code reuse; it is not a type, so you cannot type-hint a trait.

Choose an interface when callers depend on behaviour, an abstract class when subclasses share a template and state, and a trait for utility code that is genuinely orthogonal (for example a logging helper). Traits can contain abstract methods, static members and properties, and conflicts are resolved with `insteadof` and `as`.

Pitfalls: traits hide dependencies and make testing harder; two traits defining the same property incompatibly fatal. Interview tip: since PHP 8.2 traits can declare constants, and enums can implement interfaces and use traits (but not hold state).

### How does PHP's type system work, including union types, nullable types and strict_types?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/language.types.declarations.php -->
Parameters, returns and properties can be typed. Union types (`int|string`, PHP 8.0), intersection types (`A&B`, 8.1), `never` (8.1), `null`/`false`/`true` standalone types (8.2), and DNF types such as `(A&B)|null` (8.2) are supported. `?T` is shorthand for `T|null`.

By default PHP coerces scalars in weak mode: passing `"5"` to an `int` parameter works. With `declare(strict_types=1);` at the top of a file, calls made from that file require exact scalar types (int to float widening is still allowed). Note that strictness is determined by the caller's file, not the callee's, and it doesn't affect return type checks of the declaring file in the same way: a function's return is checked per the file where the function is defined.

```php
declare(strict_types=1);
function half(int $n): float { return $n / 2; }
half("4"); // TypeError
```

Interview tip: types are enforced at runtime, not compile time, so use PHPStan or Psalm for static guarantees.

### Explain Composer autoloading and PSR-4.
<!-- level: basic; kind: concept; ref: https://getcomposer.org/doc/04-schema.md#psr-4 -->
Composer generates `vendor/autoload.php`, which registers an `spl_autoload_register` callback. When a class is first used, the loader maps its fully qualified name to a file. PSR-4 maps a namespace prefix to a directory: with `"App\\": "src/"`, class `App\Http\UserController` loads `src/Http/UserController.php`. Each class lives in its own file whose name equals the class name.

```json
{ "autoload": { "psr-4": { "App\\": "src/" } } }
```

After editing `autoload` you must run `composer dump-autoload`. In production use `composer install --no-dev --optimize-autoloader` (or `-o`/`--classmap-authoritative`) so classes are resolved from a prebuilt map instead of probing the filesystem.

Pitfalls: case-sensitivity bugs that work on Windows or macOS but fail on Linux; commit `composer.lock` for applications but not for libraries; do not run `composer update` in deployment.

### How does exception handling work in PHP, and what is the Throwable hierarchy?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/language.exceptions.php -->
Since PHP 7 both `Exception` and `Error` implement `Throwable`. `Error` subclasses (`TypeError`, `ValueError`, `ArithmeticError`, `DivisionByZeroError`) signal engine-level problems and are catchable. Warnings and notices are not exceptions; many extensions still raise them, so applications commonly install `set_error_handler` that converts them into `ErrorException`.

```php
try {
    $pdo->beginTransaction();
    // ...
    $pdo->commit();
} catch (PDOException $e) {
    $pdo->rollBack();
    throw new RuntimeException('Order failed', 0, $e); // keep previous
} finally {
    $logger->info('order attempt finished');
}
```

Always chain the previous exception, catch specific types, and avoid swallowing with an empty catch. Multi-catch (`catch (A|B $e)`) exists since 7.1, and catching without a variable (`catch (A)`) since 8.0. `finally` runs even on `return`, and a `return` inside `finally` overrides the pending one.

### What are PHP 8 enums and when would you use them instead of class constants?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/language.enumerations.php -->
Enums (PHP 8.1) are a first-class type with a fixed set of cases. A pure enum has only cases; a backed enum associates each case with an `int` or `string` scalar and offers `from()` (throws `ValueError`) and `tryFrom()` (returns null). Enums can have methods, constants and implement interfaces, but cannot have instance properties.

```php
enum Status: string {
    case Draft = 'draft';
    case Paid  = 'paid';
    public function isFinal(): bool { return $this === self::Paid; }
}
$s = Status::tryFrom($input) ?? Status::Draft;
```

Compared with constants they give you type safety (`function f(Status $s)`), exhaustive `match`, and a single place to hang behaviour. Cases are singletons, so `===` works. Pitfall: enums cannot be instantiated with `new`, and serialising to JSON works only for backed enums.

### How do you prevent SQL injection in PHP, and what do prepared statements not protect?
<!-- level: basic; kind: concept; ref: https://www.php.net/manual/en/pdo.prepared-statements.php -->
Use prepared statements with bound parameters so data and SQL travel separately. With PDO, set `PDO::ATTR_EMULATE_PREPARES => false` and `ERRMODE_EXCEPTION`.

```php
$st = $pdo->prepare('SELECT * FROM users WHERE email = :e AND status = :s');
$st->execute([':e' => $email, ':s' => $status]);
```

Prepared statements only parameterise values. Table names, column names, `ORDER BY` direction and `LIMIT` in some drivers cannot be bound, so allowlist them (`in_array($col, ['name','created_at'], true)`). Building `IN (...)` needs generated placeholders. Escaping functions are a fallback, not a design.

Pitfalls: concatenating `$_GET` into `LIKE` clauses, trusting a numeric cast only partially, and assuming an ORM is automatically safe when raw fragments are used. Also apply least privilege on the database account.

### How should passwords be stored in PHP?
<!-- level: basic; kind: concept; ref: https://www.php.net/manual/en/function.password-hash.php -->
Never use `md5`, `sha1`, or a plain fast hash. Use `password_hash($plain, PASSWORD_DEFAULT)` (bcrypt currently; `PASSWORD_ARGON2ID` is available when compiled in) and verify with `password_verify`. The result embeds algorithm, cost and a per-password random salt in a single string, so you store just that value, in a column of at least 255 characters.

```php
$hash = password_hash($pw, PASSWORD_ARGON2ID);
if (password_verify($pw, $row['hash'])) {
    if (password_needs_rehash($row['hash'], PASSWORD_ARGON2ID)) {
        // store a fresh hash
    }
}
```

`password_needs_rehash` lets you upgrade costs transparently at next login. Bcrypt truncates input at 72 bytes, so pre-hashing very long passphrases needs care. Do not write your own salt or pepper scheme without understanding it; if you add a pepper, apply it via HMAC and manage it as a secret outside the database.

### What is the difference between sessions and cookies, and how do you secure PHP sessions?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/session.security.php -->
A cookie is client-stored data sent with each request. A PHP session stores data server-side (files by default, or Redis/database via a handler) and sends only an opaque ID in the `PHPSESSID` cookie.

Hardening: set cookie flags `Secure`, `HttpOnly`, and `SameSite=Lax` or `Strict`; enable `session.use_strict_mode=1` so unknown IDs are rejected; call `session_regenerate_id(true)` on login and privilege change to prevent fixation; keep `session.use_only_cookies=1`; set sensible lifetimes and destroy on logout.

```php
session_set_cookie_params([
    'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
]);
session_start();
```

Pitfalls: the default file handler locks the session file for the whole request, serialising parallel requests from one user. Call `session_write_close()` as soon as you finish writing. Store only identifiers, not large objects, and protect forms with CSRF tokens.

### What are references in PHP and how do they differ from objects handles?
<!-- level: advanced; kind: concept; ref: https://www.php.net/manual/en/language.references.php -->
A PHP reference (`&`) makes two variable names alias the same value slot. An object variable holds an object handle, which behaves like a pointer copied by value: two variables can refer to one object, but reassigning one variable does not affect the other. A reference to the variable is different: reassigning through it changes both.

```php
function reset(array &$a) { $a = []; }       // modifies caller
function swap(object $o) { $o = new stdClass; } // caller unaffected
```

Practical advice: you rarely need by-reference parameters for performance because of copy-on-write; for objects you never need them to mutate state. Use them for genuine output parameters such as `preg_match`'s `$matches`.

Pitfalls: `foreach ($arr as &$v)` leaves `$v` as a reference to the last element, so a later `foreach ($arr as $v)` overwrites it; `unset($v)` after the loop. References stored inside arrays survive array copies and cause surprising shared state.

### How do closures, arrow functions and `static` closures behave?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/functions.arrow.php -->
A closure (`function () use ($x) {}`) captures variables listed in `use` by value (or by reference with `&`). It is an instance of `Closure` and automatically binds `$this` when created inside a class method. Arrow functions (`fn($n) => $n * $factor`, PHP 7.4) capture by value automatically from the enclosing scope, support only a single expression, and cannot modify outer variables.

```php
$factor = 3;
$out = array_map(fn(int $n) => $n * $factor, [1, 2, 3]);
```

Declare a closure `static` when it does not need `$this`; this avoids retaining the object and the cycles that can delay garbage collection. `Closure::bind` and `bindTo` rebind `$this` and scope, which frameworks use for DSLs. The first-class callable syntax `strlen(...)` (PHP 8.1) creates a closure from a named function or method.

Pitfall: arrow functions capture by value at creation, so later changes to the outer variable aren't seen.

### How does PHP garbage collection and memory management work?
<!-- level: advanced; kind: concept; ref: https://www.php.net/manual/en/features.gc.php -->
PHP uses reference counting: when a value's refcount drops to zero it is freed immediately. That cannot free cycles (object A references B and B references A), so a cycle collector runs when the root buffer reaches a threshold (10,000 possible roots by default) and scans for unreachable cycles. `gc_collect_cycles()` forces a run.

For web requests this rarely matters because everything is freed at request end. In CLI workers, queue consumers and imports, memory growth matters: unbounded arrays, static caches, query loggers, ORM identity maps, and closures retaining `$this` are common causes.

```php
foreach ($pdo->query($sql) as $row) { /* streaming */ }
// use unbuffered queries or generators for huge sets
echo memory_get_peak_usage(true);
```

Fixes: process in chunks, use generators, clear ORM unit-of-work between batches, and restart workers periodically. `memory_limit` is per-process, and raising it hides rather than fixes leaks.

### What are generators and when are they better than arrays?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/language.generators.overview.php -->
A function containing `yield` returns a `Generator`, an iterator that produces values lazily and keeps its local state between yields. It uses memory proportional to one item rather than the whole collection.

```php
function lines(string $file): Generator {
    $h = fopen($file, 'r');
    try {
        while (($l = fgets($h)) !== false) yield rtrim($l);
    } finally { fclose($h); }
}
foreach (lines('big.log') as $line) { /* ... */ }
```

Generators support keys (`yield $k => $v`), receiving values (`$x = yield`), delegation (`yield from`), and return values via `getReturn()`. They are forward-only: you cannot rewind after starting, and iterating twice throws.

Pitfalls: they hide laziness, so exceptions or database cursor lifetimes occur at iteration time; `iterator_to_array` defeats the memory benefit, and with `yield from` key collisions can silently overwrite entries unless you pass `false` as `preserve_keys`.

### What is dependency injection and how is it done in modern PHP?
<!-- level: intermediate; kind: concept; ref: https://www.php-fig.org/psr/psr-11/ -->
Dependency injection means a class receives collaborators from outside instead of creating them, typically via the constructor. This makes dependencies explicit, enables substitution in tests, and keeps classes small.

```php
final class Checkout {
    public function __construct(
        private PaymentGateway $gateway,
        private LoggerInterface $log,
    ) {}
}
```

A DI container (PHP-DI, Symfony DependencyInjection, Laravel's container) resolves constructor types via reflection ("autowiring") and manages lifetimes. PSR-11 defines a minimal `ContainerInterface` with `get` and `has`.

Pitfalls: injecting the container itself (service locator) hides dependencies; constructors with six or more parameters signal a class doing too much; singleton services with mutable state become dangerous in long-running runtimes. Depend on interfaces you own (for example PSR-3 `LoggerInterface`) rather than concrete vendor classes.

### What do PSR standards cover, and which ones should every PHP developer know?
<!-- level: basic; kind: concept; ref: https://www.php-fig.org/psr/ -->
PSRs are PHP-FIG recommendations that let libraries interoperate. The essential ones: PSR-1 and PSR-12 (coding style; PER Coding Style is the evolving successor), PSR-3 (logger interface), PSR-4 (autoloading), PSR-6 and PSR-16 (caching: pool-based and simple), PSR-7 (immutable HTTP message objects), PSR-11 (container), PSR-14 (event dispatcher), PSR-15 (HTTP middleware and request handlers), PSR-17 (HTTP factories), and PSR-18 (HTTP client).

Value: you can swap Guzzle for Symfony HttpClient behind PSR-18, or Monolog for another PSR-3 logger, without rewriting callers. PSR-7 messages are immutable, so `$request = $request->withAttribute('user', $u)` returns a new instance; forgetting to reassign is a classic bug.

Interview tip: explain that PSRs define interfaces, not implementations, and that middleware (PSR-15) wraps the handler in an onion model where each layer can short-circuit.

### How do you handle file uploads securely in PHP?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/features.file-upload.php -->
Uploads arrive in `$_FILES`. Check `error === UPLOAD_ERR_OK`, then `is_uploaded_file`, and move with `move_uploaded_file`. Never trust `name` or the client-supplied `type`.

```php
$f = $_FILES['doc'];
if ($f['error'] !== UPLOAD_ERR_OK || $f['size'] > 2_000_000) { /* reject */ }
$mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
if (!in_array($mime, ['application/pdf', 'image/png'], true)) { /* reject */ }
$dest = $dir . bin2hex(random_bytes(16)) . '.pdf';
move_uploaded_file($f['tmp_name'], $dest);
```

Defences: generate your own filename, allowlist by detected content type, store outside the web root (or on object storage) and serve through a controller, disable script execution in the upload directory, re-encode images to strip payloads, and enforce limits in `upload_max_filesize`, `post_max_size` and the web server.

Pitfalls: trusting extensions (`shell.php.jpg`), path traversal through the original name, and `post_max_size` being exceeded, which silently empties `$_POST` and `$_FILES`.

### What is OPcache and how do you configure it for production?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/opcache.configuration.php -->
OPcache stores compiled script opcodes in shared memory so PHP doesn't re-read and re-parse files every request. It is the single largest free performance gain for PHP-FPM.

Common production settings: `opcache.enable=1`, `opcache.memory_consumption` sized to hold your codebase (check `opcache_get_status()` for free memory and misses), `opcache.max_accelerated_files` above your file count, and `opcache.validate_timestamps=0` so files are never stat-checked, with a reload of PHP-FPM on each deploy. Since PHP 7.4 you can add preloading (`opcache.preload`) to load framework classes at startup, and PHP 8.0 added a tracing JIT (`opcache.jit`), which helps CPU-bound code more than typical I/O-bound web apps.

Pitfalls: with validation off, a deployment without reload serves stale code; with symlink-based releases set `opcache.revalidate_path` or reload to avoid mixed versions. CLI has OPcache disabled by default.

### What is the difference between include, require, include_once and require_once?
<!-- level: basic; kind: concept; ref: https://www.php.net/manual/en/function.require.php -->
All four evaluate another file in the current scope. `require` raises a fatal `Error` if the file cannot be loaded, while `include` only emits a warning and continues. The `_once` variants skip the file if it was already included (resolved by real path). `include` and `require` return the file's `return` value, which is a common pattern for config files.

```php
$config = require __DIR__ . '/config.php'; // returns an array
```

In modern code Composer's autoloader replaces most of these; you typically `require` only `vendor/autoload.php` and config. Always build paths from `__DIR__` rather than relative paths, which resolve against the current working directory or `include_path`.

Pitfalls: including a path derived from user input is a local or remote file inclusion vulnerability; `_once` carries a lookup cost and can mask structure problems; and included files share variable scope, so they can overwrite local variables.

### How do magic methods like __get, __call and __toString work, and what are the downsides?
<!-- level: intermediate; kind: concept; ref: https://www.php.net/manual/en/language.oop5.magic.php -->
Magic methods are hooks invoked by the engine. `__get`/`__set` fire for inaccessible or missing properties; `__call`/`__callStatic` for missing methods; `__toString` when an object is cast to string (and since PHP 8.0 such classes automatically implement `Stringable`); `__invoke` makes an object callable; `__clone`, `__serialize`/`__unserialize`, and `__destruct` handle lifecycle.

```php
final class Bag {
    private array $d = [];
    public function __get(string $k): mixed { return $this->d[$k] ?? null; }
    public function __set(string $k, mixed $v): void { $this->d[$k] = $v; }
}
```

Downsides: they defeat IDE autocompletion and static analysis unless documented with `@property`/`@method`, they are slower than real members, and typos silently return null. They are best reserved for proxies, fluent builders and ORM-style models. Prefer explicit methods and typed properties. Never rely on `__destruct` for critical work, since it may not run on fatal errors.

### What is the difference between abstract static and late static binding?
<!-- level: advanced; kind: concept; ref: https://www.php.net/manual/en/language.oop5.late-static-bindings.php -->
`self::` resolves to the class where the code was written. `static::` uses late static binding: it resolves to the class actually called at runtime. This matters for factories and fluent static APIs in inheritance chains.

```php
class Model {
    public static function create(): static { return new static(); }
    public static function table(): string { return static::TABLE; }
}
class User extends Model { const TABLE = 'users'; }
User::create(); // instance of User, not Model
```

With `new self()` the above would always return `Model`. The `static` return type (PHP 8.0) documents this accurately.

Pitfalls: forwarding calls such as `parent::` and `self::` keep the original late-static class, while explicit `ClassName::method()` resets it. Overusing static state hurts testability; an instance-based factory plus dependency injection is usually cleaner. Interview tip: mention that `static` is also a keyword for static variables and static closures, which are unrelated concepts.

### How would you explain PHP's match expression versus switch?
<!-- level: basic; kind: concept; ref: https://www.php.net/manual/en/control-structures.match.php -->
`match` (PHP 8.0) is an expression that returns a value, uses strict (`===`) comparison, needs no `break`, and throws `UnhandledMatchError` when no arm matches and there is no `default`. `switch` uses loose `==`, falls through between cases, and is a statement.

```php
$label = match (true) {
    $score >= 90 => 'A',
    $score >= 75 => 'B',
    default      => 'C',
};
```

Multiple conditions share an arm with commas (`1, 2 => 'low'`). Arms are evaluated top to bottom and only the matching arm's expression runs. Combined with enums, a `match` without `default` makes missing cases a loud runtime error that static analysers can also flag.

Pitfalls: `match ($x)` with `$x = "1"` will not match `1` because comparison is strict; arms accept only single expressions, so use a closure or `throw` expression (also PHP 8.0) for complex branches. Switch can still be right when fall-through is deliberate.

### How do you profile and optimise a slow PHP application?
<!-- level: advanced; kind: concept; ref: https://www.php.net/manual/en/book.opcache.php -->
Start by measuring, not guessing. Identify whether time is spent in PHP code, the database, or external calls. Tools: Xdebug profiler or Blackfire/Tideways/SPX for function-level cost, slow query logs and `EXPLAIN` for SQL, and APM traces for external I/O.

Typical wins in order: fix N+1 queries (eager load), add missing indexes, cache expensive pure results (APCu locally, Redis shared), enable OPcache with correct sizing, move slow work to queues, reduce autoloaded classes with an optimised classmap, and paginate or stream large result sets. CPU-bound micro-optimisations (swapping `foreach` for `array_map`) almost never matter.

```php
$t = hrtime(true);
// ... code under test
printf("%.2f ms\n", (hrtime(true) - $t) / 1e6);
```

Pitfalls: profiling with Xdebug on skews timings heavily; benchmarking with a warm database cache gives false confidence; and caching without an invalidation plan trades latency for stale-data bugs.
