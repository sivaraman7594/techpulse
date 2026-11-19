### The page freezes for two seconds when a user imports a 50,000-row CSV in the browser. How would you fix it?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers -->
Observe: the UI stops responding, and the Performance panel shows one long task on the main thread, probably a parse loop plus DOM updates.

Hypothesise: synchronous CPU work and rendering share the main thread, so no input or paint can happen until the task ends.

Verify: record a profile; find the long task and its dominant functions. Check whether the cost is parsing or DOM insertion.

Fix: move parsing to a Web Worker and post back results, transferring typed arrays when possible. If a worker is overkill, split the loop into chunks and yield between them with `setTimeout`, `scheduler.postTask` where available, or `requestIdleCallback`. For rendering, virtualize the table so only visible rows exist in the DOM.

```js
const worker = new Worker('parse.js');
worker.postMessage(file);
worker.onmessage = (e) => render(e.data);
```

Prevent: add a performance budget or a test on long-task duration, and show progress feedback.

Common wrong answers: "wrap it in a Promise or `async` function" (still runs on the same thread), or "use `setTimeout(fn, 0)` once" (the whole loop still runs in one block).

### A single-page app gets slower the longer users keep it open. How would you find and fix the leak?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/removeEventListener -->
Observe: memory in the browser task manager climbs with navigation and never drops, even after forcing garbage collection.

Hypothesise: things stay reachable after views are gone: event listeners on `window` or `document`, intervals, detached DOM nodes held in variables, or growing caches.

Verify: in DevTools Memory, take a heap snapshot, navigate through a view several times, take another, and use the comparison view. Search for "Detached" nodes and check retainers. Check the Performance monitor for rising listener and node counts.

Fix: pair every `addEventListener`, `setInterval`, or subscription with cleanup when the view is destroyed. `AbortController` makes this tidy.

```js
const ac = new AbortController();
window.addEventListener('resize', onResize, { signal: ac.signal });
// on teardown
ac.abort();
```

Replace unbounded `Map` caches with size-limited ones or `WeakMap`.

Prevent: add an automated check that navigates repeatedly and asserts a stable heap, and lint for listeners without cleanup.

Common wrong answer: "JavaScript has garbage collection, so leaks cannot happen."

### A callback passed to a method suddenly logs `undefined` for `this.name`. What happened and how do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this -->
Observe: `button.addEventListener('click', user.greet)` prints `undefined` (or throws in strict mode/classes), while `user.greet()` works.

Hypothesise: `this` depends on how a function is called, not where it was defined. Passing `user.greet` detaches it from `user`; the event system calls it with `this` set to the element, or `undefined`.

Verify: log `this` inside the method. Try `const f = user.greet; f()` to reproduce.

Fix, in order of preference:
1. Wrap in an arrow: `() => user.greet()`.
2. Bind once: `user.greet = user.greet.bind(user)`.
3. Define the method as an arrow class field so it captures `this` lexically.

```js
class User {
  name = 'Asha';
  greet = () => console.log(this.name);
}
```

Prevent: be wary of passing methods as callbacks; TypeScript's `noImplicitThis` and the ESLint `unbound-method` rule catch it.

Common wrong answers: "arrow functions fix everything" (they break prototype sharing and cannot be used as constructors), or using `self = this` hacks in new code.

### A loop schedules ten timeouts that all print 10. Why, and how do you correct it?
<!-- level: basic; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures#creating_closures_in_loops_a_common_mistake -->
Observe: `for (var i = 0; i < 10; i++) setTimeout(() => console.log(i), 0)` prints ten 10s.

Hypothesise: `var` is function-scoped, so there is one `i` shared by all closures. The timeouts run after the loop finished, when `i` is 10.

Verify: change `var` to `let` and rerun; the output becomes 0 to 9, because `let` creates a fresh binding per iteration.

Fix: use `let`, or wrap the body in a function that takes `i` as an argument (the old IIFE pattern), or pass it as an argument to `setTimeout`.

```js
for (let i = 0; i < 10; i++) setTimeout(() => console.log(i), 0);
// or
for (var j = 0; j < 10; j++) setTimeout(console.log, 0, j);
```

Prevent: lint with `no-var` and `prefer-const`.

