# C# / .NET scenario questions

### A worker service processes queue messages fine at low volume, but at peak its latency jumps to many seconds while CPU stays at 20%. What do you suspect and how do you confirm it?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/dotnet/core/diagnostics/debug-threadpool-starvation -->
Low CPU plus high latency means threads are waiting, not working. The prime suspect is thread-pool starvation caused by blocking calls.

1. Observe: run `dotnet-counters monitor -n Worker --counters System.Runtime` during peak. Starvation shows a growing `ThreadPool Queue Length` and a thread count creeping up by roughly one or two per second.
2. Hypothesise: something blocks pool threads, such as `.Result`, `.Wait()`, `Thread.Sleep`, synchronous HTTP or database calls, or a `lock` around I/O.
3. Verify: take a dump (`dotnet-dump collect`) and run `clrstack -all` or use the Parallel Stacks view. Dozens of threads parked in `Task.Wait`, `Monitor.Enter` or a sync socket read confirm it.
4. Fix: make the path async end to end (`await` instead of `.Result`), replace `lock` around I/O with `SemaphoreSlim.WaitAsync`, and cap message concurrency explicitly with `Parallel.ForEachAsync` or a bounded channel.
5. Prevent: enable analyzers that flag sync-over-async, add an alert on thread-pool queue length, and load test before releases.

```csharp
// Before
var customer = _crm.GetCustomerAsync(id).Result;
// After
var customer = await _crm.GetCustomerAsync(id, ct);
```

Common wrong answer: "Increase `ThreadPool.SetMinThreads`." It can buy time during an incident, but it hides the blocking and costs memory; it is a mitigation, not the fix.

### A code review finds `catch (Exception ex) { throw ex; }` and `catch { }` scattered through a service. What feedback do you give?
<!-- level: basic; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/exceptions/best-practices-for-exceptions -->
Both patterns destroy diagnostic information and can hide data corruption.

- `throw ex;` resets the stack trace to the current line, so production logs point at the catch block instead of the real failure. Use `throw;` to rethrow, or wrap with context: `throw new OrderSyncException("Sync failed for 42", ex);`.
- `catch { }` silently swallows everything, including bugs (`NullReferenceException`), cancellation (`OperationCanceledException`) and out-of-memory conditions. The operation looks successful while state may be half-updated.

Suggested approach:
1. Catch only exceptions you can handle meaningfully (retry a transient `HttpRequestException`, fall back on `FileNotFoundException`).
2. Use exception filters for precision: `catch (SqlException ex) when (ex.Number == 1205)` for deadlock retries.
3. Let everything else bubble up to one global handler (middleware, `BackgroundService` wrapper) that logs once with context and returns a proper error.
4. Never swallow `OperationCanceledException` in cancellable code.

```csharp
catch (HttpRequestException ex) when (IsTransient(ex))
{
    _log.LogWarning(ex, "Transient failure syncing {OrderId}, will retry", id);
    throw;   // preserves the stack; retry policy upstream handles it
}
```

Interview angle: explain why logging and rethrowing at every layer is also an anti-pattern (duplicate log entries), and suggest an analyzer rule (CA2200 flags `throw ex;`).

### Your service occasionally pegs a CPU core at 100% forever, and dumps show threads stuck inside `Dictionary.FindValue`. What happened?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/collections/thread-safe/ -->
This is the signature of a `Dictionary<TKey,TValue>` mutated concurrently from several threads. `Dictionary` is not thread-safe for writes; a concurrent resize or insert can corrupt the internal bucket chains into a cycle, and subsequent lookups loop forever.

Investigation:
1. In the dump, `clrstack -all` shows several threads in `FindValue`, `TryInsert` or `Resize` of the same dictionary instance.
2. Find where the dictionary lives: usually a `static` field or a singleton service used as a cache.
3. Search for writes to it from request-handling or parallel code.

Fixes, depending on usage:
- Replace with `ConcurrentDictionary<TKey,TValue>` and use `GetOrAdd` / `AddOrUpdate`.
- If it is built once and then only read, build it at startup and freeze it (`ToFrozenDictionary()`); concurrent reads of an unchanging dictionary are safe.
- If writes must update several structures together, protect them with a `lock`.
- For caching, use `IMemoryCache` with size limits rather than a hand-made static dictionary.

```csharp
private static readonly ConcurrentDictionary<string, Lazy<Rate>> Cache = new();
public Rate Get(string key) =>
    Cache.GetOrAdd(key, k => new Lazy<Rate>(() => LoadRate(k))).Value;
```

Prevent: code review rule "no mutable static collections", and a concurrency stress test for shared components. Wrong answer: "add a try/catch" — corruption does not throw; it hangs.

### A log-parsing job allocates several gigabytes per run and spends 40% of its time in GC. How would you optimise it?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/memory-and-spans/memory-t-usage-guidelines -->
1. Observe: confirm with `dotnet-counters` (allocation rate, % time in GC, gen 0 count) and profile allocations with `dotnet-trace` (gc-verbose) or Visual Studio's allocation tool to see which call sites allocate.
2. Typical culprits in parsers: `File.ReadAllLines` (whole file in memory), `line.Split(' ')` creating arrays and substrings per line, `Substring`, `string.Format`, LINQ chains per line, and boxing of numbers.
3. Fix step by step, measuring each change with BenchmarkDotNet's `[MemoryDiagnoser]`:
   - Stream input with `File.ReadLines` or a `StreamReader`/`PipeReader` instead of loading everything.
   - Parse with `ReadOnlySpan<char>`: `IndexOf`, slicing, and `int.Parse(span)`.
   - Aggregate into pre-sized dictionaries; use `CollectionsMarshal.GetValueRefOrAddDefault` to update counts without double lookups.
   - Reuse buffers with `ArrayPool<T>`.
   - Avoid creating strings for keys that repeat; .NET 9's `Dictionary.GetAlternateLookup<ReadOnlySpan<char>>()` looks up string keys by span.

```csharp
foreach (var line in File.ReadLines(path))
{
    ReadOnlySpan<char> s = line;
    int sp = s.IndexOf(' ');
    var status = int.Parse(s.Slice(sp + 1, 3));
    ref int count = ref CollectionsMarshal.GetValueRefOrAddDefault(counts, status, out _);
    count++;
}
```

Trade-off: span code is less readable; keep it confined to the hot path and covered by tests. Wrong answer: "Tune GC settings" before reducing allocations.

