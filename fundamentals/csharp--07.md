## 13. Performance engineering
### Measuring correctly with BenchmarkDotNet
<!-- level: intermediate; ref: https://benchmarkdotnet.org/articles/overview.html -->
Intuition about performance is often wrong, and naive timing with `Stopwatch` is misleading: the first call includes JIT compilation, tiered compilation changes code speed over time, the GC interrupts at random, and the CPU's frequency and caches vary. BenchmarkDotNet is the de-facto standard micro-benchmarking library (used by the .NET team itself) because it handles all of that.

It runs each benchmark in a separate process, performs warm-up iterations, runs many measured iterations, removes outliers, and reports mean, error, standard deviation and, with the memory diagnoser, bytes allocated per operation.

```csharp
using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Running;

[MemoryDiagnoser]
public class JoinBenchmarks
{
    private readonly string[] _parts = Enumerable.Range(0, 100).Select(i => i.ToString()).ToArray();

    [Benchmark(Baseline = true)]
    public string Concat()
    {
        var s = "";
        foreach (var p in _parts) s += p + ",";
        return s;
    }

    [Benchmark]
    public string Builder()
    {
        var sb = new StringBuilder(512);
        foreach (var p in _parts) sb.Append(p).Append(',');
        return sb.ToString();
    }

    [Benchmark]
    public string Join() => string.Join(',', _parts);
}

BenchmarkRunner.Run<JoinBenchmarks>();   // run with: dotnet run -c Release
```

Benchmarking discipline:
- Always run in Release mode, without a debugger attached.
- Return results from benchmarks so the JIT cannot eliminate the work as dead code.
- Benchmark realistic data sizes; an optimisation for 10 items may lose at 10,000.
- Compare runtimes with `[SimpleJob(RuntimeMoniker.Net80)]` and `Net10_0` attributes when evaluating upgrades.

Micro-benchmarks answer "which of these implementations is faster". For "why is my service slow", use profilers and production metrics first, then benchmark the hot spot you found.

- Pitfall: optimising code that accounts for 1% of total time is wasted effort; profile before optimising.
- Interview tip: quote allocations as well as time; reducing allocations often improves tail latency more than raw speed-ups.

### Native AOT and trimming
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/core/deploying/native-aot/ -->
Native AOT compiles your application and the parts of the runtime it uses into a single self-contained native executable. There is no JIT and no IL to load at start, so startup drops to milliseconds and memory use falls significantly. That suits serverless functions, CLI tools, containers that scale to zero, and sidecars.

AOT depends on trimming: the ILLink trimmer analyses which code is reachable and removes everything else to shrink the binary. Because analysis is static, anything discovered only at run time is a problem:
- Reflection over types or members not statically referenced.
- `Assembly.LoadFrom`, dynamic plugin loading.
- `Reflection.Emit` and runtime code generation (no JIT to run it).
- Some serializers and DI patterns that rely on reflection.

The compiler emits warnings (IL2xxx for trimming, IL3xxx for AOT) where code is not safe. The ecosystem's answer is source generators: System.Text.Json source generation, `[GeneratedRegex]`, `[LibraryImport]`, configuration binding generator, and ASP.NET Core's Request Delegate Generator.

```xml
<PropertyGroup>
  <PublishAot>true</PublishAot>
  <InvariantGlobalization>true</InvariantGlobalization>   <!-- smaller, if culture data not needed -->
  <IsAotCompatible>true</IsAotCompatible>                 <!-- for libraries: enables analyzers -->
</PropertyGroup>
```

```bash
dotnet publish -c Release -r linux-x64
./bin/Release/net10.0/linux-x64/publish/MyTool    # single native binary
```

Trade-offs: you must publish per OS and architecture, builds take longer, peak throughput can be slightly lower than JIT with dynamic PGO for long-running servers, and not every library is compatible.

- Pitfall: ignoring trim warnings leads to code that works in Debug but throws `MissingMethodException` in the published binary.
- Interview tip: treat zero AOT warnings as the bar; a warning means the app may behave differently after publish.

