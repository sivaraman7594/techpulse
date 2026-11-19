### A search box fires an HTTP request on every keystroke and results sometimes appear out of order. How would you fix it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/http -->
**Observe.** In the Network tab you see one request per character, and a slow response for "ang" arrives after the response for "angular", so stale results overwrite fresh ones.

**Hypothesise.** The component subscribes inside the input handler, so every call starts an independent request with no cancellation or ordering guarantee.

**Verify.** Throttle the network to Slow 3G and type quickly; reproduce the stale overwrite. Log the query next to each response.

**Fix.** Turn the input into a stream and let `switchMap` cancel the superseded request.

```ts
results$ = this.query.valueChanges.pipe(
  debounceTime(300),
  map(q => q.trim()),
  distinctUntilChanged(),
  switchMap(q => q.length < 2 ? of([]) : this.http.get<Item[]>('/api/search', { params: { q } })),
);
```

Render with the `async` pipe so unsubscription is automatic.

**Prevent.** Put the pattern in a shared search service and add a marble test with `TestScheduler` covering rapid typing.

**Common wrong answers.** Using `mergeMap` (keeps all requests and order is still racy), only adding debounce (still races), or manually keeping a "latest request id" flag when `switchMap` already does this.

### After upgrading, a component using OnPush no longer updates when you mutate an array in the parent. What is going on?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/best-practices/runtime-performance -->
**Observe.** The parent calls `items.push(x)`; the child, which is `OnPush`, shows the old list. A click inside the child refreshes it.

**Hypothesise.** `OnPush` re-checks only when an input reference changes, an event fires in the component, an `async` pipe emits, a signal read in the template changes, or `markForCheck` is called. Mutation keeps the same reference.

**Verify.** Log `items === previousItems` in `ngOnChanges`; it is true. Temporarily switch the child to `Default` and the problem disappears.

**Fix.** Treat inputs as immutable.

```ts
this.items = [...this.items, x];
// or with signals
items = signal<Item[]>([]);
items.update(list => [...list, x]);
```

**Prevent.** Prefer signals for state so the template tracks reads automatically, and enable a lint rule or code-review rule against mutating inputs.

**Common wrong answers.** Calling `detectChanges()` everywhere, switching everything back to `Default`, or injecting `ChangeDetectorRef` in the parent to force the child (works accidentally but hides the design flaw).

### ExpressionChangedAfterItHasBeenCheckedError appears only in dev mode. How do you diagnose and fix it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/best-practices/runtime-performance -->
**Observe.** The console shows the error with the binding, old value and new value. It only appears in development because Angular runs a second verification pass there.

**Hypothesise.** Something changes state during or after the parent's check but before the child finishes: a child updating a parent property in `ngAfterViewInit`, a getter returning a new value each call (like `new Date()` or a random id), or a service value changed during rendering.

**Verify.** Read the reported binding, find its source, and check whether it is a getter or is mutated in a lifecycle hook.

**Fix.** Make the value stable and update it earlier. Replace impure getters with a field or a `computed()`. If a child must notify the parent, emit an output or write to a signal in an event handler rather than during the view hooks. As a last resort, schedule the update in a microtask or use `afterNextRender`.

**Prevent.** Keep templates side-effect free and derive values with `computed`.

**Common wrong answers.** Wrapping in `setTimeout` without understanding the cause, or disabling dev-mode checks with `enableProdMode`, which only hides the symptom and leaves inconsistent UI.

### A route guard redirects to login in a loop for authenticated users on page refresh. How do you debug it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/routing -->
**Observe.** After a hard refresh the URL flips between `/login` and `/dashboard`. In-app navigation works.

**Hypothesise.** The guard reads auth state synchronously, but the token is restored asynchronously (storage, silent refresh), so on first navigation the state is still "unknown" and treated as logged out. Login then redirects back, causing the loop.

**Verify.** Log the auth state inside the guard on first run; add a breakpoint to see the guard fires before the session restore completes.

**Fix.** Make the guard wait for initialisation, and return a `UrlTree` rather than calling `navigate`.

```ts
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ready$.pipe(
    filter(Boolean), take(1),
    map(() => auth.loggedIn() ? true : router.createUrlTree(['/login']))
  );
};
```

Alternatively restore the session in `provideAppInitializer`.

**Prevent.** Model auth state as three values (unknown, in, out) and test the refresh path.

