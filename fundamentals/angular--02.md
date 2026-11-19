## 4. Signals

### signal and computed
<!-- level: basic; ref: https://angular.dev/guide/signals -->
A signal is a wrapper around a value that notifies interested consumers when the value changes. `signal(initial)` creates a writable signal: read it by calling it (`count()`), change it with `set(value)` or `update(fn)`. `computed(fn)` creates a read-only signal derived from other signals.

The magic is automatic dependency tracking. When a computed function or a template runs, Angular records every signal read during that run. When one of those signals changes, only the dependent computations and views are marked dirty. Computed signals are lazy (they do not run until read) and memoised (they re-run only when a dependency changed), so they are ideal for derived state such as totals and filtered lists.

Signals compare values with `Object.is` by default; setting the same primitive does not notify anyone. For objects, update immutably so the reference changes.

```ts
import { Component, signal, computed } from '@angular/core';

interface Line { id: string; name: string; price: number; qty: number; }

@Component({
  selector: 'app-cart-summary',
  template: `
    <p>{{ itemCount() }} items · ₹{{ subtotal() }}</p>
    @if (freeShipping()) { <p>Free shipping unlocked!</p> }
    <button (click)="add({ id: 'p9', name: 'Mug', price: 349, qty: 1 })">Add mug</button>
  `,
})
export class CartSummary {
  private readonly lines = signal<Line[]>([]);
  readonly itemCount = computed(() => this.lines().reduce((n, l) => n + l.qty, 0));
  readonly subtotal = computed(() => this.lines().reduce((s, l) => s + l.price * l.qty, 0));
  readonly freeShipping = computed(() => this.subtotal() >= 999);

  add(line: Line) {
    this.lines.update(ls => [...ls, line]);
  }
}
```

- Pitfall: mutating an array inside a signal (`this.lines().push(x)`) does not notify consumers. Use `update` with a new array.
- Interview tip: expose state as read-only with `asReadonly()` or `computed`, keeping `set` private to the owning service.

### effect
<!-- level: intermediate; ref: https://angular.dev/guide/signals#effects -->
`effect(fn)` runs a function whenever any signal it read during its last run changes. Effects are for side effects that must react to state: syncing to `localStorage`, logging, calling imperative third-party APIs, or updating something outside the Angular view. They are stable since v20.

Effects always run at least once, asynchronously, during change detection, never synchronously inside `set`. Component effects run before the component's view is checked; root effects (created in services) run before the whole tree is checked. They are destroyed automatically with the injection context that created them (component or service). An `onCleanup` callback lets you cancel work before the next run.

Effects must be created in an injection context (constructor or field initialiser) or given an `injector` option.

```ts
import { Component, effect, signal, untracked } from '@angular/core';

@Component({ selector: 'app-notes', template: `<textarea [value]="draft()" (input)="draft.set($any($event.target).value)"></textarea>` })
export class Notes {
  protected draft = signal(localStorage.getItem('draft') ?? '');
  private userId = signal('u42');

  constructor() {
    effect(onCleanup => {
      const text = this.draft();
      const handle = setTimeout(() => {
        localStorage.setItem('draft', text);
        // read without creating a dependency
        analytics.track('draft_saved', { user: untracked(this.userId) });
      }, 500);
      onCleanup(() => clearTimeout(handle));
    });
  }
}
```

- Pitfall: using effects to copy one signal into another (`effect(() => this.b.set(this.a() * 2))`). That is derived state; use `computed` or `linkedSignal`. Effects that write signals can create loops and extra change detection passes.
- Pitfall: an effect that reads a signal only inside an `if` branch tracks it only when that branch runs.

### linkedSignal
<!-- level: intermediate; ref: https://angular.dev/guide/signals/linked-signal -->
Sometimes you need state that is derived from another signal by default but can also be changed locally. Example: a dropdown's selected option should reset to the first option whenever the list of options changes, but the user can pick another option meanwhile. `computed` cannot be written to, and an effect that copies values is clumsy.

`linkedSignal` (introduced in v19, stable in v20) is a writable signal whose value is recomputed whenever its source changes. The short form takes a computation: `linkedSignal(() => options()[0])`. The long form takes `source` and `computation(newSource, previous)`, letting you keep the previous selection if it still exists in the new list.

