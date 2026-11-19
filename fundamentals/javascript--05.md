## 9. Modules

### ES modules
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules -->
ES modules (ESM) are JavaScript's standard module system. Each module file has its own scope, runs in strict mode, and explicitly declares what it shares with `export` and what it needs with `import`.

Exports come in two forms: named exports (any number, imported by exact name) and one optional default export. Named exports are generally preferred because renaming is explicit and tooling can auto-import and tree-shake them reliably.

Because import and export declarations are static (top level, string literal specifiers), the dependency graph is known before any code runs. Loading happens in three phases: construction (fetch and parse every module), instantiation (link imports to exports in memory), and evaluation (run each module once, dependencies first). A module is evaluated once and then cached; every importer shares the same instance.

```js
// math.js
export const PI = 3.14159;
export function area(r) { return PI * r * r; }
export default function format(n) { return n.toFixed(2); }

// app.js
import format, { area, PI as pi } from './math.js';
import * as math from './math.js';

console.log(format(area(2)), pi, math.PI);
```

```html
<script type="module" src="/app.js"></script>
```

In browsers, module scripts are deferred by default, require CORS for cross-origin loads, and need full relative paths with extensions (or an import map) — bare specifiers like `'lodash'` only work through a bundler, an import map, or Node.js resolution.

#### Interview tip
- ESM's static structure enables tree-shaking; CommonJS's dynamic `require` does not, which is one reason bundles shrink after migrating.

### Dynamic import and top-level await
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import -->
`import(specifier)` is a function-like expression that loads a module at runtime and returns a promise of its namespace object. It works in both modules and classic scripts, accepts computed specifiers, and is the basis of code splitting: bundlers create a separate chunk for each dynamic import.

Use it for routes, heavy features loaded on interaction (charts, editors, PDF export), polyfills only some browsers need, and locale data.

Top-level `await` (ES2022) allows `await` at the top of a module. The module's evaluation becomes asynchronous: modules that import it wait for it to finish before they run, while unrelated siblings can continue loading.

```js
// Load a heavy feature only when needed
exportButton.addEventListener('click', async () => {
  const { exportToPdf } = await import('./pdf-export.js');
  exportToPdf(currentReport);
});

// Locale loading with a computed specifier
const messages = await import(`./locales/${lang}.js`).catch(() =>
  import('./locales/en.js'));

// config.js — top-level await
const res = await fetch('/config.json');
export const config = await res.json();
```

#### Pitfalls
- Top-level await in a widely imported module delays every importer; avoid slow network calls there.
- Fully dynamic specifiers (`import(userInput)`) cannot be analysed by bundlers and may not be split correctly.

### Live bindings and circular dependencies
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import -->
ES module imports are live bindings, not copies. The importer gets a read-only view of the exporter's variable; if the exporting module reassigns it, importers see the new value. You cannot assign to an imported binding yourself (it throws a TypeError).

This differs from CommonJS, where `require` returns the `module.exports` object as it is at that moment, and destructured values are snapshots.

Live bindings are also what makes circular imports partly work: when module A imports B and B imports A, linking succeeds because bindings are connected before evaluation. But whichever module evaluates first may access the other's exports while they are still in the TDZ, producing `ReferenceError: Cannot access 'x' before initialization`.

```js
// counter.js
export let count = 0;
export function increment() { count++; }

// main.js
import { count, increment } from './counter.js';
console.log(count);  // 0
increment();
console.log(count);  // 1 — live binding
// count = 5;        // TypeError: assignment to constant variable

// Circular: a.js imports b.js, b.js imports a.js
// b.js runs first and reads `config` from a.js at top level -> TDZ error.
// Fix: read it inside a function called later, or extract shared code
// into a third module both depend on.
```

#### Pitfalls
- Barrel files (`index.js` re-exporting everything) make cycles more likely and can hurt tree-shaking and startup time.

### Import attributes and JSON modules (ES2025)
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import/with -->
Import attributes add metadata to an import with a `with { ... }` clause. The first standard use is `type: 'json'`, which lets you import JSON files as modules (JSON modules, ES2025). The JSON's parsed value becomes the default export.

Why the attribute is required: on the web, the server decides the MIME type. Without the explicit `type`, a compromised or misconfigured server could send JavaScript where you expected inert JSON, and it would execute. With `type: 'json'`, the host refuses to load anything that is not JSON.

The syntax also works with dynamic import. Older code used an `assert { type: 'json' }` clause from an earlier draft; it is deprecated and removed in recent runtimes. Supported in Chrome 123+, Firefox 138+, Safari 17.2+, and Node.js 18.20+/20.10+.

