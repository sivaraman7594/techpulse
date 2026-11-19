## 12. Performance

### OPcache
<!-- level: intermediate; ref: https://www.php.net/manual/en/book.opcache.php -->
Without OPcache, PHP reads, parses and compiles every included file into opcodes on every request. For a framework application loading hundreds of files, that is most of the request time. OPcache stores compiled opcodes (and interned strings) in shared memory so later requests skip compilation entirely. It is the single most important PHP performance setting, typically giving 2x to 5x throughput.

Key settings for production:

- `opcache.enable=1` and enough `opcache.memory_consumption` and `opcache.max_accelerated_files` to hold the whole codebase (check hit rates with `opcache_get_status()`).
- `opcache.validate_timestamps=0`: never check files for changes. Fastest, but you must reset the cache (reload PHP-FPM) on every deploy.
- `opcache.interned_strings_buffer`: raise for large apps.

```ini
; /etc/php/8.4/fpm/conf.d/10-opcache.ini
opcache.enable=1
opcache.memory_consumption=256
opcache.interned_strings_buffer=32
opcache.max_accelerated_files=50000
opcache.validate_timestamps=0
opcache.save_comments=1          ; needed by tools reading docblocks
```

```bash
# deploy: switch the symlink, then reload FPM to clear the cache
ln -sfn /srv/app/releases/2026-11-18 /srv/app/current
sudo systemctl reload php8.4-fpm
```

- Pitfall: with symlink-based deploys and `validate_timestamps=0`, stale code keeps running until the cache is reset; use `$realpath_root` in Nginx and reload FPM.
- Pitfall: if the cache fills up, OPcache stops caching new files or restarts, causing latency spikes; monitor it.

### JIT and preloading
<!-- level: advanced; ref: https://www.php.net/manual/en/opcache.preloading.php -->
PHP 8.0 added a JIT (just-in-time) compiler to OPcache that translates hot opcodes into native machine code. It dramatically speeds up CPU-bound code (math, image processing, parsers, algorithms), but typical web applications are I/O-bound (database, network, file system), so the gain there is usually small. PHP 8.4 moved to a new IR-based JIT implementation and changed configuration: enable it with `opcache.jit=tracing` plus a non-zero `opcache.jit_buffer_size`.

Preloading (PHP 7.4) loads chosen files into OPcache when PHP-FPM starts, linking classes once so they are permanently available to every request without autoloading. It helps frameworks with many classes, at the cost of needing an FPM restart to pick up changes. Symfony generates a preload file automatically.

```ini
opcache.jit=tracing
opcache.jit_buffer_size=128M

opcache.preload=/srv/app/current/config/preload.php
opcache.preload_user=www-data
```

```php
<?php
// config/preload.php (simplified)
require __DIR__ . '/../vendor/autoload.php';
$classes = require __DIR__ . '/../var/cache/prod/preload_classes.php';
foreach ($classes as $class) {
    class_exists($class);        // triggers autoload + compile into shared memory
}
```

- Pitfall: benchmark before and after; JIT can occasionally make things slower or expose bugs, and some debuggers/profilers disable it.
- Interview tip: say "for typical web apps, OPcache and fewer I/O round trips matter more than JIT".

### Profiling slow PHP code
<!-- level: intermediate; ref: https://xdebug.org/docs/profiler -->
Guessing at performance problems wastes time; measure instead. A good workflow:

1. Find which endpoints are slow and how often, using APM or logs with timing (New Relic, Datadog, Elastic APM, OpenTelemetry, Tideways).
2. Profile a representative slow request to see where time goes: CPU in PHP functions, database queries, HTTP calls, cache calls.
3. Fix the largest contributor, measure again.

Tools:

- Xdebug profiler: generates cachegrind files viewable in KCachegrind/QCachegrind or PhpStorm. High overhead; use in development.
- Blackfire, Tideways and SPX: low-overhead profilers suitable for staging or production sampling, with call graphs and comparisons.
- Framework tooling: Symfony Profiler, Laravel Telescope and Debugbar show queries, cache hits and timing per request.
- Database: slow query log and `EXPLAIN`.

