## 1. How PHP Runs

### The PHP request lifecycle
<!-- level: basic; ref: https://www.php.net/manual/en/install.fpm.php -->
PHP is an interpreted language built for the web with a "shared-nothing" execution model. For each HTTP request, a web server (Nginx, Apache, Caddy) hands the request to PHP through a SAPI (Server API), most commonly PHP-FPM (FastCGI Process Manager). FPM keeps a pool of worker processes; one worker runs your script from the top, builds a response, and then throws away all variables, objects and connections created during the request.

Under the hood, the Zend Engine compiles each script into opcodes (bytecode) and executes them. Without OPcache this compilation happens on every request; with OPcache the compiled opcodes are cached in shared memory.

```nginx
location ~ \.php$ {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass unix:/run/php/php8.4-fpm.sock;
}
```

Why it matters: the shared-nothing model makes PHP easy to scale horizontally and very robust (a memory leak or crash affects only one request), but it means every request re-bootstraps the framework, so OPcache, preloading and caching are essential for performance.

Other runtimes exist: the CLI SAPI for scripts and workers, and long-running application servers (FrankenPHP worker mode, RoadRunner, Swoole, Laravel Octane) that boot the app once and serve many requests, trading simplicity for speed.

- Pitfall: in long-running workers, static state and global variables persist between requests, a common source of data leaks between users.

### Basic syntax, tags and output
<!-- level: basic; ref: https://www.php.net/manual/en/language.basic-syntax.php -->
PHP code lives between `<?php` and `?>` tags; everything outside the tags is sent to the output as-is. That made PHP a templating language from day one. Statements end with semicolons, variables start with `$`, and comments use `//`, `#` or `/* */`.

`echo` outputs one or more strings; `print` is similar but returns 1. The short echo tag `<?= $x ?>` is always available and is handy in templates.

```php
<?php
declare(strict_types=1);

$user = 'Ana';
$items = ['tea', 'cake'];
?>
<h1>Hello, <?= htmlspecialchars($user) ?></h1>
<ul>
<?php foreach ($items as $item): ?>
    <li><?= htmlspecialchars($item) ?></li>
<?php endforeach; ?>
</ul>
```

The alternative syntax (`foreach (...):` / `endforeach;`) is designed for mixing with HTML.

Best practice for files that contain only PHP (classes, configuration) is to omit the closing `?>` entirely, because any whitespace after it gets sent as output and can cause "headers already sent" errors.

- Pitfall: always escape dynamic values in HTML output to prevent XSS. Modern template engines (Blade, Twig) escape by default.
- Tip: run a file from the command line with `php script.php`, or start a dev server with `php -S localhost:8000 -t public`.

### Variables, scope and references
<!-- level: basic; ref: https://www.php.net/manual/en/language.variables.scope.php -->
Variables are dynamically typed and created on assignment. PHP's scoping is simpler (and stricter) than many languages: a function cannot see variables from the outer scope unless they are passed in, imported with `global` (avoid), or captured by a closure with `use`. Static variables inside a function keep their value between calls.

Values are assigned by copy, but arrays use copy-on-write: copying is cheap until one copy is modified. Objects are handles, so assigning an object variable copies the handle and both variables refer to the same object. A reference (`&`) makes two names point to the same variable.

```php
<?php
$rate = 0.2;

function withTax(float $amount): float {
    // echo $rate;  // Warning: undefined variable; outer scope is not visible
    return $amount * 1.2;
}

function nextId(): int {
    static $id = 0;    // persists across calls within the request
    return ++$id;
}

$a = ['x' => 1];
$b = $a;          // copy-on-write: no real copy yet
$b['x'] = 2;      // now copied; $a unchanged

$o1 = new stdClass();
$o2 = $o1;        // same object
$o2->name = 'shared';
echo $o1->name;   // shared
```

- Pitfall: `global` and `$GLOBALS` create hidden dependencies and make testing hard; pass values explicitly.
- Pitfall: references are rarely needed and can produce surprising behaviour (see the foreach reference pitfall).

