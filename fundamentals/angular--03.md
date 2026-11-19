## 7. Routing

### Defining routes and the router outlet
<!-- level: basic; ref: https://angular.dev/guide/routing/define-routes -->
The Angular router maps URLs to components. You define an array of `Route` objects and register it with `provideRouter(routes)`. Each route has a `path` and something to render: `component`, `loadComponent` (lazy), `loadChildren` (lazy group of child routes), or `redirectTo`. Child routes render inside their parent's `<router-outlet>`, giving you nested layouts.

Navigation in templates uses the `RouterLink` directive, which renders a real `<a href>` (so open-in-new-tab and accessibility work) and intercepts clicks for client-side navigation. `RouterLinkActive` adds a class to links whose route is active.

Route matching goes in order, first match wins, so put specific paths before wildcards and the `**` catch-all last. Paths have no leading slash.

```ts
// app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', component: Home, title: 'Home' },
  {
    path: 'products',
    component: ProductsLayout,
    children: [
      { path: '', component: ProductList, title: 'Products' },
      { path: ':id', component: ProductDetail, title: 'Product' },
    ],
  },
  { path: 'admin', loadChildren: () => import('./admin/admin.routes').then(m => m.ADMIN_ROUTES) },
  { path: 'old-shop', redirectTo: 'products', pathMatch: 'full' },
  { path: '**', component: NotFound, title: 'Not found' },
];

// app.ts
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav>
      <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Home</a>
      <a routerLink="/products" routerLinkActive="active">Products</a>
    </nav>
    <main><router-outlet /></main>
  `,
})
export class App {}
```

- Interview tip: the `title` property updates `document.title` automatically; a custom `TitleStrategy` can add a suffix.
- Pitfall: an empty-path redirect without `pathMatch: 'full'` matches every URL.

### Route parameters and component input binding
<!-- level: basic; ref: https://angular.dev/guide/routing/common-router-tasks -->
Dynamic segments such as `products/:id` capture values from the URL. Query parameters (`?sort=price`) and route `data` (static values in the route config) or `resolve` results are other sources of route state.

The classic way to read them is injecting `ActivatedRoute` and subscribing to `paramMap`, `queryParamMap` or `data`. The modern, simpler way is component input binding: enable `withComponentInputBinding()` in `provideRouter`, and the router sets component inputs whose names match path params, query params, data or resolved values. With signal inputs, the component reacts to navigation automatically.

Remember that Angular reuses the component instance when navigating between URLs that match the same route (for example `/products/1` to `/products/2`). Code that reads the param only once in the constructor will show stale data; signals and observables handle this correctly.

```ts
// provideRouter(routes, withComponentInputBinding())

@Component({
  selector: 'app-product-detail',
  template: `
    @if (product.hasValue()) {
      <h1>{{ product.value().name }}</h1>
      <p>Sorted by {{ sort() ?? 'relevance' }}</p>
    }
  `,
})
export class ProductDetail {
  id = input.required<string>();      // from :id
  sort = input<string>();             // from ?sort=
  private api = inject(ProductApi);

  protected product = rxResource({
    params: () => this.id(),
    stream: ({ params: id }) => this.api.getProduct(id),
  });
}

// Navigating programmatically with params
this.router.navigate(['/products', p.id], { queryParams: { sort: 'price' } });
```

- Pitfall: all URL params are strings; convert numbers with `numberAttribute` as an input `transform`.
- Pitfall: `snapshot.paramMap.get('id')` reads once and misses later changes when the component is reused.

### Functional route guards
<!-- level: intermediate; ref: https://angular.dev/guide/routing/route-guards -->
Guards decide whether navigation may proceed. Modern Angular uses plain functions with `inject()` instead of guard classes:

- `CanActivateFn`: may the route be activated?
- `CanActivateChildFn`: same, for all children.
- `CanDeactivateFn<T>`: may the user leave (unsaved changes)?
- `CanMatchFn`: should this route definition even match? If it returns false, the router tries the next route; this also prevents lazy code from downloading for unauthorised users.

A guard returns `boolean`, a `UrlTree` (redirect), or a `RedirectCommand` (redirect with navigation options), synchronously or as an observable/promise.

Guards are a UX feature, not security. The client code is visible and modifiable; authorisation must be enforced by the server for every API call.

```ts
import { CanActivateFn, CanDeactivateFn, CanMatchFn, Router } from '@angular/router';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isLoggedIn()
    ? true
    : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