### Efficient strings and interpolated string handlers
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/csharp/advanced-topics/performance/interpolated-string-handler -->
Strings are immutable, so careless text building allocates heavily. Modern .NET gives several tools to build text efficiently:

- `StringBuilder` for loops with many appends; pre-size it when you can estimate the length.
- `string.Join` and `string.Concat` for combining known pieces in one allocation.
- `string.Create(length, state, span => ...)` to write directly into the final string's memory.
- Span-based formatting: `TryFormat` on numbers and dates writes into a `Span<char>` with no intermediate strings.
- `CompositeFormat` (.NET 8) to parse a format string once and reuse it.

Since C# 10, string interpolation is compiled into calls on an interpolated string handler (`DefaultInterpolatedStringHandler`) that formats into a pooled buffer, avoiding the boxing and array allocations of `string.Format`. APIs can define their own handlers so that the formatting work is skipped entirely when not needed. `Debug.Assert` and `StringBuilder.Append` do this.

```csharp
// One allocation, exact size
string masked = string.Create(card.Length, card, (span, src) =>
{
    span.Fill('*');
    src.AsSpan(^4).CopyTo(span[^4..]);
});

// Append interpolation directly into the builder (no temporary string)
var sb = new StringBuilder();
sb.Append($"Order {order.Id} total {order.Total:F2}\n");

// Format into a stack buffer
Span<char> buf = stackalloc char[32];
if (DateTime.UtcNow.TryFormat(buf, out int n, "O")) Write(buf[..n]);

// Logging: message templates are better than interpolation
logger.LogInformation("Order {OrderId} total {Total}", order.Id, order.Total);
// not: logger.LogInformation($"Order {order.Id} total {order.Total}");
```

- Pitfall: interpolating into log calls formats the string even when the log level is disabled and loses structured properties.
- Pitfall: `string.Substring` and `Split` in parsing loops allocate per piece; work with `ReadOnlySpan<char>` slices instead.
- Interview tip: strings over 85,000 bytes (about 42,500 chars) land on the Large Object Heap.

### Vectorisation and hardware intrinsics
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/standard/simd -->
Modern CPUs can apply one instruction to multiple data elements at once (SIMD: single instruction, multiple data). A 256-bit AVX2 register holds eight 32-bit integers, so a vectorised loop can process eight items per instruction.

.NET exposes SIMD at several levels:
- Already-vectorised BCL methods: `Span<T>.IndexOf`, `SequenceEqual`, `string` searching, `Sum` and `Max` in LINQ over arrays, `TensorPrimitives` (System.Numerics.Tensors) for math over spans. Using these is the easiest win.
- Portable vector types: `Vector<T>` (size depends on hardware) and fixed-size `Vector128<T>`, `Vector256<T>`, `Vector512<T>`, which the JIT maps to SSE, AVX, AVX-512 or Arm NEON.
- Platform-specific intrinsics in `System.Runtime.Intrinsics.X86` and `.Arm` for experts.

```csharp
using System.Numerics;
using System.Numerics.Tensors;

static int SumVectorized(ReadOnlySpan<int> values)
{
    var acc = Vector<int>.Zero;
    int i = 0;
    for (; i <= values.Length - Vector<int>.Count; i += Vector<int>.Count)
        acc += new Vector<int>(values[i..]);
    int sum = Vector.Sum(acc);
    for (; i < values.Length; i++) sum += values[i];     // remaining tail
    return sum;
}

// Easiest: let the library do it
float[] a = GetEmbedding(), b = GetOtherEmbedding();
float similarity = TensorPrimitives.CosineSimilarity(a, b);
```

Because the JIT compiles on the target machine, it uses the best instruction set available at run time, and checks like `Vector512.IsHardwareAccelerated` are treated as constants, so unused branches disappear.

- Pitfall: hand-vectorised code is harder to maintain and easy to get wrong at the tail; first check whether a BCL API already does it.
- Pitfall: floating-point sums computed in vector lanes may differ in the last bits from sequential sums because the order of additions changes.
- Interview tip: name `TensorPrimitives` when asked how to compute cosine similarity for embeddings efficiently in .NET.