```ts
import { Component, input, linkedSignal } from '@angular/core';

interface Plan { id: string; name: string; }

@Component({
  selector: 'app-plan-picker',
  template: `
    @for (plan of plans(); track plan.id) {
      <label>
        <input type="radio" name="plan" [checked]="plan.id === selected()?.id" (change)="selected.set(plan)" />
        {{ plan.name }}
      </label>
    }
    <p>Selected: {{ selected()?.name ?? 'none' }}</p>
  `,
})
export class PlanPicker {
  plans = input.required<Plan[]>();

  selected = linkedSignal<Plan[], Plan | undefined>({
    source: this.plans,
    computation: (newPlans, previous) =>
      newPlans.find(p => p.id === previous?.value?.id) ?? newPlans[0],
  });
}
```

It is also the clean answer to "how do I have a local editable copy of an input": `localName = linkedSignal(() => this.name())`.

- Pitfall: local changes are overwritten as soon as the source changes. That is the intended behaviour; if you want edits to persist, the state belongs somewhere else.

### resource and asynchronous data
<!-- level: advanced; ref: https://angular.dev/guide/signals/resource -->
Signals are synchronous, but data often arrives asynchronously. `resource()` bridges the two: you give it `params` (a reactive function, previously named `request`) and a `loader` that returns a promise. Whenever params change, the resource calls the loader again, aborts the previous call via an `AbortSignal`, and exposes the result as signals: `value()`, `status()`, `isLoading()`, `error()` and `hasValue()`. It also supports `reload()` and local `set()` for optimistic changes.

`rxResource` (in `@angular/core/rxjs-interop`) does the same with an observable-returning `stream`, and `httpResource` wraps `HttpClient` directly. These APIs were introduced in v19–v20 as experimental; check the docs for their current stability in your version before relying on them in production.

```ts
import { Component, resource, signal, computed } from '@angular/core';

@Component({
  selector: 'app-weather',
  template: `
    <select (change)="city.set($any($event.target).value)">
      <option>Pune</option><option>Delhi</option><option>Chennai</option>
    </select>
    @if (weather.isLoading()) { <p>Loading…</p> }
    @else if (weather.error()) { <p role="alert">Failed to load.</p> }
    @else if (weather.hasValue()) { <p>{{ weather.value().tempC }} °C</p> }
  `,
})
export class Weather {
  protected city = signal('Pune');

  protected weather = resource({
    params: () => ({ city: this.city() }),
    loader: async ({ params, abortSignal }) => {
      const res = await fetch(`/api/weather?city=${params.city}`, { signal: abortSignal });
      if (!res.ok) throw new Error(res.statusText);
      return (await res.json()) as { tempC: number };
    },
  });
}
```

- Pitfall: `resource` is for reading data. Mutations (POST/PUT) should be explicit method calls in a service, not side effects of signals changing.
- Pitfall: returning `undefined` from `params` puts the resource in idle state, which is how you skip loading until required inputs exist.

### Signals and RxJS interop
<!-- level: intermediate; ref: https://angular.dev/ecosystem/rxjs-interop -->
Signals and observables solve different problems. Signals hold current state synchronously and are perfect for templates. Observables model streams of events over time and excel at coordination: debouncing, cancellation, retries, combining sources. Angular's `@angular/core/rxjs-interop` package converts between them.

`toSignal(obs$, options)` subscribes to an observable and exposes its latest value as a signal. It unsubscribes automatically when the injection context is destroyed. Because a signal always has a value, you either get `undefined` until the first emission, provide `initialValue`, or set `requireSync: true` for observables that emit synchronously (like a `BehaviorSubject`).

`toObservable(signal)` creates an observable that emits the signal's value (asynchronously, after change detection settles), allowing you to apply RxJS operators to signal changes.

```ts
import { Component, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, switchMap, catchError, of } from 'rxjs';

@Component({
  selector: 'app-user-search',
  template: `
    <input (input)="query.set($any($event.target).value)" placeholder="Search users" />
    @for (u of results(); track u.id) { <p>{{ u.name }}</p> }
  `,
})
export class UserSearch {
  private api = inject(UserApi);
  protected query = signal('');

  protected results = toSignal(
    toObservable(this.query).pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => (q.length < 2 ? of([]) : this.api.search(q).pipe(catchError(() => of([]))))),
    ),
    { initialValue: [] },
  );
}
```

