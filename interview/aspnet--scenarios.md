### After scaling your API to three instances, users are randomly logged out and antiforgery tokens fail. How would you investigate?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview -->
Observe: the symptom appeared only after adding instances, and it is intermittent, depending on which node serves the request. Logs likely show "The antiforgery token could not be decrypted" or "key was not found in the key ring".

Hypothesise: cookies and antiforgery tokens are protected with Data Protection keys. By default each instance generates its own keys in local storage (or in memory in a container), so node B cannot read what node A encrypted.

Verify: check logs on each node for CryptographicException, confirm that the key folder differs per instance, and reproduce by pinning requests to one node, which works, then switching, which fails.

Fix: persist and share the key ring and set a common application name.

```csharp
builder.Services.AddDataProtection()
    .SetApplicationName("shop")
    .PersistKeysToStackExchangeRedis(redis, "dp-keys")
    .ProtectKeysWithCertificate(cert);
```

Prevent: put this in a shared startup library, add a staging test with two replicas, and document it in the deployment checklist.

Common wrong answers
- Enabling sticky sessions only; it hides the issue and breaks on every restart.
- Extending cookie lifetime, which is unrelated.
- Disabling antiforgery validation, which removes a security control.

### A browser app gets a CORS error calling your API, but the same call works in Postman. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/security/cors -->
Observe: Postman is not a browser, so it never enforces CORS. The browser console reports a blocked cross-origin request. Open the Network tab and look at whether an `OPTIONS` preflight was sent and what it returned.

Hypothesise: the policy is missing, the origin does not match exactly (scheme, host and port all count), the preflight is rejected before CORS runs (for example by authorization returning 401), or the real response is a 500 with no CORS headers so the browser shows a misleading CORS error.

Verify with curl simulating the preflight:

```bash
curl -i -X OPTIONS https://api.example.com/orders \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization"
```

Look for `Access-Control-Allow-Origin` and allowed headers in the reply.

Fix: register the exact origin, methods and headers, and place `app.UseCors()` after `UseRouting` and before `UseAuthorization`. If cookies are used, add `AllowCredentials` with explicit origins.

Prevent: keep origins in configuration per environment, and add an integration test that sends a preflight.

Common wrong answers
- `AllowAnyOrigin` as a permanent fix.
- Treating CORS as server security; it only constrains browsers.
- Adding headers in a controller, where preflights never arrive.

### Some requests get 401 with valid JWTs intermittently, mostly right after your identity provider rotated keys. How do you troubleshoot?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/ -->
Observe: failures cluster around key rotation time, are not tied to specific users, and recover without a deploy or after a restart. Enable debug logging for `Microsoft.AspNetCore.Authentication` to see messages like "IDX10503: signature validation failed" or "IDX10214: audience validation failed".

Hypothesise candidates: stale cached signing keys (the metadata is refreshed on an interval, 24 hours automatically and with a minimum refresh of 5 minutes when an unknown key id is seen), clock skew between servers causing "token not yet valid" or expired, or an audience or issuer mismatch after a configuration change.

Verify: decode a failing token (header `kid`, `iss`, `aud`, `nbf`, `exp`) and compare against the provider's JWKS endpoint and your validation settings. Check server time with NTP status.

Fix: use `Authority` so keys are fetched automatically and refreshed on unknown `kid`; avoid hard-coding a signing key; keep a small `ClockSkew`; sync time on nodes; set `AutomaticRefreshInterval` and `RefreshInterval` appropriately.

Prevent: alert on authentication failure rates and rehearse key rotation in staging.

Common wrong answers
- Turning off signature or lifetime validation.
- Restarting the app on a schedule.
- Increasing token lifetime to hide the problem.

### The API's memory grows steadily over days until the container is OOM-killed. How do you find the cause?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/dotnet/core/diagnostics/ -->
Observe: plot working set and GC heap size over time, and compare gen-2 size and fragmentation. If the managed heap grows, you have retained objects. If the working set grows but the heap does not, suspect native memory, many threads or unmanaged buffers. Also check the container memory limit versus runtime settings.

Hypothesise: an unbounded `IMemoryCache` or static dictionary, event handlers never unsubscribed, `HttpClient` or `DbContext` instances held by singletons, large object heap fragmentation, or `Task`s accumulating.

Verify with live diagnostics, no redeploy needed:

```bash
dotnet-counters monitor -p <pid> System.Runtime
dotnet-gcdump collect -p <pid>      # open in Visual Studio or PerfView
dotnet-dump collect -p <pid>; dotnet-dump analyze <dump>
> dumpheap -stat
```