Common wrong answers: "setTimeout is asynchronous so values change" (true but not the cause; a captured shared variable is), or "increase the delay".

### An autocomplete shows results for an older query after the user has typed more. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/API/AbortController -->
Observe: typing "react" shows results for "rea". Network tab shows responses returning out of order.

Hypothesise: this is a race condition. Requests are independent; a slower early response arrives after a faster later one and overwrites state.

Verify: log request IDs and arrival order, or throttle the network and type quickly.

Fix: cancel the previous request when a new one starts, and ignore stale responses defensively.

```js
let controller;
async function search(q) {
  controller?.abort();
  controller = new AbortController();
  try {
    const r = await fetch(`/api?q=${encodeURIComponent(q)}`, { signal: controller.signal });
    render(await r.json());
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }
}
```

Also debounce input so fewer requests are made.

Prevent: write a test with fake delays that resolves requests in reverse order.

Common wrong answers: "just debounce" (reduces but does not remove the race), or "await each request in a queue" (adds latency for no reason).

### Production logs show "unhandled promise rejection" and the process behaves strangely. How do you track down the cause?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise#error_handling -->
Observe: warnings or crashes citing an unhandled rejection, often with an unhelpful stack.

Hypothesise: a promise rejects with no `.catch` or `await` in a `try`. Typical sources: a "fire and forget" call such as `saveAudit(x)` without handling, an `async` function passed to `forEach` or an event handler, or a `.then` chain missing a final `.catch`.

Verify: add a global hook to log the reason and promise, then search for async calls whose result is dropped.

```js
process.on('unhandledrejection', (e) => {}); // browsers: window.addEventListener('unhandledrejection', ...)
```

Use the ESLint rules `no-floating-promises` and `no-misused-promises`.

Fix: `await` and handle errors, or attach `.catch(logError)` deliberately for fire-and-forget work. Use `Promise.allSettled` for parallel work where partial failure is acceptable.

Prevent: enable the lint rules in CI and have a top-level handler that logs and alerts, not one that silently swallows.

Common wrong answer: registering a global handler that ignores everything, which hides real bugs.

### Loading a dashboard with `Promise.all` fails entirely when one widget's API is down. What do you change?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled -->
Observe: one failing request rejects the combined promise, so nothing renders.

Hypothesise: `Promise.all` rejects as soon as any input rejects and discards the other results.

Verify: reproduce by making one request fail and inspect what `all` returns.

Fix: use `Promise.allSettled`, which waits for every promise and reports `{status, value|reason}` for each. Render the widgets that succeeded and show an error state in the rest.

```js
const results = await Promise.allSettled([getSales(), getUsers(), getAlerts()]);
results.forEach((r, i) =>
  r.status === 'fulfilled' ? show(i, r.value) : showError(i, r.reason));
```

For slow widgets, add per-request timeouts via `AbortSignal.timeout(3000)`.

Prevent: decide per feature whether partial failure is acceptable, and test the degraded path.

Common wrong answers: wrapping everything in one big `try/catch` (still loses results), or awaiting requests sequentially (fixes failure isolation but triples latency).

### `JSON.stringify` drops some fields when you save a state object, and `JSON.parse` returns strings for dates. How do you handle it?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify -->
Observe: after a round-trip, `undefined`, functions, and symbols vanish, `Date` becomes an ISO string, `Map` and `Set` become `{}`, `NaN` becomes `null`, and `BigInt` throws a `TypeError`.

Hypothesise: JSON has a limited type system; `stringify` follows fixed rules, calling `toJSON` where defined.

Verify: print `JSON.stringify` output for a sample object and compare with the original.

Fix: define explicit serialization. Use the `replacer` and `reviver` parameters, or convert at the boundary into plain shapes.

```js
const json = JSON.stringify(state, (k, v) =>
  v instanceof Map ? { __t: 'Map', v: [...v] } :
  typeof v === 'bigint' ? v.toString() : v);
const back = JSON.parse(json, (k, v) =>
  v && v.__t === 'Map' ? new Map(v.v) : v);
```

For dates, store ISO strings and convert in one place. Validate parsed data with a schema.

Prevent: keep persisted state as plain data and write round-trip tests.

