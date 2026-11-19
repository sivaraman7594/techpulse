## 7. Asynchronous JavaScript

### Callbacks and why promises replaced them
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Glossary/Callback_function -->
JavaScript runs your code on a single thread, so long waits (network, timers, disk) cannot block. Instead you start an operation and provide a function to run when it finishes — a callback. The host performs the work elsewhere and later queues your callback.

Callbacks work, but at scale they cause problems:

- Nesting: each dependent step goes one level deeper ("callback hell"), making flow hard to follow.
- Error handling: every level needs its own error check, and a thrown error inside a callback cannot be caught by a `try/catch` around the original call because that stack frame is gone.
- Inversion of control: you trust the library to call your function exactly once, not zero or twice.
- Composition: running things in parallel and waiting for all of them needs manual counters.

Promises solve these by representing the eventual result as a value you can pass around, chain, and combine.

```js
// Node-style error-first callbacks
readFile('a.txt', (err, a) => {
  if (err) return done(err);
  readFile('b.txt', (err, b) => {
    if (err) return done(err);
    done(null, a + b);
  });
});

// Same logic with promises and async/await
async function combine() {
  const [a, b] = await Promise.all([readFileP('a.txt'), readFileP('b.txt')]);
  return a + b;
}
```

#### Interview tip
- Callbacks are not inherently asynchronous: `arr.map(cb)` calls its callback synchronously. Mixing sync and async invocation in one API ("releasing Zalgo") causes subtle ordering bugs.

### Promises
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises -->
A promise is an object representing the eventual outcome of an async operation. It starts pending and settles exactly once: fulfilled with a value or rejected with a reason. After settling it never changes.

`then(onFulfilled, onRejected)` registers reactions and returns a new promise resolved with whatever the handler returns. If the handler returns a promise (or any thenable), the chain waits for it — this "assimilation" is what makes flat chains possible. Throwing inside a handler rejects the returned promise. `catch(fn)` is `then(undefined, fn)`, and `finally(fn)` runs for both outcomes without changing the value.

Reactions always run asynchronously as microtasks, even if the promise is already settled, so ordering is predictable.

```js
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

fetchUser(1)
  .then((user) => fetchOrders(user.id))   // returns a promise: chain waits
  .then((orders) => orders.filter((o) => o.open))
  .catch((err) => {
    console.error('Failed', err);
    return [];                             // recover with a default
  })
  .finally(() => spinner.hide());

// ES2024: create a promise and expose its controls
const { promise, resolve, reject } = Promise.withResolvers();
socket.once('ready', resolve);
socket.once('error', reject);
await promise;
```

#### Pitfalls
- Forgetting to `return` inside a `then` handler breaks the chain — the next step receives `undefined` immediately.
- Wrapping an existing promise in `new Promise` (the "explicit construction anti-pattern") adds code and often loses rejections.
- Unhandled rejections are reported by browsers and crash Node.js processes by default (since Node 15).

### Promise combinators
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise -->
Static methods combine several promises into one:

- `Promise.all(iterable)` fulfils with an array of results in input order; rejects as soon as any rejects. The other operations keep running — `all` cannot cancel them.
- `Promise.allSettled` (ES2020) waits for every promise and returns `{ status, value | reason }` objects. It never rejects.
- `Promise.race` settles like the first promise to settle.
- `Promise.any` (ES2021) fulfils with the first success; rejects with an `AggregateError` only if all reject.
- `Promise.try(fn)` (ES2025) calls `fn` and always returns a promise, turning synchronous throws into rejections.

```js
// Parallel requests, fail fast
const [profile, settings] = await Promise.all([
  api.get('/profile'),
  api.get('/settings'),
]);

// Best-effort fan-out
const results = await Promise.allSettled(urls.map((u) => fetch(u)));
const failed = results.filter((r) => r.status === 'rejected');

// Timeout using race
function withTimeout(promise, ms) {
  let id;
  const timeout = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error('Timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

// Fastest mirror wins
const data = await Promise.any(mirrors.map((m) => fetch(m)));
```

#### Pitfalls
- Using `Promise.all` over thousands of items fires them all at once; limit concurrency with a pool.
- A timeout via `race` does not stop the slow operation; pair it with `AbortController` to actually cancel.

### async and await
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function -->
An `async` function always returns a promise: returning a value fulfils it, throwing rejects it. Inside, `await expr` pauses the function until the promise settles, then resumes with the value or throws the rejection reason. The engine suspends the function's execution context (similar to a generator) and schedules the continuation as a microtask, so the thread is free to do other work meanwhile.

This lets you write async code with ordinary control flow — loops, `if`, `try/catch/finally`.

Top-level `await` (ES2022) works directly in ES modules.