Compare two gcdumps taken hours apart and look at the types whose counts grow, then find their roots.

Fix: add size limits and expiry to caches, remove static references, dispose resources, stream large payloads instead of buffering.

Prevent: add memory and GC metrics to dashboards and alerts, and load-test with a soak test before releases.

Common wrong answers
- Calling `GC.Collect()` periodically.
- Blaming the garbage collector without looking at retention.
- Only raising the container memory limit.

### Under moderate load the API's latency explodes while CPU stays low. What is your approach?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/performance-best-practices -->
Observe: low CPU with high latency means requests are waiting, not computing. Typical waits are on the thread pool, a database connection pool, or downstream calls.

Hypothesise: thread-pool starvation caused by blocking calls (`.Result`, `.Wait()`, sync I/O), connection pool exhaustion (requests waiting for a connection, default max 100 for SqlClient), or a slow dependency with no timeout.

Verify:

```bash
dotnet-counters monitor -p <pid> System.Runtime
# watch: ThreadPool Queue Length, ThreadPool Thread Count
dotnet-stack report -p <pid>      # many threads blocked in Task.Wait / GetResult
```

Search code for sync-over-async, check database wait stats and the pool exhaustion exceptions ("Timeout expired... obtaining a connection from the pool").

Fix: make the call chain async end to end, pass cancellation tokens, set timeouts on HttpClient and database commands, fix slow queries and leaked connections (undisposed readers), and cap concurrency to protect dependencies.

Prevent: load tests in CI for critical paths, and dashboards for queue length and pool usage.

Common wrong answers
- Raising `ThreadPool.SetMinThreads` as the only remedy.
- Wrapping blocking code in `Task.Run`.
- Scaling out first, which multiplies pressure on the shared database.

### A production deployment applied an EF Core migration that failed halfway. How should migrations be run safely?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying -->
Observe: determine the state: which statements ran, whether `__EFMigrationsHistory` has the row, and whether the app is serving requests against a half-changed schema. Many providers wrap each migration in a transaction, but SQL Server cannot transactionally roll back every DDL operation, and large data changes may be partial.

Hypothesise: the migration was applied automatically at startup (`Database.Migrate()`) by several instances at once, or contained a data change that violated a constraint in production data.

Verify: generate the script and compare with what exists.

```bash
dotnet ef migrations script <from> <to> --idempotent -o migrate.sql
```

Fix forward: repair the schema by hand or a corrective migration, restore from backup if the damage is significant, then redeploy.

Prevent: do not migrate from app startup on multiple instances. Generate idempotent scripts or use a migration bundle (`dotnet ef migrations bundle`) executed as a separate pipeline step with a backup taken first. Follow expand and contract: add new columns first, deploy code that works with both, then drop old ones later. Rehearse on a production-sized copy.

Common wrong answers
- Editing already-applied migration files.
- Running `Migrate()` in `Program.cs` on all replicas.
- Deleting history rows to retry blindly.

### Behind a load balancer your app redirects endlessly to HTTPS and OAuth login fails with a redirect URI mismatch. Why?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer -->
Observe: the browser shows ERR_TOO_MANY_REDIRECTS, and the identity provider complains that the redirect URI uses `http://` or an internal hostname.

Hypothesise: TLS terminates at the load balancer, which forwards plain HTTP to Kestrel. The app thinks the scheme is `http`, so `UseHttpsRedirection` redirects again, and generated absolute URLs (including the OAuth callback) use the wrong scheme and host.

Verify: log `Request.Scheme`, `Request.Host` and `RemoteIpAddress` inside the app, and inspect the headers the proxy sends with `curl -v` through the load balancer: `X-Forwarded-Proto`, `X-Forwarded-For`, `X-Forwarded-Host`.

Fix:

```csharp
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor
                       | ForwardedHeaders.XForwardedProto;
    // restrict to the proxy's address instead of trusting everyone
});
app.UseForwardedHeaders(); // before HTTPS redirection, auth, etc.
```

Setting `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` also works in container setups.

Prevent: include the proxy topology in staging, and restrict known proxies so clients cannot spoof addresses.

Common wrong answers
- Removing `UseHttpsRedirection` without fixing the scheme, which leaves callbacks broken.
- Hard-coding the callback URL.
- Trusting forwarded headers from every network.

