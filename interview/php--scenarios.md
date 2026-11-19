### Your PHP-FPM site returns intermittent 502/504 errors under load. How would you investigate and fix it?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/install.fpm.configuration.php -->
Observe: check the web server error log for "upstream timed out" or "connect() failed", and the FPM log for `server reached pm.max_children`. Look at the slow log (`request_slowlog_timeout`, `slowlog`) and the FPM status page (`pm.status_path`) for active, idle and listen-queue figures.

Hypothesise: either the pool is exhausted (all workers busy on slow requests, so new ones queue and time out) or workers are crashing (memory limit, segfault, OOM killer).

Verify: if listen queue is non-zero and active equals max, you are saturated. Find what the workers are doing: the slow log stack traces usually point to a slow query, an external HTTP call without timeout, or a session lock. Check `dmesg` for OOM kills and compute average worker RSS.

Fix: set explicit timeouts on every outbound call, fix the slow query, release session locks with `session_write_close()`, and size `pm.max_children` as available RAM divided by worker memory. Moving slow work to a queue is the durable remedy.

```ini
pm = dynamic
pm.max_children = 40
pm.max_requests = 500
request_slowlog_timeout = 3s
```

Prevent: alert on listen queue and 5xx rate, load test before releases.

Common wrong answers: just raising `max_children` (causes swap and OOM), or raising `max_execution_time` and the proxy timeout, which hides the problem.

### A PHP import script dies with "Allowed memory size exhausted" on a 2 GB CSV. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/language.generators.overview.php -->
Observe: the error line and `memory_get_peak_usage()` at intervals tell you whether usage grows linearly with rows (accumulation) or spikes at one call (such as `file()` or `file_get_contents`).

Hypothesise: the script loads the whole file or collects all rows into an array, or an ORM or query logger retains every entity.

Verify: log memory every 10,000 rows. If it rises steadily, something is accumulating. Disabling the framework's query log or identity map and seeing the slope flatten confirms it.

Fix: stream with a generator over `fopen`/`fgetcsv`, process and insert in batches (for example 1,000 rows per transaction), release batch arrays, and clear the ORM unit of work between batches.

```php
function rows(string $f): Generator {
    $h = fopen($f, 'r');
    while (($r = fgetcsv($h)) !== false) yield $r;
    fclose($h);
}
foreach (array_chunk_iter(rows($f), 1000) as $batch) { /* insert */ }
```

Prevent: make the job resumable by recording the last processed offset, and run it in CLI where `max_execution_time` is zero.

Wrong answers: raising `memory_limit` to -1 (it only delays the crash), or `ini_set` within a web request for a job that belongs in a queue worker.

### Users report being randomly logged out of your PHP app after you scaled to three servers. What is wrong?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/session.configuration.php -->
Observe: logouts correlate with requests landing on a different server; sessions work fine on a single node. Check `session.save_handler` and `session.save_path`.

Hypothesise: sessions are stored as local files, so each server has its own session store and a request routed elsewhere finds no session.

Verify: log `session_id()` with a server hostname per request; you will see the same ID unknown on other nodes. Confirm the load balancer has no stickiness.

Fix options: move sessions to a shared store such as Redis (`session.save_handler = redis`, `session.save_path = "tcp://redis:6379"`) or a database handler, or use signed stateless tokens for authentication. Sticky sessions work but make deploys, scaling and failure uneven.

```ini
session.save_handler = redis
session.save_path = "tcp://redis.internal:6379?auth=..."
session.gc_maxlifetime = 7200
```

Also ensure all nodes share the same `APP_KEY`/signing secret and cookie domain.

Prevent: treat app servers as stateless, including uploads (use object storage) and caches.

Wrong answers: increasing session lifetime, or blaming browsers. Another trap: Redis session locking can serialise parallel requests, so close sessions early.

### A login form is being brute-forced. How would you respond in a PHP application?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/function.password-verify.php -->
Observe: authentication logs show many failed attempts for one account (password guessing) or one password across many accounts (spraying), plus source IP distribution.

Hypothesise: no throttling exists and responses leak whether an account exists.

