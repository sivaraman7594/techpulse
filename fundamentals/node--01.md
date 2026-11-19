## 1. Node.js Fundamentals

### What Node.js is
<!-- level: basic; ref: https://nodejs.org/en/learn/getting-started/introduction-to-nodejs -->
Node.js is a JavaScript runtime for running JavaScript outside the browser — servers, command-line tools, build tooling, scripts and desktop apps. It combines three main pieces:

- V8, Google's JavaScript engine, which parses, compiles and executes your code.
- libuv, a C library providing the event loop, asynchronous I/O across operating systems, timers, and a thread pool.
- Core modules (`fs`, `http`, `net`, `crypto`, `stream`, `child_process` and more) written in JavaScript and C++ that expose system capabilities to JavaScript.

Node's defining design is non-blocking I/O on a single JavaScript thread. While a database query or file read is in progress, the thread is free to serve other requests. That makes Node efficient for I/O-heavy workloads such as APIs, proxies, real-time apps and streaming, and a poor fit for long CPU-bound computation on the main thread.

Release model: even-numbered major versions become Long-Term Support (LTS) and get roughly 30 months of support; odd versions are short-lived "Current" releases. Production systems should run an Active or Maintenance LTS line.

```js
// server.mjs — a complete web server in core Node
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ path: req.url, pid: process.pid }));
});

server.listen(3000, () => console.log('Listening on http://localhost:3000'));
```

#### Interview tip
- Avoid saying "Node is single-threaded" without qualification: JavaScript runs on one thread, but libuv uses a thread pool, and you can create worker threads and processes.

### Node.js vs browser JavaScript
<!-- level: basic; ref: https://nodejs.org/en/learn/getting-started/differences-between-nodejs-and-the-browser -->
Both run the same ECMAScript language — in Chrome and Node even the same V8 engine — but the environment around the language differs.

What Node lacks: the DOM, `window`, `document`, cookies, and browser rendering. What Node adds: file system access, raw TCP/UDP sockets, processes, environment variables, native addons, and the ability to listen on ports.

Over the past several releases Node has adopted many web-standard APIs so code can be shared: `fetch`, `Request`/`Response`/`Headers`, `URL`, `AbortController`, `TextEncoder`, Web Streams, `structuredClone`, `BroadcastChannel`, `WebSocket` (client, Node 22+), Web Crypto (`crypto.subtle`), `performance` and `navigator` (partial).

Other differences:

- You control the runtime version, so you can use modern syntax without transpiling for old browsers.
- The global object is `globalThis` (also `global`), not `window`.
- Security model: browser code is sandboxed; Node code has full access to the machine with the permissions of the OS user (unless you opt into the permission model).
- Node supports both CommonJS and ES modules.

```js
// Works in Node 18+ and in browsers
const res = await fetch('https://api.github.com/repos/nodejs/node');
const { stargazers_count } = await res.json();

// Node only
import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
console.log(pkg.name, process.platform, process.version);
```

#### Pitfalls
- Universal libraries that reference `window` at import time crash in Node — guard with `typeof window !== 'undefined'` or use separate entry points.

### Running scripts, the REPL and versions
<!-- level: basic; ref: https://nodejs.org/en/learn/command-line/run-nodejs-scripts-from-the-command-line -->
Run a file with `node app.js`. Useful flags and tools for day-to-day work:

- `node` with no arguments opens the REPL — an interactive prompt for experiments; `.help` lists commands, and `_` holds the last result.
- `node --watch app.js` (stable in Node 22) restarts on file changes, replacing nodemon in many projects.
- `node --run build` (Node 22+) runs a `package.json` script faster than `npm run`, with less overhead.
- `node --env-file=.env app.js` (Node 20.6+) loads environment variables from a file.
- `node -e "code"` evaluates a snippet; `node -p` prints its result.
- `node --inspect` enables the debugger.

Manage versions per project with a version manager (nvm, fnm, Volta) and declare the expected version in `package.json` `engines` and an `.nvmrc` file, so developers and CI use the same runtime.

```bash
node --version                 # e.g. v24.x
node -p "process.versions.v8"  # engine version

node --watch --env-file=.env src/server.js

echo "22" > .nvmrc
nvm use                         # switches to Node 22
```