```bash
# Xdebug 3: profile only when the trigger is present
php -d xdebug.mode=profile -d xdebug.start_with_request=trigger \
    -d xdebug.output_dir=/tmp/profiles script.php
curl -b XDEBUG_TRIGGER=1 https://app.local/orders
```

```php
<?php
$t = hrtime(true);
$report = $service->buildReport($month);
$logger->info('report built', ['ms' => (hrtime(true) - $t) / 1e6]);
```

Typical findings: N+1 queries, missing indexes, repeated identical HTTP calls, heavy work done per request that could be cached or queued, and large arrays copied in loops.

- Pitfall: never leave Xdebug enabled in production; it slows every request even when not profiling.

### Tuning PHP-FPM
<!-- level: advanced; ref: https://www.php.net/manual/en/install.fpm.configuration.php -->
PHP-FPM runs a pool of worker processes; each handles one request at a time. The number of workers caps concurrency: if all are busy, new requests queue in the listen backlog, and latency climbs even though CPU may be idle (for example when workers wait on a slow database).

Process manager modes:

- `static`: fixed number of workers. Predictable; good for dedicated servers and containers.
- `dynamic`: between min and max spare servers. The default.
- `ondemand`: spawns on demand. Saves memory for low-traffic sites.

Sizing: `pm.max_children` is roughly available memory divided by average worker memory (measure RSS under real load). Workers that wait on I/O can exceed CPU count; CPU-heavy apps should stay near core count.

```ini
; /etc/php/8.4/fpm/pool.d/www.conf
pm = static
pm.max_children = 40
pm.max_requests = 1000              ; recycle workers to contain memory leaks
request_terminate_timeout = 30s     ; kill runaway requests
request_slowlog_timeout = 5s
slowlog = /var/log/php-fpm/slow.log ; stack traces of slow requests
pm.status_path = /fpm-status        ; expose active/idle/queue metrics (restrict access)
```

Monitor `listen queue`, `active processes` and `max children reached` from the status page.

- Pitfall: setting `max_children` too high causes swapping and makes everything slower.
- Pitfall: one slow dependency (a payment API without timeouts) can occupy every worker and take down the whole site; always set HTTP client timeouts.

### Caching strategies in PHP applications
<!-- level: intermediate; ref: https://www.php.net/manual/en/book.apcu.php -->
Because PHP rebuilds state per request, caching expensive results is a major lever. Layers, from closest to farthest:

- In-request memoisation: a static or property array for values computed more than once in one request.
- APCu: shared memory on a single server, extremely fast, but not shared across servers and cleared on FPM restart. Good for configuration and computed metadata.
- Redis or Memcached: shared across servers; for sessions, query results, rate limits, locks.
- HTTP caching: `Cache-Control`, `ETag` and reverse proxies or CDNs (Varnish, Cloudflare) that serve whole responses without touching PHP.

The cache-aside pattern: read from cache; on a miss, compute, store with a TTL, return. Invalidate on writes, and protect hot keys from stampedes (many requests recomputing at once) with locks or early recomputation.

```php
<?php
use Symfony\Contracts\Cache\ItemInterface;

// Symfony Cache: get() handles miss, compute and stampede protection
$stats = $cache->get('dashboard.stats.' . $accountId, function (ItemInterface $item) use ($repo, $accountId) {
    $item->expiresAfter(300);
    $item->tag(['account-' . $accountId]);
    return $repo->computeStats($accountId);          // expensive queries
});

// Laravel
$products = Cache::remember('products.featured', now()->addMinutes(10), fn () =>
    Product::where('featured', true)->with('images')->get()
);
Cache::forget('products.featured');                  // invalidate after admin update

// APCu
$config = apcu_entry('app.config', fn () => loadConfigFromDisk(), 3600);
```

- Pitfall: caching per-user data under a shared key leaks private data between users; include the user or tenant id in the key.
- Pitfall: caching database objects with lazy-loaded relations can trigger queries or serialisation problems later.

## 13. Frameworks and the Ecosystem