Verify: reproduce with a script; check whether the error message or timing differs between unknown user and wrong password.

Fix: layered controls. Rate-limit per account and per IP using a shared counter (Redis `INCR` with expiry) with exponential backoff; return one generic message; do the `password_verify` against a dummy hash for unknown users to equalise timing; add CAPTCHA or proof of work after several failures; offer MFA; notify users on unusual logins. Make sure you regenerate the session ID after success.

```php
$key = "login:" . hash('sha256', strtolower($email));
if ($redis->incr($key) === 1) $redis->expire($key, 900);
if ($redis->get($key) > 5) { http_response_code(429); exit; }
```

Prevent: check passwords against breached lists, monitor failed-login rate.

Wrong answers: permanently locking accounts after N failures (enables denial of service against victims), or throttling only by IP, which distributed attackers bypass.

### After a deploy, some users see old code and others new code. Why, and how do you fix it?
<!-- level: advanced; kind: scenario; ref: https://www.php.net/manual/en/opcache.configuration.php#ini.opcache.validate-timestamps -->
Observe: behaviour differs between requests and recovers after some time or after restarting PHP-FPM.

Hypothesise: OPcache is serving cached opcodes from the old release, either because `validate_timestamps=0` and no reload happened, or because the release directory is switched via symlink and the realpath cache still points to old files. Another possibility: multiple servers deployed non-atomically.

Verify: call `opcache_get_status()` and inspect cached script paths and timestamps; compare file hashes across nodes; check FPM master start time.

Fix: make deployment atomic (build in a new release directory, switch the symlink, then reload PHP-FPM gracefully with `systemctl reload php-fpm` or call `opcache_reset()` through a protected endpoint). For symlinked releases keep `opcache.revalidate_path=1` or reload anyway. Drain nodes from the load balancer one at a time to avoid mixed versions, and use backwards-compatible database migrations.

```bash
ln -sfn /srv/releases/20261119 /srv/current
sudo systemctl reload php8.3-fpm
```

Prevent: put the reload in the deploy script, and include a version header or `/version` endpoint to verify.

Wrong answers: disabling OPcache in production, or manually clearing caches after the fact only.

### Your API intermittently returns 500 with "Too many connections" from MySQL. How do you handle it?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/pdo.connections.php -->
Observe: errors appear at traffic peaks; `SHOW STATUS LIKE 'Threads_connected'` approaches `max_connections`; `SHOW PROCESSLIST` shows many sleeping or long-running queries.

Hypothesise: each FPM worker holds one connection, so connections equal workers times servers; or persistent connections (`PDO::ATTR_PERSISTENT`) accumulate; or a few slow queries hold connections while others queue.

Verify: compare worker count across all app nodes with `max_connections`; find the top slow queries via the slow log; check whether scripts leave transactions open (idle in transaction) after exceptions.

Fix: remove slow queries first (indexes, pagination), always close transactions in `finally`, cap total workers so that nodes times `pm.max_children` stays below the limit with headroom, and consider a connection pooler such as ProxySQL. Raise `max_connections` only after checking memory, since each connection costs RAM.

```php
try { $pdo->beginTransaction(); /* ... */ $pdo->commit(); }
catch (Throwable $e) { $pdo->rollBack(); throw $e; }
```

Prevent: alert at 80% connections, load test, and add retry with jitter for transient failures.

Wrong answers: setting `max_connections` to 10000, or enabling persistent connections as a fix.

### A form shows a "Cross-site scripting" finding from the security team. How would you fix it properly in PHP?
<!-- level: basic; kind: scenario; ref: https://www.php.net/manual/en/function.htmlspecialchars.php -->
Observe: identify the reflected or stored sink: user input echoed into HTML, an attribute, JavaScript or a URL.

Hypothesise: output is not escaped for its context.

Verify: submit `"><script>alert(1)</script>` and `' onmouseover='alert(1)` and view the rendered source to see which context breaks.

Fix: escape at output, per context. For HTML body and attributes use `htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')`. Use a template engine (Twig, Blade) with auto-escaping on by default and avoid raw output filters. For data in JavaScript use `json_encode` with `JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT`; for URLs validate the scheme (reject `javascript:`) and use `rawurlencode` for components. If rich HTML must be accepted, sanitise with an allowlist library such as HTMLPurifier. Add a Content-Security-Policy as defence in depth and set cookies `HttpOnly`.

