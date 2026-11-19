## 5. Generics and collections
### Generics and type constraints
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/fundamentals/types/generics -->
Generics let you write a type or method once and use it with many types while keeping full compile-time type safety. `List<T>` stores any `T` without casting, and the compiler stops you from adding a `string` to a `List<int>`.

Under the hood .NET generics are reified: the runtime knows the actual type arguments. For value types the JIT generates specialised code per type (`List<int>` and `List<double>` get separate native code, with no boxing); reference types share one implementation. That is why generics are both safe and fast, unlike Java's erased generics.

Constraints restrict what `T` can be, which unlocks members you can call on it:

```csharp
public interface IEntity { int Id { get; } }

public class Repository<T> where T : class, IEntity, new()
{
    private readonly Dictionary<int, T> _items = new();
    public void Save(T item) => _items[item.Id] = item;
    public T GetOrCreate(int id) => _items.TryGetValue(id, out var x) ? x : new T();
}

public static T Max<T>(T a, T b) where T : IComparable<T>
    => a.CompareTo(b) >= 0 ? a : b;

public static void Fill<T>(Span<T> span) where T : unmanaged { /* blittable types only */ }
```

Common constraints: `class`, `struct`, `notnull`, `unmanaged`, `new()`, a base class, an interface, another type parameter, and `allows ref struct` (C# 13). Enum and delegate constraints (`where T : Enum`) exist since C# 7.3.

- Pitfall: a static field in a generic class exists once per closed type: `Cache<int>.Count` and `Cache<string>.Count` are different fields.
- Pitfall: `default(T)` is `null` for reference types and zero for value types; with nullable analysis use `T?` carefully.
- Interview tip: explain why `List<object>` cannot be assigned to `List<string>` and how variance (next concept) relates.

### Generic variance: covariance and contravariance
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/standard/generics/covariance-and-contravariance -->
Variance answers: if `Cat` derives from `Animal`, can a `Thing<Cat>` be used where a `Thing<Animal>` is expected? In C#, variance is only allowed on interfaces and delegates, and only for reference types.

- Covariance (`out T`): the type only produces `T`. `IEnumerable<Cat>` can be used as `IEnumerable<Animal>` because reading a `Cat` as an `Animal` is always safe.
- Contravariance (`in T`): the type only consumes `T`. An `IComparer<Animal>` can be used as `IComparer<Cat>`, because something that can compare any animals can certainly compare cats.
- Invariance: types that both read and write `T`, such as `List<T>`, allow neither. If `List<Cat>` were a `List<Animal>`, you could add a `Dog` to it.

```csharp
IEnumerable<string> names = new List<string> { "a", "b" };
IEnumerable<object> objects = names;          // OK: covariant

Action<object> logAny = o => Console.WriteLine(o);
Action<string> logString = logAny;            // OK: contravariant

// List<object> list = new List<string>();    // compile error: invariant

public interface IProducer<out T> { T Produce(); }
public interface IHandler<in TMessage> { Task Handle(TMessage msg); }
```

Arrays are a historical exception: they are covariant (`object[] arr = new string[1];`) but unsafe, so writing a wrong type throws `ArrayTypeMismatchException` at run time. This check also adds a small cost to every array store of reference types.

- Pitfall: variance does not work with value types: `IEnumerable<int>` is not an `IEnumerable<object>`.
- Interview tip: remember "out = output position = covariant, in = input position = contravariant", and that the compiler enforces the positions when you declare them.

### Core collections and choosing the right one
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/standard/collections/ -->
`System.Collections.Generic` contains the workhorse collections. Choosing well affects both correctness and performance.

- `List<T>`: dynamic array. O(1) index access and amortised O(1) append; inserting or removing in the middle is O(n).
- `Dictionary<TKey,TValue>`: hash table with average O(1) lookup by key. Iteration order is not guaranteed.
- `HashSet<T>`: unique items with O(1) `Contains`; supports set operations like `UnionWith`.
- `Queue<T>` (FIFO), `Stack<T>` (LIFO), `PriorityQueue<TElement,TPriority>` (.NET 6, min-heap).
- `SortedDictionary` / `SortedSet`: ordered, O(log n) operations.
- `LinkedList<T>`: rarely the best choice; poor cache locality.

```csharp
var stock = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
stock["SKU-1"] = 10;
if (stock.TryGetValue("sku-1", out var qty)) Console.WriteLine(qty);  // 10

// Update in place without a double lookup (.NET 6+)
ref int slot = ref CollectionsMarshal.GetValueRefOrAddDefault(stock, "SKU-2", out _);
slot += 5;

var jobs = new PriorityQueue<string, int>();
jobs.Enqueue("send-email", 2);
jobs.Enqueue("charge-card", 1);
Console.WriteLine(jobs.Dequeue());   // charge-card

var ids = new List<int>(capacity: 10_000);   // pre-size to avoid regrowth
```

For APIs, expose abstractions that state intent: `IReadOnlyList<T>` or `IReadOnlyCollection<T>` for results, `IEnumerable<T>` when callers only iterate once.

- Pitfall: `list.Contains(x)` inside a loop is O(n squared) overall; switch to a `HashSet`.
- Pitfall: `Dictionary` is not thread-safe for concurrent writes; concurrent mutation can corrupt it.
- Interview tip: pre-sizing collections with a known count avoids repeated array copying as they grow.

### Immutable and frozen collections
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/api/system.collections.frozen -->
Mutable collections shared across threads or components invite bugs. .NET offers two families of read-only data structures with different trade-offs.

Immutable collections (`System.Collections.Immutable`): `ImmutableList<T>`, `ImmutableDictionary`, `ImmutableArray<T>` and others. "Modifying" returns a new collection that shares most of its structure with the old one. They are thread-safe by design and great for snapshots, undo stacks and state passed between components.

Frozen collections (`System.Collections.Frozen`, .NET 8): `FrozenDictionary` and `FrozenSet`. You build them once and they never change. Creation is more expensive because the implementation analyses the keys and picks an optimised layout, but lookups are faster than a normal `Dictionary`. Ideal for configuration-driven lookup tables built at startup and read millions of times.

```csharp
using System.Collections.Frozen;
using System.Collections.Immutable;

private static readonly FrozenDictionary<string, decimal> TaxRates =
    new Dictionary<string, decimal>
    {
        ["IN-MH"] = 0.18m, ["IN-KA"] = 0.18m, ["IN-GJ"] = 0.12m,
    }.ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);

ImmutableList<string> v1 = ImmutableList.Create("a", "b");
ImmutableList<string> v2 = v1.Add("c");     // v1 unchanged

var builder = ImmutableArray.CreateBuilder<int>();
for (int i = 0; i < 1000; i++) builder.Add(i);
ImmutableArray<int> arr = builder.ToImmutable();   // efficient bulk build
```

Do not confuse these with `ReadOnlyCollection<T>` or `AsReadOnly()`, which are read-only views over a list that someone else can still mutate.

- Pitfall: adding items one by one to `ImmutableList` in a loop is slow; use a builder.
- Interview tip: `ImmutableArray<T>` is a struct wrapper over an array with fast indexing, while `ImmutableList<T>` is a balanced tree with O(log n) access.

### Arrays, ranges, indices and collection expressions
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/operators/collection-expressions -->
Arrays are fixed-size, contiguous blocks of elements. They are the fastest collection for indexed access and the building block of `List<T>`, `Span<T>` and most buffers. Multi-dimensional (`int[,]`) and jagged (`int[][]`) arrays exist; jagged arrays are usually faster.

C# 8 added indices and ranges: `^1` means "one from the end", and `a..b` selects a slice. On arrays and strings, a range creates a copy; on spans, it is a free view.

C# 12 collection expressions give one syntax to create arrays, lists, spans and immutable collections, with the spread operator `..` to inline other collections. The compiler chooses an efficient construction for the target type.

```csharp
int[] scores = [90, 72, 85, 64, 99];
List<string> names = ["Asha", "Ravi"];
ReadOnlySpan<byte> header = [0x50, 0x4B, 0x03, 0x04];   // no heap allocation
ImmutableArray<int> frozen = [1, 2, 3];

int last = scores[^1];            // 99
int[] middle = scores[1..^1];     // [72, 85, 64] (copy)
Span<int> view = scores.AsSpan(1, 3);   // no copy

int[] all = [.. scores, .. extraScores, 100];   // spread
int[] empty = [];                               // cached, no allocation

Array.Sort(scores);
int idx = Array.BinarySearch(scores, 85);
```

Arrays are covariant and have a fixed length; for growable data use `List<T>`. `Array.Empty<T>()` or `[]` avoids allocating new empty arrays.

- Pitfall: `scores[1..3]` on an array allocates a new array every time; in hot loops slice a span instead.
- Pitfall: arrays are reference types, so `readonly int[] x` prevents reassigning `x` but not changing its elements.
- Interview tip: collection expressions also work for your own types if you add a `[CollectionBuilder]` attribute.

### Iterators, IEnumerable and yield return
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/statements/yield -->
`IEnumerable<T>` represents a sequence that can be enumerated; `IEnumerator<T>` is the cursor with `MoveNext()` and `Current`. `foreach` is compiled into calls to these.

An iterator method uses `yield return` to produce values one at a time. The compiler rewrites the method into a state machine class; each `MoveNext()` runs the code until the next `yield`. Nothing runs until someone starts enumerating, which is called deferred or lazy execution.

```csharp
IEnumerable<LogEntry> ReadErrors(string path)
{
    foreach (var line in File.ReadLines(path))     // streams line by line
    {
        if (!line.Contains("ERROR", StringComparison.Ordinal)) continue;
        yield return LogEntry.Parse(line);
    }
}

IEnumerable<long> Fibonacci()
{
    (long a, long b) = (0, 1);
    while (true)                // infinite but lazy
    {
        yield return a;
        (a, b) = (b, a + b);
    }
}

foreach (var f in Fibonacci().Take(10)) Console.Write($"{f} ");
var firstTimeout = ReadErrors("app.log").FirstOrDefault(e => e.IsTimeout); // stops early
```

Benefits: you can process files larger than memory, stop early, and compose pipelines with LINQ.

Iterator methods also run `finally` blocks and dispose resources when enumeration stops early, because `foreach` disposes the enumerator.

- Pitfall: argument validation inside an iterator runs only when enumeration starts, so errors surface far from the call site; validate in a wrapper method (see local functions).
- Pitfall: enumerating the same lazy sequence twice runs the whole pipeline twice, including file reads or database calls. Materialise with `ToList()` when you need multiple passes.
- Interview tip: `yield` is not allowed in methods with `ref` parameters or inside `catch` blocks.

## 6. Delegates, events and LINQ
### Delegates, Func and Action under the hood
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/programming-guide/delegates/ -->
A delegate type describes a method signature; a delegate instance is an object that holds a target object and a method pointer. Calling the delegate calls the method. Delegates are how C# passes behaviour as data: callbacks, strategies, LINQ predicates and event handlers.

The BCL predefines generic delegate types so you rarely declare your own:
- `Action`, `Action<T1..T16>` for methods returning `void`.
- `Func<T1..T16, TResult>` for methods that return a value.
- `Predicate<T>`, `Comparison<T>` for older APIs.

Delegates are multicast: `+=` combines several methods into an invocation list, and calling it invokes them in order. With a return value, only the last result is returned, so multicast is mainly useful for `void` callbacks such as events.

```csharp
public delegate decimal PriceRule(decimal price);   // custom delegate type

PriceRule festive = p => p * 0.9m;
Func<decimal, decimal> roundUp = p => Math.Ceiling(p);

decimal Apply(decimal price, IEnumerable<Func<decimal, decimal>> rules)
    => rules.Aggregate(price, (current, rule) => rule(current));

var final = Apply(999m, [p => p * 0.9m, roundUp]);

Action<string> log = Console.WriteLine;    // method group conversion
log += s => File.AppendAllText("log.txt", s + Environment.NewLine);
log("started");                            // calls both
```

Creating a delegate from a lambda that captures variables allocates a closure plus the delegate. Non-capturing lambdas are cached by the compiler, so they allocate only once.

- Pitfall: if one method in a multicast invocation throws, later ones do not run.
- Interview tip: since C# 10, lambdas and method groups have a "natural type", so `var f = (int x) => x * 2;` compiles to `Func<int,int>`.

### Events and the observer pattern
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/standard/events/ -->
An event is a delegate field wrapped with restricted access: outside code can only subscribe (`+=`) and unsubscribe (`-=`), and only the declaring class can raise it. This implements the observer pattern in a type-safe way.

The .NET convention is `EventHandler<TEventArgs>`, where the handler receives the sender and an arguments object. Raise events through a protected virtual `OnXxx` method so subclasses can hook in.

```csharp
public sealed class PriceChangedEventArgs(decimal oldPrice, decimal newPrice) : EventArgs
{
    public decimal OldPrice { get; } = oldPrice;
    public decimal NewPrice { get; } = newPrice;
}

public class Product
{
    public event EventHandler<PriceChangedEventArgs>? PriceChanged;

    private decimal _price;
    public decimal Price
    {
        get => _price;
        set
        {
            if (value == _price) return;
            var old = _price;
            _price = value;
            OnPriceChanged(new(old, value));
        }
    }

    protected virtual void OnPriceChanged(PriceChangedEventArgs e)
        => PriceChanged?.Invoke(this, e);   // copy-then-invoke is thread-safe
}

var p = new Product();
EventHandler<PriceChangedEventArgs> handler = (s, e) => Console.WriteLine($"{e.OldPrice} -> {e.NewPrice}");
p.PriceChanged += handler;
p.Price = 120;
p.PriceChanged -= handler;    // unsubscribe with the same delegate instance
```

The publisher holds a reference to every subscriber through the delegate. A long-lived publisher (a static event, a singleton service) therefore keeps short-lived subscribers alive, which is a classic memory leak.

- Pitfall: unsubscribing with a new lambda does nothing, because it is a different delegate instance; keep a reference.
- Interview tip: for cross-component or cross-process events, events are the wrong tool; use a message bus, `Channel<T>` or `IObservable<T>` (Reactive Extensions).

### LINQ fundamentals and deferred execution
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/linq/ -->
Language Integrated Query (LINQ) is a set of extension methods (`Where`, `Select`, `OrderBy`, `GroupBy` and many more) plus an optional query syntax. It works over any `IEnumerable<T>` in memory and, through `IQueryable<T>`, over databases and other providers.

Most operators use deferred execution: calling `Where` builds a pipeline but does not run it. Work happens when you enumerate, for example with `foreach`, `ToList()`, `Count()` or `First()`. Operators like `OrderBy` and `GroupBy` must buffer the whole input before yielding anything.

```csharp
var orders = GetOrders();

// Method syntax (most common)
var bigSpenders = orders
    .Where(o => o.Status == OrderStatus.Paid)
    .GroupBy(o => o.CustomerId)
    .Select(g => new { CustomerId = g.Key, Total = g.Sum(o => o.Total) })
    .Where(x => x.Total > 10_000)
    .OrderByDescending(x => x.Total)
    .ToList();                                  // executes here

// Query syntax (compiles to the same calls)
var cities = from c in customers
             where c.IsActive
             orderby c.City
             select c.City;

var query = orders.Where(o => o.Total > 100);   // not executed yet
orders.Add(new Order { Total = 500 });          // will be included
Console.WriteLine(query.Count());               // executes now
```

Why it matters: LINQ code is declarative and short, but deferred execution means the timing of work is not where the code appears. Exceptions, database calls and side effects happen at enumeration.

- Pitfall: calling `Count()` and then iterating a lazy query executes it twice.
- Pitfall: `First()` throws on an empty sequence; `FirstOrDefault()` returns `default`.
- Interview tip: `Any()` is cheaper than `Count() > 0` for non-collection sequences because it stops at the first item.

### Essential LINQ operators and newer additions
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/linq/standard-query-operators/ -->
Knowing which operator to reach for keeps LINQ code clean and efficient.

- Filtering and projection: `Where`, `Select`, `SelectMany` (flattens nested sequences), `OfType<T>`.
- Ordering: `OrderBy`, `ThenBy`, `Order()` (.NET 7, sorts by the element itself).
- Grouping and joining: `GroupBy`, `ToLookup` (eager, multi-valued dictionary), `Join`, `GroupJoin`, `Zip`.
- Aggregation: `Sum`, `Average`, `MinBy`, `MaxBy` (.NET 6), `Aggregate`.
- Partitioning: `Take`, `Skip`, `TakeWhile`, `Chunk(n)` (.NET 6) for batching.
- Sets: `Distinct`, `DistinctBy`, `Union`, `Intersect`, `Except` (and their `By` versions).
- .NET 9 added `CountBy`, `AggregateBy` (group-and-reduce without allocating groups) and `Index()` (pairs each item with its position).
- .NET 10 added `LeftJoin` and `RightJoin`, removing the old `GroupJoin` plus `SelectMany` plus `DefaultIfEmpty` dance.

```csharp
var newest = products.MaxBy(p => p.CreatedAt);

foreach (var batch in ids.Chunk(500))
    await api.UpdateAsync(batch);

var perCity = customers.CountBy(c => c.City);          // KeyValuePair<string,int>
var revenue = orders.AggregateBy(o => o.Region, 0m, (sum, o) => sum + o.Total);

foreach (var (i, item) in items.Index())
    Console.WriteLine($"{i}: {item}");

var allLines = invoices.SelectMany(inv => inv.Lines);

var withManager = employees.LeftJoin(managers,
    e => e.ManagerId, m => m.Id,
    (e, m) => new { e.Name, Manager = m?.Name ?? "none" });   // .NET 10
```

- Pitfall: `GroupBy` followed by `Count()` per group allocates a list per group; `CountBy` does not.
- Pitfall: `Distinct` on objects uses their `Equals`; for classes without value equality, use `DistinctBy(x => x.Id)`.
- Interview tip: LINQ in hot loops has allocation overhead (enumerators, delegates); for performance-critical code, plain loops or spans can still win, though each .NET release narrows the gap.

### Expression trees and IQueryable
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/csharp/advanced-topics/expression-trees/ -->
When a lambda is assigned to `Expression<Func<...>>` instead of `Func<...>`, the compiler does not produce executable code. It produces a data structure describing the code: an expression tree with nodes for parameters, member access, constants and operators.

Libraries can inspect that tree and translate it. Entity Framework Core turns `Where(o => o.Total > 100)` on an `IQueryable<Order>` into `WHERE Total > 100` in SQL. The `Queryable` LINQ methods accept expressions; the `Enumerable` ones accept delegates. Which overload you get depends on the static type of the source.

```csharp
Func<Order, bool> compiled = o => o.Total > 100;              // IL code
Expression<Func<Order, bool>> tree = o => o.Total > 100;      // data

Console.WriteLine(tree.Body);            // (o.Total > 100)
var check = tree.Compile();              // turn data into a delegate at run time

// Build a filter dynamically, e.g. from a search form
ParameterExpression p = Expression.Parameter(typeof(Order), "o");
var body = Expression.GreaterThan(
    Expression.Property(p, nameof(Order.Total)),
    Expression.Constant(100m));
var filter = Expression.Lambda<Func<Order, bool>>(body, p);

var results = db.Orders.Where(filter);   // still translated to SQL
```

Uses beyond ORMs: building dynamic queries, generating fast property accessors once and caching them, and getting member names in a refactor-safe way.

- Pitfall: not every C# expression can be translated. Calling your own method inside an EF query either fails at run time or forces client evaluation.
- Pitfall: `Compile()` is expensive (it emits IL); cache compiled delegates. Under Native AOT there is no JIT, so `Compile()` falls back to an interpreter, which is much slower.
- Interview tip: explain that `IQueryable` plus expression trees is what lets the same LINQ code run in memory or in a database.
