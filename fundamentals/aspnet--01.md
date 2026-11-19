## 1. ASP.NET Core foundations
### What ASP.NET Core is and how a request flows
<!-- level: basic; ref: https://learn.microsoft.com/aspnet/core/introduction-to-aspnet-core -->
ASP.NET Core is Microsoft's open-source, cross-platform framework for building web applications and services on .NET: REST and gRPC APIs, server-rendered sites (MVC, Razor Pages), interactive web UI (Blazor) and real-time apps (SignalR). It runs on Windows, Linux and macOS, in containers or serverless hosts, and consistently ranks among the fastest mainstream web frameworks.

The journey of a request:
1. A server receives the connection. By default that is Kestrel, a cross-platform, high-performance HTTP server built into every app. It may sit behind a reverse proxy (nginx, IIS, a cloud load balancer).
2. Kestrel parses the HTTP request into an `HttpContext` object containing `Request`, `Response`, `User`, `RequestServices`, `Items` and a cancellation token (`RequestAborted`).
3. The context passes through the middleware pipeline: a chain of components such as exception handling, HTTPS redirection, static files, routing, authentication, authorization, CORS and rate limiting.
4. Routing selects an endpoint: a minimal API handler, a controller action, a Razor Page, a gRPC method or a SignalR hub.
5. The endpoint runs, using dependency injection for services, model binding for inputs, and writes a response.
6. The response travels back out through the middleware in reverse order.

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => "Hello from ASP.NET Core");
app.MapGet("/time", (TimeProvider clock) => new { utc = clock.GetUtcNow() });

app.Run();
```

Everything is opt-in: the framework adds only what you configure, which keeps apps lean.

- Pitfall: confusing ASP.NET Core with classic ASP.NET (System.Web on .NET Framework). They share concepts but not code or hosting model.
- Interview tip: be able to sketch the server, middleware, routing and endpoint layers on a whiteboard.

### Program.cs and the WebApplication builder
<!-- level: basic; ref: https://learn.microsoft.com/aspnet/core/fundamentals/ -->
Since .NET 6, an ASP.NET Core app is typically configured in a single `Program.cs` with top-level statements, in two phases:

1. Builder phase: `WebApplication.CreateBuilder(args)` sets up configuration (appsettings, environment variables, command line, user secrets in Development), logging, the host and Kestrel. You register services on `builder.Services` and can adjust `builder.Configuration`, `builder.Logging` and `builder.WebHost`.
2. App phase: `builder.Build()` creates the `WebApplication`. Then you add middleware (`app.UseXxx`) and map endpoints (`app.MapXxx`), and finally `app.Run()` starts the server.

Once `Build()` is called, the service collection is frozen; registering services afterwards throws.

```csharp
var builder = WebApplication.CreateBuilder(args);

// 1. Services
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddDbContext<ShopDb>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Shop")));
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddAuthentication().AddJwtBearer();
builder.Services.AddAuthorization();

var app = builder.Build();

// 2. Middleware pipeline
app.UseExceptionHandler();
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();

// 3. Endpoints
if (app.Environment.IsDevelopment()) app.MapOpenApi();
app.MapGroup("/api/orders").MapOrderEndpoints().RequireAuthorization();