export const adminMatch: CanMatchFn = () => inject(AuthService).user()?.role === 'admin';

export interface HasUnsavedChanges { hasUnsavedChanges(): boolean; }
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = component =>
  !component.hasUnsavedChanges() || confirm('Discard unsaved changes?');

export const routes: Routes = [
  { path: 'admin', canMatch: [adminMatch], loadChildren: () => import('./admin/admin.routes') },
  { path: 'account', canActivate: [authGuard], component: Account },
  { path: 'editor/:id', component: Editor, canDeactivate: [unsavedChangesGuard] },
];
```

- Pitfall: `canActivate` on a lazy route still downloads its code before rejecting; use `canMatch` to avoid that.

### Resolvers and route data
<!-- level: intermediate; ref: https://angular.dev/guide/routing/data-resolvers -->
A resolver fetches data before a route activates, so the component renders with data already available. A `ResolveFn<T>` is a function that uses `inject()` and returns a value, promise or observable. The router waits for it, then exposes the result through `ActivatedRoute.data` or, with component input binding, as an input with the resolver's key.

Resolvers make sense when a page is useless without its data (an edit form for a specific record), when you want the URL to change only after data is ready, or when a missing record should redirect to a 404 page before rendering.

The trade-off is perceived performance: navigation appears to do nothing until the resolver finishes. Show a global progress indicator by listening to router events, or prefer loading inside the component with `resource`/skeleton UI for slow or non-critical data.

```ts
export const orderResolver: ResolveFn<Order> = route => {
  const api = inject(OrderApi);
  const router = inject(Router);
  return api.get(route.paramMap.get('id')!).pipe(
    catchError(() => of(new RedirectCommand(router.parseUrl('/orders/not-found')))),
  );
};

export const routes: Routes = [
  {
    path: 'orders/:id/edit',
    component: OrderEdit,
    resolve: { order: orderResolver },
    data: { breadcrumb: 'Edit order' },
  },
];

@Component({ selector: 'app-order-edit', template: `<h1>Edit #{{ order().number }}</h1>` })
export class OrderEdit {
  order = input.required<Order>();        // bound from resolve.order
  breadcrumb = input<string>();           // bound from data.breadcrumb
}
```

- Pitfall: by default resolvers do not re-run when only query params change; configure `runGuardsAndResolvers` if they should.

### Navigation, router events and lazy loading strategy
<!-- level: intermediate; ref: https://angular.dev/guide/routing/router-reference -->
Programmatic navigation uses the `Router` service: `navigate(commands, extras)` for array-based paths relative to a route, or `navigateByUrl(url)` for absolute URLs. Both return a promise that resolves to whether navigation succeeded.

The router emits events through `router.events`: `NavigationStart`, `GuardsCheckEnd`, `ResolveEnd`, `NavigationEnd`, `NavigationCancel`, `NavigationError` and more. They power global loading bars, analytics page views and focus management.

Lazy loading with `loadComponent`/`loadChildren` splits code per route. A preloading strategy then downloads lazy chunks in the background after the app is stable: `withPreloading(PreloadAllModules)` preloads everything; custom strategies can preload only routes flagged in `data` or on link hover. Other useful features: `withViewTransitions()` for animated transitions via the View Transitions API, `withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })`, and `withRouterConfig({ onSameUrlNavigation: 'reload' })`.

```ts
provideRouter(
  routes,
  withComponentInputBinding(),
  withPreloading(PreloadAllModules),
  withViewTransitions(),
  withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
);

