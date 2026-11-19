## 7. Concurrency: Threads, Processes and Clusters

### Worker threads for CPU-bound work
<!-- level: intermediate; ref: https://nodejs.org/api/worker_threads.html -->
Node runs your JavaScript on one thread, so a long synchronous computation blocks every request. The `worker_threads` module starts additional threads, each with its own V8 isolate and event loop, so heavy work runs beside the main thread instead of on it.

Workers communicate by message passing. Data you post is copied with the structured clone algorithm, unless you transfer an `ArrayBuffer`, which moves ownership with no copy. Because isolates are separate, module-level variables are not shared.

```js
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

if (isMainThread) {
  const w = new Worker(new URL(import.meta.url), { workerData: 40 });
  w.on('message', (v) => console.log('fib =', v));
  w.on('error', console.error);
} else {
  const fib = (n) => (n < 2 ? n : fib(n - 1) + fib(n - 2));
  parentPort.postMessage(fib(workerData));
}
```

Pitfalls
- Workers do not speed up I/O-bound code; async I/O already runs off-thread.
- Spawning one worker per request is costly (tens of milliseconds, several MB); use a pool.
- Forgetting an `error` handler turns a worker crash into an uncaught exception.

Interview tip: say "threads for CPU, event loop for I/O" and mention transferables.

### SharedArrayBuffer and Atomics
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics -->
A `SharedArrayBuffer` is a block of memory visible to several threads at once. Unlike a normal posted buffer it is not copied or moved, so main thread and workers read and write the same bytes. That removes copy cost for large numeric data such as image tiles, but it brings classic concurrency hazards: data races.

`Atomics` provides indivisible operations (`add`, `compareExchange`, `load`, `store`) on typed arrays backed by shared memory, plus `Atomics.wait` and `Atomics.notify` for blocking and waking threads. `Atomics.wait` is allowed in workers, and in Node's main thread too, but it freezes that thread, so avoid it on the main one.

```js
const sab = new SharedArrayBuffer(4);
const counter = new Int32Array(sab);
// hand `sab` to workers via workerData, then in each worker:
Atomics.add(counter, 0, 1);       // safe increment
console.log(Atomics.load(counter, 0));
```

Pitfalls
- `counter[0]++` is read-modify-write and loses updates across threads.
- Shared memory holds only numbers; objects still need serialization.

Interview tip: explain that `Atomics` gives atomicity and ordering guarantees, not locks; locks are built on top with `compareExchange` and `wait`.

### Worker pools
<!-- level: intermediate; ref: https://nodejs.org/api/worker_threads.html#class-worker -->
A worker pool keeps a fixed number of long-lived workers and queues tasks for them. It avoids per-task startup cost and caps CPU use at roughly the core count, so a burst of requests cannot spawn hundreds of threads.

The core idea is a queue plus a list of idle workers. When a task arrives, hand it to an idle worker, or enqueue it. When a worker replies, resolve the matching promise and give the worker the next queued task. Libraries such as Piscina implement this, including task cancellation and backpressure on queue size.

```js
// conceptual pool
const idle = [...workers];
const queue = [];
function run(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}
function pump() {
  while (idle.length && queue.length) {
    const w = idle.pop(), job = queue.shift();
    w.once('message', (r) => { idle.push(w); job.resolve(r); pump(); });
    w.once('error', job.reject);
    w.postMessage(job.task);
  }
}
```

Pitfalls
- An unbounded queue just moves overload into memory; reject when it is too long.
- A crashed worker must be replaced and its job failed, or the pool slowly dies.

Interview tip: size the pool near `os.availableParallelism()` (Node 18.14+).

### The cluster module
<!-- level: intermediate; ref: https://nodejs.org/api/cluster.html -->
`cluster` forks several full Node processes that share one listening port, letting a single machine use all CPU cores for an HTTP server. The primary process accepts or distributes connections; workers run your app code. Each worker has its own memory and event loop.

On most platforms the default scheduling is round-robin handled by the primary. Workers are independent, so one crashing does not take down the others, and the primary can fork a replacement.

```js
import cluster from 'node:cluster';
import http from 'node:http';
import { availableParallelism } from 'node:os';

if (cluster.isPrimary) {
  for (let i = 0; i < availableParallelism(); i++) cluster.fork();
  cluster.on('exit', () => cluster.fork());
} else {
  http.createServer((req, res) => res.end(`pid ${process.pid}\n`)).listen(3000);
}
```

Pitfalls
- In-process state (sessions, caches, rate-limit counters) is not shared between workers; use Redis or similar.
- In containers, one process per container scaled by the orchestrator is usually simpler than cluster.
- Respawning instantly on crash can cause a crash loop; add backoff.