## 14. Security and modern C#
### Secure coding essentials in .NET
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/standard/security/secure-coding-guidelines -->
Managed code removes whole classes of bugs (buffer overflows, use-after-free), but most real breaches come from logic and input-handling mistakes that C# cannot prevent for you.

Core practices:
- Treat all external input as untrusted: HTTP data, files, queue messages, environment, even your own database if others write to it. Validate type, length, range and format on the way in.
- Injection: always use parameterised queries (EF Core, Dapper parameters, `SqlParameter`). Never build SQL, shell commands, LDAP filters or file paths by concatenating input.
- Deserialization: never deserialize untrusted data into arbitrary types. `BinaryFormatter` is obsolete and was removed from the runtime in .NET 9 because it allows remote code execution. Avoid polymorphic type-name handling (Newtonsoft `TypeNameHandling.All`) on untrusted input.
- Output encoding: encode data for its context (HTML, URL, JavaScript) using `System.Text.Encodings.Web` or framework helpers.
- Least privilege: run services with minimal OS and database permissions.
- Keep dependencies patched; use `dotnet list package --vulnerable` and NuGet audit.

```csharp
// Vulnerable
var sql = $"SELECT * FROM Users WHERE Email = '{email}'";

// Safe with EF Core: interpolation becomes parameters
var user = await db.Users
    .FromSql($"SELECT * FROM Users WHERE Email = {email}")
    .SingleOrDefaultAsync(ct);

// Safe with ADO.NET
cmd.CommandText = "SELECT Id FROM Users WHERE Email = @email";
cmd.Parameters.Add(new SqlParameter("@email", SqlDbType.NVarChar, 256) { Value = email });

// Path traversal guard
var full = Path.GetFullPath(Path.Combine(uploadRoot, fileName));
if (!full.StartsWith(uploadRoot + Path.DirectorySeparatorChar, StringComparison.Ordinal))
    throw new SecurityException("Invalid path");
```

- Pitfall: `FromSqlRaw` with string concatenation is still injectable; the safe API is `FromSql` with an interpolated string.
- Pitfall: logging full request bodies or exception messages can leak passwords, tokens and personal data.
- Interview tip: relate each defence to an OWASP Top 10 category; interviewers like structured answers.

### Cryptography: hashing, randomness and password storage
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/standard/security/cryptography-model -->
`System.Security.Cryptography` wraps the operating system's vetted crypto libraries (CNG on Windows, OpenSSL on Linux). The golden rule: never invent your own algorithms or protocols; use high-level, well-reviewed primitives correctly.

Choosing the right tool:
- Integrity fingerprints: `SHA256.HashData(bytes)`. Not for passwords.
- Message authentication: `HMACSHA256` with a secret key, for example to sign webhooks.
- Symmetric encryption: `AesGcm` (authenticated encryption) with a unique nonce per message.
- Random values for tokens, keys and nonces: `RandomNumberGenerator`, never `System.Random`.
- Passwords: a slow, salted key-derivation function. `Rfc2898DeriveBytes.Pbkdf2` with SHA-256 and a high iteration count, or ASP.NET Core Identity's `PasswordHasher`. Argon2 and bcrypt are available via third-party libraries.
- Comparing secrets: `CryptographicOperations.FixedTimeEquals` to avoid timing attacks.

```csharp
// Password hashing
byte[] salt = RandomNumberGenerator.GetBytes(16);
byte[] hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations: 600_000,
                                        HashAlgorithmName.SHA256, outputLength: 32);
// store salt, hash, iterations and algorithm together

bool Verify(string attempt, byte[] salt, byte[] expected, int iterations) =>
    CryptographicOperations.FixedTimeEquals(
        Rfc2898DeriveBytes.Pbkdf2(attempt, salt, iterations, HashAlgorithmName.SHA256, 32),
        expected);

// Webhook signature check
byte[] sig = HMACSHA256.HashData(secretKey, Encoding.UTF8.GetBytes(body));
bool ok = CryptographicOperations.FixedTimeEquals(sig, Convert.FromHexString(headerSig));

// Unguessable token
string token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
```

.NET 10 also adds post-quantum algorithms (such as ML-KEM and ML-DSA) where the underlying OS library supports them, which matters for long-lived secrets and future-proofing.

