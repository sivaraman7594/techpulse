## 9. Background work and real-time communication

### Hosted services and BackgroundService
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services -->
A hosted service is a long-running component started and stopped by the generic host together with the app. Implement `IHostedService` (`StartAsync`/`StopAsync`) or, far more commonly, derive from `BackgroundService` and override `ExecuteAsync`, which runs for the lifetime of the app and receives a cancellation token that fires on shutdown.

Hosted services are registered as singletons, so they cannot inject scoped services such as a `DbContext` directly. Inject `IServiceScopeFactory` and create a scope per unit of work.

```csharp
public class Cleanup(IServiceScopeFactory sf, ILogger<Cleanup> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        while (await timer.WaitForNextTickAsync(ct))
        {
            using var scope = sf.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Sessions.Where(s => s.Expired).ExecuteDeleteAsync(ct);
        }
    }
}
builder.Services.AddHostedService<Cleanup>();
```

Pitfalls
- An unhandled exception stops the host by default (since .NET 6); catch and log inside the loop.
- Multiple app instances run the job multiple times; add a distributed lock or use a dedicated worker.
- Work is lost on restart, so it is not a durable queue.

Interview tip: know when to move to Hangfire, Quartz or a message broker.

### Channels for in-process queues
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/dotnet/core/extensions/channels -->
`System.Threading.Channels` provides an async producer/consumer queue. A request handler writes work items to a channel and returns immediately, while a `BackgroundService` reads and processes them. Bounded channels apply backpressure: when full, writers either wait, drop, or fail, depending on `BoundedChannelFullMode`.

```csharp
builder.Services.AddSingleton(Channel.CreateBounded<EmailJob>(
    new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.Wait }));

app.MapPost("/signup", async (Channel<EmailJob> ch, SignupDto d) =>
{
    await ch.Writer.WriteAsync(new EmailJob(d.Email));
    return Results.Accepted();
});
// in a BackgroundService
await foreach (var job in ch.Reader.ReadAllAsync(ct)) await Send(job);
```

Pitfalls
- Items live only in memory; a crash or deploy loses them. Use a durable broker for important work.
- An unbounded channel can grow without limit if consumers fall behind.
- Slow consumers need several reader tasks, which requires handling idempotency.

Interview tip: describe it as an in-process queue, and say when you would outgrow it.

### SignalR for real-time features
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/signalr/introduction -->
SignalR lets the server push messages to connected clients (chat, dashboards, notifications). It abstracts transports, negotiating WebSockets first and falling back to Server-Sent Events or long polling. You write a `Hub` class; clients call hub methods and the server calls client methods. Connections can be put into groups, and users can be targeted by identity.

To push from outside a hub (a controller or background service), inject `IHubContext<T>`.

```csharp
public class ChatHub : Hub
{
    public Task Send(string room, string msg) =>
        Clients.Group(room).SendAsync("message", Context.User?.Identity?.Name, msg);
    public Task Join(string room) => Groups.AddToGroupAsync(Context.ConnectionId, room);
}
app.MapHub<ChatHub>("/chat");
```

Scaling out needs a backplane (Redis, or Azure SignalR Service), because a client connected to node A must receive messages sent through node B. Without WebSockets or with a load balancer, sticky sessions are needed for non-WebSocket transports.

Pitfalls
- Hubs are transient; never keep state in hub fields.
- Authentication for WebSockets often passes the token in the query string, which can appear in logs.

Interview tip: explain backplane and sticky sessions when asked about scaling.

### gRPC services
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/grpc/ -->
gRPC is a contract-first RPC framework using HTTP/2 and Protocol Buffers. You define services and messages in a `.proto` file, and tooling generates strongly typed server base classes and clients. Binary encoding and multiplexed streams make it faster and smaller than JSON over HTTP/1.1, and it supports unary calls plus server, client and bidirectional streaming. It fits service-to-service traffic inside a platform.

```proto
service Greeter { rpc SayHello (HelloRequest) returns (HelloReply); }
message HelloRequest { string name = 1; }
message HelloReply   { string message = 1; }
```