Interview tip: contrast cluster (processes, isolated heaps) with worker_threads (threads, same process).

### child_process: spawn, exec, execFile and fork
<!-- level: basic; ref: https://nodejs.org/api/child_process.html -->
`child_process` runs other programs from Node. The four main functions differ in how they handle output and shells.

- `spawn(cmd, args)` streams stdout and stderr; best for long or large output.
- `exec(cmdString)` runs through a shell and buffers output up to `maxBuffer`; convenient but risky with user input.
- `execFile(file, args)` runs a file directly with no shell and buffers output.
- `fork(modulePath)` starts another Node script with a built-in IPC channel for `send` and `message`.

```js
import { spawn } from 'node:child_process';

const ls = spawn('git', ['log', '--oneline', '-n', '5']);
ls.stdout.on('data', (d) => process.stdout.write(d));
ls.on('close', (code) => console.log('exit', code));
```

Pitfalls
- `exec` with a string built from user input enables command injection; pass an argument array to `spawn` or `execFile`.
- Exceeding `maxBuffer` in `exec` kills the child and errors.
- Not draining stdout can make the child block when the pipe fills.

Interview tip: say "arguments array, no shell" when asked how to run external commands safely.

## 8. Security

### Command and injection attacks
<!-- level: intermediate; ref: https://nodejs.org/en/learn/getting-started/security-best-practices -->
Injection happens when untrusted input is interpreted as code or commands. In Node the classic forms are shell command injection, SQL/NoSQL injection, and unsafe `eval` or `new Function`. The fix is the same idea everywhere: keep data and instructions separate.

For processes, avoid shells: use `execFile` or `spawn` with an argument array so the input is one argv entry and not parsed. For databases, use parameterized queries. For MongoDB-style queries, validate types, because `{ "$ne": null }` passed as a password field is an operator, not a string.

```js
// vulnerable
exec(`convert ${req.query.file} out.png`);
// safer
execFile('convert', [String(req.query.file), 'out.png']);
```

Pitfalls
- Even without a shell, an argument starting with `-` can be read as an option; add `--` or validate against an allowlist.
- Escaping by hand is fragile; prefer structural separation.
- Path inputs need normalization and a base-directory check to stop `../` traversal.

Interview tip: define injection as "data crossing into the code channel" and give two examples.

### Prototype pollution
<!-- level: advanced; ref: https://nodejs.org/en/learn/getting-started/security-best-practices -->
Prototype pollution is an attack where input such as `{"__proto__": {"isAdmin": true}}` is merged into an object by a vulnerable recursive merge, adding properties to `Object.prototype`. Every object then appears to have them, which can bypass authorization checks or cause crashes and even code execution via gadget code.

Typical culprits are deep-merge, `set(obj, path, value)`, and query-string parsers that accept nested keys.

```js
function merge(a, b) {
  for (const k of Object.keys(b)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    a[k] = typeof b[k] === 'object' && b[k] !== null
      ? merge(a[k] ?? {}, b[k]) : b[k];
  }
  return a;
}
```

Defences: reject dangerous keys, create lookup maps with `Object.create(null)` or `Map`, validate input with a schema, freeze prototypes with `Object.freeze(Object.prototype)` in hardened apps, and run Node with `--disable-proto=delete`.

Pitfalls
- `JSON.parse` creates an own property named `__proto__`; the danger comes from the later merge.
- Keeping dependencies patched matters, as most real cases are in libraries.

Interview tip: explain the mechanism (prototype chain lookup) before the fix.

### Dependency and supply-chain security
<!-- level: intermediate; ref: https://docs.npmjs.com/cli/v10/commands/npm-audit -->
Most of the code in a Node app is third-party, so dependencies are the largest attack surface. Threats include known vulnerabilities, typosquatted names, hijacked maintainer accounts, and malicious install scripts that run at `npm install`.

Practical controls: commit the lockfile and install with `npm ci` in CI so versions are exact; run `npm audit` and automated update tools; review new dependencies for maintenance and size; use `npm install --ignore-scripts` where install scripts are unnecessary; pin CI to a private registry or proxy; and prefer packages published with provenance.

```bash
npm ci --ignore-scripts
npm audit --omit=dev --audit-level=high
npm ls some-package   # why is this here?
```

Pitfalls
- `npm audit` flags many unreachable paths; triage by whether the vulnerable code is actually used.
- Caret ranges plus no lockfile means a malicious patch release can reach production.
- Disabling scripts breaks packages that need native builds; allow them selectively.

Interview tip: mention lockfile discipline, `npm ci`, and least trust for install scripts.

### The permission model
<!-- level: advanced; ref: https://nodejs.org/api/permissions.html -->
The permission model (Node 20+, flag `--experimental-permission`; the flag became `--permission` in Node 22/23.5, check your version) lets a process run with restricted access to the file system, child processes, worker threads, and native addons. Once enabled, anything not explicitly allowed throws `ERR_ACCESS_DENIED`.

