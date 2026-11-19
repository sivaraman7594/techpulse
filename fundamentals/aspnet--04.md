## 7. Authentication, authorization and security

### Authentication schemes and handlers
<!-- level: basic; ref: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/ -->
Authentication answers "who is calling?". In ASP.NET Core it is built from named schemes, each pairing a handler (cookie, JWT bearer, OpenID Connect, and so on) with options. The authentication middleware picks the default scheme, asks its handler to build a `ClaimsPrincipal`, and assigns it to `HttpContext.User`. Authorization later reads that principal, so the order `UseAuthentication()` then `UseAuthorization()` is mandatory.

You can register several schemes, for example cookies for a browser UI and JWT bearer for an API, and select one per endpoint with `[Authorize(AuthenticationSchemes = "Bearer")]`. A scheme also defines challenge (what to do when anonymous access is denied, such as a 302 redirect or a 401) and forbid behaviour.

```csharp
builder.Services.AddAuthentication("Cookies")
    .AddCookie("Cookies")
    .AddJwtBearer("Bearer", o => o.Authority = "https://login.example.com");
app.UseAuthentication();
app.UseAuthorization();
```

Pitfalls
- Placing `UseAuthorization` before `UseAuthentication` makes every user look anonymous.
- A cookie default scheme on an API returns a login redirect instead of a 401.

Interview tip: say that authentication creates the identity and authorization decides what it may do.

### JWT bearer authentication
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/ -->
A JSON Web Token is a signed, base64url-encoded set of claims. The client sends it in the `Authorization: Bearer` header, and the JWT bearer handler validates signature, issuer, audience and lifetime without any server-side session. This suits stateless APIs and microservices, where an identity provider (Entra ID, Auth0, Keycloak) issues tokens and the API only validates them.

Validation is driven by `TokenValidationParameters`. With an `Authority`, the handler downloads the provider's signing keys from its discovery document and rotates them automatically.

```csharp
.AddJwtBearer(o =>
{
    o.Authority = "https://login.example.com";
    o.Audience = "orders-api";
    o.TokenValidationParameters.ClockSkew = TimeSpan.FromSeconds(30);
})
```

Pitfalls
- Disabling audience or issuer validation to "make it work" lets tokens meant for other apps in.
- JWTs cannot be revoked before expiry; keep lifetimes short and use refresh tokens.
- The payload is only encoded, not encrypted, so never put secrets in claims.

Interview tip: be ready to explain why a symmetric key shared among many services is weaker than asymmetric validation via an authority.

### Cookie authentication
<!-- level: basic; ref: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/cookie -->
Cookie authentication stores an encrypted, signed ticket containing the user's claims in a browser cookie. On each request the handler decrypts it, rebuilds the principal and optionally slides the expiration. It is the natural choice for server-rendered apps and Blazor Server, where the browser handles cookies automatically.

The ticket is protected using the Data Protection system, so every instance of a scaled-out app must share the same key ring or users will be logged out when a request lands on another node.

```csharp
builder.Services.AddAuthentication("Cookies").AddCookie("Cookies", o =>
{
    o.LoginPath = "/login";
    o.Cookie.HttpOnly = true;
    o.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    o.SlidingExpiration = true;
});
// sign in
await ctx.SignInAsync(new ClaimsPrincipal(identity));
```

Pitfalls
- Cookie-based auth is vulnerable to CSRF, so combine it with antiforgery tokens and SameSite settings.
- Large claim sets make cookies exceed header limits.

Interview tip: contrast cookies (stateful browser sessions) with bearer tokens (explicitly sent, immune to CSRF).

### Policy-based authorization
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies -->
Roles are coarse. A policy is a named set of requirements that the current user must satisfy, evaluated by the authorization service. Requirements can be simple (`RequireClaim`, `RequireRole`) or custom classes paired with an `AuthorizationHandler<T>` that holds arbitrary logic such as "must be over 18" or "must belong to the same tenant".

Policies keep rules out of controllers: endpoints declare which policy they need, and the rule lives in one place and is testable.

```csharp
builder.Services.AddAuthorization(o =>
    o.AddPolicy("CanRefund", p => p.RequireClaim("scope", "refunds.write")
                                   .RequireAuthenticatedUser()));
app.MapPost("/refunds", Refund).RequireAuthorization("CanRefund");
```

Since .NET 7 you can also set a `FallbackPolicy`, which applies to any endpoint with no authorization metadata, giving a secure-by-default site where `[AllowAnonymous]` is an explicit opt-out.

Pitfalls
- A handler that never calls `context.Succeed` simply fails silently, which is easy to misdiagnose as a missing claim.
- Multiple handlers for one requirement are OR-ed; use separate requirements for AND.