**Common wrong answers.** Adding a `setTimeout` delay or storing a boolean in `localStorage` and trusting it without validating the token.

### Initial bundle size jumped by 600 KB after a PR. How do you find what caused it and reduce it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/tools/cli/build -->
**Observe.** The CI budget fails or the build output shows `main.js` grew sharply.

**Hypothesise.** A heavy library was imported at top level (charting, moment with locales, lodash whole), a lazy feature was imported eagerly, or a shared barrel file pulls everything in.

**Verify.** Build with stats and inspect the output.

```bash
ng build --stats-json
npx source-map-explorer dist/app/browser/main-*.js
```

Compare against the previous commit; look at what the PR imported.

**Fix.** Load the feature with `loadComponent`/`loadChildren`, wrap rarely used widgets in `@defer`, import specific functions (`lodash-es/debounce`), replace large libs with lighter ones, and remove barrel re-exports that defeat tree shaking.

**Prevent.** Set `budgets` in `angular.json` so CI fails on regression, and review the stats diff for dependency PRs.

**Common wrong answers.** Enabling compression only (transfer size drops but parse cost stays), or assuming lazy routes are automatically used when a component is also referenced from an eager module.

### Two components need the same data and each triggers its own HTTP call. How do you avoid duplicate requests?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/http -->
**Observe.** The Network tab shows the same GET twice on page load.

**Hypothesis.** Each component injects `HttpClient` and calls the endpoint independently. Cold observables fire once per subscription.

**Verify.** Count subscriptions; add a `tap(() => console.log('fetch'))`.

**Fix.** Centralise in a service and share the result.

```ts
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private http = inject(HttpClient);
  readonly profile$ = this.http.get<Profile>('/api/me').pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
```

For a signal-based approach, use `httpResource` (Angular 19+ experimental, check your version) or `toSignal` on the shared stream. For cross-request caching, add an interceptor with a keyed cache and an invalidation rule.

**Prevent.** Rule: components never call `HttpClient` directly; add a test asserting a single request with `HttpTestingController`.

**Common wrong answers.** `share()` without a replay (late subscribers miss the value), storing data in a global variable, or caching forever with no invalidation after mutations.

### A form shows validation errors immediately on load, annoying users. How would you change the UX without losing validation?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/forms/reactive-forms -->
**Observe.** Required fields are red before the user has typed anything.

**Hypothesise.** The template shows errors whenever `control.invalid`, and validators run on creation.

**Verify.** Inspect `control.touched`, `dirty`, and `errors` in the template with a debug binding.

**Fix.** Show messages only after interaction, or after submit.

```html
@if (email.invalid && (email.touched || submitted())) {
  <p class="error">{{ message(email) }}</p>
}
```

Keep validators active so the submit button logic and `form.valid` remain correct. For cross-field rules put the validator on the `FormGroup`. If validation is expensive or hits the server, use an async validator and `updateOn: 'blur'`.

**Prevent.** Build a reusable error component that implements this rule once, and test the touched/untouched states.

**Common wrong answers.** Removing validators until submit (the form state becomes misleading) or disabling the submit button with no explanation.

### Your Angular SSR page flashes and re-renders on the client, and the console warns about hydration mismatch. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/hydration -->
**Observe.** The server HTML is replaced after load, with a warning like NG0500 series (hydration mismatch) naming a node.

**Hypothesise.** The DOM produced on the client differs from the server: direct DOM manipulation, `window`-dependent branches, invalid HTML nesting (like `<div>` inside `<p>`), or time/random values rendered in the template.

**Verify.** Compare "view source" with the rendered DOM, read the warning path, and search for `document`, `window`, `localStorage`, `Math.random`, `Date.now` in that component.

**Fix.** Guard browser-only code with `afterNextRender` or `isPlatformBrowser`, use Angular APIs (Renderer2, bindings) instead of manual DOM edits, fix HTML nesting, and for unavoidable mismatches add `ngSkipHydration` on that element as a stopgap.

```ts
constructor() {
  afterNextRender(() => this.chart.init(this.el.nativeElement));
}
```

**Prevent.** Run an SSR smoke test in CI and treat hydration warnings as failures.

**Common wrong answers.** Turning off hydration globally or wrapping everything in `ngSkipHydration`.