### Laravel architecture overview
<!-- level: basic; ref: https://laravel.com/docs/lifecycle -->
Laravel is the most popular PHP framework. A request flows through these pieces:

1. `public/index.php` boots the application and the service container.
2. Service providers register bindings and configuration.
3. The HTTP kernel runs global middleware (sessions, CSRF, trimming input).
4. The router matches a route and runs route middleware (auth, throttling).
5. A controller (or closure) handles the request, using form requests for validation and Eloquent models for data.
6. A response is returned: a Blade view, JSON (often via API resources), or a redirect.

Other core pieces: Artisan CLI, migrations and seeders, queues and jobs, events and listeners, the scheduler, notifications, caching, and first-party packages (Sanctum for API tokens, Horizon for queue monitoring, Octane for long-running servers, Pulse for monitoring).

```php
<?php
// routes/web.php
Route::middleware('auth')->group(function () {
    Route::get('/orders', [OrderController::class, 'index'])->name('orders.index');
    Route::post('/orders', [OrderController::class, 'store']);
});

// app/Http/Controllers/OrderController.php
final class OrderController extends Controller
{
    public function store(StoreOrderRequest $request, PlaceOrder $placeOrder): RedirectResponse
    {
        $order = $placeOrder->handle($request->user(), $request->validated());
        return redirect()->route('orders.index')->with('status', "Order {$order->id} placed");
    }
}
```

```bash
php artisan make:model Order -mfc     # model + migration + factory + controller
php artisan migrate
php artisan route:list
php artisan config:cache && php artisan route:cache   # production optimisation
```

- Pitfall: putting all business logic in controllers or models makes them huge; extract action or service classes.
- Tip: the service container resolves type-hinted dependencies automatically (autowiring).

### Eloquent ORM essentials
<!-- level: intermediate; ref: https://laravel.com/docs/eloquent -->
Eloquent is Laravel's active-record ORM: each model class maps to a table, and each instance to a row, with methods to query, save and delete. Relationships (`hasMany`, `belongsTo`, `belongsToMany`, polymorphic) are declared as methods. Attribute casting converts columns to PHP types such as enums, dates, arrays and encrypted values.

Important features: query scopes, eager loading, mass assignment protection (`$fillable`/`$guarded`), accessors and mutators, model events and observers, soft deletes, and chunking or lazy collections for large datasets.

```php
<?php
final class Order extends Model
{
    protected $fillable = ['customer_id', 'status', 'total_cents'];

    protected function casts(): array
    {
        return [
            'status'   => OrderStatus::class,      // backed enum
            'paid_at'  => 'immutable_datetime',
            'metadata' => 'array',
        ];
    }

    public function customer(): BelongsTo { return $this->belongsTo(Customer::class); }
    public function lines(): HasMany { return $this->hasMany(OrderLine::class); }

    public function scopePaid(Builder $q): void { $q->where('status', OrderStatus::Paid); }
}

$recent = Order::paid()
    ->with(['customer:id,name', 'lines.product'])
    ->where('created_at', '>=', now()->subDays(30))
    ->orderByDesc('id')
    ->paginate(25);

Order::where('status', OrderStatus::Pending)
    ->where('created_at', '<', now()->subDay())
    ->chunkById(500, fn ($orders) => $orders->each->cancel());
```

- Pitfall: `Order::all()` on a large table loads every row into memory.
- Pitfall: mass assignment with `$guarded = []` plus `$request->all()` lets users set fields like `is_admin`; use validated data.
- Tip: enable `Model::preventLazyLoading(!app()->isProduction())` to catch N+1 queries in development.

### Queues, jobs and scheduling
<!-- level: intermediate; ref: https://laravel.com/docs/queues -->
Slow or failure-prone work (sending email, generating PDFs, calling third-party APIs, processing uploads) should not run inside the web request. Push it to a queue and process it with background worker processes. The user gets a fast response, and failures can be retried.