It limits the damage if a dependency is compromised, because that code cannot read arbitrary files or spawn shells unless you granted it.

```bash
node --permission \
  --allow-fs-read=/app --allow-fs-write=/app/tmp \
  server.js
```

Pitfalls
- It is a safety net inside the process, not a sandbox against native-code or kernel exploits; keep container and OS isolation.
- Network access restrictions were not covered in early versions; check the docs for your release.
- Libraries that read config from the home directory will fail until granted.

Interview tip: frame it as least privilege for the process, complementing, not replacing, containers.

### Timing-safe comparison and secrets
<!-- level: intermediate; ref: https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b -->
Comparing a secret (API token, HMAC signature) with `===` returns early at the first differing character. Over many requests, response timing can leak how many leading characters were right. `crypto.timingSafeEqual` compares in constant time for equal-length buffers.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(body, sigHex, secret) {
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sigHex, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

It throws if lengths differ, so check length first (length is generally not secret). Store secrets in environment variables or a secrets manager, never in the repository, and avoid printing them in logs. Hash passwords with a slow algorithm such as `crypto.scrypt` or Argon2, never plain SHA.

Pitfalls
- Hashing both sides first then comparing is another valid way to get equal length.
- Logging request headers can leak tokens.

Interview tip: be ready to explain why `===` on secrets is a side channel.

### ReDoS and input limits
<!-- level: advanced; ref: https://nodejs.org/en/learn/getting-started/security-best-practices -->
Regular Expression Denial of Service occurs when a regex with nested or overlapping quantifiers, such as `/(a+)+$/`, takes exponential time on crafted input. Because the regex engine runs on the main thread, one request can freeze the whole server.

```js
const bad = /^(\w+\s?)+$/;
console.time('x');
bad.test('word '.repeat(30) + '!');   // seconds or worse
console.timeEnd('x');
```

Mitigations: cap input length before matching, avoid ambiguous nested quantifiers, use linear-time engines such as RE2 (`re2` package) for user-supplied patterns, and prefer string methods or parsers for structured input. Apply similar thinking to other unbounded input: set body-size limits, header limits, and request timeouts (`server.headersTimeout`, `server.requestTimeout`).

Pitfalls
- Email and URL validation regexes copied from the web are frequent offenders.
- Testing with short inputs hides the problem.

Interview tip: link it to the single-threaded event loop; a slow regex is a CPU block like any other.

## 9. Performance and Profiling

### Profiling CPU with the V8 profiler
<!-- level: intermediate; ref: https://nodejs.org/en/learn/diagnostics/poor-performance/ -->
When a Node service is slow under load and CPU is high, a CPU profile shows which functions consume time. Do not guess; measure.

Options: run with `node --cpu-prof app.js` to write a `.cpuprofile` file on exit, or start with `--inspect` and attach Chrome DevTools to record. Open the profile in DevTools (Performance or Profiler) and look at the flame chart or bottom-up view for functions with high self time.

```bash
node --cpu-prof --cpu-prof-dir=./prof server.js
# send load, stop the process, then open ./prof/*.cpuprofile in DevTools
```

For production, `--cpu-prof` has low overhead compared with instrumenting every call. `node --prof` produces V8 tick logs processed with `node --prof-process`.

Pitfalls
- Profiling a dev build or idle server shows nothing useful; reproduce realistic load.
- Self time vs total time: a parent with large total but tiny self time is not the culprit.
- Profiles of minified or transpiled code need source maps for readable names.

Interview tip: describe the loop: measure, find hot path, change one thing, re-measure.

### Measuring event loop delay
<!-- level: intermediate; ref: https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions -->
Event loop delay is how late timers fire compared with when they were scheduled. It is the best single health metric for a Node service: if it climbs, something is blocking the thread.

`perf_hooks.monitorEventLoopDelay()` returns a histogram sampled at a resolution you choose, with percentile access. Nanosecond values are reported.

```js
import { monitorEventLoopDelay } from 'node:perf_hooks';

const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
setInterval(() => {
  console.log({
    p50: h.percentile(50) / 1e6,
    p99: h.percentile(99) / 1e6,
    max: h.max / 1e6,
  });
  h.reset();
}, 10_000).unref();
```

Export p99 and max to your metrics system and alert when p99 exceeds your latency budget. `performance.eventLoopUtilization()` adds a utilization ratio.

Pitfalls
- Averages hide spikes; track high percentiles.
- A delay spike with low CPU often means a synchronous call blocking on I/O (such as `readFileSync`).

Interview tip: say you would add this metric before optimizing anything.