### Strings and interpolation
<!-- level: basic; ref: https://www.php.net/manual/en/language.types.string.php -->
PHP strings are byte arrays, not Unicode character sequences. Single-quoted strings are literal (only `\'` and `\\` are escapes). Double-quoted strings interpolate variables and understand escapes like `\n`. Heredoc (`<<<EOT`) behaves like double quotes for multi-line text; nowdoc (`<<<'EOT'`) is the literal version. Since PHP 7.3, the closing marker can be indented.

Concatenation uses `.` and `.=`. `sprintf` and `printf` format values.

```php
<?php
$name = 'Ana';
$order = ['id' => 42, 'total' => 19.5];

echo 'Hi $name\n';                       // literal: Hi $name\n
echo "Hi $name\n";                       // Hi Ana
echo "Order {$order['id']} costs {$order['total']}\n";
echo sprintf("%s owes %.2f EUR\n", $name, $order['total']);

$sql = <<<SQL
    SELECT id, email
    FROM users
    WHERE active = 1
    SQL;

echo strlen('café');        // 5 bytes
echo mb_strlen('café');     // 4 characters (mbstring extension)
echo str_contains($sql, 'users') ? 'yes' : 'no';   // PHP 8.0
```

PHP 8.0 added `str_contains`, `str_starts_with` and `str_ends_with`. For multibyte text (UTF-8), use the `mb_*` functions; PHP 8.4 added `mb_trim`, `mb_ucfirst` and friends.

- Pitfall: `strlen`, `substr` and `strtoupper` operate on bytes and can break UTF-8 characters.
- Pitfall: never build SQL or HTML by interpolating user input.

### Control flow essentials
<!-- level: basic; ref: https://www.php.net/manual/en/language.control-structures.php -->
PHP has the familiar control structures: `if`/`elseif`/`else`, `while`, `do-while`, `for`, `foreach`, `switch`, `break`, `continue`, plus `match` (PHP 8.0) as an expression-based alternative to `switch`.

`foreach` is the workhorse for arrays and any `Traversable` object (including generators). `break 2` exits two nested loops. `switch` uses loose comparison (`==`) and falls through without `break`, which is why `match` is usually preferred for value mapping.

```php
<?php
$orders = [
    ['id' => 1, 'status' => 'paid',    'total' => 30],
    ['id' => 2, 'status' => 'pending', 'total' => 15],
];

$revenue = 0;
foreach ($orders as $index => $order) {
    if ($order['status'] !== 'paid') {
        continue;
    }
    $revenue += $order['total'];
}

$label = match (true) {
    $revenue >= 1000 => 'great',
    $revenue >= 100  => 'ok',
    default          => 'low',
};

for ($i = 0, $n = count($orders); $i < $n; $i++) {
    // cache count() instead of calling it each iteration
}
```

- Pitfall: `switch ('0') { case false: ... }` matches because of loose comparison; `match` uses strict `===`.
- Tip: prefer early `return`/`continue` (guard clauses) over deep nesting.

## 2. Types and Type Safety

### The type system and type juggling
<!-- level: basic; ref: https://www.php.net/manual/en/language.types.type-juggling.php -->
PHP has scalar types (`bool`, `int`, `float`, `string`), compound types (`array`, `object`, `callable`, `iterable`), and special types (`null`, `resource`, `never`, `void`, `mixed`). Variables are dynamically typed, and in many contexts PHP converts values automatically: type juggling.

Arithmetic converts numeric strings to numbers, concatenation converts numbers to strings, and conditions convert values to booleans. Falsy values are `false`, `0`, `0.0`, `""`, `"0"`, `[]` and `null`.

PHP 8.0 made juggling less dangerous: non-numeric strings in arithmetic throw a `TypeError`, and comparisons between numbers and non-numeric strings compare as strings (previously `0 == "abc"` was true).

