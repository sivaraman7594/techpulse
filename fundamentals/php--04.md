## 9. PHP on the Web

### Superglobals and handling requests
<!-- level: basic; ref: https://www.php.net/manual/en/language.variables.superglobals.php -->
PHP exposes request data through superglobal arrays available in every scope:

- `$_GET`: query string parameters.
- `$_POST`: form fields from `application/x-www-form-urlencoded` or `multipart/form-data` bodies.
- `$_FILES`: uploaded files.
- `$_COOKIE`, `$_SESSION`: cookies and session data.
- `$_SERVER`: request metadata (method, URI, headers as `HTTP_*`, remote address).
- `$_ENV`: environment variables (depending on `variables_order`).

JSON bodies are not parsed into `$_POST`; read the raw body from `php://input`. Since PHP 8.4, `request_parse_body()` can parse form bodies for methods like PUT and PATCH.

```php
<?php
declare(strict_types=1);

$method = $_SERVER['REQUEST_METHOD'];
$path   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($method === 'POST' && $path === '/api/orders') {
    $payload = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
    $qty = filter_var($payload['qty'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($qty === false) {
        http_response_code(422);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'qty must be a positive integer']);
        exit;
    }
    // ...
}
```

Frameworks wrap this in request objects (Symfony `Request`, PSR-7 `ServerRequestInterface`), which are easier to test.

- Pitfall: every superglobal value is attacker-controlled, including headers and `$_SERVER['HTTP_HOST']`; validate everything.
- Pitfall: `$_REQUEST` merges GET, POST and cookies in configurable order; avoid it.
- Pitfall: `REMOTE_ADDR` is the proxy's IP behind a load balancer; trust `X-Forwarded-For` only from known proxies.

### Headers, status codes and output buffering
<!-- level: basic; ref: https://www.php.net/manual/en/function.header.php -->
HTTP headers must be sent before any body output. Once PHP has flushed output (even a single space or a BOM before `<?php`), calling `header()` fails with the warning "Cannot modify header information - headers already sent". Output buffering (`ob_start()`, often on by default via `output_buffering`) collects output in memory, which hides the problem until the buffer fills.

Key functions: `header()`, `http_response_code()`, `setcookie()`, `headers_sent()`, and `header_remove()`.

```php
<?php
function redirect(string $url, int $status = 303): never
{
    header('Location: ' . $url, true, $status);
    exit;                                     // stop script: code after redirect must not run
}

function jsonResponse(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_THROW_ON_ERROR);
    exit;
}

if (!$user->isAdmin()) {
    redirect('/login');
}

// Security headers (often set at the web server instead)
header("Content-Security-Policy: default-src 'self'");
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
```

Use 303 See Other after a POST (Post/Redirect/Get pattern) so refreshing the page does not resubmit the form.

- Pitfall: forgetting `exit` after a redirect lets the rest of the script run, sometimes performing privileged actions.
- Pitfall: never put user input directly into a `Location` header without validating it (open redirect).

### Sessions and cookies
<!-- level: intermediate; ref: https://www.php.net/manual/en/features.session.security.management.php -->
HTTP is stateless. PHP sessions store per-user data on the server (files by default; Redis or a database in multi-server setups) and identify the user with a random session id in a cookie (`PHPSESSID`). `session_start()` reads the cookie, loads the data into `$_SESSION`, and locks the session until the request ends or `session_write_close()` is called.

Secure configuration matters, because the session id is effectively a password:

- `session.cookie_httponly = 1`: JavaScript cannot read the cookie (limits XSS theft).
- `session.cookie_secure = 1`: only sent over HTTPS.
- `session.cookie_samesite = Lax` (or `Strict`): limits cross-site requests carrying the cookie (CSRF defence).
- `session.use_strict_mode = 1`: reject uninitialised session ids (prevents fixation).
- Regenerate the id on login and privilege changes.