### You need to migrate a .NET Framework 4.8 class library used by several apps to modern .NET. How do you plan it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/core/porting/ -->
1. Assess: run the .NET Upgrade Assistant or API Portability analysis to find APIs unavailable on modern .NET (`System.Web`, WCF server, `AppDomain` creation, Remoting, `BinaryFormatter`). Inventory NuGet dependencies and check each has a modern-compatible version.
2. Choose targets: if Framework apps still consume the library during the transition, multi-target (`<TargetFrameworks>net48;net10.0</TargetFrameworks>`) or target `netstandard2.0` for shared parts. Use `#if NET48` sparingly for platform-specific code.
3. Convert the project to SDK-style format first, keep behaviour identical, and get tests passing on `net48`.
4. Add the modern target, fix compile errors, and replace removed technologies: `System.Text.Json` or keep Newtonsoft, `HttpClient` instead of `WebClient`, `Microsoft.Extensions.Configuration` instead of `ConfigurationManager` (or use the compatibility package temporarily).
5. Test on both targets in CI, including behavioural differences: globalisation (ICU vs NLS on Windows), default TLS behaviour, and string comparison culture.
6. Release as a new package version, migrate consumers one at a time, then drop the `net48` target.

```xml
<TargetFrameworks>net48;net10.0</TargetFrameworks>
<ItemGroup Condition="'$(TargetFramework)' == 'net48'">
  <Reference Include="System.Web" />
</ItemGroup>
```

Common mistakes: big-bang rewrites, skipping the SDK-style conversion step, and ignoring `BinaryFormatter` usage, which is removed in .NET 9 and later.

### Your team wants to enable nullable reference types in a 300-project legacy solution. How do you roll it out?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/csharp/nullable-migration-strategies -->
Turning `<Nullable>enable</Nullable>` on everywhere at once produces tens of thousands of warnings that nobody fixes, so plan an incremental migration.

1. Start with the leaves: libraries with no internal dependencies (shared models, utilities). Their annotations then flow to every consumer.
2. Within a project, either enable it project-wide and fix file by file, or use `#nullable enable` at the top of files you touch (the "boy scout" approach). Some teams use `<Nullable>warnings</Nullable>` first to see warnings without changing annotations.
3. Annotate honestly: make types `T?` where null is genuinely possible, add guard clauses on public APIs, and use attributes like `[NotNullWhen(true)]` for `TryXxx` methods.
4. Watch for patterns that need design changes: properties set by serializers or EF (use `required`, constructors, or `= null!` only for framework-initialised members with a comment).
5. Lock in progress: once a project is clean, set `<WarningsAsErrors>nullable</WarningsAsErrors>` so it cannot regress.
6. Track metrics: number of projects enabled and warnings remaining, visible on a dashboard.

```csharp
public bool TryGetCustomer(int id, [NotNullWhen(true)] out Customer? customer)
```

Wrong answers: sprinkling `!` to silence warnings (it hides real bugs), or believing NRT adds runtime checks; it does not, so public APIs still need `ArgumentNullException.ThrowIfNull`.

### After a deployment, one app crashes at startup with `FileLoadException: Could not load file or assembly ... version 8.0.0.0`. How do you resolve it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/nuget/concepts/dependency-resolution -->
This is a dependency version conflict: some component was compiled against one version of an assembly, but a different version was deployed.

1. Observe: read the full exception, including the requested version and the public key token, and the stack trace showing which assembly asked for it.
2. Inspect the graph: `dotnet list package --include-transitive` and the `project.assets.json` show which package brings which version. Look for NU1605 or NU1608 warnings (downgrades, version outside range) that were ignored.
3. Common causes:
   - Two packages depend on different major versions of the same library (for example two different `Microsoft.Extensions.*` majors).
   - A package targets a newer runtime than the app (a 9.x Microsoft.Extensions package in a `net8.0` app is usually fine, but mixing majors across the graph is not).
   - A stale DLL left in the deployment folder because the deploy copies files without cleaning.
   - Plugins loaded into the default load context bringing their own versions.
4. Fix: align versions centrally (Central Package Management), add an explicit top-level `PackageReference` to force the higher version, clean deployment folders, and for plugins use a separate `AssemblyLoadContext`.
5. Prevent: treat NuGet warnings NU1605/NU1608 as errors, use lock files for reproducible restores, and run a smoke test of the published output in CI.

Interview angle: modern .NET has no binding redirects in app.config; the deps.json produced at build time determines which versions load.

### Tests that check subscription expiry pass locally but fail randomly in CI around midnight. What is wrong and how do you fix it?
<!-- level: basic; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/datetime/timeprovider-overview -->
The code almost certainly reads the real clock (`DateTime.Now` or `DateTime.UtcNow`) inside the logic under test, and the tests compute expectations with a separate clock call. Around midnight, or with a different time zone on the CI agent, the two readings fall on different days.

1. Confirm: find `DateTime.Now`/`UtcNow`/`DateTimeOffset.Now` in the code path; check the CI agent's time zone (often UTC) versus developers' machines.
2. Fix the design: inject `TimeProvider` (.NET 8) and call `GetUtcNow()`. In production register `TimeProvider.System`.
3. Fix the tests: use `FakeTimeProvider` from `Microsoft.Extensions.TimeProvider.Testing`, set a fixed instant, and advance it explicitly. Include edge cases: one second before expiry, exactly at expiry, DST changes and month ends.
4. Also fix the hidden bug: decide whether "expiry" means a UTC instant or a local calendar date, and model it with `DateTimeOffset` or `DateOnly` plus a time zone.

```csharp
public sealed class Subscriptions(TimeProvider clock)
{
    public bool IsActive(Subscription s) => clock.GetUtcNow() < s.EndsAtUtc;
}

var clock = new FakeTimeProvider(DateTimeOffset.Parse("2026-03-31T23:59:59Z"));
Assert.True(new Subscriptions(clock).IsActive(sub));
clock.Advance(TimeSpan.FromSeconds(1));
Assert.False(new Subscriptions(clock).IsActive(sub));
```

`TimeProvider` also abstracts timers and `Task.Delay`, so retry and timeout logic becomes testable without real waiting.

### You must model money in a billing system. Would you use `double`, `decimal`, a class, a record or a struct?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/floating-point-numeric-types -->
Start with the number type: `decimal`, never `double`. Binary floating point cannot represent 0.10 exactly, so sums drift and rounding produces off-by-one-cent errors that auditors find.