- Pitfall: calling `toSignal` inside a method creates a new subscription each call; call it once in a field initialiser or constructor.
- Interview tip: rule of thumb — RxJS for events and async orchestration, signals for state that templates read.

### Signal equality, untracked and reactive contexts
<!-- level: advanced; ref: https://angular.dev/guide/signals#reading-without-tracking-dependencies -->
Understanding a few details of the signal graph avoids subtle bugs.

Reactive contexts are places where signal reads are tracked: templates, `computed`, `effect`, `linkedSignal` computations and resource params. Reads anywhere else (event handlers, plain methods) are just reads. Inside a reactive context, `untracked(fn)` reads signals without registering dependencies, which is useful in effects that should react to one signal but log another.

Equality: each signal can take an `equal` function. By default `Object.is` is used, so a new object with identical content still counts as a change. A custom equality can prevent pointless downstream recomputation, for example comparing ids.

Glitch-free evaluation: Angular uses a push-pull model. When a signal is set, dependents are only marked dirty (push); computations re-run lazily when read (pull). This ensures a computed never observes an inconsistent mix of old and new values, and unused computeds never run.

```ts
import { signal, computed, effect, untracked } from '@angular/core';

const selectedUser = signal<User | null>(null, {
  equal: (a, b) => a?.id === b?.id, // ignore re-fetches of the same user
});

const firstName = signal('Asha');
const lastName = signal('Rao');
const fullName = computed(() => `${firstName()} ${lastName()}`);

effect(() => {
  // re-runs only when selectedUser changes, not when fullName changes
  const user = selectedUser();
  untracked(() => console.log(`Viewing ${user?.id} as ${fullName()}`));
});
```

- Pitfall: calling a service method that reads signals inside an effect silently adds dependencies; wrap such calls in `untracked` if they should not trigger re-runs.
- Pitfall: writing to signals inside `computed` is not allowed and throws.

## 5. Dependency injection

### Services and inject()
<!-- level: basic; ref: https://angular.dev/guide/di/creating-injectable-service -->
A service is a class that holds logic or state not tied to a particular view: API access, caching, authentication, logging, business rules. Components ask for services instead of creating them, and Angular's dependency injection (DI) system supplies instances. This decouples consumers from construction details, makes singletons easy, and makes testing easy because you can substitute fakes.

Mark a service with `@Injectable({ providedIn: 'root' })` to register it in the root injector as a lazily created, app-wide singleton that is tree-shaken out of the bundle if nothing injects it.

To obtain a dependency, call `inject(Token)` in an injection context: a field initialiser, a constructor, a factory function, or a functional guard/resolver/interceptor. `inject()` is the recommended style over constructor parameters; it works well with inheritance and functional APIs, and the CLI offers a migration.

```ts
import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private readonly _user = signal<User | null>(null);
  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);

  login(email: string, password: string) {
    return this.http.post<User>('/api/login', { email, password }).pipe(
      tap(user => this._user.set(user)),
    );
  }

  logout() {
    this._user.set(null);
  }
}

@Component({ selector: 'app-header', template: `@if (auth.isLoggedIn()) { Hi {{ auth.user()?.name }} }` })
export class Header {
  protected auth = inject(AuthService);
}
```

- Pitfall: calling `inject()` inside a method or `setTimeout` throws NG0203 because there is no injection context.

### Providers and provider types
<!-- level: intermediate; ref: https://angular.dev/guide/di/dependency-injection-providers -->
A provider tells an injector how to create the value for a token. `providers: [Logger]` is shorthand for `{ provide: Logger, useClass: Logger }`. Other recipes let you substitute implementations, supply constants or run factory logic:

1. `useClass`: create an instance of a (possibly different) class. Great for swapping implementations: `{ provide: Storage, useClass: IndexedDbStorage }`.
2. `useValue`: provide a ready-made value, such as a configuration object.
3. `useFactory`: call a function (which can itself `inject()` dependencies) to build the value.
4. `useExisting`: alias one token to another existing provider.

Providers can be registered in `providedIn` (root or `'platform'`), in `ApplicationConfig.providers`, on a route's `providers`, or in a component's or directive's `providers`/`viewProviders`. `multi: true` lets several providers contribute to one token as an array (how interceptors and validators historically worked).