```php
<?php
session_start([
    'cookie_httponly' => true,
    'cookie_secure'   => true,
    'cookie_samesite' => 'Lax',
    'use_strict_mode' => true,
]);

function login(User $user): void
{
    session_regenerate_id(true);       // new id, delete old session data
    $_SESSION['user_id'] = $user->id;
    $_SESSION['login_at'] = time();
}

function logout(): void
{
    $_SESSION = [];
    session_destroy();
    setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
}
```

- Pitfall: session locking serialises concurrent requests from the same user (AJAX calls wait for each other); call `session_write_close()` early in long requests.
- Pitfall: file-based sessions do not work across multiple servers without sticky sessions; use Redis.

### Validating and sanitising input
<!-- level: intermediate; ref: https://www.php.net/manual/en/book.filter.php -->
Validation decides whether input is acceptable; escaping makes data safe for a particular output context. Do both, at the right places: validate at the boundary when data enters, escape at the point of output (HTML, SQL, shell, URLs).

Validation principles:

- Allow-list rather than block-list: define what is valid (types, ranges, formats, enum values).
- Validate on the server even if the browser also validates.
- Normalise before validating (trim, Unicode normalisation) and reject rather than "fix" suspicious input.

PHP's filter extension provides `filter_var` with validators for ints, floats, emails, URLs, IPs and booleans. Frameworks provide declarative validation (Laravel `$request->validate()`, Symfony Validator).

```php
<?php
function validateSignup(array $in): array
{
    $errors = [];
    $email = filter_var(trim($in['email'] ?? ''), FILTER_VALIDATE_EMAIL);
    if ($email === false) $errors['email'] = 'Invalid email';

    $age = filter_var($in['age'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 13, 'max_range' => 130]]);
    if ($age === false) $errors['age'] = 'Age must be 13-130';

    $plan = Plan::tryFrom($in['plan'] ?? '');          // enum allow-list
    if ($plan === null) $errors['plan'] = 'Unknown plan';

    if ($errors) throw new ValidationException($errors);
    return compact('email', 'age', 'plan');
}

// Laravel equivalent
$data = $request->validate([
    'email' => ['required', 'email:rfc', 'unique:users'],
    'age'   => ['required', 'integer', 'between:13,130'],
]);
```

- Pitfall: `FILTER_SANITIZE_STRING` was deprecated in 8.1; "sanitising" input is not a substitute for output escaping.
- Pitfall: `FILTER_VALIDATE_URL` accepts `javascript:` style schemes in some forms; check the scheme explicitly.

## 10. Security

### Cross-site scripting (XSS) and output escaping
<!-- level: intermediate; ref: https://www.php.net/manual/en/function.htmlspecialchars.php -->
XSS happens when attacker-controlled data is rendered into a page as code. The injected script runs with the victim's session: it can steal data, perform actions, or rewrite the page. Types: stored (saved in the database, shown to others), reflected (from the URL), and DOM-based (client-side JavaScript).

The defence is context-aware output escaping. In HTML element content and quoted attributes, use `htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')` (the flags are the defaults since PHP 8.1). Other contexts need different encoding: `json_encode` with `JSON_HEX_*` flags for data inside `<script>`, `rawurlencode` for URL parameters, and URL scheme validation for `href` values.

```php
<?php
function e(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
?>
<p>Welcome, <?= e($user->name) ?></p>
<input name="q" value="<?= e($query) ?>">
<a href="/search?q=<?= rawurlencode($query) ?>">again</a>
<script>
    const config = <?= json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
</script>
```

Template engines like Blade (`{{ $x }}`) and Twig escape by default; raw output (`{!! $x !!}`, `|raw`) should be rare and reviewed.

Defence in depth: a Content-Security-Policy that disallows inline scripts, `HttpOnly` cookies, and sanitising user-supplied HTML with a library like HTML Purifier (or Symfony HtmlSanitizer) when rich text is required.

- Pitfall: escaping on input (storing escaped data) leads to double escaping and still misses other contexts.
- Pitfall: `strip_tags` is not an XSS defence.