Then wrap it in a type, because a bare `decimal` does not know its currency and lets you add rupees to dollars. A small immutable value type fits well:

```csharp
public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money operator +(Money a, Money b)
    {
        if (a.Currency != b.Currency) throw new InvalidOperationException("Currency mismatch");
        return new(a.Amount + b.Amount, a.Currency);
    }

    public Money Round() =>
        this with { Amount = Math.Round(Amount, 2, MidpointRounding.ToEven) };
}
```

Why `readonly record struct`:
- Value semantics and equality come free; two `Money(10, "INR")` are equal.
- No heap allocation for a 24-ish byte value (a 16-byte `decimal` plus a reference).
- Immutable, so it is safe to share.

A `record class` is also acceptable if you prefer reference semantics or need inheritance; the allocation cost is rarely significant in billing.

Further design decisions to raise:
- Rounding rules: banker's rounding vs away-from-zero, and at which step (per line or per invoice). Agree with finance and encode it in one place.
- Currency precision (JPY has 0 decimals, KWD has 3).
- Allocation: splitting 100 into three parts must distribute the leftover cent deterministically.
- Persistence: store amount as `decimal(19,4)` plus an ISO currency code.

### A long-running process deadlocks occasionally. Dumps show thread A holding lock X waiting for Y, and thread B holding Y waiting for X. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/threading/managed-threading-best-practices -->
This is a classic lock-ordering deadlock: two code paths acquire the same two locks in opposite orders.

1. Confirm with the dump: `dotnet-dump analyze`, then `syncblk` lists owned monitors and `clrstack` on each thread shows the waiting call. With the .NET 9 `Lock` type, look for threads in `Lock.Enter`.
2. Locate both code paths, for example `Transfer(from, to)` locking `from` then `to`, called concurrently as `Transfer(a, b)` and `Transfer(b, a)`.
3. Fix options:
   - Impose a global order: always lock the object with the lower id first.
   - Reduce to one lock if the data is closely related.
   - Avoid holding a lock while calling out to other components (callbacks, events, logging sinks that lock internally).
   - Use `Monitor.TryEnter` with a timeout to detect and back off, though this treats symptoms.
   - Redesign to avoid shared mutable state: an actor-like single consumer reading from a `Channel<T>`.

```csharp
void Transfer(Account from, Account to, decimal amount)
{
    var (first, second) = from.Id < to.Id ? (from, to) : (to, from);
    lock (first.Sync)
    lock (second.Sync)
    {
        from.Debit(amount);
        to.Credit(amount);
    }
}
```

4. Prevent: document lock hierarchy, keep critical sections tiny, and write a concurrency stress test that runs both directions in parallel thousands of times.

Interview tip: mention that async code has its own version of this with `SemaphoreSlim`, and the same ordering rule applies.

### Implement calling a flaky downstream API with retries, a per-attempt timeout, and overall cancellation. What do you watch out for?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/core/resilience/ -->
Retries look simple but cause outages when done wrong. Key requirements:

- Retry only transient failures: timeouts, 5xx, 408, 429, connection resets. Never retry 400 or 401.
- Retry only idempotent operations, or ones protected by an idempotency key.
- Use exponential backoff with jitter so thousands of clients do not retry in sync.
- Bound total time with an overall timeout and respect the caller's `CancellationToken`.
- Limit attempts (2-3) to avoid multiplying load on a struggling dependency; add a circuit breaker for sustained failure.

In modern .NET, use `Microsoft.Extensions.Resilience` (built on Polly v8) rather than hand-written loops:

```csharp
var pipeline = new ResiliencePipelineBuilder<HttpResponseMessage>()
    .AddTimeout(TimeSpan.FromSeconds(10))                     // total
    .AddRetry(new RetryStrategyOptions<HttpResponseMessage>
    {
        MaxRetryAttempts = 3,
        BackoffType = DelayBackoffType.Exponential,
        UseJitter = true,
        ShouldHandle = new PredicateBuilder<HttpResponseMessage>()
            .Handle<HttpRequestException>()
            .HandleResult(r => (int)r.StatusCode >= 500 || r.StatusCode == HttpStatusCode.TooManyRequests),
    })
    .AddTimeout(TimeSpan.FromSeconds(2))                      // per attempt
    .Build();

var response = await pipeline.ExecuteAsync(
    async token => await http.GetAsync("/rates", token), ct);
```

Pitfalls to mention: catching `OperationCanceledException` and retrying when the caller cancelled; retrying inside retries at several layers (3 x 3 x 3 = 27 calls); ignoring `Retry-After` headers; not logging attempts. For `HttpClient`, `AddStandardResilienceHandler()` gives sensible defaults.

### You must import a 10 GB CSV file into a database without running out of memory. How do you design it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/io/pipelines -->
The core idea is streaming with bounded memory and batched writes.

1. Read incrementally: `File.ReadLines`, a `StreamReader`, or a streaming CSV library (CsvHelper with `GetRecordsAsync`) that yields rows lazily. Never `ReadAllLines`.
2. Parse cheaply: spans for simple formats; handle quoted fields correctly (do not hand-roll a naive `Split(',')` if the data can contain commas).
3. Validate per row, writing rejects with line numbers to an error file instead of aborting the whole import.
4. Write in batches: `SqlBulkCopy` (SQL Server), `COPY` via Npgsql's binary importer (PostgreSQL), or EF Core with batches of a few thousand rows and `ChangeTracker.Clear()` between batches. Row-by-row `SaveChanges` would take days.
5. Pipeline it: a bounded `Channel<T>` between a reader and one or more writers keeps memory flat and overlaps I/O.
6. Make it restartable: record the last committed line or batch, use a staging table, then merge into the real table in one transaction.

```csharp
var channel = Channel.CreateBounded<List<Row>>(4);
var reader = Task.Run(async () =>
{
    var batch = new List<Row>(5000);
    foreach (var line in File.ReadLines(path))
    {
        batch.Add(Row.Parse(line));
        if (batch.Count == 5000) { await channel.Writer.WriteAsync(batch, ct); batch = new(5000); }
    }
    if (batch.Count > 0) await channel.Writer.WriteAsync(batch, ct);
    channel.Writer.Complete();
});
await foreach (var b in channel.Reader.ReadAllAsync(ct)) await BulkInsertAsync(b, ct);
await reader;
```

