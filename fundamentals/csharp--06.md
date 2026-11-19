## 11. The core libraries
### Files, streams and text encoding
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/standard/io/ -->
`System.IO` provides two levels of file access. Convenience methods on `File` (`ReadAllText`, `WriteAllLines`, `ReadLines`) cover simple cases. Streams give fine-grained, memory-efficient control for large data, network transfers and pipelines.

A `Stream` is a sequence of bytes you can read, write and sometimes seek. Implementations include `FileStream`, `MemoryStream`, `NetworkStream`, `GZipStream` and `CryptoStream`, and they compose: you can wrap a file stream in a compression stream in a buffered stream. `StreamReader` and `StreamWriter` translate between bytes and text using an encoding (UTF-8 by default, without a byte order mark).

```csharp
// Small file: fine to load at once
var config = await File.ReadAllTextAsync("settings.json", ct);

// Large file: stream line by line, constant memory
await foreach (var line in File.ReadLinesAsync("access.log", ct))   // .NET 7
    if (line.Contains(" 500 ", StringComparison.Ordinal)) errors++;

// Compose streams: write a gzip-compressed CSV
await using var file = File.Create("export.csv.gz");
await using var gzip = new GZipStream(file, CompressionLevel.Optimal);
await using var writer = new StreamWriter(gzip, Encoding.UTF8);
await writer.WriteLineAsync("id,name");
foreach (var c in customers)
    await writer.WriteLineAsync($"{c.Id},{c.Name}");

// Copy between streams without loading everything
await using var source = await http.GetStreamAsync(url, ct);
await using var target = File.Create(localPath);
await source.CopyToAsync(target, ct);

// Paths: never concatenate with "\" or "/"
var full = Path.Combine(baseDir, "reports", $"{DateTime.UtcNow:yyyyMMdd}.pdf");
```

`System.IO.Pipelines` builds on these ideas for high-performance parsers (Kestrel uses it), managing buffers for you.

- Pitfall: `File.ReadAllText` on a multi-gigabyte file loads it all into memory (as UTF-16, roughly doubling the size).
- Pitfall: building paths from user input without validation enables path traversal (`../../etc/passwd`); resolve with `Path.GetFullPath` and check it stays under the allowed root.
- Interview tip: always dispose streams; forgetting to dispose a writer can leave data unflushed.

### JSON with System.Text.Json
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/standard/serialization/system-text-json/overview -->
`System.Text.Json` (STJ) is the built-in, high-performance JSON library. It works directly with UTF-8 bytes, allocates little, and is what ASP.NET Core uses by default. Newtonsoft.Json still exists and has more features, but STJ is the default choice for new code.

Main APIs:
- `JsonSerializer` for converting objects to and from JSON.
- `JsonDocument` (read-only DOM) and `JsonNode` (mutable DOM) for dynamic JSON.
- `Utf8JsonReader` / `Utf8JsonWriter` for low-level streaming.

Behaviour is controlled with `JsonSerializerOptions` and attributes. Source generation (`JsonSerializerContext`) produces serialisation code at compile time, which is faster and required for trimming and Native AOT.

```csharp
public record Product(int Id, string Name, decimal Price,
    [property: JsonPropertyName("in_stock")] bool InStock,
    ProductKind Kind);

public enum ProductKind { Physical, Digital }

var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)   // camelCase, case-insensitive
{
    Converters = { new JsonStringEnumConverter() },
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
};

string json = JsonSerializer.Serialize(new Product(1, "Pen", 10m, true, ProductKind.Physical), options);
// {"id":1,"name":"Pen","price":10,"in_stock":true,"kind":"Physical"}

var p = JsonSerializer.Deserialize<Product>(json, options);

// Source-generated metadata: fast and AOT-safe
[JsonSerializable(typeof(Product))]
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web)]
internal partial class AppJsonContext : JsonSerializerContext;

var fast = JsonSerializer.Serialize(p!, AppJsonContext.Default.Product);

// Ad-hoc reading
var node = JsonNode.Parse(json)!;
decimal price = node["price"]!.GetValue<decimal>();
```

