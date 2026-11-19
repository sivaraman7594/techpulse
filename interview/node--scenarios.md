### Your Node container keeps getting OOMKilled every few hours. How do you investigate?
<!-- level: advanced; kind: scenario; ref: https://nodejs.org/en/learn/diagnostics/memory -->
Observe: the orchestrator reports exit code 137 and restarts; a memory graph shows a sawtooth rising to the limit.

Hypothesise: either a leak (heap growth) or native memory growth (Buffers, native addons, many concurrent streams), or a limit mismatch where V8's heap ceiling exceeds the container's memory.

Verify: export `process.memoryUsage()` fields. If `heapUsed` rises after GC, it is a JavaScript leak; if `rss` and `external`/`arrayBuffers` rise instead, it is native or Buffer memory. For heap leaks, capture snapshots under load with `--heapsnapshot-signal=SIGUSR2` and compare them in DevTools.

Fix: remove the retainer found (unbounded cache, listener on a long-lived emitter, per-request closure stored globally). Bound caches with size and TTL. Set `--max-old-space-size` to roughly 70-75 percent of the container limit so V8 collects aggressively before the kernel kills the process.

```bash
node --max-old-space-size=1536 --heapsnapshot-signal=SIGUSR2 server.js
```

Prevent: memory alerts at 80 percent, a soak test in staging, and a restart policy as a safety net.

Common wrong answers: "just raise the container limit", or blaming the garbage collector.

### p99 latency spikes while average latency is fine and CPU is not saturated. What do you do?
<!-- level: advanced; kind: scenario; ref: https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions -->
Observe: tail latency jumps in bursts; averages hide it.

Hypothesise: the event loop is periodically blocked: a large `JSON.parse` or `stringify`, a synchronous `fs` or `crypto` call, a slow regex, or a long garbage-collection pause. Alternatively, the thread pool (default four threads) is saturated by `fs`, `dns.lookup`, `zlib`, or `crypto`.

Verify: record event-loop delay with `monitorEventLoopDelay` and compare spikes with request timestamps. Capture a `--cpu-prof` during a spike, and check libuv pool usage by looking at whether disk and DNS operations queue. Run with `--trace-gc` to see pauses.

Fix: move heavy work to worker threads, replace sync APIs with async versions, stream large payloads instead of parsing at once, cap input sizes, and raise `UV_THREADPOOL_SIZE` if the pool is the bottleneck.

Prevent: alert on event-loop delay p99, and review code for `*Sync` calls on request paths.

Common wrong answers: adding more instances without finding the blocker, or only watching mean latency.

### Calls to an upstream service fail with "ECONNRESET" or "socket hang up" at random. How do you diagnose?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/http.html#class-httpagent -->
Observe: roughly one request in a few hundred fails, often after periods of low traffic.

Hypothesise: a keep-alive race. The upstream or a load balancer closes idle connections after N seconds (say 5), while your client's agent reuses a socket it has not yet noticed is closed. Other causes: upstream crashes, proxy timeouts, or exhausting ephemeral ports.

Verify: compare the upstream's idle timeout with your agent's. Reproduce by sleeping just beyond that timeout then sending a request. Capture with `tcpdump` or enable `NODE_DEBUG=http,net`.

Fix: keep your client idle timeout below the server's, retry idempotent requests once on reset, and configure a shared agent.

```js
import https from 'node:https';
const agent = new https.Agent({ keepAlive: true, maxSockets: 100, timeout: 4000 });
```

Prevent: a documented timeout hierarchy (client < proxy < server) and metrics on reset counts.

Common wrong answers: disabling keep-alive entirely (costly under load), or blind retries of non-idempotent POSTs.

### Under load the service logs "EMFILE: too many open files". What is happening and how do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/fs.html#fspromisesopenpath-flags-mode -->
Observe: file reads and socket accepts fail at a certain concurrency level.

Hypothesise: the process hit its file-descriptor limit. Sockets also use descriptors. Likely causes: unbounded parallel `readFile` calls over a big directory, streams or handles never closed, or leaked sockets.

