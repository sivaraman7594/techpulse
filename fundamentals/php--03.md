## 6. Modern PHP Language Features

### Enumerations
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.enumerations.php -->
Enums (PHP 8.1) define a closed set of named values as a real type. Before enums, PHP code used class constants or strings, which allowed invalid values anywhere.

- Pure enums have cases with no scalar value.
- Backed enums map each case to a unique `int` or `string`, ideal for storing in databases or JSON. `from()` converts a value to a case (throwing `ValueError` if invalid); `tryFrom()` returns null instead.

Enums are objects (singletons per case), so you compare them with `===`. They can have methods, constants, static methods, and implement interfaces, but not state. `cases()` lists all cases.

```php
<?php
enum OrderStatus: string
{
    case Pending   = 'pending';
    case Paid      = 'paid';
    case Shipped   = 'shipped';
    case Cancelled = 'cancelled';

    public function canTransitionTo(self $next): bool
    {
        return match ($this) {
            self::Pending => in_array($next, [self::Paid, self::Cancelled], true),
            self::Paid    => $next === self::Shipped,
            self::Shipped, self::Cancelled => false,
        };
    }

    public function label(): string
    {
        return ucfirst($this->value);
    }
}

$status = OrderStatus::from($row['status']);            // from DB
$maybe  = OrderStatus::tryFrom($_GET['status'] ?? '');  // null if invalid
if ($status->canTransitionTo(OrderStatus::Shipped)) { /* ... */ }
echo json_encode(['status' => OrderStatus::Paid]);       // {"status":"paid"}
```

- Pitfall: enums cannot be used as array keys directly; use `->value` or `SplObjectStorage`/`WeakMap`.
- Tip: Laravel and Doctrine can cast database columns to backed enums automatically.

### The match expression
<!-- level: basic; ref: https://www.php.net/manual/en/control-structures.match.php -->
`match` (PHP 8.0) is an expression that compares a subject against arms and returns the result of the first matching arm. Compared with `switch`, it:

- uses strict comparison (`===`),
- returns a value, so it can be assigned or returned,
- has no fall-through and needs no `break`,
- allows multiple conditions per arm, separated by commas,
- throws `UnhandledMatchError` if nothing matches and there is no `default`, so missed cases are loud.

`match (true)` is a common idiom for range checks.

```php
<?php
$httpMessage = match ($statusCode) {
    200, 201, 204 => 'Success',
    301, 302      => 'Redirect',
    404           => 'Not found',
    500           => 'Server error',
    default       => 'Unknown',
};

$shippingCost = match (true) {
    $weightKg <= 1  => 4.99,
    $weightKg <= 5  => 9.99,
    $weightKg <= 20 => 19.99,
    default         => throw new DomainException('Too heavy to ship'),
};

$handler = match ($event::class) {
    UserRegistered::class => new SendWelcomeEmail(),
    OrderPlaced::class    => new ReserveStock(),
};
```

Each arm is a single expression. For multiple statements, call a function or method from the arm.

- Pitfall: `match ('1') { 1 => ... }` does not match because of strict comparison; cast input first.
- Interview tip: mention `UnhandledMatchError` as a feature, not a nuisance, especially with enums.

### Attributes
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.attributes.php -->
Attributes (PHP 8.0) add structured, machine-readable metadata to classes, methods, functions, properties, parameters and constants. They replace docblock annotations (which were parsed from comments by libraries) with native syntax that the engine validates.

An attribute is a class marked with `#[Attribute]`. You read attributes through the Reflection API; the attribute object is instantiated only when you call `newInstance()`. Frameworks use them for routing, validation, ORM mapping, dependency injection and event listeners.

The engine also ships built-in attributes: `#[\Override]` (8.3), `#[\SensitiveParameter]` (8.2, hides values in stack traces), `#[\Deprecated]` (8.4), `#[\AllowDynamicProperties]` (8.2), `#[\ReturnTypeWillChange]`, and `#[\NoDiscard]` (8.5).

```php
<?php
#[Attribute(Attribute::TARGET_METHOD)]
final class Route
{
    public function __construct(public string $path, public string $method = 'GET') {}
}

final class OrderController
{
    #[Route('/orders/{id}')]
    public function show(int $id): Response { /* ... */ }

    #[Route('/orders', method: 'POST')]
    public function store(Request $r): Response { /* ... */ }
}

foreach ((new ReflectionClass(OrderController::class))->getMethods() as $m) {
    foreach ($m->getAttributes(Route::class) as $attr) {
        $route = $attr->newInstance();
        $router->add($route->method, $route->path, [OrderController::class, $m->getName()]);
    }
}

function login(string $user, #[\SensitiveParameter] string $password) { /* ... */ }
```