### SQL injection
<!-- level: intermediate; ref: https://www.php.net/manual/en/security.database.sql-injection.php -->
SQL injection occurs when user input is concatenated into an SQL string, letting an attacker change the query's structure: bypassing logins, dumping tables, or modifying data. It remains one of the most damaging web vulnerabilities.

The fix is prepared statements with bound parameters. The query structure is sent separately from the data, so input can never be interpreted as SQL. Escaping functions are error-prone and should not be the primary defence.

Identifiers (column names, sort direction, table names) cannot be bound as parameters. Use an allow-list for them.

```php
<?php
// Vulnerable: email = "' OR '1'='1"
$sql = "SELECT * FROM users WHERE email = '{$_POST['email']}'";

// Safe
$stmt = $pdo->prepare('SELECT id, password_hash FROM users WHERE email = :email');
$stmt->execute(['email' => $_POST['email']]);
$user = $stmt->fetch();

// Dynamic ORDER BY: allow-list, never interpolate raw input
$allowed = ['created_at', 'total', 'status'];
$sort = in_array($_GET['sort'] ?? '', $allowed, true) ? $_GET['sort'] : 'created_at';
$dir  = ($_GET['dir'] ?? '') === 'asc' ? 'ASC' : 'DESC';
$stmt = $pdo->prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY $sort $dir LIMIT 50");
$stmt->execute([$userId]);

// IN (...) lists: generate placeholders
$ids = [3, 7, 9];
$in  = implode(',', array_fill(0, count($ids), '?'));
$stmt = $pdo->prepare("SELECT * FROM products WHERE id IN ($in)");
$stmt->execute($ids);
```

ORMs and query builders (Eloquent, Doctrine) parameterise automatically, but raw methods (`DB::raw`, `whereRaw`) reintroduce the risk.

- Pitfall: second-order injection: data stored safely and later concatenated into another query.
- Tip: use least-privilege database accounts so a breach cannot drop tables.

### Cross-site request forgery (CSRF)
<!-- level: intermediate; ref: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html -->
CSRF tricks a logged-in user's browser into sending a state-changing request to your site from another site, for example a hidden form that posts to `/account/email`. Because the browser automatically attaches the session cookie, the request looks legitimate.

Defences:

1. Synchroniser token: generate a random token per session, embed it in every form, and verify it on every state-changing request using a constant-time comparison.
2. `SameSite` cookies: `Lax` (now the default in most browsers) blocks cookies on cross-site POSTs; `Strict` blocks them on all cross-site requests. A strong layer, but not a complete defence on its own.
3. Never change state with GET requests.
4. For APIs using bearer tokens in headers (not cookies), CSRF does not apply in the same way, but CORS configuration must be strict.

```php
<?php
function csrfToken(): string
{
    return $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
}

function verifyCsrf(): void
{
    $sent = $_POST['_csrf'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($sent) || !hash_equals(csrfToken(), $sent)) {
        http_response_code(419);
        exit('Invalid CSRF token');
    }
}
?>
<form method="post" action="/account/email">
    <input type="hidden" name="_csrf" value="<?= e(csrfToken()) ?>">
    <input name="email" type="email">
    <button>Save</button>
</form>
```

Laravel's `@csrf` directive and `VerifyCsrfToken` middleware, and Symfony's form CSRF protection, implement this for you.

- Pitfall: XSS defeats CSRF tokens, since injected script can read them.

### Password hashing
<!-- level: basic; ref: https://www.php.net/manual/en/function.password-hash.php -->
Passwords must never be stored in plain text or with fast hashes like MD5 or SHA-256, which GPUs can brute-force at billions of guesses per second. Use a deliberately slow, salted password hashing algorithm.

PHP's password API does this correctly:

- `password_hash($password, PASSWORD_DEFAULT)` generates a random salt and returns a self-describing string containing algorithm, cost, salt and hash. `PASSWORD_DEFAULT` is currently bcrypt; `PASSWORD_ARGON2ID` is available when PHP is built with Argon2 support.
- `password_verify($password, $hash)` checks a password in constant time.
- `password_needs_rehash($hash, ...)` tells you when to upgrade a hash after changing algorithm or cost.