### Users see stale data after a product update because of output caching. How do you design correct invalidation?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/caching/output -->
Observe: the database holds the new value, but `/catalog` keeps returning the old response until the cache entry expires. Compare response headers and timestamps to confirm the cache is serving the data (check for the cache layer: app output cache, CDN, or browser).

Hypothesise: the cache has a fixed time-to-live and no invalidation on writes, or it caches across a dimension that should vary (query string, tenant, language).

Verify: bypass layers one at a time, direct to the app, then via CDN, with `curl -H "Cache-Control: no-cache"` and compare. Check which `Vary` and cache policies apply.

Fix: tag cached responses and evict on writes.

```csharp
app.MapGet("/catalog", Get).CacheOutput(p => p.Tag("catalog").Expire(TimeSpan.FromMinutes(5)));
app.MapPut("/products/{id}", async (int id, Product p, Db db, IOutputCacheStore store) =>
{
    await db.SaveAsync(id, p);
    await store.EvictByTagAsync("catalog", default);
    return Results.NoContent();
});
```

With several instances, use a shared store (Redis) or short TTLs so nodes agree.

Prevent: decide per endpoint how stale is acceptable, document it, and add tests that update then read.

Common wrong answers
- Removing all caching.
- Very short TTLs everywhere, which wastes the cache and still serves stale data.
- Forgetting the CDN and browser layers.

### When a popular cache key expires, the database spikes and the app slows down. What is happening and how do you fix it?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/caching/hybrid -->
Observe: periodic database load spikes aligned with cache expiry, with many identical queries running simultaneously (visible in database logs or APM traces).

Hypothesise: a cache stampede. When a hot key expires, every concurrent request misses and runs the expensive factory. `IMemoryCache.GetOrCreateAsync` does not serialize factories.

Verify: log factory invocations per key with a counter, and run a load test hitting one hot key while forcing expiry. You should see N concurrent executions.

Fix options:
1. Use `HybridCache` (.NET 9+), which coalesces concurrent calls per key.
2. Add a per-key lock (`SemaphoreSlim` keyed or `Lazy<Task<T>>` stored in the cache).
3. Refresh early: stale-while-revalidate, where a background task refreshes before expiry.
4. Add jitter to TTLs so keys do not expire together.

```csharp
var v = await hybrid.GetOrCreateAsync("top-products",
    async ct => await repo.LoadTopAsync(ct),
    new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(10) });
```

Prevent: load-test expiry scenarios and protect the database with connection limits.

Common wrong answers
- Longer TTLs only; the stampede still occurs, just less often.
- Pre-warming without handling later expiry.
- Scaling the database instead of fixing duplicate work.

### Two users edit the same record and one silently overwrites the other. How do you prevent lost updates?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/ef/core/saving/concurrency -->
Observe: support tickets say changes vanished. Audit logs show two updates seconds apart where the second contained the old values of fields the first changed.

Hypothesise: a read-modify-write cycle with last-write-wins semantics, because the update statement has no condition on the version of the row that the user originally saw.

Verify: reproduce with two browser sessions loading the same record, saving from both, and watching the generated SQL: `UPDATE ... WHERE Id = @id` with no version check.

Fix: optimistic concurrency. Add a concurrency token.

```csharp
public class Order { public int Id { get; set; }
    [Timestamp] public byte[] RowVersion { get; set; } = default!; }

try { await db.SaveChangesAsync(); }
catch (DbUpdateConcurrencyException) { return Results.Conflict("Record changed, reload."); }
```

The client must send the version back (ETag or a field), and the API returns 409 or 412 on mismatch. Offer a merge or reload UI. Pessimistic locks are an option only for very high contention.

Prevent: add concurrency tokens by default on mutable aggregates, and test with parallel updates.

Common wrong answers
- Wrapping in a transaction, which does not stop the lost update at default isolation.
- Locking in application code, which fails across instances.
- Using `Update()` to overwrite all columns from a stale DTO.

### A BackgroundService silently stopped processing messages and nobody noticed. How do you diagnose and harden it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services -->
Observe: queue depth grows, but the app looks healthy, the API still answers, and there are no recent logs from the worker.

Hypothesise: `ExecuteAsync` threw an unhandled exception. Since .NET 6 that stops the host by default, but if the service catches and exits its loop, or the exception happened in a fire-and-forget task, the process continues without the worker. Another possibility is a hung await with no timeout.

Verify: search for the exception in logs around the time processing stopped, take a stack dump to see what the worker is awaiting, and check whether `ExecuteAsync` returned.

Fix: wrap each iteration in try/catch with logging and backoff, never let the loop exit unless cancelled, and add timeouts to external calls.