```php
echo htmlspecialchars($name, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
```

Prevent: lint for raw output in code review, add tests with hostile payloads.

Wrong answers: stripping input with `strip_tags` or blacklisting `<script>`, double escaping on input, or escaping once for every context.

### Cron-driven PHP jobs sometimes run twice and double-charge customers. How do you stop it?
<!-- level: advanced; kind: scenario; ref: https://www.php.net/manual/en/function.flock.php -->
Observe: two rows with near-identical timestamps from different processes; the previous run was still active when the next cron tick fired, or two servers run the same crontab.

Hypothesise: no mutual exclusion and no idempotency in the charge logic.

Verify: log PID and hostname per run; check the overlap of start and end times.

Fix: two layers. First prevent overlap: on a single host use `flock` (`flock -n /tmp/job.lock php job.php`) or `flock()` in PHP; across hosts use a distributed lock (Redis `SET key value NX PX 600000`, a database advisory lock, or a leader-only scheduler). Second, make the work idempotent: charge using an idempotency key derived from invoice ID and attempt period, store a unique constraint on `(invoice_id, period)`, and mark state transitions atomically with `UPDATE ... WHERE status='pending'` checking affected rows.

```php
$ok = $redis->set('lock:billing', gethostname(), ['nx', 'px' => 600000]);
if (!$ok) exit(0);
```

Prevent: locks can expire mid-run, so idempotency is the real safety net. Alert on duration exceeding schedule interval.

Wrong answers: rely on a lock alone, or on "check if charged" followed by charge without a unique constraint (race).

### Your Composer-based app works locally but fails on Linux with "Class not found". What is the likely cause?
<!-- level: basic; kind: scenario; ref: https://getcomposer.org/doc/04-schema.md#psr-4 -->
Observe: the exact class name in the error and the file on disk; development is on Windows or macOS and production on Linux.

Hypothesise: case mismatch between class, namespace and file/directory name (case-insensitive filesystems hide it), a stale optimised classmap, or a missing dependency in production because of `--no-dev`.

Verify: run `composer dump-autoload -o` and `composer validate`; use `composer show` to confirm the package is installed; compare `ls` output case with the namespace; check `autoload.psr-4` prefixes end with a double backslash.

Fix: rename files to match the class precisely (`UserController.php` for `UserController`), regenerate the autoloader, and move any runtime package wrongly listed in `require-dev` to `require`.

```bash
composer dump-autoload --optimize
composer install --no-dev --classmap-authoritative
```

Prevent: run CI on Linux, enable `composer dump-autoload --strict-psr` (Composer 2.4+) to fail on PSR violations, and commit `composer.lock`.

Wrong answers: adding `require` statements manually, or deleting `vendor` repeatedly without reading the actual name mismatch.

### A PHP endpoint is slow because of an N+1 query problem. How do you find and fix it?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/pdo.prepared-statements.php -->
Observe: the endpoint takes 2 seconds for 200 items, and the database log shows hundreds of nearly identical `SELECT ... WHERE id = ?` queries.

Hypothesise: a loop triggers a query per row, typically lazy-loaded relations in an ORM or a helper function that queries inside `foreach`.

Verify: enable query counting (framework debug bar, `DB::listen`, or PDO wrapper) and compare the query count with the row count; `EXPLAIN` the repeated query.

Fix: fetch related data in bulk. Either a join, or a second query with `WHERE id IN (...)` and then index results in PHP by key.

```php
$ids = array_column($orders, 'customer_id');
$in  = implode(',', array_fill(0, count($ids), '?'));
$st  = $pdo->prepare("SELECT * FROM customers WHERE id IN ($in)");
$st->execute($ids);
$byId = array_column($st->fetchAll(PDO::FETCH_ASSOC), null, 'id');
```

In ORMs, use eager loading (`with()` in Eloquent, `JOIN FETCH` in Doctrine). Ensure the foreign key column is indexed.