Measure throughput and memory with a sample file first, then tune batch size and parallelism.

### You need a pipeline where a fast producer generates work and slower consumers process it, without unbounded memory growth. What do you use?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/core/extensions/channels -->
Use a bounded `System.Threading.Channels.Channel<T>`. It is an async-native, thread-safe queue with built-in backpressure: when the channel is full, `WriteAsync` waits until consumers catch up, so memory stays bounded.

Design decisions:
- Capacity: large enough to absorb bursts, small enough to cap memory and latency.
- Full mode: `Wait` (backpressure), `DropOldest`/`DropNewest` (telemetry where losing samples is fine), or `DropWrite`.
- Number of consumers: match the bottleneck (CPU cores for CPU work; downstream capacity for I/O).
- Completion: the producer calls `Writer.Complete()`; consumers' `ReadAllAsync` loops end naturally. Propagate exceptions with `Complete(ex)`.
- Cancellation: pass one token to everything so shutdown is clean.

```csharp
var ch = Channel.CreateBounded<Invoice>(new BoundedChannelOptions(500)
{ FullMode = BoundedChannelFullMode.Wait, SingleWriter = true });

var consumers = Enumerable.Range(0, 4).Select(_ => Task.Run(async () =>
{
    await foreach (var inv in ch.Reader.ReadAllAsync(ct))
        await RenderPdfAsync(inv, ct);
})).ToArray();

await foreach (var inv in repo.StreamUnbilledAsync(ct))
    await ch.Writer.WriteAsync(inv, ct);
ch.Writer.Complete();
await Task.WhenAll(consumers);
```

Alternatives and trade-offs: `BlockingCollection<T>` blocks threads (not async-friendly); TPL Dataflow offers richer graphs but is heavier; an external broker (RabbitMQ, Service Bus) is needed if work must survive process crashes. Wrong answer: `ConcurrentQueue` plus a polling loop with `Task.Delay`, which wastes CPU and has no backpressure.

### You must call a partner API for 50,000 customers, but they allow at most 10 concurrent requests. How do you implement it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/api/system.threading.tasks.parallel.foreachasync -->
Two wrong extremes: a sequential `foreach` with `await` (takes hours) and `Task.WhenAll(customers.Select(CallAsync))` (fires 50,000 requests at once, gets throttled or banned, and may exhaust sockets).

Use bounded concurrency:

```csharp
var options = new ParallelOptions { MaxDegreeOfParallelism = 10, CancellationToken = ct };
var failures = new ConcurrentBag<(int Id, Exception Error)>();

await Parallel.ForEachAsync(customerIds, options, async (id, token) =>
{
    try
    {
        var profile = await partner.GetProfileAsync(id, token);
        await store.UpsertAsync(profile, token);
    }
    catch (HttpRequestException ex)
    {
        failures.Add((id, ex));          // keep going, report later
    }
});
```

Alternatives: `SemaphoreSlim(10)` around each call with `Task.WhenAll` (fine for smaller sets), or a bounded channel with 10 consumers.

Also consider:
- Rate limits in requests per second, not just concurrency: use `System.Threading.RateLimiting` (`TokenBucketRateLimiter`) or the partner's `Retry-After`.
- Resilience: retry transient failures with backoff via an `HttpClient` resilience handler.
- Progress and restartability: persist completed ids so a crash at 30,000 does not restart from zero.
- Connection reuse: one `HttpClient` from `IHttpClientFactory`, not a new one per call.

Interview angle: explain why `Parallel.ForEach` (non-async) with an async lambda is wrong — it creates `async void` delegates and returns immediately.

### Production logs show "UnobservedTaskException" and some audit records are silently missing. What is going on?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/api/system.threading.tasks.taskscheduler.unobservedtaskexception -->
Somewhere, code starts a task and never awaits it (fire-and-forget), for example `_ = _audit.WriteAsync(evt);` or a call missing `await`. When that task faults, nobody observes the exception. Later, when the GC finalises the task, the runtime raises `TaskScheduler.UnobservedTaskException`. Since .NET 4.5 this does not crash the process, so failures vanish silently.

1. Find the sources: search for discarded tasks (`_ =`), async calls without `await` (compiler warning CS4014, often suppressed), `async void` methods, and `Task.Run` whose result is ignored.
2. Log the event globally to identify callers quickly:

```csharp
TaskScheduler.UnobservedTaskException += (s, e) =>
{
    logger.LogError(e.Exception, "Unobserved task exception");
    e.SetObserved();
};
```

3. Fix by intent:
   - If the caller needs the result or must know about failure, `await` it.
   - If the work genuinely should not block the response, hand it to a durable mechanism: a bounded `Channel<T>` consumed by a `BackgroundService`, or an outbox table plus a worker so audit records survive crashes.
   - For audit specifically, write in the same transaction as the business change (outbox pattern), so you never have a change without its audit record.
4. Prevent: make CS4014 an error, enable VSTHRD110 ("observe the awaitable result"), and review every `_ =` on a task.

Wrong answer: wrapping the fire-and-forget call in `try/catch` at the call site; the exception happens later, outside that block.

### A CLI tool written in .NET takes 400 ms to start, and it runs thousands of times in CI scripts. How can you make startup faster?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/core/deploying/native-aot/ -->
1. Measure first: time the empty-input run (`Measure-Command` or `hyperfine`), and use `dotnet-trace` with startup events to separate runtime start, JIT, assembly loading and your own initialisation.
2. Remove app-level waste: eager loading of large configuration, reflection-based DI scanning of all assemblies, building big regexes at startup, or network calls (update checks) before doing work.
3. Reduce JIT cost:
   - ReadyToRun (`<PublishReadyToRun>true</PublishReadyToRun>`) precompiles your code; quick win with no code changes.
   - `TieredPGO` and tiered compilation are already on; keep them.
4. Go further with Native AOT (`<PublishAot>true</PublishAot>`): startup typically drops to tens of milliseconds and memory falls. Requirements: fix all trimming/AOT warnings, use source-generated JSON (`JsonSerializerContext`), `[GeneratedRegex]`, and avoid runtime reflection-heavy libraries.
5. Consider `<InvariantGlobalization>true</InvariantGlobalization>` if culture-specific formatting is not needed; it avoids loading ICU.

```xml
<PropertyGroup>
  <PublishAot>true</PublishAot>
  <InvariantGlobalization>true</InvariantGlobalization>
  <OptimizationPreference>Speed</OptimizationPreference>
</PropertyGroup>
```

