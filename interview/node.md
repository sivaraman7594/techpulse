# Node.js interview questions

### How does Node.js handle many connections with a single thread?
<!-- level: intermediate; kind: concept; ref: https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick -->
Node runs JavaScript on one thread with an **event loop** and non-blocking I/O. Network I/O is handled by the operating system's async mechanisms; some work (file system, DNS lookups, crypto, compression) runs on **libuv's thread pool** (4 threads by default). When an operation finishes, its callback is queued and the event loop runs it.

This makes Node excellent for I/O-heavy servers — but any long **CPU-bound** work on the main thread blocks every request.

### What is the difference between CommonJS and ES modules?
<!-- level: basic; kind: concept; ref: https://nodejs.org/api/esm.html -->
- **CommonJS**: `require()` / `module.exports`, loaded synchronously; the historic Node default.
- **ES modules**: `import` / `export`, the JavaScript standard; statically analysable (tree-shaking), support top-level `await`.

Node uses ESM for `.mjs` files or when `package.json` has `"type": "module"`. New projects should generally use ESM.

### What are streams and backpressure?
<!-- level: intermediate; kind: concept; ref: https://nodejs.org/en/learn/modules/backpressuring-in-streams -->
Streams process data in chunks instead of loading it all into memory — reading big files, proxying uploads, transforming data.

**Backpressure** happens when the destination is slower than the source; without handling it, buffered data grows until memory runs out. `pipeline()` handles backpressure and errors for you:

```js
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';

await pipeline(createReadStream('big.log'), createGzip(), createWriteStream('big.log.gz'));
```

### A CPU-heavy task (image resizing, a report) makes your whole Node API unresponsive. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/worker_threads.html -->
The work blocks the event loop, so no other requests are processed.
- Move it to **`worker_threads`** (a worker pool such as Piscina) so it runs on other threads.
- Or offload it to a **background job queue** (e.g. BullMQ with Redis) and return immediately with a job id.
- Run several processes (cluster mode, PM2, or multiple containers) to use all CPU cores.
- Break up long synchronous loops, and monitor event-loop lag (`perf_hooks.monitorEventLoopDelay`).

### How do you handle errors properly in async Node code?
<!-- level: intermediate; kind: scenario; ref: https://nodejs.org/api/process.html#event-unhandledrejection -->
- Use `try/catch` with `async/await`; always `await` or return promises so rejections are not lost.
- In Express 4, pass async errors to `next(err)` (Express 5 forwards rejected promises automatically) and register an error-handling middleware `(err, req, res, next)`.
- Log `unhandledRejection` and `uncaughtException`, then exit and let a process manager restart — the process state may be corrupted.
- Distinguish operational errors (timeouts, invalid input → return 4xx/5xx) from programmer bugs.
- Never send stack traces to clients in production.