- Pitfall: create `JsonSerializerOptions` once and reuse it; new instances discard cached metadata and are slow.
- Pitfall: defaults differ from Newtonsoft (case-sensitive by default outside web defaults, no comments, strict number handling), which breaks migrations subtly.
- Interview tip: .NET 9 added `JsonSerializerOptions.Web` as a ready-made shared instance and a JSON schema exporter.

### Dates, times, time zones and TimeProvider
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/standard/datetime/timeprovider-overview -->
Date and time handling is a top source of production bugs. .NET offers several types, each for a specific purpose:

- `DateTime`: date plus time with a `Kind` (Utc, Local or Unspecified). The ambiguity of `Unspecified` causes many bugs.
- `DateTimeOffset`: a moment in time plus its offset from UTC. The safest choice for timestamps that cross systems.
- `DateOnly` and `TimeOnly` (.NET 6): a calendar date (birthday, invoice date) or a time of day (store opening hour) without the other half.
- `TimeSpan`: a duration.
- `TimeZoneInfo`: converts between zones, including daylight saving rules. Since .NET 6 IANA ids such as "Asia/Kolkata" work on all platforms.

`TimeProvider` (.NET 8) abstracts "now" and timers so code can be tested. Inject it instead of calling `DateTime.UtcNow` directly; tests use `FakeTimeProvider` from Microsoft.Extensions.TimeProvider.Testing to move time forward instantly.

```csharp
public sealed class SubscriptionService(TimeProvider clock)
{
    public bool IsExpired(Subscription s) => clock.GetUtcNow() >= s.ExpiresAt;

    public DateOnly NextBillingDate(DateOnly start, int months) => start.AddMonths(months);
}

DateTimeOffset createdUtc = DateTimeOffset.UtcNow;      // store in UTC
var ist = TimeZoneInfo.FindSystemTimeZoneById("Asia/Kolkata");
DateTimeOffset local = TimeZoneInfo.ConvertTime(createdUtc, ist);   // convert for display

// Test
var fake = new FakeTimeProvider(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
var svc = new SubscriptionService(fake);
fake.Advance(TimeSpan.FromDays(31));
```

Rules: store and compute in UTC, convert to local time only at the edges for display, and keep the user's time zone id when you need to schedule future local events (because offsets change with DST and law).

- Pitfall: `DateTime.Now` on servers depends on the machine's zone; containers usually run in UTC while developer laptops do not.
- Interview tip: "add one day" and "add 24 hours" differ across a DST transition.

### Regular expressions and source-generated regex
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/standard/base-types/regular-expression-source-generators -->
`System.Text.RegularExpressions.Regex` provides a powerful, Perl-compatible-ish regex engine. A pattern can be interpreted, compiled to IL at run time (`RegexOptions.Compiled`), or, since .NET 7, generated as readable C# at compile time with the `[GeneratedRegex]` attribute.

The source generator gives the best of both worlds: fast matching like `Compiled`, no startup cost for building the regex, compatibility with trimming and Native AOT, and generated code you can step through in the debugger.

```csharp
public static partial class Validators
{
    [GeneratedRegex(@"^[A-Z]{5}[0-9]{4}[A-Z]$", RegexOptions.CultureInvariant)]
    private static partial Regex PanRegex();          // Indian PAN format

    [GeneratedRegex(@"(?<key>\w+)=(?<value>[^;]*)", RegexOptions.None, matchTimeoutMilliseconds: 100)]
    private static partial Regex PairRegex();

    public static bool IsValidPan(string s) => PanRegex().IsMatch(s);

    public static Dictionary<string, string> ParsePairs(string input) =>
        PairRegex().Matches(input).ToDictionary(m => m.Groups["key"].Value, m => m.Groups["value"].Value);
}

// Inside Validators: span-based, allocation-free enumeration (.NET 7+)
public static int CountPairs(ReadOnlySpan<char> text)
{
    int count = 0;
    foreach (ValueMatch m in PairRegex().EnumerateMatches(text)) count++;
    return count;
}
```

