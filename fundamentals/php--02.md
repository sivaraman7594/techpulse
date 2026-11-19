## 4. Functions

### Defining functions, defaults and named arguments
<!-- level: basic; ref: https://www.php.net/manual/en/functions.arguments.php -->
Functions are declared with `function`, can declare parameter and return types, and may have default values. Since PHP 8.0, named arguments let callers pass arguments by parameter name, skipping optional ones and making calls self-documenting. Named and positional arguments can be mixed, as long as positional ones come first.

Arguments are passed by value (objects by handle). Prefix a parameter with `&` to pass by reference, which is rarely needed.

```php
<?php
declare(strict_types=1);

function createUser(
    string $email,
    string $role = 'member',
    bool $sendWelcome = true,
    ?string $referrer = null,
): User {                                   // trailing comma allowed (PHP 8.0)
    // ...
}

createUser('ana@example.com');
createUser('bo@example.com', sendWelcome: false);        // skip $role
createUser(email: 'cy@example.com', referrer: 'ads');

// Built-ins support named args too
$json = json_encode($data, flags: JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
str_pad('7', 3, pad_type: STR_PAD_LEFT, pad_string: '0');   // "007"
```

Functions are global in their namespace and are hoisted (callable before their definition in the file) unless declared conditionally.

- Pitfall: with named arguments, parameter names become part of your public API; renaming a parameter breaks callers.
- Pitfall: optional parameters before required ones are deprecated (PHP 8.0).
- Tip: when a function has many boolean flags, named arguments greatly improve readability, but consider an options object or enum.

### Variadics and argument unpacking
<!-- level: basic; ref: https://www.php.net/manual/en/functions.arguments.php#functions.variable-arg-list -->
A variadic parameter (`...$args`) collects any number of remaining arguments into an array. It must be the last parameter and can be typed, in which case every element is checked. The same `...` operator unpacks an array or Traversable into separate arguments at a call site. With string keys (PHP 8.1), unpacking maps to named arguments.

```php
<?php
function logMessage(string $level, string $message, string ...$tags): void {
    $tagList = $tags ? ' [' . implode(', ', $tags) . ']' : '';
    error_log(strtoupper($level) . ": $message$tagList");
}

logMessage('info', 'User logged in');
logMessage('warn', 'Slow query', 'db', 'orders');

$args = ['error', 'Payment failed', 'payments'];
logMessage(...$args);

function connect(string $host, int $port = 5432, string $db = 'app'): PDO { /* ... */ }
$config = ['host' => 'db.local', 'db' => 'shop'];
connect(...$config);           // named unpacking, PHP 8.1

function maxOf(int|float ...$nums): int|float {
    return $nums ? max($nums) : throw new ValueError('need at least one number');
}
```

Older code used `func_get_args()`; variadics are clearer and type-checked.

- Pitfall: unpacking a very large array into function arguments copies it onto the VM stack; pass the array itself for big data.
- Tip: `throw` is an expression since PHP 8.0, usable in ternaries, `??` and arrow functions.

### Closures, arrow functions and first-class callables
<!-- level: intermediate; ref: https://www.php.net/manual/en/functions.arrow.php -->
Anonymous functions (closures) are objects of class `Closure`. A closure must import outer variables explicitly with `use`, by value (snapshot at creation) or by reference (`use (&$x)`). Inside a class method, closures automatically bind `$this` unless declared `static`.

Arrow functions (`fn`, PHP 7.4) are single-expression closures that capture outer variables automatically by value. They are ideal for short callbacks.

First-class callable syntax (PHP 8.1), `strlen(...)` or `$obj->method(...)`, creates a Closure from any callable, which is safer than string or array callables and works with static analysis.

```php
<?php
$minTotal = 50;

$bigOrders = array_filter($orders, function (array $o) use ($minTotal) {
    return $o['total'] >= $minTotal;
});

$bigOrders = array_filter($orders, fn($o) => $o['total'] >= $minTotal);  // same

$counter = 0;
$inc = function () use (&$counter) { $counter++; };
$inc(); $inc();
echo $counter;    // 2

class PriceFormatter {
    public function format(float $p): string { return number_format($p, 2); }
}
$fmt = new PriceFormatter();
$labels = array_map($fmt->format(...), [9.5, 12]);   // PHP 8.1
$lengths = array_map(strlen(...), ['a', 'bb']);
```

- Pitfall: `use ($x)` captures the value at definition time; later changes to `$x` are not seen.
- Pitfall: closures capturing `$this` keep the whole object alive; mark them `static fn` when `$this` is not needed.

### Generators
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.generators.overview.php -->
A generator is a function that uses `yield` to produce values lazily, one at a time, instead of building an entire array. Calling it returns a `Generator` object implementing `Iterator`; the function body runs only as the consumer iterates, pausing at each `yield`.