Common wrong answer: using `JSON.parse(JSON.stringify(x))` as a general deep clone; use `structuredClone`.

### A checkout total shows 0.30000000000000004 and the totals do not match the backend. How do you fix money math?
<!-- level: basic; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number#number_encoding -->
Observe: `0.1 + 0.2 !== 0.3`, and rounding differs across systems.

Hypothesise: JavaScript numbers are IEEE 754 binary doubles, which cannot represent most decimal fractions exactly. Accumulated errors differ from the server's decimal arithmetic.

Verify: log the raw values and compare with the backend's computation; check rounding methods used on each side.

Fix: do money arithmetic in integer minor units (paise or cents), convert only for display, and agree on one rounding rule with the backend. For currency display use `Intl.NumberFormat`. For arbitrary precision use `BigInt` for integers or a decimal library.

```js
const totalMinor = items.reduce((s, i) => s + i.priceMinor * i.qty, 0);
const label = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
  .format(totalMinor / 100);
```

Prevent: unit tests with known awkward values, and let the server be the source of truth for totals.

Common wrong answers: `toFixed(2)` everywhere (returns a string and still rounds oddly, such as `1.005.toFixed(2)` giving "1.00"), or comparing floats with `===`.

### Editing a "copy" of a settings object changes the original and the UI shows weird updates. What is going on?
<!-- level: basic; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone -->
Observe: `const draft = { ...settings }` then `draft.theme.dark = true` also changes `settings.theme.dark`.

Hypothesise: spread and `Object.assign` copy only one level; nested objects are shared references.

Verify: compare `draft.theme === settings.theme`; it is `true`.

Fix: copy the path you change, which is also what state libraries expect, or deep clone with `structuredClone` when you need a full independent copy.

```js
const next = { ...settings, theme: { ...settings.theme, dark: true } };
const copy = structuredClone(settings);
```

`structuredClone` handles dates, maps, sets, and cycles, but throws on functions and drops prototypes and class identity.

Prevent: treat state as immutable, freeze objects in development, and use change-detection friendly updates.

Common wrong answers: `JSON.parse(JSON.stringify(x))` (loses types, fails on cycles), or deep cloning on every render (wasteful).

### `[10, 9, 1].sort()` returns `[1, 10, 9]`, and sorting a prop reorders the original array. How do you fix both?
<!-- level: basic; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort -->
Observe: numbers sorted as text, and the source array changed after sorting.

Hypothesise: `sort` without a comparator converts elements to strings and compares UTF-16 code units. It also sorts in place and returns the same array.

Verify: `[10, 9, 1].sort()` and check `arr === arr.sort()`.

Fix: provide a comparator returning a negative, zero, or positive number, and sort a copy. `toSorted` (ES2023; Node 20+, modern browsers) does both in one call. Use `localeCompare` or `Intl.Collator` for text.

```js
const asc = [...nums].sort((a, b) => a - b);
const asc2 = nums.toSorted((a, b) => a - b);
names.sort(new Intl.Collator('en', { sensitivity: 'base' }).compare);
```

Prevent: lint rules requiring comparators, and avoid mutating props or state.

Common wrong answers: a comparator returning a boolean (`a > b`), which is inconsistent and gives engine-dependent results.

### An API call occasionally fails with a 503. How would you implement a retry that does not make the outage worse?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static -->
Observe: intermittent 5xx and network errors; users must refresh.

Hypothesise: transient failures that a delayed retry resolves, but instant retries from many clients would amplify load.

Verify: check which statuses are retriable (network errors, 502/503/504, 429 with `Retry-After`) and whether the request is idempotent. Never blindly retry non-idempotent POSTs without an idempotency key.

Fix: exponential backoff with jitter, a small attempt cap, and a per-attempt timeout.

```js
async function retry(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= tries - 1 || !e.retriable) throw e;
      const delay = Math.random() * Math.min(5000, 200 * 2 ** i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
```

Prevent: add a circuit breaker for sustained failure and metrics on retry counts.

Common wrong answers: a tight loop retrying immediately, retrying 4xx validation errors, or no cap.

