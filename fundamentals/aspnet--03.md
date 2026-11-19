## 5. Controllers, MVC and Razor
### API controllers and the ApiController attribute
<!-- level: basic; ref: https://learn.microsoft.com/aspnet/core/web-api/ -->
Controllers group related HTTP actions in a class deriving from `ControllerBase` (for APIs) or `Controller` (adds view support). They are registered with `builder.Services.AddControllers()` and mapped with `app.MapControllers()`.

The `[ApiController]` attribute switches on API-friendly conventions:
- Attribute routing is required, keeping routes explicit.
- Automatic 400 responses when model validation fails, using ValidationProblemDetails.
- Binding source inference: complex types come from the body, route and query values from their sources, so `[FromBody]` is usually unnecessary.
- Error status codes (4xx) returned via `ControllerBase` helpers are turned into ProblemDetails responses.

```csharp
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public sealed class OrdersController(IOrderService orders) : ControllerBase
{
    [HttpGet("{id:int}")]
    [ProducesResponseType<OrderDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderDto>> Get(int id, CancellationToken ct)
    {
        var order = await orders.FindAsync(id, ct);
        return order is null ? NotFound() : order;          // implicit Ok
    }

    [HttpPost]
    [Authorize(Policy = "CanOrder")]
    public async Task<ActionResult<OrderDto>> Create(CreateOrderRequest req, CancellationToken ct)
    {
        var created = await orders.CreateAsync(req, User.GetUserId(), ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }
}

builder.Services.AddControllers();
app.MapControllers();
```

`ActionResult<T>` lets an action return either a `T` (serialised with 200) or any `ActionResult` like `NotFound()`, while still documenting the success type for OpenAPI.

Controllers are created per request by DI, so constructor injection works with any lifetime. Keep them thin: translate HTTP to application calls and back, and put business logic in services.

- Pitfall: actions that take entity types as input enable over-posting, where clients set fields you never intended (such as `IsAdmin`); bind to request DTOs.
- Interview tip: controllers and minimal APIs can coexist in one app, which eases gradual migration.

### Model binding sources
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/mvc/models/model-binding -->
Model binding converts raw HTTP data (route values, query strings, headers, form fields, the body) into action parameters and objects. In MVC and controllers, binders are chosen per type, and attributes specify sources explicitly:

- `[FromRoute]`: route template values.
- `[FromQuery]`: query string.
- `[FromHeader]`: request headers.
- `[FromForm]`: form fields and files (`IFormFile`), for `multipart/form-data` or URL-encoded forms.
- `[FromBody]`: the request body, read by an input formatter (JSON by default). Only one parameter can bind from the body.
- `[FromServices]`: DI services (inferred automatically for registered types in .NET 7+).

Simple types (strings, numbers, `Guid`, `DateTime`, enums, types with `TryParse`) bind from route and query; complex types bind from the body in `[ApiController]` controllers. Collections bind from repeated query keys (`?tag=a&tag=b`).

```csharp
[HttpGet("search")]
public IActionResult Search(
    [FromQuery] string q,
    [FromQuery(Name = "tag")] string[] tags,
    [FromQuery] int page = 1,
    [FromHeader(Name = "Accept-Language")] string? lang = null)
    => Ok(new { q, tags, page, lang });

[HttpPost("{customerId:int}/documents")]
[RequestSizeLimit(20_000_000)]
public async Task<IActionResult> Upload(
    [FromRoute] int customerId,
    [FromForm] string description,
    IFormFile file,
    CancellationToken ct)
{
    await using var stream = file.OpenReadStream();
    // validate type and size, then store
    return Ok();
}
```

When binding fails (an invalid integer, malformed JSON), the error is recorded in `ModelState`; with `[ApiController]` the request is rejected with 400 before the action runs.

Custom binding: implement `IModelBinder` for special formats, or `TryParse` on your type for simple conversions.