```ts
import { ApplicationConfig, inject, isDevMode } from '@angular/core';

export abstract class Logger {
  abstract log(msg: string): void;
}
class ConsoleLogger implements Logger { log(m: string) { console.log(m); } }
class RemoteLogger implements Logger {
  private http = inject(HttpClient);
  log(m: string) { this.http.post('/api/logs', { m }).subscribe(); }
}

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: Logger, useFactory: () => (isDevMode() ? new ConsoleLogger() : new RemoteLogger()) },
    { provide: API_BASE_URL, useValue: 'https://api.shop.example' },
    { provide: LegacyLogger, useExisting: Logger },
  ],
};
```

- Pitfall: listing a `providedIn: 'root'` service again in a component's `providers` silently creates a second instance with separate state.
- Interview tip: abstract classes make convenient tokens because they also serve as TypeScript types.

### Hierarchical injectors
<!-- level: advanced; ref: https://angular.dev/guide/di/hierarchical-dependency-injection -->
Angular has two parallel injector hierarchies. Environment injectors hold app-wide services: the platform injector, the root injector (from `bootstrapApplication` and `providedIn: 'root'`), and child environment injectors created for lazily loaded routes with `providers`. Element injectors are created for components and directives that declare `providers` or `viewProviders`, and they mirror the DOM structure.

When something calls `inject(Token)`, Angular first walks up the element injector tree from the requesting component to the root component, then falls back to the environment injector chain. The first injector that has a provider supplies the instance. This lets you scope state: providing a service in a component gives that component and its descendants their own instance, created and destroyed with the component.

Resolution modifiers adjust the lookup: `optional: true` (return null instead of throwing), `self: true` (only this element), `skipSelf: true` (start from the parent, useful for nested structures), and `host: true` (stop at the host component).

```ts
@Injectable()
export class WizardState {
  readonly step = signal(1);
  next() { this.step.update(s => s + 1); }
}

@Component({
  selector: 'app-checkout-wizard',
  providers: [WizardState],          // one instance per wizard
  template: `<app-wizard-step /> <app-wizard-nav />`,
})
export class CheckoutWizard {}

@Component({ selector: 'app-wizard-nav', template: `<button (click)="state.next()">Next ({{ state.step() }})</button>` })
export class WizardNav {
  protected state = inject(WizardState);   // finds the wizard's instance
}

@Directive({ selector: '[appMenuItem]' })
export class MenuItem {
  parentMenu = inject(Menu, { skipSelf: true, optional: true });
}
```

- Interview tip: `viewProviders` are visible to the component's own template children but not to projected content, useful to hide implementation services from content.

### Injection tokens and configuration
<!-- level: intermediate; ref: https://angular.dev/guide/di/dependency-injection-providers#using-an-injectiontoken-object -->
Interfaces and primitive values do not exist at runtime, so they cannot be DI tokens. `InjectionToken<T>` creates a unique, typed token for non-class dependencies: configuration objects, URLs, feature flags, functions, or browser globals you want to abstract for testing and SSR.

A token can define its own default with `providedIn: 'root'` and a `factory`, making it tree-shakable and self-contained. Libraries commonly expose a `provideX(config)` function that returns the right providers, which is the idiomatic configuration API in standalone Angular.

```ts
import { InjectionToken, inject, makeEnvironmentProviders, EnvironmentProviders } from '@angular/core';
import { DOCUMENT } from '@angular/common';

export interface AnalyticsConfig { writeKey: string; sampleRate: number; }

export const ANALYTICS_CONFIG = new InjectionToken<AnalyticsConfig>('ANALYTICS_CONFIG');

export const WINDOW = new InjectionToken<Window | null>('WINDOW', {
  providedIn: 'root',
  factory: () => inject(DOCUMENT).defaultView, // null-safe under SSR
});

export function provideAnalytics(config: AnalyticsConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: ANALYTICS_CONFIG, useValue: config },
  ]);
}

@Injectable({ providedIn: 'root' })
export class Analytics {
  private config = inject(ANALYTICS_CONFIG);
  private win = inject(WINDOW);
  track(event: string) {
    if (Math.random() > this.config.sampleRate) return;
    this.win?.navigator.sendBeacon('/collect', JSON.stringify({ event, key: this.config.writeKey }));
  }
}

// app.config.ts: providers: [provideAnalytics({ writeKey: 'abc', sampleRate: 0.2 })]
```