### `fetch('/api/user/99')` returns 404 yet the `catch` block never runs. Why?
<!-- level: basic; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch#checking_that_the_fetch_was_successful -->
Observe: the code goes on to `res.json()` and fails with a confusing parse error or shows an empty page.

Hypothesise: `fetch` rejects only for network-level failures (DNS, offline, CORS block, abort). An HTTP error status still resolves successfully with `res.ok === false`.

Verify: log `res.status` and `res.ok`.

Fix: check `res.ok` and throw a meaningful error, ideally in one wrapper used throughout the app.

```js
async function getJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
```

Prevent: use the wrapper everywhere and test error responses. Be careful to read or cancel unused bodies in long-running processes.

Common wrong answer: "fetch is broken". Axios rejecting on non-2xx by default is a different design, not a bug.

### Users double-click "Pay" and get charged twice. How do you prevent it?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods/POST -->
Observe: two identical POSTs a few hundred milliseconds apart.

Hypothesise: the handler is not guarded against re-entry, and the server accepts duplicates.

Verify: check the network panel and server logs for duplicate requests with the same payload.

Fix in layers. Client: disable the button and set an in-flight flag immediately in the click handler, before any `await`. Server: require an idempotency key generated once per checkout attempt, stored with the result so a repeat returns the original response. The client guard is a courtesy; the server guard is the real protection.

```js
let busy = false;
async function pay() {
  if (busy) return;
  busy = true;
  try {
    await post('/pay', body, { 'Idempotency-Key': attemptId });
  } finally { busy = false; }
}
```

Prevent: test double-submit and network retries; add a unique constraint on the key.

Common wrong answers: only disabling the button (mobile retries and refreshes still duplicate), or debouncing (delays but still allows a duplicate).

### A page makes 20 requests one after another and takes ten seconds. How do you speed it up without overloading the server?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await -->
Observe: a waterfall in the network panel: each request starts when the previous one finishes.

Hypothesise: `await` inside a `for` loop serializes independent work.

Verify: confirm the requests do not depend on each other's results.

Fix: start them together and await the group, but cap concurrency so you do not open hundreds of connections.

```js
// all at once
const rows = await Promise.all(ids.map(getRow));

// limited concurrency
async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n]); }
  });
  await Promise.all(workers);
  return out;
}
```

Better: ask the backend for a batch endpoint.

Prevent: review loops that contain `await`; the ESLint `no-await-in-loop` rule flags them.

Common wrong answer: using `forEach(async ...)`, which does not wait for completion at all.

### A security scan flags a `merge` helper for prototype pollution. How would you confirm and fix it?
<!-- level: advanced; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Inheritance_and_the_prototype_chain -->
Observe: a recursive helper copies keys from user-supplied JSON into a config object.

Hypothesise: a payload with `__proto__` (or `constructor.prototype`) as a key causes the merge to write onto `Object.prototype`, so all objects gain attacker-chosen properties.

Verify: write a test.

```js
merge({}, JSON.parse('{"__proto__":{"admin":true}}'));
console.log({}.admin); // true means vulnerable
```

Fix: skip `__proto__`, `constructor`, and `prototype` keys, only copy own properties, or build target objects with `Object.create(null)`. Use `Map` for dynamic keys, validate input against a schema that rejects unknown keys, and update any library involved.

Prevent: keep the regression test, use `Object.hasOwn` for membership checks instead of plain property reads, and consider `Object.freeze(Object.prototype)` in hardened services.

Common wrong answers: filtering only the exact string `__proto__` while ignoring `constructor.prototype`, or sanitizing the final output rather than the merge.

### Opening the app crashes with `SyntaxError: Unexpected token u in JSON` coming from `localStorage`. How do you harden it?
<!-- level: basic; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API -->
Observe: startup error reported from a minority of users.

Hypothesise: `JSON.parse(undefined)` coerces to the string "undefined", which is invalid JSON. Other causes: the key was never set, an old version stored a different shape, storage is blocked (private mode, disabled cookies) so access throws, or quota was exceeded on write.

Verify: reproduce with a cleared and a hand-edited storage value, and in a browser with storage blocked.

Fix: wrap reads and writes in `try/catch`, treat missing or invalid values as defaults, and validate the shape and a version number.

```js
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw);
    return v && v.version === 2 ? v.data : fallback;
  } catch { return fallback; }
}
```

