## 3. Control flow, methods and pattern matching
### Statements: branching and loops
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/statements/selection-statements -->
C# offers the familiar C-family control flow, with a few safety rules that prevent classic bugs.

- `if` / `else` conditions must be `bool`; `if (count)` does not compile, unlike C.
- `switch` statements cannot fall through from one non-empty case to the next; each section must end with `break`, `return`, `throw` or `goto case`.
- Loops: `for`, `while`, `do ... while`, and `foreach`, which works on anything with a `GetEnumerator` method.
- `break` exits the nearest loop, `continue` skips to the next iteration.

```csharp
foreach (var order in orders)
{
    if (order.IsTest) continue;
    if (order.Total > limit) break;
    Process(order);
}

switch (command)
{
    case "start":
    case "run":           // empty cases may stack
        Start();
        break;
    case "stop":
        Stop();
        break;
    default:
        throw new ArgumentException($"Unknown command {command}");
}

for (int i = items.Count - 1; i >= 0; i--)   // iterate backwards to remove safely
    if (items[i].Expired) items.RemoveAt(i);
```

A `foreach` variable is read-only, and modifying a `List<T>` while enumerating it throws `InvalidOperationException` ("Collection was modified"). Iterate backwards with `for`, use `RemoveAll`, or build a new list.

Since C# 5 each `foreach` iteration gets a fresh loop variable, so lambdas capture the expected value. A plain `for` loop shares one variable across iterations, so closures capture its final value.

- Interview tip: guard clauses with early `return` or `continue` usually read better than deeply nested `if` blocks.

### Pattern matching and switch expressions
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/fundamentals/functional/pattern-matching -->
Pattern matching lets you test the shape of a value and extract parts of it in one step. It has grown in every C# release since 7 and is now one of the most expressive features of the language.

