## 1. The .NET platform and tooling
### What .NET is: runtime, libraries and SDK
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/core/introduction -->
.NET is a free, open-source, cross-platform developer platform. When people say "C# and .NET" they mean three cooperating pieces:

- The runtime (CoreCLR) loads your program, compiles it to machine code, manages memory with a garbage collector, enforces type safety and handles threads and exceptions.
- The base class library (BCL) gives you collections, I/O, networking, JSON, cryptography, threading and much more, all shipped with the runtime.
- The SDK contains the compilers (Roslyn for C#), the `dotnet` CLI, MSBuild and templates.

C# is just one language that targets .NET; F# and Visual Basic compile to the same intermediate language and can call each other's code.

Versions matter. Even-numbered releases (.NET 8, .NET 10) are Long Term Support with three years of patches; odd ones (.NET 9) are Standard Term Support. .NET 10 shipped in November 2025 with C# 14. The old Windows-only ".NET Framework 4.x" still exists for legacy apps but receives no new features.

```bash
dotnet --info            # installed SDKs and runtimes
dotnet --list-sdks
dotnet new console -n Hello && cd Hello && dotnet run
```

- Pitfall: an app targeting `net8.0` needs the .NET 8 runtime (or newer with roll-forward settings) on the machine unless you publish self-contained.
- Interview tip: be able to explain the difference between .NET Framework, .NET Core and modern ".NET 5+".

### From C# source to machine code: IL, JIT and AOT
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/standard/managed-execution-process -->
The C# compiler does not produce native code. It emits Common Intermediate Language (IL) plus metadata into an assembly (`.dll`). At run time the JIT (just-in-time) compiler, RyuJIT, turns each method's IL into machine code the first time it is called.

Modern .NET uses tiered compilation. A method is first compiled quickly with few optimisations (tier 0) so startup is fast. If it gets called often, it is recompiled in the background with full optimisations (tier 1). Dynamic PGO (profile-guided optimisation, on by default since .NET 8) instruments tier-0 code to learn which types and branches are hot, then uses that to devirtualise and inline aggressively.

There are ways to avoid or reduce JIT work:
- ReadyToRun (R2R) precompiles IL to native code inside the assembly; the JIT can still re-optimise hot methods later.
- Native AOT compiles the whole app ahead of time into a single native executable with no JIT at all, giving very fast startup and small memory, at the cost of restrictions on reflection and dynamic code.

```xml
<PropertyGroup>
  <PublishReadyToRun>true</PublishReadyToRun>
  <!-- or, for a fully native binary: -->
  <PublishAot>true</PublishAot>
</PropertyGroup>
```

- Pitfall: benchmarking the first call measures JIT time, not your code. Warm up first.
- Interview tip: "IL is CPU-independent; the JIT specialises it for the actual CPU, which is why .NET can use AVX-512 when available."

### The dotnet CLI and SDK-style project files
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/core/tools/ -->
The `dotnet` command is the single entry point for creating, building, testing, running and publishing code. Behind the scenes it drives MSBuild using your `.csproj` file.

Modern project files are "SDK-style": short, because the SDK supplies sensible defaults. All `.cs` files under the folder are compiled automatically; you only list exceptions.

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Serilog" Version="4.0.0" />
    <ProjectReference Include="..\Core\Core.csproj" />
  </ItemGroup>
</Project>
```

Everyday commands:
- `dotnet new sln`, `dotnet sln add`, `dotnet new classlib`
- `dotnet build -c Release`, `dotnet test`, `dotnet run`
- `dotnet publish -c Release -r linux-x64 --self-contained`
- `dotnet add package <name>` and `dotnet list package --vulnerable`

Shared settings for a whole repo go in `Directory.Build.props` at the root, so every project inherits the same language version, analyzers and warnings policy. A `global.json` pins the SDK version so every developer and CI agent builds with the same compiler.

- Pitfall: forgetting `global.json` means CI silently upgrades to a newer SDK and new analyzer warnings break the build.

### Program structure and top-level statements
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/fundamentals/program-structure/top-level-statements -->
Every C# program needs an entry point. Traditionally that is a `static void Main(string[] args)` method inside a class. Since C# 9 you can write top-level statements instead: code placed directly in one file (usually `Program.cs`) becomes the body of a compiler-generated `Main`.

```csharp
// Program.cs - the whole program
using System.Text.Json;

var name = args.Length > 0 ? args[0] : "world";
Console.WriteLine($"Hello, {name}!");

var data = await File.ReadAllTextAsync("config.json");
var cfg = JsonSerializer.Deserialize<Config>(data);
return cfg is null ? 1 : 0;   // exit code

record Config(string Env);
```

Rules worth knowing:
- Only one file in a project may contain top-level statements.
- `args` is available implicitly; `await` works, making `Main` async automatically; `return` sets the exit code.
- Types declared in the file must come after the statements.

Namespaces organise types. File-scoped namespaces (`namespace Shop.Orders;`, C# 10) apply to the whole file and remove one level of indentation. Implicit usings (enabled in new templates) import common namespaces such as `System`, `System.IO` and `System.Linq`, and you can add your own with `global using`.

- Interview tip: top-level statements are syntax sugar only; the generated IL still has a `Program` class and a `Main` method.

### File-based apps (.NET 10)
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/core/whats-new/dotnet-10/overview -->
.NET 10 lets you run a single `.cs` file without creating a project: `dotnet run app.cs`. The SDK creates a hidden, temporary project behind the scenes, builds it and runs it. This makes C# practical for scripts, quick experiments and teaching, much like Python or Node scripts.

Special directives at the top of the file replace what you would normally put in a `.csproj`:

```csharp
#!/usr/bin/env dotnet
#:package Humanizer@2.14.1
#:property Nullable=enable

using Humanizer;

var since = DateTime.UtcNow - new DateTime(2025, 11, 11);
Console.WriteLine($"Released {since.Humanize()} ago");
```

- `#:package` adds a NuGet reference.
- `#:property` sets an MSBuild property.
- `#:sdk` switches the SDK (for example to `Microsoft.NET.Sdk.Web` for a tiny web app).
- On Unix, the shebang line plus `chmod +x` lets you run the file directly.

When the script grows, `dotnet project convert app.cs` turns it into a normal project with a `.csproj`.

Why it matters: it lowers the barrier for automation tasks that teams previously wrote in PowerShell or Python, and it uses exactly the same compiler and libraries as full projects.

- Pitfall: file-based apps are for single-file scenarios; multi-file solutions, tests and libraries still belong in projects.

### NuGet packages and central package management
<!-- level: intermediate; ref: https://learn.microsoft.com/nuget/consume-packages/central-package-management -->
NuGet is the package manager for .NET. A `PackageReference` in a project tells the SDK to restore that package (and its transitive dependencies) from nuget.org or a private feed into the global packages folder.

In a solution with many projects, versions drift: one project uses `Newtonsoft.Json` 13.0.1, another 13.0.3. Central Package Management (CPM) fixes this by putting all versions in one `Directory.Packages.props` file at the repo root; projects then reference packages without a version.

```xml
<!-- Directory.Packages.props -->
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Polly" Version="8.4.2" />
    <PackageVersion Include="xunit.v3" Version="1.0.0" />
  </ItemGroup>
</Project>

<!-- any .csproj -->
<PackageReference Include="Polly" />
```

Other practices for a healthy dependency graph:
- Enable `NuGetAudit` (on by default in recent SDKs) so restore warns about known vulnerable packages, including transitive ones.
- Use a lock file (`RestorePackagesWithLockFile`) for reproducible CI restores.
- Configure `nuget.config` with package source mapping so internal package names can only come from your private feed, which blocks dependency-confusion attacks.

- Pitfall: two libraries needing different major versions of the same dependency cause runtime `FileLoadException` or `MissingMethodException`; resolve by aligning versions centrally.

## 2. Types, variables and values
### Value types vs reference types
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/value-types -->
Every C# type is either a value type or a reference type, and this decides how data is copied and where it usually lives.

- Value types (`int`, `double`, `bool`, `char`, `DateTime`, enums, structs, tuples) hold their data directly. Assigning one variable to another copies the data.
- Reference types (classes, `string`, arrays, delegates, records declared as `record class`) hold a reference to an object on the managed heap. Assigning copies the reference, so two variables can see the same object.

"Value types live on the stack" is a simplification. A local `int` usually sits on the stack or in a register, but an `int` field inside a class lives on the heap inside that object. What really differs is copy semantics and identity.

```csharp
int a = 10;
int b = a;     // copy
b++;           // a is still 10

int[] x = { 1, 2, 3 };
int[] y = x;   // same array
y[0] = 99;     // x[0] is now 99

void Reset(int[] arr) => arr[0] = 0;   // caller sees the change
void Replace(int[] arr) => arr = new int[3]; // caller does NOT see this
```

The last two lines show that reference types are still passed by value: the method receives a copy of the reference. Changing the object is visible; reassigning the parameter is not (unless you use `ref`).

- Pitfall: default value of a reference type is `null`; default of a value type is all-zero (`0`, `false`, `default(DateTime)`).
- Interview tip: separate the ideas "value vs reference type" and "pass by value vs pass by reference"; they are independent.

### Numeric types, overflow and precision
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/integral-numeric-types -->
C# has integer types of fixed width (`byte`, `short`, `int`, `long`, plus unsigned versions, `nint` for native size, and `Int128` since .NET 7) and three main real-number types:

- `float` and `double`: binary floating point (IEEE 754). Fast and wide-ranged, but cannot represent many decimal fractions exactly, so `0.1 + 0.2 != 0.3`.
- `decimal`: 128-bit base-10 type with 28-29 significant digits. Slower, but exact for decimal fractions, which is why money uses it.

Integer arithmetic silently wraps on overflow by default for performance. Inside a `checked` block (or with `<CheckForOverflowUnderflow>` in the project) overflow throws `OverflowException`.

```csharp
int max = int.MaxValue;
int wrapped = max + 1;                  // -2147483648, no error
int safe = checked(max + 1);            // throws OverflowException

double d = 0.1 + 0.2;                   // 0.30000000000000004
decimal m = 0.1m + 0.2m;                // 0.3 exactly

int half = 7 / 2;                       // 3, integer division
double real = 7 / 2.0;                  // 3.5
bool close = Math.Abs(d - 0.3) < 1e-9;  // compare doubles with tolerance
```

Division by zero throws for integers and `decimal`, but produces `Infinity` or `NaN` for `double`.

- Pitfall: computing totals in `double` and rounding later produces off-by-a-cent errors in invoices.
- Pitfall: `NaN` is not equal to itself; use `double.IsNaN`.
- Interview tip: mention `checked` for financial counters or ID arithmetic where wrap-around would be a security bug.

### Type inference with var and target-typed new
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/statements/declarations -->
C# is statically typed: every variable has a type fixed at compile time. `var` does not change that; it just lets the compiler infer the type from the initializer.

```csharp
var count = 10;                          // int
var names = new List<string>();          // List<string>
var lookup = orders.ToDictionary(o => o.Id); // Dictionary<int, Order>

// target-typed new (C# 9): type comes from the left side
Dictionary<string, List<int>> scores = new();
Point origin = new(0, 0);

// var is required for anonymous types
var summary = new { Name = "Asha", Total = 42m };
Console.WriteLine(summary.Total);
```

Once inferred, the type never changes: `count = "ten";` is a compile error. This is unlike `dynamic`, which really does defer type checking to run time (and is rarely the right choice in modern code).

Style guidance used by most teams:
- Use `var` when the type is obvious from the right-hand side (`new`, casts, well-named factory methods).
- Spell out the type when it carries meaning a reader cannot see, for example `decimal price = GetPrice();` rather than `var price = GetPrice();`.
- Use target-typed `new()` for fields and properties where the type is declared on the left.

- Pitfall: `var x = 5;` gives `int`, not `long` or `decimal`. Use suffixes (`5L`, `5m`) when you need another numeric type.
- Interview tip: `var` has zero run-time cost; the IL is identical to an explicitly typed declaration.

### Strings, interpolation and raw string literals
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/tokens/raw-string -->
`string` is an immutable reference type holding UTF-16 code units. "Modifying" a string always creates a new one, which makes strings safe to share between threads and use as dictionary keys.

Ways to build strings:
- Interpolation: `$"Order {id} costs {total:C}"` with format specifiers and alignment.
- Verbatim strings: `@"C:\temp\file.txt"` where backslashes are literal.
- Raw string literals (C# 11): three or more double quotes; no escaping needed and indentation is trimmed relative to the closing quotes. Great for JSON, SQL and regex.

```csharp
var id = 42;
var json = $$"""
    {
      "id": {{id}},
      "tags": ["a", "b"]
    }
    """;   // $$ means {{ }} is interpolation, single { } stays literal

bool same = string.Equals("straße", "STRASSE",
    StringComparison.OrdinalIgnoreCase);   // false: ordinal compares code units
bool starts = path.StartsWith("/api", StringComparison.Ordinal);
```

Comparisons deserve attention. By default `==` is ordinal and case-sensitive. Methods like `StartsWith(string)` without a `StringComparison` use the current culture, which is slower and can behave unexpectedly (the Turkish "i" problem). For identifiers, paths and protocol values always pass `StringComparison.Ordinal` or `OrdinalIgnoreCase`.

- Pitfall: `s.ToLower() == other.ToLower()` allocates two strings and is culture-sensitive; use `string.Equals(a, b, StringComparison.OrdinalIgnoreCase)`.
- Pitfall: `string.Length` counts UTF-16 units, not user-visible characters; emoji count as 2.

### Nullable value types and nullable reference types
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/csharp/nullable-references -->
C# has two separate "nullable" features that look similar but work differently.

Nullable value types (`int?`, short for `Nullable<int>`) are a real runtime type: a struct holding a value plus a `HasValue` flag. They let a value type represent "missing", such as an optional database column.

Nullable reference types (NRT, C# 8, enabled by default in new projects with `<Nullable>enable</Nullable>`) are a compile-time analysis only. With the feature on, `string` means "should never be null" and `string?` means "may be null". The compiler tracks null state through your code and warns when you might dereference null. At run time nothing changes: `string` and `string?` are the same type.

```csharp
int? age = null;
int years = age ?? 0;           // null-coalescing
if (age is int a) Console.WriteLine(a);

string? nickname = user.Nickname;
int len = nickname?.Length ?? 0; // null-conditional + coalescing
nickname ??= "guest";            // assign if null

string name = GetName()!;        // "!" suppresses the warning - use sparingly
```

Why it matters: `NullReferenceException` is the most common .NET crash. NRT moves many of those failures to compile time, and annotated APIs document intent.

- Pitfall: NRT gives no runtime guarantee. Public methods should still validate arguments (`ArgumentNullException.ThrowIfNull`) because callers may have NRT disabled.
- Pitfall: liberal use of `!` silences the analysis and recreates the original problem.
- Interview tip: treat warnings as errors for nullable (`<WarningsAsErrors>nullable</WarningsAsErrors>`) in new code.

### Constants, readonly fields and enums
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/enum -->
Immutability starts with simple declarations:

- `const` values are compile-time constants (numbers, `bool`, `char`, strings, enums) and are copied into every call site.
- `readonly` fields can be assigned only in the declaration or a constructor, and can hold any type.
- `static readonly` is the usual choice for shared values computed at startup, such as a frozen lookup table.

Enums give names to a set of integral constants. They are value types whose underlying type defaults to `int`.

```csharp
public enum OrderStatus { Pending = 0, Paid = 1, Shipped = 2, Cancelled = 9 }

[Flags]
public enum Permissions { None = 0, Read = 1, Write = 2, Delete = 4, All = Read | Write | Delete }

var p = Permissions.Read | Permissions.Write;
bool canWrite = p.HasFlag(Permissions.Write);   // or (p & Permissions.Write) != 0

var status = (OrderStatus)5;                    // compiles and runs: undefined value!
bool valid = Enum.IsDefined(status);            // false
bool parsed = Enum.TryParse<OrderStatus>("Paid", ignoreCase: true, out var s);
```

Enums are not closed sets: any integer can be cast to an enum type. Always validate enum values coming from users, JSON or databases, and include a `default` branch in switches.

- Pitfall: renumbering enum members breaks persisted data. Give stored enums explicit values and never reuse numbers.
- Pitfall: `[Flags]` values must be powers of two, and you should define `None = 0`.
- Interview tip: serialising enums as strings (for JSON APIs) is safer for evolution than numbers.

### Conversions, casting and parsing
<!-- level: basic; ref: https://learn.microsoft.com/dotnet/csharp/programming-guide/types/casting-and-type-conversions -->
C# separates conversions that are always safe from those that might fail or lose data.

- Implicit conversions happen automatically when no data can be lost: `int` to `long`, a derived class to its base class.
- Explicit casts `(T)x` are required when information may be lost (`double` to `int` truncates) or when a reference conversion might fail at run time (`InvalidCastException`).
- `is` tests a type and can bind a variable; `as` returns `null` instead of throwing for reference types.
- Parsing text uses `Parse` (throws on bad input) or `TryParse` (returns `bool`), which is the right default for user input.

```csharp
double price = 9.99;
int whole = (int)price;               // 9 (truncation)
int rounded = (int)Math.Round(price); // 10

object o = GetShape();
if (o is Circle c) Console.WriteLine(c.Radius);  // type pattern
var sq = o as Square;                             // null if not a Square

if (!int.TryParse(input, out var qty) || qty <= 0)
    return Results.BadRequest("Quantity must be a positive number");

var amount = decimal.Parse("1234.50", CultureInfo.InvariantCulture);
```

Culture is a frequent source of bugs: `double.Parse("1.5")` returns 15 on a machine whose culture uses comma as decimal separator. For data exchange (files, APIs, config) pass `CultureInfo.InvariantCulture`; use the user's culture only for display and user input.

- Pitfall: `Convert.ToInt32(null)` returns 0 while `int.Parse(null)` throws; know which behaviour you want.
- Interview tip: prefer pattern matching (`is T t`) over `as` plus a null check; it reads better and works with value types.