```php
<?php
var_dump("10" + 5);        // int(15)
var_dump("1.5" + 1);       // float(2.5)
var_dump(10 . "");         // string(2) "10"
var_dump((bool) "0");      // false (surprising)
var_dump((bool) "0.0");    // true
var_dump((int) "12abc");   // int(12) with explicit cast
// "abc" * 2;              // TypeError in PHP 8

var_dump(0 == "abc");      // false in PHP 8, true in PHP 7
var_dump(PHP_INT_MAX + 1); // float: integers overflow to float
```

Use `gettype()`, `get_debug_type()` (PHP 8) or `var_dump()` to inspect types.

- Pitfall: `"0"` being falsy breaks checks like `if ($input)` for a field where "0" is a valid value; use `!== ''` or `isset`.
- Interview tip: explain that integer overflow silently produces a float.

### Loose vs strict comparison
<!-- level: basic; ref: https://www.php.net/manual/en/language.operators.comparison.php -->
`==` compares after type juggling; `===` compares type and value with no conversion. Similarly `!=` vs `!==`. Loose comparison has a famous table of surprises, so modern PHP style uses strict comparison by default.

Functions that search arrays also take a strict flag: `in_array($x, $arr, true)` and `array_search($x, $arr, true)`. Without it they use `==`.

The spaceship operator `<=>` returns -1, 0 or 1 and is ideal for sorting callbacks.

```php
<?php
var_dump("1e3" == "1000");     // true: both numeric strings
var_dump("abc" == 0);          // false (PHP 8)
var_dump(null == false);       // true
var_dump([] == false);         // true
var_dump("1" === 1);           // false

$roles = ['0', 'admin'];
var_dump(in_array(0, $roles));        // true: 0 == "0"
var_dump(in_array(0, $roles, true));  // false

usort($users, fn($a, $b) => $a['age'] <=> $b['age']);

// strpos returns 0 for a match at the start, which is falsy
if (strpos($path, '/api') !== false) { /* correct check */ }
```

- Pitfall: `if (strpos(...))` misses matches at position 0; use `str_contains` in PHP 8.
- Pitfall: comparing hashes with `==` once allowed "magic hash" bypasses (`"0e123" == "0e456"` is true because both are numeric). Use `hash_equals()` for secrets.
- Interview tip: always answer "use `===` unless you explicitly need juggling".

### Type declarations and strict_types
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.types.declarations.php -->
Functions, methods and properties can declare types. PHP checks them at runtime and throws `TypeError` on mismatch. The type system has grown steadily:

- PHP 7.0: scalar parameter and return types. 7.1: nullable `?int`, `void`. 7.4: typed properties.
- PHP 8.0: union types `int|string`, `mixed`, `static` return type. 8.1: intersection types `A&B`, `never`. 8.2: DNF types `(A&B)|null`, standalone `true`, `false` and `null`. 8.3: typed class constants.

By default PHP coerces scalar arguments (passing `"5"` to an `int` parameter works). Adding `declare(strict_types=1);` at the top of a file makes calls made from that file strict: only exact types (plus int-to-float widening) are accepted.

```php
<?php
declare(strict_types=1);

function applyDiscount(float $price, int $percent): float {
    return $price * (100 - $percent) / 100;
}

applyDiscount(100, 15);       // ok: int widened to float
// applyDiscount(100, "15");  // TypeError under strict_types

function findUser(int|string $id): ?User { /* ... */ }

function fail(string $msg): never {
    throw new RuntimeException($msg);
}

class Cart {
    private array $items = [];
    public ?Coupon $coupon = null;
}
```

- Pitfall: `strict_types` affects calls made from the file that declares it, not the callee's file.
- Pitfall: an uninitialised typed property throws "must not be accessed before initialization"; give defaults or set in the constructor.
- Tip: combine runtime types with PHPStan/Psalm generics in docblocks (`@param list<User>`).

