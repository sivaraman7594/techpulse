# React scenario questions

### A React list of 5,000 rows makes typing in a search box laggy. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react/useDeferredValue -->
Observe: record the keystroke in the React DevTools Profiler on a production build with 4x CPU throttling. You will typically see each keystroke commit taking 100 ms or more, dominated by rendering all rows, and a poor Interaction to Next Paint.

Hypothesise: the input's state lives in the same component as the list, so every keystroke filters 5,000 items and re-renders 5,000 row components, plus creates 5,000 DOM updates.

Verify: check "why did this render" on a row. If rows render because the parent rendered, and the filter itself takes measurable time (`console.time`), you have confirmed both costs.

Fix, in layers:

1. Keep the input urgent and defer the expensive part.

```jsx
const [query, setQuery] = useState('');
const deferred = useDeferredValue(query);
const visible = useMemo(() => filterRows(rows, deferred), [rows, deferred]);
return (
  <>
    <input value={query} onChange={e => setQuery(e.target.value)} />
    <MemoTable rows={visible} />
  </>
);
```

2. Memoise rows (`memo` with stable props, or enable React Compiler) so unchanged rows skip rendering.
3. Virtualise the table (TanStack Virtual, react-virtuoso) so only about 30 visible rows exist in the DOM.
4. If filtering is still heavy, precompute a lowercase search index once, or move the filtering into a Web Worker.

Prevent: add a performance budget for the interaction (for example INP under 200 ms) and a Profiler-based regression check.

Common wrong answers: debouncing the input alone (it delays feedback but each eventual render still blocks), or wrapping the input's own `setQuery` in `startTransition`, which makes typing itself laggy because controlled inputs need synchronous updates.

### The browser's memory grows every time users navigate between two pages of your SPA. How do you find and fix the leak?
<!-- level: advanced; kind: scenario; ref: https://react.dev/learn/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development -->
Observe: in Chrome DevTools Memory, take a heap snapshot, navigate A → B → A ten times, force garbage collection, take another snapshot and compare. Growth that does not return after GC is a leak. Filter by "Detached" to find DOM trees that are no longer in the document but still referenced.

Hypothesise the usual React suspects:

1. Effects that subscribe (window listeners, WebSockets, intervals, store subscriptions, ResizeObserver) without cleanup.
2. Third-party imperative widgets (maps, charts, editors) created in an effect but never destroyed.
3. Module-level caches or arrays that accumulate per-page data.
4. Closures captured by global singletons, such as an analytics callback holding a component's props.

Verify: the retainer chain in the snapshot shows what holds the detached nodes (for example `listener → onResize → fiber`). StrictMode's double-mount in development is also a quick detector: if a subscription fires twice, cleanup is missing.

Fix by pairing every setup with a cleanup:

```jsx
useEffect(() => {
  const chart = new Chart(canvasRef.current, config);
  const id = setInterval(() => chart.update(fetchLatest()), 5000);
  const onResize = () => chart.resize();
  window.addEventListener('resize', onResize);
  return () => {
    clearInterval(id);
    window.removeEventListener('resize', onResize);
    chart.destroy();
  };
}, [config]);
```

Bound module-level caches (LRU with a max size) or use a data library with garbage collection of unused queries.

Prevent: keep StrictMode on, add an automated memory test with Playwright that loops navigation and checks `performance.memory` or heap snapshots, and review effects for symmetrical cleanup in code review. Wrong answer: "React handles cleanup automatically" — it only cleans up what it created.

### After adding a "last updated" timestamp, production logs fill with hydration mismatch errors. What is happening and what do you do?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react-dom/client/hydrateRoot -->
Observe: the error points at a text node whose server value differs from the client value, for example "10:31:05 AM" vs "4:01:05 PM", and the page flashes when React patches it.

Hypothesise: the component formats the date during render with `toLocaleString()`. The server runs in UTC with one locale; the browser uses the user's time zone and locale. Rendering at slightly different times also changes seconds. Any render output that depends on the environment breaks the rule that the first client render must match the server HTML.

Verify: reproduce by setting the browser's time zone in DevTools Sensors to a different zone, or compare the server HTML (view-source) with the client DOM.

Fix options, depending on the requirement:

1. Render a deterministic value on the server and enhance on the client after hydration:

```jsx
function LastUpdated({ iso }) {
  const [label, setLabel] = useState(null);
  useEffect(() => setLabel(new Date(iso).toLocaleString()), [iso]);
  return <time dateTime={iso}>{label ?? formatUtc(iso)}</time>;
}
```

2. Make the format deterministic on both sides by passing an explicit `timeZone` and locale (for example from a user preference cookie) to `Intl.DateTimeFormat`.
3. For a single text node that legitimately differs, `suppressHydrationWarning` on that element is acceptable, but it only covers one level and hides real bugs if overused.

Prevent: lint or review for `Date.now()`, `Math.random()`, `window`, `localStorage` and `typeof window` branches inside render. Also check invalid HTML nesting (a `<div>` inside `<p>`) and browser extensions, which are other common mismatch causes. Wrong answer: switching the whole page to client-only rendering, which throws away the SSR benefits.

### A counter driven by setInterval stays stuck at 1. Explain and fix.
<!-- level: basic; kind: scenario; ref: https://react.dev/learn/state-as-a-snapshot -->
The code looks like this:

```jsx
const [count, setCount] = useState(0);
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000);
  return () => clearInterval(id);
}, []);
```

Observe: the display goes from 0 to 1 and then stays at 1 forever.

Hypothesise: a stale closure. The effect ran once, after the first render, and the interval callback captured `count` from that render, which is 0. Every tick computes `0 + 1`. State is a snapshot per render, and the empty dependency array means the effect never sees newer snapshots.

Verify: the lint rule `react-hooks/exhaustive-deps` already warns that `count` is missing. Logging inside the callback prints 0 every time.

Fix options:

1. Use an updater function so the callback does not need to read state at all. This is the best fix here:

```jsx
useEffect(() => {
  const id = setInterval(() => setCount(c => c + 1), 1000);
  return () => clearInterval(id);
}, []);
```

2. Add `count` as a dependency. It works but tears down and recreates the interval every second, causing drift.
3. When the callback needs other changing values (for example a `step` prop), read them through `useEffectEvent` (React 19.2+) so they are always fresh without restarting the interval.

Prevent: keep the hooks lint rule as an error in CI, and never suppress it.

Common wrong answer: "use a ref for count". It fixes the read but then changes do not trigger renders unless you also keep state, so it adds complexity for no gain.

### Every keystroke in a header search box re-renders the entire application. The search text lives in a global context. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react/useContext#optimizing-re-renders-when-passing-objects-and-functions -->
Observe: React DevTools "highlight updates" flashes the whole page on each keystroke; the Profiler shows hundreds of components rendering, many marked "context changed".

Hypothesise: an `AppContext` provides one object like `{ user, theme, cart, search, setSearch }`. The provider creates a new object on every render, and the search text changes on every keystroke, so every consumer of `AppContext` re-renders even if it only needs `theme`. `memo` does not help because context updates bypass it.

