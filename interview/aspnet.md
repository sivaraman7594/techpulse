# ASP.NET Core interview questions

### What is middleware in ASP.NET Core, and why does order matter?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/aspnet/core/fundamentals/middleware/ -->
Middleware are components chained into a pipeline. Each one can handle the request, call the next component, and then act on the response on the way back.

Order matters because each middleware only sees what earlier ones allowed through. A typical order:

```csharp
app.UseExceptionHandler("/error");
app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.UseCors();
app.UseAuthentication();   // who are you?
app.UseAuthorization();    // are you allowed?
app.MapControllers();
```

Putting `UseAuthorization` before `UseAuthentication`, for example, means the user is never identified when authorization runs.

### Explain the dependency injection lifetimes: Singleton, Scoped and Transient.
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/dotnet/core/extensions/dependency-injection#service-lifetimes -->
- **Transient**: a new instance every time it is requested. Good for lightweight, stateless services.
- **Scoped**: one instance per scope — in ASP.NET Core, per HTTP request. `DbContext` is scoped by default.
- **Singleton**: one instance for the app's lifetime. Must be thread-safe.

The common trap is a **captive dependency**: a singleton that depends on a scoped service (e.g. a `DbContext`) keeps that one instance alive forever, sharing it across requests and threads. In Development, ASP.NET Core's scope validation throws an error for this. Fix it by making the consumer scoped, or by creating a scope with `IServiceScopeFactory` when needed.

### What is the difference between Minimal APIs and controllers?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/aspnet/core/fundamentals/apis -->
Both build HTTP APIs on the same routing, DI and middleware.

- **Minimal APIs** map endpoints directly with lambdas (`app.MapGet(...)`). Less ceremony; great for small services and microservices. Endpoint filters and route groups give structure.
- **Controllers** group actions in classes with attributes, model binding conventions, and MVC filters. Familiar for large APIs with many endpoints.

```csharp
app.MapGet("/users/{id:int}", async (int id, AppDb db) =>
    await db.Users.FindAsync(id) is { } user ? Results.Ok(user) : Results.NotFound());
```

### How does configuration work, and what is the Options pattern?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/aspnet/core/fundamentals/configuration/options -->
Configuration is layered from multiple providers; later ones override earlier ones: `appsettings.json` → `appsettings.{Environment}.json` → user secrets (Development) → environment variables → command line. Azure Key Vault or App Configuration can be added too.

The **Options pattern** binds a section to a typed class:
- `IOptions<T>` — read once (singleton).
- `IOptionsSnapshot<T>` — re-read per request (scoped).
- `IOptionsMonitor<T>` — singleton that gets change notifications.

```csharp
builder.Services.Configure<SmtpOptions>(builder.Configuration.GetSection("Smtp"));
public class Mailer(IOptions<SmtpOptions> options) { /* options.Value.Host */ }
```

Never store secrets in `appsettings.json` in source control.

### What is the difference between authentication and authorization in ASP.NET Core?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/aspnet/core/security/authorization/introduction -->
- **Authentication** establishes *who* the user is — e.g. validating a JWT bearer token or a cookie — and produces a `ClaimsPrincipal`.
- **Authorization** decides *what* they can do — roles, claims, or **policies**.

```csharp
builder.Services.AddAuthentication().AddJwtBearer();
builder.Services.AddAuthorization(o =>
    o.AddPolicy("Admins", p => p.RequireRole("admin")));

app.MapDelete("/users/{id}", DeleteUser).RequireAuthorization("Admins");
```

A 401 means not authenticated; a 403 means authenticated but not allowed.

### What is the difference between middleware and filters?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/aspnet/core/mvc/controllers/filters -->
- **Middleware** runs for every request in the pipeline and knows nothing about MVC — good for cross-cutting concerns like logging, CORS, compression, exception handling.
- **Filters** (MVC action/result/exception/authorization filters, or endpoint filters for Minimal APIs) run *inside* endpoint execution and can see the action, its arguments and the model state — good for validation, auditing per action, or shaping results.

Rule of thumb: if it needs to know about the action or its parameters, use a filter; otherwise use middleware.

