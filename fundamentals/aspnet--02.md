## 3. Middleware and routing
### The middleware pipeline: Use, Run and Map
<!-- level: basic; ref: https://learn.microsoft.com/aspnet/core/fundamentals/middleware/ -->
Middleware components form the request pipeline. Each receives the `HttpContext` and a `next` delegate. It can do work before calling `next`, after it returns, or decide not to call it at all (short-circuit) and write the response itself. The result is like nested function calls: the first middleware added is the outermost layer.

Three building blocks:
- `app.Use(...)`: adds middleware that normally calls `next`.
- `app.Run(...)`: adds terminal middleware that never calls `next`.
- `app.Map(...)` / `app.MapWhen(...)`: branch the pipeline based on path or a condition. (Not to be confused with endpoint mapping like `MapGet`.)

```csharp
app.Use(async (context, next) =>
{
    var sw = Stopwatch.StartNew();
    context.Response.OnStarting(() =>
    {
        context.Response.Headers["X-Elapsed-Ms"] = sw.ElapsedMilliseconds.ToString();
        return Task.CompletedTask;
    });
    await next(context);                       // rest of the pipeline
});

app.MapWhen(ctx => ctx.Request.Path.StartsWithSegments("/legacy"), branch =>
{
    branch.Run(ctx => ctx.Response.WriteAsync("Legacy endpoint retired"));
});
```

A recommended order for common built-in middleware:
1. Exception handler / developer exception page
2. HSTS and HTTPS redirection
3. Static files
4. Routing (implicit in minimal hosting, but explicit `UseRouting` controls its position)
5. CORS
6. Authentication, then Authorization
7. Rate limiting, output caching, custom middleware that needs the endpoint or user
8. Endpoints

The order is a security decision: middleware placed before authentication runs for anonymous users, and an exception handler only catches exceptions from middleware after it.

- Pitfall: modifying headers after the response has started (after the body began streaming) throws; use `Response.OnStarting` or set headers before calling `next`.
- Interview tip: know that `WebApplication` adds routing and endpoint middleware automatically, and that calling `UseRouting` explicitly moves routing to that position.

### Writing custom middleware
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/fundamentals/middleware/write -->
For anything beyond a few lines, write middleware as a class. There are two styles.

Convention-based middleware: a class with a constructor taking `RequestDelegate next` and an `InvokeAsync(HttpContext)` method. It is created once (effectively a singleton), so scoped services must be injected as `InvokeAsync` parameters, not in the constructor.

Factory-based middleware: implement `IMiddleware` and register the class in DI with any lifetime. It is resolved per request, so constructor injection of scoped services works.

```csharp
public sealed class CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> log)
{
    private const string Header = "X-Correlation-Id";

    public async Task InvokeAsync(HttpContext ctx, ITenantContext tenant)   // scoped per request
    {
        var id = ctx.Request.Headers.TryGetValue(Header, out var v) && !string.IsNullOrWhiteSpace(v)
            ? v.ToString()
            : Activity.Current?.TraceId.ToString() ?? Guid.NewGuid().ToString("N");

        ctx.Response.Headers[Header] = id;
        using (log.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = id, ["Tenant"] = tenant.Id }))
        {
            await next(ctx);
        }
    }
}

public static class CorrelationIdExtensions
{
    public static IApplicationBuilder UseCorrelationId(this IApplicationBuilder app)
        => app.UseMiddleware<CorrelationIdMiddleware>();
}

// IMiddleware style
public sealed class AuditMiddleware(AuditDb db) : IMiddleware
{
    public async Task InvokeAsync(HttpContext ctx, RequestDelegate next)
    {
        await next(ctx);
        if (HttpMethods.IsDelete(ctx.Request.Method))
            db.Add(new AuditEntry(ctx.User.Identity?.Name, ctx.Request.Path));
    }
}
builder.Services.AddScoped<AuditMiddleware>();
app.UseMiddleware<AuditMiddleware>();
```

