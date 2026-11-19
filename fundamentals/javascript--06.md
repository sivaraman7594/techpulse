## 12. Errors and Debugging

### Errors, throw and try/catch
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error -->
An `Error` object carries a `message`, a `name`, and a non-standard but universal `stack` trace captured when it is created. Built-in subclasses describe categories: `TypeError` (wrong type, e.g. calling undefined), `ReferenceError` (unknown variable), `RangeError` (value out of range), `SyntaxError` (invalid code or JSON), `URIError`, `EvalError` and `AggregateError` (several errors at once).

`throw` can throw any value, but always throw `Error` instances so you get a stack trace. `try/catch/finally` handles synchronous errors and errors from awaited promises. `finally` always runs, even after `return`, which makes it the place for cleanup. The catch binding is optional (ES2019): `catch { }`.

Throwing unwinds the call stack until a matching `catch` is found. If none is, the error is reported as uncaught by the host.

```js
function parseAge(input) {
  const n = Number(input);
  if (!Number.isInteger(n)) throw new TypeError(`Age must be an integer, got "${input}"`);
  if (n < 0 || n > 150) throw new RangeError(`Age out of range: ${n}`);
  return n;
}

function readSetting(key) {
  const lock = acquireLock();
  try {
    return JSON.parse(storage.get(key));
  } catch (err) {
    if (err instanceof SyntaxError) return null;  // expected: bad JSON
    throw err;                                    // unexpected: rethrow
  } finally {
    lock.release();                               // always runs
  }
}
```

#### Pitfalls
- `throw 'something failed'` loses the stack trace and breaks `err.message` checks.
- Catching everything and continuing hides programming bugs; catch only what you can handle.
- A `return` inside `finally` overrides the `try`'s return value and swallows thrown errors.

### Custom errors and error cause
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause -->
Custom error classes let callers distinguish failure kinds with `instanceof` or a `code` property instead of parsing messages. Extend `Error`, set `name`, and add structured fields such as `status` or `retryable`.

When you catch a low-level error and throw a higher-level one, keep the original with the `cause` option (ES2022). Tools and runtimes print the cause chain, so you keep context ("could not load profile") without losing the root error ("ECONNRESET").

`AggregateError` groups multiple errors (used by `Promise.any`). `Error.captureStackTrace` is a V8-specific helper; `Error.isError()` is a newer proposal for reliable cross-realm checks — check runtime support before using it.

```js
class AppError extends Error {
  constructor(message, { code, status = 500, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
  }
}
class NotFoundError extends AppError {
  constructor(resource, id) {
    super(`${resource} ${id} not found`, { code: 'NOT_FOUND', status: 404 });
  }
}

async function getProfile(id) {
  let row;
  try {
    row = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  } catch (err) {
    throw new AppError('Could not load profile', { code: 'DB_ERROR', cause: err });
  }
  if (!row) throw new NotFoundError('User', id);
  return row;
}

try {
  await getProfile(7);
} catch (err) {
  if (err instanceof NotFoundError) showNotFound();
  else console.error(err, err.cause);
}
```

#### Pitfalls
- Error properties like `message` and `stack` are non-enumerable, so `JSON.stringify(err)` gives `{}` — serialise fields explicitly for logs.

### Debugging tools
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/API/console -->
Effective debugging is about forming a hypothesis and checking it with the right tool, not scattering logs.

The `console` API offers more than `log`: `console.table` for arrays of objects, `console.dir` for an object's properties, `console.group` for nesting, `console.time`/`timeEnd` for quick timing, `console.trace` for the current stack, `console.assert` for conditions, and `console.count` for call counts. Note that logged objects in browser devtools are live references, so expanding them later shows current values; log `structuredClone(obj)` or `JSON.stringify` for a snapshot.

The `debugger` statement pauses execution when devtools are open. In the Sources panel you can set conditional breakpoints, logpoints (log without editing code), DOM-change breakpoints, XHR/fetch breakpoints, and "pause on exceptions" (including caught ones).

Source maps map bundled or minified code back to the original files so stack traces and breakpoints make sense.

```js
console.table(users.map(({ id, name, role }) => ({ id, name, role })));

console.group('checkout');
console.time('price');
const price = calculate(cart);
console.timeEnd('price');
console.assert(price >= 0, 'negative price', { cart, price });
console.groupEnd();

function suspicious(order) {
  if (order.total < 0) debugger;   // pauses only when devtools are open
  return submit(order);
}
```

#### Interview tip
- Describe a concrete workflow: reproduce reliably, narrow the scope (bisect commits or code), inspect state at the failure point, fix, then add a test that would have caught it.

## 13. Memory and Performance

### Garbage collection
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Memory_management -->
JavaScript manages memory automatically. Memory is allocated when you create objects, strings, arrays and closures, and reclaimed by a garbage collector (GC) when values become unreachable.

Reachability is the key idea: the GC starts from roots (global object, the current call stack, active handles held by the host such as listeners and timers) and marks everything reachable from them. Anything not marked is garbage, even if it references other unreachable objects — so cycles are not a problem, unlike in naive reference counting.