Verify: inspect the limit with `ulimit -n`, and count descriptors for the process with `ls /proc/<pid>/fd | wc -l` or `lsof -p`. See whether the count grows over time (leak) or spikes with load (no concurrency limit).

Fix: bound concurrency with a queue or a library like `p-limit`, always close handles (`await using` is newer; otherwise `try/finally` with `fileHandle.close()`), use `stream.pipeline` so streams are destroyed on error, and raise the limit in the service manager when justified.

```js
const handle = await fs.open(path);
try { /* read */ } finally { await handle.close(); }
```

Prevent: monitor open descriptors and test with high concurrency.

Common wrong answer: only raising `ulimit` and ignoring the leak.

### Rolling deploys cause a burst of 502 errors. How do you achieve zero-downtime restarts?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/net.html#serverclosecallback -->
Observe: errors appear for a few seconds each time pods or processes are replaced.

Hypothesise: the old process is killed while serving requests, or still receives traffic after it began shutting down, or the new one gets traffic before it is ready.

Verify: check the process's handling of `SIGTERM`, readiness probe configuration, and whether `server.close()` waits for keep-alive connections.

Fix:
1. Add a readiness endpoint that returns 200 only when dependencies are connected.
2. On `SIGTERM`, flip readiness to failing, wait a few seconds for the load balancer to stop routing, then call `server.close()` and `closeIdleConnections()`.
3. Finish in-flight work, close pools, then exit before the grace period expires.
4. Run Node as PID 1 correctly (use an init such as `tini`, or `exec` form in the Dockerfile) so signals arrive.

```js
process.on('SIGTERM', () => {
  ready = false;
  setTimeout(() => server.close(() => process.exit(0)), 5000);
});
```

Prevent: a deploy test that sends steady traffic while rolling.

Common wrong answers: `process.exit()` immediately in the handler, or using `npm start` as the container command.

### What do you do when an `uncaughtException` handler is suggested to keep the server alive?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/process.html#event-uncaughtexception -->
Observe: occasional crashes; someone proposes `process.on('uncaughtException', log)` to avoid downtime.

Hypothesise: after an uncaught exception, program state may be inconsistent: half-finished transactions, locks held, corrupted in-memory structures. Continuing is dangerous.

Verify: find the root cause from the crash stack and reproduce.

Fix: use the handler only to log, flush telemetry, perhaps finish a bounded graceful shutdown, and then exit non-zero so a supervisor restarts a clean process. Fix the underlying bug by handling errors where they occur.

```js
process.on('uncaughtException', (err, origin) => {
  logger.fatal({ err, origin });
  shutdown(1);            // stop accepting, drain briefly, then exit
});
```

For `unhandledRejection`, modern Node (15+) raises it as an uncaught exception by default, which is the right behavior. Run multiple instances so a restart does not cause an outage.

Prevent: error boundaries around request handlers, health checks, and automated restarts.

Common wrong answer: swallowing the error and continuing to serve.

### Cold start of your serverless function takes four seconds. How do you reduce it?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/cli.html#--cpu-profdir -->
Observe: the first invocation after idle is slow; later ones are fast.

Hypothesise: startup work dominates: loading many modules, large dependency trees, initializing SDK clients, reading configuration, or running migrations.

Verify: measure with `node --cpu-prof` on startup, `NODE_DEBUG=module` or `--trace-event-categories`, and inspect bundle size. Time imports individually.

Fix: bundle with esbuild to a single file and tree-shake; remove unused dependencies; lazy-load rarely used modules with dynamic `import()`; create clients outside the handler so warm invocations reuse them but initialize them cheaply; avoid heavy synchronous work at top level; use a current Node version, and consider snapshot features (`--build-snapshot`, experimental) or provisioned concurrency.

```js
let heavy;
export async function handler(e) {
  heavy ??= await import('./heavy.js');
  return heavy.run(e);
}
```

Prevent: track cold-start time in CI and set a bundle-size budget.

Common wrong answer: increasing memory only, without finding what is slow.

