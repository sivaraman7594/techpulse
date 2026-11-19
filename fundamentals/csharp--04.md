## 7. Memory and the runtime
### The stack, the managed heap and object layout
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/standard/garbage-collection/fundamentals -->
Each thread has a stack (typically 1 MB on Windows, 8 MB on Linux for the main thread) holding method frames: parameters, locals and return addresses. Allocation is just moving a pointer, and memory is reclaimed automatically when a method returns.

Objects of reference types live on the managed heap. Allocation is also fast: the runtime hands out memory from a per-thread allocation context by bumping a pointer. The cost comes later, when the garbage collector must find and reclaim dead objects.

Every heap object carries overhead: an object header (used for locking and hash codes) and a method table pointer identifying its type. On 64-bit that is 16 bytes before any fields, and the minimum object size is 24 bytes. A `List<int>` holding five integers is really two objects: the list and its internal array.

```csharp
void Example()
{
    int count = 3;                       // stack (or register)
    var point = (X: 1, Y: 2);            // value tuple: stack
    var order = new Order();             // reference on stack, object on heap
    order.Lines = new List<Line>(count); // two more heap objects
    Span<byte> buffer = stackalloc byte[256]; // stack memory, no GC involvement
}
```

Escape analysis (where the JIT keeps short-lived objects on the stack) has been arriving gradually in recent .NET releases, with .NET 10 able to stack-allocate some small objects and arrays that provably do not escape a method. You should still write code assuming `new` on a class allocates.

- Pitfall: deep or unbounded recursion overflows the stack and kills the process; `StackOverflowException` cannot be caught.
- Interview tip: say "value types are stored inline where they are declared" rather than "value types are on the stack", and give the example of an `int` field inside a class.

### Garbage collection: generations, LOH and GC modes
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/standard/garbage-collection/workstation-server-gc -->
The .NET GC is a generational, compacting, tracing collector. It finds live objects by following references from roots (static fields, locals on thread stacks, CPU registers, GC handles); anything unreachable is garbage.

Generations exploit the fact that most objects die young:
- Gen 0: new objects. Collected very often and cheaply.
- Gen 1: a buffer for objects that survived one collection.
- Gen 2: long-lived objects. Full collections are expensive.
- Large Object Heap (LOH): objects of 85,000 bytes or more. Logically part of gen 2 and not compacted by default, so it can fragment.
- Pinned Object Heap (POH, .NET 5): for buffers that must never move, such as I/O buffers handed to native code.

GC modes:
- Workstation GC: one heap, tuned for desktop apps and low memory.
- Server GC: one heap and GC thread per core, higher throughput, more memory. Default for ASP.NET Core.
- Background GC (on by default) lets gen 2 collection run concurrently with your threads.
- DATAS (Dynamic Adaptation To Application Sizes), enabled by default with Server GC since .NET 9, adjusts the number of heaps to the actual load, greatly reducing memory for containerised services.

```xml
<PropertyGroup>
  <ServerGarbageCollector>true</ServerGarbageCollector>
  <ConcurrentGarbageCollection>true</ConcurrentGarbageCollection>
</PropertyGroup>
```

```bash
dotnet-counters monitor -p 1234 --counters System.Runtime
# watch gen 0/1/2 counts, % time in GC, allocation rate, LOH size
```

- Pitfall: calling `GC.Collect()` manually almost always hurts; it promotes live objects and disrupts the GC's tuning.
- Pitfall: allocating many large arrays (for example building big strings or buffers per request) churns the LOH and triggers costly gen 2 collections; pool them.
- Interview tip: high "% time in GC" usually means high allocation rate; reduce allocations rather than tuning the GC first.

### IDisposable, using and finalizers
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/standard/garbage-collection/implementing-dispose -->
The GC manages memory, but not other resources: file handles, sockets, database connections, OS locks. These must be released deterministically, and `IDisposable.Dispose()` is the contract for that. The `using` statement or declaration calls `Dispose` even if an exception is thrown; `await using` does the same for `IAsyncDisposable`.

```csharp
public sealed class ReportWriter : IAsyncDisposable
{
    private readonly FileStream _file;
    private readonly StreamWriter _writer;

    public ReportWriter(string path)
    {
        _file = new FileStream(path, FileMode.Create, FileAccess.Write,
                               FileShare.None, 4096, useAsync: true);
        _writer = new StreamWriter(_file);
    }

    public Task WriteAsync(string line) => _writer.WriteLineAsync(line);

    public async ValueTask DisposeAsync()
    {
        await _writer.DisposeAsync();   // flushes and closes the stream
    }
}

await using var report = new ReportWriter("out.csv");
await report.WriteAsync("id,total");
```