- Pitfall: storing `SHA256(password)` is not safe; fast hashes are brute-forced with GPUs at billions per second.
- Pitfall: reusing an AES-GCM nonce with the same key destroys its security.
- Interview tip: store the algorithm and iteration count with each hash so you can upgrade parameters on the user's next login.

### Secrets and sensitive configuration
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/security/app-secrets -->
Connection strings, API keys and certificates are the keys to your systems. Leaked secrets in Git history are one of the most common causes of breaches, and bots scan public repositories for them within minutes.

Practices for .NET applications:
- Never commit secrets to `appsettings.json` or source code. Keep only non-sensitive defaults there.
- Development: use the Secret Manager (`dotnet user-secrets`), which stores values in your user profile outside the repository and loads them automatically in the Development environment.
- Production: load from a secrets store such as Azure Key Vault, AWS Secrets Manager or HashiCorp Vault, ideally authenticating with a managed identity so there is no bootstrap secret at all.
- Environment variables are acceptable in containers, but they show up in process listings and crash reports, so prefer mounted secret files or a vault provider.
- Rotate secrets regularly and immediately after any suspected exposure.

```bash
dotnet user-secrets init
dotnet user-secrets set "Payments:ApiKey" "sk_test_123"
```

```csharp
var builder = Host.CreateApplicationBuilder(args);

if (builder.Environment.IsProduction())
{
    builder.Configuration.AddAzureKeyVault(
        new Uri("https://orders-kv.vault.azure.net/"),
        new DefaultAzureCredential());          // managed identity in Azure
}

builder.Services.AddOptions<PaymentOptions>()
    .Bind(builder.Configuration.GetSection("Payments"))
    .ValidateDataAnnotations()
    .ValidateOnStart();                         // fail fast if a secret is missing
```

Inside the process, avoid logging configuration objects wholesale, and mark sensitive properties so they are redacted (Microsoft.Extensions.Compliance.Redaction provides data classification and redactors for logs).

- Pitfall: deleting a secret from the latest commit does not remove it from history; rotate it.
- Pitfall: `ToString()` on an options record prints every property, including keys, into logs.
- Interview tip: enable secret scanning in the repository (for example GitHub push protection) as a safety net.

### C# 12 and 13 features you should know
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/whats-new/csharp-13 -->
Each C# version adds productivity and performance features. Recognising them in code reviews and interviews shows you keep current.

C# 12 (.NET 8, November 2023):
- Primary constructors for classes and structs.
- Collection expressions: `int[] a = [1, 2, .. other];`
- Default values for lambda parameters: `var inc = (int x, int by = 1) => x + by;`
- `ref readonly` parameters.
- Alias any type: `using Point = (int X, int Y);`
- Inline arrays (`[InlineArray(8)]`) for fixed-size buffers in structs.
- Experimental attribute and interceptors (preview).

C# 13 (.NET 9, November 2024):
- `params` collections: `params ReadOnlySpan<T>`, `params List<T>` and other collection types.
- The new `System.Threading.Lock` type recognised by the `lock` statement.
- `\e` escape sequence for the ESC character.
- Implicit index access (`^1`) in object initializers.
- `ref` locals and `unsafe` contexts allowed in iterators and async methods (when not crossing `yield` or `await`).
- `ref struct` types can implement interfaces, and `allows ref struct` lets generics accept them.
- Partial properties and indexers (useful for source generators).
- `[OverloadResolutionPriority]` so library authors can steer callers to better overloads.

```csharp
using Point = (int X, int Y);                     // C# 12

public class Logger(TextWriter output)           // C# 12
{
    public void Log(params ReadOnlySpan<string> parts)   // C# 13
        => output.WriteLine(string.Join(' ', parts));
}

int[] primes = [2, 3, 5, 7];
int[] more = [.. primes, 11, 13];
Point origin = (0, 0);
new Logger(Console.Out).Log("ready", "at", DateTime.UtcNow.ToString("O"));
Console.WriteLine("\e[1mBold in a terminal\e[0m");     // C# 13
```