Security matters here. Backtracking engines can take exponential time on crafted input with patterns like `(a+)+$`. This is a ReDoS (regular expression denial of service) attack. Defences:
- Always set a match timeout for patterns applied to untrusted input.
- Use `RegexOptions.NonBacktracking` (.NET 7), which guarantees linear time at the cost of some features like backreferences.
- Prefer simple string methods (`StartsWith`, `IndexOf`, `Split`) when a regex is overkill.

- Pitfall: `new Regex(pattern)` inside a frequently called method re-parses the pattern each time; use static instances or the generator.
- Interview tip: C# 13 lets `[GeneratedRegex]` be applied to partial properties as well as methods.

### The generic host: DI, configuration and logging outside the web
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/core/extensions/generic-host -->
The `Microsoft.Extensions.*` libraries that power ASP.NET Core are equally useful in console apps, worker services and desktop apps. The generic host wires them together: dependency injection, configuration from many sources, logging, and lifetime management (graceful shutdown on Ctrl+C or SIGTERM).

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = Host.CreateApplicationBuilder(args);    // .NET 7+

builder.Services.Configure<ImportOptions>(builder.Configuration.GetSection("Import"));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient<CatalogClient>(c => c.BaseAddress = new("https://catalog.internal"));
builder.Services.AddHostedService<ImportWorker>();

using IHost host = builder.Build();
await host.RunAsync();

public sealed class ImportWorker(CatalogClient catalog, IOptions<ImportOptions> opts,
    ILogger<ImportWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(opts.Value.Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var count = await catalog.SyncAsync(stoppingToken);
            log.LogInformation("Imported {Count} items", count);
        }
    }
}
```

Dependency injection basics: register services with a lifetime (transient, scoped, singleton), request them via constructor parameters, and let the container build the object graph and dispose what it created. This keeps classes decoupled and easy to test.

`CreateApplicationBuilder` loads `appsettings.json`, `appsettings.{Environment}.json`, environment variables and command-line arguments, and adds console logging by default.

- Pitfall: resolving services manually from `IServiceProvider` all over the code (service locator) hides dependencies; prefer constructor injection.
- Interview tip: the same skills apply to ASP.NET Core, Azure Functions (isolated worker) and .NET MAUI, which all build on this host model.

### Reflection and attributes
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/advanced-topics/reflection-and-attributes/ -->
Every assembly carries metadata describing its types, members and attributes. Reflection (`System.Reflection`) reads that metadata at run time and can create objects, read properties and invoke methods dynamically. Frameworks rely on it heavily: DI containers find constructors, serializers discover properties, test runners find `[Fact]` methods.

Attributes are classes deriving from `Attribute` that attach declarative metadata to code. They do nothing by themselves; some code (the compiler, an analyzer, a framework via reflection, or a source generator) must look for them.

```csharp
[AttributeUsage(AttributeTargets.Property)]
public sealed class SensitiveAttribute : Attribute;

public class User
{
    public string Name { get; set; } = "";
    [Sensitive] public string Aadhaar { get; set; } = "";
}

static string Describe(object obj)
{
    var parts = obj.GetType()
        .GetProperties(BindingFlags.Public | BindingFlags.Instance)
        .Select(p => p.GetCustomAttribute<SensitiveAttribute>() is null
            ? $"{p.Name}={p.GetValue(obj)}"
            : $"{p.Name}=***");
    return string.Join(", ", parts);
}

Console.WriteLine(Describe(new User { Name = "Asha", Aadhaar = "1234" }));  // Name=Asha, Aadhaar=***