Interview tip: mention fallback policy as a safeguard against forgotten attributes.

### Resource-based authorization
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/aspnet/core/security/authorization/resourcebased -->
Some decisions depend on the data being accessed, for example "only the author may edit this document". An attribute cannot know the document yet, because it is loaded inside the action. Resource-based authorization solves this by calling `IAuthorizationService.AuthorizeAsync(user, resource, requirement)` imperatively after loading the resource.

The handler derives from `AuthorizationHandler<TRequirement, TResource>` and receives both the user and the object, so it can compare an owner id to a claim.

```csharp
app.MapPut("/docs/{id}", async (int id, ClaimsPrincipal user,
    IAuthorizationService auth, Db db) =>
{
    var doc = await db.Docs.FindAsync(id);
    if (doc is null) return Results.NotFound();
    var r = await auth.AuthorizeAsync(user, doc, "EditDoc");
    return r.Succeeded ? Results.Ok() : Results.Forbid();
});
```

Pitfalls
- Returning 403 for resources the user should not even know exist leaks existence; sometimes 404 is correct.
- Forgetting the check on one of many endpoints creates an insecure direct object reference (IDOR).

Interview tip: name IDOR as the vulnerability this pattern prevents.

### ASP.NET Core Identity
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity -->
ASP.NET Core Identity is a membership system providing users, roles, claims, password hashing, lockout, email confirmation, two-factor authentication and external logins, stored through EF Core by default. It supplies `UserManager<TUser>` and `SignInManager<TUser>` for working with accounts and issues the application cookie.

Passwords are hashed with PBKDF2 and a per-user salt by default, and the hash format is versioned so it can be upgraded transparently on login. From .NET 8, `MapIdentityApi<TUser>()` exposes ready-made JSON endpoints for register, login and refresh, useful for SPAs and mobile clients.

```csharp
builder.Services.AddDbContext<AppDb>(...);
builder.Services.AddIdentityCore<AppUser>()
    .AddEntityFrameworkStores<AppDb>();
builder.Services.AddAuthentication().AddBearerToken();
app.MapIdentityApi<AppUser>();
```

Pitfalls
- Identity stores credentials in your database, so you own breach responses; consider a hosted identity provider for larger systems.
- Customising the user table needs a migration; plan keys (string vs int) early.

Interview tip: know when to pick Identity versus delegating to OpenID Connect.

### Cross-origin requests (CORS)
<!-- level: basic; ref: https://learn.microsoft.com/en-us/aspnet/core/security/cors -->
Browsers block scripts from reading responses from a different origin (scheme, host, port) unless the server opts in with CORS headers. CORS protects users, not your server: it does not stop curl or another backend from calling your API. For non-simple requests the browser first sends an `OPTIONS` preflight, and the CORS middleware answers it.

Define named policies and apply them globally or per endpoint. `UseCors` must run after routing and before authorization so preflights are not rejected with 401.

```csharp
builder.Services.AddCors(o => o.AddPolicy("spa", p => p
    .WithOrigins("https://app.example.com")
    .WithMethods("GET", "POST")
    .AllowAnyHeader()));
app.UseRouting();
app.UseCors("spa");
app.UseAuthorization();
```

Pitfalls
- `AllowAnyOrigin` combined with credentials is rejected by browsers and unsafe anyway.
- A 500 from the app skips CORS headers, so the browser shows a misleading CORS error.

Interview tip: say clearly that CORS is a browser rule, not authentication.

### Data Protection API and secrets
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/introduction -->
The Data Protection system encrypts short-lived payloads such as auth cookies, antiforgery tokens and temp data. Keys live in a key ring that rotates every 90 days by default. By default keys are stored under the user profile, which is fine on one machine but wrong in containers or farms, where each instance would hold different keys.

For multi-instance deployments persist the key ring to shared storage (Redis, blob storage, a database) and protect it with a certificate or cloud key service. Use the same application name so instances can read each other's payloads.

```csharp
builder.Services.AddDataProtection()
    .SetApplicationName("shop")
    .PersistKeysToStackExchangeRedis(redis, "dp-keys");
```

Related: never commit secrets. Use user-secrets locally and a vault or environment variables in production.

Pitfalls
- Ephemeral keys in containers cause "invalid antiforgery token" errors and logouts after each restart.
- Data Protection is not meant for long-term data encryption at rest.

Interview tip: link the symptom (random logouts behind a load balancer) to the shared key ring.