- Pitfall: language version follows the target framework by default; using C# 13 features in a `net8.0` project requires setting `LangVersion`, and some features need runtime support.
- Interview tip: pick two features you actually use and explain the problem each one solves.

### C# 14 features
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/whats-new/csharp-14 -->
C# 14 shipped with .NET 10 in November 2025. Its features mostly remove boilerplate and make span-based code more natural.

- Extension members: `extension(T receiver) { ... }` blocks inside static classes allow extension properties, extension operators and static extension members, not just methods.
- The `field` keyword: access an auto-property's compiler-generated backing field from an accessor, so you can add validation or change notification without declaring a field.
- Null-conditional assignment: `customer?.Address = address;` assigns only when `customer` is not null; also works with compound assignment like `?.Total += 5`.
- Implicit span conversions: arrays convert to `Span<T>` and `ReadOnlySpan<T>` in more contexts, including as extension method receivers and in generic type inference.
- `nameof` with unbound generic types: `nameof(List<>)` gives "List".
- Lambda parameters with modifiers (`ref`, `out`, `in`, `scoped`) without spelling out the types.
- Partial constructors and partial events, mainly for source generators.
- User-defined compound assignment operators (`operator +=`) and increment operators, so types like big matrices can update in place instead of allocating a new instance.

```csharp
public class Order
{
    public string Reference
    {
        get;
        set => field = value?.Trim().ToUpperInvariant() ?? throw new ArgumentNullException(nameof(value));
    }
    public Address? Shipping { get; set; }
}

order?.Shipping = defaultAddress;                 // null-conditional assignment

public static class EnumerableExtensions
{
    extension<T>(IEnumerable<T> source)
    {
        public bool IsEmpty => !source.Any();
    }
}

if (cart.Items.IsEmpty) return;
Console.WriteLine(nameof(Dictionary<,>));         // "Dictionary"
```

- Pitfall: `field` becomes a contextual keyword inside property accessors, so existing members named `field` need `@field` or `this.field`.
- Pitfall: implicit span conversions can change which overload is chosen in rare cases when recompiling existing code; review warnings after upgrading.
- Interview tip: explain that extension members still cannot add state, and that classic `this`-parameter extension methods remain valid and binary compatible.

### What .NET 10 brings and how to plan upgrades
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/core/whats-new/dotnet-10/overview -->
.NET 10, released November 2025, is a Long Term Support release supported for three years, making it the natural target for production upgrades from .NET 8 (LTS until November 2026) and .NET 9.

Notable areas:
- Runtime: further JIT improvements (better inlining and devirtualisation, more stack allocation of non-escaping objects, improved loop optimisations), support for newer CPU instruction sets, and continued GC tuning.
- Libraries: async LINQ (`System.Linq.AsyncEnumerable`) in the box, `LeftJoin` and `RightJoin`, post-quantum cryptography APIs, JSON serialisation improvements, and better span-based APIs.
- SDK: file-based apps with `dotnet run app.cs`, `dotnet tool exec` for one-shot tools, container publishing improvements, and Microsoft.Testing.Platform support in `dotnet test`.
- Language: C# 14.
- ASP.NET Core and EF Core 10 updates (covered in the ASP.NET Core course).

A sensible upgrade plan:
1. Update `global.json` and `TargetFramework` to `net10.0` on a branch.
2. Upgrade Microsoft packages to matching 10.x versions and third-party packages to compatible ones.
3. Build with warnings as errors and read the "breaking changes in .NET 10" list for areas you use.
4. Run the full test suite, then performance and load tests to compare against the old version.
5. Roll out gradually (canary or a subset of instances) while watching error rates, latency and memory.

```xml
<PropertyGroup>
  <TargetFramework>net10.0</TargetFramework>
  <LangVersion>14</LangVersion>   <!-- default for net10.0; shown for clarity -->
</PropertyGroup>
```

Upgrading is usually smooth between modern .NET versions, and many teams see free performance gains simply from recompiling.

- Pitfall: Docker base images change too; check the default image OS, user and ports when updating `FROM` lines.
- Interview tip: knowing the LTS/STS cadence and end-of-support dates shows operational maturity, since running unsupported runtimes means unpatched security issues.