Use middleware for cross-cutting HTTP concerns: correlation ids, security headers, request logging, tenant resolution. If logic needs to know about a specific endpoint's arguments, use an endpoint filter or MVC filter instead.

- Pitfall: injecting a scoped service into a convention-based middleware constructor makes it a captive dependency.
- Pitfall: reading the request body in middleware consumes it; call `ctx.Request.EnableBuffering()` and rewind if later components need it.
- Interview tip: `ctx.GetEndpoint()` lets middleware placed after routing read endpoint metadata (attributes), which is how authorization works.

### Endpoint routing, templates and constraints
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/fundamentals/routing -->
Endpoint routing matches incoming URLs and HTTP methods to endpoints. All endpoint types (minimal APIs, controllers, Razor Pages, hubs, gRPC) share one routing system, so features like authorization, CORS and rate limiting can attach to any endpoint via metadata.

Route templates describe URL patterns:
- Literal segments: `/api/orders`
- Parameters: `{id}`; optional `{page?}`; default values `{page=1}`
- Catch-all: `{**path}` captures the rest of the URL, including slashes.
- Constraints restrict matches: `{id:int}`, `{slug:regex(^[a-z0-9-]+$)}`, `{code:length(3)}`, `{date:datetime}`, `{id:guid}`.

Routing picks the most specific match; ambiguous routes throw `AmbiguousMatchException` at request time.

```csharp
app.MapGet("/products/{id:int:min(1)}", (int id) => $"product {id}");
app.MapGet("/products/{slug:regex(^[a-z0-9-]+$)}", (string slug) => $"slug {slug}");
app.MapGet("/docs/{**path}", (string path) => $"doc {path}");

// Generating links instead of hard-coding them
app.MapGet("/orders/{id:int}", (int id) => Results.Ok())
   .WithName("GetOrder");

app.MapPost("/orders", (LinkGenerator links, HttpContext ctx) =>
{
    var url = links.GetUriByName(ctx, "GetOrder", new { id = 42 });
    return Results.Created(url, null);
});
```

Route constraints are for disambiguation, not validation. If `{id:int}` does not match, the client receives 404 instead of a helpful 400. Validate input in the handler (or with validation filters) and return a proper error.

Controllers use attribute routing: `[Route("api/[controller]")]` on the class and `[HttpGet("{id:int}")]` on actions, with tokens like `[controller]` and `[action]`.

- Pitfall: regex constraints applied to every request add cost and potential ReDoS risk; keep them simple.
- Pitfall: route order does not matter for matching (specificity decides), which surprises developers used to first-match routers.
- Interview tip: `LinkGenerator` builds URLs from route names so links stay correct when templates change.

### Static files and MapStaticAssets
<!-- level: basic; ref: https://learn.microsoft.com/aspnet/core/fundamentals/static-files -->
Static files (CSS, JavaScript, images, fonts) live in the `wwwroot` folder by default. They do not go through MVC or minimal APIs; dedicated middleware serves them efficiently with correct content types, ranges and conditional requests.

Two approaches:
- `app.UseStaticFiles()`: the long-standing middleware. Serves files from disk at request time.
- `app.MapStaticAssets()` (.NET 9): build-time-aware endpoint routing for static assets. At build and publish, it fingerprints files, precompresses them with gzip and Brotli, and generates strong ETags. At run time it serves the compressed versions with long-lived cache headers and content-based URLs, so browsers cache aggressively but always get new versions after deploys.

```csharp
var app = builder.Build();

app.UseHttpsRedirection();
app.MapStaticAssets();          // .NET 9+: optimized delivery for wwwroot and libraries
// app.UseStaticFiles();        // still useful for files added at run time (uploads)

app.MapRazorPages().WithStaticAssets();
```