Trade-offs: AOT binaries are per-platform (build linux-x64, win-x64, osx-arm64 separately), builds are slower, and dynamic plugin loading is impossible. Verify behaviour with the published binary in CI, not just `dotnet run`.

### Publishing with Native AOT produces dozens of IL2026 and IL3050 warnings and the app throws `MissingMethodException` at run time. How do you approach it?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/dotnet/core/deploying/trimming/fixing-warnings -->
The warnings are telling you the truth: code paths use reflection or dynamic code that the trimmer cannot analyse, so members were removed or cannot be generated. The run-time failure is a warning you ignored.

1. Group warnings by source: your code vs third-party packages. `IL2026` means a method marked `[RequiresUnreferencedCode]` was called; `IL3050` means `[RequiresDynamicCode]` (for example generic instantiation or `Reflection.Emit`).
2. Fix your code with AOT-friendly patterns:
   - JSON: switch to a source-generated `JsonSerializerContext` and pass `AppJsonContext.Default.MyType`.
   - Configuration binding: enable the configuration binding source generator (`<EnableConfigurationBindingGenerator>true</EnableConfigurationBindingGenerator>`).
   - Regex: `[GeneratedRegex]`.
   - Reflection over known types: annotate with `[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicProperties)]` so the trimmer keeps what is needed.
   - Replace `Activator.CreateInstance(Type.GetType(name))` plugin patterns with explicit registrations.
3. Third-party libraries: upgrade to AOT-annotated versions or replace them; check whether the package sets `IsAotCompatible`.
4. Only as a last resort, suppress with `[UnconditionalSuppressMessage]` and a justification after proving the code is safe.

```csharp
[JsonSerializable(typeof(OrderDto))]
[JsonSerializable(typeof(List<OrderDto>))]
internal partial class AppJsonContext : JsonSerializerContext;
```

5. Prevent regressions: build with `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` and run integration tests against the published AOT binary in CI.

### A security review finds a .NET service deserialising request payloads with Newtonsoft.Json using `TypeNameHandling.All`. Why is that critical and what do you do?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/serialization/binaryformatter-security-guide -->
`TypeNameHandling.All` (or `Auto`/`Objects`) makes the serializer read a `$type` property from the JSON and instantiate whatever .NET type it names. An attacker can name a "gadget" type whose constructor or property setters perform dangerous actions (start a process, load a file, make network calls), leading to remote code execution. This is the same class of vulnerability that got `BinaryFormatter` removed from .NET 9.

Response:
1. Treat it as a high-severity issue: determine whether the endpoint is reachable by untrusted callers and check logs for payloads containing `$type`.
2. Remove `TypeNameHandling` for untrusted input. If polymorphism is needed, use a closed set of known types:
   - System.Text.Json: `[JsonPolymorphic]` with `[JsonDerivedType(typeof(CardPayment), "card")]`, which only accepts listed discriminators.
   - Newtonsoft: a custom `ISerializationBinder` with an explicit allow-list (a weaker fallback).
3. Audit for other unsafe deserializers: `BinaryFormatter`, `NetDataContractSerializer`, `SoapFormatter`, `LosFormatter`, `ObjectStateFormatter`, `XmlSerializer` with attacker-controlled types.
4. Add defence in depth: input size limits, schema validation, and running the service with least privilege.

```csharp
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(CardPayment), "card")]
[JsonDerivedType(typeof(UpiPayment), "upi")]
public abstract record Payment(decimal Amount);
```

5. Prevent: analyzers CA2326/CA2327 flag insecure `TypeNameHandling`, and CA2300-series rules flag dangerous formatters; make them errors.

### A code review shows passwords stored as `SHA256(password)` in Base64. What is wrong and how do you migrate existing users?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/aspnet/core/security/data-protection/consumer-apis/password-hashing -->
Problems:
- SHA-256 is designed to be fast. Attackers with GPUs test billions of guesses per second against a leaked database.
- No salt, so identical passwords produce identical hashes and precomputed rainbow tables work.
- Comparing hashes with `==` may leak timing information.

Target: a slow, salted, adaptive algorithm. Options: ASP.NET Core Identity's `PasswordHasher<TUser>` (PBKDF2 with SHA-512 and a high iteration count by default in current versions), `Rfc2898DeriveBytes.Pbkdf2` directly, or Argon2id via a vetted library. Store the algorithm, parameters, salt and hash together.

Migration without forcing everyone to reset:
1. Immediately wrap existing hashes: compute `PBKDF2(existingSha256Hash, newSalt)` for every row in a one-off job, and mark the format as "wrapped-v1". The database never again contains the weak hash alone.
2. On login, verify via the same chain (`PBKDF2(SHA256(input))`); on success, rehash the plain password with the modern scheme and mark it "v2".
3. After a period, force a reset for accounts still on v1.

```csharp
var hasher = new PasswordHasher<User>();
string stored = hasher.HashPassword(user, password);
var result = hasher.VerifyHashedPassword(user, stored, attempt);
if (result == PasswordVerificationResult.SuccessRehashNeeded)
    user.PasswordHash = hasher.HashPassword(user, attempt);
```

Also: compare with `CryptographicOperations.FixedTimeEquals`, add rate limiting and lockout on login, and consider whether the system should delegate authentication to an identity provider instead.

### An invoice total is off by 0.01 compared to finance's spreadsheet. The code uses `double`. How do you investigate and fix it?
<!-- level: basic; kind: scenario; ref: https://learn.microsoft.com/dotnet/api/system.math.round -->
1. Reproduce with the exact line items. Print values with full precision (`ToString("R")` or `G17`) to see representation errors like `19.999999999999996`.
2. Root causes are usually two:
   - Binary floating point: `double` cannot represent most decimal fractions exactly, so sums of many prices drift.
   - Rounding rules: `Math.Round` uses banker's rounding (`MidpointRounding.ToEven`) by default, so 2.345 rounds to 2.34, while spreadsheets and many tax rules round half away from zero; and rounding per line vs on the total gives different results.
3. Fix:
   - Switch money calculations to `decimal` end to end, including database columns (`decimal(19,4)`) and JSON parsing.
   - Make rounding explicit and centralised: `Math.Round(x, 2, MidpointRounding.AwayFromZero)` or whatever finance specifies, applied at the agreed step.
   - Introduce a `Money` type so the rules live in one place.