```php
<?php
// Registration
$hash = password_hash($plainPassword, PASSWORD_DEFAULT);
$pdo->prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')->execute([$email, $hash]);

// Login
$user = findUserByEmail($email);
if ($user === null || !password_verify($plainPassword, $user->passwordHash)) {
    throw new InvalidCredentials();          // same message for unknown user and wrong password
}

if (password_needs_rehash($user->passwordHash, PASSWORD_DEFAULT, ['cost' => 12])) {
    $newHash = password_hash($plainPassword, PASSWORD_DEFAULT, ['cost' => 12]);
    updatePasswordHash($user->id, $newHash);
}
```

Store the hash in a column of at least 255 characters to accommodate future algorithms.

- Pitfall: bcrypt silently truncates passwords at 72 bytes, and since PHP 8.4 the default bcrypt cost is 12.
- Pitfall: combine hashing with rate limiting and account lockout or CAPTCHA to stop online guessing; consider MFA.

### File uploads and path traversal
<!-- level: intermediate; ref: https://www.php.net/manual/en/features.file-upload.php -->
File uploads are a classic route to remote code execution. If an attacker uploads `shell.php` into a web-accessible directory where PHP executes, they own the server. Path traversal (`../../etc/passwd`) in file names or download parameters exposes or overwrites arbitrary files.

Safe upload handling:

1. Check `$_FILES['f']['error']` and enforce size limits (also `upload_max_filesize`, `post_max_size`).
2. Determine the type from the content (`finfo`), not from the client-provided MIME type or extension; allow-list types.
3. Generate your own random file name and extension; never use the original name for the path.
4. Store outside the web root (or in object storage like S3) and serve via a controller or signed URL.
5. Use `move_uploaded_file()`, which verifies the file came from an upload.
6. Ensure the storage directory cannot execute scripts.

```php
<?php
$file = $_FILES['avatar'] ?? null;
if (!$file || $file['error'] !== UPLOAD_ERR_OK || $file['size'] > 2_000_000) {
    throw new UploadException('Invalid upload');
}

$mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
$ext = match ($mime) {
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/webp' => 'webp',
    default      => throw new UploadException('Unsupported type'),
};

$name = bin2hex(random_bytes(16)) . '.' . $ext;
move_uploaded_file($file['tmp_name'], '/srv/uploads/avatars/' . $name);

// Downloads: resolve and confirm the path stays inside the base directory
$base = realpath('/srv/uploads');
$path = realpath($base . '/' . $_GET['file']);
if ($path === false || !str_starts_with($path, $base . DIRECTORY_SEPARATOR)) {
    http_response_code(404); exit;
}
```

- Pitfall: re-encoding images (GD/Imagick) strips embedded payloads, but image libraries themselves have had vulnerabilities; keep them patched.

### Insecure deserialisation and other injection risks
<!-- level: advanced; ref: https://www.php.net/manual/en/function.unserialize.php -->
Some PHP functions turn attacker-controlled strings into code execution:

- `unserialize()` on untrusted input can instantiate arbitrary classes, triggering magic methods (`__wakeup`, `__destruct`) in your code or dependencies. Chains of such "gadgets" lead to remote code execution (PHP object injection). Use JSON for untrusted data, or pass `['allowed_classes' => false]`.
- `eval`, `assert` with strings (removed in PHP 8), `create_function` (removed), and `preg_replace` with the `/e` modifier (removed) execute code.
- Shell commands: `exec`, `shell_exec`, `system`, `passthru`, backticks. If unavoidable, escape every argument with `escapeshellarg`, or better, use `proc_open` with an argument array (PHP 7.4+), which bypasses the shell.
- `include`/`require` with user-controlled paths (local or remote file inclusion).
- Server-side request forgery (SSRF): fetching user-supplied URLs lets attackers reach internal services and cloud metadata endpoints.