Main pattern kinds:
- Type patterns: `obj is Invoice inv`
- Constant and relational patterns: `x is > 0 and < 100`, `status is not null`
- Property patterns: `order is { Status: OrderStatus.Paid, Total: > 1000 }`
- Positional patterns using `Deconstruct`: `point is (0, 0)`
- List patterns (C# 11): `args is ["run", var file, ..]`

Switch expressions (C# 8) turn a multi-way decision into a single expression that returns a value:

```csharp
decimal Shipping(Order o) => o switch
{
    { Country: "IN", Total: >= 999 }       => 0m,
    { Country: "IN" }                      => 49m,
    { IsExpress: true, Weight: > 20 }      => 1500m,
    { IsExpress: true }                    => 800m,
    null                                   => throw new ArgumentNullException(nameof(o)),
    _                                      => 300m,
};

string Describe(int[] values) => values switch
{
    []              => "empty",
    [var single]    => $"one item: {single}",
    [var first, .., var last] => $"from {first} to {last}",
};
```

The compiler checks that the arms are exhaustive and warns when a case is unreachable or missing, which is a real safety net when enums gain new members.

- Pitfall: arms are evaluated top to bottom; put specific patterns before general ones or the compiler reports them as unreachable.
- Interview tip: switch expressions plus records give a lightweight alternative to visitor-pattern class hierarchies.

### Method parameters: ref, out, in, params, optional and named
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/method-parameters -->
Arguments are passed by value by default. Several modifiers change that:

- `ref`: the method receives an alias to the caller's variable and may read and write it. The variable must be initialised first.
- `out`: the method must assign it before returning; the caller need not initialise it. Used by the `TryXxx` pattern.
- `in` / `ref readonly`: pass by reference but read-only, mainly to avoid copying large structs.
- `params`: accept a variable number of arguments. Since C# 13 `params` works with any collection type, including `ReadOnlySpan<T>`, which avoids allocating an array.

Optional parameters have default values, and named arguments let callers skip or reorder them for clarity.

```csharp
bool TryGetDiscount(string code, out decimal percent)
{
    percent = code == "DIWALI" ? 10m : 0m;
    return percent > 0;
}

void Swap<T>(ref T a, ref T b) => (a, b) = (b, a);

int Sum(params ReadOnlySpan<int> values)   // C# 13: no array allocation
{
    int total = 0;
    foreach (var v in values) total += v;
    return total;
}

void Send(string to, string subject, bool highPriority = false, int retries = 3) { }

Send("ops@example.com", "Disk full", retries: 5);   // named + optional
if (TryGetDiscount(code, out var pct)) ApplyDiscount(pct);
```

- Pitfall: default parameter values are compiled into the caller, just like `const`. Changing a default in a library has no effect until consumers recompile.
- Pitfall: many `bool` parameters make calls unreadable; use named arguments or an options object.
- Interview tip: `ref` cannot be used in iterator methods or across `await` in most cases; restrictions were relaxed in C# 13 only for code that does not cross a yield or await boundary.

### Lambdas, closures and local functions
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/programming-guide/classes-and-structs/local-functions -->
A lambda expression (`x => x * 2`) is an anonymous function that can be converted to a delegate type such as `Func<int,int>` or to an expression tree. Lambdas can capture variables from the enclosing scope; the compiler hoists those variables into a hidden "closure" class so they outlive the method.

A local function is a named method declared inside another method. It is ideal for helpers used only once, recursive helpers, and validating arguments eagerly in iterator or async methods.

```csharp
int threshold = 100;
Func<Order, bool> isLarge = o => o.Total > threshold;  // captures threshold
threshold = 500;   // the lambda sees 500 - it captured the variable, not the value

static int Square(int x) => x * x;   // static lambda/local: cannot capture

IEnumerable<string> ReadLines(string path)
{
    ArgumentException.ThrowIfNullOrEmpty(path);   // runs immediately
    return Iterator();

    IEnumerable<string> Iterator()                // runs lazily on enumeration
    {
        foreach (var line in File.ReadLines(path)) yield return line.Trim();
    }
}
```

Under the hood, capturing allocates a closure object and a delegate. In hot paths, prefer `static` lambdas (C# 9) to make accidental captures a compile error, or pass state explicitly.

Note: C# 14 allows parameter modifiers such as `out` on implicitly typed lambda parameters, for example `Parser p = (text, out result) => int.TryParse(text, out result);` where `delegate bool Parser(string text, out int result);` supplies the types.

- Pitfall: capturing a loop variable of a `for` loop gives every lambda the final value.
- Interview tip: local functions do not allocate a delegate unless you convert them to one, so they are cheaper than lambdas for internal helpers.

### Tuples and deconstruction
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/value-tuples -->
Value tuples (`(int, string)`, backed by `System.ValueTuple`) group a few values without declaring a type. They are value types, support element names, and are perfect for returning multiple results from a private method.

Deconstruction splits a tuple, record or any type with a `Deconstruct` method into separate variables.

```csharp
(decimal Min, decimal Max, decimal Avg) Stats(IReadOnlyList<decimal> xs)
    => (xs.Min(), xs.Max(), xs.Average());

var stats = Stats(prices);
Console.WriteLine(stats.Avg);

var (min, max, _) = Stats(prices);   // discard the average

(a, b) = (b, a);                     // swap without a temp variable

foreach (var (key, value) in dictionary)   // KeyValuePair has Deconstruct
    Console.WriteLine($"{key}={value}");

public readonly struct Range2D(int x, int y)
{
    public void Deconstruct(out int x0, out int y0) => (x0, y0) = (x, y);
}
```

Tuples compare element-wise with `==` (C# 7.3), and element names are a compile-time convenience only: at run time the fields are `Item1`, `Item2` and so on. That is why names are lost when tuples go through reflection or JSON serialisation.

When to use what:
- Tuples: short-lived, local or private results.
- Records: data that crosses API boundaries, gets serialised, or needs a name in documentation.

- Pitfall: public APIs that return `(bool, string, int)` become unreadable and hard to evolve; introduce a record instead.
- Interview tip: the old `System.Tuple<T1,T2>` is a reference type with read-only `Item1` properties; avoid it in new code.

### Exceptions: try, catch, finally and filters
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/fundamentals/exceptions/ -->
Exceptions are .NET's mechanism for reporting failures that a method cannot handle itself. When one is thrown, the runtime unwinds the stack looking for a matching `catch`; `finally` blocks run along the way no matter what.

```csharp
try
{
    var text = await File.ReadAllTextAsync(path, ct);
    return JsonSerializer.Deserialize<Settings>(text)!;
}
catch (FileNotFoundException)
{
    return Settings.Default;                    // expected, recoverable
}
catch (JsonException ex) when (ex.LineNumber is not null)   // exception filter
{
    throw new ConfigException($"Bad JSON at line {ex.LineNumber}", ex);  // wrap with inner
}
finally
{
    logger.LogDebug("Settings load attempted for {Path}", path);
}
```

Key rules:
- Order catch blocks from most specific to most general; the compiler rejects unreachable ones.
- Use `throw;` to rethrow and keep the original stack trace. `throw ex;` resets it.
- Exception filters (`when`) are evaluated before the stack unwinds, so a filter that returns false leaves the stack intact for debugging and crash dumps.
- `using` statements are `try/finally` in disguise, guaranteeing `Dispose`.

Throwing is relatively expensive (capturing stack traces), so exceptions should signal unexpected conditions, not normal control flow like "user not found".

- Pitfall: `catch (Exception) { }` hides bugs and leaves state corrupted. Catch only what you can handle, or log and rethrow.
- Interview tip: some exceptions cannot be meaningfully caught, notably `StackOverflowException`, which terminates the process.

## 4. Object-oriented programming in C#
### Classes, constructors and primary constructors
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/whats-new/tutorials/primary-constructors -->
A class bundles state (fields and properties) with behaviour (methods). Constructors initialise a new instance; constructor chaining with `this(...)` avoids duplicating logic, and `base(...)` calls a parent constructor.

C# 12 added primary constructors for all classes and structs: parameters declared on the type itself are in scope throughout the body. They are especially popular for dependency injection.

```csharp
// Classic style
public class OrderService
{
    private readonly IOrderRepository _repo;
    private readonly ILogger<OrderService> _log;

    public OrderService(IOrderRepository repo, ILogger<OrderService> log)
    {
        _repo = repo;
        _log = log;
    }
}

// Primary constructor (C# 12)
public class OrderService2(IOrderRepository repo, ILogger<OrderService2> log)
{
    public async Task<Order?> Get(int id)
    {
        log.LogInformation("Loading {Id}", id);
        return await repo.FindAsync(id);
    }
}

public class Money(decimal amount, string currency)
{
    public decimal Amount { get; } = amount;          // capture into a property
    public string Currency { get; } = currency.ToUpperInvariant();
}
```

Important detail: in a class, primary constructor parameters are not properties. If methods use them, the compiler captures them into hidden mutable fields. Nothing stops a method from reassigning `repo`. If you want guaranteed immutability, assign them to `readonly` fields or properties explicitly.

Object initializers (`new Order { Id = 1, Total = 10 }`) set accessible properties after the constructor runs.

- Pitfall: using a primary constructor parameter both to initialise a property and inside methods creates two copies of the state (compiler warning CS9124).
- Interview tip: records generate public properties from positional parameters; plain classes do not.

### Properties: auto, init, required and the field keyword
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/programming-guide/classes-and-structs/properties -->
Properties expose data through `get` and `set` accessors, so you can add validation or change storage later without breaking callers. Auto-properties (`public string Name { get; set; }`) let the compiler create the backing field.

Modern additions:
- `init` accessors (C# 9): settable only during object initialisation, giving immutable objects with object-initializer syntax.
- `required` members (C# 11): callers must set them in the initializer, or the code does not compile.
- `field` keyword (C# 14): refer to the compiler-generated backing field inside an accessor, so you can add logic without declaring a field yourself.

```csharp
public class Customer
{
    public required string Email { get; init; }
    public string? Phone { get; init; }

    // C# 14: validation without a manual backing field
    public string Name
    {
        get;
        set => field = string.IsNullOrWhiteSpace(value)
            ? throw new ArgumentException("Name required")
            : value.Trim();
    }

    public int OrderCount { get; private set; }   // read-only from outside
    public bool IsVip => OrderCount > 50;         // computed, no storage
}

var c = new Customer { Email = "a@b.com", Name = " Asha " };   // Email is required
// c.Email = "x";   // error: init-only
```

Properties are methods under the hood (`get_Name`, `set_Name`), so the JIT usually inlines simple ones and there is no performance penalty.

- Pitfall: properties should be cheap and side-effect free. A property that hits the database surprises callers and debuggers (which evaluate properties when you hover).
- Pitfall: if an existing class already has a member named `field`, C# 14 treats `field` inside accessors as the keyword; use `@field` or `this.field` to refer to your member.

### Inheritance, virtual, abstract and sealed
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/fundamentals/object-oriented/inheritance -->
C# supports single inheritance of classes: a class has exactly one base class (ultimately `object`) and can implement many interfaces.

- `virtual` methods can be overridden by derived classes with `override`. Calls are dispatched at run time based on the actual object type (polymorphism).
- `abstract` classes cannot be instantiated; `abstract` members have no body and must be overridden.
- `sealed` prevents further inheritance (on classes) or further overriding (on an override).
- `new` on a member hides a base member instead of overriding it, which means the base version is called through a base-typed reference.

```csharp
public abstract class PaymentMethod
{
    public abstract string Name { get; }
    public virtual decimal Fee(decimal amount) => 0m;
    public decimal Total(decimal amount) => amount + Fee(amount);  // template method
}

public sealed class CreditCard : PaymentMethod
{
    public override string Name => "Card";
    public override decimal Fee(decimal amount) => Math.Round(amount * 0.02m, 2);
}

public sealed class Upi : PaymentMethod
{
    public override string Name => "UPI";
}

PaymentMethod pm = new CreditCard();
Console.WriteLine(pm.Total(1000));   // 1020, dispatches to CreditCard.Fee
```

Sealing classes by default is a good habit: it states intent, prevents fragile subclassing, and lets the JIT devirtualise calls. Many teams enable an analyzer that suggests sealing internal types.

Prefer composition over deep hierarchies. Inheritance couples subclasses to the base's implementation details; a change in the base can silently break derived classes (the fragile base class problem).

- Pitfall: calling a virtual method from a base constructor runs the derived override before the derived constructor has initialised its fields.
- Interview tip: be ready to explain the difference between `override` and `new` with a short example.

### Interfaces, default members and static abstract members
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/interface -->
An interface defines a contract: members a type promises to provide. A class or struct can implement any number of interfaces, which is how C# achieves polymorphism without multiple inheritance.

Interfaces have evolved:
- Default interface methods (C# 8) let an interface ship a method body, so adding a member to a published interface no longer breaks every implementer.
- Static abstract members (C# 11) let an interface require static methods or operators. This powers generic math (`INumber<T>`) and factory patterns on type parameters.
- Explicit implementation hides a member unless the object is accessed through the interface, resolving name clashes.

```csharp
public interface INotifier
{
    Task SendAsync(string to, string message, CancellationToken ct);

    // default implementation (C# 8)
    Task SendManyAsync(IEnumerable<string> to, string msg, CancellationToken ct)
        => Task.WhenAll(to.Select(t => SendAsync(t, msg, ct)));
}

public interface IParsableId<TSelf> where TSelf : IParsableId<TSelf>
{
    static abstract TSelf Parse(string s);   // C# 11
}

static T Sum<T>(IEnumerable<T> xs) where T : INumber<T>
{
    T total = T.Zero;
    foreach (var x in xs) total += x;
    return total;
}

Console.WriteLine(Sum(new[] { 1.5, 2.5 }));   // works for double, int, decimal...
```

Interfaces are the backbone of dependency injection and testing: code depends on `INotifier`, and tests substitute a fake.

- Pitfall: default interface methods are only visible through the interface type, not through the implementing class reference.
- Pitfall: creating an interface for every class "just in case" adds noise; introduce one when there is a real second implementation or a test seam.

### Access modifiers and file-local types
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/access-modifiers -->
Access modifiers control who can see a type or member, which is how you keep an API small and your internals free to change.

- `public`: visible everywhere.
- `internal`: visible within the same assembly (the default for top-level types).
- `private`: visible within the containing type (the default for members).
- `protected`: the containing type and derived types.
- `protected internal`: same assembly or derived types.
- `private protected`: derived types in the same assembly only.
- `file` (C# 11): the type is visible only within the source file, ideal for helpers in source generators or small implementation details.

```csharp
public sealed class InvoiceService           // public API
{
    private readonly TaxCalculator _tax = new();
    internal int CacheHits { get; private set; }  // usable by tests via InternalsVisibleTo

    public decimal Total(Invoice inv) => inv.Subtotal + _tax.For(inv);
}

file sealed class TaxCalculator               // invisible outside this file
{
    public decimal For(Invoice inv) => inv.Subtotal * 0.18m;
}
```

Guidelines:
- Start as restrictive as possible and widen only when needed. Everything `public` in a library is a promise you must keep across versions.
- Make types `internal sealed` by default in applications; it documents that nothing outside should depend on them.
- `[assembly: InternalsVisibleTo("MyLib.Tests")]` (or the `<InternalsVisibleTo>` item in the project) lets a test project see internals without making them public.

- Pitfall: a public method cannot expose a less accessible type in its signature; the compiler reports "inconsistent accessibility".
- Interview tip: "encapsulation" in an interview answer should mean protecting invariants, not just making fields private and adding getters and setters for all of them.

### Structs, readonly structs and ref structs
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/ref-struct -->
Structs are user-defined value types. They avoid heap allocation and GC pressure, which makes them useful for small, short-lived data such as coordinates, money amounts or keys. Guidelines: keep them small (roughly 16 bytes or less is a common rule of thumb), immutable, and logically a single value.

- `readonly struct` guarantees every field is read-only. The compiler can then pass it by `in` without making defensive copies.
- `record struct` (C# 10) adds value equality and `with` support.
- `ref struct` types must live on the stack: they cannot be boxed, stored in class fields, captured by lambdas, or used across `await`. `Span<T>` is the best-known example. These rules allow them to safely reference stack memory.

```csharp
public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money operator +(Money a, Money b)
        => a.Currency == b.Currency
            ? new(a.Amount + b.Amount, a.Currency)
            : throw new InvalidOperationException("Currency mismatch");
}

public ref struct TokenReader(ReadOnlySpan<char> input)
{
    private ReadOnlySpan<char> _rest = input;
    public bool TryNext(out ReadOnlySpan<char> token)
    {
        _rest = _rest.TrimStart();
        int end = _rest.IndexOf(' ');
        token = end < 0 ? _rest : _rest[..end];
        _rest = end < 0 ? default : _rest[end..];
        return !token.IsEmpty;
    }
}
```

The hidden cost of mutable structs: calling a mutating method on a struct held in a `readonly` field or returned from a property operates on a temporary copy, so the change disappears silently.

- Pitfall: large structs copied on every assignment and parameter pass can be slower than classes.
- Interview tip: C# 13 lets generic code accept ref structs via the `allows ref struct` anti-constraint, which is how new BCL APIs take `Span<T>` in generic positions.

### Records and value-based equality
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/record -->
A record is a class or struct whose identity is its data. The compiler generates members you would otherwise write by hand:

- `Equals`, `GetHashCode`, `==` and `!=` comparing every field.
- A `ToString()` that prints property names and values.
- A `Deconstruct` method for positional records.
- Support for `with` expressions, which copy the record while changing some properties (non-destructive mutation).
- An `EqualityContract` so a `Customer` record never equals a derived `VipCustomer` record with the same values.

```csharp
public record Address(string City, string Pin);

public record Customer(int Id, string Name, Address Address)
{
    public IReadOnlyList<string> Tags { get; init; } = [];
}

var a = new Customer(1, "Asha", new("Pune", "411001"));
var b = a with { Name = "Asha K" };          // a is unchanged

Console.WriteLine(a == b);                   // False
Console.WriteLine(a.Address == b.Address);   // True: the same Address instance is shared
Console.WriteLine(a);  // Customer { Id = 1, Name = Asha, Address = Address { ... }, Tags = ... }
```

`with` performs a shallow copy: reference-typed properties (like `Tags` or `Address`) are shared between the original and the copy.

Equality on collection properties compares references, not contents. Two records with equal-looking lists are not equal unless they share the same list instance. Use `ImmutableArray<T>` with a custom equality, or avoid collections in records used as keys.

Good uses: DTOs, API contracts, messages and events, value objects in domain models, and dictionary keys.

- Pitfall: Entity Framework entities with identity and change tracking usually should not be records, because value equality conflicts with entity identity.
- Interview tip: `record` alone means `record class` (reference type); say so explicitly when comparing to `record struct`.

### Equality: Equals, GetHashCode and IEquatable
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/csharp/programming-guide/statements-expressions-operators/equality-comparisons -->
.NET distinguishes reference equality (same object) from value equality (same data). Classes default to reference equality; structs default to field-by-field comparison via reflection, which is slow.

If you override equality you must keep a contract:
- `Equals` must be reflexive, symmetric and transitive.
- Objects that are equal must return the same `GetHashCode()`. Hash-based collections (`Dictionary`, `HashSet`) look up the bucket by hash first, then call `Equals`.
- The hash must not change while the object is in a hash collection, so base it on immutable data.

```csharp
public sealed class Sku : IEquatable<Sku>
{
    public Sku(string code) => Code = code.ToUpperInvariant();
    public string Code { get; }

    public bool Equals(Sku? other) => other is not null && Code == other.Code;
    public override bool Equals(object? obj) => Equals(obj as Sku);
    public override int GetHashCode() => Code.GetHashCode();
    public static bool operator ==(Sku? a, Sku? b) => Equals(a, b);
    public static bool operator !=(Sku? a, Sku? b) => !Equals(a, b);
}

// Combine several fields
public override int GetHashCode() => HashCode.Combine(Country, PostalCode);

// Custom comparison for a collection without changing the type
var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
```

Implementing `IEquatable<T>` on structs avoids boxing when generic collections compare elements. For most data types, simply using a record gets all of this right automatically.

- Pitfall: putting a mutable object in a `HashSet`, then changing a field used in the hash, makes it unfindable: `Contains` returns false even though it is there.
- Pitfall: `==` on two variables typed as `object` uses reference equality even if `Equals` is overridden.

### Static members, extension methods and extension members (C# 14)
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/whats-new/csharp-14 -->
Static members belong to the type rather than an instance. A `static class` contains only static members and cannot be instantiated, making it a natural home for helpers and extension methods.

Extension methods (C# 3) let you "add" methods to existing types without modifying them: a static method whose first parameter has `this`. LINQ is built entirely on them.

C# 14 generalises this with extension blocks. Inside a static class you declare `extension(Receiver r) { ... }` and can define extension properties, extension methods and even static extension members that appear on the type itself.

```csharp
public static class StringExtensions
{
    // Classic extension method (still fully supported)
    public static string Truncate(this string s, int max)
        => s.Length <= max ? s : s[..max] + "...";

    // C# 14 extension block
    extension(string s)
    {
        public bool IsBlank => string.IsNullOrWhiteSpace(s);     // extension property
        public string Initials() =>
            string.Concat(s.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(w => w[0]));
    }

    extension(string)                                            // static extensions
    {
        public static string Bullet => "•";
    }
}

if (input.IsBlank) return;
Console.WriteLine($"{string.Bullet} {"Asha Kumar".Initials()}");   // AK
```

Extensions are resolved at compile time and are only in scope when their namespace is imported. A real instance member with the same signature always wins.

- Pitfall: extension methods on very common types (`object`, `string`) pollute IntelliSense for everyone; keep them in specific namespaces.
- Pitfall: static mutable state is shared across threads and tests; it is a frequent source of race conditions and flaky tests.
- Interview tip: extension members cannot add state (fields) to a type; they only add behaviour.