@Component({ selector: 'app-shell', template: `@if (loading()) { <div class="top-bar"></div> } <router-outlet />`, imports: [RouterOutlet] })
export class Shell {
  private router = inject(Router);
  protected loading = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationStart || e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError),
      map(e => e instanceof NavigationStart),
    ),
    { initialValue: false },
  );
}
```

- Pitfall: navigation to the same URL does nothing by default; users clicking the current link expect a refresh, so handle it explicitly if needed.
- Interview tip: after navigation, move focus to the main heading for screen-reader users.

## 8. Forms

### Reactive forms
<!-- level: intermediate; ref: https://angular.dev/guide/forms/reactive-forms -->
Reactive forms define the form model in the component class with `FormControl`, `FormGroup` and `FormArray`, and bind it to the template with directives (`[formGroup]`, `formControlName`, `formArrayName`). The model is the source of truth: values, validation state and status are available synchronously, and changes are exposed as observables (`valueChanges`, `statusChanges`) and, since v18, as a unified `events` stream.

Because the structure lives in code, reactive forms are easy to test without a DOM, support dynamic forms (adding controls at runtime), and are strongly typed. `FormBuilder` (or `NonNullableFormBuilder`) reduces boilerplate.

Every control tracks state flags: `valid`/`invalid`, `pending` (async validation), `pristine`/`dirty` (value changed by the user), `touched`/`untouched` (blurred). Use `touched` or a submitted flag to decide when to show errors.

```ts
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';