app.Run();
```

Large apps organise registrations into extension methods (`builder.Services.AddOrdering()`) and endpoints into modules, keeping `Program.cs` short and readable.

Variants: `WebApplication.CreateSlimBuilder` (.NET 8) starts with fewer defaults for Native AOT and minimal footprint; `CreateEmptyBuilder` starts with nothing.

- Pitfall: middleware is executed in the order it is added; the order in `Program.cs` is the order requests see.
- Interview tip: older apps use `Startup.cs` with `ConfigureServices` and `Configure`; the concepts map one to one.

### App types: APIs, MVC, Razor Pages and Blazor
<!-- level: basic; ref: https://learn.microsoft.com/aspnet/core/tutorials/choose-web-ui -->
ASP.NET Core supports several programming models that share the same host, DI, configuration, middleware and security. Choosing the right one depends on what you are building.

- Minimal APIs: endpoints declared with lambdas or methods (`app.MapGet`). Lightweight, fast, AOT-friendly. The default template for new HTTP APIs.
- Controllers (Web API): classes with action methods, attribute routing and filters. Familiar structure for large APIs and teams coming from MVC.
- MVC with views: controllers plus Razor views (`.cshtml`) for server-rendered HTML; separates model, view and controller.
- Razor Pages: page-focused model where each page has its markup and a `PageModel` handler class. Simpler than MVC for form-centric sites.
- Blazor: component-based UI in C# and Razor. Components can render statically on the server, interactively over a SignalR connection (Interactive Server), in the browser on WebAssembly, or switch between them (Auto).
- gRPC services and SignalR hubs for service-to-service RPC and real-time push.

```bash
dotnet new webapi -n Orders.Api          # minimal API by default
dotnet new webapi --use-controllers -n Legacy.Api
dotnet new webapp -n Portal              # Razor Pages
dotnet new mvc -n Admin
dotnet new blazor -n Dashboard
dotnet new grpc -n Pricing
```

You can mix models in one app: a Blazor site that also exposes minimal API endpoints and a SignalR hub, all sharing the same authentication.

- Pitfall: choosing Blazor WebAssembly for a public, SEO-sensitive marketing site without prerendering gives a slow first load.
- Interview tip: explain why you would pick minimal APIs or controllers for a given team and codebase, rather than claiming one is universally better.

### Environments and launch settings
<!-- level: basic; ref: https://learn.microsoft.com/aspnet/core/fundamentals/environments -->
ASP.NET Core reads the current environment from the `ASPNETCORE_ENVIRONMENT` variable (or `DOTNET_ENVIRONMENT`). The built-in names are `Development`, `Staging` and `Production`; if nothing is set, the app assumes Production, the safest default.

The environment drives several behaviours:
- Which configuration file layers on top: `appsettings.Development.json`, `appsettings.Production.json`.
- Whether user secrets are loaded (Development only).
- The developer exception page and DI scope validation are enabled by default in Development.
- Your own code can branch on `app.Environment.IsDevelopment()`.

`Properties/launchSettings.json` is used only by local tooling (`dotnet run`, Visual Studio). It sets URLs, environment variables and launch profiles for development. It is not deployed and has no effect in production.

```json
{
  "profiles": {
    "https": {
      "commandName": "Project",
      "applicationUrl": "https://localhost:7043;http://localhost:5043",
      "environmentVariables": { "ASPNETCORE_ENVIRONMENT": "Development" }
    }
  }
}
```

```csharp
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}
else
{
    app.UseExceptionHandler();
    app.UseHsts();
}

var useFakePayments = app.Environment.IsEnvironment("Demo");   // custom environment
```

- Pitfall: forgetting to set the environment on a test server means it runs as Production with production configuration, or the reverse: accidentally running Development in production exposes detailed error pages.
- Pitfall: scattering `IsDevelopment()` checks through business code; keep environment differences in configuration and startup.
- Interview tip: Docker and Kubernetes set environment variables in the deployment manifest, not in `launchSettings.json`.

## 2. Hosting, dependency injection and configuration
### The host, Kestrel configuration and application lifetime
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/fundamentals/servers/kestrel -->
An ASP.NET Core app runs inside a host that owns the DI container, configuration, logging, hosted services and the server. The host also manages lifetime: starting hosted services, starting Kestrel, and on shutdown (SIGTERM, Ctrl+C, IIS recycle) stopping new connections, letting in-flight requests finish within a timeout, and disposing services.

Kestrel listens on the URLs you configure via `ASPNETCORE_URLS` / `ASPNETCORE_HTTP_PORTS` (container images default to port 8080 since .NET 8), `appsettings.json`, or code. It supports HTTP/1.1, HTTP/2 and HTTP/3, TLS, and limits that protect against abuse.

```csharp
builder.WebHost.ConfigureKestrel(k =>
{
    k.Limits.MaxRequestBodySize = 10 * 1024 * 1024;      // 10 MB
    k.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(15);
    k.AddServerHeader = false;
});

builder.Services.Configure<HostOptions>(o =>
    o.ShutdownTimeout = TimeSpan.FromSeconds(25));       // graceful drain window

var app = builder.Build();

