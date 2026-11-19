## 10. Memory and Diagnostics

### V8 heap, garbage collection and memory limits
<!-- level: intermediate; ref: https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib -->
V8 stores JavaScript objects on a managed heap split into generations. New objects go to the young generation, collected often and cheaply by a scavenger. Survivors are promoted to the old generation, collected by a less frequent, mostly concurrent mark-and-sweep/compact process. Buffers and other native memory live outside the heap, which is why `rss` can far exceed `heapUsed`.

The old-generation limit defaults to a value derived from available memory; you can raise it with `--max-old-space-size` (in MiB). Reaching it ends the process with "JavaScript heap out of memory".

```js
const m = process.memoryUsage();
console.log({
  rssMB: m.rss / 1e6,
  heapUsedMB: m.heapUsed / 1e6,
  externalMB: m.external / 1e6,   // Buffers, native
});
```

Pitfalls
- In containers, set the heap limit comfortably below the container memory limit, leaving room for native memory and the stack.
- Raising the limit delays a leak; it does not fix it.
- Older Node versions ignored cgroup limits when choosing defaults; check your release.

Interview tip: separate "heap" from "RSS" and explain why Buffers do not show in `heapUsed`.

### Finding memory leaks with heap snapshots
<!-- level: advanced; ref: https://nodejs.org/en/learn/diagnostics/memory/using-heap-snapshot -->
A leak is memory that stays reachable though no longer needed. Common sources: unbounded caches or maps, event listeners never removed, closures capturing large objects, timers never cleared, and global arrays that only grow.

Workflow: confirm growth over time (heapUsed rising after GC), take a heap snapshot, apply load, take another, and compare in Chrome DevTools Memory tab using the "Comparison" view to see which constructors grew. Follow the "Retainers" path to the root that holds them.

```js
import v8 from 'node:v8';
// writes a .heapsnapshot file; this pauses the process and needs memory
const file = v8.writeHeapSnapshot();
console.log('wrote', file);
```

You can also run `node --heapsnapshot-signal=SIGUSR2 app.js` and send the signal to capture on demand.

Pitfalls
- Snapshots stop the world and can roughly double memory; do not trigger them casually on a nearly full production pod.
- A growing heap right after startup is often just warm-up caches; compare two points after warm-up.
- A `MaxListenersExceededWarning` is a leak hint, not noise.

Interview tip: describe the three-snapshot technique and the retainer chain.

### AsyncLocalStorage for request context
<!-- level: intermediate; ref: https://nodejs.org/api/async_context.html#class-asynclocalstorage -->
`AsyncLocalStorage` gives you storage that follows an asynchronous call chain, like thread-local storage for async code. You set a value at the start of a request, and any code reached from it, through promises, timers, or callbacks, can read it without passing parameters.

Its best use is correlation: a request ID that every log line includes, plus tenant or user context.

```js
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const als = new AsyncLocalStorage();

function middleware(req, res, next) {
  als.run({ reqId: randomUUID() }, next);
}
export const log = (msg) => console.log(als.getStore()?.reqId, msg);
```

Pitfalls
- Context can be lost with libraries that queue callbacks in their own pools (some connection pools, event emitters invoked from a different context); test the flow.
- Do not store large mutable objects; keep it small.
- There is a modest performance cost; measure on hot paths.

Interview tip: contrast it with passing a `ctx` argument everywhere and explain the trade-off of implicit context.

### Diagnostic reports and process signals
<!-- level: intermediate; ref: https://nodejs.org/api/report.html -->
A diagnostic report is a JSON file describing the process at one moment: JavaScript and native stack traces, heap statistics, libuv handles, environment, resource usage, and loaded libraries. It is invaluable for incidents you cannot reproduce.

You can produce one on fatal errors, uncaught exceptions, a signal, or programmatically.

```bash
node --report-on-fatalerror --report-uncaught-exception \
     --report-on-signal --report-signal=SIGUSR2 app.js
# later: kill -USR2 <pid>
```

```js
process.report.writeReport('./incident.json');
```

Look at `libuv` handles to see what keeps the loop alive, and the `javascriptStack` for where it was executing.

Pitfalls
- Reports can contain environment variables, which may include secrets; restrict `report` directory permissions and exclude env with `process.report.excludeEnv` (newer versions).
- Generating a report takes time and is not free on a stalled process.

Interview tip: mention diagnostic reports for "process hangs and won't exit" or "crashes with no stack trace".

## 11. Testing

### The built-in node:test runner
<!-- level: basic; ref: https://nodejs.org/api/test.html -->
Node includes a test runner (`node:test`, stable since Node 20) so simple projects need no external framework. Tests are written with `test` or `describe/it`, assertions use `node:assert`, and you run them with `node --test`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from './add.js';