- Tip: Symfony routes (`#[Route]`) and Doctrine mapping (`#[ORM\Column]`) are the most common real uses.
- Pitfall: reflection is relatively slow; frameworks cache the discovered metadata.

### Fibers
<!-- level: advanced; ref: https://www.php.net/manual/en/language.fibers.php -->
Fibers (PHP 8.1) are lightweight, cooperatively scheduled execution contexts with their own call stack. A fiber can pause itself anywhere in its call stack with `Fiber::suspend()` and be resumed later, without every function in between having to be written as async (unlike generators, where only the generator function itself can yield).

Fibers are low-level: application code rarely uses them directly. They are the foundation that async libraries (AMPHP v3, ReactPHP's async package, Revolt event loop) use to let you write non-blocking I/O code that looks synchronous.

```php
<?php
$fiber = new Fiber(function (string $url): string {
    echo "start $url\n";
    $response = Fiber::suspend('waiting-for-io');   // pause and hand control back
    echo "resumed with $response\n";
    return strtoupper($response);
});

$signal = $fiber->start('https://api.example.com');  // runs until suspend
echo "scheduler got: $signal\n";
$fiber->resume('ok');                                 // continue the fiber
echo $fiber->getReturn();                             // OK

// With AMPHP v3 (library), concurrency reads like normal code:
// $responses = Amp\Future\await([
//     Amp\async(fn() => $http->request(new Request($urlA))),
//     Amp\async(fn() => $http->request(new Request($urlB))),
// ]);
```

Fibers do not give parallelism: only one fiber runs at a time in a process. The benefit is overlapping waits on I/O.

- Pitfall: blocking functions (classic PDO, `file_get_contents` on URLs, `sleep`) block the entire event loop; use async-aware clients.
- Interview tip: compare fibers (stackful coroutines) with generators (stackless) and with threads.

### What changed in PHP 8.x
<!-- level: intermediate; ref: https://www.php.net/releases/8.5/en.php -->
PHP 8 transformed the language. Knowing which version introduced what helps when reading code and planning upgrades.

- 8.0 (2020): JIT, named arguments, union types, `match`, nullsafe `?->`, constructor promotion, attributes, `throw` expression, saner string-to-number comparisons, `str_contains`.
- 8.1 (2021): enums, readonly properties, fibers, first-class callable syntax, intersection types, `never`, `new` in initialisers, `array_is_list`.
- 8.2 (2022): readonly classes, DNF types, `true`/`null`/`false` standalone types, constants in traits, the `Random` extension, deprecation of dynamic properties.
- 8.3 (2023): typed class constants, `#[\Override]`, dynamic class constant fetch, `json_validate()`, deep-cloning readonly properties.
- 8.4 (2024): property hooks, asymmetric visibility, `new` without parentheses, `array_find`/`array_any`/`array_all`, `#[\Deprecated]`, new DOM HTML5 API, lazy objects.
- 8.5 (2025): pipe operator `|>`, `clone` with property overrides, `#[\NoDiscard]`, built-in URI extension, `array_first()`/`array_last()`.

```php
<?php
// PHP 8.5 pipe operator: pass the left value as the single argument to the right callable
$slug = $title
    |> trim(...)
    |> strtolower(...)
    |> (fn($s) => preg_replace('/[^a-z0-9]+/', '-', $s))
    |> (fn($s) => trim($s, '-'));
```

Under the release policy updated in 2024, each version gets two years of active support followed by two years of security-only fixes, so plan regular upgrades.

- Tip: Rector automates many upgrade refactorings, and PHPCompatibility (PHP_CodeSniffer) flags incompatible code.
- Pitfall: check your extensions and framework version support before upgrading production.

## 7. Namespaces, Autoloading and Composer

### Namespaces and imports
<!-- level: basic; ref: https://www.php.net/manual/en/language.namespaces.php -->
Namespaces group related classes, functions and constants and prevent name collisions between your code and libraries. A file declares its namespace at the top; `use` statements import names so you can refer to them by short name. Fully qualified names start with a backslash.

Name resolution rules: class names are resolved relative to the current namespace unless imported or fully qualified. For functions and constants, PHP falls back to the global namespace if the namespaced one does not exist, which is why `strlen()` works inside a namespace.

```php
<?php
declare(strict_types=1);

namespace App\Billing;

use App\Customers\Customer;
use App\Billing\Gateways\{StripeGateway, PaypalGateway};   // group use
use Psr\Log\LoggerInterface as Logger;                       // alias
use function App\Support\money_format;
use const App\Support\DEFAULT_CURRENCY;

final class InvoiceService
{
    public function __construct(private Logger $logger) {}

    public function issue(Customer $customer): Invoice
    {
        $created = new \DateTimeImmutable();       // global class: leading backslash
        // ...
    }
}

echo InvoiceService::class;   // "App\Billing\InvoiceService"
```

`::class` gives the fully qualified class name as a string at compile time, useful for container bindings and logs.

- Pitfall: forgetting a `use` statement makes PHP look for `App\Billing\DateTimeImmutable`, which fails with "class not found".
- Tip: one class per file, with namespace mirroring the directory structure (PSR-4).

### Autoloading and PSR-4
<!-- level: basic; ref: https://www.php-fig.org/psr/psr-4/ -->
Autoloading loads class files on demand: when code references a class that is not yet defined, PHP calls registered autoloader functions (`spl_autoload_register`) which `require` the right file. This eliminates manual `require` lists and loads only what each request needs.

PSR-4 is the standard convention mapping namespaces to directories: a namespace prefix maps to a base directory, and the rest of the class name maps to subdirectories and a `.php` file. Composer generates a PSR-4 autoloader from `composer.json`.

```json
{
    "autoload": {
        "psr-4": {
            "App\\": "src/"
        }
    },
    "autoload-dev": {
        "psr-4": {
            "Tests\\": "tests/"
        }
    }
}
```

```php
<?php
// public/index.php
require __DIR__ . '/../vendor/autoload.php';

use App\Billing\InvoiceService;     // loads src/Billing/InvoiceService.php
$service = new InvoiceService($logger);
```

```bash
composer dump-autoload --optimize --classmap-authoritative   # production
```

In production, an optimised classmap avoids filesystem checks: Composer pre-computes a map from every class to its file.

- Pitfall: PSR-4 paths are case-sensitive on Linux; `src/billing/Invoice.php` will not autoload `App\Billing\Invoice` on a Linux server even if it works on macOS or Windows.
- Pitfall: after adding classes with an authoritative classmap you must re-dump the autoloader.

### Composer and dependency management
<!-- level: basic; ref: https://getcomposer.org/doc/01-basic-usage.md -->
Composer is PHP's dependency manager. `composer.json` declares dependencies with version constraints; `composer.lock` records the exact versions resolved, so every environment installs identical code. Packages come from Packagist by default and are installed into `vendor/`.

Version constraints follow semantic versioning: `^2.3` means >=2.3.0 and <3.0.0 (the usual choice); `~2.3` means >=2.3 and <3.0; `2.3.*` is a wildcard.

Commit `composer.lock` for applications; libraries typically do not rely on it.

```bash
composer require guzzlehttp/guzzle:^7.9        # add a dependency
composer require --dev phpunit/phpunit pestphp/pest
composer install --no-dev --optimize-autoloader  # production deploy, uses lock file
composer update monolog/monolog                  # update one package within constraints
composer outdated                                # see newer versions
composer audit                                   # check installed packages for known vulnerabilities
composer why-not php 8.5                         # what blocks a PHP upgrade
```

```json
{
    "require": {
        "php": "^8.3",
        "ext-pdo": "*",
        "monolog/monolog": "^3.7"
    },
    "config": { "sort-packages": true }
}
```

Scripts in `composer.json` can define project commands (`composer test`).

- Pitfall: running `composer update` in production can pull untested versions; deploy with `composer install` from the lock file.
- Pitfall: `vendor/` should not be committed; build it in CI.
- Tip: `"platform": {"php": "8.3.0"}` in config makes dependency resolution match production even on a newer local PHP.

### PHP-FIG standards (PSRs)
<!-- level: intermediate; ref: https://www.php-fig.org/psr/ -->
The PHP Framework Interop Group publishes PHP Standards Recommendations (PSRs) so libraries from different ecosystems can work together. The most important ones:

- PSR-1 / PSR-12 and its successor, the PER Coding Style: code formatting conventions. Enforce them with PHP-CS-Fixer or PHP_CodeSniffer.
- PSR-3: `LoggerInterface` (Monolog implements it).
- PSR-4: autoloading.
- PSR-6 / PSR-16: caching interfaces.
- PSR-7: immutable HTTP message objects (request, response, URI, streams).
- PSR-11: container interface (`get`, `has`).
- PSR-14: event dispatcher.
- PSR-15: HTTP server middleware and request handlers.
- PSR-17 / PSR-18: HTTP factories and HTTP client.
- PSR-20: clock interface (testable time).

```php
<?php
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

final class RequireJson implements MiddlewareInterface
{
    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if (!str_contains($request->getHeaderLine('Content-Type'), 'application/json')) {
            return new Response(415);   // any PSR-7 implementation
        }
        return $handler->handle($request);
    }
}
```

Depending on PSR interfaces instead of concrete libraries keeps your code portable between frameworks.

- Pitfall: PSR-7 messages are immutable: `withHeader()` returns a new object; forgetting to use the return value is a common bug.
- Tip: code style debates end when a fixer runs in CI.

## 8. Errors and Exceptions

### Errors, exceptions and the Throwable hierarchy
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.errors.php7.php -->
PHP has two kinds of problems. Legacy "errors" (warnings, notices, deprecations) are reported through the error handler and normally do not stop execution. Since PHP 7, most fatal engine errors are thrown as `Error` objects.

Everything throwable implements `Throwable`, which has two branches:

- `Exception`: problems application code is expected to handle (`RuntimeException`, `InvalidArgumentException`, `PDOException`, `JsonException`).
- `Error`: engine-level problems usually indicating bugs (`TypeError`, `ValueError`, `ArgumentCountError`, `DivisionByZeroError`, `UnhandledMatchError`).

PHP 8 converted many warnings into exceptions (for example invalid arguments to built-ins throw `ValueError`). A common practice is to convert remaining warnings into exceptions with an error handler, so nothing fails silently.

```php
<?php
set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;                                    // respect @ and settings
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

try {
    $data = json_decode($body, true, flags: JSON_THROW_ON_ERROR);
    $ratio = intdiv($a, $b);
} catch (JsonException $e) {
    return badRequest('Invalid JSON');
} catch (DivisionByZeroError $e) {
    return badRequest('b must not be zero');
}
```

- Pitfall: `catch (Exception $e)` does not catch `Error`; use `Throwable` at top-level boundaries only.
- Pitfall: the `@` suppression operator hides problems and is slow; avoid it.

### Exception handling patterns
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.exceptions.php -->
Good exception design makes failures understandable and recoverable:

- Throw specific exception types (custom classes per domain error) so callers can catch precisely.
- Catch only where you can do something useful: retry, translate to an HTTP response, add context, or clean up. Otherwise let it propagate to a global handler that logs and returns a generic 500.
- Wrap low-level exceptions in domain exceptions, passing the original as `$previous` to keep the full chain for debugging.
- Use `finally` for cleanup that must run whether or not an exception occurred.
- Multi-catch with `|` handles several types the same way. Since PHP 8.0 the variable can be omitted: `catch (FooException)`.

```php
<?php
final class PaymentDeclined extends RuntimeException
{
    public static function forOrder(int $orderId, string $reason, ?Throwable $prev = null): self
    {
        return new self("Payment for order $orderId declined: $reason", 402, $prev);
    }
}

function chargeOrder(Order $order, PaymentGateway $gateway): void
{
    $lock = acquireLock("order:{$order->id}");
    try {
        $gateway->charge($order->total(), $order->paymentToken);
    } catch (GatewayTimeout | GatewayUnavailable $e) {
        throw new RetryableException('Gateway problem', previous: $e);
    } catch (CardDeclined $e) {
        throw PaymentDeclined::forOrder($order->id, $e->getMessage(), $e);
    } finally {
        $lock->release();
    }
}

set_exception_handler(function (Throwable $e) use ($logger) {
    $logger->error('Unhandled', ['exception' => $e]);
    http_response_code(500);
    echo 'Something went wrong';
});
```

- Pitfall: empty catch blocks silently swallow failures.
- Pitfall: showing exception messages and stack traces to users leaks internals.

### Error reporting configuration and logging
<!-- level: basic; ref: https://www.php.net/manual/en/errorfunc.configuration.php -->
PHP's error behaviour is controlled by `php.ini` directives, and dev and production need different settings:

- `error_reporting`: which levels are reported. Use `E_ALL` everywhere.
- `display_errors`: print errors in the response. On in development, Off in production (it leaks paths, queries and secrets).
- `log_errors` and `error_log`: write errors to a log file or stderr. Always on in production.
- `display_startup_errors`, `zend.exception_ignore_args` (hide argument values in traces in production).

In containers, log to stderr so the platform collects logs. Applications should use a PSR-3 logger like Monolog with structured context and log levels, shipping logs to a central system.

```ini
; production php.ini
error_reporting = E_ALL
display_errors = Off
display_startup_errors = Off
log_errors = On
error_log = /proc/self/fd/2
zend.exception_ignore_args = On
```

```php
<?php
use Monolog\Level;
use Monolog\Logger;
use Monolog\Handler\StreamHandler;
use Monolog\Formatter\JsonFormatter;

$handler = new StreamHandler('php://stderr', Level::Info);   // Monolog 3
$handler->setFormatter(new JsonFormatter());
$log = new Logger('shop', [$handler]);

$log->warning('Payment retry', ['order_id' => 42, 'attempt' => 3]);
```

- Pitfall: hiding deprecations means surprise breakage on the next major upgrade; log them and fix them gradually.
- Tip: add a request id to every log line so you can trace one request across services.