### Antiforgery and common web attacks
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery -->
Cross-site request forgery tricks a logged-in browser into sending a state-changing request because cookies attach automatically. Antiforgery defends with a token that a malicious site cannot read: a cookie token plus a request token embedded in a form or header, validated server-side. Razor forms emit it automatically, and MVC can enforce it globally with `AutoValidateAntiforgeryToken`. Minimal APIs get antiforgery middleware from .NET 8 (`app.UseAntiforgery()`).

APIs that use bearer tokens in headers are not CSRF-prone because browsers do not attach those automatically. Other defences to know: encoded output (Razor encodes by default) against XSS, parameterised queries against SQL injection, HSTS and HTTPS redirection, and a Content-Security-Policy header.

```csharp
app.UseAntiforgery();
app.MapPost("/transfer", ([FromForm] TransferDto dto) => Results.Ok())
   .RequireAuthorization();
```

Pitfalls
- `Html.Raw` on user input defeats Razor's XSS protection.
- SameSite=Lax cookies help but are not a full replacement.

Interview tip: explain why CSRF only matters when credentials are sent automatically.

### Rate limiting middleware
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit -->
Built in since .NET 7, `Microsoft.AspNetCore.RateLimiting` protects an app from abuse and overload. It offers four algorithms: fixed window, sliding window, token bucket and concurrency limiter. A limiter is partitioned by a key such as client IP, user id or API key, so one noisy tenant cannot starve others.

Rejected requests get 503 by default; set `RejectionStatusCode = 429` and add a `Retry-After` header for well-behaved clients.

```csharp
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddFixedWindowLimiter("api", l =>
    { l.PermitLimit = 100; l.Window = TimeSpan.FromMinutes(1); });
});
app.UseRateLimiter();
app.MapGet("/data", Get).RequireRateLimiting("api");
```

Pitfalls
- State is in-process, so with N instances the effective limit is N times higher; use a gateway or shared store for global limits.
- Partitioning by IP behind a proxy sees only the proxy unless forwarded headers are configured.

Interview tip: pair rate limiting with client-side retry and backoff in your answer.

## 8. Caching and performance

### In-memory caching with IMemoryCache
<!-- level: basic; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/caching/memory -->
`IMemoryCache` stores objects in the process's memory, giving nanosecond reads with no serialization. It is ideal for small, hot, read-mostly data like lookup tables or computed settings. Entries expire by absolute time, sliding time, or size-based eviction when you set a `SizeLimit`.

Because it is per-instance, every node holds its own copy and invalidation does not propagate, so the data must tolerate being briefly stale or different between servers.

```csharp
var rates = await cache.GetOrCreateAsync("fx", async e =>
{
    e.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
    return await api.LoadRatesAsync();
});
```

Pitfalls
- `GetOrCreateAsync` does not lock: concurrent misses all run the factory (a cache stampede). Guard with a `SemaphoreSlim` or use HybridCache.
- Without limits, unbounded keys (for example per-user entries) cause memory growth.
- Caching mutable objects lets callers corrupt shared state.

Interview tip: mention stampede protection and the stale-data trade-off.

### Distributed caching with Redis
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/caching/distributed -->
`IDistributedCache` gives all instances a shared cache through a common abstraction with providers for Redis, SQL Server and others. Values are byte arrays, so you serialize (typically JSON). It survives app restarts and keeps scaled-out nodes consistent, at the cost of a network hop per access.

Redis is the usual choice thanks to speed, native expiry and rich data structures when used directly through StackExchange.Redis.

```csharp
builder.Services.AddStackExchangeRedisCache(o =>
    o.Configuration = builder.Configuration["Redis"]);

var bytes = await dist.GetAsync(key);
if (bytes is null)
{
    var data = await LoadAsync();
    await dist.SetStringAsync(key, JsonSerializer.Serialize(data),
        new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10) });
}
```

Pitfalls
- Treat the cache as optional: if Redis is down the app should fall back to the source, not crash.
- Caching without a TTL turns stale data into a permanent bug.
- Large values slow Redis for everyone.

Interview tip: discuss cache-aside, TTLs and explicit invalidation on writes.

### HybridCache
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/caching/hybrid -->
`HybridCache` (introduced with .NET 9 in the `Microsoft.Extensions.Caching.Hybrid` package) combines a fast in-process L1 cache with an optional distributed L2 behind one API. It adds what hand-written code often lacks: stampede protection (concurrent callers for the same key share one factory call), configurable serialization, and tag-based invalidation.

You call `GetOrCreateAsync` with a key and a factory, and the library handles lookup order and population.

```csharp
builder.Services.AddHybridCache();

var product = await hybrid.GetOrCreateAsync(
    $"product:{id}",
    async ct => await db.Products.FindAsync([id], ct),
    new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(5) },
    tags: ["products"]);
await hybrid.RemoveByTagAsync("products");
```