- Pitfall: `[FromBody]` on a simple type like `string` expects a JSON string literal (`"hello"`), not raw text; use a DTO or read the body manually.
- Pitfall: binding the same complex type from both body and form across endpoints causes confusion; be explicit.
- Interview tip: over-posting (mass assignment) protection comes from binding to purpose-built DTOs, not from `[Bind]` attribute lists.

### Model validation and validation problem responses
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/mvc/models/validation -->
After binding, MVC validates models using data annotation attributes (`[Required]`, `[StringLength]`, `[Range]`, `[EmailAddress]`, `[RegularExpression]`, `[Compare]`) and `IValidatableObject` for cross-field rules. Results go into `ModelState`. With `[ApiController]`, invalid models automatically produce a 400 response with a `ValidationProblemDetails` body listing errors per field.

Non-nullable reference type properties are treated as implicitly `[Required]` when nullable reference types are enabled, which surprises many developers.

```csharp
public sealed class CreateCustomerRequest : IValidatableObject
{
    [Required, StringLength(100, MinimumLength = 2)]
    public string Name { get; init; } = "";

    [Required, EmailAddress]
    public string Email { get; init; } = "";

    [Range(typeof(decimal), "0", "1000000")]
    public decimal CreditLimit { get; init; }

    public DateOnly? ContractStart { get; init; }
    public DateOnly? ContractEnd { get; init; }

    public IEnumerable<ValidationResult> Validate(ValidationContext ctx)
    {
        if (ContractEnd < ContractStart)
            yield return new ValidationResult("End must be after start",
                [nameof(ContractEnd)]);
    }
}

// Customise the automatic 400 response
builder.Services.AddControllers()
    .ConfigureApiBehaviorOptions(o =>
    {
        o.InvalidModelStateResponseFactory = ctx =>
        {
            var problem = new ValidationProblemDetails(ctx.ModelState)
            {
                Status = 400,
                Extensions = { ["traceId"] = Activity.Current?.Id },
            };
            return new BadRequestObjectResult(problem);
        };
    });
```

Many teams use FluentValidation for complex rules because validators are separate, composable and easy to unit test.

Validation at the API layer should check shape and format. Rules that depend on state (unique email, sufficient stock, allowed status transitions) belong in the application layer, returning 409 or 422 as appropriate.

- Pitfall: relying only on client-side validation; every rule must be enforced on the server.
- Interview tip: know the difference between 400 (malformed or invalid input) and 422 (well-formed but semantically unprocessable), and be consistent across your API.

### The MVC filter pipeline
<!-- level: advanced; ref: https://learn.microsoft.com/aspnet/core/mvc/controllers/filters -->
Filters run code at specific stages of MVC action execution, inside the endpoint (after routing and middleware). The stages, in order:

1. Authorization filters: decide whether the user may access the action; can short-circuit with 401/403.
2. Resource filters: run before model binding and after the rest of the pipeline; good for caching or short-circuiting expensive work.
3. Action filters: run immediately before and after the action method, with access to bound arguments and the result.
4. Exception filters: handle unhandled exceptions thrown by actions or filters (not by middleware or result execution).
5. Result filters: run before and after the action result executes (serialisation), for example to add headers.

Filters can be applied globally, per controller, or per action, and can be synchronous or async. `IAsyncActionFilter` is the most common.

```csharp
public sealed class IdempotencyFilter(IIdempotencyStore store) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext ctx, ActionExecutionDelegate next)
    {
        if (!ctx.HttpContext.Request.Headers.TryGetValue("Idempotency-Key", out var key))
        {
            ctx.Result = new BadRequestObjectResult("Idempotency-Key header required");
            return;                                      // short-circuit
        }

        if (await store.TryGetAsync(key!, out var cached))
        {
            ctx.Result = new ObjectResult(cached.Body) { StatusCode = cached.Status };
            return;
        }

        var executed = await next();                     // run the action
        if (executed.Result is ObjectResult { StatusCode: >= 200 and < 300 } ok)
            await store.SaveAsync(key!, ok.StatusCode!.Value, ok.Value);
    }
}

builder.Services.AddScoped<IdempotencyFilter>();

[HttpPost, ServiceFilter<IdempotencyFilter>]
public Task<IActionResult> Pay(PaymentRequest req) => /* ... */ Task.FromResult<IActionResult>(Ok());
```