```html
<!-- Razor: ~ paths are rewritten to fingerprinted URLs -->
<link rel="stylesheet" href="~/css/site.css" asp-append-version="true" />
```

Serving user uploads or other non-build files still needs `UseStaticFiles` with a `PhysicalFileProvider`, and careful configuration:

```csharp
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider("/data/public-images"),
    RequestPath = "/images",
    OnPrepareResponse = ctx =>
        ctx.Context.Response.Headers.CacheControl = "public,max-age=86400",
});
```

Static file middleware does not perform authorization by default; anything in `wwwroot` is public.

- Pitfall: putting private files (exports, backups, config) in `wwwroot` makes them downloadable by anyone.
- Pitfall: serving uploaded HTML or SVG from your main domain can enable stored XSS; serve uploads from a separate domain or with `Content-Disposition: attachment`.
- Interview tip: for high-traffic sites, put a CDN in front of static assets; fingerprinted URLs make CDN caching safe.

### Short-circuiting and request features
<!-- level: advanced; ref: https://learn.microsoft.com/aspnet/core/fundamentals/routing#short-circuit-middleware-after-routing -->
Not every request should travel the whole pipeline. Health probes, `robots.txt`, favicon requests or known bot paths can be answered cheaply, skipping authentication, logging and other work.

Options:
- Middleware that writes a response without calling `next`.
- .NET 8 endpoint short-circuiting: `.ShortCircuit()` on an endpoint makes routing execute it immediately, skipping the remaining middleware (authentication, authorization, CORS) between routing and endpoints.
- `MapShortCircuit(404, "wp-admin", "phpmyadmin")` quickly returns a status for paths you never serve, cutting noise from scanners.

```csharp
app.MapGet("/robots.txt", () => "User-agent: *\nDisallow: /api/")
   .ShortCircuit();

app.MapShortCircuit(404, "wp-admin", "wp-login.php", ".env");

app.MapHealthChecks("/healthz/live").ShortCircuit();
```

Under the hood, ASP.NET Core exposes low-level capabilities as features on `HttpContext.Features`: `IHttpRequestBodyDetectionFeature`, `IHttpMaxRequestBodySizeFeature`, `IHttpResponseBodyFeature`, `ITlsConnectionFeature` and others. Servers (Kestrel, IIS, test server) implement them, and middleware can query or replace them.

```csharp
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/upload"))
    {
        var sizeFeature = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (sizeFeature is { IsReadOnly: false })
            sizeFeature.MaxRequestBodySize = 200 * 1024 * 1024;   // per-request override
    }
    await next(ctx);
});
```

- Pitfall: short-circuited endpoints skip authorization; never short-circuit anything that returns private data.
- Pitfall: a short-circuited endpoint also skips middleware such as request logging, so those requests vanish from logs; decide whether that is acceptable.
- Interview tip: knowing request features shows you understand that ASP.NET Core is server-agnostic and composable at a low level.

## 4. Minimal APIs
### Minimal API endpoints and parameter binding
<!-- level: basic; ref: https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis/parameter-binding -->
Minimal APIs map HTTP methods and routes directly to handlers: `MapGet`, `MapPost`, `MapPut`, `MapPatch`, `MapDelete`, and `MapMethods` for others. A handler can be a lambda, a local function, or a static or instance method.

Parameter binding infers where each handler parameter comes from:
- Route values when the name matches a route parameter (`{id}`).
- Query string for simple types not in the route.
- Headers with `[FromHeader]`.
- The body (JSON) for complex types on POST, PUT and PATCH.
- Services from DI for registered types (or explicitly `[FromServices]`).
- Special types: `HttpContext`, `HttpRequest`, `HttpResponse`, `CancellationToken` (bound to `RequestAborted`), `ClaimsPrincipal`, `IFormFile`, `Stream`/`PipeReader` for raw bodies.
- `[AsParameters]` groups several parameters into one record.