Pitfalls
- L1 copies on other nodes are not invalidated immediately; keep L1 lifetimes short.
- Cached types need to be serializable and should be treated as immutable.
- Version-specific: unavailable before .NET 9 (a package for .NET 8 exists in preview and later releases).

Interview tip: contrast it with `IMemoryCache` plus `IDistributedCache` hand-rolled layering.

### Output caching and response caching
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/caching/output -->
Output caching (.NET 7+) stores the generated HTTP response on the server and replays it for matching requests, skipping the whole endpoint. You control it with policies: vary by query, header or route, set a duration, tag entries, and evict by tag after writes. Unlike response caching, the server decides, and it ignores client `Cache-Control: no-cache` headers.

Response caching middleware is the older mechanism that honours standard HTTP cache headers for clients and proxies; it is rarely the best choice for APIs.

```csharp
builder.Services.AddOutputCache(o =>
    o.AddPolicy("short", b => b.Expire(TimeSpan.FromSeconds(30)).Tag("catalog")));
app.UseOutputCache();
app.MapGet("/catalog", GetCatalog).CacheOutput("short");
// after update
await store.EvictByTagAsync("catalog", default);
```

Pitfalls
- Responses containing user-specific data must not be cached without varying by user; by default requests with `Authorization` or cookies are not cached.
- In-memory storage is per instance; use Redis store for farms.

Interview tip: distinguish server-side output cache from browser/CDN caching headers.

### Response compression and HTTP efficiency
<!-- level: basic; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/response-compression -->
Compressing text responses (JSON, HTML, JS) with Brotli or Gzip cuts bandwidth sharply and speeds up slow links. ASP.NET Core ships `UseResponseCompression`, with providers for both algorithms. In practice, a reverse proxy, CDN or the web server often does this cheaper, in which case the app should not compress again.

Compression costs CPU, so keep levels moderate for dynamic content. Compressing already-compressed formats (images, zip, video) gains nothing.

```csharp
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = false; // default; see pitfall
    o.Providers.Add<BrotliCompressionProvider>();
});
app.UseResponseCompression();
```

Pitfalls
- Enabling compression over HTTPS where responses mix secrets and attacker-controlled input exposes BREACH-style attacks; the default is off for that reason.
- Double compression at app and proxy wastes CPU.

Interview tip: also mention pagination, field selection and HTTP/2 or HTTP/3 as bigger wins than compression alone.

### Async/await and thread pool health
<!-- level: intermediate; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/performance-best-practices -->
A request occupies a thread-pool thread only while code is running on the CPU. With `async` I/O the thread returns to the pool during the wait, so a small pool serves thousands of concurrent requests. Blocking calls (`.Result`, `.Wait()`, `Thread.Sleep`, sync file or DB APIs) hold a thread while waiting, and under load the pool starves, latency spikes and requests queue.

ASP.NET Core has no synchronization context, so blocking rarely deadlocks as in old ASP.NET, but it still destroys throughput.

```csharp
// bad
var user = repo.GetUserAsync(id).Result;
// good
var user = await repo.GetUserAsync(id, ct);
```

Pass `HttpContext.RequestAborted` (or a `CancellationToken` parameter bound by the framework) down to I/O so abandoned requests stop work.

Pitfalls
- `Task.Run` around synchronous code in a controller just moves the blocking to another pool thread.
- `async void` swallows exceptions and can crash the process.
- Fire-and-forget tasks that touch scoped services run after the scope is disposed.

Interview tip: diagnose thread-pool starvation using `dotnet-counters` (queue length, thread count).

### Profiling and diagnosing performance
<!-- level: advanced; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/performance-best-practices -->
Performance work starts with measurement. Collect request duration percentiles (p95, p99), not just averages, then locate the bottleneck: CPU, memory and GC, thread pool, database or downstream calls. The .NET CLI diagnostics tools work on live processes without code changes: `dotnet-counters` for runtime metrics, `dotnet-trace` for CPU sampling, `dotnet-dump` for hangs and memory.

Frequent culprits are N+1 queries, sync-over-async, large allocations that trigger gen-2 GCs, serializing huge payloads, and unbounded queries. Use BenchmarkDotNet to compare micro-optimisations, and avoid optimising code that the trace does not show as hot.

```bash
dotnet-counters monitor -n MyApi System.Runtime Microsoft.AspNetCore.Hosting
dotnet-trace collect -p <pid> --duration 00:00:30
```

Pitfalls
- Benchmarking in Debug configuration or with a warm database cache misleads.
- Tuning GC settings before fixing allocations treats the symptom.

Interview tip: describe a method (measure, hypothesise, change one thing, re-measure), not a list of tricks.