### A memory leak appears in a dashboard that opens and closes many dialogs. How do you find and fix it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/api/core/DestroyRef -->
**Observe.** Heap grows after each open/close cycle and does not drop after garbage collection.

**Hypothesise.** Dialog components subscribe to long-lived streams (a store, `interval`, `fromEvent(window)`), register global listeners, or are retained by a service holding references.

**Verify.** In Chrome DevTools take heap snapshots before and after ten cycles, compare, and filter for the component's class name; the retainers panel shows who holds them.

**Fix.** Tie subscriptions to the component lifetime.

```ts
private destroyRef = inject(DestroyRef);
constructor() {
  this.store.updates$
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe(u => this.apply(u));
}
```

Prefer the `async` pipe or `toSignal`, which clean up themselves. Remove manual listeners in `ngOnDestroy`, and clear timers.

**Prevent.** Add a lint rule for bare `.subscribe()` and a repeat-cycle memory test in e2e.

**Common wrong answers.** Calling `unsubscribe` only in some branches, or assuming `HttpClient` calls always leak (they complete, so they usually do not).

### You must migrate a large NgModule app to standalone components without freezing feature work. How would you approach it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/reference/migrations/standalone -->
**Observe.** Hundreds of components across many modules; the team ships weekly.

**Hypothesise.** A big-bang rewrite will cause conflicts. Standalone and NgModules interoperate, so incremental migration is safe.

**Verify.** Upgrade to a supported Angular version first, ensure tests pass, and confirm the CLI schematic is available.

**Fix.** Use the schematic in its three steps, committing after each:

```bash
ng generate @angular/core:standalone
# choose: convert declarations, then remove unnecessary modules, then bootstrap with bootstrapApplication
```

Migrate leaf modules first (shared UI), then features, then bootstrap. Convert routes to `loadComponent`. Keep a short-lived dual state where modules import standalone components directly.

**Prevent.** Make new code standalone only by default, lint for `NgModule` in new files, and track remaining modules on a dashboard.

**Common wrong answers.** Hand-editing every file, converting the root first (breaks providers), or forgetting that providers defined in modules must move to `app.config.ts` or route providers.

### A parent passes an object input and the child mutates it, causing surprising bugs elsewhere. How do you stop it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/components/inputs -->
**Observe.** Editing a form inside a child changes the list in the parent before "Save" is pressed; cancelling does not revert.

**Hypothesise.** Objects are passed by reference; both components share the same instance.

**Verify.** Compare identity in the child and the parent; mutate in the console to confirm.

**Fix.** Copy on the way in, emit on the way out.

```ts
item = input.required<Item>();
draft = linkedSignal(() => structuredClone(this.item()));
saved = output<Item>();
save() { this.saved.emit(this.draft()); }
```

(`linkedSignal` needs Angular 19+; otherwise copy in `ngOnChanges`.) The parent replaces its list immutably on `saved`.

**Prevent.** Type inputs as `Readonly<Item>` and use `OnPush` so accidental mutation is visible as stale UI during testing.

**Common wrong answers.** Using `JSON.parse(JSON.stringify())` everywhere (breaks dates), or two-way binding the whole object with `model()` without a copy.

### Unit tests are slow and flaky because every component test boots a full module with real HTTP. How do you improve them?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/testing -->
**Observe.** The suite takes minutes; some tests fail depending on order or network.

**Hypothesise.** Tests import large shared modules, call real services, rely on real timers, and reuse state across tests.

**Verify.** Run with a reporter showing durations, and find tests hitting the network.

**Fix.** Provide only what the component needs, with fakes.

```ts
TestBed.configureTestingModule({
  imports: [ProfileComponent],
  providers: [
    provideHttpClient(),
    provideHttpClientTesting(),
    { provide: AuthService, useValue: fakeAuth },
  ],
});
const http = TestBed.inject(HttpTestingController);
```

Use `fakeAsync`/`tick` or `vi`/Jest fake timers instead of real waits, flush and `verify()` HTTP, and test pure logic as plain classes without TestBed.

**Prevent.** Keep a test pyramid: most tests on services and pure functions, a few component tests, a handful of e2e.

**Common wrong answers.** Disabling failing tests, using `setTimeout` waits, or marking everything `async` with `done` callbacks and sleeps.