### Security scanning reports a critical vulnerability in a transitive dependency. What is your process?
<!-- level: intermediate; kind: scenario; ref: https://docs.npmjs.com/cli/v10/commands/npm-audit -->
Observe: `npm audit` shows a critical advisory two levels down, and a deadline.

Hypothesise: it may or may not be reachable; a fix may exist in a newer version of the direct dependency.

Verify: find the path with `npm ls <pkg>` and `npm audit`; read the advisory to learn the vulnerable function and conditions; check whether your code or the parent library calls it with untrusted input; confirm whether it is a dev-only dependency.

Fix, preferring the least invasive:
1. Update the direct dependency that pulls it in.
2. If no update exists, force a patched version with `overrides` in `package.json`, then run the tests.
3. Replace or vendor the dependency if abandoned.
4. If unreachable, document the risk assessment and suppress with an expiry date.

```json
{ "overrides": { "vulnerable-pkg": "^2.3.5" } }
```

Prevent: automated dependency update PRs, `npm ci` with a lockfile, and an SBOM for inventory.

Common wrong answers: `npm audit fix --force` blindly (can introduce breaking changes), or ignoring it because it is "transitive".

### CI builds pass but the same code fails on a teammate's machine with different dependency versions. How do you fix it?
<!-- level: basic; kind: scenario; ref: https://docs.npmjs.com/cli/v10/commands/npm-ci -->
Observe: "works on my machine"; versions in `node_modules` differ.

Hypothesise: the lockfile is missing, ignored, or being changed by `npm install` with different npm versions; or Node versions differ.

Verify: compare `npm ls --depth=0`, `node -v`, `npm -v`, and check whether `package-lock.json` is committed and modified in diffs.

Fix: commit the lockfile; use `npm ci` in CI and for fresh setups, which installs exactly what the lockfile says and errors if it disagrees; pin runtime versions through `engines` plus `.nvmrc` or Volta; set `engine-strict=true` in `.npmrc` to enforce.

```bash
npm ci
node -v   # matches .nvmrc
```

Prevent: a CI step that fails if `npm install` would change the lockfile, and a documented single package manager.

Common wrong answers: deleting `node_modules` and lockfile to "fix" resolution, which changes versions silently; or using only caret ranges without a lockfile.

### `require()` of a package fails with ERR_REQUIRE_ESM after an upgrade. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/esm.html#interoperability-with-commonjs -->
Observe: a dependency now ships ESM only, and your CommonJS app throws.

Hypothesise: the dependency moved to `"type": "module"` or exports only an `import` condition; CommonJS `require` of ESM was unsupported historically. (Newer Node versions allow `require(esm)` for synchronous graphs, from 22.12 without a flag; confirm for your runtime.)

Verify: read the package's `exports` and changelog, and check `node -v`.

Fix options:
1. Migrate your app to ESM (`"type": "module"`, add file extensions, replace `__dirname` with `import.meta.dirname` (Node 20.11+) or `fileURLToPath`).
2. Use dynamic `import()` from CommonJS, which is async.
3. Pin the last CJS version of the dependency temporarily.
4. Upgrade Node to a version supporting `require(esm)`.

```js
// CommonJS file
async function main() {
  const { default: got } = await import('got');
}
```

Prevent: plan ESM migration, and test on the Node versions you support.

Common wrong answer: switching the whole project to ESM without checking tooling such as test runners and loaders.

### Requests hang under load and logs show database timeouts, yet the database CPU is low. What is going on?
<!-- level: intermediate; kind: scenario; ref: https://node-postgres.com/apis/pool -->
Observe: latency climbs, then "timeout acquiring connection" errors, while the database is mostly idle.

Hypothesise: connection pool exhaustion in the app. Common causes: connections acquired and never released after an error path, long transactions holding connections while doing slow external calls, or a pool smaller than concurrency.

Verify: expose pool metrics (total, idle, waiting). If `waiting` grows while `idle` is zero, it is exhaustion. Search for `pool.connect()` without a `finally { client.release() }`, and look for `await fetch(...)` inside transactions.