```csharp
while (!ct.IsCancellationRequested)
{
    try { await ProcessBatchAsync(ct); }
    catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
    catch (Exception ex) { log.LogError(ex, "Batch failed"); await Task.Delay(5000, ct); }
}
```

Prevent: expose a heartbeat in a health check (last successful run time) and alert on queue age.

Common wrong answers
- Relying on the process staying up as proof the worker is alive.
- Empty `catch {}` blocks.
- Using `Task.Run` fire-and-forget in the constructor.

### A nightly job runs twice because the app now has several instances. How do you ensure it runs once?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services -->
Observe: duplicate emails or double-charged records at the scheduled time, and logs show the job started on two nodes within seconds.

Hypothesise: the schedule lives in a `BackgroundService` inside the web app, so every replica runs it independently.

Verify: compare logs by instance id and timestamp, and confirm replica count changed recently.

Fix options:
1. Move the job to a single dedicated worker deployment or a Kubernetes CronJob, with `concurrencyPolicy: Forbid`.
2. Keep it in-app but acquire a distributed lock first (database row lock, Redis `SET NX PX`, or a library such as DistributedLock).
3. Use a scheduler with persistent job store and clustering (Hangfire, Quartz).

```csharp
await using var handle = await lockProvider.TryAcquireLockAsync("nightly-report");
if (handle is null) return; // another instance owns it
await RunReportAsync();
```

Whatever the choice, make the job idempotent (a processed-flag or unique key), because locks can expire during long runs.

Prevent: treat scheduled work as a separate deployable and test it with two instances.

Common wrong answers
- Using an in-process `lock` or static flag, which does not span instances.
- Choosing a leader by instance name guesswork.
- Running with a single replica forever to avoid the problem.

### During deployments some requests fail with connection errors. How do you achieve graceful shutdown?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/generic-host -->
Observe: errors spike for a few seconds during each rollout and correlate with pods being terminated. Clients see resets or 502/503 from the load balancer.

Hypothesise: the instance keeps receiving traffic after it begins shutting down (the load balancer removes endpoints asynchronously), or in-flight requests are cut off because the shutdown timeout is too short, or background work is killed mid-run.

Verify: check the shutdown timeline in logs (`Application is shutting down...`), the orchestrator's termination grace period, and the host's `ShutdownTimeout` (default 30 seconds in recent versions; 5 seconds in older ones).

Fix:
1. Handle `SIGTERM` properly (the app must be PID 1 or use an init, exec-form entrypoint).
2. Add a short pre-stop delay so the load balancer stops sending traffic before Kestrel stops accepting.
3. Raise `HostOptions.ShutdownTimeout` and the pod `terminationGracePeriodSeconds` above the longest request.
4. Honour cancellation tokens in workers.
5. Readiness probes should fail when shutting down.

```yaml
lifecycle: { preStop: { exec: { command: ["sleep", "10"] } } }
terminationGracePeriodSeconds: 45
```

Prevent: run a load test during a rolling deployment.

Common wrong answers
- Increasing replicas only.
- Using `kill -9` style stops.
- Ignoring that long-lived connections (SignalR, streaming) need draining.

### Uploading a 200 MB file fails with 413 or the app runs out of memory. How do you fix it properly?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/mvc/models/file-uploads -->
Observe: small files work, large ones return 413 Request Entity Too Large or time out, and memory spikes during uploads.

Hypothesise: several limits apply and stack up: Kestrel `MaxRequestBodySize` (about 30 MB by default), form `MultipartBodyLengthLimit` (128 MB), a reverse proxy limit (nginx `client_max_body_size` 1 MB by default), and buffering the whole file in memory via `IFormFile`.

Verify: check which layer produced the 413 (response `Server` header, proxy logs), and monitor memory during an upload.

Fix: raise limits only where needed, per endpoint, and stream instead of buffering.

```csharp
app.MapPost("/upload", [RequestSizeLimit(500_000_000)] async (HttpRequest req) =>
{
    await using var file = File.Create(Path.GetTempFileName());
    await req.Body.CopyToAsync(file);        // streaming, no full buffering
    return Results.Ok();
}).DisableAntiforgery();
```

For very large files, let clients upload directly to object storage with pre-signed URLs and send only metadata to the API. Validate type, size and content, scan for malware, and never trust the file name.

Prevent: document limits and test with realistic sizes through the production proxy.

Common wrong answers
- Setting unlimited body size globally.
- Reading into `byte[]` or `MemoryStream`.
- Raising only the app limit while the proxy still blocks.