In Laravel, a job class implements `ShouldQueue`; dispatching serialises it to a queue backend (Redis, SQS, database, RabbitMQ via packages). `php artisan queue:work` runs workers; Horizon manages and monitors Redis queues. Jobs support retries (`$tries`), backoff, timeouts, unique jobs, rate limiting middleware, batching and chaining. Failed jobs land in a `failed_jobs` table for inspection and retry.

The scheduler replaces many cron entries with one: cron calls `schedule:run` every minute, and tasks are defined in code.

```php
<?php
final class SendInvoiceEmail implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;
    public array $backoff = [10, 60, 300];

    public function __construct(public int $invoiceId) {}   // pass ids, not huge objects

    public function handle(Mailer $mailer, InvoiceRepository $invoices): void
    {
        $invoice = $invoices->find($this->invoiceId);
        if ($invoice === null || $invoice->emailed_at !== null) {
            return;                                          // idempotent: safe to retry
        }
        $mailer->to($invoice->customer->email)->send(new InvoiceMail($invoice));
        $invoice->update(['emailed_at' => now()]);
    }
}

SendInvoiceEmail::dispatch($invoice->id)->afterCommit();

// routes/console.php
Schedule::command('reports:daily')->dailyAt('02:00')->onOneServer()->withoutOverlapping();
```

- Pitfall: dispatching inside a transaction can run the job before the commit; use `afterCommit()`.
- Pitfall: workers are long-running; restart them on deploy (`queue:restart`) or they keep old code.

### Symfony, components and dependency injection
<!-- level: intermediate; ref: https://symfony.com/doc/current/service_container.html -->
Symfony is both a full-stack framework and a set of decoupled, reusable components (HttpFoundation, Console, EventDispatcher, Routing, Cache, Messenger, Validator, Serializer, Mailer). Many other projects use these components, including Laravel and Drupal.

Its central idea is the dependency injection (DI) container: services are classes whose dependencies are injected through constructors, and the container builds the object graph. Autowiring infers dependencies from type hints; autoconfiguration tags services (event subscribers, console commands) automatically. In production the container is compiled to optimised plain PHP, so there is no reflection cost at runtime.

Dependency injection, whatever the framework, makes code testable (inject fakes), explicit (dependencies visible in the constructor) and configurable.

```php
<?php
// src/Billing/InvoiceMailer.php
final class InvoiceMailer
{
    public function __construct(
        private MailerInterface $mailer,
        private LoggerInterface $logger,
        #[Autowire('%env(INVOICE_FROM_ADDRESS)%')] private string $from,
    ) {}
}

// src/Controller/InvoiceController.php
final class InvoiceController extends AbstractController
{
    #[Route('/invoices/{id}/send', methods: ['POST'])]
    public function send(Invoice $invoice, InvoiceMailer $mailer): Response
    {
        $mailer->send($invoice);
        return $this->redirectToRoute('invoice_show', ['id' => $invoice->getId()]);
    }
}
```

```bash
php bin/console debug:container InvoiceMailer
php bin/console debug:router
```

- Pitfall: service locators (pulling services from the container inside business code) hide dependencies; inject them.
- Interview tip: compare Laravel (convention, facades, active record) with Symfony (explicit configuration, Doctrine data mapper).

## 14. Quality, Testing and Operations

### Testing with PHPUnit and Pest
<!-- level: basic; ref: https://docs.phpunit.de/en/11.5/ -->
PHPUnit is the standard PHP testing framework; Pest is a popular layer on top with a terser, function-based syntax. Both run unit tests (one class in isolation), integration tests (with a real database or filesystem), and feature tests (full HTTP requests through the framework).

Good practices:

- Arrange, act, assert; one behaviour per test with a descriptive name.
- Use test doubles (fakes, stubs, mocks) for external services, but prefer real objects for your own value objects.
- Use data providers or datasets for many input cases.
- Run tests against a real database engine (often in a container) with transactions or refreshes for isolation; SQLite substitutes can hide engine-specific bugs.
- Measure coverage to find untested code, but do not chase 100%.