Fix: always release in `finally`, prefer `pool.query` for single statements, keep transactions short with no network calls inside, set connection and statement timeouts, and size the pool according to database limits divided by instance count.

```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // work
  await client.query('COMMIT');
} catch (e) { await client.query('ROLLBACK'); throw e; }
finally { client.release(); }
```

Prevent: alerts on waiting count and a load test that exceeds pool size.

Common wrong answer: just increasing pool size, which can overload the database.

### How would you trace a single request across logs from many async calls without passing an ID everywhere?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/async_context.html#class-asynclocalstorage -->
Observe: logs from concurrent requests interleave; you cannot tell which lines belong together.

Hypothesise: log lines lack a correlation ID, and threading one through every function signature is impractical.

Verify: confirm incoming headers (`x-request-id`, `traceparent`) and whether downstream calls forward them.

Fix: create a request context with `AsyncLocalStorage` in middleware, read it from your logger, and forward the ID to outgoing calls.

```js
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
const als = new AsyncLocalStorage();

app.use((req, res, next) => {
  const id = req.headers['x-request-id'] ?? randomUUID();
  res.setHeader('x-request-id', id);
  als.run({ id }, next);
});

export const log = (m) => console.log(JSON.stringify({ id: als.getStore()?.id, m }));
```

Use structured JSON logs. For full distributed tracing adopt OpenTelemetry, which uses the same mechanism.

Prevent: test that context survives your database driver and queue libraries.

Common wrong answers: a module-level global "currentRequest" (breaks with concurrency), or passing `req` into every function.

### A public endpoint is vulnerable to slow clients and traffic floods. What protections do you add in Node?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/en/learn/getting-started/security-best-practices -->
Observe: connections pile up, memory and sockets rise, legitimate users time out.

Hypothesise: slowloris style attacks (open connections that send data slowly), huge bodies, and unthrottled request rates.

Verify: inspect open connection counts and request durations; simulate with a slow-client tool in staging.

Fix, in layers:
- Server timeouts: `headersTimeout`, `requestTimeout`, `keepAliveTimeout`, and `server.maxHeadersCount`.
- Body limits: reject over a maximum size (for example `express.json({ limit: '100kb' })`).
- Rate limiting per IP or token, backed by Redis if multiple instances.
- Put a reverse proxy or CDN in front to absorb floods and terminate slow connections.
- Validate input and fail early.

```js
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
```

Prevent: load tests including slow-client scenarios; alerts on connection counts.

Common wrong answer: relying on application code alone; infrastructure-level limits matter.

### How should configuration and secrets be handled so the same build runs in dev, staging, and production?
<!-- level: basic; kind: scenario; ref: https://nodejs.org/api/cli.html#--env-fileconfig -->
Observe: hard-coded URLs, a committed `.env` with keys, and "if production" branches scattered in the code.

Hypothesise: configuration is mixed with code, so builds differ by environment and secrets leak through the repository.

Verify: search history for secrets (and rotate any found), and list every `process.env` read.

Fix: build once, configure at runtime through environment variables injected by the platform; keep secrets in a manager (cloud secret store, Kubernetes secrets) and not in images; centralize and validate config at startup, failing fast on missing or malformed values.

```js
import { z } from 'zod';
const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
});
export const config = schema.parse(process.env);
```

For local development use `node --env-file=.env` (Node 20.6+) with an untracked file and a committed `.env.example`.

Prevent: secret scanning in CI and pre-commit hooks, plus rotation procedures.

Common wrong answers: committing `.env` "just for staging", or booleans compared as `process.env.FLAG === true` (values are strings).

### Integration tests fail randomly in CI with EADDRINUSE. How do you stabilize them?
<!-- level: basic; kind: scenario; ref: https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback -->
Observe: tests pass alone but fail when run in parallel or reruns.

Hypothesise: multiple test files bind the same fixed port, or a previous run left a server open.

Verify: grep for `listen(3000)`; run tests serially to see if failures vanish.