```js
import config from './config.json' with { type: 'json' };
console.log(config.apiBaseUrl);

const { default: translations } = await import(`./i18n/${lang}.json`, {
  with: { type: 'json' },
});

// CSS module scripts (Chromium) use the same mechanism:
// import sheet from './theme.css' with { type: 'css' };
// document.adoptedStyleSheets = [sheet];
```

#### Pitfalls
- JSON modules only have a default export; `import { apiBaseUrl } from './config.json'` fails.
- The imported object is shared by all importers — mutating it affects everyone.

## 10. The DOM and Events

### The DOM tree and selecting elements
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model -->
The Document Object Model is the browser's live, object-based representation of the page. HTML is parsed into a tree of nodes: the `document`, elements, text nodes and comments. JavaScript reads and changes that tree, and the browser re-renders accordingly. The DOM is a web API exposed to JavaScript, not part of the language.

Selecting elements:

- `document.querySelector(css)` returns the first match or `null`; `querySelectorAll` returns a static `NodeList`.
- `getElementById` is fast for single ids.
- `element.closest(css)` walks up to the nearest matching ancestor; great for event handling.
- Older `getElementsByClassName` returns a live `HTMLCollection` that updates as the DOM changes.

Elements expose attributes (the HTML source values) and properties (current JavaScript state). For example, `input.value` is the live value while `getAttribute('value')` is the initial one.

```js
const form = document.querySelector('#signup');
const inputs = form.querySelectorAll('input[required]');

inputs.forEach((input) => {
  input.classList.toggle('empty', input.value.trim() === '');
});

const card = document.querySelector('[data-product-id="42"]');
card.dataset.productId;          // '42' (data-* attributes)

const row = event.target.closest('tr');
```

#### Pitfalls
- Running scripts before the DOM is parsed returns `null`; use `type="module"` or `defer`, or wait for `DOMContentLoaded`.
- Iterating a live `HTMLCollection` while removing elements skips items.

### Updating the DOM efficiently and safely
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/API/DocumentFragment -->
Creating and changing elements is cheap individually; the cost comes from style recalculation, layout and paint that the changes trigger. Browsers batch work until the next frame, but interleaving reads of layout properties with writes forces synchronous layout.

Guidelines:

- Build many nodes off-document in a `DocumentFragment` or with `append(...nodes)`, then insert once.
- Toggle classes instead of setting many inline styles.
- Use `textContent` for text. Use `innerHTML` only with trusted or sanitised markup — assigning user input to it enables cross-site scripting (XSS).
- `replaceChildren()` clears and fills an element in one call.
- For long lists, render only visible rows (virtualisation).

```js
function renderProducts(list, products) {
  const fragment = document.createDocumentFragment();
  for (const p of products) {
    const li = document.createElement('li');
    li.className = 'product';
    li.dataset.id = p.id;
    const title = document.createElement('h3');
    title.textContent = p.name;                  // safe against XSS
    const price = document.createElement('span');
    price.textContent = formatPrice(p.price);
    li.append(title, price);
    fragment.append(li);
  }
  list.replaceChildren(fragment);                 // one DOM insertion
}

// Dangerous with user data:
// comment.innerHTML = userComment;
```

#### Interview tip
- Mention `element.setHTML()` / the Sanitizer API and Trusted Types as modern defences when HTML from users must be rendered, plus libraries like DOMPurify for broad support.