- Pitfall: two `new InjectionToken('X')` calls with the same description are different tokens; export one constant.

### Injection context and DestroyRef
<!-- level: intermediate; ref: https://angular.dev/guide/di/dependency-injection-context -->
`inject()` only works inside an injection context: while Angular is constructing a class (constructor, field initialisers), inside factory functions for providers, inside functional route guards and resolvers, inside functional interceptors, or inside a function run with `runInInjectionContext(injector, fn)`. Outside those moments there is no "current injector" to ask.

This matters because many modern APIs build on it: `effect()`, `toSignal()`, `takeUntilDestroyed()`, `afterNextRender()` and `resource()` all need an injection context, either implicitly or via an `injector` option.

`DestroyRef` is an injectable handle to the lifecycle of the current context (component, directive, service or environment injector). `destroyRef.onDestroy(cb)` registers cleanup without implementing `ngOnDestroy`, which makes it possible to write reusable functions that clean up after themselves.

```ts
import { DestroyRef, inject, Injector, runInInjectionContext } from '@angular/core';

// A reusable helper that must be called in an injection context
export function useInterval(ms: number, cb: () => void) {
  const id = setInterval(cb, ms);
  inject(DestroyRef).onDestroy(() => clearInterval(id));
}

@Component({ selector: 'app-clock', template: `{{ now() | date: 'mediumTime' }}`, imports: [DatePipe] })
export class Clock {
  protected now = signal(new Date());
  private injector = inject(Injector);

  constructor() {
    useInterval(1000, () => this.now.set(new Date())); // fine: constructor
  }

  startLater() {
    runInInjectionContext(this.injector, () => useInterval(5000, () => console.log('tick')));
  }
}
```

- Pitfall: `assertInInjectionContext(fn)` gives clearer errors in your own helpers; use it at their start.

## 6. Change detection and lifecycle

### How change detection works
<!-- level: intermediate; ref: https://angular.dev/best-practices/runtime-performance -->
Change detection is how Angular keeps the DOM in sync with component state. Each component's compiled template has an update function that re-evaluates its bindings and writes changed values to the DOM. A change detection pass walks the component tree from the root, running these update functions.

Two questions define the strategy: when does Angular start a pass, and which components does it check?

Historically, zone.js answered the first: it patches browser async APIs (events, timers, promises, XHR) and tells Angular after any async task completes, so Angular runs a pass "just in case". With the Default strategy, every component in the tree is checked on every pass. That is simple and automatic but wasteful in large apps, and it needs zone.js loaded.

Modern Angular narrows both. OnPush and signals limit which components are checked, and zoneless scheduling (default for new apps in v21) starts passes only when Angular knows something changed: a signal read by a template was set, a bound template event fired, `markForCheck()` was called, or the `async` pipe received a value.

In development mode Angular runs a second check after each pass and throws `ExpressionChangedAfterItHasBeenCheckedError` if a binding changed, revealing code that mutates state during change detection.