Fix: listen on port `0` so the OS assigns a free port, read it from `server.address()`, create the server per test file, and always close it in an `after` hook. Give each file its own database schema or transaction.

```js
const server = app.listen(0);
const { port } = server.address();
// ...
after(() => new Promise((r) => server.close(r)));
```

If a lingering handle keeps the runner from exiting, use `why-is-node-running` or `process.getActiveResourcesInfo()` (Node 17.3+) to see what is open.

Prevent: forbid fixed ports in test code, and run the suite with parallelism locally.

Common wrong answers: adding retries or `sleep` between tests, or running everything serially forever.

### Outbound HTTP calls intermittently fail with "getaddrinfo EAI_AGAIN" or are slow on the first request. What do you check?
<!-- level: advanced; kind: scenario; ref: https://nodejs.org/api/dns.html#dnslookuphostname-options-callback -->
Observe: DNS resolution errors or multi-second delays, more often under load or in containers.

Hypothesise: `dns.lookup` uses the libuv thread pool (four threads by default) and the system resolver. Under high volume it competes with `fs` and `crypto`, and slow or flaky resolvers (cluster DNS, missing search-domain tuning) cause timeouts or `EAI_AGAIN`.

Verify: time lookups in isolation, inspect `/etc/resolv.conf` (the `ndots` setting in Kubernetes can multiply queries), and check whether the thread pool is saturated.

Fix: reuse connections with keep-alive so lookups are rarer, cache DNS results (a caching lookup function in the agent, or a node-local DNS cache in the cluster), raise `UV_THREADPOOL_SIZE` if appropriate, use fully qualified names with a trailing dot to avoid search-domain expansion, and retry on `EAI_AGAIN` with backoff.

```js
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');   // helps when IPv6 paths time out
```

Prevent: DNS latency metrics and tests under realistic container DNS.

Common wrong answer: assuming all network I/O is non-blocking; the default lookup is not.

### One endpoint accepts a 30 MB JSON body and the whole server stalls while it is processed. What changes?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-callback -->
Observe: other requests wait whenever someone posts a large payload.

Hypothesis: `JSON.parse` and `JSON.stringify` are synchronous; a 30 MB parse blocks the event loop for tens or hundreds of milliseconds, and buffering the body uses memory.

Verify: measure event-loop delay during the upload and profile the handler.

Fix: set a body size limit appropriate to the endpoint and reject larger requests with 413; for legitimately large datasets switch format and approach: newline-delimited JSON (NDJSON) processed line by line through a stream, or multipart upload to object storage with a presigned URL so bytes never touch your server.

```js
import { pipeline } from 'node:stream/promises';
import readline from 'node:readline';
const rl = readline.createInterface({ input: req });
for await (const line of rl) await handle(JSON.parse(line));
```

Where parsing is unavoidable, do it in a worker thread.

Prevent: global default limits, plus per-route overrides documented.

Common wrong answer: raising the limit "so uploads work" without addressing blocking.

### A queue consumer processed the same message twice and customers got two emails. How do you make it safe?
<!-- level: advanced; kind: scenario; ref: https://nodejs.org/en/learn/getting-started/security-best-practices -->
Observe: duplicate side effects after a worker crash or redelivery.

Hypothesise: most brokers provide at-least-once delivery. If a worker finishes the side effect but dies before acknowledging, the message returns. Slow processing past the visibility timeout can also trigger redelivery while the first worker is still running.

Verify: look for the same message ID processed twice in logs, check ack timing versus visibility timeout.

Fix: make handlers idempotent. Record a unique key (message ID or business key) in a store with a unique constraint, in the same transaction as the side effect where possible; check before acting; use an outbox pattern for sending emails reliably; extend visibility timeouts for long jobs and acknowledge only after durable completion.

```js
const inserted = await db.query(
  'INSERT INTO processed(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id', [msg.id]);
if (inserted.rowCount === 0) return ack(msg);   // already handled
await sendEmail(msg);
ack(msg);
```

Prevent: chaos tests that kill workers mid-job, and dead-letter queues for poison messages.