V8 uses a generational collector. Most objects die young, so new objects go into a small young generation that is cleaned frequently and cheaply (scavenging). Survivors are promoted to the old generation, which is collected less often with mark-sweep-compact, done mostly incrementally and concurrently to keep pauses short.

```js
function process() {
  const big = new Array(1e6).fill(0);  // allocated
  return big.length;                   // big unreachable after return
}

let user = { name: 'Asha' };
const admins = [user];
user = null;      // object still reachable via admins, not collected
admins.length = 0; // now unreachable, eligible for GC

// Cycles are fine
let a = {}; let b = { a }; a.b = b;
a = b = null;     // both collectable
```

#### Pitfalls
- You cannot force or time GC from normal code; designs relying on it (finalizers to close resources) are fragile.
- High allocation rates in hot loops cause frequent GC pauses; reuse objects or avoid temporary arrays where it matters.

### Common memory leaks
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Memory_management -->
A leak in a garbage-collected language is memory that is still reachable but no longer needed. The usual causes in browser and Node code:

1. Forgotten listeners and observers: a listener on `window` or a long-lived emitter references a component that was removed.
2. Timers and intervals that are never cleared, keeping their closures alive.
3. Unbounded caches and maps keyed by ids or requests.
4. Detached DOM nodes: elements removed from the page but still referenced from JavaScript.
5. Closures capturing large objects they no longer need.
6. Accidental globals.

Diagnose with the devtools Memory panel: take a heap snapshot, perform the action several times, take another snapshot, and compare. Look for growing object counts and follow the retainer path to see who holds them. The allocation timeline shows where allocations happen over time.

```js
// Leaky component
function mountChart(el) {
  const data = loadHugeDataset();
  const onResize = () => redraw(el, data);
  window.addEventListener('resize', onResize);
  const timer = setInterval(() => refresh(data), 10_000);

  // Fix: return a cleanup function and call it on unmount
  return () => {
    window.removeEventListener('resize', onResize);
    clearInterval(timer);
  };
}

// Bounded cache instead of an ever-growing Map
class LruCache {
  constructor(max = 500) { this.max = max; this.map = new Map(); }
  get(k) {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k);
    this.map.delete(k); this.map.set(k, v);       // mark as recent
    return v;
  }
  set(k, v) {
    this.map.delete(k); this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}
```

#### Interview tip
- Explain the three-snapshot technique and how to read retainer chains — interviewers want process, not just a list of causes.

### Measuring performance
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/API/Performance_API -->
Optimise only what you have measured. The Performance API gives high-resolution, monotonic timestamps with `performance.now()` (unaffected by system clock changes, unlike `Date.now()`), and custom marks and measures with `performance.mark()` and `performance.measure()`, which also appear in the devtools Performance panel timeline.

`PerformanceObserver` subscribes to entries: navigation and resource timing, paint, long tasks, layout shifts, and event timing. These feed the Core Web Vitals: Largest Contentful Paint (loading), Interaction to Next Paint (responsiveness), and Cumulative Layout Shift (visual stability). Field data from real users (RUM) matters more than one lab run on a fast laptop.

For CPU work, record a profile in devtools: the flame chart shows which functions consume time, and "bottom-up" view shows self time.

```js
performance.mark('search-start');
const results = runSearch(query);
performance.mark('search-end');
const m = performance.measure('search', 'search-start', 'search-end');
console.log(`search took ${m.duration.toFixed(1)} ms`);

new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.duration > 100) {
      sendMetric('slow-interaction', { name: entry.name, duration: entry.duration });
    }
  }
}).observe({ type: 'event', durationThreshold: 100, buffered: true });
```

#### Pitfalls
- Micro-benchmarks lie: the JIT may optimise away unused results, and warm-up matters. Benchmark realistic workloads.
- Measuring only on high-end hardware hides problems most users have; throttle CPU and network in devtools.

## 14. Modern JavaScript (ES2020 to ES2025)

### ES2020 to ES2022 highlights
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/at -->
These editions brought many features now considered everyday JavaScript, all supported by current browsers and Node.js 16+.

ES2020: optional chaining `?.`, nullish coalescing `??`, `BigInt`, `Promise.allSettled`, `globalThis` (one name for the global object everywhere), `String.prototype.matchAll`, dynamic `import()`, and `import.meta`.

ES2021: logical assignment `||=`, `&&=`, `??=`; numeric separators `1_000_000`; `String.prototype.replaceAll`; `Promise.any` and `AggregateError`; `WeakRef` and `FinalizationRegistry`.

ES2022: class fields, private `#members` and `#x in obj`, static blocks; top-level `await`; `.at()` for relative indexing; `Object.hasOwn`; `Error` cause; the RegExp `d` flag for match indices.

```js
const last = items.at(-1);
const total = 1_250_000;

config.timeout ??= 3000;
if (Object.hasOwn(payload, 'email')) validate(payload.email);

class Session {
  #token;
  static #count = 0;
  constructor(token) { this.#token = token; Session.#count++; }
  static isSession(x) { return #token in x; }
}

throw new Error('Payment failed', { cause: gatewayError });
```