```csharp
app.MapGet("/products/{id:int}", async (int id, ShopDb db, CancellationToken ct) =>
    await db.Products.FindAsync([id], ct) is { } p ? Results.Ok(p) : Results.NotFound());

app.MapGet("/products", async ([AsParameters] ProductQuery q, ShopDb db, CancellationToken ct) =>
    await db.Products
        .Where(p => q.Category == null || p.Category == q.Category)
        .OrderBy(p => p.Name)
        .Skip((q.Page - 1) * q.PageSize).Take(q.PageSize)
        .ToListAsync(ct));

app.MapPost("/products", async (CreateProduct body, ShopDb db,
    [FromHeader(Name = "X-Request-Id")] string? requestId, CancellationToken ct) =>
{
    var p = new Product(body.Name, body.Price);
    db.Products.Add(p);
    await db.SaveChangesAsync(ct);
    return Results.Created($"/products/{p.Id}", p);
});

public record ProductQuery(string? Category, int Page = 1, int PageSize = 20);
public record CreateProduct(string Name, decimal Price);
```

Custom types can bind from strings by implementing `TryParse` or `IParsable<T>`, or from the whole request with a static `BindAsync` method.

At startup, the framework generates an optimised request delegate per endpoint; the Request Delegate Generator can do this at compile time for Native AOT.

- Pitfall: a bad JSON body or an unparsable route value returns 400 automatically, but with an empty body unless you configure ProblemDetails.
- Interview tip: always accept a `CancellationToken` so work stops when the client disconnects.

### Typed results and response shaping
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis/responses -->
A minimal API handler can return:
- A string (written as text/plain), or any object (serialised as JSON with status 200).
- An `IResult` from the `Results` factory: `Results.Ok(x)`, `Results.NotFound()`, `Results.Created(url, x)`, `Results.Problem(...)`, `Results.File(...)`, `Results.Stream(...)`, `Results.Redirect(...)`.
- A typed result from `TypedResults`, which returns concrete types such as `Ok<Product>` and `NotFound`.

`TypedResults` combined with the `Results<T1, T2, ...>` union return type is the recommended style. The compiler checks that you return only declared outcomes, unit tests can assert on concrete types without HTTP, and OpenAPI metadata is inferred automatically for each possible response.

```csharp
app.MapGet("/orders/{id:int}", GetOrder);

static async Task<Results<Ok<OrderDto>, NotFound, ForbidHttpResult>> GetOrder(
    int id, ClaimsPrincipal user, ShopDb db, CancellationToken ct)
{
    var order = await db.Orders.AsNoTracking()
        .Where(o => o.Id == id)
        .Select(o => new OrderDto(o.Id, o.CustomerId, o.Total))
        .SingleOrDefaultAsync(ct);

    if (order is null) return TypedResults.NotFound();
    if (order.CustomerId != user.GetCustomerId()) return TypedResults.Forbid();
    return TypedResults.Ok(order);
}

// Unit test without HTTP
var result = await GetOrder(1, testUser, db, default);
var ok = Assert.IsType<Ok<OrderDto>>(result.Result);
Assert.Equal(1, ok.Value!.Id);
```

Other response tools: `TypedResults.ValidationProblem(errors)` for 400 with field errors, `TypedResults.NoContent()` for 204, `TypedResults.Accepted(url)` for long-running operations, and returning `IAsyncEnumerable<T>` to stream a JSON array.

- Pitfall: returning EF entities directly leaks internal fields, can cause cycles during serialisation, and couples your API contract to the database schema; return DTOs.
- Pitfall: returning `null` from a handler declared to return an object produces a 200 with an empty body or `null`, not a 404.
- Interview tip: consistent status codes (201 with Location for creation, 204 for updates without body, 404 vs 403 semantics) are part of API design quality.