### Event propagation
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener -->
When an event fires on an element, it travels in three phases: capture (from `window` down to the target's parent), target, and bubble (back up to `window`). Listeners run in bubble phase by default; pass `{ capture: true }` to run during capture.

`event.target` is the element where the event originated; `event.currentTarget` is the element whose listener is running. `stopPropagation()` stops the event from moving to further elements; `stopImmediatePropagation()` also skips other listeners on the same element. A few events (`focus`, `blur`, `mouseenter`) do not bubble; `focusin`/`focusout` are bubbling alternatives.

`addEventListener` options: `once` (auto-remove after first call), `passive` (promise not to call `preventDefault`, letting the browser scroll immediately), and `signal` (remove via an AbortController).

```js
document.addEventListener('click', () => console.log('document (bubble)'));
document.addEventListener('click', () => console.log('document (capture)'), { capture: true });
button.addEventListener('click', (e) => {
  console.log('button', e.target === e.currentTarget);
});
// Click: document (capture), button true, document (bubble)

window.addEventListener('touchmove', onTouch, { passive: true });
dialog.addEventListener('close', cleanup, { once: true });

// Custom events
el.dispatchEvent(new CustomEvent('cart:updated', {
  detail: { count: 3 }, bubbles: true,
}));
```

#### Pitfalls
- `removeEventListener` needs the same function reference and the same capture flag; anonymous functions cannot be removed.
- Using `stopPropagation` liberally breaks analytics and other delegated handlers higher up.

### Event delegation
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/API/Event/target -->
Event delegation means attaching one listener to a common ancestor instead of one listener per child, and using `event.target` (usually with `closest`) to work out which child was involved. It relies on bubbling.

Benefits:

- Far fewer listeners for large lists and tables, so less memory and faster setup.
- Elements added later automatically work, with no need to attach handlers after each render.
- Cleanup is simpler: one listener to remove.

The `closest` call matters because the click target may be a nested element (an icon inside a button).

```js
const table = document.querySelector('#orders');

table.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || !table.contains(button)) return;

  const row = button.closest('tr');
  const id = row.dataset.orderId;

  switch (button.dataset.action) {
    case 'cancel':
      cancelOrder(id);
      break;
    case 'details':
      openDetails(id);
      break;
  }
});

// Rows can be re-rendered freely; the single listener keeps working.
```

#### Pitfalls
- Non-bubbling events like `focus` or `mouseenter` cannot be delegated directly; use `focusin` or `mouseover`.
- The `table.contains(button)` check prevents matches outside the container when tables are nested.

### Forms and default actions
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault -->
Many events have a default browser behaviour: submitting a form navigates, clicking a link follows it, pressing space scrolls. `event.preventDefault()` cancels that default while letting the event continue to propagate. It only works for cancelable events and not inside passive listeners.

For forms, listen to the form's `submit` event rather than a button's `click` — this catches Enter key submissions too. `FormData` collects all named fields (including files) and can be passed straight to `fetch`. Built-in constraint validation (`required`, `type="email"`, `pattern`, `min`) runs before `submit`; `form.reportValidity()` and `setCustomValidity()` let you integrate custom rules with native messages.

```js
const form = document.querySelector('#contact');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);

  if (data.get('message').length < 10) {
    form.elements.message.setCustomValidity('Please write at least 10 characters');
    form.reportValidity();
    return;
  }

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;               // avoid double submission
  try {
    const res = await fetch('/api/contact', { method: 'POST', body: data });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    form.reset();
  } finally {
    submit.disabled = false;
  }
});

form.elements.message.addEventListener('input', (e) => e.target.setCustomValidity(''));
```

#### Pitfalls
- Client-side validation improves UX but never replaces server-side validation.
- A `<button>` inside a form defaults to `type="submit"`; set `type="button"` for other actions.

### Observer APIs
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API -->
Observer APIs let the browser notify you about changes efficiently instead of polling or listening to high-frequency events.

- `IntersectionObserver` reports when elements enter or leave the viewport (or a container). Used for lazy-loading, infinite scroll, and impression tracking. It runs asynchronously, off the scroll path, so it does not cause jank like scroll handlers that call `getBoundingClientRect`.
- `ResizeObserver` reports element size changes — useful for components that adapt to their container rather than the window.
- `MutationObserver` reports DOM changes (children, attributes, text). Its callbacks run as microtasks, batched.
- `PerformanceObserver` reports performance entries such as long tasks and layout shifts.

```js
const sentinel = document.querySelector('#load-more-sentinel');

const io = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) loadNextPage();
  }
}, { rootMargin: '400px' });       // start loading before it is visible

io.observe(sentinel);

const ro = new ResizeObserver(([entry]) => {
  const width = entry.contentBoxSize[0].inlineSize;
  chart.classList.toggle('compact', width < 480);
});
ro.observe(chart);

// Later, when the component is destroyed
io.disconnect();
ro.disconnect();
```

#### Pitfalls
- Forgetting `disconnect()` keeps observed elements and callbacks alive — a common single-page-app leak.
- Changing an element's size inside its own ResizeObserver callback can loop; the browser reports an error after detecting it.

## 11. Networking and Storage

### The fetch API
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch -->
`fetch(resource, options)` makes HTTP requests and returns a promise of a `Response`. It is available in all browsers, Node.js 18+, Deno and Bun.

Options include `method`, `headers`, `body` (string, `FormData`, `Blob`, `URLSearchParams`, `ReadableStream`), `signal` for cancellation, `credentials` (whether to send cookies cross-origin), `cache`, and `mode`.

The response body is a stream that can be read once with `json()`, `text()`, `blob()`, `arrayBuffer()`, `formData()`, or consumed incrementally through `response.body`.

```js
async function createOrder(order, { signal } = {}) {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
    credentials: 'include',
    signal,
  });

  if (!res.ok) {
    const problem = await res.json().catch(() => ({}));
    throw new Error(problem.message ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

// Query strings: let the platform encode them
const url = new URL('/api/search', location.origin);
url.searchParams.set('q', 'shoes & socks');
url.searchParams.set('page', '2');
const results = await fetch(url).then((r) => r.json());
```

#### Interview tip
- Know the difference between `fetch` and the old `XMLHttpRequest`: promise-based, stream bodies, service-worker integration, but no built-in upload progress events.

### Handling fetch responses and failures
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/API/Response/ok -->
`fetch` rejects only for network-level failures: DNS errors, connection refused, CORS blocks, or aborts. An HTTP 404 or 500 is a successful fetch from its point of view — the promise fulfils and you must check `response.ok` (status 200–299) or `response.status` yourself.

A robust client wrapper usually adds: status checking with a typed error, timeouts via `AbortSignal.timeout`, retries with exponential backoff for idempotent requests and retriable statuses (408, 429, 502, 503, 504), honouring `Retry-After`, and safe body parsing (an error page may be HTML, not JSON).

```js
class HttpError extends Error {
  constructor(response, body) {
    super(`HTTP ${response.status} ${response.statusText}`);
    this.name = 'HttpError';
    this.status = response.status;
    this.body = body;
  }
}

async function request(url, options = {}, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
      if (res.ok) return res.status === 204 ? null : res.json();
      const body = await res.text();
      const retriable = [429, 502, 503, 504].includes(res.status);
      if (!retriable || attempt >= retries) throw new HttpError(res, body);
    } catch (err) {
      if (err instanceof HttpError || attempt >= retries) throw err;
    }
    await new Promise((r) => setTimeout(r, 2 ** attempt * 300));
  }
}
```

#### Pitfalls
- Retrying non-idempotent requests (POST payments) can duplicate side effects; use idempotency keys.
- Calling `res.json()` twice throws because the body was already consumed; use `res.clone()` if needed.

### CORS
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS -->
The same-origin policy stops scripts on one origin (scheme + host + port) from reading responses from another. Cross-Origin Resource Sharing (CORS) is the HTTP header protocol that lets a server opt in to such reads.

How it works: the browser sends the request with an `Origin` header. The server answers with `Access-Control-Allow-Origin` naming that origin (or `*`). If the header is missing or wrong, the browser hides the response from your script — the request usually still reached the server.

Requests that are not "simple" — custom headers like `Authorization`, JSON content type, or methods like PUT/DELETE — trigger a preflight `OPTIONS` request first. The server must reply with `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers`; `Access-Control-Max-Age` caches the result. Sending cookies cross-origin needs `credentials: 'include'` on the client and `Access-Control-Allow-Credentials: true` plus an explicit origin (not `*`) on the server.

```js
// Client
await fetch('https://api.example.com/orders', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(order),
});

// Server response to the preflight must include, e.g.:
// Access-Control-Allow-Origin: https://shop.example.com
// Access-Control-Allow-Methods: GET, POST, PUT, DELETE
// Access-Control-Allow-Headers: Content-Type, Authorization
// Access-Control-Max-Age: 600
// Vary: Origin
```

#### Pitfalls
- CORS is enforced by browsers only; it is not a server security control against curl or other servers.
- Reflecting any `Origin` back with credentials allowed effectively disables protection.
- `mode: 'no-cors'` does not bypass CORS; it gives you an unreadable opaque response.

### Web storage, cookies and IndexedDB
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API -->
Browsers offer several client-side storage options with different trade-offs:

- `localStorage`: string key-value pairs per origin, persistent, roughly 5 MB, synchronous (blocks the main thread). Good for small preferences.
- `sessionStorage`: same API, scoped to one tab and cleared when it closes.
- Cookies: small (about 4 KB), sent automatically with matching HTTP requests. Use them for server sessions with `HttpOnly` (unreadable from JavaScript), `Secure`, and `SameSite` attributes.
- IndexedDB: asynchronous, transactional object store for large structured data, blobs and offline apps. The raw API is verbose; small wrappers like idb help.
- Cache Storage: request/response pairs, typically managed by a service worker.

Any script running on your origin can read `localStorage`, so an XSS bug exposes everything stored there.

```js
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem('prefs')) ?? { theme: 'light' };
  } catch {
    return { theme: 'light' };     // storage blocked or corrupted
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem('prefs', JSON.stringify(prefs));
  } catch (err) {
    console.warn('Could not persist prefs', err); // quota or private mode
  }
}

// React to changes made in other tabs
window.addEventListener('storage', (e) => {
  if (e.key === 'prefs') applyPrefs(JSON.parse(e.newValue));
});
```

#### Pitfalls
- Storing access tokens in `localStorage` makes them stealable through XSS; prefer `HttpOnly` cookies.
- Storage can be cleared by the browser under pressure unless you request persistence (`navigator.storage.persist()`).