// Create an instance by type name (plugins)
var type = Type.GetType("Plugins.CsvExporter, Plugins", throwOnError: true)!;
var exporter = (IExporter)Activator.CreateInstance(type)!;
```

Costs and limits: reflection is much slower than direct calls, bypasses compile-time checking, and breaks under trimming and Native AOT because the trimmer cannot see which members you access by name. Cache `PropertyInfo` and `MethodInfo` objects, or generate delegates once.

- Pitfall: reflection can read private members, which makes it tempting to break encapsulation in tests; avoid it.
- Interview tip: `[DynamicallyAccessedMembers]` annotations tell the trimmer which members reflection needs, but source generators are the more robust modern answer.

### Source generators
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/csharp/roslyn-sdk/source-generators-overview -->
A source generator is a compiler plug-in that runs during compilation, inspects your code (syntax trees and semantic model), and adds new C# source files to the compilation. It cannot modify existing code, only add to it, typically by completing `partial` classes or methods.

Generators move work from run time (reflection) to compile time. The result is faster startup, no reflection cost, full debuggability, and compatibility with trimming and Native AOT. The BCL ships many:
- System.Text.Json (`JsonSerializerContext`)
- Regex (`[GeneratedRegex]`)
- Logging (`[LoggerMessage]`)
- Interop (`[LibraryImport]`)
- Configuration binding and options validation
- ASP.NET Core minimal API request delegates (Request Delegate Generator)

```csharp
public static partial class Log
{
    [LoggerMessage(EventId = 1001, Level = LogLevel.Warning,
                   Message = "Payment {PaymentId} declined with code {Code}")]
    public static partial void PaymentDeclined(ILogger logger, string paymentId, string code);
}

Log.PaymentDeclined(logger, payment.Id, "INSUFFICIENT_FUNDS");
// The generator writes the method body: checks IsEnabled, no boxing, cached template.
```

```xml
<!-- see what was generated -->
<PropertyGroup>
  <EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>
</PropertyGroup>
```

Writing your own uses the incremental generator API (`IIncrementalGenerator`), which caches intermediate results so the IDE stays responsive. `ForAttributeWithMetadataName` is the efficient way to find types marked with your attribute.

- Pitfall: a slow or non-incremental generator makes every keystroke in the IDE sluggish.
- Pitfall: generators run in the compiler process and target `netstandard2.0`; they cannot reference your app's runtime types directly.
- Interview tip: contrast generators (add code at compile time) with interceptors (an experimental feature for redirecting specific calls), and with IL weaving tools such as Fody.

## 12. Testing, tooling and diagnostics
### Unit testing with xUnit, NUnit and MSTest
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/core/testing/ -->
.NET has three mainstream test frameworks: xUnit (very popular for new projects, with xUnit v3 the current generation), NUnit and MSTest. All run with `dotnet test` and in IDE test explorers. They share the same ideas: test methods marked with attributes, assertions, and data-driven tests.

A good unit test is fast, isolated, repeatable and checks one behaviour. The Arrange-Act-Assert layout keeps tests readable, and names should describe the scenario and expectation.

```csharp
public class DiscountCalculatorTests
{
    private readonly DiscountCalculator _sut = new();

    [Fact]
    public void Apply_GoldCustomer_Gets10Percent()
    {
        // Arrange
        var order = new Order(Total: 1000m, Tier: CustomerTier.Gold);

        // Act
        var result = _sut.Apply(order);

        // Assert
        Assert.Equal(900m, result);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(499.99, 0)]
    [InlineData(500, 25)]
    public void Shipping_DependsOnTotal(decimal total, decimal expected)
        => Assert.Equal(expected, _sut.Shipping(total));