test('adds numbers', () => {
  assert.equal(add(2, 3), 5);
});

test('async works', async () => {
  const v = await Promise.resolve(1);
  assert.equal(v, 1);
});
```

`node --test` discovers `*.test.js` and similar files, runs each file in its own process in parallel, and reports with TAP or spec reporters. `--watch` reruns on change, and `--experimental-test-coverage` reports coverage (marked experimental in many versions).

Pitfalls
- `assert.equal` from the non-strict module uses `==`; import `node:assert/strict`.
- Tests that share a port or database file collide when files run in parallel.
- Forgetting to `await` or return a promise lets a failure slip past.

Interview tip: know that Jest and Vitest add richer mocking and snapshots, but the built-in runner removes a dependency.

### Mocking and fake timers
<!-- level: intermediate; ref: https://nodejs.org/api/test.html#mocking -->
Unit tests should control side effects: network calls, clocks, randomness. `node:test` offers `mock.fn`, `mock.method`, and `mock.timers` (the timers API was experimental when introduced; check your version).

```js
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

test('retries after delay', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fn = t.mock.fn();
  setTimeout(fn, 1000);
  t.mock.timers.tick(1000);
  assert.equal(fn.mock.callCount(), 1);
});

test('stubs a method', (t) => {
  const spy = t.mock.method(Math, 'random', () => 0.5);
  assert.equal(Math.random(), 0.5);
  assert.equal(spy.mock.callCount(), 1);
});
```

Mocks created through the test context `t` are restored automatically when the test finishes.

Pitfalls
- Mocking too deep ties tests to implementation; prefer injecting dependencies and substituting fakes at the boundary.
- Real timers make tests slow and flaky; faking them removes both problems.
- Mocking ES module imports needs a loader or module-mock feature; prefer dependency injection.

Interview tip: say "mock at the boundary, not the internals".

### Testing HTTP servers and integration tests
<!-- level: intermediate; ref: https://nodejs.org/api/http.html#httpcreateserveroptions-requestlistener -->
Test a server by starting it on an ephemeral port and calling it with real HTTP, which exercises routing, middleware, and serialization together.

Listening on port 0 asks the OS for a free port, avoiding conflicts between parallel test files. Export the app creation function separately from `listen`, so tests control startup and shutdown.

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

let server, base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('GET /health', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
});
```

Pitfalls
- Leaving the server open hangs the test process; close in `after`.
- Shared database state between tests causes order dependence; use per-test transactions or fresh schemas.
- Global `fetch` is available from Node 18.

Interview tip: separate fast unit tests from fewer slower integration tests, and explain port 0.

## 12. npm and Packaging

### package.json exports and entry points
<!-- level: intermediate; ref: https://nodejs.org/api/packages.html#package-entry-points -->
The `exports` field defines a package's public entry points. It replaces `main` for modern Node and, once present, blocks deep imports of any path not listed, giving you an encapsulated public API.

Conditions let you serve different files by consumer: `import` for ESM, `require` for CommonJS, `types` for TypeScript, `default` as fallback. Order matters; conditions are matched top to bottom.

```json
{
  "name": "my-lib",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./package.json": "./package.json"
  }
}
```

Pitfalls
- Shipping both ESM and CJS copies can create the "dual package hazard": two instances of the same module with separate state.
- Adding `exports` to an existing package is a breaking change for people deep-importing files.
- Put `types` first so TypeScript resolves it before `default`.

Interview tip: explain encapsulation and conditional exports in one sentence each.

### Semantic versioning and lockfiles
<!-- level: basic; ref: https://docs.npmjs.com/about-semantic-versioning -->
Semver uses `MAJOR.MINOR.PATCH`: major for breaking changes, minor for backwards-compatible features, patch for fixes. In `package.json`, `^1.4.2` accepts any 1.x.y at or above 1.4.2, `~1.4.2` accepts 1.4.x only, and an exact value pins it. For `0.x` versions, the caret is stricter: `^0.2.3` stays within 0.2.x.

A lockfile (`package-lock.json`) records the exact resolved version and integrity hash of every transitive dependency, so installs are reproducible. `npm install` can update the lockfile; `npm ci` deletes `node_modules`, installs strictly from the lockfile, and fails if it disagrees with `package.json`.

```bash
npm ci                     # CI and production builds
npm install lodash@^4      # add with range
npm outdated
npm update --save          # within ranges
```

Pitfalls
- Not committing the lockfile makes builds unreproducible.
- Libraries should not ship a lockfile expecting consumers to use it; it applies only to the root project.
- Maintainers sometimes break semver; the lockfile is your protection.