`[ServiceFilter]` and `[TypeFilter]` let filters receive DI services; plain attribute filters cannot have constructor dependencies.

- Pitfall: exception filters do not catch exceptions from middleware or during response serialisation; use `UseExceptionHandler` for global handling.
- Interview tip: be ready to explain why authorization is both a filter (MVC `[Authorize]`) and middleware (endpoint authorization) and which one actually runs in modern apps (the middleware, using endpoint metadata).

### Content negotiation and formatters
<!-- level: intermediate; ref: https://learn.microsoft.com/aspnet/core/web-api/advanced/formatting -->
Content negotiation lets a client ask for a representation via the `Accept` header (`application/json`, `application/xml`, `text/csv`) and lets the server choose the best matching output formatter. Input formatters similarly read request bodies based on `Content-Type`.

By default, ASP.NET Core controllers use System.Text.Json for input and output. You can add XML formatters, replace JSON settings, or write custom formatters for formats like CSV. Minimal APIs are JSON-centric by design; for other formats you write the response explicitly or return a custom `IResult`.

```csharp
builder.Services.AddControllers(o =>
{
    o.RespectBrowserAcceptHeader = false;      // browsers send */*; keep JSON
    o.ReturnHttpNotAcceptable = true;          // 406 for unsupported Accept types
    o.OutputFormatters.Add(new CsvOutputFormatter());
})
.AddXmlSerializerFormatters()
.AddJsonOptions(j =>
{
    j.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    j.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// Minimal APIs: configure JSON globally
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default);  // AOT
});

public sealed class CsvOutputFormatter : TextOutputFormatter
{
    public CsvOutputFormatter()
    {
        SupportedMediaTypes.Add("text/csv");
        SupportedEncodings.Add(Encoding.UTF8);
    }
    protected override bool CanWriteType(Type? type) => typeof(IEnumerable<OrderDto>).IsAssignableFrom(type);
    public override async Task WriteResponseBodyAsync(OutputFormatterWriteContext ctx, Encoding enc)
    {
        var sb = new StringBuilder("id,total\n");
        foreach (var o in (IEnumerable<OrderDto>)ctx.Object!) sb.Append($"{o.Id},{o.Total}\n");
        await ctx.HttpContext.Response.WriteAsync(sb.ToString(), enc);
    }
}
```

`[Produces]` and `[Consumes]` attributes restrict formats per action and improve OpenAPI accuracy.

- Pitfall: changing JSON naming or enum handling globally is a breaking API change for existing clients.
- Interview tip: mention that JSON serialisation settings for controllers (`AddJsonOptions`) and minimal APIs (`ConfigureHttpJsonOptions`) are configured separately.

### Razor Pages and MVC views
<!-- level: basic; ref: https://learn.microsoft.com/aspnet/core/razor-pages/ -->
For server-rendered HTML, ASP.NET Core offers Razor, a syntax that mixes HTML with C# (`@Model.Name`, `@if`, `@foreach`). Output is HTML-encoded by default, protecting against cross-site scripting.

Two models use Razor:
- MVC views: a controller action builds a model and returns `View(model)`, which renders a `.cshtml` file. Good for apps with many related actions.
- Razor Pages: each page (`Pages/Orders/Edit.cshtml`) has a `PageModel` class with handler methods like `OnGetAsync` and `OnPostAsync`. Routing follows the file path. Usually simpler for form-based CRUD apps.

Shared features: layouts, partial views, view components, tag helpers (`asp-for`, `asp-action`, `asp-validation-for`), and automatic antiforgery tokens in forms.