### A lazy-loaded route shows a blank page for seconds on slow networks. How would you improve perceived performance?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/routing -->
**Observe.** Navigation changes the URL but the screen stays on the old view, then jumps.

**Hypothesise.** The chunk and its data load sequentially: first the JS, then the resolver or component fetch.

**Verify.** Check the waterfall in the Network tab.

**Fix.** Overlap work and give feedback.

- Preload likely routes: `provideRouter(routes, withPreloading(PreloadAllModules))` or a custom strategy using hover or idle.
- Show a progress bar using router events or a signal from `Router.navigated`.
- Start data fetching without waiting for the component, with a resolver that returns quickly or skeleton states in the component.
- Use `withViewTransitions()` for smoother change.

**Prevent.** Set a performance budget for route chunk size and track Largest Contentful Paint.

**Common wrong answers.** Making everything eager (hurts startup) or blocking navigation on slow resolvers with no loading indicator.

### Two services depend on each other and the app throws a circular dependency error at startup. How do you resolve it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/di -->
**Observe.** NG0200 "Circular dependency in DI detected for ServiceA".

**Hypothesise.** `A` injects `B` in its constructor and `B` injects `A`; the injector cannot build either first.

**Verify.** Follow the chain printed in the error; sometimes it passes through a third service or an interceptor.

**Fix.** Break the cycle by design: extract the shared logic into a third service both depend on, or invert the dependency with an event/subject. As a tactical fix, inject lazily.

```ts
private injector = inject(Injector);
get b() { return this.injector.get(ServiceB); }
```

**Prevent.** Keep a layered architecture (UI, facade, data, utilities) where dependencies point one direction; use a lint rule (`eslint-plugin-import` no-cycle) for file-level cycles too.

**Common wrong answers.** Using `forwardRef` (that is for class reference ordering, not instance cycles) or making both `providedIn: 'root'` and hoping.

### Users report that dates display one day earlier for some time zones. What do you investigate?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/api/common/DatePipe -->
**Observe.** A birth date "2024-03-10" shows as March 9 for users west of UTC.

**Hypothesise.** The string is date-only; JavaScript parses it as UTC midnight, and the `date` pipe formats in local time.

**Verify.** In the console compare `new Date('2024-03-10').toString()` under different `TZ` settings.

**Fix.** Treat date-only values as calendar dates, not instants. Either parse as local (`new Date(y, m-1, d)`), or pass an explicit timezone to the pipe.

```html
{{ value | date:'mediumDate':'UTC' }}
```

Better, keep the value as a string and format without converting, or use a date library with a plain-date type. Make the API contract explicit: date-only fields stay date-only, timestamps carry an offset.

**Prevent.** Add tests with `TZ=America/Los_Angeles` and `Pacific/Auckland`.

**Common wrong answers.** Adding a day in code or changing server timezone.

### A global HTTP interceptor adds an auth header, but a third-party API call fails because of it. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/http/interceptors -->
**Observe.** Calls to an external service return 400/CORS errors; your token appears in the request, which is also a security leak.

**Hypothesise.** The interceptor attaches the header to every outgoing request regardless of host.

**Verify.** Inspect request headers for the failing call.

**Fix.** Scope the interceptor by URL or use a context token.