#### Interview tip
- Be ready to say which features need transpiling for your target browsers; tools like Browserslist plus Babel or esbuild targets handle this automatically.

### ES2023 and ES2024 highlights
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy -->
ES2023 additions:

- `findLast` and `findLastIndex` search from the end.
- Change-array-by-copy: `toSorted`, `toReversed`, `toSpliced`, `with`.
- Hashbang `#!/usr/bin/env node` lines are officially allowed at the start of scripts.
- Non-registered symbols can be WeakMap keys.

ES2024 additions:

- `Object.groupBy` and `Map.groupBy` group items by a key function.
- `Promise.withResolvers()` returns `{ promise, resolve, reject }`.
- The RegExp `v` flag: set operations and string properties in character classes.
- Resizable `ArrayBuffer` and `ArrayBuffer.prototype.transfer`.
- `String.prototype.isWellFormed` and `toWellFormed` for lone surrogates.
- `Atomics.waitAsync` for non-blocking waits on shared memory.

```js
const latestError = logs.findLast((l) => l.level === 'error');

const byCategory = Object.groupBy(products, (p) => p.category);
// { shoes: [...], bags: [...] } — a null-prototype object

const byPriceBand = Map.groupBy(products, (p) => (p.price > 5000 ? 'premium' : 'standard'));

function nextMessage(socket) {
  const { promise, resolve } = Promise.withResolvers();
  socket.addEventListener('message', (e) => resolve(e.data), { once: true });
  return promise;
}

encodeURIComponent('\uD800'.toWellFormed()); // no URIError
```

#### Pitfalls
- `Object.groupBy` returns an object with a null prototype — methods like `hasOwnProperty` are not available on it; use `Object.hasOwn`.

### ES2025 highlights
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/try -->
ES2025 (finalised June 2025) is one of the larger recent editions:

- Iterator helpers: a global `Iterator` with lazy `map`, `filter`, `take`, `drop`, `flatMap` and eager `reduce`, `toArray`, `some`, `every`, `find`, `forEach`.
- Set methods: `union`, `intersection`, `difference`, `symmetricDifference`, `isSubsetOf`, `isSupersetOf`, `isDisjointFrom`.
- Import attributes and JSON modules: `import data from './x.json' with { type: 'json' }`.
- `Promise.try(fn)`: runs `fn` and wraps the outcome in a promise, catching synchronous throws.
- `RegExp.escape(str)`: escapes regex syntax characters in user input.
- RegExp pattern modifiers: `(?i:abc)` toggles flags for part of a pattern.
- Duplicate named capture groups in different alternatives.
- `Float16Array`, `Math.f16round`, and `DataView` half-float methods for graphics and ML data.

Support is broad in 2025-era browsers and Node.js 22–24, but some items (for example `RegExp.escape` and `Float16Array`) arrived later in some engines; check compatibility tables or polyfill with core-js.

```js
const tags = new Set(['js', 'ts']).union(new Set(['node']));

const result = await Promise.try(() => maybeSyncOrAsync(input))
  .catch((err) => fallback(err));

const firstTenActive = users.values().filter((u) => u.active).take(10).toArray();

const datePattern = /(?<year>\d{4})-\d{2}|\d{2}\/(?<year>\d{4})/;
'03/2025'.match(datePattern).groups.year; // '2025'

const safe = new RegExp(`^${RegExp.escape(prefix)}`);
```

#### Interview tip
- `Promise.try` matters when a function might throw synchronously before returning a promise: without it, `fn().catch(...)` misses that throw.

### structuredClone and deep copying
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone -->
`structuredClone(value)` creates a deep copy using the structured clone algorithm — the same one used by `postMessage`, IndexedDB and workers. It is available in all modern browsers, Node.js 17+ and Deno.

Compared with `JSON.parse(JSON.stringify(x))`, it preserves many more types: `Date`, `Map`, `Set`, `RegExp`, `ArrayBuffer`, typed arrays, `Blob`, `File`, `Error` objects, `undefined`, `NaN`, `Infinity`, `BigInt`, and even circular references and shared references within the graph.

What it cannot clone: functions, DOM nodes, symbols as values, getters/setters (they are evaluated), property descriptors, and class identity — a class instance comes back as a plain object with the same own data properties. Unsupported values throw a `DataCloneError`.

It also accepts a `transfer` list to move `ArrayBuffer`s instead of copying them, leaving the original detached.

```js
const original = {
  createdAt: new Date(),
  tags: new Set(['a', 'b']),
  meta: new Map([['k', 1]]),
};
original.self = original;            // circular

const copy = structuredClone(original);
copy.tags.add('c');
original.tags.has('c');              // false
copy.self === copy;                  // true: cycle preserved
copy.createdAt instanceof Date;      // true

class Point { constructor(x) { this.x = x; } norm() { return Math.abs(this.x); } }
const p = structuredClone(new Point(3));
p instanceof Point;                  // false — plain object

const buf = new ArrayBuffer(1024);
const moved = structuredClone(buf, { transfer: [buf] });
buf.byteLength;                      // 0 (detached)
```

#### Pitfalls
- Deep cloning large state on every update is expensive; immutable updates that copy only the changed path are usually better.