app.Lifetime.ApplicationStarted.Register(() => app.Logger.LogInformation("Ready"));
app.Lifetime.ApplicationStopping.Register(() => app.Logger.LogInformation("Draining..."));
```

```json
{
  "Kestrel": {
    "Endpoints": {
      "Http":  { "Url": "http://0.0.0.0:8080" },
      "Https": { "Url": "https://0.0.0.0:8443",
                 "Certificate": { "Path": "/certs/tls.pfx", "Password": "<from secret store>" } }
    }
  }
}
```

Graceful shutdown matters in Kubernetes and autoscaling: when a pod is terminated, it receives SIGTERM, and requests in progress should finish. Set the shutdown timeout below the orchestrator's grace period, and pass `HttpContext.RequestAborted` or `stoppingToken` into long operations.

- Pitfall: binding to `localhost` inside a container makes the app unreachable from outside the container; bind to `0.0.0.0` or `+`.
- Interview tip: Kestrel can face the internet directly in modern versions, but a reverse proxy or gateway still helps with TLS termination, WAF rules and multiple apps on one IP.

### Dependency injection in ASP.NET Core
<!-- level: basic; ref: https://learn.microsoft.com/aspnet/core/fundamentals/dependency-injection -->
Dependency injection (DI) is built into ASP.NET Core. Instead of classes creating their collaborators with `new`, they declare what they need (usually in the constructor) and the container supplies it. This decouples components, makes them easy to replace in tests, and centralises object lifetimes.

You register services on `builder.Services` by mapping a service type (often an interface) to an implementation and a lifetime. The framework resolves them when it creates controllers, minimal API handlers, middleware, hosted services, Razor components and hubs.

```csharp
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<IOrderRepository, EfOrderRepository>();
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddTransient<IPriceCalculator, PriceCalculator>();
builder.Services.AddHttpClient<IPaymentGateway, StripeGateway>();

public sealed class OrderService(IOrderRepository repo, IPriceCalculator prices,
    ILogger<OrderService> log) : IOrderService
{
    public async Task<OrderDto> PlaceAsync(PlaceOrder cmd, CancellationToken ct)
    {
        var total = prices.Calculate(cmd.Lines);
        var order = await repo.AddAsync(cmd, total, ct);
        log.LogInformation("Order {OrderId} placed", order.Id);
        return order.ToDto();
    }
}

// Minimal API: services injected as handler parameters
app.MapPost("/orders", (PlaceOrder cmd, IOrderService svc, CancellationToken ct)
    => svc.PlaceAsync(cmd, ct));
```

Useful registration helpers: `TryAddScoped` (register only if not already registered, used by libraries), `services.Replace(...)` in tests, and open generics like `AddScoped(typeof(IRepository<>), typeof(Repository<>))`.

The container disposes `IDisposable` services it created at the end of their lifetime.

- Pitfall: very large constructors (eight or more dependencies) signal a class doing too much; split it rather than hiding dependencies.
- Pitfall: resolving services from `HttpContext.RequestServices` or a static `IServiceProvider` in business code (service locator) hides dependencies.
- Interview tip: the built-in container intentionally has no property injection or assembly scanning; libraries like Scrutor add scanning if needed.

### Service lifetimes, captive dependencies and scope validation
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/core/extensions/dependency-injection#service-lifetimes -->
Each registration has a lifetime that decides when instances are created and shared:

- Transient: a new instance for every resolution.
- Scoped: one instance per scope. ASP.NET Core creates a scope per HTTP request (and per SignalR hub invocation, per Blazor circuit), so scoped services are shared within a request. `DbContext` is scoped by default.
- Singleton: one instance for the application's lifetime, shared by all requests and threads, so it must be thread-safe.

The golden rule: a service must not depend on something with a shorter lifetime. A singleton holding a scoped `DbContext` keeps the first request's context forever (a captive dependency), sharing it across threads and leaking tracked entities. A singleton capturing a transient `IDisposable` keeps it alive forever too.

ASP.NET Core validates scopes when the environment is Development: resolving a scoped service from the root provider, or injecting it into a singleton, throws at startup or on first use. You can enable it everywhere:

```csharp
builder.Host.UseDefaultServiceProvider(o =>
{
    o.ValidateScopes = true;
    o.ValidateOnBuild = true;     // check all registrations can be constructed at startup
});