This keeps memory constant when processing large files, database cursors or paginated APIs. Generators can yield keys (`yield $k => $v`), delegate to other iterables with `yield from`, receive values via `send()`, and return a final value.

```php
<?php
function readCsv(string $path): Generator {
    $handle = fopen($path, 'rb');
    if ($handle === false) {
        throw new RuntimeException("Cannot open $path");
    }
    try {
        $headers = fgetcsv($handle, escape: '');
        while (($row = fgetcsv($handle, escape: '')) !== false) {
            yield array_combine($headers, $row);
        }
    } finally {
        fclose($handle);     // runs even if the consumer stops early
    }
}

function onlyActive(iterable $rows): Generator {
    foreach ($rows as $row) {
        if ($row['status'] === 'active') yield $row;
    }
}

foreach (onlyActive(readCsv('customers.csv')) as $customer) {
    importCustomer($customer);       // memory stays flat for a 5 GB file
}
```

- Pitfall: a generator can be iterated only once; calling it again creates a new one.
- Pitfall: `iterator_to_array($gen)` with duplicate keys overwrites values; pass `false` as the second argument to ignore keys.
- Tip: Laravel's `LazyCollection` and Doctrine's `toIterable()` are built on generators.

## 5. Object-Oriented PHP

### Classes, objects and constructor promotion
<!-- level: basic; ref: https://www.php.net/manual/en/language.oop5.decon.php -->
A class defines properties (state) and methods (behaviour). Objects are created with `new` and accessed through handles. `$this` refers to the current object inside methods; `->` accesses members.

The constructor is `__construct`. Constructor property promotion (PHP 8.0) declares and assigns properties directly from constructor parameters, removing boilerplate. Since PHP 8.4, you can chain on `new` without wrapping parentheses: `new Foo()->bar()`.

```php
<?php
declare(strict_types=1);

final class Money
{
    public function __construct(
        public readonly int $amount,          // minor units (cents)
        public readonly string $currency,
    ) {
        if ($amount < 0) {
            throw new InvalidArgumentException('Amount must be non-negative');
        }
    }

    public function add(Money $other): self
    {
        if ($other->currency !== $this->currency) {
            throw new LogicException('Currency mismatch');
        }
        return new self($this->amount + $other->amount, $this->currency);
    }
}

$total = new Money(1999, 'EUR')->add(new Money(500, 'EUR'));   // PHP 8.4 syntax
echo $total->amount;   // 2499
```

Objects are compared with `==` (same class and equal properties) or `===` (same instance). `clone` makes a shallow copy and calls `__clone` on the copy.

- Pitfall: `clone` is shallow; nested objects are shared unless `__clone` deep-copies them.
- Tip: immutable value objects (readonly properties, "with" methods returning new instances) avoid many bugs.

### Visibility, static members and class constants
<!-- level: basic; ref: https://www.php.net/manual/en/language.oop5.visibility.php -->
Members have visibility: `public` (anyone), `protected` (the class and its subclasses), `private` (the declaring class only). Encapsulate state behind methods so you can enforce invariants.

Static properties and methods belong to the class rather than instances, accessed with `::`. Inside a class, `self::` refers to the class where the code is written, `static::` to the class actually called (late static binding), and `parent::` to the parent.

Class constants are fixed values; since PHP 8.1 they can be `final`, and since 8.3 they can be typed.

```php
<?php
class Order
{
    public const string STATUS_PENDING = 'pending';     // typed constant, PHP 8.3
    private static int $instances = 0;

    private array $lines = [];

    public function __construct(private string $status = self::STATUS_PENDING)
    {
        self::$instances++;
    }

    public function addLine(string $sku, int $qty): void
    {
        if ($qty <= 0) throw new DomainException('Quantity must be positive');
        $this->lines[] = ['sku' => $sku, 'qty' => $qty];
    }

    public static function created(): int { return self::$instances; }
}

$o = new Order();
$o->addLine('SKU-1', 2);
echo Order::created();
echo Order::STATUS_PENDING;
```

- Pitfall: static state persists for the whole request (and across requests in long-running workers), making it a hidden global; prefer dependency injection.
- Pitfall: public properties let any code break invariants; use readonly or private plus methods.

### Inheritance, abstract classes and final
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.oop5.abstract.php -->
PHP supports single inheritance with `extends`. A subclass inherits public and protected members and can override methods (compatible signatures are enforced: parameter types may widen, return types may narrow, following the Liskov substitution principle).

An abstract class cannot be instantiated and may declare abstract methods that subclasses must implement. It is useful for sharing code between closely related classes (the template method pattern). `final` prevents a class from being extended or a method from being overridden. PHP 8.3 added the `#[\Override]` attribute, which errors if a method does not actually override a parent method.