    [Fact]
    public async Task Apply_NegativeTotal_Throws()
        => await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => _sut.ApplyAsync(new Order(-1m, CustomerTier.Basic)));
}
```

```bash
dotnet test --filter "FullyQualifiedName~Discount"
dotnet test --collect:"XPlat Code Coverage"
```

xUnit creates a new instance of the test class for each test, so constructor setup is fresh every time; `IClassFixture<T>` shares expensive setup. The newer Microsoft.Testing.Platform runner (supported by all three frameworks) produces standalone test executables and is integrated with `dotnet test` in .NET 10.

- Pitfall: tests that depend on each other, on execution order, on the clock or on shared static state become flaky.
- Interview tip: test behaviour through public APIs; testing private methods directly couples tests to implementation.

### Test doubles and designing for testability
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/core/testing/unit-testing-best-practices -->
Code is easy to test when its dependencies are explicit and replaceable. Constructor injection of interfaces (or abstract base classes like `TimeProvider`) lets a test substitute a double:

- Stub: returns canned answers.
- Mock: verifies that certain calls happened.
- Fake: a working lightweight implementation (in-memory repository, `FakeTimeProvider`, `FakeLogger`).

Libraries such as NSubstitute and Moq generate doubles at run time. Hand-written fakes are often clearer for core domain abstractions.

```csharp
public sealed class ReminderService(IEmailSender email, IUserRepository users, TimeProvider clock)
{
    public async Task<int> SendDueAsync(CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var due = await users.GetWithRenewalOnAsync(today, ct);
        foreach (var u in due)
            await email.SendAsync(u.Email, "Your plan renews today", ct);
        return due.Count;
    }
}

[Fact]
public async Task SendsOneEmailPerDueUser()
{
    var email = Substitute.For<IEmailSender>();           // NSubstitute
    var users = Substitute.For<IUserRepository>();
    var clock = new FakeTimeProvider(new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero));
    users.GetWithRenewalOnAsync(new DateOnly(2026, 3, 1), Arg.Any<CancellationToken>())
         .Returns([new User("a@x.com"), new User("b@x.com")]);

    var sent = await new ReminderService(email, users, clock).SendDueAsync(default);

    Assert.Equal(2, sent);
    await email.Received(1).SendAsync("a@x.com", Arg.Any<string>(), Arg.Any<CancellationToken>());
}
```

Things that make code hard to test: `DateTime.Now`, static singletons, `new`-ing infrastructure inside business logic, and file or network access mixed with calculations. Push I/O to the edges and keep the core pure.

- Pitfall: over-mocking (verifying every internal call) makes tests break on every refactor without catching real bugs.
- Pitfall: mocking types you do not own, such as `DbContext` or `HttpClient`, is fragile; use fakes, an in-memory handler, or integration tests instead.
- Interview tip: mention the test pyramid: many unit tests, fewer integration tests, very few end-to-end tests.

### Analyzers, warnings and code style
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/fundamentals/code-analysis/overview -->
Roslyn analyzers run during compilation and in the IDE, reporting problems as diagnostics with ids such as CA2007 or IDE0055. The SDK includes .NET code-quality analyzers (CAxxxx: correctness, performance, security, reliability) and code-style rules (IDExxxx). Third-party packs add more, for example threading analyzers or security scanners.

You control them through project properties and an `.editorconfig` file checked into the repository, so every developer and the CI build enforce the same rules.

```xml
<PropertyGroup>
  <AnalysisLevel>latest-recommended</AnalysisLevel>
  <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
  <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  <Nullable>enable</Nullable>
</PropertyGroup>
```

```ini
# .editorconfig
root = true
[*.cs]
indent_style = space
indent_size = 4
csharp_style_namespace_declarations = file_scoped:warning
dotnet_diagnostic.CA2016.severity = error   # forward CancellationToken
dotnet_diagnostic.CA1848.severity = warning # use LoggerMessage delegates
dotnet_diagnostic.CA2100.severity = error   # SQL injection review
```

```bash
dotnet format              # apply style fixes
dotnet format --verify-no-changes   # fail CI if code is not formatted
```

Valuable rules to enforce early include forwarding cancellation tokens, disposing objects, not using `async void`, avoiding culture-sensitive string operations in protocols, and nullable warnings.

- Pitfall: enabling hundreds of rules on a legacy codebase at once creates thousands of warnings that people ignore; turn them on gradually, starting with errors in new code.
- Pitfall: suppressing warnings with `#pragma` without a justification comment hides real issues.
- Interview tip: analyzers are cheap, automatic code review; mention them when asked how you keep quality consistent across a team.