### Route groups
<!-- level: basic; ref: https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis/route-handlers#route-groups -->
As a minimal API grows, repeating prefixes and metadata on every endpoint becomes noisy and error-prone. Route groups (`app.MapGroup(prefix)`, .NET 7) let you define a prefix once and apply conventions such as authorization, rate limiting, filters, tags, CORS policies and OpenAPI metadata to every endpoint inside. Groups can be nested.

A common pattern is one static class per feature with an extension method that maps its group. This gives minimal APIs the organisation controllers had, without the ceremony.

```csharp
// Program.cs
var api = app.MapGroup("/api")
    .RequireAuthorization()
    .AddEndpointFilter<RequestAuditFilter>();

api.MapOrders();
api.MapCustomers();
app.MapGroup("/api/admin").RequireAuthorization("Admin").MapAdmin();

// Features/Orders/OrderEndpoints.cs
public static class OrderEndpoints
{
    public static RouteGroupBuilder MapOrders(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/orders")
                   .WithTags("Orders")
                   .RequireRateLimiting("per-user");

        g.MapGet("/", ListOrders);
        g.MapGet("/{id:int}", GetOrder).WithName("GetOrder");
        g.MapPost("/", CreateOrder);
        g.MapDelete("/{id:int}", DeleteOrder).RequireAuthorization("OrderAdmin");
        return g;
    }

    private static Task<Ok<List<OrderDto>>> ListOrders(ShopDb db, CancellationToken ct) => /* ... */ null!;
    private static Task<Results<Ok<OrderDto>, NotFound>> GetOrder(int id, ShopDb db, CancellationToken ct) => null!;
    private static Task<Created<OrderDto>> CreateOrder(CreateOrder cmd, ShopDb db, CancellationToken ct) => null!;
    private static Task<NoContent> DeleteOrder(int id, ShopDb db, CancellationToken ct) => null!;
}
```

Endpoint-level metadata adds to group metadata: the delete endpoint above requires both the group's default authorization and the `OrderAdmin` policy. To exempt one endpoint, use `.AllowAnonymous()`.

- Pitfall: forgetting `RequireAuthorization()` on a new group exposes endpoints publicly; consider a fallback authorization policy that requires authentication by default.
- Interview tip: route groups are how you version minimal APIs (`/v1`, `/v2` groups) and apply per-version conventions.

### Endpoint filters
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis/min-api-filters -->
Endpoint filters (.NET 7) are the minimal API equivalent of MVC action filters. They run around a specific endpoint or group, after routing and model binding, with access to the bound arguments via `EndpointFilterInvocationContext`. A filter can inspect or change arguments, short-circuit with its own result, or post-process the handler's result.

Typical uses: validation, idempotency checks, auditing, feature flags for specific endpoints, and enforcing tenant consistency between route values and the user.

```csharp
public sealed class ValidationFilter<T>(IValidator<T> validator) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx,
                                                EndpointFilterDelegate next)
    {
        var arg = ctx.Arguments.OfType<T>().FirstOrDefault();
        if (arg is null) return TypedResults.BadRequest();

        var result = await validator.ValidateAsync(arg, ctx.HttpContext.RequestAborted);
        if (!result.IsValid)
            return TypedResults.ValidationProblem(result.ToDictionary());

        return await next(ctx);                 // continue to the handler
    }
}

app.MapPost("/customers", CreateCustomer)
   .AddEndpointFilter<ValidationFilter<CreateCustomer>>();

// Inline filter measuring handler time
app.MapGet("/report", BuildReport)
   .AddEndpointFilter(async (ctx, next) =>
   {
       var sw = Stopwatch.StartNew();
       var result = await next(ctx);
       ctx.HttpContext.Response.Headers["X-Handler-Ms"] = sw.ElapsedMilliseconds.ToString();
       return result;
   });
```

Filters run in the order they were added, with group filters wrapping endpoint filters. A filter factory (`AddEndpointFilterFactory`) can inspect the handler's method signature once at startup and skip itself for endpoints where it does not apply, avoiding per-request reflection.