Verify: temporarily remove `search` from the context value and confirm the storm disappears.

Fix:

1. Move state down. If only the header and results use the search text, keep it local or in the URL search params, not in app-wide context.
2. Split the context by change frequency and concern: `UserContext`, `ThemeContext`, `CartContext`, and separate state and actions contexts.
3. Memoise provider values so a provider re-render does not invalidate consumers:

```jsx
const cartValue = useMemo(() => ({ items, total }), [items, total]);
const cartActions = useMemo(() => ({ add, remove }), [add, remove]);
```

4. For state that is genuinely global and high-frequency, use an external store with selectors (Zustand, Redux, Jotai). Components subscribe to slices and re-render only when their slice changes:

```jsx
const query = useSearchStore(s => s.query);
```

Prevent: document a rule that context is for low-frequency values, and review new context additions.

Wrong answers: wrapping everything in `memo` (context bypasses it) or replacing context with prop drilling across ten levels.

### A large settings form with 60 fields feels sluggish when typing. What would you do?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react-dom/components/form -->
Observe: Profiler shows each keystroke re-rendering the whole form component and all 60 fields, plus validation of every field running each time.

Hypothesise: a single `useState` object holds all values in the top-level form, every field is controlled, and a validation function over the whole object runs during render. Some fields are expensive (rich selects, date pickers).

Verify: type in one field and check that unrelated fields render ("parent rendered"), and time the validation.

Fix options, from least to most change:

1. Make most inputs uncontrolled. Use `defaultValue` and read values with `FormData` on submit (or a React 19 form action). Only fields that drive live UI stay controlled.
2. Use a form library built on uncontrolled inputs and subscriptions, such as React Hook Form, so typing in one field re-renders only that field and its error message.

```jsx
const { register, handleSubmit, formState: { errors } } = useForm({
  resolver: zodResolver(settingsSchema),
  mode: 'onBlur',
});
<input {...register('displayName')} aria-invalid={!!errors.displayName} />
```

3. Validate on blur or submit rather than on every keystroke, and validate per field.
4. Split the form into sections with local state, or memoise field components so unchanged fields skip rendering (or enable React Compiler).
5. Lazy-mount heavy widgets in collapsed sections.

Prevent: performance-test long forms on low-end devices, and set a convention for when inputs should be controlled.

Trade-off: uncontrolled inputs make cross-field dynamic UI slightly harder; libraries offer `watch` for those specific fields. Wrong answer: debouncing every `onChange`, which makes the inputs feel broken.

### You inherit a large codebase of class components. How do you plan a migration to function components and hooks?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react/Component#alternatives -->
Observe and scope first: inventory components by type (class vs function), usage of legacy lifecycles (`componentWillReceiveProps`, `UNSAFE_*`), legacy context, string refs, and HOCs or mixins. String refs and legacy context were removed in React 19, so those block an upgrade and must be handled first.

Principle: do not rewrite for its own sake. Class components still work. Migrate when you touch a component for a feature, when it blocks an upgrade, or when it is a hotspot for bugs.

Plan:

1. Upgrade tooling: TypeScript, ESLint hooks rules, test coverage with React Testing Library around the components you will change. Behaviour tests should not care whether a component is a class.
2. Remove blockers: replace string refs with `createRef`/callback refs, legacy context with `createContext`, and `UNSAFE_` lifecycles with derived state or keys.
3. Convert leaf components first, then containers. Map concepts rather than lifecycles one to one:

```jsx
// componentDidMount + componentDidUpdate(prevProps.id) + componentWillUnmount
useEffect(() => {
  const sub = store.subscribe(id, setData);
  return () => sub.unsubscribe();
}, [id]);
```

4. Replace HOCs and render props with custom hooks where it simplifies code.
5. Keep error boundaries as classes (or use `react-error-boundary`); there is no hook equivalent.

Verify each step: tests pass, StrictMode shows no double-subscription bugs, Profiler shows no new render storms.

Prevent regressions: lint rule forbidding new class components except error boundaries.

Common mistakes: translating `componentDidUpdate` into an effect without dependencies (runs every render), copying props into state in an effect, and attempting a big-bang rewrite that freezes feature work.

### Your team is upgrading from React 18 to React 19. What is your upgrade plan and what breaks?
<!-- level: advanced; kind: scenario; ref: https://react.dev/blog/2024/04/25/react-19-upgrade-guide -->
Plan in stages rather than one jump:

1. Upgrade to React 18.3 first. It is identical to 18.2 but adds deprecation warnings for everything removed in 19. Fix all warnings in development and tests.
2. Run the official codemods (`react-codemod` and the types codemod) to handle mechanical changes.
3. Upgrade `react`, `react-dom`, `@types/react` and `@types/react-dom` together, plus libraries that have peer dependencies on React (router, state, UI kits). Check each library's React 19 support.

Notable breaking changes to look for:

- Removed: `propTypes` and `defaultProps` checks on function components (use TypeScript and default parameters), legacy context, string refs, `ReactDOM.render`/`hydrate` (use `createRoot`/`hydrateRoot`), `unmountComponentAtNode`, `findDOMNode`, `react-test-renderer/shallow`.
- `act` moved to `react`; `react-dom/test-utils` is gone except re-exports.
- Errors in render are no longer re-thrown; they go to `window.reportError` or `console.error`, with new root options `onUncaughtError`/`onCaughtError`. Error monitoring setup may need updating.
- TypeScript: `useRef` requires an argument, ref callbacks returning values are now interpreted as cleanups (implicit returns like `ref={n => (x = n)}` fail type checking), the global `JSX` namespace moved to `React.JSX`.
- StrictMode reuses memoised results during the double render.

Verify: run the full test suite, then a canary deployment behind a feature flag, watching error rates and Web Vitals.

Afterwards, adopt new features gradually: ref as prop instead of `forwardRef`, `<Context>` as provider, actions with `useActionState`, metadata tags, and later React Compiler.

Wrong answer: upgrading directly and fixing breakages in production.

### How would you roll out React Compiler on a large existing codebase?
<!-- level: advanced; kind: scenario; ref: https://react.dev/learn/react-compiler -->
Goal: get automatic memoisation without introducing behaviour changes.

Observe the starting point: React version (the compiler targets React 19 and supports 17/18 via the `react-compiler-runtime` package), build tooling (Babel, Vite, Next.js, Metro), and how much code violates the Rules of React.

Steps:

1. Enable the compiler-powered ESLint rules from `eslint-plugin-react-hooks` first. They flag mutation of props or state, reading refs during render, conditional hooks and other violations. Fix or annotate the worst offenders. Components that break the rules will simply be skipped by the compiler, but knowing where they are matters.
2. Enable the compiler for a subset: a directory, or opt-in mode with the `'use memo'` directive on selected components. Choose leaf-heavy areas with good test coverage.
3. Measure before and after with the Profiler and real-user metrics (INP, render counts), not just intuition.
4. Expand gradually, keeping `'use no memo'` as an escape hatch for a component that misbehaves while you investigate.
5. Leave existing `useMemo`/`useCallback` in place initially. Removing them can change when effects fire if they relied on stable dependencies.