```json
{
  "engines": { "node": ">=22.12" },
  "scripts": { "dev": "node --watch src/server.js", "test": "node --test" }
}
```

#### Pitfalls
- Different Node versions locally and in production cause "works on my machine" bugs, especially with native addons compiled for a specific ABI.

### Globals and module-scoped variables
<!-- level: basic; ref: https://nodejs.org/api/globals.html -->
Node provides true globals available everywhere: `globalThis`, `process`, `Buffer`, `console`, timers (`setTimeout`, `setImmediate`, `queueMicrotask`), `URL`, `fetch`, `AbortController`, `structuredClone`, `crypto` (Web Crypto) and more.

Some names that look global are actually module-scoped and differ between module systems:

- In CommonJS, each module is wrapped in a function that provides `require`, `module`, `exports`, `__filename` and `__dirname`.
- In ES modules those do not exist. Use `import.meta.url` (the module's `file:` URL), and since Node 20.11/21.2, `import.meta.filename` and `import.meta.dirname`. Use `import.meta.resolve()` to resolve specifiers.

Avoid creating your own globals: they hide dependencies, collide across packages, and make testing harder.

```js
// ESM
import { join } from 'node:path';
const configPath = join(import.meta.dirname, 'config.json');

// Older ESM-compatible form
import { fileURLToPath } from 'node:url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// CommonJS
const path = require('node:path');
const templates = path.join(__dirname, 'templates');

// Globals
console.log(typeof fetch, typeof Buffer, globalThis === global); // function function true
```

#### Pitfalls
- Resolving files relative to `process.cwd()` instead of the module's directory breaks when the app is started from a different folder.

### Running TypeScript natively
<!-- level: intermediate; ref: https://nodejs.org/api/typescript.html -->
Node.js can run TypeScript files directly by stripping type annotations, without a separate build step. The feature was added behind `--experimental-strip-types` in Node 22.6, enabled by default in Node 23.6 and backported unflagged to Node 22.18, and is considered stable in recent releases.

How it works: Node replaces type syntax with whitespace (so line and column numbers stay correct and no source maps are needed) and runs the result. It does not type-check — you still run `tsc --noEmit` in your editor and CI.

Limitations:

- Only erasable syntax is supported. Enums, namespaces with runtime code, parameter properties and legacy decorators need transformation; the `--experimental-transform-types` flag handles some of them. TypeScript 5.8's `erasableSyntaxOnly` option flags unsupported constructs at compile time.
- `tsconfig.json` is ignored: `paths` aliases and target settings do not apply.
- Imports must use real file extensions (`./util.ts`), and type-only imports must use `import type`.
- Files in `node_modules` are not stripped, so publish compiled JavaScript.

```ts
// src/server.ts
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { greet } from './greet.ts';

function handle(req: IncomingMessage, res: ServerResponse): void {
  res.end(greet(req.url ?? '/'));
}
createServer(handle).listen(3000);
```

```bash
node src/server.ts             # Node 22.18+ / 23.6+
npx tsc --noEmit               # type-check separately
```

#### Interview tip
- Compare with tsx, ts-node and Bun: all run TypeScript directly, but Node's built-in support has zero dependencies and deliberately limits itself to type stripping.

## 2. Runtime Architecture and the Event Loop

### V8, libuv and non-blocking I/O
<!-- level: intermediate; ref: https://nodejs.org/en/learn/asynchronous-work/overview-of-blocking-vs-non-blocking -->
When your code calls an asynchronous API, the work is handed off rather than performed on the JavaScript thread:

- Network I/O (sockets, HTTP) uses the operating system's readiness notification mechanism — epoll on Linux, kqueue on macOS, IOCP on Windows. One thread can watch thousands of sockets because the kernel reports which are ready.
- File system operations, DNS `lookup`, some `crypto` functions (pbkdf2, scrypt, randomBytes) and `zlib` compression run on libuv's thread pool, because many operating systems lack good async file APIs.

When an operation completes, libuv queues its callback; the event loop picks it up and runs it on the main thread. Your JavaScript never runs in parallel with itself, so you do not need locks for shared variables — but any synchronous work holds up everything else.

Blocking APIs (`readFileSync`, `execSync`, `crypto.pbkdf2Sync`) do the work on the main thread and return directly. They are fine at startup or in CLI scripts, but harmful inside request handlers.

```js
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

// Startup: blocking is acceptable
const config = JSON.parse(readFileSync('./config.json', 'utf8'));

// Request path: non-blocking
export async function handler(req, res) {
  const template = await readFile('./views/home.html', 'utf8'); // thread pool
  const user = await db.findUser(req.userId);                   // socket I/O via OS
  res.end(template.replace('{{name}}', user.name));
}
```

#### Interview tip
- Distinguish where each kind of async work actually runs: kernel async I/O for network, thread pool for files and crypto, main thread for your callbacks.

### Event loop phases
<!-- level: advanced; ref: https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick -->
Node's event loop, implemented by libuv, cycles through phases. Each phase has a queue of callbacks it processes before moving on:

1. Timers: run expired `setTimeout` and `setInterval` callbacks.
2. Pending callbacks: certain system-level callbacks deferred from the previous iteration (for example some TCP errors).
3. Idle/prepare: internal.
4. Poll: retrieve new I/O events and run their callbacks. If nothing else is scheduled, the loop waits here for I/O, bounded by the nearest timer.
5. Check: run `setImmediate` callbacks.
6. Close callbacks: `'close'` events such as `socket.on('close')`.

Between each callback (since Node 11), Node drains the `process.nextTick` queue and then the promise microtask queue. The loop exits when there are no more active handles or requests (servers, timers, pending I/O).

Consequences: inside an I/O callback, `setImmediate` always runs before `setTimeout(fn, 0)`, because the check phase follows poll. From the main module, their order is not deterministic — it depends on whether the timer's 1 ms threshold elapsed before the loop started.

```js
import { readFile } from 'node:fs';

readFile(import.meta.filename, () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
  process.nextTick(() => console.log('nextTick'));
  Promise.resolve().then(() => console.log('promise'));
});
// nextTick, promise, immediate, timeout
```

#### Pitfalls
- A long-running callback in any phase delays all phases; timers fire late, and I/O waits.
- Code that relies on ordering between `setTimeout(0)` and `setImmediate` at the top level is flaky.

### process.nextTick, microtasks and setImmediate
<!-- level: advanced; ref: https://nodejs.org/en/learn/asynchronous-work/understanding-processnexttick -->
Node has three "run soon" mechanisms that are easy to confuse:

- `process.nextTick(fn)`: Node-specific queue processed immediately after the current operation, before promise microtasks and before the event loop continues. Highest priority.
- `queueMicrotask(fn)` and promise reactions: the standard microtask queue, drained right after the nextTick queue.
- `setImmediate(fn)`: a macrotask in the check phase of the next loop iteration, after I/O polling.

The names are misleading: `nextTick` fires more immediately than `setImmediate`.

`nextTick` exists mainly so APIs can stay consistently asynchronous — for example emitting an error event after the caller has had a chance to attach listeners. Because both nextTick and microtask queues are drained completely, recursively scheduling in them starves I/O. `setImmediate` is the safe choice for deferring work or splitting a long job, since I/O callbacks get a turn between iterations. In ESM, the module body itself runs as part of a promise job, so promise callbacks queued there may run before nextTick callbacks — another reason not to depend on fine ordering.

```js
import { EventEmitter } from 'node:events';

class Connection extends EventEmitter {
  constructor(url) {
    super();
    if (!url) {
      // Emit asynchronously so callers can attach 'error' listeners first
      process.nextTick(() => this.emit('error', new Error('URL required')));
      return;
    }
  }
}
new Connection('').on('error', (err) => console.error(err.message));

// Yield to I/O between chunks of CPU work
function processInChunks(items, onDone) {
  let i = 0;
  (function next() {
    const end = Math.min(i + 1000, items.length);
    for (; i < end; i++) work(items[i]);
    if (i < items.length) setImmediate(next);
    else onDone();
  })();
}
```

#### Interview tip
- Recommend `queueMicrotask` or `setImmediate` over `nextTick` for new code unless you specifically need nextTick semantics; the Node docs make the same suggestion.

### The libuv thread pool
<!-- level: advanced; ref: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop -->
libuv maintains a pool of worker threads (4 by default) for operations that cannot be done asynchronously by the OS: most `fs` operations, `dns.lookup`, `crypto.pbkdf2`/`scrypt`/`randomBytes`/`randomFill`, `zlib` compression, and some native addons. Note that `dns.resolve*` and all network sockets do not use the pool.

Because the pool is shared and small, a burst of slow tasks queues everything behind them. Classic symptom: a few concurrent password hashes with high cost factors make unrelated file reads and DNS lookups slow, which shows up as mysterious HTTP latency (since `http` requests to hostnames call `dns.lookup`).

You can resize the pool with the `UV_THREADPOOL_SIZE` environment variable (max 1024), set before the pool is first used — ideally in the environment, not in code. Raising it helps when the pool is saturated by I/O-bound waits, but adding threads beyond CPU cores does not speed up CPU-bound tasks like hashing.

```bash
UV_THREADPOOL_SIZE=16 node server.js
```

```js
import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);

// Each call occupies one pool thread for its whole duration
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

// 100 concurrent logins => 4 run at a time; file reads queue behind them
```

#### Pitfalls
- Using the synchronous variants (`scryptSync`) blocks the main thread instead — even worse.
- Caching DNS results or using IP addresses for internal services can relieve pool pressure caused by `dns.lookup`.

### Don't block the event loop
<!-- level: intermediate; ref: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop -->
Node's scalability depends on every callback finishing quickly. If one request runs 200 ms of synchronous JavaScript, every other request on that process waits 200 ms. Typical culprits:

- Synchronous APIs in request handlers (`fs.readFileSync`, `zlib.gzipSync`, `crypto.*Sync`).
- `JSON.parse` / `JSON.stringify` on multi-megabyte payloads.
- Complex regular expressions on user input (catastrophic backtracking, ReDoS).
- Sorting, filtering or transforming large arrays in memory.
- Image processing, PDF generation, compression and encryption done in JavaScript.

Fixes, in order of preference: avoid the work (pagination, caching, streaming), make it smaller (limit input sizes and set body limits), move it off the main thread (worker threads, a job queue, or a separate service), or partition it with `setImmediate` so other callbacks interleave.

Monitor event loop lag in production to detect blocking before users notice.

```js
import { monitorEventLoopDelay } from 'node:perf_hooks';

const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
setInterval(() => {
  const p99 = h.percentile(99) / 1e6;     // nanoseconds to ms
  if (p99 > 100) console.warn(`event loop p99 delay ${p99.toFixed(0)} ms`);
  h.reset();
}, 10_000).unref();

// Defensive limits on user input
app.use(express.json({ limit: '100kb' }));
```

#### Interview tip
- Explain that the problem is fairness, not just speed: Node uses cooperative scheduling, so each callback must yield quickly for the system to stay responsive.

### EventEmitter
<!-- level: intermediate; ref: https://nodejs.org/api/events.html -->
`EventEmitter` is Node's built-in observer implementation and the base of many core classes: streams, HTTP servers, sockets, child processes. You register listeners with `on`/`once`, remove them with `off`, and trigger them with `emit(name, ...args)`.

Important behaviours:

- `emit` calls listeners synchronously, in registration order. It is not an async mechanism.
- The `'error'` event is special: emitting it with no listener throws the error, which usually crashes the process. Always handle `'error'` on emitters you create or consume.
- By default a warning is printed when more than 10 listeners are added for one event — a hint that you may be leaking listeners. Adjust with `setMaxListeners` only when the count is intentional.
- `events.once(emitter, name)` returns a promise, and `events.on(emitter, name)` returns an async iterator — useful for bridging to async/await. Both accept an `AbortSignal`.

```js
import { EventEmitter, once } from 'node:events';

class JobQueue extends EventEmitter {
  #jobs = [];
  add(job) {
    this.#jobs.push(job);
    this.emit('added', job);
  }
  async run() {
    for (const job of this.#jobs) {
      try {
        await job.execute();
        this.emit('done', job.id);
      } catch (err) {
        this.emit('error', err);
      }
    }
    this.emit('drained');
  }
}

const q = new JobQueue();
q.on('error', (err) => console.error('job failed', err));
q.on('done', (id) => console.log('done', id));
q.add({ id: 1, execute: async () => {} });
q.run();
await once(q, 'drained');
```

#### Pitfalls
- Adding a listener per request to a long-lived emitter without removing it is a classic memory leak.
- Throwing inside a listener propagates to the `emit` caller, potentially breaking unrelated code paths.