- Pitfall: filters run after binding, so they cannot fix binding failures; a malformed body is rejected before the filter runs.
- Interview tip: choose middleware for concerns independent of the endpoint, filters for concerns that need endpoint arguments or metadata.

### Built-in validation for minimal APIs (.NET 10)
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis#validation -->
For years, controllers validated `[Required]`, `[Range]` and other data annotations automatically, while minimal APIs needed a hand-written filter or a library such as FluentValidation. .NET 10 adds built-in validation for minimal APIs: register it once, and the framework validates query, header and body parameters (including nested objects and collections) before your handler runs, returning a 400 ValidationProblem response on failure.

Validation metadata is discovered by a source generator at compile time, so it works with Native AOT and adds little overhead.

```csharp
builder.Services.AddValidation();   // .NET 10

app.MapPost("/signups", (SignUp req) => TypedResults.Ok(new { req.Email }));

app.MapGet("/search", ([Range(1, 100)] int pageSize, [Required, MinLength(2)] string q)
    => TypedResults.Ok());

public record SignUp(
    [Required, EmailAddress] string Email,
    [Required, StringLength(100, MinimumLength = 2)] string Name,
    [Range(13, 120)] int Age,
    Address Address);                 // nested objects are validated too

public record Address([Required] string City, [RegularExpression(@"^\d{6}$")] string Pin);
```

A failing request returns something like:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": { "Email": ["The Email field is not a valid e-mail address."] }
}
```

You can implement `IValidatableObject` for cross-field rules and opt out per endpoint with `.DisableValidation()`.

Guidance on what validation belongs where:
- Shape and format (required fields, lengths, ranges): declarative attributes at the API boundary.
- Business rules needing data (email already registered, stock available): the application or domain layer, returning a proper result.

- Pitfall: validation attributes do not replace authorization; a perfectly valid request may still be forbidden.
- Interview tip: on older versions, the common approach is an endpoint filter calling FluentValidation or `Validator.TryValidateObject`.

### OpenAPI documents
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/fundamentals/openapi/overview -->
OpenAPI (formerly Swagger) is a machine-readable description of an HTTP API: endpoints, parameters, request and response schemas, and security. It powers interactive documentation, client SDK generation, contract testing and API gateways.

Since .NET 9, ASP.NET Core generates OpenAPI documents natively with the `Microsoft.AspNetCore.OpenApi` package, replacing Swashbuckle in the default templates. .NET 10 generates OpenAPI 3.1 by default and can also serve YAML. The document is built from endpoint metadata: route templates, parameter types, `TypedResults` return types, `Produces` and `Accepts` annotations, XML doc comments (with .NET 10 support), and names and summaries you add.

```csharp
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((doc, ctx, ct) =>
    {
        doc.Info.Title = "Shop API";
        doc.Info.Version = "v1";
        return Task.CompletedTask;
    });
});

var app = builder.Build();
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();                    // serves /openapi/v1.json
}

app.MapGet("/products/{id:int}", GetProduct)
   .WithName("GetProduct")
   .WithSummary("Get a product by id")
   .WithDescription("Returns 404 if the product does not exist.")
   .Produces<ProductDto>()
   .ProducesProblem(StatusCodes.Status404NotFound);
```

The built-in package produces the document; for an interactive UI you add a separate tool such as Scalar or Swagger UI pointing at the JSON endpoint. Documents can also be generated at build time (Microsoft.Extensions.ApiDescription.Server) and checked into source control, so API changes show up in code review and breaking changes can be detected automatically.

- Pitfall: exposing the OpenAPI document and UI publicly in production reveals your full attack surface; restrict or protect it if the API is not public.
- Pitfall: returning `IResult` instead of typed results leaves response types undocumented unless you add `Produces` metadata.
- Interview tip: describe "API-first" (design the OpenAPI contract first) versus "code-first" (generate it from code) and when each fits.