// A singleton that needs scoped work creates its own scope
public sealed class ExchangeRateRefresher(IServiceScopeFactory scopes) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(10));
        while (await timer.WaitForNextTickAsync(ct))
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<ShopDb>();
            await RefreshAsync(db, ct);
        }
    }
}
```

- Pitfall: storing per-request data (current user, tenant) in a singleton field mixes data between users, which is a serious security bug.
- Pitfall: registering `DbContext` as singleton "for performance" causes threading exceptions and stale data; use `AddDbContextPool` instead.
- Interview tip: when unsure, choose scoped for anything touching request state or a database, singleton for stateless thread-safe helpers and caches.

### Keyed services
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/fundamentals/dependency-injection#keyed-services -->
Sometimes you need several implementations of the same interface and must choose one by name: a "fast" and a "durable" cache, payment providers per country, or storage per tenant tier. Before .NET 8 this required factories or wrapper types. .NET 8 added keyed services to the built-in container: you register implementations under a key and request them by key.

```csharp
builder.Services.AddKeyedSingleton<IFileStore, LocalFileStore>("local");
builder.Services.AddKeyedSingleton<IFileStore, BlobFileStore>("blob");
builder.Services.AddKeyedScoped<IPaymentProvider, RazorpayProvider>("IN");
builder.Services.AddKeyedScoped<IPaymentProvider, StripeProvider>("US");

// Constructor injection by key
public sealed class InvoiceArchiver([FromKeyedServices("blob")] IFileStore store)
{
    public Task ArchiveAsync(Stream pdf, string name, CancellationToken ct)
        => store.SaveAsync(name, pdf, ct);
}

// Minimal API parameter
app.MapGet("/files/{name}", ([FromKeyedServices("local")] IFileStore store, string name)
    => store.OpenAsync(name));

// Choosing at run time
app.MapPost("/pay", async (PayRequest req, IServiceProvider sp, CancellationToken ct) =>
{
    var provider = sp.GetRequiredKeyedService<IPaymentProvider>(req.Country);
    return await provider.ChargeAsync(req, ct);
});
```

Keys can be any object, though strings and enums are typical. The implementation can receive its own key via `[ServiceKey]` on a constructor parameter, useful when one class serves several keys with different configuration.

When to use keyed services versus alternatives:
- Fixed, known set of named variants: keyed services are simple and clear.
- Selection based on complex rules: a factory or strategy class that takes `IEnumerable<IPaymentProvider>` and picks by a property is often more testable.

- Pitfall: run-time `GetRequiredKeyedService` with user input throws for unknown keys; validate input and return 400 rather than 500.
- Interview tip: keyed services also work with options via named options (`IOptionsMonitor<T>.Get(name)`), which pairs well with per-key configuration.

### Configuration providers and precedence
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/fundamentals/configuration/ -->
Configuration in ASP.NET Core is a flattened key-value store built from multiple providers. Hierarchical keys use a colon (`Payments:Stripe:ApiKey`); in environment variables, a double underscore stands in for the colon (`Payments__Stripe__ApiKey`) because colons are not allowed on all platforms.

`WebApplication.CreateBuilder` adds providers in this order, and later providers override earlier ones:
1. `appsettings.json`
2. `appsettings.{Environment}.json`
3. User secrets (Development only)
4. Environment variables
5. Command-line arguments

You can add more: Azure Key Vault, Azure App Configuration, AWS Parameter Store, Kubernetes mounted files (`AddKeyPerFile`), or an in-memory collection for tests.

```csharp
builder.Configuration
    .AddJsonFile("featureflags.json", optional: true, reloadOnChange: true)
    .AddEnvironmentVariables(prefix: "SHOP_");