Common wrong answer: promising exactly-once delivery from the broker.

### CPU is high in production, but you cannot reproduce it locally. How do you profile safely?
<!-- level: advanced; kind: scenario; ref: https://nodejs.org/en/learn/diagnostics/poor-performance/ -->
Observe: one pod at 100 percent CPU, others normal; traffic mix suspected.

Hypothesise: a specific request pattern triggers expensive code (regex backtracking, large serialization, a hot loop, or GC thrash).

Verify: take a CPU profile from the live process without restart: send a signal or open the inspector on a debug port through a secure tunnel, record 30 seconds, and open it in DevTools. Alternatively start with `--cpu-prof` on a canary instance. `--report-on-signal` adds a diagnostic report to see the current stack and handles.

Fix: optimize the hot function found (cache, batch, move to worker, change algorithm), then compare profiles before and after.

```bash
kill -USR1 <pid>          # enables the inspector on the default port
# tunnel to 127.0.0.1:9229, record in chrome://inspect
```

Never expose the inspector port publicly; it allows arbitrary code execution.

Prevent: continuous profiling tools, and load tests with production-like traffic samples.

Common wrong answer: guessing at "optimizations" without a profile.

### After upgrading Node, the process now exits on an unhandled promise rejection that was previously only a warning. How do you respond?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/cli.html#--unhandled-rejectionsmode -->
Observe: crashes with `ERR_UNHANDLED_REJECTION` after moving to Node 15 or newer.

Hypothesise: the default mode changed from `warn` to `throw`: an unhandled rejection is raised as an uncaught exception. The old behavior hid bugs.

Verify: reproduce locally and read the rejection stack; find promises that nobody awaits.

Fix: handle the rejection at its source. Add `await` or `.catch`, and review fire-and-forget code, event handlers with `async` callbacks, and `EventEmitter` listeners that return promises. Use `events.captureRejections` or wrap listeners in an error-reporting helper.

```js
emitter.on('job', (j) => {
  handle(j).catch((e) => logger.error({ e }));
});
```

As a temporary stopgap you can use `--unhandled-rejections=warn`, with a ticket to remove it. Do not set it permanently.

Prevent: enable lint rules for floating promises and run tests with the default strict mode.

Common wrong answer: leaving the global flag on `warn` forever.

### Clients see 502 errors from the load balancer, but Node logs show no errors. What is the likely cause?
<!-- level: advanced; kind: scenario; ref: https://nodejs.org/api/http.html#serverkeepalivetimeout -->
Observe: sporadic 502 or 504 at the load balancer, especially on reused connections; the app logs nothing.

Hypothesise: Node's `server.keepAliveTimeout` (default 5 seconds) is shorter than the load balancer's idle timeout (AWS ALB defaults to 60 seconds). Node closes an idle connection just as the balancer sends a request on it, producing a reset the balancer reports as 502.

Verify: compare the two timeouts; check the balancer's target connection error metrics; reproduce by sending a request just after the Node timeout.

Fix: set Node's keep-alive timeout above the balancer's idle timeout, and `headersTimeout` above `keepAliveTimeout`.

```js
server.keepAliveTimeout = 65_000;   // balancer idle timeout is 60 s
server.headersTimeout = 66_000;
```

Prevent: document timeouts across the chain, with downstream values larger than upstream ones, and alert on target-reset metrics.

Common wrong answers: adding retries on the client only, or disabling keep-alive on the balancer side.

### The process finishes its work but never exits. How do you find what is holding it open?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/process.html#processgetactiveresourcesinfo -->
Observe: a script or test run hangs after the last log line; Ctrl+C is required.

Hypothesise: something keeps the event loop alive: an open server or socket, a database pool, an active `setInterval`, a child process, or a pending timer.

Verify: print active resources.

```js
setTimeout(() => console.log(process.getActiveResourcesInfo()), 2000).unref();
```

Output such as `['TCPSocketWrap', 'Timeout']` points toward the culprit. In tests, `--test-force-exit` or tools like `why-is-node-running` help locate it. A diagnostic report on a signal lists libuv handles.