```php
<?php
// Dangerous
$cart = unserialize($_COOKIE['cart']);

// Safer
$cart = json_decode($_COOKIE['cart'] ?? '[]', true, 16, JSON_THROW_ON_ERROR);

// Shell: no shell parsing at all
$proc = proc_open(['convert', $inputPath, '-resize', '200x200', $outputPath], [], $pipes);

// SSRF: allow-list hosts before fetching
$host = parse_url($url, PHP_URL_HOST);
if (!in_array($host, ['images.partner.com', 'cdn.partner.com'], true)) {
    throw new DomainException('Host not allowed');
}
```

- Tip: disable dangerous functions in `php.ini` (`disable_functions`) on hosts that do not need them.
- Tip: run `composer audit` regularly; many real-world PHP compromises come from vulnerable dependencies.

## 11. Databases with PDO

### Connecting with PDO
<!-- level: basic; ref: https://www.php.net/manual/en/pdo.connections.php -->
PDO (PHP Data Objects) is a uniform database access layer supporting MySQL/MariaDB, PostgreSQL, SQLite, SQL Server and others through drivers. You create a connection from a DSN (data source name) string and credentials.

Recommended options:

- `PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION`: throw `PDOException` on errors (the default since PHP 8.0).
- `PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC`: return associative arrays.
- `PDO::ATTR_EMULATE_PREPARES => false`: use native prepared statements where supported (for MySQL), so types are preserved and parameters are always sent separately.
- Set the charset in the DSN (`utf8mb4` for MySQL) to avoid encoding bugs.

```php
<?php
function makePdo(): PDO
{
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        getenv('DB_HOST'), (int) getenv('DB_PORT'), getenv('DB_NAME'));

    return new PDO($dsn, getenv('DB_USER'), getenv('DB_PASSWORD'), [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
}

$pdo = makePdo();
$pg  = new PDO('pgsql:host=localhost;dbname=shop', 'app', $secret);
$lite = new PDO('sqlite:' . __DIR__ . '/data.sqlite');
```

PHP 8.4 added driver-specific subclasses (`Pdo\Mysql`, `Pdo\Pgsql`, `Pdo\Sqlite`) created with `PDO::connect()`, exposing driver-specific methods cleanly.

- Pitfall: an uncaught `PDOException` from the constructor may print the DSN and username in error output; never display errors in production.
- Pitfall: keep credentials in environment variables or a secret manager, not in the repository.
- Tip: persistent connections (`PDO::ATTR_PERSISTENT`) reduce connect cost but can leak session state between requests.

### Prepared statements and fetching
<!-- level: basic; ref: https://www.php.net/manual/en/pdo.prepared-statements.php -->
A prepared statement is parsed and planned by the database once, then executed with bound parameters, possibly many times. Parameters use positional `?` or named `:name` placeholders (do not mix them in one statement). Values passed to `execute()` are bound as strings unless you use `bindValue` with an explicit type.

Fetching options: `fetch()` returns one row (or `false`), `fetchAll()` returns all rows, `fetchColumn()` returns one value, and `FETCH_CLASS` hydrates objects. For large result sets, iterate row by row instead of `fetchAll()`; with MySQL also disable buffered queries to stream.

```php
<?php
$stmt = $pdo->prepare('SELECT id, email, created_at FROM users WHERE status = :status AND created_at >= :since');
$stmt->execute(['status' => 'active', 'since' => '2026-01-01']);

foreach ($stmt as $row) {                     // statement is Traversable
    sendNewsletter($row['email']);
}

$count = $pdo->prepare('SELECT COUNT(*) FROM orders WHERE user_id = ?');
$count->execute([$userId]);
$n = (int) $count->fetchColumn();

$stmt = $pdo->prepare('SELECT * FROM products LIMIT :limit OFFSET :offset');
$stmt->bindValue('limit', 20, PDO::PARAM_INT);
$stmt->bindValue('offset', 40, PDO::PARAM_INT);
$stmt->execute();
$products = $stmt->fetchAll(PDO::FETCH_CLASS, Product::class);

$insert = $pdo->prepare('INSERT INTO events (type, payload) VALUES (?, ?)');
foreach ($events as $e) {
    $insert->execute([$e->type, json_encode($e->payload)]);   // reuse the plan
}
$lastId = $pdo->lastInsertId();
```