string? conn = builder.Configuration.GetConnectionString("Shop");   // ConnectionStrings:Shop
int pageSize = builder.Configuration.GetValue("Catalog:PageSize", 20);
var section = builder.Configuration.GetSection("Payments");
```

```bash
# Override a nested value in a container
export Payments__Stripe__TimeoutSeconds=15
dotnet Shop.Api.dll --Catalog:PageSize=50
```

JSON files can reload at run time when changed (`reloadOnChange`). Code that reads values through `IOptionsMonitor<T>` sees the new values; values copied into fields at startup do not change.

- Pitfall: arrays in configuration are indexed keys (`Hosts:0`, `Hosts:1`); overriding one element through an environment variable does not remove the others.
- Pitfall: a typo in a key silently yields `null` or the default; validate options at startup.
- Interview tip: explain the precedence order and how you would supply a secret in production without touching files.

### The options pattern and validation
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/fundamentals/configuration/options -->
Reading configuration with string keys everywhere is fragile. The options pattern binds a configuration section to a strongly typed class and injects it through DI, which gives type safety, defaults, validation, and a single place to document settings.

Three ways to consume options:
- `IOptions<T>`: singleton, values bound once at first use. Simplest.
- `IOptionsSnapshot<T>`: scoped, recomputed per request; sees reloaded values. Cannot be injected into singletons.
- `IOptionsMonitor<T>`: singleton with `CurrentValue` always up to date and an `OnChange` callback; supports named options.

Validation catches misconfiguration at startup instead of at 2 a.m. when the code path first runs.

```csharp
public sealed class SmtpOptions
{
    public const string Section = "Smtp";
    [Required] public string Host { get; set; } = "";
    [Range(1, 65535)] public int Port { get; set; } = 587;
    [Required, EmailAddress] public string From { get; set; } = "";
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(10);
}

builder.Services.AddOptions<SmtpOptions>()
    .BindConfiguration(SmtpOptions.Section)
    .ValidateDataAnnotations()
    .Validate(o => o.Timeout < TimeSpan.FromMinutes(1), "Timeout too long")
    .ValidateOnStart();                       // fail fast during startup

public sealed class Mailer(IOptionsMonitor<SmtpOptions> options)
{
    public Task SendAsync(string to, string body)
    {
        var o = options.CurrentValue;         // picks up reloaded config
        // connect to o.Host:o.Port ...
        return Task.CompletedTask;
    }
}
```

For AOT and faster startup, .NET 8 added source generators for configuration binding and for options validation (`[OptionsValidator]` on a partial class implementing `IValidateOptions<T>`).

- Pitfall: without `ValidateOnStart`, validation runs only when options are first requested, so bad config is discovered late.
- Pitfall: injecting `IOptionsSnapshot<T>` into a singleton causes a scope validation error.
- Interview tip: keep options classes small and per feature, rather than one giant `AppSettings` class.

### Logging with ILogger and high-performance log messages
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/fundamentals/logging/ -->
ASP.NET Core includes a logging abstraction (`ILogger<T>`) with pluggable providers: console, debug, EventSource, EventLog, and through packages, OpenTelemetry, Application Insights, Serilog, Seq and others. The category (usually the class name from `ILogger<T>`) and the level (Trace, Debug, Information, Warning, Error, Critical) let you filter output per namespace in configuration.

Structured logging is the key idea: you write a message template with named placeholders, and providers store the values as separate properties. You can then query "all logs where OrderId = 42" instead of searching text.

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore.Database.Command": "Warning"
    }
  }
}
```

```csharp
public sealed partial class CheckoutService(ILogger<CheckoutService> log)
{
    public async Task CheckoutAsync(Cart cart, CancellationToken ct)
    {
        using (log.BeginScope(new Dictionary<string, object> { ["CartId"] = cart.Id }))
        {
            log.LogInformation("Checkout started with {ItemCount} items", cart.Items.Count);
            try { /* ... */ }
            catch (PaymentException ex)
            {
                LogPaymentFailed(cart.Id, ex.Code, ex);
                throw;
            }
        }
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Payment failed for cart {CartId} with code {Code}")]
    private partial void LogPaymentFailed(Guid cartId, string code, Exception ex);
}
```

The `[LoggerMessage]` source generator creates efficient logging methods that check whether the level is enabled first and avoid boxing, which matters on hot paths. Scopes attach properties (like a cart id) to every log written inside them.

- Pitfall: `log.LogInformation($"Order {id}")` loses structure and formats even when Information is disabled.
- Pitfall: logging tokens, passwords, full card numbers or personal data creates compliance problems; use redaction (Microsoft.Extensions.Compliance.Redaction) and review what you log.
- Interview tip: logs, metrics and traces are complementary; logs explain individual events, metrics show trends, traces show request paths.