```php
<?php
abstract class Notification
{
    public function send(User $user): void            // template method
    {
        if (!$user->wantsNotifications()) return;
        $this->deliver($user, $this->render($user));
    }

    abstract protected function render(User $user): string;
    abstract protected function deliver(User $user, string $body): void;
}

final class EmailNotification extends Notification
{
    public function __construct(private Mailer $mailer) {}

    #[\Override]
    protected function render(User $user): string { return "Hi {$user->name}"; }

    #[\Override]
    protected function deliver(User $user, string $body): void
    {
        $this->mailer->send($user->email, 'Update', $body);
    }
}
```

- Tip: favour composition and interfaces over deep inheritance trees; many teams mark classes `final` by default.
- Pitfall: calling `parent::__construct()` is not automatic; forgetting it leaves parent properties uninitialised.

### Interfaces and polymorphism
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.oop5.interfaces.php -->
An interface declares methods a class promises to implement, without providing implementation. A class can implement many interfaces. Code that depends on interfaces rather than concrete classes is easier to test (swap in fakes) and extend (add new implementations). Interfaces can declare constants and, since PHP 8.4, properties with hooks.

PHP includes important built-in interfaces: `Countable`, `IteratorAggregate`, `ArrayAccess`, `JsonSerializable`, `Stringable`, and `Throwable`.

```php
<?php
interface PaymentGateway
{
    public function charge(Money $amount, string $token): PaymentResult;
}

final class StripeGateway implements PaymentGateway
{
    public function charge(Money $amount, string $token): PaymentResult { /* API call */ }
}

final class FakeGateway implements PaymentGateway
{
    public array $charges = [];
    public function charge(Money $amount, string $token): PaymentResult
    {
        $this->charges[] = $amount;
        return PaymentResult::success('fake-id');
    }
}

final class Checkout
{
    public function __construct(private PaymentGateway $gateway) {}   // depends on abstraction
}

final class Cart implements Countable, IteratorAggregate
{
    private array $items = [];
    public function count(): int { return count($this->items); }
    public function getIterator(): ArrayIterator { return new ArrayIterator($this->items); }
}
```

- Tip: `instanceof` checks against interfaces, enabling capability checks.
- Interview tip: interfaces define contracts; abstract classes share implementation. Use an interface plus a trait or abstract base when you need both.

### Traits
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.oop5.traits.php -->
Traits are PHP's mechanism for horizontal code reuse in a single-inheritance language. A trait is a set of methods (and properties, constants since 8.2, abstract and static methods) that the compiler copies into any class that uses it. It is not a type: you cannot type-hint a trait or check `instanceof` against it.

Conflicts between two traits defining the same method are resolved with `insteadof` and `as` (which can also change visibility).

```php
<?php
trait HasTimestamps
{
    private ?DateTimeImmutable $createdAt = null;
    private ?DateTimeImmutable $updatedAt = null;

    public function touch(): void
    {
        $now = new DateTimeImmutable();
        $this->createdAt ??= $now;
        $this->updatedAt = $now;
    }
}

trait SoftDeletes
{
    private ?DateTimeImmutable $deletedAt = null;
    public function delete(): void { $this->deletedAt = new DateTimeImmutable(); }
    public function isDeleted(): bool { return $this->deletedAt !== null; }
}

final class Article
{
    use HasTimestamps, SoftDeletes;
}

trait A { public function hello() { return 'A'; } }
trait B { public function hello() { return 'B'; } }
class Greeter { use A, B { A::hello insteadof B; B::hello as helloB; } }
```

Laravel uses traits extensively (for example `SoftDeletes`, `HasFactory`, `Notifiable` on Eloquent models).

- Pitfall: traits that rely on properties or methods of the host class create hidden coupling; declare required methods as `abstract` in the trait.
- Pitfall: overuse turns classes into grab-bags; prefer composition for behaviour with its own state.

### Magic methods
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.oop5.magic.php -->
Magic methods are hooks PHP calls automatically in special situations. Their names start with `__`.

- `__construct`, `__destruct`: creation and destruction (destructors run when the last reference goes away or at shutdown).
- `__get`, `__set`, `__isset`, `__unset`: access to inaccessible or undefined properties.
- `__call`, `__callStatic`: calls to undefined methods (used for proxies and facades).
- `__toString`: string conversion (classes with it implement `Stringable` automatically).
- `__invoke`: makes an object callable.
- `__clone`: customise cloning.
- `__serialize`, `__unserialize`: control serialisation (preferred over `Serializable` and `__sleep`/`__wakeup`).
- `__debugInfo`: what `var_dump` shows.