```js
async function checkout(cartId) {
  const cart = await getCart(cartId);
  if (cart.items.length === 0) throw new Error('Cart is empty');

  // Independent: start both, then await both (parallel)
  const [stock, price] = await Promise.all([
    reserveStock(cart.items),
    calculatePrice(cart),
  ]);

  // Dependent: must be sequential
  const payment = await charge(price.total);
  return { orderId: payment.orderId, stock };
}

// Sequential by accident: total time = sum of all calls
for (const id of ids) {
  await fetchItem(id);
}
// Parallel: total time = slowest call
await Promise.all(ids.map(fetchItem));
```

#### Pitfalls
- Awaiting independent calls one after another (the "async waterfall") is a common performance bug.
- Forgetting `await` makes a `try/catch` miss the rejection and lets code continue with a pending promise.
- `return await p` inside `try` is needed if you want that function's `catch` to handle the rejection.

### Error handling in async code
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/catch -->
Async errors travel through promises, not the call stack. A rejection is handled only if something attached a handler — `catch`, a second `then` argument, or a surrounding `try/catch` around an `await`. Otherwise the runtime reports an unhandled rejection: browsers fire an `unhandledrejection` event, and Node.js (15+) terminates the process by default.

Practical rules:

1. Every promise must be awaited, returned, or explicitly handled.
2. Catch errors where you can do something useful (retry, fallback, user message); let the rest propagate.
3. Add a top-level safety net that logs unexpected errors.
4. When firing work you intentionally do not await, attach a `.catch`.

```js
async function loadDashboard() {
  try {
    const [stats, alerts] = await Promise.all([getStats(), getAlerts()]);
    render(stats, alerts);
  } catch (err) {
    showError('Could not load dashboard');
    reportError(err);
  } finally {
    hideSpinner();
  }
}

// Fire-and-forget, but never silently
void sendAnalytics(event).catch((err) => console.warn('analytics', err));

window.addEventListener('unhandledrejection', (event) => {
  reportError(event.reason);
});
```

#### Pitfalls
- Errors thrown inside a `setTimeout` callback within an async function are not caught by that function's `try/catch` — they happen on a different task.
- Swallowing errors with an empty `catch {}` hides failures; at least log them.

### Cancellation with AbortController
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/API/AbortController -->
Promises have no built-in cancel. The platform-standard way to cancel async work is `AbortController`: the controller owns an `AbortSignal` which you pass to cancellable operations. Calling `controller.abort(reason)` flips `signal.aborted`, fires an `abort` event, and APIs that received the signal reject with an `AbortError` (or your reason).

`fetch`, `addEventListener` (to remove listeners), streams, and many Node.js APIs accept a `signal`. Helpers: `AbortSignal.timeout(ms)` creates a signal that aborts automatically, and `AbortSignal.any([...])` combines several signals (Chrome 116+, Node 20.3+).

To make your own functions cancellable, check `signal.aborted`, call `signal.throwIfAborted()`, or listen for `abort`.

```js
let current;

async function search(term) {
  current?.abort();                     // cancel the previous request
  current = new AbortController();
  const signal = AbortSignal.any([current.signal, AbortSignal.timeout(5000)]);

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal });
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') return null;   // superseded: ignore
    if (err.name === 'TimeoutError') throw new Error('Search timed out');
    throw err;
  }
}

// Remove several listeners at once
const ac = new AbortController();
window.addEventListener('resize', onResize, { signal: ac.signal });
window.addEventListener('scroll', onScroll, { signal: ac.signal });
ac.abort();
```

#### Pitfalls
- An AbortController is single-use; create a new one for each operation.

## 8. The Event Loop

### Call stack, heap and task queues
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop -->
A JavaScript agent has a call stack (frames for currently executing functions), a heap (where objects live), and queues of pending work. The event loop is the host's scheduling algorithm that decides what runs next.

Its core cycle in a browser:

1. Take one task (macrotask) from a task queue and run it to completion: a script, a timer callback, a user event, a message.
2. When the stack is empty, drain the microtask queue completely — promise reactions, `queueMicrotask` callbacks, MutationObserver callbacks. Microtasks queued during this step also run.
3. If it is time to render, run `requestAnimationFrame` callbacks, then style, layout and paint.
4. Repeat.

Run-to-completion means a function is never interrupted by another JavaScript callback — no data races on the main thread, but also no way for the page to respond while your code runs.

```js
console.log('script start');

setTimeout(() => console.log('timeout'), 0);

Promise.resolve()
  .then(() => console.log('micro 1'))
  .then(() => console.log('micro 2'));

queueMicrotask(() => console.log('micro 3'));

console.log('script end');
// script start, script end, micro 1, micro 3, micro 2, timeout
```

#### Interview tip
- Explain why `micro 3` prints before `micro 2`: `micro 2` is queued only when `micro 1` finishes, after `micro 3` was already queued.

### Microtasks vs macrotasks
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide -->
The distinction determines ordering and responsiveness.

Microtasks (promise callbacks, `await` continuations, `queueMicrotask`, MutationObserver) run immediately after the current task and before anything else — including rendering and other tasks. The queue is drained fully, so a microtask that keeps scheduling microtasks starves the page as surely as an infinite loop.