Prevent: version stored data and test with corrupt values.

Common wrong answer: assuming storage always exists and always holds data your own code wrote.

### After switching to ES modules, an exported constant is `undefined` at the moment it is used. What is the cause?
<!-- level: advanced; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules#circular_dependencies -->
Observe: `ReferenceError: Cannot access 'x' before initialization` or an `undefined` value only for certain entry points.

Hypothesise: a circular import. Module A imports B and B imports A; one of them runs before the other finished evaluating, so it sees an uninitialized binding.

Verify: use a tool such as `madge --circular src` or add logs at module top-level to see evaluation order. Remember that `let`/`const`/`class` exports are in the temporal dead zone until executed, while `function` declarations are hoisted.

Fix: break the cycle by moving the shared code into a third module that both import, or use dependency injection. If unavoidable, access the binding lazily inside functions, which run after both modules finish loading.

Prevent: add a circular dependency check to CI and keep module-level code free of side effects.

Common wrong answers: reordering imports until it "works" (fragile), or switching to `var`.

### A date shows as the previous day for users in the US but is fine in India. How do you debug it?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_time_string_format -->
Observe: a "2026-03-01" birth date renders as 28 February for some users.

Hypothesise: a date-only ISO string like `"2026-03-01"` is parsed as UTC midnight, while formatting methods such as `toLocaleDateString()` and `getDate()` use the local zone. A zone behind UTC rolls it back a day.

Verify: run with `TZ=America/New_York node` and compare `new Date('2026-03-01').getDate()`; the result is 28.

Fix: separate calendar dates from instants. Keep date-only values as strings or `{y, m, d}` and format without converting; or format explicitly in UTC with `timeZone: 'UTC'`.

```js
new Date('2026-03-01').toLocaleDateString('en-US', { timeZone: 'UTC' });
```

For instants (timestamps) store UTC and format in the user's zone with `Intl.DateTimeFormat`. The Temporal API (`Temporal.PlainDate`) is the proper long-term fix where available.

Prevent: run tests in several `TZ` values.

Common wrong answer: adding hours manually, which breaks around daylight saving time.

### A form total shows `NaN` or `"12"+"3"` becomes `"123"`. How do you make input handling reliable?
<!-- level: basic; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/Number -->
Observe: arithmetic on input values yields strings concatenated or `NaN`.

Hypothesise: `input.value` is always a string; `+` concatenates when either side is a string; arithmetic on non-numeric strings gives `NaN`; empty string converts to `0`, hiding a missing value.

Verify: log `typeof value`, and try `Number('')`, `Number('12px')`, `parseInt('12px')`.

Fix: convert explicitly at the boundary, validate, and handle empty input as missing.

```js
function toAmount(raw) {
  const t = String(raw).trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
```

Use `type="number"` with `valueAsNumber` as a convenience, but still validate. Use `Number.isNaN` and not `isNaN` (which coerces) or `=== NaN` (always false).

Prevent: parse once, then work with typed values, not raw strings.

Common wrong answer: relying on implicit coercion such as `*1` without validating.

### Scrolling a list with thousands of items is janky, and a scroll handler runs constantly. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API -->
Observe: dropped frames while scrolling; the profiler shows the `scroll` handler and layout recalculation dominating.

Hypothesise: scroll events fire at high frequency; the handler reads layout (`offsetTop`, `getBoundingClientRect`) then writes styles, forcing repeated synchronous layout (layout thrashing), and too many DOM nodes exist.

Verify: record a performance trace; look for purple layout blocks and "Forced reflow" warnings.

Fix: replace polling with `IntersectionObserver` for "load more" and visibility checks; batch reads before writes; throttle with `requestAnimationFrame`; use `{ passive: true }` on scroll listeners; and virtualize the list so only visible items are rendered.

```js
const io = new IntersectionObserver(([e]) => e.isIntersecting && loadMore());
io.observe(sentinel);
```

Prevent: a performance test with a large list, and CSS `content-visibility: auto` for long pages.

Common wrong answer: debouncing a scroll handler that needs to track motion continuously (throttle or observer is the right tool).