Prevent: add a test asserting max query count for key endpoints, and strict-lazy-loading modes in development.

Wrong answers: caching each individual query result, or adding a bigger server.

### Users complain that uploaded images are rotated wrongly and some uploads fail silently. How do you debug?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/features.file-upload.errors.php -->
Observe: failures cluster on large phone photos; the app returns success but no file exists, or `$_POST` is empty.

Hypothesise: size limits (`upload_max_filesize`, `post_max_size`, web server `client_max_body_size`) are exceeded, and the code ignores `$_FILES['x']['error']`. Rotation issues come from EXIF orientation metadata that is dropped or ignored on resize.

Verify: dump `$_FILES` error codes (`UPLOAD_ERR_INI_SIZE` is 1, `UPLOAD_ERR_FORM_SIZE` is 2); check that `post_max_size` is larger than `upload_max_filesize`; inspect the file's EXIF orientation with `exif_read_data`.

Fix: align all three limits, always validate the error code and return a clear message, and normalise images server side by applying orientation then stripping metadata (GD with `imagerotate` or Imagick `autoOrient`), while also validating the MIME type with `finfo`.

```php
if ($f['error'] !== UPLOAD_ERR_OK) {
    throw new UploadException(match ($f['error']) {
        UPLOAD_ERR_INI_SIZE => 'File too large', default => 'Upload failed',
    });
}
```

Prevent: integration tests with a large fixture; process images asynchronously in a queue.

Wrong answers: raising the limits blindly and ignoring error codes.

### A Laravel/Symfony queue worker in PHP gradually consumes more memory until killed. What do you do?
<!-- level: advanced; kind: scenario; ref: https://www.php.net/manual/en/features.gc.php -->
Observe: worker RSS climbs per job, and the supervisor restarts it after OOM. Use `memory_get_usage()` logging after each job.

Hypothesise: persistent state across jobs: static caches, ORM entity managers keeping loaded entities, event listeners accumulating, large result sets retained, or reference cycles that the collector has not freed.

Verify: log memory before and after each job type to isolate the culprit; take a snapshot with `gc_status()` and `gc_collect_cycles()` to see whether cycles are the issue; bisect by running one job class repeatedly.

Fix: clear the entity manager and identity maps after each job, avoid static arrays that grow, stream large datasets, and unset big variables. Add safety limits so the worker exits cleanly: `--max-jobs`, `--max-time`, or `--memory` options, and let the supervisor restart it.

```bash
php artisan queue:work --max-jobs=500 --memory=256 --max-time=3600
```

Prevent: graceful restarts on deploy, memory trend alerts, and tests that run the same job in a loop to detect growth.

Wrong answers: raising `memory_limit`, or disabling garbage collection, which makes cycles worse.

### How would you debug a PHP script that silently produces a blank page?
<!-- level: basic; kind: scenario; ref: https://www.php.net/manual/en/errorfunc.configuration.php -->
Observe: HTTP 200 or 500 with an empty body, nothing visible in the browser.

Hypothesise: a fatal error or parse error occurred with `display_errors` off, which is correct for production, so the message went to the error log (or nowhere if logging is misconfigured). Output buffering or an exception handler that swallows exceptions are other causes.

Verify: check `error_log` and the FPM and web server logs; run `php -l file.php` for syntax errors; run the entry script from CLI; check `ini_get('error_reporting')`, `log_errors` and `error_log` paths and file permissions.

Fix: in development set `error_reporting=E_ALL`, `display_errors=1`; in production keep `display_errors=0`, `log_errors=1`, and send logs to a central place. Find and fix the root cause, then register a proper global exception handler that logs and returns a clean error page.

```ini
error_reporting = E_ALL
display_errors = Off
log_errors = On
error_log = /var/log/php/app.log
```

Prevent: monitor error logs, use `declare(strict_types=1)` and static analysis to catch problems earlier.

Wrong answers: enabling `display_errors` in production (leaks paths and data), or editing code randomly with `echo` statements.

### Your PHP app calls a payment provider and sometimes hangs the whole site. What is happening?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/function.curl-setopt.php -->
Observe: when the provider is slow, request latency spikes site-wide and FPM workers all appear busy.