```csharp
decimal lineTotal = Math.Round(unitPrice * qty, 2, MidpointRounding.AwayFromZero);
decimal tax = Math.Round(lineTotal * 0.18m, 2, MidpointRounding.AwayFromZero);
```

4. Verify with a regression test containing the failing invoice and known tricky cases (x.xx5 midpoints, many small items).
5. Communicate: historic invoices may need correction notes; agree on the policy with finance.

Wrong answer: "round the double to two decimals at the end" — it hides some errors but not all, and the rounding mode still differs.

### Items added to a `HashSet<Customer>` can no longer be found after an update, and duplicates appear. Why?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/api/system.object.gethashcode -->
Hash-based collections store each item in a bucket chosen by `GetHashCode()` at insertion time. If `Customer` overrides `Equals`/`GetHashCode` using mutable properties (for example `Email`), and code changes `Email` after adding it, the item now sits in the wrong bucket. `Contains` looks in the new bucket and fails; adding the "same" customer again creates a duplicate. The same applies to dictionary keys and to records with settable properties.

Investigation: check the type's equality implementation (or whether it is a `record` with `set` or `init` properties being modified via reflection or ORMs), and find where properties change after insertion.

Fixes:
- Base equality on an immutable identity, such as `Id`, assigned at construction.
- Make value-object keys immutable (`readonly record struct`, `init`-only properties that are never changed after insertion).
- If a key must change, remove the item, update it, and re-add it.
- Use a dictionary keyed by the stable id instead of a set of mutable entities.

```csharp
public sealed class Customer : IEquatable<Customer>
{
    public Customer(Guid id) => Id = id;
    public Guid Id { get; }
    public string Email { get; set; } = "";
    public bool Equals(Customer? o) => o is not null && Id == o.Id;
    public override bool Equals(object? o) => Equals(o as Customer);
    public override int GetHashCode() => Id.GetHashCode();
}
```

Interview angle: EF Core entities with value equality on mutable properties cause similar problems in change tracking; identity-based equality or default reference equality is safer.

### A method returning `IEnumerable<Order>` is slow, and profiling shows the database queried three times per request. What is happening?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/csharp/linq/get-started/introduction-to-linq-queries -->
The method returns a deferred query (an un-materialised LINQ pipeline or an `IQueryable` exposed as `IEnumerable`). Each enumeration re-executes it from scratch. Typical caller code triggers several enumerations:

```csharp
var orders = repo.GetOpenOrders();      // returns a lazy query
if (!orders.Any()) return;              // query 1
var count = orders.Count();             // query 2
foreach (var o in orders) Ship(o);      // query 3
```

Investigation: enable EF Core logging (`LogTo` or `Microsoft.EntityFrameworkCore.Database.Command` at Information) and observe identical SQL repeating; analyzers or ReSharper also flag "possible multiple enumeration".

Fixes:
- Materialise once at the boundary: `var orders = await repo.GetOpenOrdersAsync(ct);` returning `IReadOnlyList<Order>` from `ToListAsync()`.
- Make return types honest: use `IReadOnlyList<T>` or `IReadOnlyCollection<T>` when data is already in memory; reserve `IEnumerable<T>` for genuinely streaming sequences and document it.
- If counting is needed before loading everything, write a separate `CountAsync` query rather than enumerating twice.

Other side effects of multiple enumeration: iterators that read files or call APIs repeat the work, and generators producing random or time-based values return different results each time, causing subtle bugs.

Trade-off: materialising large results uses memory; for very large sets, stream once with `IAsyncEnumerable<T>` and do all processing in a single pass.

### A loop creates callbacks that should each print their index, but every callback prints the same number. Explain and fix.
<!-- level: basic; kind: scenario; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/operators/lambda-expressions#capture-of-outer-variables-and-variable-scope-in-lambda-expressions -->
Lambdas capture variables, not values. A `for` loop declares one variable `i` for the entire loop; all lambdas capture that same variable, and by the time they run, the loop has finished and `i` equals its final value.

```csharp
var actions = new List<Action>();
for (int i = 0; i < 3; i++)
    actions.Add(() => Console.WriteLine(i));
actions.ForEach(a => a());     // prints 3, 3, 3
```

Fixes:
- Copy into a variable scoped inside the loop body:

```csharp
for (int i = 0; i < 3; i++)
{
    int copy = i;
    actions.Add(() => Console.WriteLine(copy));   // 0, 1, 2
}
```

- Use `foreach` over a range: since C# 5, each `foreach` iteration has its own variable, so capture works as expected.

```csharp
foreach (var i in Enumerable.Range(0, 3))
    actions.Add(() => Console.WriteLine(i));
```

The same bug appears with tasks started in a loop (`Task.Run(() => Process(i))`) and with timer callbacks, and it is worse there because the timing varies, producing intermittent wrong results.

Under the hood: the compiler hoists captured variables into a closure class; the `for` loop has one closure instance shared by all lambdas, whereas a variable declared inside the body gets a new closure instance per iteration.

Interview tip: mention `static` lambdas, which forbid capturing and make such mistakes impossible when you do not need captured state.

### Calling `Increment()` on a struct stored in a `readonly` field or a list appears to do nothing. Why?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/struct#readonly-instance-members -->
Structs are copied by value, and several language rules silently operate on copies:

- Calling a mutating method on a struct held in a `readonly` field: the compiler makes a defensive copy to protect the field, and the method mutates the copy.
- Accessing a struct through a property or indexer that returns it by value (`list[0].Increment()`, `obj.Position.Move()`): you mutate the returned copy, which is discarded. (For a field assignment like `list[0].Count = 5` the compiler errors; for a method call it does not.)
- Iterating with `foreach` gives copies of struct elements.

```csharp
public struct Counter { public int Value; public void Increment() => Value++; }

class Stats
{
    private readonly Counter _c;
    public void Hit() => _c.Increment();    // mutates a copy; _c.Value stays 0
}

var list = new List<Counter> { new() };
list[0].Increment();                         // copy again
```

Fixes:
- Prefer immutable structs (`readonly struct`, `readonly record struct`) and return new values: `_c = _c.Increment();`.
- If mutation in place is required for performance, access the storage by reference: arrays (`ref var c = ref arr[0]`), `CollectionsMarshal.AsSpan(list)[0].Increment()`, and remove `readonly` from the field.
- Or use a class when the thing has identity and changes over time.