```ts
@Component({
  selector: 'app-counter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button (click)="inc()">{{ count() }}</button>`,
})
export class Counter {
  protected count = signal(0);
  inc() { this.count.update(c => c + 1); } // the signal schedules exactly the needed check
}
```

- Interview tip: unidirectional data flow — parents are checked before children, and children must not change parent state during the check.

### OnPush strategy
<!-- level: intermediate; ref: https://angular.dev/best-practices/skipping-subtrees -->
`ChangeDetectionStrategy.OnPush` lets Angular skip a component and its whole subtree during change detection unless the component has been marked dirty. A component is marked for check when:

1. An input changes reference (compared with `Object.is`).
2. A template event handler or host listener in it runs.
3. A signal read in its template changes (in that case, since v17, Angular can refresh just that view, not all ancestors).
4. The `async` pipe in it receives a new value.
5. Code calls `ChangeDetectorRef.markForCheck()`.

OnPush pairs naturally with immutable data and signals. It turns "check everything always" into "check only what may have changed", which is often the biggest single performance win in large Angular apps. With signals and zoneless, OnPush is effectively the recommended default for every component, and the CLI can generate components with it.

```ts
@Component({
  selector: 'app-order-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (o of orders(); track o.id) { <app-order-row [order]="o" /> }
  `,
})
export class OrderList {
  orders = input.required<Order[]>();
}

// Parent – mutation will NOT update an OnPush child that receives the same array
this.orders.push(newOrder);                       // wrong with OnPush
this.orders = [...this.orders, newOrder];          // new reference: child refreshed
this.ordersSignal.update(list => [...list, newOrder]); // best: signal
```

- Pitfall: subscribing manually in an OnPush component and assigning to a plain field will not update the view; use signals, `toSignal`, the `async` pipe or `markForCheck`.
- Pitfall: `detectChanges()` everywhere as a workaround hides design problems and costs performance.

### Zoneless change detection
<!-- level: advanced; ref: https://angular.dev/guide/zoneless -->
Zoneless Angular runs without zone.js. Instead of patching every async API and reacting to all async activity, Angular schedules change detection only from explicit notifications: signal updates read in templates, `markForCheck()` (called by the `async` pipe too), template and host event listeners, `ComponentRef.setInput`, and view attachment.

Zoneless reached stable in v20.2 with `provideZonelessChangeDetection()`, and new projects are zoneless by default from v21. Benefits: smaller bundles (no zone.js), faster startup and runtime, cleaner stack traces, no monkey-patching of native APIs, and better compatibility with native async/await (zone.js cannot patch native `async` functions, which is why the CLI downlevels them).

Migrating requires that components notify Angular when state changes. Apps built with OnPush and signals are usually ready already. Code that sets plain fields in `setTimeout` callbacks or manual subscriptions will no longer update the view.

```ts
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection(), provideRouter(routes)],
};
// angular.json: remove "zone.js" from "polyfills" (and "zone.js/testing" from test polyfills)

@Component({
  selector: 'app-timer',
  template: `{{ seconds() }}s`,
})
export class Timer {
  protected seconds = signal(0);
  constructor() {
    const id = setInterval(() => this.seconds.update(s => s + 1), 1000); // signal notifies Angular
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }
}
```

- Pitfall: `NgZone.onStable`/`onMicrotaskEmpty` never emit in zoneless apps; replace with `afterNextRender` or `afterRenderEffect`.
- Pitfall: SSR stability previously relied on zone.js to know when async work finished; zoneless uses `PendingTasks`, so wrap custom async work that must finish before serialisation.

### Lifecycle hooks and render callbacks
<!-- level: basic; ref: https://angular.dev/guide/components/lifecycle -->
Components go through a lifecycle: creation, input setting, rendering, updates, destruction. Angular calls hook methods if you implement them. The ones you still regularly use:

- `ngOnInit`: once, after the first inputs are set. Place initialisation that depends on inputs here (or use `computed`/`resource` from input signals instead).
- `ngOnChanges(changes)`: before `ngOnInit` and whenever a decorator `@Input` changes; largely unnecessary with signal inputs.
- `ngAfterViewInit`: after the component's view and child views are created; signal queries reduce the need for it.
- `ngOnDestroy`: cleanup; `DestroyRef.onDestroy` is the composable alternative.

For DOM work, Angular provides render callbacks that run after the DOM has been updated and only in the browser (never during SSR): `afterNextRender(fn)` runs once after the next render, and `afterEveryRender(fn)` (formerly `afterRender`) after every render. `afterRenderEffect` (stable in v20) combines both with signal tracking. They accept phases (`earlyRead`, `write`, `mixedReadWrite`, `read`) to batch DOM reads and writes and avoid layout thrashing.

```ts
@Component({ selector: 'app-chart', template: `<canvas #c></canvas>` })
export class SalesChart implements OnInit {
  data = input.required<number[]>();
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private chart?: ChartLib;

  ngOnInit() {
    console.log('inputs ready', this.data().length);
  }

  constructor() {
    afterNextRender({ write: () => { this.chart = new ChartLib(this.canvas().nativeElement); } });
    afterRenderEffect(() => this.chart?.setData(this.data())); // re-runs when data changes
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }
}
```

- Pitfall: touching `window` or `document` in `ngOnInit` breaks SSR; use render callbacks.