```csharp
// Pages/Customers/Edit.cshtml.cs
public sealed class EditModel(ShopDb db) : PageModel
{
    [BindProperty] public CustomerInput Input { get; set; } = new();

    public async Task<IActionResult> OnGetAsync(int id)
    {
        var c = await db.Customers.FindAsync(id);
        if (c is null) return NotFound();
        Input = new CustomerInput { Id = c.Id, Name = c.Name, Email = c.Email };
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        if (!ModelState.IsValid) return Page();     // re-render with errors
        var c = await db.Customers.FindAsync(Input.Id);
        if (c is null) return NotFound();
        c.Name = Input.Name; c.Email = Input.Email;
        await db.SaveChangesAsync();
        return RedirectToPage("Index");             // Post-Redirect-Get
    }
}
```

```html
@page "{id:int}"
@model EditModel
<form method="post">
    <input asp-for="Input.Name" />
    <span asp-validation-for="Input.Name"></span>
    <button type="submit">Save</button>
</form>
```

- Pitfall: `@Html.Raw(userInput)` bypasses encoding and enables XSS; use it only for trusted, sanitised HTML.
- Interview tip: the Post-Redirect-Get pattern prevents duplicate form submissions on browser refresh.

## 6. Data access with Entity Framework Core
### DbContext configuration, lifetime and pooling
<!-- level: basic; ref: https://learn.microsoft.com/ef/core/dbcontext-configuration/ -->
Entity Framework Core is .NET's object-relational mapper (ORM). A `DbContext` represents a unit of work with the database: it exposes `DbSet<T>` collections for queries, tracks changes to loaded entities, and writes them back with `SaveChangesAsync`. Providers exist for SQL Server, PostgreSQL (Npgsql), SQLite, MySQL, Cosmos DB and others.

In ASP.NET Core, register the context with `AddDbContext` (scoped: one per request) or `AddDbContextPool`, which reuses context instances across requests to cut allocation and setup costs in high-throughput apps.

```csharp
public sealed class ShopDb(DbContextOptions<ShopDb> options) : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Customer> Customers => Set<Customer>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.ApplyConfigurationsFromAssembly(typeof(ShopDb).Assembly);
        b.Entity<Order>().Property(o => o.Total).HasPrecision(18, 2);
        b.Entity<Order>().HasIndex(o => new { o.CustomerId, o.CreatedAt });
    }
}

builder.Services.AddDbContextPool<ShopDb>(o =>
{
    o.UseSqlServer(builder.Configuration.GetConnectionString("Shop"),
        sql => sql.EnableRetryOnFailure(maxRetryCount: 3));
    if (builder.Environment.IsDevelopment())
        o.EnableSensitiveDataLogging().LogTo(Console.WriteLine, LogLevel.Information);
});
```

Important rules:
- A `DbContext` is not thread-safe. Never run two queries on the same instance concurrently (for example with `Task.WhenAll`); EF throws "A second operation was started on this context".
- Keep contexts short-lived. A long-lived context accumulates tracked entities, becomes slow, and returns stale data.
- In singletons and background services, use `IDbContextFactory<T>` or a scope to create contexts as needed.

- Pitfall: `EnableSensitiveDataLogging` logs parameter values, including personal data; never enable it in production.
- Interview tip: pooled contexts must not hold per-request state in fields, because the instance is reset and reused.

### Migrations and schema management
<!-- level: intermediate; ref: https://learn.microsoft.com/ef/core/managing-schemas/migrations/ -->
EF Core migrations keep the database schema in sync with your model. When you change entities or configuration, you add a migration; EF compares the model with the last snapshot and generates C# code with `Up` and `Down` methods. Applying migrations runs that code as SQL against the database and records it in the `__EFMigrationsHistory` table.

```bash
dotnet tool install --global dotnet-ef
dotnet ef migrations add AddOrderStatus
dotnet ef database update                       # local development
dotnet ef migrations script --idempotent -o deploy.sql   # for production review
dotnet ef migrations bundle -o efbundle         # self-contained executable for pipelines
```