Prevention: mark struct members that do not mutate as `readonly` and enable analyzers; the compiler then avoids defensive copies and warns where they occur. Interview tip: this is why the guideline says "structs should be immutable".

### A Linux service starts failing with "Too many open files" after running for a day. How do you investigate?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/garbage-collection/using-objects -->
The process is leaking OS handles (file descriptors): files, sockets or pipes that are opened but not closed. The GC may eventually finalise some, but handle limits are much smaller than memory limits.

1. Observe: count descriptors over time with `ls /proc/<pid>/fd | wc -l` and `lsof -p <pid>` to see what kind they are (regular files, TCP sockets in `CLOSE_WAIT` or `ESTABLISHED`, pipes).
2. Hypothesise by type:
   - Files: `FileStream`/`StreamReader` created without `using`, or `File.OpenRead` passed to code that never disposes it.
   - Sockets: `new HttpClient()` per call, `TcpClient` not disposed, or responses (`HttpResponseMessage`) not disposed when streaming content.
   - Processes: `Process.Start` without disposing and redirected streams never read.
   - `FileSystemWatcher` instances created repeatedly.
3. Verify: take a dump and run `dumpheap -stat` filtered on `SafeFileHandle`/`SafeSocketHandle`, then `gcroot` to see who holds them; or review code paths matching the `lsof` paths.
4. Fix: `using`/`await using` on every owned disposable, `IHttpClientFactory` for HTTP, dispose `HttpResponseMessage` (or use `GetStringAsync`/`GetFromJsonAsync` which do), and make classes that own disposables implement `IDisposable` themselves.
5. Prevent: enable CA2000 (dispose objects before losing scope) and CA2213 (disposable fields should be disposed), add a metric for open handles, and soak-test for hours.

Raising `ulimit -n` only delays the crash.

### A hot path uses exceptions to signal "item not found" and handles thousands per second. What do you change?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/design-guidelines/exceptions-and-performance -->
Throwing an exception captures a stack trace, walks the stack to find handlers, and runs filters and `finally` blocks. Each throw/catch costs microseconds and allocates, compared with nanoseconds for a branch. At thousands per second it noticeably burns CPU, inflates "exceptions/sec" counters, floods debuggers and APM tools, and hides real errors among expected ones.

1. Confirm with `dotnet-counters` (`exception-count`) and a CPU trace showing time under exception dispatch.
2. Redesign the API so "not found" is a normal result:
   - Try pattern: `bool TryGet(key, out value)`.
   - Nullable return: `Task<Product?> FindAsync(id)`.
   - A result type or discriminated record for richer outcomes (`NotFound`, `Forbidden`, `Ok`).
3. Keep exceptions for unexpected situations: database down, corrupted data, programming errors.

```csharp
// Before
try { var p = catalog.Get(sku); Render(p); }
catch (ProductNotFoundException) { RenderMissing(sku); }

// After
if (catalog.TryGet(sku, out var p)) Render(p);
else RenderMissing(sku);
```

4. Check library calls too: `int.Parse` in a loop over messy data should be `int.TryParse`; `Enum.Parse` should be `Enum.TryParse`; `dict[key]` inside try/catch should be `TryGetValue`.

Interview nuance: .NET 9 made exception handling significantly faster, but the design guidance is about clarity as much as speed; expected outcomes in the signature are easier to reason about than hidden throws.

### In an interview you are asked to implement a thread-safe, lazily created singleton. What do you write and why?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/api/system.lazy-1 -->
The simplest correct answers use language and runtime guarantees rather than hand-written locking.

Option 1, static readonly field: the CLR runs static initialisers once, thread-safely, before first use.

```csharp
public sealed class Config
{
    public static Config Instance { get; } = new();
    private Config() { /* load */ }
}
```

Option 2, `Lazy<T>` when creation is expensive and should happen only on first access, or may fail and be retried:

```csharp
public sealed class Config
{
    private static readonly Lazy<Config> _instance =
        new(() => new Config(), LazyThreadSafetyMode.ExecutionAndPublication);
    public static Config Instance => _instance.Value;
    private Config() { }
}
```

`ExecutionAndPublication` guarantees the factory runs exactly once. Note that if the factory throws, `Lazy<T>` caches the exception in this mode.

Then discuss what interviewers want to hear:
- Double-checked locking with `lock` and a `volatile` field works but is easy to get wrong; prefer `Lazy<T>`.
- In applications using dependency injection, register the class as a singleton (`services.AddSingleton<IConfigProvider, ConfigProvider>()`) instead of a static `Instance`. This keeps dependencies explicit and lets tests replace it.
- A singleton must be thread-safe in all its members, not just its creation.
- For async initialisation, `Lazy<Task<T>>` (or `AsyncLazy` from a library) avoids blocking.

### Design an in-memory LRU cache with a fixed capacity, O(1) get and put, and thread safety. How would you build it in C#?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/dotnet/api/system.collections.generic.linkedlist-1 -->
Classic design: a `Dictionary<TKey, LinkedListNode<Entry>>` for O(1) lookup plus a `LinkedList<Entry>` ordered by recency. On get, move the node to the front; on put, add to the front and evict from the back when over capacity.

```csharp
public sealed class LruCache<TKey, TValue>(int capacity) where TKey : notnull
{
    private readonly Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>> _map = new(capacity);
    private readonly LinkedList<(TKey Key, TValue Value)> _list = new();
    private readonly Lock _sync = new();

    public bool TryGet(TKey key, out TValue value)
    {
        lock (_sync)
        {
            if (_map.TryGetValue(key, out var node))
            {
                _list.Remove(node);
                _list.AddFirst(node);
                value = node.Value.Value;
                return true;
            }
            value = default!;
            return false;
        }
    }

    public void Set(TKey key, TValue value)
    {
        lock (_sync)
        {
            if (_map.Remove(key, out var existing)) _list.Remove(existing);
            var node = _list.AddFirst((key, value));
            _map[key] = node;
            if (_map.Count > capacity)
            {
                var last = _list.Last!;
                _list.RemoveLast();
                _map.Remove(last.Value.Key);
            }
        }
    }
}
```

Discussion points:
- A single lock is simple and correct; under heavy contention consider striping or approximate LRU (sampling, CLOCK) as many production caches do.
- Disposal of evicted values if they own resources.
- In real apps, `IMemoryCache` with `SizeLimit` or `HybridCache` provides expiration, size-based eviction and metrics; justify writing your own only for special needs.