Fix: close what you open (`pool.end()`, `server.close()`, `clearInterval`), call `.unref()` on timers that should not keep the process alive, and structure shutdown into one function. Using `process.exit()` as the fix hides leaks and can truncate pending writes.

Prevent: every resource creation must have an owner and a close path.

Common wrong answer: appending `process.exit(0)` to the end of the script.

### A feature fetches a user-supplied URL (webhook, image import). How do you stop it being abused to reach internal services?
<!-- level: advanced; kind: scenario; ref: https://nodejs.org/en/learn/getting-started/security-best-practices -->
Observe: users can request `http://169.254.169.254/latest/meta-data/` (cloud metadata), `http://localhost:6379`, or internal admin URLs through your server.

Hypothesise: server-side request forgery (SSRF): your server's network position is trusted, and attacker input chooses the destination.

Verify: test with internal addresses, redirects to internal hosts, and DNS names that resolve to private IPs.

Fix, layered:
- Allow only `https` (and chosen hosts if possible); parse with `new URL`.
- Resolve the hostname yourself and reject private, loopback, link-local, and reserved ranges; connect to the vetted IP to prevent DNS rebinding between check and use.
- Disable or re-validate redirects (`redirect: 'manual'`).
- Apply timeouts and response size limits.
- Run the fetcher in an isolated network segment with egress firewall rules, and require IMDSv2 on cloud instances.

```js
const u = new URL(input);
if (u.protocol !== 'https:') throw new Error('blocked');
const { address } = await dns.promises.lookup(u.hostname);
if (isPrivateIp(address)) throw new Error('blocked');
```

Prevent: security tests with internal targets and a central, reviewed outbound-fetch helper.

Common wrong answer: blocklisting the strings "localhost" and "127.0.0.1", which attackers bypass with alternative encodings and DNS.

### Your Node service starts accepting requests before the database is ready and fails the first few. How would you structure startup?
<!-- level: basic; kind: scenario; ref: https://nodejs.org/api/net.html#serverlistenoptions-callback -->
Observe: errors in the first seconds after each deploy; readiness shows healthy too early.

Hypothesise: `listen()` is called before async initialization completes; the readiness probe checks only that the port is open.

Verify: read the boot sequence and check logs ordering.

Fix: initialize dependencies first, then listen; separate liveness (process is not wedged) from readiness (dependencies reachable); retry connections with backoff instead of crashing instantly.

```js
async function main() {
  await db.connect();           // retries with backoff inside
  await cache.connect();
  const server = app.listen(config.port);
  ready = true;
  return server;
}
main().catch((e) => { logger.fatal(e); process.exit(1); });
```

Readiness endpoint should check cheap, bounded dependency pings, not heavy queries.

Prevent: a startup test with the database delayed, and sensible probe `initialDelaySeconds` and timeouts.

Common wrong answers: `setTimeout` waits, or a readiness check that always returns 200.

### How would you decide between cluster, worker threads, and more container replicas to use all CPU cores?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/cluster.html -->
Observe: a service on a 16-core machine uses about one core; throughput is capped.

Hypothesise: a single Node process runs JavaScript on one thread, so parallelism has to come from more processes or threads.

Verify: check whether the load is I/O-bound request handling (scale by processes) or CPU-heavy tasks inside requests (use threads), and whether state is shared.

Fix:
- On Kubernetes or similar, prefer one process per container and scale replicas; it gives isolation, simple restarts, and standard metrics.
- On a single VM without an orchestrator, use `cluster` or a process manager like PM2 in cluster mode to run one worker per core.
- For CPU-heavy functions within a request, offload to a worker thread pool while the main thread keeps serving I/O.

```js
import { availableParallelism } from 'node:os';
const workers = availableParallelism();
```

Remember that in-memory state (sessions, caches, rate-limit counters) is not shared across processes; externalize it.

Prevent: load test at the intended topology and watch per-process event-loop delay.

Common wrong answer: using worker threads for ordinary I/O-bound HTTP handling.