### A user navigates away mid-download and the old request still updates the screen. How do you cancel work properly?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal -->
Observe: state updates, console errors, or wasted bandwidth after the view has gone.

Hypothesise: the request and its continuation are not tied to the view's lifetime. Promises themselves cannot be cancelled.

Verify: navigate quickly with network throttling and watch for updates from stale requests.

Fix: pass an `AbortSignal` to cancellable APIs (`fetch`, event listeners, streams), abort on teardown, and treat `AbortError` as expected. Combine signals with `AbortSignal.any([...])` and apply time limits with `AbortSignal.timeout(ms)` where supported.

```js
const ac = new AbortController();
fetch(url, { signal: AbortSignal.any([ac.signal, AbortSignal.timeout(8000)]) });
onLeave(() => ac.abort());
```

For your own async functions, accept a `signal` and check `signal.throwIfAborted()` between steps.

Prevent: make cancellation part of the data-fetching helper so features get it by default.

Common wrong answer: setting a boolean "ignore" flag only, which ignores the result but leaves the work and bandwidth running.

### A memoized function's cache grows forever and eventually exhausts memory. How do you bound it?
<!-- level: advanced; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap -->
Observe: heap grows in proportion to distinct inputs; snapshots show a huge `Map` retained by a closure.

Hypothesise: a plain `Map` holds strong references to every key and value, so nothing is collectable.

Verify: log the cache size over time and take a heap snapshot to confirm the retainer.

Fix depends on the key type. If keys are objects whose lifetime should control the entry, use a `WeakMap`; entries disappear when the key is collected (note that it is not iterable and cannot be sized). For primitive keys, use a bounded cache: LRU eviction, a maximum size, and a TTL.

```js
class Lru {
  constructor(max) { this.max = max; this.m = new Map(); }
  get(k) {
    if (!this.m.has(k)) return;
    const v = this.m.get(k); this.m.delete(k); this.m.set(k, v); return v;
  }
  set(k, v) {
    this.m.delete(k); this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value);
  }
}
```

Prevent: every cache needs a bound and a metric.

Common wrong answer: using `WeakMap` with string keys (not allowed; keys must be objects).

### A unit test using timers is flaky and slow. How do you make it deterministic?
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout -->
Observe: a debounce or retry test passes locally and fails on CI, or sleeps real seconds.

Hypothesise: the test depends on wall-clock timing and scheduler jitter, with real sleeps and unawaited promises.

Verify: run it repeatedly under CPU load; log timings.

Fix: control time. Use fake timers (Jest, Vitest, or `node:test` mock timers) and advance the clock explicitly, flushing microtasks between steps. Inject the clock or `Date.now` rather than reaching for globals, and await real promises instead of sleeping.

```js
vi.useFakeTimers();
const fn = vi.fn();
const d = debounce(fn, 300);
d(); d();
vi.advanceTimersByTime(299);
expect(fn).not.toHaveBeenCalled();
vi.advanceTimersByTime(1);
expect(fn).toHaveBeenCalledTimes(1);
vi.useRealTimers();
```

Prevent: ban arbitrary `sleep` in tests, and restore real timers in `afterEach`.

Common wrong answer: increasing timeouts until it stops failing.

### A setting of `0` or an empty string keeps being replaced by a default value. What is the bug?
<!-- level: basic; kind: scenario; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing -->
Observe: `const retries = opts.retries || 3` ignores a deliberate `retries: 0`; `volume || 50` ignores `0`.

Hypothesise: `||` falls back on any falsy value: `0`, `""`, `false`, `NaN`, `null`, `undefined`.

Verify: test the expression with each falsy value.

Fix: use `??`, which falls back only for `null` and `undefined`, and `??=` for assignment. Use optional chaining `?.` for safe access. Default parameters apply only to `undefined`, not `null`, so decide how `null` should behave.

```js
const retries = opts.retries ?? 3;
config.timeout ??= 5000;
const city = user?.address?.city ?? 'Unknown';
```

Mixing `??` with `||` or `&&` needs parentheses or it is a syntax error.

Prevent: enable the ESLint rule `prefer-nullish-coalescing` (typescript-eslint) and unit test the boundary values.

Common wrong answer: checking `if (!value)` for presence when zero or empty string is valid.