A finalizer (`~ClassName()`) is a safety net the GC runs on a dedicated thread for objects that were never disposed. Finalizable objects survive at least one extra collection and are queued for the finalizer thread, so they are costly. In modern code you almost never write one: wrap raw OS handles in a `SafeHandle` subclass, which already has a reliable finalizer, and make your class simply dispose that handle.

Rules of thumb:
- If your class owns an `IDisposable` field, implement `IDisposable` yourself.
- Seal the class and you can skip the full `Dispose(bool)` pattern.
- `Dispose` should be idempotent: calling it twice must be harmless.

- Pitfall: disposing an object you did not create (for example an injected `HttpClient` or a DI-provided service) breaks other users of it.
- Interview tip: `using var x = ...;` (C# 8) disposes at the end of the enclosing scope, which may be later than you intend.

### Span, Memory and stackalloc
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/standard/memory-and-spans/ -->
`Span<T>` and `ReadOnlySpan<T>` are views over contiguous memory, whether it is a managed array, part of a string, stack memory from `stackalloc`, or native memory. Slicing a span creates a new view with no copy and no allocation. The JIT treats them as a pointer plus a length, with bounds checks it can often remove.

Because a span can point into the stack, it is a `ref struct`: it cannot be boxed, stored in a class field, or used across `await`. `Memory<T>` / `ReadOnlyMemory<T>` are the heap-storable counterparts used in async APIs; call `.Span` to work on the data synchronously.

```csharp
static int SumCsv(ReadOnlySpan<char> line)
{
    int total = 0;
    foreach (Range r in line.Split(','))          // .NET 9 span split, no allocations
        total += int.Parse(line[r]);
    return total;
}

Console.WriteLine(SumCsv("10,20,30"));   // string converts implicitly to ReadOnlySpan<char>

Span<byte> buffer = stackalloc byte[128];        // small, fixed-size scratch space
if (Utf8.TryWrite(buffer, $"id={42}", out int written))  // System.Text.Unicode
    socket.Send(buffer[..written]);

async Task ProcessAsync(Stream s)
{
    byte[] rented = ArrayPool<byte>.Shared.Rent(8192);
    Memory<byte> mem = rented;                   // Memory survives await
    int n = await s.ReadAsync(mem);
    Parse(mem.Span[..n]);
    ArrayPool<byte>.Shared.Return(rented);
}
```

C# 14 adds implicit conversions between arrays, `Span<T>` and `ReadOnlySpan<T>` in more places (including extension method receivers and generic inference), so span-based APIs feel more natural.

- Pitfall: `stackalloc` with a large or user-controlled size can overflow the stack; cap it (for example 256 to 1024 bytes) and fall back to a pooled array.
- Interview tip: spans are why modern .NET parsers and serializers (System.Text.Json, Kestrel) allocate so little.

### ArrayPool, object pooling and reducing allocations
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/api/system.buffers.arraypool-1 -->
Allocation in .NET is cheap, but garbage is not free: every allocated byte brings the next GC closer, and large temporary buffers land on the LOH. In high-throughput code (servers, parsers, game loops) the usual strategy is to reuse memory.

- `ArrayPool<T>.Shared` lends arrays. `Rent(n)` returns an array of at least `n` elements (often larger); you must `Return` it, ideally in a `finally`.
- `ObjectPool<T>` (Microsoft.Extensions.ObjectPool) reuses expensive objects such as `StringBuilder`.
- `RecyclableMemoryStream` (a Microsoft library) replaces `MemoryStream` for large, frequent buffers.

```csharp
public static string ToHex(ReadOnlySpan<byte> data)
{
    char[]? rented = null;
    Span<char> chars = data.Length * 2 <= 512
        ? stackalloc char[data.Length * 2]
        : (rented = ArrayPool<char>.Shared.Rent(data.Length * 2));
    try
    {
        Convert.TryToHexString(data, chars, out int written);   // .NET 9
        return new string(chars[..written]);
    }
    finally
    {
        if (rented is not null) ArrayPool<char>.Shared.Return(rented);
    }
}
```

Other allocation-reducing habits:
- Pre-size `List<T>`, `Dictionary` and `StringBuilder` when the size is known.
- Avoid LINQ and closures in the hottest loops.
- Use `string.Create` or interpolated string handlers instead of repeated concatenation.
- Prefer `struct` enumerators and `foreach` over arrays and `List<T>` rather than over `IEnumerable<T>` (which boxes the enumerator).

- Pitfall: using a rented array after returning it, or returning it twice, causes data corruption that is very hard to debug.
- Pitfall: rented arrays are not cleared; never assume zeros, and pass `clearArray: true` when returning buffers that held secrets.
- Interview tip: always measure with a profiler or BenchmarkDotNet's memory diagnoser before pooling; pooling adds complexity.

### ref locals, ref returns and scoped
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/ref -->
`ref` is not only for parameters. A method can return a reference to a storage location (`ref return`), and a local can hold such a reference (`ref local`). This lets you read and modify an element of a large struct array in place without copying it.

```csharp
public struct Particle { public float X, Y, Vx, Vy; }

public class World
{
    private readonly Particle[] _particles = new Particle[100_000];
    public ref Particle At(int i) => ref _particles[i];   // ref return

    public void Step(float dt)
    {
        for (int i = 0; i < _particles.Length; i++)
        {
            ref Particle p = ref _particles[i];   // no copy of the 16-byte struct
            p.X += p.Vx * dt;
            p.Y += p.Vy * dt;
        }
    }
}

world.At(5).Vx = 2f;    // modifies the element in the array

// ref readonly prevents modification through the reference
ref readonly Particle peek = ref world.At(0);
```

C# 11 introduced `ref` fields inside `ref struct` types (this is how `Span<T>` is now implemented in C#) and the `scoped` keyword. `scoped` tells the compiler a ref or span parameter will not escape the method, which allows callers to pass stack-allocated memory safely.

```csharp
static void Fill(scoped Span<byte> dest) { dest.Fill(0xFF); }
```

The compiler enforces "ref safety" rules so you can never return a reference to a local variable that is about to disappear.

- Pitfall: returning `ref` into a `List<T>`'s internal array (via `CollectionsMarshal.AsSpan`) becomes invalid if the list grows and reallocates.
- Interview tip: these features matter mostly to library and engine authors; mentioning when not to use them shows maturity.

### Interop: P/Invoke and LibraryImport
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/standard/native-interop/pinvoke -->
Platform Invoke (P/Invoke) lets managed code call functions in native libraries such as `kernel32.dll`, `libc` or a vendor SDK. You declare a `static extern` method with the native signature, and the runtime marshals arguments across the boundary.

.NET 7 introduced the `LibraryImport` source generator, which generates the marshalling code at compile time instead of the runtime generating IL stubs. It is faster, trimming and Native AOT friendly, and makes the marshalling visible and debuggable. It is the recommended approach for new code.

```csharp
using System.Runtime.InteropServices;

internal static partial class Native
{
    [LibraryImport("libc", EntryPoint = "getpid")]
    internal static partial int GetPid();

    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16,
                   SetLastError = true)]
    internal static partial int MessageBoxW(nint hWnd, string text, string caption, uint type);
}

int pid = Native.GetPid();
if (Native.MessageBoxW(0, "Saved", "App", 0) == 0)
    throw new System.ComponentModel.Win32Exception(Marshal.GetLastPInvokeError());
```

Concepts you need when doing interop:
- Blittable types (`int`, `double`, structs of them) have the same layout in managed and native memory and pass without conversion.
- Strings and arrays need marshalling; be explicit about encoding (UTF-8 vs UTF-16).
- Native memory you allocate must be freed by you; `SafeHandle` ties native handles to the GC safely.
- `unsafe` code and pointers (`fixed`, `byte*`) are allowed with `<AllowUnsafeBlocks>`.

- Pitfall: wrong signatures (for example `int` vs `long` for a 64-bit size) corrupt memory or crash, with no compiler help.
- Interview tip: interop calls have overhead; batch work so you cross the boundary rarely.

## 8. Error handling and defensive code
### Designing exceptions and custom exception types
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/standard/exceptions/how-to-create-user-defined-exceptions -->
Good exception design makes failures diagnosable and lets callers react to the cases they can handle.

The BCL already covers many situations; prefer these before inventing your own:
- `ArgumentException`, `ArgumentNullException`, `ArgumentOutOfRangeException` for bad inputs.
- `InvalidOperationException` when the object's state does not allow the call.
- `NotSupportedException` for operations a type deliberately does not support.
- `OperationCanceledException` / `TaskCanceledException` for cancellation.
- `TimeoutException`, `IOException`, `HttpRequestException` for infrastructure failures.

Create a custom exception when callers need to catch that specific failure and handle it differently, or when you need to carry structured data.

```csharp
public sealed class InsufficientStockException : Exception
{
    public InsufficientStockException(string sku, int requested, int available)
        : base($"SKU {sku}: requested {requested}, only {available} available")
    {
        Sku = sku;
        Requested = requested;
        Available = available;
    }

    public string Sku { get; }
    public int Requested { get; }
    public int Available { get; }
}

try { inventory.Reserve(sku, qty); }
catch (InsufficientStockException ex) when (ex.Available > 0)
{
    return Offer(ex.Sku, ex.Available);    // partial fulfilment
}
```

Guidelines:
- Name ends in `Exception`; derive from `Exception` (not `ApplicationException`).
- Messages should explain what went wrong and ideally how to fix it, without leaking secrets or personal data.
- Pass the original exception as `innerException` when wrapping so the root cause is preserved.

- Pitfall: one giant hierarchy of domain exceptions used for ordinary validation results makes code slow and hard to follow.
- Interview tip: mention that the legacy serialization constructor for exceptions is obsolete in .NET 8+ and no longer needed.

### Exception best practices: rethrowing, aggregation and cost
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/standard/exceptions/best-practices-for-exceptions -->
Handling exceptions well is mostly about discipline:

- Catch where you can do something useful: retry, fall back, translate, or add context. Otherwise let it propagate to a top-level handler that logs and returns an error.
- Use `throw;` to rethrow; `throw ex;` loses the original stack trace.
- To rethrow later (for example from another thread), capture with `ExceptionDispatchInfo.Capture(ex)` and call `.Throw()`, which preserves the trace.
- Clean up with `using` or `finally`, not by catching everything.
- Do not use exceptions for expected outcomes. Throwing and catching costs microseconds each (stack walk and trace capture), which is a disaster in a hot loop.

```csharp
try
{
    await paymentGateway.ChargeAsync(order, ct);
}
catch (HttpRequestException ex) when (ex.StatusCode is HttpStatusCode.ServiceUnavailable)
{
    logger.LogWarning(ex, "Gateway unavailable for {OrderId}", order.Id);
    throw new PaymentDeferredException(order.Id, ex);   // add context, keep inner
}

// Several tasks may fail; inspect all of them
var all = Task.WhenAll(tasks);
try { await all; }
catch
{
    foreach (var inner in all.Exception!.InnerExceptions)
        logger.LogError(inner, "Batch item failed");
    throw;
}
```

`AggregateException` wraps multiple failures from parallel work. `await` unwraps it and throws only the first, so look at the task's `Exception` property to see them all.

- Pitfall: `catch (Exception)` around cancellation-aware code accidentally swallows `OperationCanceledException`, so shutdown hangs. Filter it out or rethrow it.
- Pitfall: logging and rethrowing at every layer produces the same error five times in logs; log once at the boundary.
- Interview tip: .NET 9 sped up exception throwing considerably with a new managed implementation, but the guidance against using them for control flow still stands.

### Guard clauses and argument validation
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/api/system.argumentnullexception.throwifnull -->
Public methods should reject invalid input immediately, close to the mistake, rather than failing later with a confusing `NullReferenceException` deep inside. These checks are called guard clauses.

Modern .NET provides static throw helpers that are concise, consistent, and JIT-friendly (the throwing code is kept out of the hot path):

- `ArgumentNullException.ThrowIfNull(x)` (.NET 6)
- `ArgumentException.ThrowIfNullOrEmpty(s)` and `ThrowIfNullOrWhiteSpace(s)` (.NET 7/8)
- `ArgumentOutOfRangeException.ThrowIfNegative`, `ThrowIfZero`, `ThrowIfGreaterThan` and friends (.NET 8)
- `ObjectDisposedException.ThrowIf(disposed, this)` (.NET 7)

Thanks to `[CallerArgumentExpression]`, the parameter name is filled in automatically.

```csharp
public Invoice CreateInvoice(Customer customer, IReadOnlyList<Line> lines, int dueDays)
{
    ArgumentNullException.ThrowIfNull(customer);
    ArgumentNullException.ThrowIfNull(lines);
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(dueDays);
    ArgumentOutOfRangeException.ThrowIfGreaterThan(dueDays, 180);
    if (lines.Count == 0)
        throw new ArgumentException("An invoice needs at least one line.", nameof(lines));

    return new Invoice(customer, lines, DateTime.UtcNow.AddDays(dueDays));
}

// Your own helper with automatic expression capture
static void Require(bool condition,
    [CallerArgumentExpression(nameof(condition))] string? expr = null)
{
    if (!condition) throw new ArgumentException($"Requirement failed: {expr}");
}
```

Distinguish programmer errors (null arguments, invalid enum values) from user errors (an invalid email in a form). Guard clauses throw for the first; validation of user input should return friendly results, not exceptions.

- Pitfall: nullable annotations alone do not protect a public library; callers with NRT disabled can still pass null.
- Interview tip: guard at boundaries (public APIs) and trust internal code to reduce noise.

### Result types vs exceptions and the Try pattern
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/standard/design-guidelines/exceptions-and-performance -->
Not every failure is exceptional. Parsing user input, looking up an optional record, or validating a form often fails as part of normal operation. Using exceptions for these is slow and hides control flow.

Two established alternatives:

- The Try pattern: `bool TryXxx(..., out T result)`, as in `int.TryParse` and `Dictionary.TryGetValue`. Cheap, allocation-free and idiomatic.
- A result type: return an object that represents success or failure explicitly. The BCL has no general `Result<T>`, so teams write a small one or use a library. With records and pattern matching it reads well.

```csharp
public abstract record RegistrationResult
{
    public sealed record Success(int UserId) : RegistrationResult;
    public sealed record EmailTaken(string Email) : RegistrationResult;
    public sealed record Invalid(IReadOnlyList<string> Errors) : RegistrationResult;
}

public async Task<RegistrationResult> RegisterAsync(SignUp req)
{
    var errors = Validate(req);
    if (errors.Count > 0) return new RegistrationResult.Invalid(errors);
    if (await users.ExistsAsync(req.Email)) return new RegistrationResult.EmailTaken(req.Email);
    var id = await users.CreateAsync(req);
    return new RegistrationResult.Success(id);
}

var result = await service.RegisterAsync(req);
IResult http = result switch
{
    RegistrationResult.Success s    => Results.Created($"/users/{s.UserId}", null),
    RegistrationResult.EmailTaken   => Results.Conflict(),
    RegistrationResult.Invalid i    => Results.ValidationProblem(
                                           new Dictionary<string, string[]> { ["form"] = [.. i.Errors] }),
    _ => throw new UnreachableException(),
};
```

The type signature now documents every outcome, and the compiler helps you handle each one.

- Pitfall: result types everywhere, including for genuine infrastructure failures (database down), make code verbose; keep exceptions for the truly unexpected.
- Interview tip: `UnreachableException` (.NET 7) clearly marks code paths that should never execute.

### Nullable analysis attributes for precise APIs
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/attributes/nullable-analysis -->
The nullable reference type analysis only knows what signatures tell it. For methods whose null behaviour depends on conditions, attributes in `System.Diagnostics.CodeAnalysis` describe the contract precisely so callers get accurate warnings and no false positives.

Most useful ones:
- `[NotNullWhen(true)]` on an `out` or input parameter: when the method returns true, the argument is not null. Used by `TryGetValue` and `string.IsNullOrEmpty`.
- `[MaybeNullWhen(false)]`: the out value may be null when the method returns false.
- `[NotNull]`: after the call returns, the argument is known not null (useful for guard helpers).
- `[DoesNotReturn]`: the method always throws, so code after it is unreachable.
- `[MemberNotNull(nameof(_field))]`: after this helper runs, the field is initialised.
- `[return: NotNullIfNotNull(nameof(input))]`: the result is non-null whenever the input is non-null.

```csharp
public bool TryFindUser(string email, [NotNullWhen(true)] out User? user)
{
    user = _cache.GetValueOrDefault(email);
    return user is not null;
}

if (TryFindUser("a@b.com", out var u))
    Console.WriteLine(u.Name);          // no warning: compiler knows u is not null

public static void EnsureNotNull([NotNull] object? value, string name)
{
    if (value is null) Fail(name);
}

[DoesNotReturn]
private static void Fail(string name) => throw new ArgumentNullException(name);

[return: NotNullIfNotNull(nameof(text))]
public static string? Normalize(string? text) => text?.Trim().ToLowerInvariant();
```

These attributes have no run-time effect. They exist purely to make the compile-time analysis smarter, which is why every modern BCL API is annotated with them.

- Pitfall: an attribute that lies (claims non-null when the value can be null) is worse than none, because it silences real warnings.
- Interview tip: knowing these attributes signals real experience migrating codebases to nullable reference types.