### You must change an API in a breaking way without breaking existing mobile clients. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/web-api/ -->
Observe: old mobile app versions cannot be force-updated quickly, so the contract is effectively frozen for months.

Hypothesise: the safest course is to avoid breaking changes where possible: add fields (tolerant readers ignore them), add new endpoints, make new request fields optional with defaults.

Verify: capture real traffic by app version (user agent or version header) to learn who uses what, and add contract tests (OpenAPI diff in CI, for example with oasdiff) to flag breaking changes automatically.

Fix when a break is unavoidable: introduce versioning (URL segment `/v2/`, header, or query), using the `Asp.Versioning` packages, run v1 and v2 side by side, and map both to the same domain services through separate DTOs.

```csharp
var v2 = app.NewVersionedApi().MapGroup("/api/v{version:apiVersion}").HasApiVersion(2.0);
v2.MapGet("/orders/{id}", GetOrderV2);
```

Communicate deprecation with `Sunset` and `Deprecation` headers, track v1 usage until it drops, then remove it.

Prevent: design DTOs separate from entities, and publish an OpenAPI document as the contract.

Common wrong answers
- Changing the contract and expecting clients to update.
- Copying the whole code base per version.
- Versioning by git branch.

### SignalR notifications reach only some users after you scaled out. What is wrong?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/signalr/scale -->
Observe: with one instance everything worked, with three only users connected to the same node as the sender get messages. Some clients also fail to connect, with "No Connection with that ID" errors.

Hypothesise: connections are held in each server's memory, so a message sent through node A cannot reach clients on node B without a backplane. The negotiate step and the subsequent transport request may also hit different nodes if the load balancer lacks affinity (needed when WebSockets are not used).

Verify: log the instance id with each send and each connection; use browser dev tools to see whether transport is WebSockets or fallback and which node answers `/hub/negotiate`.

Fix: add a backplane (Redis) or use Azure SignalR Service, which also offloads connections. Enable WebSockets end to end and set `SkipNegotiation` with WebSockets-only if you control the clients, otherwise use sticky sessions.

```csharp
builder.Services.AddSignalR().AddStackExchangeRedis(redisConnectionString,
    o => o.Configuration.ChannelPrefix = RedisChannel.Literal("shop"));
```

Prevent: test with at least two instances in staging, and keep hubs stateless.

Common wrong answers
- Storing connection ids in a static dictionary and assuming it spans nodes.
- Increasing server resources.
- Polling as a replacement without understanding the cause.

### Your integration tests pass locally but fail randomly in CI. How do you stabilise them?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests -->
Observe: failures vary run to run, often show unexpected row counts or duplicate key errors, and pass on re-run.

Hypothesise: shared mutable state, such as one database used by tests running in parallel, test order dependence, time-dependent assertions, or a dependence on external services and ports.

Verify: run the failing test alone (passes), then the whole class with parallelisation disabled (stable), and inspect shared fixtures. Log the data that each test assumes.

Fix:
1. Give each test class or test its own database or schema (Testcontainers with the real engine, creating from migrations), or reset with Respawn between tests.
2. Use `WebApplicationFactory` and replace external dependencies with fakes.
3. Inject `TimeProvider` and use fixed time.
4. Generate unique data (GUIDs) rather than fixed keys.

```csharp
public class ApiFixture : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder().Build();
    public Task InitializeAsync() => _db.StartAsync();
}
```

Prevent: treat flaky tests as bugs, track them, and never rely on "retry until green".

Common wrong answers
- Adding `Thread.Sleep` calls.
- Using the EF in-memory provider and trusting it as a proxy for SQL behaviour.
- Disabling the test.

### Attackers hammer your login endpoint with credential-stuffing attempts. How do you respond?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit -->
Observe: a spike in failed logins across many accounts, from many IPs, with a low success rate and high CPU due to password hashing.

Hypothesise: automated credential stuffing, using leaked passwords from other sites. Per-IP limits alone are insufficient, since traffic is distributed.

Verify: aggregate failures by account, IP, user agent and ASN from logs; check for impossible travel or login velocity.

Fix, in layers:
1. Rate limit the endpoint by IP and by username (partitioned limiter), returning 429 with `Retry-After`.
2. Enable Identity lockout with progressive delay (`MaxFailedAccessAttempts`) and avoid exposing whether an account exists.
3. Require MFA, and check passwords against breached lists.
4. Put a WAF or bot protection (CAPTCHA, challenge) at the edge.
5. Alert and notify affected users.