Risks to watch:

- Code that "worked by accident" because of extra renders, such as reading a mutable module variable during render, can stop updating once memoised.
- Third-party libraries that mutate objects returned from hooks.

Verify: full test suite, end-to-end smoke tests, and a staged production rollout.

Prevent: keep the lint rules on, and teach the team that pure rendering is now a correctness requirement, not just style.

Wrong answer: "the compiler makes the app fast, so we can delete virtualisation and code splitting." It only removes wasted re-renders.

### An accessibility audit reports that your custom modal dialog fails keyboard and screen-reader checks. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react-dom/createPortal -->
Observe: test with keyboard only and a screen reader (NVDA, VoiceOver). Typical failures: focus stays on the page behind the modal, Tab escapes into background content, Escape does nothing, the screen reader does not announce a dialog or its title, and focus is lost after closing.

Hypothesise: the modal is a styled `<div>` rendered in a portal with no dialog semantics or focus management.

Fix: the simplest robust option today is the native `<dialog>` element opened with `showModal()`. It provides top-layer rendering, makes the rest of the page inert, handles Escape and traps focus.

```jsx
function ConfirmDialog({ open, title, onClose, children }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>{title}</h2>
      {children}
      <button onClick={onClose} autoFocus>Cancel</button>
    </dialog>
  );
}
```

The browser returns focus to the previously focused element when the dialog closes. If you must keep a custom implementation, use a well-tested headless library (Radix, React Aria) that implements the WAI-ARIA dialog pattern: `role="dialog"`, `aria-modal="true"`, labelled title, focus trap, inert background, Escape to close, and focus restoration.

Verify: rerun the audit, add an axe check in tests, and add an RTL test that asserts focus moves into the dialog and back.

Prevent: centralise dialogs in one component used everywhere.

Wrong answers: adding `tabIndex` to every element, or only adding `aria-modal` without actually blocking background interaction.

### Marketing wants to render HTML from a CMS inside React. What are the risks and how do you do it safely?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html -->
Risk: React escapes text by default, but `dangerouslySetInnerHTML` bypasses that. If CMS content contains `<img src=x onerror=...>`, `<script>` (not executed via innerHTML, but other vectors are), `javascript:` URLs or malicious `<iframe>`s, you have stored cross-site scripting. Anyone who can edit CMS content, or anyone who compromises a CMS account, can then run code in your users' sessions.

Approach:

1. Prefer structured content. Ask the CMS for rich text as JSON (Portable Text, Contentful rich text, MDX compiled at build time) and map nodes to React components. No raw HTML is ever injected, and you control which elements exist.
2. If HTML is unavoidable, sanitise with an allow-list sanitiser such as DOMPurify, preferably on the server once at publish time and again at render for defence in depth:

```jsx
import DOMPurify from 'isomorphic-dompurify';

function CmsBlock({ html }) {
  const clean = useMemo(() => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'a', 'strong', 'em', 'ul', 'ol', 'li', 'h2', 'h3', 'img'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
  }), [html]);
  return <div className="prose" dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

3. Add a strict Content Security Policy (no inline scripts, nonce-based scripts) so that a missed vector still cannot execute.
4. Validate link protocols; React itself warns about `javascript:` URLs in `href`.

Verify: add tests with known XSS payloads (OWASP cheat sheet samples) that assert the sanitised output has no event handlers or script URLs.

Wrong answers: "React protects us from XSS" (not with `dangerouslySetInnerHTML`), or regex-based stripping of `<script>` tags.

### API calls fire twice in development and a teammate wants to remove StrictMode. What do you tell them?
<!-- level: basic; kind: scenario; ref: https://react.dev/reference/react/StrictMode -->
Observe: the network tab in development shows every mount-time request twice. Production shows one.

Explain the cause: StrictMode in development deliberately mounts components, unmounts them, and mounts them again, running effect setup, cleanup and setup. It is a stress test simulating what happens in real life when components remount: navigating back, Activity hiding and showing, fast refresh, and future features that preserve state across unmounts.

So the double request is a symptom of an effect without cleanup, and it reveals real bugs: race conditions when props change quickly, duplicated analytics events, or state updates on unmounted components.

Fix the effect, not the check:

```jsx
useEffect(() => {
  const controller = new AbortController();
  loadInvoices(customerId, { signal: controller.signal })
    .then(setInvoices)
    .catch(err => { if (err.name !== 'AbortError') setError(err); });
  return () => controller.abort();
}, [customerId]);
```

Better still, move fetching out of effects: use a data library (TanStack Query, SWR), which deduplicates requests, or the framework's loaders or Server Components.

For non-idempotent side effects that truly must happen once per app load (for example initialising an SDK), do them at module level or guard with a module-level flag, not a ref inside the component.

For analytics "page viewed" events, fire them on route change in the router layer.

Verify: with StrictMode on, the first request is aborted (visible as cancelled in the network tab) and the UI is correct.

Wrong answers: removing StrictMode, or using a `didFetch` ref to skip the second run, which hides the missing cleanup.

### After a deployment, some users get a blank screen when opening a page. Logs show "Failed to fetch dynamically imported module". What happened?
<!-- level: advanced; kind: scenario; ref: https://react.dev/reference/react/lazy -->
Observe: errors spike right after each deploy and come from users who had the app open before the deploy. Hard refresh fixes it.

Hypothesise: code splitting with `lazy`. The old `index.js` in the user's tab references chunk filenames with content hashes (`Settings.3f9a1.js`). The deploy replaced the files on the server or CDN, so the old chunks return 404 (or the SPA fallback returns `index.html`, producing a MIME type error). `lazy` throws, and with no error boundary around it the root unmounts to a blank page.

Verify: reproduce by opening the app, deploying a new build to staging, then navigating to a lazy route.

Fix:

1. Keep previous build assets available for a while (immutable hashed files in object storage, not deleted on deploy). This is the real fix.
2. Never serve `index.html` for missing `.js` files; return a real 404.
3. Add error boundaries around lazy routes that show a friendly "A new version is available, reload" message.
4. Optionally retry the import once, then do a full reload guarded against loops:

```jsx
function lazyWithReload(factory) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (!sessionStorage.getItem('chunk-reloaded')) {
        sessionStorage.setItem('chunk-reloaded', '1');
        window.location.reload();
      }
      throw err;
    }
  });
}
```

5. Vite emits a `vite:preloadError` event you can listen to for the same purpose.

Prevent: alert on chunk-load error rates per release, and have the service worker (if any) handle version updates explicitly.

Wrong answer: disabling code splitting, which trades a deploy problem for slower first loads for everybody.

### Your marketing site built with React has a poor Largest Contentful Paint on mobile. What do you investigate?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react-dom/preload -->
Observe: use field data (CrUX, RUM) to confirm the problem is real for users, then a Lighthouse or WebPageTest run with mobile throttling. Identify the LCP element (usually a hero image or heading) and break LCP into its phases: time to first byte, resource load delay, resource load time and render delay.

Hypothesise based on the breakdown:

1. Client-only rendering: the HTML is an empty `<div id="root">`, so nothing renders until the JavaScript bundle downloads, parses and executes. Huge render delay.
2. The hero image is discovered late because it is set by a component after hydration or via CSS background.
3. The bundle is large: everything is in one chunk, including libraries only used on other pages.
4. Web fonts block text rendering.

Fix:

- Server-render or statically generate the page (Next.js, React Router framework mode, Astro with React islands) so HTML contains content.
- Make the hero a real `<img>` with `fetchpriority="high"`, explicit width and height, modern formats, and preload it if it is discovered late (`preload(src, { as: 'image', fetchPriority: 'high' })` in React 19).
- Code-split routes and below-the-fold widgets with `lazy`; remove heavy dependencies (moment-style date libraries, full icon packs); analyse the bundle.
- Use `font-display: swap` and preload the main font.
- Defer third-party scripts until after load.

Verify: compare the LCP phase breakdown before and after, and confirm with field data over the following weeks.

Prevent: performance budgets in CI (bundle size limits, Lighthouse CI).

Wrong answer: adding `memo` everywhere. Re-render optimisation rarely affects LCP, which is dominated by loading.

### Users complain that clicking "Add to cart" feels slow even though the API is fast. INP is 450 ms. How do you diagnose it?
<!-- level: advanced; kind: scenario; ref: https://react.dev/reference/react/useTransition -->
Observe: Interaction to Next Paint measures the delay from the click to the next frame painted. Record the interaction in Chrome DevTools Performance with CPU throttling. React 19.2's Performance Tracks show which components rendered in which lane. Look for a long task after the click and break it into input delay, processing time and presentation delay.

Hypothesise common causes:

1. The click updates a cart context consumed by hundreds of components, causing a huge synchronous re-render.
2. Heavy synchronous work in the handler: analytics SDK calls, recomputing recommendations, `JSON.stringify` of big state into localStorage.
3. Input delay from unrelated long tasks (third-party scripts, hydration still running).

Verify by timing each part: wrap the handler in `performance.mark`, and use the Profiler to count rendered components.

Fix:

1. Give immediate feedback with a small urgent update (button shows "Added"), and mark the expensive update as non-urgent:

```jsx
function onAdd() {
  setJustAdded(true);                          // urgent, tiny
  startTransition(() => cartStore.add(item));  // can be interrupted
}
```

2. Narrow subscriptions so only the cart badge and the cart drawer re-render (selectors in an external store, or split contexts).
3. Move non-UI work out of the critical path: send analytics with `requestIdleCallback` or `navigator.sendBeacon` after paint, debounce persistence.
4. If hydration causes input delay, reduce client JavaScript (Server Components, smaller bundles) so the page becomes interactive sooner.

Verify again with field INP from RUM; lab results alone can mislead.

Prevent: track INP per route in monitoring, and review high-fan-out state changes.

Wrong answer: optimising the API, which is not on the critical path for the next paint.

### A "like" button with optimistic updates sometimes shows the wrong count after quick repeated clicks. How do you fix it?
<!-- level: advanced; kind: scenario; ref: https://react.dev/reference/react/useOptimistic -->
Observe: clicking like, unlike, like rapidly ends with a count of 2 instead of 1, or the heart flickers back to the old state when a response arrives.

Hypothesise: the component keeps a local copy of `likes` and `liked` and updates it optimistically, then overwrites it with each server response. Responses can arrive out of order, and each one reflects the server state at its own time. An older response (from the first like) can overwrite the newer optimistic state. Also, the server may receive toggle requests rather than an absolute desired state, so retries double-count.

Verify: throttle the network in DevTools and add random latency to the API in a local mock; log request order versus response order.

Fix:

1. Make the operation idempotent: send the desired state (`PUT /posts/1/like { liked: true }`), not "toggle".
2. Serialise or cancel: keep only the latest intent. Use `useOptimistic` inside an action so React shows the optimistic value only while the transition is pending, and render the confirmed state afterwards:

```jsx
const [optimistic, setOptimistic] = useOptimistic(
  { liked, count },
  (s, nextLiked) => ({ liked: nextLiked, count: s.count + (nextLiked ? 1 : -1) })
);

