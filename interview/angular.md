# Angular interview questions

### What are standalone components, and how do they differ from NgModules?
<!-- level: basic; kind: concept; ref: https://angular.dev/guide/components/importing -->
A **standalone component** declares its own dependencies in its `imports` array instead of belonging to an `NgModule`. Recent Angular versions create standalone components by default, and apps bootstrap with `bootstrapApplication` and functional providers like `provideRouter` and `provideHttpClient`.

`NgModule`s are still supported for existing apps, but standalone components mean less boilerplate and easier lazy loading.

```ts
@Component({
  selector: 'app-user-card',
  imports: [DatePipe],
  template: `<p>{{ user().name }} — joined {{ user().joined | date }}</p>`,
})
export class UserCard {
  user = input.required<User>();
}
```

### How does change detection work, and what does `OnPush` do?
<!-- level: intermediate; kind: concept; ref: https://angular.dev/best-practices/skipping-subtrees -->
Angular checks component templates for changes and updates the DOM. Traditionally zone.js notifies Angular after async events (clicks, timers, HTTP), and with the **Default** strategy Angular checks the whole component tree.

With **`ChangeDetectionStrategy.OnPush`**, a component is only checked when:
- an `@Input` reference changes,
- an event fires inside it,
- an `async` pipe or a **signal** it reads emits/changes,
- or it is explicitly marked for check.

This skips large parts of the tree and improves performance. Signals make updates even more precise, and Angular now supports **zoneless** change detection driven by signals.

### What are signals, and how do they compare with RxJS observables?
<!-- level: intermediate; kind: concept; ref: https://angular.dev/guide/signals -->
A **signal** is a reactive value that notifies consumers when it changes: `signal()` for writable state, `computed()` for derived values, `effect()` for side effects. Reading a signal in a template automatically tracks it.

- **Signals**: synchronous state — always have a current value; ideal for UI/component state.
- **Observables**: streams of values over time — ideal for async events, HTTP, websockets, complex event composition (debounce, retry, switchMap).

They work together: `toSignal()` and `toObservable()` convert between them.

```ts
count = signal(0);
double = computed(() => this.count() * 2);
increment() { this.count.update(c => c + 1); }
```

### Name the main component lifecycle hooks and when they run.
<!-- level: basic; kind: concept; ref: https://angular.dev/guide/components/lifecycle -->
- `constructor` — dependency injection only; inputs are not set yet.
- `ngOnChanges` — whenever an input changes (before `ngOnInit` and on each change).
- `ngOnInit` — once, after the first inputs are set. Good for initial data loading.
- `ngDoCheck` — on every change detection run (use rarely).
- `ngAfterContentInit` / `ngAfterContentChecked` — projected content ready/checked.
- `ngAfterViewInit` / `ngAfterViewChecked` — the component's view and children ready/checked.
- `ngOnDestroy` — cleanup (unsubscribe, timers). `DestroyRef` / `takeUntilDestroyed` is the modern alternative.

### How does dependency injection work in Angular, and what does `providedIn: 'root'` mean?
<!-- level: intermediate; kind: concept; ref: https://angular.dev/guide/di -->
Angular creates and injects services through **hierarchical injectors**: the root (application) injector, route/environment injectors, and element injectors for components.

`@Injectable({ providedIn: 'root' })` registers a single app-wide instance that is tree-shakable — removed from the bundle if unused. Providing a service in a component's `providers` creates a separate instance for that component and its children.

Use `inject()` in constructors, field initialisers or functional guards:

```ts
export class UserList {
  private api = inject(UserApi);
}
```

### What is the difference between `switchMap`, `mergeMap`, `concatMap` and `exhaustMap`?
<!-- level: intermediate; kind: concept; ref: https://rxjs.dev/guide/operators -->
All map each value to an inner observable; they differ in what happens when a new value arrives while an inner one is still running:
- **switchMap**: cancels the previous inner observable. Use for search-as-you-type or route params — only the latest matters.
- **mergeMap**: runs all inner observables in parallel. Use for independent operations.
- **concatMap**: queues them and runs one at a time in order. Use when order matters (sequential saves).
- **exhaustMap**: ignores new values until the current one finishes. Use for "submit" or "login" buttons to prevent double submission.

### How do you lazy-load routes?
<!-- level: basic; kind: concept; ref: https://angular.dev/guide/routing/define-routes -->
Lazy loading splits code into separate bundles that are downloaded only when the route is visited:

```ts
export const routes: Routes = [
  { path: 'admin', loadChildren: () => import('./admin/admin.routes').then(m => m.ADMIN_ROUTES) },
  { path: 'profile', loadComponent: () => import('./profile/profile').then(m => m.Profile) },
];
```

Combine with a preloading strategy (e.g. `withPreloading(PreloadAllModules)`) to fetch bundles in the background, and use `@defer` blocks to lazy-load parts of a template.

### What is the difference between pure and impure pipes, and why use the `async` pipe?
<!-- level: basic; kind: concept; ref: https://angular.dev/guide/templates/pipes -->
- A **pure** pipe (default) re-runs only when its input reference changes — cheap.
- An **impure** pipe runs on every change detection cycle — use sparingly.

The **`async` pipe** subscribes to an observable or promise, returns the latest value, marks `OnPush` components for check, and **unsubscribes automatically** when the component is destroyed — preventing memory leaks.

### A page rendering a long list is slow. How do you make it faster?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/best-practices/runtime-performance -->
- Use `ChangeDetectionStrategy.OnPush` and immutable updates or signals.
- Always track items: `@for (item of items; track item.id)` (or `trackBy` with `*ngFor`) so Angular reuses DOM nodes instead of re-creating them.
- Render only what is visible with **CDK virtual scrolling** (`cdk-virtual-scroll-viewport`) or paginate.
- Avoid calling functions in templates that do heavy work; use `computed()` signals or pure pipes.
- Defer below-the-fold content with `@defer`.
- Profile with Angular DevTools to find components that re-render too often.

### Users report the app gets slower the longer it is open. You suspect subscription leaks. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/ecosystem/rxjs-interop/take-until-destroyed -->
Long-lived observables (intervals, websockets, store selections, router events) subscribed in components keep running after the component is destroyed.

Fixes:
- Prefer the **`async` pipe** or `toSignal()` so subscriptions are managed for you.
- Use `takeUntilDestroyed()` for manual subscriptions:

```ts
constructor() {
  interval(1000).pipe(takeUntilDestroyed()).subscribe(() => this.tick());
}
```

- HTTP observables complete after one response, so they rarely leak — but cancel them on navigation with `switchMap`.
- Confirm with Chrome DevTools memory snapshots that destroyed components are no longer retained.

### How would you share state between two sibling components?
<!-- level: intermediate; kind: scenario; ref: https://angular.dev/guide/signals -->
Options from simplest to most structured:
1. **Lift state to the parent** and pass it down with inputs; send changes up with outputs.
2. A **shared service** (`providedIn: 'root'` or provided in the parent) holding a signal or a `BehaviorSubject`:

```ts
@Injectable({ providedIn: 'root' })
export class CartStore {
  private items = signal<Item[]>([]);
  readonly count = computed(() => this.items().length);
  add(item: Item) { this.items.update(list => [...list, item]); }
}
```

3. For large apps with complex flows, a state library such as **NgRx** (Store or SignalStore).

Choose the simplest option that keeps data flow easy to follow.