```csharp
o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
    ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
    _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(1) }));
```

Prevent: monitor login metrics and rehearse the response.

Common wrong answers
- Blocking one IP only.
- Locking accounts permanently, which enables denial of service against real users.
- Different error messages for unknown user and wrong password.

### A flaky downstream payment service is making your API time out and threads pile up. How do you add resilience?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience -->
Observe: when the payment provider degrades, your own latency and error rate rise, queues grow, and unrelated endpoints slow down (cascading failure).

Hypothesise: calls have no or very long timeouts, are retried aggressively (amplifying load), and share the same limited resources as everything else.

Verify: trace the slow requests to the outbound span, check `HttpClient` timeout (default 100 seconds), retry counts, and concurrency.

Fix: apply a resilience pipeline on the typed client (.NET 8: `Microsoft.Extensions.Http.Resilience`, built on Polly v8):

```csharp
builder.Services.AddHttpClient<PaymentsClient>()
    .AddStandardResilienceHandler(o =>
    {
        o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(3);
        o.Retry.MaxRetryAttempts = 2;
        o.CircuitBreaker.BreakDuration = TimeSpan.FromSeconds(30);
    });
```

Retry only idempotent operations (use idempotency keys for charges), use jittered backoff, add a circuit breaker so you fail fast, and provide a fallback or queue the request for later. Isolate with bulkheads (concurrency limits) for this dependency.

Prevent: chaos-test the dependency and set an SLO on the outbound call.

Common wrong answers
- Unlimited retries.
- Increasing the timeout to "wait it out".
- Retrying non-idempotent POSTs without keys, which risks double charges.

### Returning EF Core entities from an endpoint throws a JSON cycle error or leaks data. What do you do?
<!-- level: basic; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/web-api/ -->
Observe: a 500 with "A possible object cycle was detected", or the response contains fields such as password hashes and internal flags that were never meant for clients.

Hypothesise: navigation properties (`Order.Customer.Orders...`) form a cycle, and the entity is serialised directly, exposing the entire persistence model.

Verify: look at the response body in a lower environment and the entity class for bidirectional navigation properties. Check the SQL for lazy-loading surprises during serialization (extra queries per row).

Fix: return DTOs (or projections) shaped for the client, and project in the query so only needed columns load.

```csharp
app.MapGet("/orders/{id}", async (int id, Db db) =>
    await db.Orders.Where(o => o.Id == id)
        .Select(o => new OrderDto(o.Id, o.Total, o.Customer.Name))
        .FirstOrDefaultAsync() is { } dto ? Results.Ok(dto) : Results.NotFound());
```

Prevent: keep entities internal to the data layer, review API responses in tests (snapshot or contract), and prevent over-posting by binding to input DTOs, not entities.

Common wrong answers
- Setting `ReferenceHandler.IgnoreCycles` globally and shipping the whole graph.
- Turning on lazy loading.
- Marking everything `[JsonIgnore]` on the entity.

### How would you upgrade a production service from .NET 6 to .NET 8 with minimal risk?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/dotnet/core/compatibility/ -->
Observe: .NET 6 is out of support, so you need to move to a supported LTS. Inventory the solution: target frameworks, NuGet packages, native dependencies, Docker base images, CI SDK versions, and use of removed or changed APIs.

Hypothesise: most breaks come from behavior changes (breaking-change documentation), package incompatibilities, and container defaults (for example .NET 8 images listen on 8080 and run as non-root).

Verify: run the .NET Upgrade Assistant or analyzers, read the breaking changes list for 7 and 8, then build with warnings as errors on a branch.

Fix and rollout plan:
1. Update `global.json`, `TargetFramework`, and packages; fix compile errors.
2. Run unit and integration tests, and contract tests against dependencies.
3. Check serialization, EF Core query translation, and date and culture handling by comparing outputs.
4. Update Dockerfile, ports and health probes.
5. Load-test and compare latency and memory.
6. Deploy as canary, watch metrics, keep rollback ready.

```xml
<TargetFramework>net8.0</TargetFramework>
```

Prevent: schedule upgrades yearly, keep dependencies current with automation, and avoid big-bang jumps.

Common wrong answers
- Updating everything at once without tests.
- Skipping the breaking-changes docs.
- Forgetting base image and CI pipeline updates.

### A developer committed a database password to the Git repository. What do you do?
<!-- level: basic; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets -->
Observe: determine exposure: was the repository public or private, how long it was in history, which branches and forks hold it, and whether logs show unusual database access.