```csharp
public partial class AddOrderStatus : Migration
{
    protected override void Up(MigrationBuilder m)
    {
        m.AddColumn<int>("Status", "Orders", nullable: false, defaultValue: 0);
        m.Sql("UPDATE Orders SET Status = 1 WHERE PaidAt IS NOT NULL");   // data fix
        m.CreateIndex("IX_Orders_Status", "Orders", "Status");
    }

    protected override void Down(MigrationBuilder m)
    {
        m.DropIndex("IX_Orders_Status", "Orders");
        m.DropColumn("Status", "Orders");
    }
}
```

Production practices:
- Review the generated SQL. Some changes (renames detected as drop and add, column type changes) can lose data or lock large tables.
- Apply migrations as a separate deployment step (idempotent script or bundle), not by calling `Database.Migrate()` at app startup. With several instances starting at once, startup migration causes races, and the app needs DDL permissions it should not have.
- Use expand-and-contract for zero-downtime changes: add the new column, deploy code writing both, backfill, switch reads, then remove the old column in a later release.

- Pitfall: editing a migration that has already been applied somewhere leads to drift between environments; add a new migration instead.
- Interview tip: `EnsureCreated()` bypasses migrations entirely; it is only for tests and prototypes.

### Querying efficiently: tracking, projection, Include and split queries
<!-- level: intermediate; ref: https://learn.microsoft.com/ef/core/querying/tracking -->
LINQ queries against a `DbSet` are translated to SQL. How you write them decides how much data moves and how much work EF does.

- Tracking vs no-tracking: by default, entities returned from queries are tracked so changes can be saved. Tracking costs memory and CPU. For read-only scenarios use `AsNoTracking()`, or set `QueryTrackingBehavior.NoTracking` as the default for read-heavy contexts.
- Projection: `Select` into DTOs fetches only needed columns and skips tracking automatically. This is usually the fastest and safest way to build API responses.
- Eager loading: `Include` / `ThenInclude` loads related data in the same query. Multiple collection includes create a cartesian explosion (rows multiply); `AsSplitQuery()` runs separate queries per collection instead.
- Lazy loading (opt-in proxies) loads navigations on access and easily causes N+1 queries; most API projects leave it off.
- Pagination: `OrderBy` then `Skip`/`Take`, or keyset pagination (`Where(o => o.Id > lastId).Take(n)`) for large tables.

```csharp
// Read model for an API response
var page = await db.Orders
    .Where(o => o.CustomerId == customerId && o.CreatedAt >= since)
    .OrderByDescending(o => o.CreatedAt)
    .Select(o => new OrderSummary(o.Id, o.CreatedAt, o.Total, o.Lines.Count))
    .Take(50)
    .ToListAsync(ct);

// Loading an aggregate to modify it
var order = await db.Orders
    .Include(o => o.Lines)
    .Include(o => o.Payments)
    .AsSplitQuery()
    .SingleAsync(o => o.Id == id, ct);

// Check the SQL during development
var sql = db.Orders.Where(o => o.Total > 100).ToQueryString();
```

- Pitfall: calling `.ToList()` before `Where` filters in memory after loading the whole table.
- Pitfall: `Include` on a query that ends in `Select` is ignored; projection decides what is loaded.
- Interview tip: always look at generated SQL and the execution plan for key queries; ORMs do not remove the need to understand indexes.

### Saving changes, transactions and optimistic concurrency
<!-- level: intermediate; ref: https://learn.microsoft.com/ef/core/saving/concurrency -->
`SaveChangesAsync` inspects tracked entities, generates INSERT, UPDATE and DELETE statements for changes, and executes them in a single database transaction by default. Modern EF Core batches multiple statements into fewer round trips.

For multi-step operations that call `SaveChanges` several times, or mix EF with raw SQL, wrap them in an explicit transaction. With retrying execution strategies (`EnableRetryOnFailure`), run the whole transaction inside `CreateExecutionStrategy().ExecuteAsync` so a retry repeats the entire unit.