### Working with null safely
<!-- level: basic; ref: https://www.php.net/manual/en/language.operators.comparison.php#language.operators.comparison.coalesce -->
Missing values are everywhere in web code: optional form fields, absent array keys, nullable relationships. PHP has dedicated operators:

- Null coalescing `??` (PHP 7.0): returns the left side if it exists and is not null, otherwise the right side. It does not emit warnings for undefined keys or variables.
- Null coalescing assignment `??=` (PHP 7.4): assigns only if the left side is null or unset.
- Nullsafe operator `?->` (PHP 8.0): short-circuits the whole chain to null if an object in the chain is null.
- `isset()` returns false for null or undefined; `empty()` is true for any falsy value.

```php
<?php
$page  = (int) ($_GET['page'] ?? 1);
$sort  = $_GET['sort'] ?? 'created_at';

$config['timeout'] ??= 30;

$country = $order?->getCustomer()?->getAddress()?->country ?? 'unknown';

if (isset($payload['email'], $payload['name'])) {
    // both present and not null
}
```

Compare with the ternary shortcut `?:` (Elvis), which falls back on any falsy value, so `$qty ?: 1` turns a legitimate `0` into 1.

- Pitfall: `empty('0')` is true, which may wrongly reject a valid "0" input.
- Pitfall: the nullsafe operator cannot be used for writing (`$a?->b = 1` is invalid).
- Interview tip: contrast `??` (null/unset only) with `?:` (any falsy value).

## 3. Arrays

### Arrays as ordered maps
<!-- level: basic; ref: https://www.php.net/manual/en/language.types.array.php -->
A PHP array is an ordered hash map: keys are integers or strings, values are anything, and insertion order is preserved. The same type serves as a list, dictionary, set, stack and queue. Under the hood (since PHP 7), arrays are a compact hash table; "packed" arrays with sequential integer keys use an optimised layout without hashing.

Keys are normalised: numeric strings like `"8"` become integer 8, floats are truncated, booleans become 0/1, and `null` becomes `""`.

```php
<?php
$list = ['red', 'green', 'blue'];           // keys 0, 1, 2
$user = ['id' => 7, 'name' => 'Ana', 'roles' => ['admin']];

$list[] = 'yellow';                         // append
$user['email'] = 'ana@example.com';
unset($list[1]);                            // keys now 0, 2, 3 (holes!)
$list = array_values($list);                // reindex: 0, 1, 2

var_dump(array_is_list($list));             // true (PHP 8.1)
var_dump(array_key_exists('email', $user)); // true even if value is null
var_dump(count($user));

$matrix = [[1, 2], [3, 4]];
echo $matrix[1][0];                         // 3

$set = ['php' => true, 'go' => true];       // array as a set
if (isset($set['php'])) { /* O(1) lookup */ }
```

- Pitfall: `in_array` on a large list is O(n); flip it to keys (`array_flip`) for repeated lookups.
- Pitfall: `isset($arr['k'])` is false when the value is `null`; use `array_key_exists` when null is meaningful.
- Pitfall: `["1" => 'a', 1 => 'b']` has one element because the keys collide.

### Functional array operations
<!-- level: intermediate; ref: https://www.php.net/manual/en/ref.array.php -->
PHP's standard library has dozens of array functions. The most important for data processing are `array_map`, `array_filter`, `array_reduce`, `array_column`, `array_combine`, `array_merge`, `array_keys`, `array_slice` and `array_unique`. PHP 8.4 adds `array_find`, `array_find_key`, `array_any` and `array_all`.

Watch the argument order: `array_map($callback, $array)` but `array_filter($array, $callback)`. `array_filter` preserves keys, which can leave gaps.