```ts
export const SKIP_AUTH = new HttpContextToken<boolean>(() => false);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SKIP_AUTH) || !req.url.startsWith(environment.apiBase)) {
    return next(req);
  }
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${inject(Auth).token()}` } }));
};
```

**Prevent.** Allow-list API hosts, add a test that external URLs receive no credentials.

**Common wrong answers.** Deleting the header in every third-party call or disabling the interceptor globally.

### A signal-based component runs an effect that causes an infinite loop. How do you debug it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/signals -->
**Observe.** CPU spikes, or you get an error about writing to signals inside effects.

**Hypothesise.** The effect reads a signal and writes to the same one (or one that feeds back into what it reads), re-triggering itself.

**Verify.** Log inside the effect and list the signals read; look for `set` calls.

**Fix.** Do not use effects for derived state. Replace with `computed` or `linkedSignal`.

```ts
// before
effect(() => this.total.set(this.items().length * this.price()));
// after
total = computed(() => this.items().length * this.price());
```

Use `effect` only for side effects outside the signal graph (logging, localStorage, a chart library) and wrap incidental reads with `untracked()`.

**Prevent.** Review rule: if an effect calls `.set`, ask why it is not computed.

**Common wrong answers.** Enabling `allowSignalWrites` to silence the error (version-specific; it just permits the loop) or adding a flag to break the cycle.

### Your app is slow because a template calls a method that does heavy computation. How do you prove and fix this?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/best-practices/runtime-performance -->
**Observe.** Typing in an input feels laggy; the Angular DevTools profiler shows many change detection cycles each taking tens of milliseconds.

**Hypothesise.** `{{ expensiveFilter(items) }}` runs on every change detection pass, regardless of whether inputs changed.

**Verify.** Add a `console.count` inside the method; it grows with every keystroke or mouse move.

**Fix.** Compute once and cache by dependency.

```ts
visible = computed(() => this.items().filter(i => i.name.includes(this.term())));
```

In the template use `visible()`. For non-signal code use a pure pipe or compute in the setter. Combine with `OnPush` and `track` in `@for`.

**Prevent.** Keep template expressions to property reads and trivial operations, and profile before optimising.

**Common wrong answers.** Using an impure pipe (runs every cycle too) or memoising with a global cache that never clears.

### Users with a mobile browser see layout shift and slow image loading on a product list. What would you do?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/image-optimization -->
**Observe.** Lighthouse reports poor CLS and LCP; images are large and pop in.

**Hypothesise.** Images have no reserved dimensions, load eagerly even offscreen, and are served at full resolution.

**Verify.** Check Lighthouse diagnostics and the image sizes in the Network tab.

**Fix.** Use `NgOptimizedImage`.

```html
<img ngSrc="hero.jpg" width="800" height="450" priority>
<img ngSrc="item.jpg" width="200" height="200" sizes="(max-width: 600px) 50vw, 200px">
```

It enforces width/height, lazy loads by default, supports `priority` for the LCP image, and works with image CDN loaders for resizing and modern formats. Add `fill` for container-sized images.

**Prevent.** Keep Lighthouse CI thresholds, and use the dev-mode warnings the directive prints.

**Common wrong answers.** Lazy loading the LCP image (makes it slower) or compressing images only.

### A feature needs to react to window resize and scroll without slowing the app. How would you implement it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/api/core/NgZone -->
**Observe.** A sticky-header effect triggers change detection on every scroll event; profiler shows hundreds of cycles per second.

**Hypothesise.** With zone.js each listener callback triggers application-wide change detection.

**Verify.** Count `ApplicationRef.tick` calls (or use the profiler).

**Fix.** Run the listener outside Angular and re-enter only for real changes.

```ts
constructor(zone: NgZone) {
  zone.runOutsideAngular(() => {
    fromEvent(window, 'scroll', { passive: true }).pipe(
      map(() => window.scrollY > 80), distinctUntilChanged(),
      takeUntilDestroyed()
    ).subscribe(v => zone.run(() => this.stuck.set(v)));
  });
}
```

Prefer CSS (`position: sticky`, IntersectionObserver) where possible. Zoneless apps (stable in recent versions, check yours) avoid the issue because only signals or `markForCheck` trigger updates.

**Prevent.** Throttle high-frequency events and pass `passive: true`.

**Common wrong answers.** Calling `detectChanges` manually on every event.

### Different environments need different API URLs, but you must ship a single build artifact. How do you configure this?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/tools/cli/environments -->
**Observe.** Currently the team rebuilds for dev, staging and prod with `fileReplacements`; promoting a build means rebuilding, risking drift.

**Hypothesise.** Config is compiled into the bundle.

**Verify.** Grep the dist output for the API URL.

**Fix.** Load runtime config before bootstrapping.

```ts
provideAppInitializer(async () => {
  const cfg = await fetch('/config.json').then(r => r.json());
  inject(ConfigService).set(cfg);
})
```

Serve `config.json` per environment (container mount or CDN rule) with no-cache headers. Expose it through an injection token, and never put secrets in it, as it is public.

**Prevent.** Validate the config shape with a schema at startup and fail loudly with a clear error page.

**Common wrong answers.** Putting secrets in `environment.ts` or keeping one build per environment while claiming "same code".

### A table with 10,000 rows freezes the browser when sorting. What are your options?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/best-practices/runtime-performance -->
**Observe.** Sorting takes seconds; scroll is janky.

**Hypothesise.** Too many DOM nodes and a sort that recomputes, plus a missing `track` expression recreating all rows.

**Verify.** Check the DOM node count, use the Performance panel to separate scripting from rendering time.

**Fix.** In order of effort:

1. Use `@for (row of rows(); track row.id)` so rows are moved, not recreated.
2. Virtualise with the CDK: `<cdk-virtual-scroll-viewport itemSize="40">` and `*cdkVirtualFor`.
3. Move sort/filter/paging to the server for very large data.
4. Sort in a `computed`, and for heavy work use a Web Worker.

**Prevent.** Define a maximum client-side row count and test with realistic volume.

**Common wrong answers.** Using `track $index` on a sortable list (reuses wrong DOM) or adding pagination only in the UI while still rendering everything hidden.

### A child component needs to call a method on a sibling deep in the tree. How would you design it cleanly?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/di -->
**Observe.** The team used `@ViewChild` chains and `document.querySelector` to trigger a "refresh" across components.

**Hypothesise.** There is no explicit contract between the components, so coupling is hidden and tests are brittle.

**Verify.** Search for DOM queries and parent references that reach across the tree.

**Fix.** Use a service as the communication channel, scoped appropriately.

```ts
@Injectable({ providedIn: 'root' })
export class RefreshBus {
  private _tick = signal(0);
  readonly tick = this._tick.asReadonly();
  request() { this._tick.update(n => n + 1); }
}
```

The producer calls `request()`; the consumer uses an `effect` or `toObservable(tick)` to reload. For one feature subtree, provide it in the parent component's `providers` so instances do not leak between pages.

**Prevent.** Prefer data flow through inputs/outputs for parent-child, services for distant relatives.

**Common wrong answers.** Global `window` events or reaching into another component instance.

### Your app must support right-to-left languages and multiple locales. How do you plan it?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/i18n -->
**Observe.** Product wants Arabic and Hindi next quarter.

**Hypothesise.** Hardcoded strings, left/right CSS, and locale-insensitive formatting will break.

**Verify.** Audit templates for literal text and CSS for `margin-left`, `float: left`.

**Fix.**

1. Mark text with `i18n` attributes and extract with `ng extract-i18n`; translations are compiled per locale at build time (or use a runtime library like Transloco if one build is required).
2. Register locale data and set `LOCALE_ID` so date, number and currency pipes format correctly.
3. Use CSS logical properties (`margin-inline-start`) and set `dir="rtl"` on the root for RTL locales.
4. Use ICU plural/select expressions for grammar.

**Prevent.** Pseudo-localise in CI to catch truncation and untranslated strings.

**Common wrong answers.** Concatenating translated fragments or translating inside TypeScript with string `+`.

### A third-party script sets innerHTML with user content and a security review flags XSS. What do you do in Angular?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/best-practices/security -->
**Observe.** A comment feature renders user HTML using `[innerHTML]` and a developer added `bypassSecurityTrustHtml` because styles were stripped.

**Hypothesise.** The bypass disables Angular's sanitiser, so `<img onerror=...>` runs.

**Verify.** Submit a payload like an image tag with an error handler and see if it executes.

**Fix.** Remove the bypass. Let `[innerHTML]` sanitise (it strips scripts and event handlers). If rich formatting is needed, sanitise server-side with an allow-list library, and render a restricted format such as Markdown converted on the server. Add a strict Content Security Policy and consider Trusted Types.

**Prevent.** Ban `bypassSecurityTrust*` via lint unless reviewed, and add a security test with known payloads.

**Common wrong answers.** Escaping manually with regex, trusting that the server stored "clean" data, or bypassing only "for admins".

### A developer wants to put the whole app state in a service holding a BehaviorSubject. When is that a problem and what would you propose?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/signals -->
**Observe.** One `AppState` object is updated by many components via `next({...})`; bugs appear from lost updates and unclear ownership.

**Hypothesise.** A single mutable hub without update rules leads to race conditions, and any change re-emits to all subscribers.

**Verify.** Trace a bug where two components update different fields from stale snapshots.

**Fix.** Split state by feature, expose read-only signals, and funnel writes through named methods.

```ts
@Injectable({ providedIn: 'root' })
export class CartStore {
  private _items = signal<CartItem[]>([]);
  readonly items = this._items.asReadonly();
  readonly total = computed(() => this.items().reduce((s, i) => s + i.price * i.qty, 0));
  add(i: CartItem) { this._items.update(l => [...l, i]); }
}
```

Adopt NgRx (or SignalStore) only if you need devtools, time travel, or strict effects at scale.

**Prevent.** Document ownership of each state slice.

**Common wrong answers.** "Always use NgRx" or exposing the subject publicly.

### E2E tests fail intermittently in CI because elements are not ready. How do you stabilise them?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/testing -->
**Observe.** The same test passes locally and fails once in five CI runs, often "element not found" or wrong text.

**Hypothesise.** Hard-coded sleeps, selectors tied to layout, shared test data, and reliance on animation timing.

**Verify.** Re-run with traces or video (Playwright trace viewer, Cypress video), and check the timing at failure.

**Fix.**

- Use auto-waiting assertions (`await expect(locator).toHaveText(...)`) instead of `sleep`.
- Select via `data-testid` or accessible roles, not CSS classes.
- Create isolated data per test through API calls, and clean up.
- Stub flaky third parties with network interception.
- Disable animations in the test environment.

```ts
await page.getByRole('button', { name: 'Save' }).click();
await expect(page.getByText('Saved')).toBeVisible();
```

**Prevent.** Track flake rate and quarantine, but fix within a deadline.

**Common wrong answers.** Retrying everything three times and ignoring root causes.

### You see "NG0100"-like timing errors and janky UI when many async updates arrive from a WebSocket. How do you manage the stream?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/best-practices/runtime-performance -->
**Observe.** A live dashboard receives 200 messages per second; the UI stutters and CPU is pegged.

**Hypothesise.** Each message triggers a change detection cycle and a re-render of a large list.

**Verify.** Profile with Angular DevTools and count cycles per second.

**Fix.** Batch and coalesce.

```ts
this.socket$.pipe(
  bufferTime(250),
  filter(batch => batch.length > 0),
  takeUntilDestroyed()
).subscribe(batch => this.store.applyBatch(batch));
```

Process messages outside the zone, update a signal once per batch, keep only the latest value per key (`scan` into a map), use `OnPush` and virtual scrolling, and render at animation-frame rate if needed.

**Prevent.** Define a UI refresh budget (for example 4 updates per second) and load test with recorded traffic.

**Common wrong answers.** Dropping `OnPush`, or throttling on the server only while the client still renders every message.

### Your team debates `ngOnChanges` versus signal inputs and `computed`. How would you advise a migration?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/signals/inputs -->
**Observe.** Components use `@Input()` setters and `ngOnChanges` to derive fields; bugs appear when the order of input updates matters.

**Hypothesise.** Imperative derivation is easy to get out of sync, whereas signal inputs make dependencies explicit.

**Verify.** Pick one component with several derived fields and measure bug history or complexity.

**Fix.** Migrate gradually, using the built-in schematics (signal inputs are available from Angular 17.1 and stable in 19).

```ts
name = input.required<string>();
upper = computed(() => this.name().toUpperCase());
```

Convert `@Output` to `output()` and queries to `viewChild()`. Keep `@Input` where a library consumer on an older version needs it. Leave stable, untouched components alone.

**Prevent.** New components use signals by default; add the schematic output to PR checklists.

**Common wrong answers.** Rewriting the entire app in one PR, or mixing `ngOnChanges` and `effect` to derive the same value.

### A shared library used by several Angular apps keeps breaking consumers on minor releases. How do you manage this?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/tools/libraries -->
**Observe.** Apps upgrade the library and hit type errors, changed styles, or peer dependency conflicts.

**Hypothesise.** The public API is not controlled, versions are not semver-disciplined, and peers are too strict.

**Verify.** Diff the generated d.ts files between versions and inspect `peerDependencies`.

**Fix.**

- Export only intentional symbols from `public-api.ts`; keep the rest internal.
- Follow semver: breaking changes only in majors, with deprecation first.
- Use broad peer ranges (`"@angular/core": ">=18 <21"`) and test against each supported version in CI.
- Use an API extractor report committed to the repo so PRs show API diffs.
- Namespace CSS or use CSS variables for theming; avoid global style leaks.
- Build in partial compilation mode with `ng-packagr`.

**Prevent.** Add a consumer test app that builds against the packed artefact on every PR.

**Common wrong answers.** Publishing source files, pinning exact Angular versions, or relying on a changelog alone.