@Component({
  selector: 'app-address-form',
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()">
      <label>Name <input formControlName="name" /></label>
      @if (form.controls.name.touched && form.controls.name.hasError('required')) {
        <small role="alert">Name is required</small>
      }
      <div formGroupName="address">
        <label>City <input formControlName="city" /></label>
        <label>PIN <input formControlName="pin" inputmode="numeric" /></label>
      </div>
      <button [disabled]="form.pending">Save</button>
    </form>
  `,
})
export class AddressForm {
  private fb = inject(NonNullableFormBuilder);
  protected form = this.fb.group({
    name: ['', Validators.required],
    address: this.fb.group({
      city: ['', Validators.required],
      pin: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    }),
  });

  save() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    console.log(this.form.getRawValue());
  }
}
```

- Pitfall: `form.value` omits disabled controls; use `getRawValue()` when you need everything.

### Typed forms
<!-- level: intermediate; ref: https://angular.dev/guide/forms/typed-forms -->
Since v14, reactive forms are strictly typed. A `FormControl<string>` exposes `value` as `string | null` (because `reset()` returns it to `null` by default), and a `FormGroup` infers its value type from its controls. TypeScript then catches mistakes such as patching a non-existent field, assigning a number to a text control, or misspelling `form.controls.emial`.

To avoid `null` in types, create non-nullable controls: `new FormControl('', { nonNullable: true })` or use `NonNullableFormBuilder` (`inject(FormBuilder).nonNullable`). Then `reset()` restores the initial value instead of null.

`FormArray<FormControl<string>>` types dynamic lists. `FormRecord<FormControl<boolean>>` types groups with dynamic keys (for example, permission checkboxes keyed by id). `UntypedFormGroup` exists for gradual migration of old code.

```ts
interface ProfileForm {
  displayName: FormControl<string>;
  age: FormControl<number | null>;
  tags: FormArray<FormControl<string>>;
  notifications: FormRecord<FormControl<boolean>>;
}

const form = new FormGroup<ProfileForm>({
  displayName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
  age: new FormControl<number | null>(null, Validators.min(13)),
  tags: new FormArray([new FormControl('angular', { nonNullable: true })]),
  notifications: new FormRecord({ email: new FormControl(true, { nonNullable: true }) }),
});

form.controls.tags.push(new FormControl('signals', { nonNullable: true }));
form.controls.notifications.addControl('sms', new FormControl(false, { nonNullable: true }));
form.patchValue({ displayName: 'Asha' });
// form.patchValue({ displayname: 'x' }); // compile error: unknown key
const value = form.getRawValue(); // { displayName: string; age: number | null; tags: string[]; ... }
```

- Pitfall: `value` on a group types every field as optional (`Partial`), because disabled controls are excluded; `getRawValue()` returns the complete type.

### Validation
<!-- level: intermediate; ref: https://angular.dev/guide/forms/form-validation -->
Validators are functions that receive a control and return `null` when valid or an error object (`{ minlength: { requiredLength: 8, actualLength: 3 } }`) when invalid. Angular ships common validators (`required`, `email`, `min`, `max`, `minLength`, `maxLength`, `pattern`). Custom validators are plain functions, so they are easy to write and test.

Cross-field validation (password confirmation, date ranges) is placed on the parent `FormGroup`, which can read several children. Async validators return an observable or promise, for example checking username availability on the server; the control is `pending` while they run. Use `updateOn: 'blur'` to avoid firing them on every keystroke.

Client-side validation is for user experience. The server must validate again.

```ts
export function strongPassword(): ValidatorFn {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const v = control.value ?? '';
    const ok = v.length >= 12 && /\d/.test(v) && /[A-Z]/.test(v);
    return ok ? null : { strongPassword: true };
  };
}

export const passwordsMatch: ValidatorFn = group => {
  const { password, confirm } = (group as FormGroup).getRawValue();
  return password === confirm ? null : { passwordsMismatch: true };
};

export function usernameAvailable(api: UserApi): AsyncValidatorFn {
  return control => timer(300).pipe(
    switchMap(() => api.isAvailable(control.value)),
    map(ok => (ok ? null : { taken: true })),
    catchError(() => of(null)),
  );
}

form = this.fb.group(
  {
    username: ['', { validators: [Validators.required], asyncValidators: [usernameAvailable(this.api)], updateOn: 'blur' }],
    password: ['', [Validators.required, strongPassword()]],
    confirm: ['', Validators.required],
  },
  { validators: passwordsMatch },
);
```

- Pitfall: error messages must be associated with inputs (`aria-describedby`) and announced, not only shown in red.

### Template-driven forms
<!-- level: basic; ref: https://angular.dev/guide/forms/template-driven-forms -->
Template-driven forms build the form model implicitly from the template using directives from `FormsModule`: `ngModel` on each input creates a `FormControl` behind the scenes, `<form>` gets an `NgForm` automatically, and `ngModelGroup` creates nested groups. Validation uses HTML attributes (`required`, `minlength`, `email`) that map to Angular validators.

They are quick to write for simple forms (login, contact, settings with a few fields) and feel familiar to people coming from AngularJS. The trade-offs: the model is created asynchronously, logic lives in the template, dynamic structure is awkward, and unit testing requires rendering the template. Reactive forms are generally preferred for complex forms.

Two-way binding `[(ngModel)]` keeps a component field (or a signal) in sync with the input.

```ts
import { FormsModule, NgForm } from '@angular/forms';

@Component({
  selector: 'app-contact',
  imports: [FormsModule],
  template: `
    <form #f="ngForm" (ngSubmit)="send(f)">
      <label>
        Email
        <input name="email" type="email" [(ngModel)]="email" required email #emailCtrl="ngModel" />
      </label>
      @if (emailCtrl.invalid && (emailCtrl.touched || f.submitted)) {
        <small role="alert">Enter a valid email</small>
      }
      <label>Message <textarea name="message" ngModel required minlength="10"></textarea></label>
      <button [disabled]="f.invalid">Send</button>
    </form>
  `,
})
export class Contact {
  protected email = '';
  send(form: NgForm) {
    console.log(form.value); // { email: '...', message: '...' }
    form.resetForm();
  }
}
```

- Pitfall: every `ngModel` inside a `<form>` needs a `name` attribute, or Angular throws.
- Interview tip: do not mix `ngModel` and `formControlName` on the same control.

### Signal Forms (experimental)
<!-- level: advanced; ref: https://angular.dev/guide/forms -->
Angular v21 introduced Signal Forms as an experimental API in `@angular/forms/signals`. Instead of building a tree of `FormControl` objects, you start from a signal holding your data model and call `form(model, schemaFn)`. The result is a field tree that mirrors the shape of your data; each field exposes signal-based state such as `value()`, `valid()`, `errors()`, `touched()`, `dirty()` and `disabled()`. Validation rules are declared in a schema function with helpers like `required`, `email`, `minLength`, `pattern`, `validate` (custom) and async validation, and they can be conditional.

In the template, a single directive binds a field to an input; it was named `[control]` in early previews and `[field]` in later v21 builds, which shows why you must check the docs for your exact version. Because everything is signals, the API works naturally with zoneless change detection and `computed` values.

```ts
import { Component, signal } from '@angular/core';
import { form, Field, required, email, minLength } from '@angular/forms/signals';

interface Signup { email: string; password: string; }

@Component({
  selector: 'app-signup',
  imports: [Field],
  template: `
    <input type="email" [field]="signupForm.email" />
    @for (err of signupForm.email().errors(); track err.kind) { <small>{{ err.message }}</small> }
    <input type="password" [field]="signupForm.password" />
    <button [disabled]="signupForm().invalid()" (click)="submit()">Create account</button>
  `,
})
export class SignupPage {
  protected model = signal<Signup>({ email: '', password: '' });
  protected signupForm = form(this.model, path => {
    required(path.email, { message: 'Email is required' });
    email(path.email, { message: 'Enter a valid email' });
    minLength(path.password, 12, { message: 'At least 12 characters' });
  });

  submit() { console.log(this.model()); }
}
```

- Pitfall: experimental APIs can change in minor releases; keep production forms on reactive forms until Signal Forms is declared stable.

## 9. HTTP

### HttpClient
<!-- level: basic; ref: https://angular.dev/guide/http/making-requests -->
`HttpClient` is Angular's service for calling HTTP APIs. Methods such as `get<T>`, `post<T>`, `put`, `patch` and `delete` return cold observables: nothing is sent until you subscribe (directly, via the `async` pipe, `toSignal`, or `rxResource`), and each subscription sends a new request. A successful request emits one value and completes, so HTTP subscriptions do not leak the way long-lived streams do.

Configure it with `provideHttpClient()` in the app config; options include `withFetch()` (uses the Fetch API, recommended especially with SSR), `withInterceptors([...])` and `withXsrfConfiguration()`. From v21, `HttpClient` is available in the root injector by default, but you still call `provideHttpClient` to configure features.

Responses are parsed as JSON by default. Options control headers, query params (`params`), response type (`text`, `blob`, `arraybuffer`), `observe: 'response'` for headers and status, and `reportProgress` for uploads.

The generic `<T>` is only a type assertion; the server is not validated. For untrusted or versioned APIs, validate at runtime with a schema.

```ts
@Injectable({ providedIn: 'root' })
export class ProductApi {
  private http = inject(HttpClient);
  private base = inject(API_BASE_URL);

  list(filter: { q?: string; page: number }) {
    return this.http.get<Page<Product>>(`${this.base}/products`, {
      params: { page: filter.page, ...(filter.q ? { q: filter.q } : {}) },
    });
  }

  create(input: NewProduct) {
    return this.http.post<Product>(`${this.base}/products`, input);
  }

  downloadInvoice(id: string) {
    return this.http.get(`${this.base}/invoices/${id}.pdf`, { responseType: 'blob' });
  }
}
```

- Pitfall: calling `create()` without subscribing sends nothing.
- Pitfall: subscribing twice to the same request observable sends two requests; use `shareReplay` if you need to share one.

### Interceptors
<!-- level: intermediate; ref: https://angular.dev/guide/http/interceptors -->
Interceptors are middleware for `HttpClient`. Every request passes through the chain in order, and each interceptor can modify the request, short-circuit with a cached response, or transform the response stream on the way back. Typical uses: attaching auth tokens, setting base URLs, logging and timing, retrying, global error handling, showing a loading indicator, and caching.

Modern interceptors are functions of type `HttpInterceptorFn`, registered with `provideHttpClient(withInterceptors([...]))`. They can use `inject()`. Requests are immutable, so you use `req.clone({...})` to change them. Interceptors can be configured per request with `HttpContext` tokens, for example to skip auth on public endpoints.

```ts
export const SKIP_AUTH = new HttpContextToken<boolean>(() => false);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SKIP_AUTH) || !req.url.startsWith('/api')) return next(req);
  const token = inject(AuthService).accessToken();
  return next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const toast = inject(Toaster);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401) router.navigate(['/login']);
      else if (err.status >= 500) toast.error('Server error, please retry');
      return throwError(() => err);
    }),
  );
};

provideHttpClient(withFetch(), withInterceptors([authInterceptor, errorInterceptor]));

// Opt out per request
this.http.get('/api/public/config', { context: new HttpContext().set(SKIP_AUTH, true) });
```

- Pitfall: never attach tokens to third-party URLs; check the target origin.
- Pitfall: class-based interceptors need `withInterceptorsFromDi()`; mixing styles makes ordering confusing.

### Error handling, retries and httpResource
<!-- level: intermediate; ref: https://angular.dev/guide/http/http-resource -->
HTTP errors arrive as `HttpErrorResponse` in the observable's error channel. `status` 0 means a network-level failure (offline, CORS, DNS); other codes come from the server. Handle errors where you can do something meaningful: in a service to map them to domain errors, in an interceptor for global concerns, or in the component to show a message.

Use RxJS for resilience: `retry({ count, delay })` with exponential backoff for transient failures on idempotent requests (GET, PUT), `timeout` to avoid hanging requests, and `catchError` to return a fallback. Do not blindly retry POSTs that create resources.

For read-heavy UI, `httpResource` (introduced in v19.2, experimental in v20) wraps `HttpClient` in a signal-based resource. It re-requests when signals read in its URL function change, cancels stale requests, and exposes `value`, `isLoading`, `error` and `status` signals. It still runs through interceptors.

```ts
@Injectable({ providedIn: 'root' })
export class OrderApi {
  private http = inject(HttpClient);

  get(id: string) {
    return this.http.get<Order>(`/api/orders/${id}`).pipe(
      timeout(10_000),
      retry({ count: 3, delay: (_err, attempt) => timer(2 ** attempt * 250) }),
      catchError((err: HttpErrorResponse) =>
        throwError(() => (err.status === 404 ? new NotFoundError(id) : err)),
      ),
    );
  }
}

@Component({
  selector: 'app-order-page',
  template: `
    @if (order.isLoading()) { <app-skeleton /> }
    @else if (order.error()) { <p role="alert">Could not load order.</p> }
    @else if (order.hasValue()) { <app-order-view [order]="order.value()" /> }
  `,
})
export class OrderPage {
  id = input.required<string>();
  protected order = httpResource<Order>(() => `/api/orders/${this.id()}`);
}
```

- Pitfall: swallowing errors with `catchError(() => EMPTY)` leaves the UI in a loading state with no feedback.

## 10. RxJS essentials

### Observables and subscriptions
<!-- level: basic; ref: https://angular.dev/ecosystem/rxjs-interop -->
RxJS is the library Angular uses for streams: values delivered over time. An `Observable` is a lazy description of a stream; nothing happens until someone subscribes. A subscription receives three kinds of notifications: `next` (a value), `error` (terminal failure) and `complete` (terminal success). Calling `unsubscribe()` stops it and runs teardown logic (clearing timers, closing sockets).

Most observables are cold: each subscriber triggers its own execution (each subscription to an HTTP observable sends its own request). Hot observables, such as DOM events or Subjects, produce values regardless of subscribers, and late subscribers miss earlier values.

Angular APIs that expose observables include `HttpClient`, router events, `ActivatedRoute`, reactive forms' `valueChanges`, and `outputToObservable`. In modern Angular, signals handle most component state, and RxJS remains the tool for event coordination.

```ts
import { Observable, fromEvent, interval } from 'rxjs';
import { map, take } from 'rxjs/operators';

// Creating an observable by hand shows the contract
const ticks$ = new Observable<number>(subscriber => {
  let n = 0;
  const id = setInterval(() => subscriber.next(n++), 1000);
  return () => clearInterval(id); // teardown on unsubscribe
});

const sub = ticks$.pipe(take(5), map(n => n * 10)).subscribe({
  next: v => console.log(v),
  error: e => console.error(e),
  complete: () => console.log('done'),
});

const resize$ = fromEvent(window, 'resize').pipe(map(() => window.innerWidth));
```

- Pitfall: nested subscribes (`a$.subscribe(a => b$.subscribe(...))`) leak and race; use flattening operators.
- Interview tip: an Observable can emit many values; a Promise resolves once and is eager.

### Subjects and BehaviorSubject
<!-- level: intermediate; ref: https://angular.dev/guide/signals -->
A `Subject` is both an observable and an observer: you can push values into it with `next()` and many subscribers receive them. It is hot and multicast. Variants differ in what late subscribers get:

1. `Subject`: nothing from the past; only future values.
2. `BehaviorSubject(initial)`: always has a current value; new subscribers immediately get the latest one, and `.value` reads it synchronously.
3. `ReplaySubject(n)`: replays the last `n` values to new subscribers.
4. `AsyncSubject`: emits only the last value when it completes.

Before signals, a service exposing a `BehaviorSubject` as a read-only `Observable` was the standard Angular state-store pattern. Today a signal usually fits better for state, while Subjects remain useful for event buses and for bridging imperative callbacks into streams (such as a "refresh" trigger combined with `switchMap`).

```ts
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly refresh$ = new Subject<void>();
  private readonly http = inject(HttpClient);

  // Re-fetch every 60 s or whenever refresh() is called, cancelling stale requests
  readonly notifications$ = merge(timer(0, 60_000), this.refresh$).pipe(
    switchMap(() => this.http.get<Notification[]>('/api/notifications')),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  refresh() {
    this.refresh$.next();
  }
}
```

- Pitfall: exposing the Subject itself lets any consumer call `next()`; expose `subject.asObservable()`.
- Pitfall: `shareReplay(1)` without `refCount: true` keeps the source subscribed forever, even with no subscribers.

### Common operators
<!-- level: intermediate; ref: https://angular.dev/ecosystem/rxjs-interop -->
Operators are functions that transform streams, composed with `pipe()`. A small set covers most Angular work:

1. Transform and filter: `map`, `filter`, `distinctUntilChanged`, `scan` (running accumulation), `startWith`.
2. Time: `debounceTime` (wait for a pause, for search input), `throttleTime` (at most one per interval, for scroll), `auditTime`, `delay`, `timeout`.
3. Flattening (map to an inner observable): `switchMap` (cancel previous, for searches and route params), `concatMap` (queue in order, for sequential saves), `mergeMap` (parallel), `exhaustMap` (ignore while busy, for submit buttons).
4. Combination: `combineLatest` (latest from each, once all have emitted), `forkJoin` (wait for all to complete, like `Promise.all`), `withLatestFrom`, `merge`.
5. Errors and completion: `catchError`, `retry`, `finalize`, `take`, `takeUntil`, `first`.
6. Sharing: `shareReplay`, `share`.

```ts
// Dashboard: load three independent resources in parallel
const dashboard$ = forkJoin({
  user: this.api.me(),
  stats: this.api.stats(),
  alerts: this.api.alerts().pipe(catchError(() => of([]))), // one failure should not kill all
});

// Autosave: wait for a pause, skip unchanged values, save in order
this.form.valueChanges.pipe(
  debounceTime(800),
  distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
  concatMap(value => this.api.saveDraft(value)),
  takeUntilDestroyed(),
).subscribe();
```

- Pitfall: `forkJoin` never emits if any source never completes (for example a `valueChanges` stream) and fails entirely if one source errors.
- Pitfall: `catchError` placed at the outer level ends the outer stream after the first error; put it inside the flattening operator to keep the stream alive.

### Managing subscriptions safely
<!-- level: intermediate; ref: https://angular.dev/ecosystem/rxjs-interop/take-until-destroyed -->
Long-lived subscriptions (intervals, WebSockets, store selections, router events, `valueChanges`) keep running after a component is destroyed unless you unsubscribe. The result is memory leaks, duplicate work and handlers running against destroyed views.

Preferred approaches, from most to least automatic:

1. Do not subscribe manually: use `toSignal()` or the `async` pipe, which subscribe and unsubscribe with the component.
2. `takeUntilDestroyed()` from `@angular/core/rxjs-interop`: completes the stream when the current injection context is destroyed. Call it without arguments in an injection context, or pass a `DestroyRef` elsewhere.
3. Use operators that complete naturally: `take(1)`, `first()`, HTTP requests.
4. Manual `Subscription` management with `ngOnDestroy` as a last resort.

Place `takeUntilDestroyed()` as the last operator in the pipe, so that operators after it cannot keep the subscription alive.

```ts
@Component({ selector: 'app-live-prices', template: `@for (p of prices(); track p.symbol) { <p>{{ p.symbol }} {{ p.price }}</p> }` })
export class LivePrices {
  private socket = inject(PriceSocket);
  private destroyRef = inject(DestroyRef);

  protected prices = toSignal(this.socket.prices$, { initialValue: [] }); // auto-managed

  constructor() {
    this.socket.alerts$.pipe(takeUntilDestroyed()).subscribe(a => this.toast(a));
  }

  watch(symbol: string) {
    // outside the constructor: pass the DestroyRef explicitly
    this.socket.ticks(symbol).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(t => console.log(t));
  }

  private toast(a: Alert) { /* ... */ }
}
```

- Pitfall: services provided in root live forever; subscriptions inside them are fine only if intended to last for the app's lifetime.