```csharp
builder.Services.AddGrpc();
public class GreeterService : Greeter.GreeterBase
{
    public override Task<HelloReply> SayHello(HelloRequest r, ServerCallContext c)
        => Task.FromResult(new HelloReply { Message = $"Hi {r.Name}" });
}
app.MapGrpcService<GreeterService>();
```

Pitfalls
- Browsers cannot call native gRPC; use gRPC-Web or a JSON transcoding layer.
- Never reuse or renumber proto field numbers, which breaks compatibility.
- Load balancers must support HTTP/2, and long-lived connections pin to one backend.

Interview tip: compare gRPC with REST on contracts, performance and browser support.

## 10. Blazor and testing

### Blazor components and render modes
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/blazor/components/render-modes -->
Blazor builds UI from C# components (`.razor` files) instead of JavaScript. A component mixes markup and code, takes parameters, and re-renders when state changes. Version note: since .NET 8 a single app can mix render modes per component or page. Static SSR renders HTML on the server with no interactivity; Interactive Server keeps a SignalR circuit and runs events on the server; Interactive WebAssembly downloads the .NET runtime and runs in the browser; Interactive Auto starts on the server and switches to WebAssembly once it has downloaded.

```razor
@page "/counter"
@rendermode InteractiveServer
<button @onclick="() => count++">Clicked @count</button>
@code { private int count; }
```

Trade-offs: Server mode starts fast and keeps code private but needs a constant connection and server memory per user; WebAssembly works offline-ish and scales cheaply but has a larger initial download and exposes code to users.

Pitfalls
- Secrets must never reach a WebAssembly component.
- Interactive Server components lose state when the circuit drops.

Interview tip: match the render mode to latency, scale and offline needs.

### Integration testing with WebApplicationFactory
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests -->
Integration tests exercise the real pipeline: routing, middleware, model binding, serialization, DI. `WebApplicationFactory<TEntryPoint>` boots your app in memory using a test server and gives you an `HttpClient`, so there are no ports and tests are fast. You override services in `ConfigureWebHost`, for instance replacing a payment gateway with a fake or pointing EF Core at a test database.

```csharp
public class OrdersTests(WebApplicationFactory<Program> f)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Get_unknown_returns_404()
    {
        var c = f.WithWebHostBuilder(b => b.ConfigureServices(s =>
            s.AddSingleton<IPayments, FakePayments>())).CreateClient();
        var r = await c.GetAsync("/orders/999");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }
}
```

Minimal API projects need `public partial class Program { }` so the type is visible to the test project.

Pitfalls
- The in-memory EF provider ignores relational behaviour; prefer SQLite or Testcontainers with the real engine.
- Shared database state between tests makes them order-dependent; reset per test.

Interview tip: say what you fake (external boundaries) and what you keep real.

### Unit testing and test design
<!-- level: basic; ref: https://learn.microsoft.com/en-us/dotnet/core/testing/ -->
Unit tests verify one piece of logic in isolation and run in milliseconds. ASP.NET Core's DI-friendly design makes this easy: depend on interfaces, inject fakes through constructors, and keep business rules in plain classes rather than in controllers. Controllers can still be tested directly because actions are ordinary methods returning `IActionResult`, though thin controllers need little testing.

Use xUnit, NUnit or MSTest with a mocking library (Moq, NSubstitute) or hand-written fakes. The arrange-act-assert shape keeps tests readable.

```csharp
[Fact]
public async Task Discount_applies_to_gold_customers()
{
    var repo = Substitute.For<ICustomerRepo>();
    repo.GetAsync(1).Returns(new Customer { Tier = "Gold" });
    var svc = new PricingService(repo);
    Assert.Equal(90m, await svc.PriceAsync(1, 100m));
}
```

Pitfalls
- Mocking everything couples tests to implementation; assert on outcomes.
- Mocking `DbContext` queries is brittle; test data access with a real database.
- Tests that depend on `DateTime.Now` are flaky; inject `TimeProvider` (.NET 8+).