### How do you avoid common Entity Framework Core performance problems?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/ef/core/performance/efficient-querying -->
- **N+1 queries**: loading related data inside a loop. Use `Include`, projection with `Select`, or split queries.
- **Tracking**: use `AsNoTracking()` for read-only queries to skip change tracking.
- **Over-fetching**: project to DTOs with `Select` instead of loading full entities.
- **Client evaluation**: keep filters on `IQueryable` so they run in SQL.
- **Pagination**: always `Skip/Take` (or keyset pagination) for large lists.
- Check generated SQL with logging and add the right indexes.

```csharp
var list = await db.Orders.AsNoTracking()
    .Where(o => o.CustomerId == id)
    .Select(o => new OrderDto(o.Id, o.Total, o.Items.Count))
    .ToListAsync();
```

### Why should you use `IHttpClientFactory` instead of `new HttpClient()` per request?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/dotnet/core/extensions/httpclient-factory -->
Creating and disposing an `HttpClient` per request can exhaust sockets (connections linger in `TIME_WAIT`). A single static `HttpClient` fixes that but can miss DNS changes.

`IHttpClientFactory` manages pooled handlers with sensible lifetimes, solving both problems. It also supports named/typed clients and resilience (retries, timeouts, circuit breakers) through `Microsoft.Extensions.Http.Resilience`.

```csharp
builder.Services.AddHttpClient<GitHubClient>(c => c.BaseAddress = new("https://api.github.com"))
    .AddStandardResilienceHandler();
```

### Your API is slow under load. How do you find and fix the bottleneck?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/aspnet/core/performance/performance-best-practices -->
1. **Measure first**: request durations and dependencies in Application Insights / OpenTelemetry; `dotnet-counters` for CPU, GC and thread-pool queue length; load test with a tool like k6 or JMeter.
2. **Typical causes and fixes**:
   - Blocking calls (`.Result`, sync I/O) → make I/O async end-to-end; check thread-pool starvation.
   - Slow database queries → inspect SQL, add indexes, `AsNoTracking`, projections, pagination.
   - Repeated work → cache with `IMemoryCache` / a distributed cache (Redis), or output caching.
   - Large payloads → response compression, smaller DTOs, paging.
   - Chatty external calls → batch, run independent calls concurrently, add timeouts and retries.
3. **Scale** once the code is efficient: more instances behind a load balancer; add rate limiting to protect the system.

### How do you run background work in ASP.NET Core?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/aspnet/core/fundamentals/host/hosted-services -->
- Implement `BackgroundService` (an `IHostedService`) for long-running loops — polling a queue, periodic cleanup.
- Hosted services are singletons: to use scoped services such as `DbContext`, create a scope with `IServiceScopeFactory` inside the loop.
- For in-process producer/consumer, use `System.Threading.Channels`.
- In-memory work is lost if the app restarts. For durable, reliable jobs use a real queue (Azure Service Bus, RabbitMQ) or a job library (Hangfire, Quartz.NET), and make handlers idempotent.

```csharp
public class Worker(IServiceScopeFactory scopes) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            // do work
            await Task.Delay(TimeSpan.FromMinutes(1), ct);
        }
    }
}
```

### How do you handle exceptions globally and return consistent error responses?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/aspnet/core/fundamentals/error-handling -->
- Register `AddProblemDetails()` and `UseExceptionHandler()` so unhandled exceptions become RFC 7807 **ProblemDetails** JSON responses.
- In .NET 8 and later, implement `IExceptionHandler` to map specific exception types to status codes (e.g. `NotFoundException` → 404).
- Log the exception with a correlation/trace id and return that id to the client — never the stack trace in production.
- Use exceptions for exceptional cases; for expected outcomes (validation errors, not found) return results directly.

### How do you add health checks and structured logging?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/aspnet/core/host-and-deploy/health-checks -->
Health checks expose an endpoint that load balancers and orchestrators (Kubernetes, Azure App Service) probe:

```csharp
builder.Services.AddHealthChecks().AddDbContextCheck<AppDb>();
app.MapHealthChecks("/health");
```

Use `ILogger<T>` with **message templates** so properties are captured as structured data:

```csharp
logger.LogInformation("Order {OrderId} placed by {UserId}", order.Id, user.Id);
```

Send logs, metrics and traces to a backend with OpenTelemetry or Application Insights.