### Profiling shows a lot of time and allocation in logging even though the log level is Warning. What is wrong?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/core/extensions/high-performance-logging -->
Typical causes:
- String interpolation in log calls: `logger.LogDebug($"Processed {item} in {elapsed}")` builds the string before the logger checks the level, so the cost is paid even when Debug is disabled.
- Boxing of value-type arguments into `object[]` for every call with the generic `LogInformation(template, params object[])` overloads.
- Expensive argument computation (`JsonSerializer.Serialize(order)`) evaluated eagerly.
- Synchronous sinks (console, file) without buffering on hot paths.

Fixes:
1. Use message templates, never interpolation: `logger.LogDebug("Processed {ItemId} in {Elapsed}", item.Id, elapsed);`. This also keeps structured properties for querying.
2. For hot paths, use the `[LoggerMessage]` source generator, which produces strongly typed methods that check `IsEnabled` first and avoid boxing.
3. Guard expensive arguments with `if (logger.IsEnabled(LogLevel.Debug))`.
4. Configure async/batched sinks and avoid the console provider for high-volume production logging.

```csharp
public static partial class Log
{
    [LoggerMessage(Level = LogLevel.Debug, Message = "Processed {ItemId} in {ElapsedMs} ms")]
    public static partial void Processed(this ILogger logger, int itemId, double elapsedMs);
}

_logger.Processed(item.Id, sw.Elapsed.TotalMilliseconds);
```

Prevent: enable analyzers CA2254 (template should be constant) and CA1848 (use LoggerMessage delegates). Also review what is logged: high-volume debug logs left on in production cost money in log ingestion as well as CPU.

### A service deployed to a German-locale server reads "1.5" from a config file as 15. What happened and how do you prevent this class of bug?
<!-- level: basic; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/globalization-localization/globalization -->
`double.Parse`, `decimal.Parse`, `ToString()` and `DateTime.Parse` use the current culture by default. In `de-DE`, the comma is the decimal separator and the dot is a group separator, so "1.5" parses as 15. The same code works on developer machines with `en-US`, which is why it slips through.

Fix the immediate bug by using invariant culture for machine-readable data:

```csharp
var rate = decimal.Parse(text, NumberStyles.Number, CultureInfo.InvariantCulture);
string serialized = amount.ToString(CultureInfo.InvariantCulture);
var when = DateTimeOffset.ParseExact(s, "O", CultureInfo.InvariantCulture);
```

Prevent the class of bug:
- Rule: invariant culture for files, configs, protocols, logs and databases; current culture only for user-facing display and input.
- Enable analyzers CA1304, CA1305 and CA1310, which flag culture-sensitive calls without an explicit culture or comparison.
- Use typed configuration binding (`IOptions<T>`), which parses with invariant culture.
- Run tests under a non-English culture in CI (set `CultureInfo.DefaultThreadCurrentCulture` in a test fixture, or the container's `LANG`).
- Consider `<InvariantGlobalization>true</InvariantGlobalization>` for back-end services that never need localisation.

Related traps: `ToUpper()` with Turkish culture turns "i" into a dotted capital "İ", breaking string comparisons; use `ToUpperInvariant()` or ordinal comparisons for identifiers.

### Users in India report bookings shown an hour off, and a nightly job runs twice in some regions in October. How do you fix the date-time handling?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/standard/datetime/choosing-between-datetime -->
Symptoms point to mixing local and UTC times and to ignoring daylight saving transitions.

1. Observe: inspect stored values and their `DateTime.Kind`. `Unspecified` values coming from the database or JSON are interpreted as local or UTC inconsistently. Check the server time zone (containers often run in UTC, VMs maybe not).
2. Root causes:
   - Storing `DateTime.Now` (server-local) and converting again on display, causing double conversion.
   - Converting with fixed offsets (+05:30) instead of time zone rules, which fails for users in DST regions.
   - Scheduling on local wall-clock time: when clocks fall back, 01:30 occurs twice; when they spring forward, it never occurs.
3. Fix:
   - Store instants as UTC `DateTimeOffset` (or `datetimeoffset`/`timestamptz` columns).
   - Store the user's IANA time zone id ("Asia/Kolkata", "Europe/Berlin") and convert only for display with `TimeZoneInfo.ConvertTime`.
   - Model date-only concepts (birthdays, invoice dates) with `DateOnly`.
   - Run scheduled jobs on UTC schedules, or use a scheduler that handles DST explicitly, and make jobs idempotent so a duplicate run is harmless.

```csharp
var tz = TimeZoneInfo.FindSystemTimeZoneById(user.TimeZoneId);
var localStart = TimeZoneInfo.ConvertTime(booking.StartUtc, tz);
```

4. Verify with tests at DST boundaries using `FakeTimeProvider`.

Interview tip: say "store UTC, convert at the edges, keep the zone id for future local events".

### A recursive tree-processing method crashes the whole process with no catchable exception on very deep inputs. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/api/system.stackoverflowexception -->
The process hit a stack overflow. Each recursive call uses a stack frame; with deep or cyclic input (a category tree with a cycle, a deeply nested JSON document, a linked list processed recursively), the thread's stack (1 MB by default on Windows) is exhausted. Since .NET 2.0, `StackOverflowException` cannot be caught, so the process terminates immediately, often with only a short message in the logs.

1. Confirm: the crash message "Stack overflow" plus a repeated frame in the crash dump or the last log lines; reproduce with the deep input.
2. Fix options:
   - Convert recursion to iteration with an explicit `Stack<T>` or `Queue<T>`; this uses heap memory and has no practical depth limit.
   - Detect cycles with a `HashSet` of visited nodes.
   - Enforce a maximum depth for untrusted input (System.Text.Json has `MaxDepth`, default 64) and reject anything deeper.
   - As a last resort, run the work on a dedicated thread with a larger stack (`new Thread(work, maxStackSize)`), which only moves the limit.

```csharp
int CountNodes(Node root)
{
    var stack = new Stack<Node>();
    var seen = new HashSet<Node>(ReferenceEqualityComparer.Instance);
    stack.Push(root);
    int count = 0;
    while (stack.Count > 0)
    {
        var n = stack.Pop();
        if (!seen.Add(n)) continue;          // cycle protection
        count++;
        foreach (var child in n.Children) stack.Push(child);
    }
    return count;
}
```

3. Security angle: attacker-controlled nesting depth is a denial-of-service vector; always cap depth when parsing external data.