Interview tip: describe the pyramid, with many unit tests, fewer integration tests, and a few end-to-end tests.

## 11. Deployment and observability

### Containerising an ASP.NET Core app
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/docker/ -->
Containers give identical runtime environments from laptop to production. A good Dockerfile is multi-stage: build with the SDK image, publish, then copy the output into the much smaller ASP.NET runtime image. Microsoft images listen on port 8080 as a non-root user since .NET 8, so do not expect port 80.

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY *.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "MyApi.dll"]
```

Copying the csproj and restoring first lets Docker cache the package layer. Configuration comes from environment variables (`ConnectionStrings__Default`), and logs go to stdout.

Pitfalls
- Baking secrets or `appsettings.Production.json` credentials into the image.
- Forgetting a shared Data Protection key ring across replicas.
- Using the SDK image in production, which enlarges the attack surface.

Interview tip: explain the layer-caching reason for copying the csproj first.

### Reverse proxies and forwarded headers
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer -->
Kestrel is a capable web server, but it is typically run behind a reverse proxy or load balancer (nginx, YARP, IIS, an Azure or AWS gateway) that terminates TLS, balances load and filters traffic. The proxy talks plain HTTP to the app, so the app sees the proxy's IP and the `http` scheme unless it reads the `X-Forwarded-For` and `X-Forwarded-Proto` headers.

The Forwarded Headers middleware restores the original client IP and scheme, which matters for redirects, absolute URLs, OAuth callbacks and rate limiting.

```csharp
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownNetworks.Clear(); o.KnownProxies.Add(IPAddress.Parse("10.0.0.5"));
});
app.UseForwardedHeaders(); // first in the pipeline
```

Pitfalls
- Trusting forwarded headers from any source lets clients spoof their IP.
- Missing proto forwarding causes infinite HTTPS redirect loops or OAuth redirect_uri mismatches.

Interview tip: tie "redirect loop behind a load balancer" to this middleware.

### Health checks
<!-- level: basic; ref: https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks -->
Health checks expose endpoints that orchestrators and load balancers poll to decide whether to route traffic or restart an instance. Register checks (database, cache, disk, custom) and map endpoints. Separate liveness ("the process is alive, restart me if not") from readiness ("I can serve traffic now"). A failing dependency should usually fail readiness but not liveness, otherwise a database outage causes every pod to restart in a loop.

```csharp
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddDbContextCheck<AppDb>(tags: ["ready"]);
app.MapHealthChecks("/health/live", new() { Predicate = r => r.Tags.Contains("live") });
app.MapHealthChecks("/health/ready", new() { Predicate = r => r.Tags.Contains("ready") });
```

Pitfalls
- Expensive checks on every poll create their own load.
- Exposing detailed results publicly leaks internals.

Interview tip: give the liveness versus readiness distinction with a concrete failure.

### Observability with logging, metrics and OpenTelemetry
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/dotnet/core/diagnostics/observability-with-otel -->
Observability means answering new questions about production from its outputs: logs, metrics and traces. .NET exposes them natively: `ILogger` for structured logs, `System.Diagnostics.Metrics` for counters and histograms, and `ActivitySource` for distributed traces. OpenTelemetry packages collect these and export them through OTLP to a backend (Grafana, Jaeger, Azure Monitor, Datadog).

Trace context travels over HTTP using W3C `traceparent` headers, so one request can be followed across services. Use structured logging with message templates, not string interpolation, so properties remain searchable.

```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddOtlpExporter())
    .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddRuntimeInstrumentation().AddOtlpExporter());
log.LogInformation("Order {OrderId} paid in {Ms} ms", id, ms);
```

Pitfalls
- High-cardinality metric labels (user id) explode storage.
- Logging full request bodies leaks personal data.
- 100 percent trace sampling can be costly at scale.

Interview tip: correlate logs with trace ids so one id leads from alert to root cause.