### Diagnostics tools: counters, traces and dumps
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/core/diagnostics/ -->
When something goes wrong in production, you need evidence. .NET ships cross-platform command-line tools that attach to a running process with low overhead, installed with `dotnet tool install -g <name>`:

- `dotnet-counters`: live metrics such as CPU, GC heap size, allocation rate, exception count, thread-pool queue length, and lock contention.
- `dotnet-trace`: collects EventPipe traces (CPU sampling, GC events, custom events) viewable in PerfView, Visual Studio or speedscope.
- `dotnet-dump`: captures and analyses process dumps (`dumpheap -stat`, `gcroot`, `clrstack`, `threadpool`).
- `dotnet-gcdump`: lightweight heap snapshots for memory analysis.
- `dotnet-monitor`: a sidecar that exposes all of this over HTTP, convenient in containers and Kubernetes.

```bash
dotnet-counters monitor -n OrdersApi --counters System.Runtime,Microsoft.AspNetCore.Hosting
dotnet-trace collect -p 4120 --profile cpu-sampling --duration 00:00:30
dotnet-dump collect -p 4120 -o hang.dmp
dotnet-dump analyze hang.dmp
> clrthreads
> setthread 12
> clrstack
> dumpheap -stat
```

A practical approach:
1. Use metrics to classify the problem: CPU-bound, memory growth, GC pressure, thread-pool starvation, lock contention, or waiting on dependencies.
2. Collect the matching artefact: a CPU trace for hot code, gcdumps over time for leaks, a full dump with all thread stacks for hangs and deadlocks.
3. Analyse offline, form a hypothesis, fix, and verify with the same metric.

In code, `System.Diagnostics.Metrics` (`Meter`, `Counter<T>`, `Histogram<T>`) and `ActivitySource` emit your own metrics and traces, which OpenTelemetry exports.

- Pitfall: full dumps contain everything in memory, including secrets and personal data; treat them as sensitive.
- Interview tip: describe one real investigation end to end (symptom, tool, finding, fix); it is more convincing than listing tools.

### Debugging techniques and productive habits
<!-- level: basic; ref: https://learn.microsoft.com/visualstudio/debugger/debugger-feature-tour -->
A debugger lets you pause execution, inspect state and move step by step. Visual Studio, VS Code with the C# Dev Kit, and JetBrains Rider all provide rich .NET debugging.

Techniques that save hours:
- Conditional breakpoints (`order.Id == 1234`) and hit counts, so you stop only on the interesting iteration.
- Tracepoints (logpoints) that print a message without stopping or editing code.
- Exception settings to break when an exception is thrown, not just when unhandled; ideal for finding swallowed exceptions.
- The Parallel Stacks and Tasks windows to understand deadlocks and async flows.
- Edit and Continue / Hot Reload (`dotnet watch`) to change code without restarting.
- `[DebuggerDisplay]` to make objects readable in watch windows.

```csharp
[DebuggerDisplay("Order {Id} {Status} total={Total}")]
public class Order
{
    public int Id { get; set; }
    public OrderStatus Status { get; set; }
    public decimal Total { get; set; }
}

// Programmatic aids
Debug.Assert(total >= 0, "Total should never be negative");   // only in Debug builds
if (Debugger.IsAttached) Debugger.Break();
```

```bash
dotnet watch run          # rebuild and hot reload on save
```

When a debugger is not available (production), rely on structured logs with correlation ids, metrics, and dumps. Source Link and symbol servers let you step into NuGet package and framework source while debugging.

- Pitfall: debugging a Release build can show variables as "optimised away" and step in confusing order; this is normal JIT optimisation.
- Pitfall: hovering over properties executes their getters, which can change state if the getters have side effects.
- Interview tip: describe a systematic approach: reproduce, isolate with a failing test, form one hypothesis at a time, and confirm the fix with that test.