```php
<?php
final class Settings
{
    private array $data = [];

    public function __get(string $name): mixed
    {
        return $this->data[$name] ?? throw new OutOfBoundsException("No setting $name");
    }
    public function __set(string $name, mixed $value): void { $this->data[$name] = $value; }
    public function __isset(string $name): bool { return isset($this->data[$name]); }
}

final class SlugGenerator
{
    public function __invoke(string $title): string
    {
        return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($title)), '-');
    }
}

$slugs = array_map(new SlugGenerator(), ['Hello World', 'PHP 8.4!']);
```

- Pitfall: `__get`/`__call` magic defeats IDEs and static analysis; document with `@property`/`@method` or avoid.
- Pitfall: dynamic properties on regular classes are deprecated since PHP 8.2 (use `#[\AllowDynamicProperties]` or declare them).

### Late static binding
<!-- level: advanced; ref: https://www.php.net/manual/en/language.oop5.late-static-bindings.php -->
`self::` is resolved at compile time to the class where the method is defined. `static::` is resolved at runtime to the class that was actually called, which is what "late static binding" means. It is essential for static factory methods and active-record style base classes, where a parent's static method must create or refer to the child class.

The return type `static` (PHP 8.0) declares that a method returns an instance of the called class, perfect for fluent interfaces in base classes.

```php
<?php
abstract class Model
{
    protected static string $table;

    public static function create(array $attrs): static
    {
        $model = new static();               // the subclass, not Model
        foreach ($attrs as $k => $v) $model->$k = $v;
        return $model;
    }

    public static function tableName(): string
    {
        return static::$table;               // child's table
    }
}

final class User extends Model
{
    protected static string $table = 'users';
    public string $email;
}

$u = User::create(['email' => 'ana@example.com']);  // instance of User
echo User::tableName();                              // users

// With self:: instead, new self() would try to instantiate abstract Model: Error
```

- Pitfall: `new static()` assumes all subclasses have a compatible constructor; mark the constructor `final` or declare it in an interface.
- Interview tip: this is how Eloquent's `User::query()` and `User::find()` know which model and table to use.

### Readonly properties and classes
<!-- level: intermediate; ref: https://www.php.net/manual/en/language.oop5.properties.php#language.oop5.properties.readonly-properties -->
A `readonly` property (PHP 8.1) can be initialised once, from inside the declaring class scope, and never changed afterwards. Writing a second time throws an `Error`. Readonly properties must be typed. PHP 8.2 added `readonly` classes, making every declared property readonly and forbidding dynamic properties.

Readonly makes immutable value objects and DTOs concise. To produce a modified copy, write a "wither" that constructs a new instance. PHP 8.3 allows re-initialising readonly properties inside `__clone`, enabling clone-based withers; PHP 8.5 adds `clone($obj, ['prop' => $value])` ("clone with").

```php
<?php
final readonly class Address                     // PHP 8.2
{
    public function __construct(
        public string $street,
        public string $city,
        public string $postcode,
    ) {}

    public function withCity(string $city): self
    {
        return new self($this->street, $city, $this->postcode);
    }
}

$a = new Address('Main St 1', 'Berlin', '10115');
$b = $a->withCity('Hamburg');
// $a->city = 'Munich';   // Error: Cannot modify readonly property
```

Readonly is shallow: a readonly property holding an object prevents reassigning the property, but the object itself can still be mutated.

- Pitfall: readonly properties cannot have default values (except via promoted constructor defaults) and cannot be unset after initialisation.
- Interview tip: contrast readonly (write-once, shallow) with true deep immutability.

### Property hooks and asymmetric visibility (PHP 8.4)
<!-- level: advanced; ref: https://www.php.net/manual/en/language.oop5.property-hooks.php -->
PHP 8.4 introduced two features that remove most getter/setter boilerplate.

Property hooks attach `get` and `set` logic directly to a property. Callers use normal property syntax (`$user->email = ...`) while the class validates or transforms values. A property with only a `get` hook that does not reference its own backing value is virtual (computed, no storage). Interfaces can declare properties with required hooks.

Asymmetric visibility lets a property have different read and write visibility, for example `public private(set)`: everyone can read it, only the class can write it.

```php
<?php
final class User
{
    public string $email {
        set(string $value) {
            if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
                throw new InvalidArgumentException("Invalid email: $value");
            }
            $this->email = strtolower($value);
        }
    }

    public string $displayName {
        get => "{$this->firstName} {$this->lastName}";   // virtual property
    }

    public private(set) int $loginCount = 0;              // read publicly, write privately

    public function __construct(
        public string $firstName,
        public string $lastName,
        string $email,
    ) {
        $this->email = $email;    // goes through the set hook
    }

    public function recordLogin(): void { $this->loginCount++; }
}
```

- Pitfall: hooks run on every access, so keep them cheap and side-effect free.
- Pitfall: hooked properties cannot be `readonly`; asymmetric visibility often replaces readonly when internal mutation is needed.
- Tip: version-gate: these features require PHP 8.4+.