```php
<?php
$orders = [
    ['id' => 1, 'customer' => 'ana', 'total' => 120.0, 'paid' => true],
    ['id' => 2, 'customer' => 'bo',  'total' => 40.0,  'paid' => false],
    ['id' => 3, 'customer' => 'ana', 'total' => 60.0,  'paid' => true],
];

$paid    = array_filter($orders, fn($o) => $o['paid']);
$totals  = array_map(fn($o) => $o['total'], $paid);
$revenue = array_sum($totals);                      // 180

$byId = array_column($orders, null, 'id');          // index rows by id
$names = array_unique(array_column($orders, 'customer'));

$perCustomer = array_reduce($orders, function (array $acc, array $o) {
    $acc[$o['customer']] = ($acc[$o['customer']] ?? 0) + $o['total'];
    return $acc;
}, []);

$firstUnpaid = array_find($orders, fn($o) => !$o['paid']);   // PHP 8.4
```

- Pitfall: `array_merge` renumbers integer keys, while `+` keeps the left side's keys and ignores duplicates.
- Pitfall: chaining many array functions over huge datasets creates intermediate copies; use generators or a loop for streaming.
- Tip: collection libraries (Laravel Collections) wrap these with a fluent API.

### Sorting arrays
<!-- level: intermediate; ref: https://www.php.net/manual/en/array.sorting.php -->
PHP has many sort functions, distinguished by what they sort by, whether keys are preserved, and order:

- `sort` / `rsort`: by value, reindexes keys.
- `asort` / `arsort`: by value, preserves key-value association.
- `ksort` / `krsort`: by key.
- `usort`, `uasort`, `uksort`: with a user comparison callback.

All sort in place and return `true`. Since PHP 8.0, sorting is stable: equal elements keep their original order, which makes multi-pass sorting reliable.

```php
<?php
$products = [
    ['name' => 'Desk',  'price' => 250, 'stock' => 3],
    ['name' => 'Chair', 'price' => 90,  'stock' => 0],
    ['name' => 'Lamp',  'price' => 90,  'stock' => 12],
];

// Sort by price ascending, then name
usort($products, fn($a, $b) =>
    [$a['price'], $a['name']] <=> [$b['price'], $b['name']]
);

$scores = ['ana' => 82, 'bo' => 95, 'cy' => 70];
arsort($scores);                    // ['bo' => 95, 'ana' => 82, 'cy' => 70]

$files = ['img12.png', 'img10.png', 'img2.png'];
natsort($files);                    // natural order: img2, img10, img12

sort($names, SORT_STRING | SORT_FLAG_CASE);   // case-insensitive
```

Comparing arrays with `<=>` compares element by element, which is a neat trick for multi-key sorting.

- Pitfall: `sort` on an associative array throws away the keys; use `asort`.
- Pitfall: sorting functions do not return the sorted array, so `$sorted = sort($a);` gives `true`.

### Destructuring, spread and references in loops
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.types.array.php#language.types.array.syntax.destructuring -->
Array destructuring (`[$a, $b] = $arr`, PHP 7.1) unpacks values into variables, including by key and in `foreach`. The spread operator `...` unpacks arrays into other arrays or function arguments; since PHP 8.1 it also works with string keys.

Foreach by reference (`foreach ($arr as &$v)`) lets you modify elements in place, but has a notorious trap: the reference variable stays bound to the last element after the loop.

```php
<?php
[$lat, $lng] = [52.52, 13.40];
['id' => $id, 'email' => $email] = $user;

foreach ($rows as ['id' => $id, 'total' => $total]) {
    echo "$id: $total\n";
}

[$a, $b] = [$b, $a];                      // swap

$defaults = ['timeout' => 30, 'retries' => 3];
$options  = [...$defaults, ...$overrides];     // PHP 8.1: later keys win

function sumAll(int ...$nums): int { return array_sum($nums); }
sumAll(...[1, 2, 3]);

// The reference trap
$prices = [10, 20, 30];
foreach ($prices as &$p) { $p *= 2; }
foreach ($prices as $p) {}       // overwrites $prices[2] on each iteration
print_r($prices);                // [20, 40, 40]  oops
unset($p);                       // always unset after a by-ref loop
```

- Tip: prefer `array_map` or building a new array over by-reference loops.
- Pitfall: destructuring a missing key produces a warning and null.