Interview tip: know the difference between `npm install` and `npm ci`.

### npm scripts and workspaces
<!-- level: intermediate; ref: https://docs.npmjs.com/cli/v10/using-npm/workspaces -->
The `scripts` field defines commands run with `npm run <name>`. `node_modules/.bin` is added to `PATH`, so locally installed tools run without global installs. Lifecycle hooks such as `pre<name>` and `post<name>` run automatically, as do `prepare` (after install and before publish) and `prepack`.

Workspaces let one repository hold many packages. Declare them in the root and npm links them into a single `node_modules`, installing shared dependencies once.

```json
{
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "node --test",
    "build": "npm run build --workspaces --if-present"
  }
}
```

```bash
npm run test -w packages/core
npm install zod -w packages/api
```

Pitfalls
- Hoisting can hide a missing dependency declaration: a package works locally because a sibling installed it, then fails when published.
- Long shell-specific script chains break on Windows; keep scripts portable or call Node scripts.
- Install-time scripts run code from dependencies; see supply-chain controls.

Interview tip: mention `--workspaces` and `-w` flags and the hoisting trap.

### Publishing a package safely
<!-- level: intermediate; ref: https://docs.npmjs.com/generating-provenance-statements -->
Publishing sends your tarball to the registry, and you should control what it contains. Use the `files` allowlist in `package.json` (or `.npmignore`) so only built output, license, and readme ship. Check with `npm pack --dry-run`, which lists the files without publishing.

Set `engines` to declare supported Node versions, include `types`, and run build and tests in `prepublishOnly`. Protect the account with two-factor authentication, and publish from CI using trusted publishing or tokens scoped to one package. Provenance (`npm publish --provenance`) links the package to its source commit and build through a signed attestation, supported from CI providers such as GitHub Actions.

```json
{
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "scripts": { "prepublishOnly": "npm test && npm run build" }
}
```

Pitfalls
- Without `files`, secrets such as `.env` files can be published; always inspect with `npm pack --dry-run`.
- A published version cannot be replaced; fixes need a new version (unpublish is heavily restricted).
- Wrong `exports` paths are a common cause of broken first releases; test by installing the tarball in a scratch project.

Interview tip: say you would run `npm pack` and install the result before every release.

## 13. Running Node in Production

### Graceful shutdown
<!-- level: intermediate; ref: https://nodejs.org/api/process.html#signal-events -->
Orchestrators stop a process by sending `SIGTERM`, then `SIGKILL` after a grace period. A graceful shutdown stops accepting new work, finishes in-flight requests, closes connections, and exits, so deploys do not drop requests.

Order matters: first make readiness checks fail so the load balancer stops sending traffic, then call `server.close()`, then close database pools and flush logs.

```js
const server = app.listen(3000);

async function shutdown(signal) {
  console.log('got', signal);
  server.close(async () => {
    await db.end();
    process.exit(0);
  });
  server.closeIdleConnections?.();   // Node 18.2+
  setTimeout(() => process.exit(1), 25_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

Pitfalls
- `server.close()` waits for keep-alive connections; close idle ones too.
- In containers running `npm start`, the signal may reach npm and not Node; start Node directly or use an init process.
- Always set a hard timeout shorter than the orchestrator's grace period.

Interview tip: describe the sequence: unready, stop accepting, drain, close resources, exit.

### Configuration and environment variables
<!-- level: basic; ref: https://nodejs.org/api/cli.html#--env-fileconfig -->
Configuration that changes between environments (ports, database URLs, secrets) belongs in environment variables, following the twelve-factor approach, not in code. Read them from `process.env`, where every value is a string or `undefined`.

Node 20.6+ can load a dotenv-style file natively with `--env-file`, and `process.loadEnvFile()` appeared in Node 21.7 / 20.12; earlier versions typically use the `dotenv` package.

```js
// config.js: validate once at startup, fail fast
const required = ['DATABASE_URL'];
for (const k of required) {
  if (!process.env[k]) throw new Error(`Missing env ${k}`);
}
export const config = {
  port: Number(process.env.PORT ?? 3000),
  debug: process.env.DEBUG === 'true',
  dbUrl: process.env.DATABASE_URL,
};
```

```bash
node --env-file=.env server.js
```

Pitfalls
- `process.env.FLAG = false` stores the string `"false"`, which is truthy; parse explicitly.
- Never commit `.env` files with secrets; commit an `.env.example`.
- Scattering `process.env` reads across the code makes configuration hard to test; centralize it.

Interview tip: mention fail-fast validation and that values arrive as strings.