Hypothesise: outbound HTTP calls have no timeout (cURL's default is effectively unlimited for the transfer), so each hung request occupies a worker until FPM kills it, and the pool gets exhausted.

Verify: look at slow-log stack traces showing `curl_exec` or `file_get_contents`; check the status page for active workers; test with a delayed mock endpoint.

Fix: set connect and total timeouts on every client, add limited retries with jitter only for idempotent calls (or with idempotency keys), use a circuit breaker so repeated failures fail fast, and move non-critical calls (receipts, webhooks) to a queue.

```php
curl_setopt_array($ch, [
    CURLOPT_CONNECTTIMEOUT => 2,
    CURLOPT_TIMEOUT        => 8,
]);
```

Prevent: a separate FPM pool for slow integrations isolates blast radius; add metrics for upstream latency.

Wrong answers: raising `max_execution_time` (it doesn't count time blocked in system calls on Linux), or retrying immediately and indefinitely which amplifies the outage.

### A JSON API built in PHP returns corrupted or empty responses for some users with special characters. Why?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/function.json-encode.php -->
Observe: `json_encode` returns `false` (so the body is empty) for certain records only.

Hypothesise: invalid UTF-8 in data (legacy latin1 columns, truncated multibyte strings from `substr`), or NaN/INF floats, or deep recursion.

Verify: call `json_last_error_msg()` ("Malformed UTF-8 characters"); inspect offending rows with `mb_check_encoding`; check the database and connection charset (`utf8mb4`).

Fix: set connection charset to `utf8mb4`, convert legacy data, use `mb_substr` and `mb_strimwidth` instead of `substr`, and encode with `JSON_THROW_ON_ERROR` so failures become exceptions rather than silent false. For tolerant output only where acceptable, use `JSON_INVALID_UTF8_SUBSTITUTE`.

```php
try {
    echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
} catch (JsonException $e) {
    $log->error($e->getMessage());
    http_response_code(500);
}
```

Prevent: validate encoding at input boundaries and test with emoji and accented fixtures.

Wrong answers: using `utf8_encode` blindly on already-UTF-8 text (double encodes and it is deprecated in PHP 8.2), or suppressing errors with `@`.

### You must upgrade a legacy PHP 7.4 application to PHP 8.3. How do you approach it?
<!-- level: advanced; kind: scenario; ref: https://www.php.net/manual/en/appendices.php -->
Observe: inventory the application, frameworks, extensions and Composer dependencies, and check test coverage. PHP 7.4 and 8.0-8.1 are end-of-life, so security patches are not available.

Hypothesise: breakage will come from removed or changed behaviour: stricter string-to-number comparisons, `TypeError`s for internal functions given null, removed `each()` and `create_function`, deprecated dynamic properties (8.2), and incompatible dependencies.

Verify: run the code on a staging copy with `error_reporting=E_ALL`, run the test suite, and use static tools such as PHPCompatibility (PHPCS), PHPStan and Rector to flag and auto-fix issues.

Fix: upgrade in steps (7.4 to 8.0, then 8.1 and on) so each diff is small; update dependencies with `composer update` honouring `config.platform.php`; fix deprecation notices; add `#[AllowDynamicProperties]` only as a temporary bridge; deploy canary servers first and watch error rates.

```bash
composer require --dev rector/rector phpstan/phpstan
vendor/bin/rector process src --dry-run
```

Prevent: keep a CI matrix for the next version and upgrade regularly.

Wrong answers: jumping straight to the newest version with no tests, or silencing deprecations globally.

### Users can access other users' invoices by changing an ID in the URL. How do you fix it?
<!-- level: basic; kind: scenario; ref: https://www.php.net/manual/en/security.php -->
Observe: `GET /invoices/1042` returns data for any authenticated user: this is insecure direct object reference (broken access control).

Hypothesis: the controller loads by ID and checks authentication but not ownership.

Verify: log in as two users and request each other's IDs; write a failing test.

Fix: enforce authorisation on the server for every resource. Scope the query by owner (`WHERE id = :id AND account_id = :acct`) so another user's record behaves as not found, or centralise decisions in a policy layer (Laravel Policies, Symfony Voters). Return 404 rather than 403 where existence should not leak. Optionally use unguessable identifiers (UUIDs) as defence in depth, not as the control.

```php
$st = $pdo->prepare('SELECT * FROM invoices WHERE id = :id AND account_id = :a');
$st->execute([':id' => $id, ':a' => $currentUser->accountId]);
$invoice = $st->fetch() ?: throw new NotFoundException();
```

Prevent: write authorisation tests per endpoint with two tenants, and review list, export and download routes, not just detail pages.

Wrong answers: hiding the link in the UI, using sequential IDs encoded in base64, or checking only on the page view while the API stays open.

### A background PHP process must handle SIGTERM during deploys without losing jobs. How?
<!-- level: advanced; kind: scenario; ref: https://www.php.net/manual/en/function.pcntl-signal.php -->
Observe: deploys restart workers, and jobs in flight are killed halfway, leaving partial state or duplicate processing after retry.

Hypothesise: the worker does not handle signals, so SIGTERM terminates immediately; job handlers are not idempotent.

Verify: kill a worker mid-job in staging and inspect the data and queue state.

Fix: use `pcntl_async_signals(true)` and `pcntl_signal(SIGTERM, ...)` to set a "stop requested" flag; the loop finishes the current job, acknowledges it, and exits. Give the supervisor a stop timeout longer than your longest job (`stopwaitsecs` in Supervisor, `TimeoutStopSec` in systemd). Use visibility timeouts or ack-after-processing in the queue so unacked jobs return for retry, and make handlers idempotent.

```php
pcntl_async_signals(true);
$stop = false;
pcntl_signal(SIGTERM, function () use (&$stop) { $stop = true; });
while (!$stop) { $job = $queue->pop(); if ($job) handle($job); }
```

Prevent: heartbeat metrics, dead-letter queue for poison messages, and chaos testing of restarts.

Wrong answers: `kill -9` on deploy, or assuming jobs will be exactly-once.

### A search page using `LIKE '%term%'` is slow on a million-row table. What are your options?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/pdo.prepared-statements.php -->
Observe: query time grows with table size, and `EXPLAIN` shows a full table scan (`type: ALL`).

Hypothesise: a leading wildcard prevents the use of a B-tree index.

Verify: run `EXPLAIN` and compare `rows` to table size; test prefix search (`term%`) to see the index being used.

Fix options by need: if prefix search is acceptable, use `LIKE 'term%'` with an index. For word search use a database full-text index (MySQL `FULLTEXT` with `MATCH ... AGAINST`, PostgreSQL `tsvector` with GIN). For typo tolerance, ranking and facets use a search engine such as OpenSearch, Elasticsearch, or Meilisearch fed by async indexing. For substring search on Postgres, trigram indexes (`pg_trgm`) work. Always bind the term and escape `%` and `_` in user input.

```php
$term = addcslashes($q, '%_\\');
$st = $pdo->prepare('SELECT id,title FROM posts WHERE title LIKE :t LIMIT 20');
$st->execute([':t' => $term . '%']);
```

Prevent: set a result limit, add pagination, and measure with production-sized data.

Wrong answers: adding an index and expecting it to help a leading wildcard, or fetching everything and filtering in PHP.

### Your PHP application leaks stack traces and file paths to users. What do you change?
<!-- level: basic; kind: scenario; ref: https://www.php.net/manual/en/errorfunc.configuration.php#ini.display-errors -->
Observe: error pages reveal `/var/www/app/src/...`, SQL fragments or credentials in messages; `phpinfo()` or debug routes may also be exposed.

Hypothesise: `display_errors` is on, framework debug mode is enabled in production, or exceptions are echoed in responses.

Verify: trigger a 500 in production-like config and view the response; request `/phpinfo.php`, `/.env` and `/vendor/` to see whether they are reachable.

Fix: in production set `display_errors=0`, `expose_php=0`, framework `APP_DEBUG=false`; handle exceptions in a global handler that logs full detail with a correlation ID and returns a generic message containing only that ID. Keep `.env`, `vendor` and source outside the web root, with the document root pointing to `public/`. Remove diagnostic scripts.

```php
set_exception_handler(function (Throwable $e) use ($log) {
    $id = bin2hex(random_bytes(6));
    $log->error($e->getMessage(), ['id' => $id, 'trace' => $e->getTraceAsString()]);
    http_response_code(500);
    echo "Something went wrong. Reference: $id";
});
```

Prevent: config checks in CI and a security scan after each deploy.

Wrong answers: only hiding errors with the `@` operator, or leaving debug mode enabled behind a firewall rule.

### A report generation endpoint times out. How would you redesign it?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/function.set-time-limit.php -->
Observe: PDF or CSV generation takes 90 seconds; the gateway cuts at 60 seconds and users retry, creating duplicates and load.

Hypothesise: heavy synchronous work occurs inside an HTTP request, so duration is tied to data volume.

Verify: profile to see whether time goes to queries, PHP formatting or rendering; check data size growth.

Fix: make it asynchronous. The POST creates a job row (status `queued`) and returns `202 Accepted` with a status URL; a queue worker generates the file, writes it to object storage, and updates status; the client polls or receives a notification with a signed download link. Optimise inside the worker: stream rows with generators, use unbuffered queries, write CSV incrementally with `fputcsv`, and deduplicate by a request key so double clicks don't spawn two jobs.

```php
$jobId = $repo->createReportJob($userId, $params); // unique on user+params
$queue->push(new BuildReport($jobId));
http_response_code(202);
header("Location: /reports/$jobId");
```

Prevent: expire old files, cap concurrency per user, and track job duration metrics.

Wrong answers: raising `set_time_limit(0)` and proxy timeouts, which ties up workers and still fails for some clients.

### How would you safely handle a webhook from a third-party service in PHP?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/function.hash-hmac.php -->
Observe: the provider sends signed POSTs; sometimes the same event arrives twice or out of order, and your endpoint occasionally times out.

Hypothesise: without verification anyone can forge events; without deduplication retries cause double effects; slow processing triggers provider retries.

Verify: replay a captured payload with a wrong signature and with a duplicate ID in staging.

Fix: read the raw body (`file_get_contents('php://input')`) before any parsing, compute `hash_hmac('sha256', $raw, $secret)`, and compare with `hash_equals` against the header; reject stale timestamps to block replays. Store the event ID with a unique constraint and ignore duplicates. Persist the event and return 2xx quickly, then process through a queue. Tolerate out-of-order delivery by fetching the current resource state or comparing version numbers.

```php
$raw = file_get_contents('php://input');
$sig = hash_hmac('sha256', $raw, $secret);
if (!hash_equals($sig, $_SERVER['HTTP_X_SIGNATURE'] ?? '')) {
    http_response_code(401); exit;
}
```

Prevent: rotate secrets, monitor failure rates, and keep a dead-letter list.

Wrong answers: comparing signatures with `==`, parsing JSON and re-encoding before hashing, or doing all work synchronously.

### Memory and CPU spike when many users request the same expensive page. How do you add caching safely?
<!-- level: advanced; kind: scenario; ref: https://www.php-fig.org/psr/psr-16/ -->
Observe: identical computations run in parallel, and when a cache entry expires many requests recompute at once (cache stampede).

Hypothesise: no cache, or a cache with synchronised expiry and no lock.

Verify: log cache hit ratio and concurrent recomputations for the key; load test at expiry boundary.

Fix: cache the rendered fragment or data in Redis or APCu through a PSR-6/PSR-16 interface. Add TTL jitter so keys do not all expire together, use a lock so only one worker rebuilds (others serve slightly stale data: stale-while-revalidate), and consider probabilistic early expiration. Include everything that varies the result in the key (locale, user role, query params). Invalidate by event or versioned keys when the underlying data changes, and add HTTP caching (`Cache-Control`, `ETag`) at the edge for public pages.

```php
$v = $cache->get($key);
if ($v === null && $cache->set("lock:$key", 1, 30)) {
    $v = build();
    $cache->set($key, $v, 300 + random_int(0, 60));
}
```

Prevent: monitor hit ratio, set maximum sizes, and never cache personalised data under a shared key.

Wrong answers: caching with an infinite TTL, or caching responses that contain per-user content.

### A date and time bug shows wrong times for users in different countries. How do you approach it in PHP?
<!-- level: intermediate; kind: scenario; ref: https://www.php.net/manual/en/class.datetimeimmutable.php -->
Observe: events display an hour off for some users, and around daylight-saving changes, sorting looks wrong.

Hypothesise: times are stored in local server time or without a zone, `date_default_timezone_set` varies across environments, or arithmetic like `+ 86400` assumes a day is 24 hours.

Verify: print `date_default_timezone_get()`, database column types, and raw stored values; reproduce with a timestamp across a DST boundary.

Fix: store instants in UTC (`TIMESTAMP` or ISO 8601 with offset), set the application timezone to UTC, and convert to the user's IANA zone (`Europe/Berlin`, never fixed offsets) only at presentation. Use `DateTimeImmutable` to avoid accidental mutation, and calendar-aware modifications (`->modify('+1 day')` in the user's zone) for local-day logic.

```php
$utc = new DateTimeImmutable('2026-03-29 00:30:00', new DateTimeZone('UTC'));
echo $utc->setTimezone(new DateTimeZone('Europe/Berlin'))->format('c');
```

Prevent: tests that freeze the clock (inject a PSR-20 `ClockInterface`, PHP-FIG, or Symfony Clock) and cover DST transitions.

Wrong answers: storing offsets as integers, using `strtotime` on ambiguous formats like `01/02/2026`, or using `DateTime` with shared mutation.

### You find `eval()` and `unserialize($_COOKIE['data'])` in a legacy codebase. How do you remediate?
<!-- level: advanced; kind: scenario; ref: https://www.php.net/manual/en/function.unserialize.php -->
Observe: both execute attacker-influenced data. `unserialize` on untrusted input enables PHP object injection: magic methods such as `__destruct` and `__wakeup` in loaded classes form gadget chains that lead to file writes or remote code execution.

Hypothesise: the cookie was used for convenience to store preferences or state.

Verify: check which classes with dangerous magic methods are autoloadable (vendor libraries often supply gadgets); craft a harmless proof (an object whose `__destruct` logs) in a test.

Fix: replace cookie contents with `json_encode` plus a signature (`hash_hmac`) or store state server side keyed by session; parse with `json_decode` using associative arrays. If `unserialize` is unavoidable, pass `['allowed_classes' => false]`. Remove `eval`; replace dynamic code with data-driven logic, a strategy map, or a sandboxed expression library. Add a WAF rule as a stopgap and rotate any secrets the app may have exposed.

```php
$data = unserialize($raw, ['allowed_classes' => false]);
```

Prevent: code scanning rules banning `eval` and raw `unserialize`, and dependency audits (`composer audit`).

Wrong answers: base64-encoding the cookie, or relying on obscurity.

### Some requests fail with "Maximum execution time of 30 seconds exceeded". Should you increase the limit?
<!-- level: basic; kind: scenario; ref: https://www.php.net/manual/en/info.configuration.php#ini.max-execution-time -->
Observe: the error occurs on specific endpoints (exports, imports, external calls) and not on others.

Hypothesise: the work legitimately takes longer than the limit, or it is stuck on something: a slow query, lock waiting, or a remote call.

Verify: check where it stopped via the error line and slow log; measure phases with timers; note that on Linux `max_execution_time` counts only CPU time spent executing PHP, not time blocked in database or network calls, so timeouts caused by I/O usually come from other limits (FPM `request_terminate_timeout`, proxy timeouts).

Fix: depends on the cause. For stuck I/O, add explicit timeouts and fix the slow dependency. For heavy legitimate work, move it to a queue or CLI where the limit is zero by default, process in chunks, and report progress. Raising the limit is justified only for a narrowly scoped internal admin endpoint, set with `set_time_limit()` locally rather than globally.

```php
set_time_limit(120); // only for this admin-only export
```

Prevent: keep web request budgets short, and alert on p95 latency.

Wrong answers: setting the global limit to 0 or 3600 for all requests, which lets runaway scripts exhaust workers.