- Pitfall: with emulated prepares, `LIMIT ?` bound as a string produces `LIMIT '20'`, a syntax error in MySQL; bind as `PARAM_INT`.
- Pitfall: `fetch()` returns `false`, not `null`, when there are no rows.

### Transactions
<!-- level: intermediate; ref: https://www.php.net/manual/en/pdo.transactions.php -->
A transaction groups several statements into an atomic unit: either all succeed (commit) or none take effect (rollback). Use transactions whenever a business operation touches multiple rows or tables that must stay consistent, such as moving money or creating an order with its line items and stock reservations.

PDO exposes `beginTransaction()`, `commit()`, `rollBack()` and `inTransaction()`. Always roll back on any exception, then rethrow.

Concurrency control matters too: two requests can read the same stock level and both decrement it. Use row locks (`SELECT ... FOR UPDATE`), atomic updates with conditions, or optimistic locking with a version column.

```php
<?php
function placeOrder(PDO $pdo, int $userId, int $productId, int $qty): int
{
    $pdo->beginTransaction();
    try {
        // Atomic conditional update prevents overselling
        // (a named placeholder may appear only once with native prepares, hence :qty and :min)
        $upd = $pdo->prepare('UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :min');
        $upd->execute(['qty' => $qty, 'id' => $productId, 'min' => $qty]);
        if ($upd->rowCount() === 0) {
            throw new OutOfStock($productId);
        }

        $pdo->prepare('INSERT INTO orders (user_id, product_id, qty) VALUES (?, ?, ?)')
            ->execute([$userId, $productId, $qty]);
        $orderId = (int) $pdo->lastInsertId();

        $pdo->commit();
        return $orderId;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}
```

Laravel offers `DB::transaction(fn() => ...)` with automatic retry on deadlocks.

- Pitfall: MySQL DDL statements (`ALTER TABLE`) cause an implicit commit; transactions cannot wrap schema changes there.
- Pitfall: do not call external APIs (payment, email) inside a database transaction; it holds locks during slow network calls. Use an outbox table instead.

### Avoiding N+1 queries and paginating efficiently
<!-- level: intermediate; ref: https://laravel.com/docs/eloquent-relationships#eager-loading -->
The N+1 problem is the most common database performance bug in PHP applications: one query loads a list, then a separate query runs for each item to load a related record. With 100 orders that is 101 queries, each paying network round-trip latency.

Fixes:

- Join, or load related rows in one query with `WHERE id IN (...)` and map them in PHP.
- With an ORM, use eager loading (`with()` in Eloquent, `JOIN FETCH` or `addSelect` in Doctrine).
- Detect the problem with query logging, Laravel Debugbar or Telescope, or `Model::preventLazyLoading()` in development.

For pagination, `OFFSET` gets slower as the offset grows because the database must scan and discard rows. Keyset (cursor) pagination uses `WHERE id > :lastId ORDER BY id LIMIT n`, which uses the index directly.

```php
<?php
// N+1 in Eloquent
$orders = Order::latest()->take(100)->get();
foreach ($orders as $order) {
    echo $order->customer->name;           // one query per order
}

// Eager loaded: 2 queries total
$orders = Order::with('customer')->latest()->take(100)->get();

// Plain PDO: batch load
$customerIds = array_unique(array_column($orders, 'customer_id'));
$in = implode(',', array_fill(0, count($customerIds), '?'));
$stmt = $pdo->prepare("SELECT id, name FROM customers WHERE id IN ($in)");
$stmt->execute(array_values($customerIds));
$customers = array_column($stmt->fetchAll(), null, 'id');

// Keyset pagination
$stmt = $pdo->prepare('SELECT * FROM orders WHERE id < :cursor ORDER BY id DESC LIMIT 50');
$stmt->execute(['cursor' => $lastSeenId]);
```

- Tip: Eloquent offers `cursorPaginate()` for keyset pagination.
- Pitfall: eager loading huge relationships can load too much; select only needed columns.
