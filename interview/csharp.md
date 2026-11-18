# C# / .NET interview questions

Format: each `### ` heading is a question. The comment line sets level (basic / intermediate / advanced),
kind (concept / scenario) and ref (official documentation link shown as the source).

### What is the difference between a class and a struct in C#?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/struct -->
- A **class** is a reference type: variables hold a reference, and assigning it copies the reference, so both variables point to the same object.
- A **struct** is a value type: assigning or passing it copies the whole value. Structs cannot inherit from another struct or class (they can implement interfaces).
- Structs suit small, immutable, value-like data (points, money, coordinates). Classes suit entities with identity and behaviour.
- Large mutable structs are a common mistake: copies are made silently, so changes may be lost.

```csharp
var a = new PointStruct { X = 1 };
var b = a;   // copy
b.X = 5;     // a.X is still 1

var c = new PointClass { X = 1 };
var d = c;   // same object
d.X = 5;     // c.X is now 5
```

### What is the difference between `string` and `StringBuilder`?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/dotnet/standard/base-types/stringbuilder -->
`string` is immutable — every concatenation creates a new string object. `StringBuilder` keeps a mutable buffer, so appending many times avoids creating lots of temporary strings.

Use `StringBuilder` when building text in a loop or with many appends. For a few concatenations, plain `+` or string interpolation is clearer and the compiler optimises it.

```csharp
var sb = new StringBuilder();
foreach (var line in lines) sb.AppendLine(line);
string result = sb.ToString();
```

### What is the difference between `const` and `readonly`?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/readonly -->
- `const` is a compile-time constant. Its value is baked into every assembly that uses it, and it only works for primitive types, strings and enums.
- `readonly` is set at runtime — in the declaration or the constructor — and can hold any type.
- Because `const` values are copied into callers, changing a public `const` in a library requires recompiling consumers. Prefer `static readonly` for values that might change between versions.

### What are boxing and unboxing, and why do they matter?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/dotnet/csharp/programming-guide/types/boxing-and-unboxing -->
Boxing wraps a value type in an object on the heap (for example assigning an `int` to `object`). Unboxing extracts it back with an explicit cast.

It matters for performance: each boxing allocates memory and adds garbage-collection work. Generics (`List<int>` instead of `ArrayList`) avoid boxing.

```csharp
int n = 42;
object o = n;      // boxing (heap allocation)
int m = (int)o;    // unboxing
```

### What is the difference between `IEnumerable<T>` and `IQueryable<T>`?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/dotnet/framework/data/adonet/ef/language-reference/queries-in-linq-to-entities -->
- `IEnumerable<T>` runs LINQ **in memory** using compiled delegates (LINQ to Objects).
- `IQueryable<T>` builds an **expression tree** that a provider such as Entity Framework Core translates, for example into SQL, so filtering happens in the database.
- Classic bug: calling `.ToList()` or `.AsEnumerable()` too early loads the whole table and then filters in memory.

```csharp
// Filter runs in SQL
var active = db.Users.Where(u => u.IsActive).ToList();

// Loads ALL users, then filters in memory
var slow = db.Users.AsEnumerable().Where(u => u.IsActive).ToList();
```

### How do `async` and `await` work?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/dotnet/csharp/asynchronous-programming/ -->
`async` lets a method use `await`. When it awaits an operation that is not finished (an HTTP call, a database query), the method returns an incomplete `Task` to its caller and the thread is freed. When the operation completes, the rest of the method continues.

Key points:
- `async` does not create a new thread; it is about not blocking threads while waiting for I/O.
- Return `Task` or `Task<T>`; use `async void` only for event handlers.
- Do not block on async code with `.Result` or `.Wait()` — it wastes threads and can deadlock.
- For CPU-bound work, use `Task.Run` (or parallelism), not `async` alone.

### How does garbage collection work in .NET, and what is `IDisposable` for?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/dotnet/standard/garbage-collection/fundamentals -->
The GC automatically frees managed memory. It is **generational**: new objects go into generation 0, objects that survive collections move to generations 1 and 2, and large objects (85,000 bytes or more) go to the Large Object Heap. Most objects die young, so gen 0 collections are cheap.

The GC does not know when to release **unmanaged resources** (file handles, sockets, database connections). Types holding them implement `IDisposable`. Call `Dispose()` — usually with `using` — to release them immediately.

```csharp
using var stream = File.OpenRead(path);   // disposed at end of scope
```

### What are records in C#?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/record -->
Records are types designed for data. They give you:
- **Value-based equality**: two records with the same property values are equal.
- **Non-destructive mutation** with `with` expressions.
- A readable `ToString()` and concise positional syntax.

`record` (or `record class`) is a reference type; `record struct` is a value type. They are ideal for DTOs, messages and value objects.