```php
<?php
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class MoneyTest extends TestCase
{
    public function test_adding_same_currency(): void
    {
        $sum = (new Money(1000, 'EUR'))->add(new Money(250, 'EUR'));
        self::assertSame(1250, $sum->amount);
    }

    #[DataProvider('invalidAmounts')]
    public function test_rejects_negative_amounts(int $amount): void
    {
        $this->expectException(InvalidArgumentException::class);
        new Money($amount, 'EUR');
    }

    public static function invalidAmounts(): array { return [[-1], [-500]]; }
}

// Pest + Laravel feature test
it('creates an order', function () {
    $user = User::factory()->create();
    $this->actingAs($user)->post('/orders', ['product_id' => 1, 'qty' => 2])->assertRedirect();
    expect(Order::count())->toBe(1);
});
```

```bash
vendor/bin/phpunit --testsuite unit
vendor/bin/pest --parallel --coverage
```

- Pitfall: tests that depend on the current time or random values are flaky; inject a clock (PSR-20) or freeze time.

### Static analysis and code style
<!-- level: intermediate; ref: https://phpstan.org/user-guide/getting-started -->
PHP is dynamic, so many bugs (calling a method on possibly-null values, wrong argument types, dead code, undefined variables) appear only at runtime. Static analysers read the code without running it and catch these early. PHPStan and Psalm are the main tools; both understand PHP's types plus richer docblock types such as generics (`list<User>`, `array<string, int>`, `Collection<int, Order>`) and literal types.

Both have levels: start low on legacy code, record existing errors in a baseline file, and raise the level over time so new code is held to a high standard.

Complementary tools:

- PHP-CS-Fixer or PHP_CodeSniffer: enforce a code style (PER-CS) automatically.
- Rector: automated refactoring and PHP version upgrades.
- Larastan: PHPStan extension that understands Laravel's magic.

```php
<?php
/**
 * @param list<Order> $orders
 * @return array<string, int> total cents per currency
 */
function totalsByCurrency(array $orders): array
{
    $totals = [];
    foreach ($orders as $order) {
        $totals[$order->currency] = ($totals[$order->currency] ?? 0) + $order->totalCents;
    }
    return $totals;
}
```

```bash
vendor/bin/phpstan analyse src tests --level=8
vendor/bin/phpstan analyse --generate-baseline      # accept existing errors, block new ones
vendor/bin/php-cs-fixer fix --dry-run --diff
vendor/bin/rector process src --dry-run
```

- Tip: run all of these in CI on every pull request; they are cheap compared with production bugs.
- Pitfall: suppressing errors with `@phpstan-ignore` everywhere defeats the purpose.

### Deploying and running PHP in production
<!-- level: intermediate; ref: https://www.php.net/manual/en/install.fpm.php -->
A reliable PHP deployment is repeatable and atomic:

1. CI builds an artifact: `composer install --no-dev --optimize-autoloader`, frontend assets, framework caches (`config:cache`, `route:cache`, `event:cache` in Laravel; `cache:warmup` in Symfony).
2. Ship it as a container image or a release directory.
3. Run database migrations in a backward-compatible way (expand, deploy, contract), so old and new code can run during the rollout.
4. Switch traffic atomically (symlink swap and FPM reload, or rolling container update with health checks).
5. Restart queue workers and long-running processes so they load new code.

Containers typically run Nginx (or Caddy) plus PHP-FPM, or FrankenPHP, which embeds PHP into the Caddy web server and supports a worker mode where the app boots once and handles many requests.

```dockerfile
FROM php:8.4-fpm-alpine
RUN docker-php-ext-install pdo_mysql opcache
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www/app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --prefer-dist --no-interaction
COPY . .
RUN composer dump-autoload --optimize --classmap-authoritative
COPY docker/php/production.ini /usr/local/etc/php/conf.d/zz-production.ini
USER www-data
```

- Pitfall: in long-running worker modes (Octane, FrankenPHP workers, RoadRunner), state in static properties or singletons leaks between requests; reset it per request.
- Pitfall: storing uploads or sessions on the container filesystem loses them on redeploy; use object storage and Redis.
- Tip: keep secrets in environment variables or a secret manager, never in the image.