Hypothesise: assume the secret is compromised, because bots scan public repositories within minutes and history persists after deleting the file.

Verify: search history for the value and for similar secrets (`git log -S`, or scanners like gitleaks or TruffleHog), and review database audit logs for unfamiliar connections.

Fix, in order:
1. Rotate the credential immediately and update consumers. This is the actual remedy.
2. Review access logs and revoke sessions as needed.
3. Optionally rewrite history (`git filter-repo`) and force-push, knowing that clones and caches may still hold the secret.
4. Move configuration into user-secrets locally, environment variables or a vault (Key Vault, AWS Secrets Manager) in deployed environments, and prefer managed identity so no password exists.

```bash
dotnet user-secrets init
dotnet user-secrets set "ConnectionStrings:Default" "Server=...;Password=..."
```

Prevent: pre-commit and CI secret scanning, plus least-privilege database accounts.

Common wrong answers
- Deleting the file in a new commit and calling it done.
- Rewriting history without rotating.
- Blaming the developer instead of fixing the process.

### Users can read other customers' orders by changing an ID in the URL. How do you fix and prevent it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/security/authorization/resourcebased -->
Observe: a security report shows `GET /orders/123` returns an order belonging to someone else when called by an authenticated user. This is an insecure direct object reference (broken object-level authorization), the top item in the OWASP API Top 10.

Hypothesise: the endpoint requires authentication but never checks that the order belongs to the caller.

Verify: write a test that logs in as user A and requests user B's order, and review all endpoints that accept identifiers (including nested resources and bulk endpoints), plus responses of search and export features.

Fix: enforce ownership on every access path. Either filter queries by owner, or use resource-based authorization.

```csharp
app.MapGet("/orders/{id:int}", async (int id, ClaimsPrincipal user, Db db) =>
{
    var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
    var order = await db.Orders.SingleOrDefaultAsync(o => o.Id == id && o.CustomerId == uid);
    return order is null ? Results.NotFound() : Results.Ok(order);
}).RequireAuthorization();
```

Returning 404 rather than 403 avoids confirming that the record exists. Using GUIDs instead of sequential ids helps, but is not a control.

Prevent: central authorization handlers, global query filters for tenants, and automated cross-user tests in CI.

Common wrong answers
- Hiding the ids behind GUIDs and calling it fixed.
- Checking only on the UI.
- Relying on `[Authorize]` alone.

### Logs from five microservices cannot be tied together when a customer reports a failed order. How do you add correlation?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/dotnet/core/diagnostics/distributed-tracing -->
Observe: each service logs independently, timestamps are unaligned, and support has only an order number and an approximate time.

Hypothesise: there is no shared trace identifier flowing across HTTP and message boundaries, and logs are unstructured text so they cannot be searched by property.

Verify: check whether outgoing calls carry a `traceparent` header and whether log entries include trace and span ids.

Fix: .NET propagates W3C trace context automatically through `Activity` in `HttpClient` and ASP.NET Core. Add OpenTelemetry instrumentation and export to a backend, include trace ids in logs, and add business identifiers as properties.

```csharp
builder.Logging.AddOpenTelemetry(o => o.IncludeScopes = true);
using (log.BeginScope(new Dictionary<string, object> { ["OrderId"] = orderId }))
    log.LogInformation("Charging {Amount}", amount);
```

For message queues, copy the trace context into message headers manually and start a new `Activity` as the consumer. Return the trace id to clients (for example in error responses via ProblemDetails) so support can search by it.

Prevent: make the telemetry setup part of the service template and test that traces cross service boundaries.

Common wrong answers
- Inventing custom correlation headers without standardising.
- Searching by timestamp ranges.
- Logging whole payloads containing personal data.

### An endpoint is fast locally but takes seconds in production for some users. How do you find out why?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/ef/core/performance/ -->
Observe: use percentile metrics and traces to see whether the slowness is tied to particular users, tenants, parameters or times. "Some users" often means data volume.

Hypothesise: queries that scale with data (missing index, unbounded result, N+1 loading per related row), serialising large payloads, or a cold dependency.

Verify: pull a slow trace and read its spans, enable EF Core query logging with parameters in a safe environment, then take the generated SQL to the database and examine the execution plan.

```csharp
options.UseSqlServer(cs)
       .LogTo(Console.WriteLine, LogLevel.Information)
       .EnableSensitiveDataLogging(); // non-production only
```

```sql
SET STATISTICS IO ON; -- then run the query and look for scans
```