Optimistic concurrency prevents lost updates when two users edit the same record. A concurrency token (`[Timestamp]` rowversion in SQL Server, or `xmin` in PostgreSQL) is included in the UPDATE's WHERE clause. If another transaction changed the row first, zero rows are affected and EF throws `DbUpdateConcurrencyException`.

```csharp
public class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int Stock { get; set; }
    [Timestamp] public byte[] RowVersion { get; set; } = [];
}

try
{
    var p = await db.Products.SingleAsync(x => x.Id == id, ct);
    if (p.Stock < qty) return Results.Conflict("Insufficient stock");
    p.Stock -= qty;
    await db.SaveChangesAsync(ct);
}
catch (DbUpdateConcurrencyException)
{
    return Results.Conflict("Product was modified by someone else; please retry");
}

// Explicit transaction across multiple saves
var strategy = db.Database.CreateExecutionStrategy();
await strategy.ExecuteAsync(async () =>
{
    await using var tx = await db.Database.BeginTransactionAsync(ct);
    db.Orders.Add(order);
    await db.SaveChangesAsync(ct);
    db.Outbox.Add(new OutboxMessage("OrderPlaced", order.Id));
    await db.SaveChangesAsync(ct);
    await tx.CommitAsync(ct);
});
```

For HTTP APIs, expose the concurrency token as an ETag and require `If-Match` on updates, returning 412 Precondition Failed on mismatch.

- Pitfall: pessimistic locking (holding database locks while a user edits a form) does not scale and causes timeouts.
- Interview tip: the outbox pattern above (saving the event in the same transaction as the change) is the standard answer to "how do you reliably publish events after saving".

### Bulk operations, raw SQL and performance features
<!-- level: advanced; ref: https://learn.microsoft.com/ef/core/saving/execute-insert-update-delete -->
Change tracking is great for editing individual aggregates but wasteful for set-based operations. EF Core offers tools for when you need more control:

- `ExecuteUpdateAsync` and `ExecuteDeleteAsync` (EF Core 7) translate directly to a single UPDATE or DELETE statement with no entities loaded or tracked.
- `FromSql` (interpolated, parameterised) and `SqlQuery<T>` (EF Core 8, for unmapped types) run raw SQL while keeping protection against injection.
- Compiled queries (`EF.CompileAsyncQuery`) skip LINQ translation on hot paths.
- `AddRange` with batching for moderate inserts; for very large imports use provider bulk APIs (`SqlBulkCopy`, PostgreSQL `COPY`).
- Global query filters for soft delete and multi-tenancy (EF Core 10 adds named filters so you can disable them selectively).

```csharp
// Set-based update: one statement
int expired = await db.Coupons
    .Where(c => c.ExpiresAt < DateTime.UtcNow && c.IsActive)
    .ExecuteUpdateAsync(s => s.SetProperty(c => c.IsActive, false), ct);

// Set-based delete
await db.AuditLogs.Where(a => a.CreatedAt < cutoff).ExecuteDeleteAsync(ct);

// Raw SQL into a DTO, parameterised safely
var top = await db.Database
    .SqlQuery<TopCustomer>($"""
        SELECT TOP (10) CustomerId, SUM(Total) AS Spent
        FROM Orders WHERE CreatedAt >= {since}
        GROUP BY CustomerId ORDER BY Spent DESC
        """)
    .ToListAsync(ct);

// Compiled query for a hot path
private static readonly Func<ShopDb, int, CancellationToken, Task<Product?>> ById =
    EF.CompileAsyncQuery((ShopDb db, int id, CancellationToken ct) =>
        db.Products.AsNoTracking().FirstOrDefault(p => p.Id == id));
```

Many teams combine EF Core for writes and complex domain logic with Dapper or raw SQL for heavy read queries and reports.

- Pitfall: `ExecuteUpdate`/`ExecuteDelete` bypass the change tracker, so already-loaded entities in the same context become stale, and `SaveChanges` interceptors or audit logic do not run.
- Interview tip: measure with the provider's query statistics; slow EF code is usually a missing index or over-fetching, not EF overhead.