```csharp
public record Person(string Name, int Age);
var p1 = new Person("Asha", 30);
var p2 = p1 with { Age = 31 };
Console.WriteLine(p1 == new Person("Asha", 30)); // True
```

### What are delegates, `Func`, `Action` and events?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/dotnet/csharp/programming-guide/delegates/ -->
A **delegate** is a type-safe reference to a method. `Func<...>` is a built-in delegate that returns a value; `Action<...>` returns nothing; `Predicate<T>` returns bool.

An **event** is a delegate wrapped so that outside code can only subscribe (`+=`) and unsubscribe (`-=`), while only the owner can raise it.

```csharp
Func<int, int, int> add = (a, b) => a + b;
Action<string> log = msg => Console.WriteLine(msg);
button.Click += (s, e) => log("clicked");
```

### What are `Span<T>` and `Memory<T>`, and when would you use them?
<!-- level: advanced; kind: concept; ref: https://learn.microsoft.com/dotnet/standard/memory-and-spans/ -->
`Span<T>` is a view over contiguous memory (an array, part of a string, stack memory) without copying. It is a `ref struct`, so it lives only on the stack and cannot be stored in fields of classes or used across `await`.

`Memory<T>` is the heap-friendly counterpart that can be stored and used in async code; call `.Span` when you need to work with it.

Use them in performance-sensitive parsing and buffer handling to avoid allocations, e.g. slicing a string without `Substring`.

```csharp
ReadOnlySpan<char> text = "2026-11-18";
int year = int.Parse(text[..4]);   // no substring allocation
```

### What is the difference between `Task.WhenAll` and awaiting tasks one by one?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/dotnet/api/system.threading.tasks.task.whenall -->
Awaiting each task in sequence waits for one before starting the next. Starting all tasks first and then awaiting `Task.WhenAll` runs independent operations concurrently, so the total time is roughly the slowest one, not the sum.

```csharp
var userTask = GetUserAsync(id);
var ordersTask = GetOrdersAsync(id);
await Task.WhenAll(userTask, ordersTask);
var (user, orders) = (userTask.Result, ordersTask.Result); // already completed
```

Note: with `WhenAll`, if several tasks fail, `await` throws the first exception; inspect each task (or the returned task's `Exception`) to see all of them.

### Your .NET service's memory keeps growing in production. How do you investigate?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/dotnet/core/diagnostics/debug-memory-leak -->
1. **Confirm the trend** with metrics: `dotnet-counters monitor` (GC heap size, gen 2 size, allocation rate) or Application Insights / OpenTelemetry.
2. **Capture the heap**: `dotnet-gcdump collect -p <pid>` (lightweight) or `dotnet-dump collect` for a full dump. Take two snapshots some time apart and compare which types grow.
3. **Analyse** in Visual Studio, PerfView or `dotnet-dump analyze` (`dumpheap -stat`, `gcroot`) to find what keeps objects alive.

Common causes:
- Event handlers never unsubscribed (the publisher keeps subscribers alive).
- Unbounded static caches or dictionaries — use `MemoryCache` with size limits/expiration.
- Not disposing `IDisposable` objects; creating a new `HttpClient` per request instead of `IHttpClientFactory`.
- Large arrays on the Large Object Heap — consider `ArrayPool<T>`.

### A method that calls `.Result` on an async API hangs. Why, and how do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/archive/msdn-magazine/2013/march/async-await-best-practices-in-asynchronous-programming -->
This is the classic **sync-over-async deadlock**. In environments with a single-threaded `SynchronizationContext` (WinForms, WPF, classic ASP.NET), `.Result` blocks the only thread. The awaited task wants to resume on that same thread, which is blocked waiting for it — so neither can continue.

Fixes:
- Make the call chain **async all the way**: `await` the task instead of `.Result` / `.Wait()`.
- In library code, `ConfigureAwait(false)` avoids resuming on the captured context.
- ASP.NET Core has no `SynchronizationContext`, so it does not deadlock this way — but blocking still wastes thread-pool threads and can cause thread-pool starvation under load.

### Several threads update a shared counter and the total is wrong. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/threading/managed-threading-best-practices -->
`count++` is read-modify-write and is not atomic, so concurrent updates are lost (a race condition).

Options, from lightest to heaviest:
- `Interlocked.Increment(ref count)` for simple numeric updates.
- `lock` for updating several related fields together.
- Concurrent collections such as `ConcurrentDictionary<TKey,TValue>` (e.g. `AddOrUpdate`) instead of locking a normal dictionary.
- Avoid shared mutable state altogether — e.g. aggregate per-thread results and combine at the end.

```csharp
Interlocked.Increment(ref _count);

lock (_sync) { _total += amount; _items++; }
```