Fix: add the missing index, project only the columns needed, paginate, replace per-row queries with `Include` or a single projection query, and cache stable lookups. Re-measure with production-sized data.

Prevent: seed realistic data volumes in staging, add query-count assertions in tests for critical endpoints, and set alerts on p95 latency.

Common wrong answers
- Adding caching before knowing the query is slow.
- Adding indexes to every column.
- Testing only with tiny local data.

### The team wants to stop returning raw exception details and show consistent errors with a trace id. How would you implement it?
<!-- level: basic; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling -->
Observe: clients currently see stack traces in some environments and plain 500 text in others, and every controller has its own try/catch with a different JSON shape.

Hypothesise: there is no central exception policy, and the developer exception page may be enabled outside development.

Verify: trigger a failure in staging and read the response body and headers, and inspect `Program.cs` for `UseDeveloperExceptionPage` conditions.

Fix: centralise using `IExceptionHandler` (.NET 8) with `ProblemDetails` (RFC 7807 or 9457 format), and include the trace id.

```csharp
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
app.UseExceptionHandler();

public class GlobalExceptionHandler(ILogger<GlobalExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext c, Exception ex, CancellationToken ct)
    {
        log.LogError(ex, "Unhandled");
        c.Response.StatusCode = ex is KeyNotFoundException ? 404 : 500;
        await c.Response.WriteAsJsonAsync(new ProblemDetails
        { Title = "An error occurred", Extensions = { ["traceId"] = c.TraceIdentifier } }, ct);
        return true;
    }
}
```

Map domain exceptions to proper status codes (validation 400/422, conflict 409), and keep details out of production responses.

Prevent: integration tests for error shapes, and no try/catch for control flow in handlers.

Common wrong answers
- Swallowing exceptions and returning 200.
- Exposing `ex.ToString()`.
- Catching `Exception` in every action.

### Startup of a new instance takes 40 seconds and rolling deployments become slow and flaky. How do you speed it up?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/performance/performance-best-practices -->
Observe: measure the startup timeline: container pull, runtime start, `Program.cs` work until `Application started` appears, and the first-request delay (JIT, EF model building, DI validation).

Hypothesise: heavy work in startup (migrations, cache warm-up, remote configuration, loading files), large images, JIT compile time, or readiness probes timing out before the app is ready, causing restart loops.

Verify: log timestamps around each startup step, run with `DOTNET_` event tracing or `dotnet-trace` for startup, and compare image sizes and pull times.

Fix:
1. Move migrations and warm-up out of the critical path (separate job or background warm-up).
2. Shrink images (multi-stage, runtime-only base) and use a nearby registry.
3. Use ReadyToRun or tiered compilation tuning (`PublishReadyToRun`), and Native AOT for suitable minimal APIs (.NET 8 supports many scenarios, with trimming limits).
4. Add a startup probe so Kubernetes waits instead of killing the pod.

```xml
<PublishReadyToRun>true</PublishReadyToRun>
<TieredPGO>true</TieredPGO>
```

Prevent: set a startup-time budget and track it in CI.

Common wrong answers
- Increasing probe timeouts without understanding the delay.
- Native AOT for an app using heavy reflection.
- Sleeping instead of readiness checks.

### A feature needs a long-running report that takes five minutes. How do you design the API so HTTP calls do not time out?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services -->
Observe: synchronous requests time out at proxies (often 60 seconds) and tie up server resources, and users retry, creating duplicates.

Hypothesise: the work does not belong inside a request. A request should start work and return quickly, with the result delivered later.

Verify: measure typical and worst-case durations, expected concurrency, and whether the work must survive restarts.

Fix: the asynchronous request-reply pattern.
1. `POST /reports` validates, stores a job record with status `Queued`, enqueues the work (durable queue such as Service Bus, SQS or RabbitMQ; a Channel only if loss is acceptable) and returns `202 Accepted` with a `Location` header to `/reports/{id}`.
2. A worker processes it with progress updates and idempotent steps.
3. `GET /reports/{id}` returns status and, when complete, a link to the file in blob storage.
4. Optionally notify via SignalR, webhook or email.

```csharp
app.MapPost("/reports", async (ReportRequest r, IJobQueue q) =>
{
    var id = await q.EnqueueAsync(r);
    return Results.Accepted($"/reports/{id}", new { id });
});
```

Prevent: set job timeouts and retention, and use idempotency keys for duplicates.

Common wrong answers
- Raising every timeout.
- Starting `Task.Run` in the controller and losing the work on restart.
- Polling every second without backoff.