Tasks (also called macrotasks: `setTimeout`, `setInterval`, `MessageChannel` messages, I/O, UI events) are processed one per loop iteration, giving the browser a chance to render between them.

That gives you two tools: use a microtask to run something "as soon as possible but after the current synchronous code" (batching state updates), and use a task to yield to the browser so it can paint and handle input.

```js
// Batch many synchronous updates into one render
let scheduled = false;
const pending = [];
function update(change) {
  pending.push(change);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      applyAll(pending.splice(0));
    });
  }
}

// Starves rendering: never do this
function spin() { Promise.resolve().then(spin); }

// Yield to the browser between chunks of work
const yieldToMain = () => new Promise((r) => setTimeout(r, 0));
```

#### Pitfalls
- Assuming `setTimeout(fn, 0)` runs before pending promise callbacks — it never does.
- Node.js has additional queues (`process.nextTick`, `setImmediate`) with their own ordering; do not assume browser rules apply exactly.

### Rendering and requestAnimationFrame
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame -->
Browsers try to render at the display's refresh rate (60 Hz gives a 16.7 ms budget per frame). A rendering opportunity occurs between tasks; before painting, the browser runs `requestAnimationFrame` (rAF) callbacks, then recalculates styles, layout, and paints.

rAF is the right place for visual updates: callbacks run right before the next paint, receive a high-resolution timestamp, and are paused in background tabs to save battery. Using `setTimeout` for animation drifts out of sync with the display and causes jank.

Layout thrashing happens when you alternate DOM reads that need layout (`offsetHeight`, `getBoundingClientRect`) with writes (style changes): each read forces a synchronous layout. Batch reads first, then writes.

```js
function animate(element, durationMs) {
  const start = performance.now();
  function frame(now) {
    const progress = Math.min((now - start) / durationMs, 1);
    element.style.transform = `translateX(${progress * 300}px)`;
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Thrashing: read/write interleaved
items.forEach((el) => { el.style.height = el.offsetWidth + 'px'; });

// Better: read all, then write all
const widths = items.map((el) => el.offsetWidth);
items.forEach((el, i) => { el.style.height = widths[i] + 'px'; });
```

#### Interview tip
- Animate `transform` and `opacity` where possible; they can be handled by the compositor without layout or paint.

### Timers
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout -->
`setTimeout(fn, ms)` schedules a task to run after at least `ms` milliseconds; `setInterval` repeats. Both return an id for `clearTimeout`/`clearInterval`. They are host APIs, not part of ECMAScript.

"At least" matters: the callback runs only when the timer has expired and the event loop reaches it, so a busy main thread delays it. Browsers also clamp nested timers (after five levels, the minimum becomes about 4 ms) and heavily throttle timers in background tabs (often to once per second or less).

`setInterval` does not wait for slow callbacks and can stack up work; a recursive `setTimeout` schedules the next run only after the current one finishes, which is safer for polling.

```js
// Polling that never overlaps and stops cleanly
function poll(fn, intervalMs, signal) {
  async function tick() {
    if (signal.aborted) return;
    try {
      await fn();
    } catch (err) {
      console.error('poll failed', err);
    }
    if (!signal.aborted) setTimeout(tick, intervalMs);
  }
  tick();
}

const ac = new AbortController();
poll(() => refreshStatus(), 5000, ac.signal);
// later: ac.abort();

const start = performance.now();
setTimeout(() => console.log(performance.now() - start), 10); // often > 10
```

#### Pitfalls
- Forgetting to clear intervals when a component unmounts keeps closures alive and work running.
- Using timers to "wait for the DOM" or "wait for data" is fragile; use events or promises.

### Long tasks and Web Workers
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API -->
Any task that runs longer than about 50 ms is a long task: during it the page cannot respond to clicks or typing, which hurts the Interaction to Next Paint (INP) metric. Two strategies fix this.

1. Break work into chunks and yield between them, so input and rendering can happen. `scheduler.yield()` (Chromium 129+) yields while keeping your task's priority; elsewhere fall back to `setTimeout`.
2. Move CPU-heavy work off the main thread with a Web Worker. A worker runs a separate script with its own event loop and global scope (no DOM access). Communication happens via `postMessage`, which structured-clones data; large `ArrayBuffer`s can be transferred instead of copied.

```js
// main.js
const worker = new Worker(new URL('./parse-worker.js', import.meta.url), { type: 'module' });

function parseInWorker(buffer) {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = reject;
    worker.postMessage(buffer, [buffer]);   // transfer, zero-copy
  });
}

// parse-worker.js
self.onmessage = (e) => {
  const text = new TextDecoder().decode(e.data);
  const rows = text.split('\n').map((line) => line.split(','));
  self.postMessage(rows);
};

// Chunking on the main thread
async function processAll(items) {
  for (let i = 0; i < items.length; i++) {
    handle(items[i]);
    if (i % 500 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}
```

#### Pitfalls
- Structured cloning large objects to and from a worker can cost more than the work saved; measure.
- The simple promise wrapper above breaks with concurrent requests — use message ids or a library like Comlink.