function toggle() {
  startTransition(async () => {
    const next = !optimistic.liked;
    setOptimistic(next);
    const confirmed = await setLike(postId, next); // returns server truth
    startTransition(() => onConfirmed(confirmed));
  });
}
```

3. With TanStack Query, cancel in-flight queries in `onMutate`, snapshot previous data for rollback in `onError`, and invalidate in `onSettled`.
4. Ignore responses whose request id is older than the latest one.

Prevent: test with artificial latency and out-of-order responses (MSW handlers with random delays).

Wrong answer: disabling the button for the full round trip. It is correct but defeats the purpose of optimistic UI.

### Customers occasionally get charged twice because the payment form is submitted twice. What do you change in React and beyond?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react/useActionState -->
Observe: duplicate orders with the same cart within a second, more often on slow mobile networks. Logs show two POST requests.

Hypothesise: users double-click or tap again because nothing visible happens; the button is not disabled during submission; or Enter in a field plus a click both submit. Network retries by a proxy are also possible.

Fix at two layers.

Client (reduces likelihood):

```jsx
function PayForm({ orderId }) {
  const [state, action, isPending] = useActionState(payAction, { error: null });
  return (
    <form action={action}>
      <input type="hidden" name="idempotencyKey" value={orderId} />
      <CardFields />
      <button disabled={isPending} aria-busy={isPending}>
        {isPending ? 'Processing…' : 'Pay ₹1,499'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
```

Form actions with `useActionState` queue submissions and expose `isPending`; disabling the button and showing progress stops most double taps. Without React 19, keep a ref flag set synchronously in the handler, because state updates are not visible until the next render and two fast clicks can both pass a state check.

Server (the real guarantee): require an idempotency key per checkout attempt, generated once when the checkout session is created, not per click. The payment endpoint stores the key and returns the original result for repeats. Payment providers such as Stripe support idempotency keys natively.

Verify: an end-to-end test that double-clicks with network throttling and asserts one charge.

Prevent: treat every mutating endpoint as possibly called twice.

Wrong answers: only disabling the button (JavaScript may not be loaded yet, users can refresh, networks retry), or generating the idempotency key at click time, which gives each click a different key.

### Design a search-as-you-type autocomplete that hits an API. What do you consider?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/learn/synchronizing-with-effects#fetching-data -->
Requirements to clarify: minimum characters, expected latency, result count, keyboard navigation, mobile behaviour, caching expectations.

Design:

1. Input state is urgent and local. The query sent to the API is debounced (around 200–300 ms) to cut request volume.
2. Cancel stale requests to avoid race conditions where an older, slower response overwrites newer results. A data library keyed by query does this for you and caches previous queries, so backspacing is instant.

```jsx
function useSuggestions(text) {
  const query = useDebouncedValue(text.trim(), 250);
  return useQuery({
    queryKey: ['suggest', query],
    queryFn: ({ signal }) =>
      fetch(`/api/suggest?q=${encodeURIComponent(query)}`, { signal }).then(r => r.json()),
    enabled: query.length >= 2,
    staleTime: 60_000,
    placeholderData: prev => prev, // keep old results while loading
  });
}
```

3. Show previous results dimmed while loading rather than flashing an empty list.
4. Accessibility: implement the ARIA combobox pattern — `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant` for the highlighted option, arrow keys, Enter and Escape — and announce result counts with a polite live region. A headless library (Downshift, React Aria) saves weeks.
5. Encode the query, and on the server rate-limit and cap result size.
6. Highlight matches with text splitting, not by injecting HTML.

Verify: test with throttled network, fast typing, IME composition (Chinese/Japanese input should not trigger searches mid-composition), and screen readers.

Wrong answers: fetching in an effect on every keystroke without cancellation, or debouncing the input's displayed value so typing lags.

### An infinite-scroll feed shows duplicate posts and jumps when new items load. How do you fix it?
<!-- level: advanced; kind: scenario; ref: https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key -->
Observe: duplicates appear after scrolling quickly; React warns about duplicate keys; the scroll position jumps when images load or when new posts are prepended.

Hypothesise several separate bugs:

1. Offset pagination (`?page=3`) while new posts are being created shifts items between pages, so the same post appears on two pages.
2. The intersection observer fires several times before the first request completes, loading the same page twice.
3. Keys use the array index, so prepending posts reassigns keys and remounts rows.
4. Images without dimensions cause layout shifts above the viewport.

Verify: log page requests and post ids; check for duplicate requests in the network tab.

Fix:

- Use cursor pagination (`?after=<lastPostId>`), which is stable under inserts.
- Use a library that guards concurrent fetches, for example TanStack Query's `useInfiniteQuery`, and only trigger `fetchNextPage` when `!isFetchingNextPage`.
- Key rows by post id, and deduplicate when merging pages:

```jsx
const posts = useMemo(() => {
  const seen = new Set();
  return data.pages.flatMap(p => p.items).filter(p => !seen.has(p.id) && seen.add(p.id));
}, [data]);
```

- Reserve image space with `width`/`height` or `aspect-ratio` CSS.
- For new posts arriving at the top, show a "5 new posts" button instead of inserting them under the user's finger. CSS `overflow-anchor` also helps keep scroll position.
- For very long feeds, virtualise with a library that supports dynamic heights.

Prevent: an end-to-end test that scrolls quickly with a delayed API and asserts unique post ids.

Wrong answer: suppressing the duplicate key warning by appending the index to the key.

### Every Redux state change re-renders hundreds of components. How do you approach it?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react/useSyncExternalStore -->
Observe: Profiler shows many components rendering on each dispatch, including ones whose displayed data did not change.

Hypothesise selector problems. `useSelector` re-renders a component when the value returned by its selector changes by reference (strict equality). Common causes:

1. Selecting a large slice: `useSelector(s => s.orders)` re-renders on any order change.
2. Selectors that create new objects or arrays every call: `useSelector(s => s.orders.filter(o => o.open))` returns a new array every time, so it always "changes" and the component re-renders on every dispatch, even unrelated ones.
3. Returning an object literal `{ a: s.a, b: s.b }` without a shallow equality function.
4. Reducers that recreate unchanged parts of the state tree.

Verify: React-Redux warns in development when a selector returns a different reference for the same input. Log selector outputs.

Fix:

```js
import { createSelector } from '@reduxjs/toolkit';

const selectOrders = s => s.orders.entities;
export const selectOpenOrders = createSelector([selectOrders], orders =>
  Object.values(orders).filter(o => o.status === 'open')
);

// In a row, select just one entity by id
const order = useSelector(s => s.orders.entities[id]);
const { name, email } = useSelector(s => ({ name: s.user.name, email: s.user.email }), shallowEqual);
```

- Normalise state (`createEntityAdapter`) so lists hold ids and rows select their own entity.
- Pass ids to list rows rather than full objects, so a row re-renders only when its own entity changes.
- Use Redux Toolkit (Immer) so untouched branches keep their references.
- Move server data to RTK Query instead of hand-written slices.

Prevent: lint for inline object-returning selectors and keep the dev-mode selector checks on.

Wrong answer: wrapping everything in `memo`. Components subscribed through `useSelector` re-render due to their own subscription, which `memo` does not stop.

### You are migrating a client-rendered React SPA to the Next.js App Router with Server Components. How do you decide what becomes a Server Component?
<!-- level: advanced; kind: scenario; ref: https://react.dev/reference/rsc/use-client -->
Start from the principle: everything is a Server Component by default; add `'use client'` only where you need state, effects, event handlers, browser APIs, or client-only libraries. Keep the client boundary as low in the tree as possible.

Approach:

1. Migrate incrementally. Next.js lets the old Pages Router and the App Router coexist; move one route at a time. Initially you can mount the existing SPA inside a single client component on a catch-all route, then peel pages out.
2. For each page, classify components:
   - Data display, layouts, markdown, tables without interactivity: server.
   - Forms, dropdowns, modals, anything with `useState` or `onClick`: client leaves.
   - Context providers (theme, query client): a thin client `Providers` component that wraps server-rendered `children`.
3. Move data fetching from `useEffect` and client query hooks into async Server Components where data is read-only; keep TanStack Query for highly interactive client data (polling, infinite scroll), optionally prefetching on the server and hydrating.
4. Convert mutations to Server Functions with validation and authorisation, and revalidate cached data after them.
5. Pass only serialisable, minimal props across the boundary.

```jsx
// app/orders/page.jsx (server)
export default async function OrdersPage() {
  const orders = await getOrdersForCurrentUser();
  return <OrdersTable orders={orders.map(toRowDto)} />;
}
```

Watch out for libraries that use context or browser APIs without a `'use client'` directive (wrap them in your own client file), global CSS-in-JS runtimes that do not support streaming, and `window` access during server rendering.

Verify: bundle size per route, LCP, and that no secrets appear in the RSC payload.

Wrong answer: marking the root layout `'use client'` to make errors go away.

### A security review finds users' email addresses and internal flags in the page's RSC payload. How did it happen and how do you fix it?
<!-- level: advanced; kind: scenario; ref: https://react.dev/reference/rsc/server-components -->
Observe: in the network tab, the RSC response (or the inline script chunks in the HTML) contains full user records: email, role, `isFlaggedForFraud`, sometimes password hashes. These are visible to anyone viewing the page, even though the UI only shows names.

Hypothesise: a Server Component fetched entire database rows and passed them as props to a Client Component, for example `<UserCard user={user} />`. Every prop crossing into a Client Component is serialised and sent to the browser, regardless of what the component renders.

Verify: search the payload for sensitive field names; trace which component boundary they cross.

Fix:

1. Introduce a data access layer that returns DTOs with only the fields the UI needs:

```js
import 'server-only';
export async function getAuthorCard(id) {
  const u = await db.user.findUnique({ where: { id }, select: { id: true, name: true, avatarUrl: true } });
  return u;
}
```

2. Mark data modules with `import 'server-only'` so a client import fails the build.
3. Use React's experimental taint APIs (`experimental_taintObjectReference` on raw user objects, `experimental_taintUniqueValue` on tokens) where your framework enables them, to throw if they are passed to the client.
4. Audit Server Functions too: their return values are also sent to the client, and their arguments come from the client and must be validated and authorised.
5. Rotate anything that may have leaked (tokens, keys).

Prevent: code review checklist for boundary props, automated tests that scan RSC responses for sensitive patterns, and keeping React/framework versions patched (the RSC protocol had critical advisories in late 2025).

Wrong answer: "the component does not render the email, so it is not exposed".

### A charting library re-initialises and flickers every time the parent re-renders. How do you integrate it properly?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/learn/synchronizing-with-effects#controlling-non-react-widgets -->
Observe: each re-render of the dashboard destroys and recreates the chart, animations replay, and zoom state is lost. Profiler shows the wrapper effect running on every commit.

Hypothesise: the effect that creates the chart depends on an `options` object created inline during render (a new reference each time), or has no dependency array at all. Possibly the component also remounts because it is defined inside its parent or because its key changes.

Verify: log in effect setup and cleanup; check whether cleanup runs on every render.

Fix by separating creation from updates:

```jsx
function LineChart({ data, options }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  // Create once per mount
  useEffect(() => {
    const chart = new Chart(containerRef.current, { type: 'line' });
    chartRef.current = chart;
    return () => chart.destroy();
  }, []);

  // Update in place when inputs change
  useEffect(() => {
    const chart = chartRef.current;
    chart.data = data;
    chart.update('none');
  }, [data]);

  useEffect(() => {
    chartRef.current.options = options;
    chartRef.current.update();
  }, [options]);

  return <canvas ref={containerRef} />;
}
```

And stabilise inputs in the parent: memoise `data` and `options` with `useMemo`, or define constant options at module level. Wrap the chart in `memo` so unrelated parent state does not even reach it.

Verify: effect logs show creation once; zoom survives parent re-renders.

Prevent: use the library's official React wrapper if one exists and is maintained, or build one wrapper for the whole team.

Wrong answers: disabling the dependency lint rule to make creation run once while still reading changing props (stale chart), or recreating the chart and hiding the flicker with CSS.

### An input loses focus after every character typed. What is wrong?
<!-- level: basic; kind: scenario; ref: https://react.dev/learn/your-first-component#nesting-and-organizing-components -->
Observe: typing one character works, then focus disappears and the user must click again. React DevTools shows the input component mounting on each keystroke.

Hypothesise the usual causes, all of which make React see a "different" component and remount it:

1. A component is defined inside another component's body. Each render creates a new function, which React treats as a new component type, so it unmounts the old input and mounts a new one.
2. The key changes on each render, for example `key={Math.random()}` or a key derived from the value being typed.
3. A conditional wrapper changes the tree structure as the value changes (for example rendering a different wrapper when the value is empty vs non-empty).

Verify: add a `useEffect(() => console.log('mount'), [])` to the input's component; if it logs on every keystroke, it is remounting.

Fix for the common case:

```jsx
// Wrong
function SignupForm() {
  const [email, setEmail] = useState('');
  function Field() {
    return <input value={email} onChange={e => setEmail(e.target.value)} />;
  }
  return <Field />;
}

// Right: define components at module level and pass props
function Field({ value, onChange }) {
  return <input value={value} onChange={e => onChange(e.target.value)} />;
}
function SignupFormFixed() {
  const [email, setEmail] = useState('');
  return <Field value={email} onChange={setEmail} />;
}
```

Use stable keys from data, and keep the element tree shape stable across renders.

Prevent: lint rules such as `react/no-unstable-nested-components` catch nested definitions.

Wrong answer: calling `inputRef.current.focus()` in an effect after every render, which hides the remount and still loses cursor position and IME state.

### Your test suite is flaky and prints "An update to X inside a test was not wrapped in act(...)". How do you fix the tests?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react/act -->
Observe: tests pass locally and fail in CI randomly, often with the act warning and assertions failing on missing text.

Hypothesise: the component performs asynchronous work (fetch, timers, transitions) that updates state after the test's assertions have already run, or after the test finished. The warning means React processed an update outside a scope where the test was waiting for it. Flakiness comes from timing differences between machines.

Verify: find which update triggers the warning (the warning names the component) and which async operation causes it.

Fix:

1. Wait for the final UI state instead of asserting immediately. Use `findBy*` queries or `waitFor` for things that appear asynchronously:

```jsx
render(<Profile id="7" />);
expect(await screen.findByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
```

2. Await `user-event` calls (`await user.click(...)`); forgetting `await` is a very common cause.
3. Mock network with MSW so responses are deterministic, and make sure every request a component makes has a handler.
4. With fake timers, advance them inside `act`, and configure `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.
5. If a component updates after the test ends (polling, delayed toast), unmount it or wait for it, and make sure effects clean up their timers.

Prevent: fail the test run on console errors so act warnings cannot accumulate, and avoid arbitrary sleeps.

Wrong answers: wrapping everything in `act` blindly, which can hide real problems, or adding `setTimeout` waits.

### A bug occurs only in production with a minified "Minified React error #418" message. How do you debug it?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react-dom/client/hydrateRoot -->
Observe: production bundles strip React's long error messages. The error code links to react.dev's error decoder, which expands the full message. Error 418 and similar codes relate to hydration mismatches (text or structure differs between server HTML and client render).

Steps:

1. Decode the message via the link in the console, and check whether it is a hydration, render or effect error.
2. Get readable stack traces: upload source maps to your error tracker (Sentry, Datadog) during the build instead of publishing them publicly, so stacks map to real files and component names. React 19.1+ also exposes owner stacks in development, which help reproduce.
3. Capture context: React 19's `onRecoverableError`, `onCaughtError` and `onUncaughtError` root options let you report errors with component stacks centrally.
4. Reproduce locally with a production build (`vite build && vite preview` or `next build && next start`), because some behaviour differs from development.
5. Bisect: compare server HTML (view-source) with client DOM, check environment-dependent rendering (dates, locale, `window`, feature flags read differently on server and client), and test with browser extensions disabled — extensions such as translators and password managers frequently modify the DOM before hydration.

Fix the root cause (deterministic render, client-only values set after mount).

Prevent: monitor error rates per release, include release ids in error reports, and run end-to-end tests against production builds.

Wrong answer: switching to the development build in production to see messages. It is much slower and leaks implementation details.

### Your server-rendered app flashes light mode before switching to the user's dark theme. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react-dom/components/script -->
Observe: on load, the page paints with the light theme and switches after hydration, a flash that annoys users and can affect accessibility for light-sensitive users.

Hypothesise: the theme preference lives in `localStorage`, which the server cannot read. The server renders the default theme, and a React effect applies the stored preference only after hydration, at least one paint later.

Fix options:

1. Store the preference in a cookie. The server reads it and renders `<html data-theme="dark">` directly, so the first paint is correct. This is the most robust option.
2. If you must use `localStorage` or the system preference, run a tiny blocking inline script in the `<head>` before the body is parsed, which sets the attribute before first paint:

```html
<script>
  try {
    const t = localStorage.getItem('theme') ??
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = t;
  } catch {}
</script>
```

3. Drive colours with CSS variables keyed on `[data-theme]` and the `prefers-color-scheme` media query, so the theme does not require React to render at all.
4. Because the attribute is set before React hydrates, put `suppressHydrationWarning` on `<html>` (that attribute legitimately differs), and read the current theme in React from the DOM or a cookie.

Verify: throttle the CPU and disable cache; the first frame in a performance recording should already show the right theme.

Prevent: treat any user preference that affects first paint (theme, locale, reduced motion) as server-readable state.

Wrong answer: hiding the page until hydration completes, which delays the first contentful paint for everyone.

### A trading dashboard receives 50 WebSocket messages per second and the UI freezes. How do you design the updates?
<!-- level: advanced; kind: scenario; ref: https://react.dev/reference/react/useSyncExternalStore -->
Observe: each message calls `setState` on a top-level component, causing up to 50 full-tree renders per second; the main thread is permanently busy and inputs lag.

Hypothesise: render frequency is driven by network frequency rather than display frequency, and each update re-renders everything because state lives at the top.

Design:

1. Decouple data from rendering. Keep incoming ticks in an external store outside React (a plain object or a small store such as Zustand), updated on every message without rendering.
2. Batch to frames. Notify subscribers at most once per animation frame (or every 100–250 ms for numbers humans read), coalescing the latest value per symbol:

```js
const latest = new Map();
let scheduled = false;
socket.onmessage = e => {
  const t = JSON.parse(e.data);
  latest.set(t.symbol, t);
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; store.applyBatch(latest); latest.clear(); });
  }
};
```

3. Subscribe granularly. Each row subscribes to its own symbol through `useSyncExternalStore` or a selector, so only changed rows re-render.
4. Virtualise the table so only visible rows exist.
5. For high-frequency charts, draw on a canvas imperatively from the store instead of rendering SVG elements through React.
6. Move parsing or aggregation into a Web Worker if JSON handling itself is expensive.

Verify: Performance panel shows short frames and a stable 60 fps; INP remains low during bursts.

Trade-offs: batching adds up to one frame of latency, acceptable for display. Keep exact data in the store for calculations.

Wrong answers: `useTransition` alone (it cannot keep up with a continuous flood), or `memo` without fixing subscription granularity.

### Two independently deployed React micro-frontends must live on one page. What problems do you anticipate?
<!-- level: advanced; kind: scenario; ref: https://react.dev/reference/react-dom/client/createRoot -->
Clarify first: do they really need to be independent deployments, or would a monorepo with shared build suffice? Micro-frontends solve organisational problems at a technical cost.

Problems and approaches:

1. Multiple React copies. If each bundle includes its own React, you pay the download twice, and hooks fail with "invalid hook call" if a component from one bundle renders inside the other's tree. Either share a single React instance (Module Federation `shared` with `singleton: true`, or import maps) and align versions, or keep each app in its own root with no component sharing.
2. Mounting. Each micro-frontend exposes `mount(el, props)` and `unmount()`, creating its own root with `createRoot`, and must clean up completely on unmount:

```js
export function mount(el, props) {
  const root = createRoot(el);
  root.render(<CheckoutApp {...props} />);
  return () => root.unmount();
}
```

3. Communication. Avoid sharing React context across roots; use a small, versioned contract: custom DOM events, a URL convention, or a shared event bus.
4. Routing. Decide which app owns the URL; nested apps should use memory routing or a base path.
5. Styling collisions: CSS modules, prefixed class names or Shadow DOM.
6. Performance: duplicate libraries, multiple hydration passes, and waterfalls loading remote entries.
7. Errors: each root needs its own error boundaries and monitoring tags.

Verify with an integration environment that loads the real deployed versions together, and contract tests on the mount API.

Wrong answer: "just render the other team's components directly", which couples deployments and breaks if React versions differ.

### You are building a shared design-system component library in React. What design decisions matter most?
<!-- level: advanced; kind: scenario; ref: https://react.dev/learn/sharing-state-between-components#controlled-and-uncontrolled-components -->
Key decisions:

1. Accessibility by default. Build on native elements (`<button>`, `<dialog>`, `<input>`), implement WAI-ARIA patterns for complex widgets (combobox, tabs, menu), or build on a headless library such as React Aria or Radix and add your styling.
2. Controlled and uncontrolled modes. Components with state (Tabs, Accordion, Select) should accept `value`/`onChange` for control and `defaultValue` for uncontrolled use:

```tsx
function Tabs({ value, defaultValue, onValueChange, children }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;
  const select = (v: string) => {
    if (!isControlled) setInternal(v);
    onValueChange?.(v);
  };
  return <TabsContext value={{ current, select }}>{children}</TabsContext>;
}
```

3. Pass-through props and refs. Spread remaining native props onto the root element and accept `ref` (a normal prop in React 19) so consumers can focus or measure.
4. Composition APIs (compound components like `<Tabs.List>`, slots via props) instead of dozens of boolean flags.
5. Styling strategy compatible with Server Components and streaming: CSS modules, vanilla-extract, Tailwind, or CSS variables for theming, rather than runtime CSS-in-JS that needs client context.
6. Mark interactive components with `'use client'` inside the library so they work in RSC apps, while keeping purely presentational ones server-compatible.
7. Tree-shakeable ESM builds, `react` as a peer dependency, typed APIs, Storybook docs, visual regression and axe tests.
8. Semantic versioning and codemods for breaking changes.

Wrong answers: exposing only controlled components (painful for simple use) or copying ARIA attributes without implementing keyboard behaviour.

### Users lose half-written notes when switching between tabs in your app. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react/Activity -->
Observe: each tab is rendered conditionally (`{tab === 'notes' && <Notes />}`); switching away unmounts the Notes editor and its state disappears.

Hypothesise: state is tied to the component's position in the tree; unmounting destroys it. That is expected React behaviour.

Options, with trade-offs:

1. Lift the draft state up to the parent (or a store) that stays mounted. Simple and explicit, but the parent re-renders on each keystroke unless the state is in a store with granular subscriptions.
2. Keep the tab mounted but hidden. With React 19.2+, use `<Activity>`:

```jsx
<Activity mode={tab === 'notes' ? 'visible' : 'hidden'}>
  <Notes />
</Activity>
<Activity mode={tab === 'files' ? 'visible' : 'hidden'}>
  <Files />
</Activity>
```

Hidden trees keep state and DOM (including scroll position and textarea content), their effects are cleaned up so they stop subscriptions while hidden, and they re-render at low priority. Older alternative: CSS `hidden`, which keeps effects running.

3. Persist drafts: save to `localStorage` or the server on change (debounced), restoring on mount. This also survives reloads and crashes, which users expect from a notes app.
4. Put the active tab in the URL so reload and back navigation restore context.

Verify: switch tabs repeatedly with typed content, reload, and check that effects (autosave timers) do not run while hidden.

Combining 2 and 3 is often best: Activity for instant switching, persistence for durability.

Wrong answer: keeping all tabs mounted and visible with CSS while timers and subscriptions in hidden tabs keep consuming resources, or storing a big draft in context that re-renders the entire app per keystroke.

### Where should a React single-page app store authentication tokens, and how do you protect against XSS and CSRF?
<!-- level: advanced; kind: scenario; ref: https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html -->
Context: the question is not really about React, but React developers own much of the attack surface.

Options:

1. `localStorage` with a bearer token: simple, but any XSS can read the token and exfiltrate it, giving attackers long-lived access from their own machines.
2. In-memory token (a variable or React state) plus a refresh token in an `HttpOnly`, `Secure`, `SameSite` cookie: XSS can still make requests while the page is open, but cannot steal a durable credential. Reloads call a refresh endpoint.
3. Backend-for-frontend (BFF): the browser holds only an `HttpOnly` session cookie; a server (often the same Next.js or React Router server) holds tokens and calls APIs. This is the current recommendation for sensitive apps (it is the pattern the OAuth browser-based apps guidance favours).

CSRF: cookies are sent automatically, so cookie-based auth needs `SameSite=Lax` or `Strict`, plus anti-CSRF tokens or checking `Origin` headers for state-changing requests. Server Functions in frameworks typically check the origin, but verify your framework's behaviour.

XSS defences on the React side:

- Never pass unsanitised content to `dangerouslySetInnerHTML`; sanitise with DOMPurify.
- Validate URLs before rendering `href`/`src` from user input (block `javascript:`).
- Use a strict CSP with nonces.
- Audit dependencies, since a compromised npm package is effectively XSS.

```js
// Fetch with cookie session; no token handling in JS at all
await fetch('/bff/orders', { credentials: 'include', headers: { 'X-CSRF-Token': csrf } });
```

Trade-offs: BFF adds a server hop and infrastructure, but removes token handling from the browser.

Wrong answer: "HttpOnly cookies make XSS harmless". They protect the token, not the user's session while the malicious script runs.

### A product gallery with hundreds of images scrolls poorly and uses lots of memory on phones. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react-dom/components/link -->
Observe: Performance panel shows long image decode tasks and layout shifts; memory climbs; network shows full-resolution images downloaded for thumbnail slots.

Hypothesise:

1. Images are not sized for their slots (a 3000 px original in a 200 px tile).
2. All images load eagerly, competing for bandwidth with the visible ones.
3. Missing dimensions cause layout shifts and re-layout.
4. Hundreds of DOM nodes and React components exist even when off-screen.

Fix:

- Serve responsive images: `srcSet` and `sizes`, modern formats (AVIF/WebP) through an image CDN or framework image component.
- Lazy-load off-screen images with `loading="lazy"` and `decoding="async"`; only the first row gets `fetchPriority="high"`.
- Always set `width` and `height` (or CSS `aspect-ratio`) to reserve space.
- Virtualise the grid for very large collections, or paginate.
- Memoise tiles so selection changes re-render only affected tiles.

```jsx
function Tile({ product, eager }) {
  return (
    <img
      src={product.image.w400}
      srcSet={`${product.image.w200} 200w, ${product.image.w400} 400w, ${product.image.w800} 800w`}
      sizes="(max-width: 600px) 50vw, 200px"
      width={400}
      height={400}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      alt={product.name}
    />
  );
}
```

Verify: compare transferred bytes, CLS and memory before and after on a real mid-range phone.

Prevent: an image component that enforces dimensions and alt text, used everywhere.

Wrong answer: preloading all images to make scrolling smooth, which multiplies memory and bandwidth.

### In an interview you are asked: "Why does React need keys but Vue/Angular templates also ask for them? Could React work without them?" How do you answer?
<!-- level: advanced; kind: scenario; ref: https://react.dev/learn/rendering-lists#why-does-react-need-keys -->
Structure the answer around the underlying problem rather than React trivia.

1. The problem: when a list changes, the framework must map old items to new items to decide what to update, move, create or destroy. Without identity information, it can only match by position.
2. Positional matching works for appends but fails for inserts, deletions and reorders: every item after the change is "updated" with a different item's data. That costs performance, and worse, it attaches per-item state (input values, focus, component state, animations) to the wrong data.
3. Keys provide identity. React's diff (and Angular's `track`, Vue's `:key`) then matches by identity in linear time using a map of keys, detecting moves cheaply.
4. Could React work without them? Yes, by falling back to index matching, which is what happens when you omit keys (React warns and uses the index). For static lists it is fine. For dynamic lists, correctness breaks, as described above.

Then demonstrate with a concrete bug:

```jsx
{todos.map((t, i) => (
  <li key={i}>
    <input defaultValue={t.title} />
  </li>
))}
// Delete the first todo: the first <input> now shows the deleted todo's text,
// because instance 0 was reused for the second todo.
```

5. Edge cases worth mentioning: keys must be stable (not random), unique among siblings, and changing a key deliberately resets a component, which is a useful technique.

What interviewers look for: understanding identity versus position, the state-preservation consequence, and the deliberate reset trick. Common weak answer: "keys are for performance" only.

### A client asks you to make their React app work offline for field engineers. How do you approach it?
<!-- level: advanced; kind: scenario; ref: https://react.dev/reference/react/useSyncExternalStore -->
Clarify requirements: which features must work offline (read-only lookup vs creating records), how long users are offline, conflict rules when two people edit the same record, and storage size limits.

Architecture:

1. App shell caching: a service worker (Workbox, or the PWA plugin for your bundler) precaches HTML, JS and CSS so the app opens without network. Plan update flows so users do not get stuck on old versions.
2. Local data store: IndexedDB (via Dexie or idb) holds the working set. Reads go to the local store first; the UI renders from local data.
3. Write queue: mutations are written locally and appended to an outbox with idempotency keys. A sync process replays them when online (Background Sync where supported, otherwise on `online` events and app start).
4. Conflict resolution: last-write-wins for simple fields, server-side version checks (`If-Match` with ETags) and a user-facing conflict screen for important records.
5. Connectivity in UI: subscribe to online status with `useSyncExternalStore`, show sync status and pending counts.

```jsx
function SyncBadge() {
  const online = useOnlineStatus();
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;
  return <span role="status">{online ? (pending ? `Syncing ${pending}…` : 'Synced') : `Offline · ${pending} queued`}</span>;
}
```

TanStack Query can persist its cache and pause mutations while offline, which covers simpler cases.

Verify: test with DevTools offline mode, flaky network, app restarts mid-sync, and two devices editing the same record.

Wrong answers: relying only on HTTP caching, or storing everything in `localStorage` (synchronous, small and string-only).
