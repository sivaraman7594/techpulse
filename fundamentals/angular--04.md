## 11. Pipes and directives

### Built-in and custom pipes
<!-- level: basic; ref: https://angular.dev/guide/templates/pipes -->
Pipes transform values for display in templates using the `|` operator: `{{ amount | currency: 'INR' }}`. Angular provides `DatePipe`, `CurrencyPipe`, `DecimalPipe`, `PercentPipe`, `UpperCasePipe`, `TitleCasePipe`, `JsonPipe`, `KeyValuePipe`, `SlicePipe`, `I18nPluralPipe` and `AsyncPipe`, all locale-aware where relevant. Pipes are imported into a component's `imports` like any other dependency.

A custom pipe is a class with `@Pipe({ name })` implementing `transform(value, ...args)`. By default pipes are pure: Angular calls `transform` only when the input value or arguments change by reference, and caches the result otherwise. That makes pure pipes a cheap, memoised alternative to calling methods in templates. Impure pipes (`pure: false`) run on every change detection pass and should be rare.

```ts
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'relativeTime' })
export class RelativeTimePipe implements PipeTransform {
  private rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  transform(value: Date | string | null, now: Date = new Date()): string {
    if (!value) return '';
    const diffSec = Math.round((new Date(value).getTime() - now.getTime()) / 1000);
    const units: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, sec] of units) {
      if (Math.abs(diffSec) >= sec) return this.rtf.format(Math.round(diffSec / sec), unit);
    }
    return this.rtf.format(diffSec, 'second');
  }
}

@Component({
  selector: 'app-comment-meta',
  imports: [RelativeTimePipe, DatePipe],
  template: `<time [attr.datetime]="createdAt()" [title]="createdAt() | date: 'medium'">{{ createdAt() | relativeTime }}</time>`,
})
export class CommentMeta {
  createdAt = input.required<string>();
}
```

- Pitfall: a pure pipe receiving a mutated array (same reference) will not re-run; update immutably.
- Interview tip: compare pipes with `computed` signals: pipes are reusable across templates, computeds are per component.

### The async pipe
<!-- level: basic; ref: https://angular.dev/api/common/AsyncPipe -->
The `async` pipe subscribes to an observable or promise from the template, returns the latest emitted value, and marks the component for check on each emission so OnPush and zoneless components update. When the component is destroyed, or the expression switches to a different observable, it unsubscribes automatically. This removes most manual subscription code and the leaks that come with it.

Before emitting, the pipe returns `null`, so templates usually guard with `@if (data$ | async; as data)`. Each `| async` creates its own subscription, so using the same cold observable twice sends two HTTP requests; unwrap once with `@let` or `@if ... as`, or share the source.

In signal-first code, `toSignal` in the class often replaces the `async` pipe, but the pipe remains common and perfectly valid, especially with NgRx selectors and existing RxJS-heavy services.

```ts
@Component({
  selector: 'app-profile',
  imports: [AsyncPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let profile = profile$ | async;
    @if (profile) {
      <h2>{{ profile.name }}</h2>
      <p>{{ profile.email }}</p>
      <p>Member for {{ profile.years }} years</p>
    } @else {
      <app-skeleton />
    }
  `,
})
export class Profile {
  protected profile$ = inject(ProfileApi).me();
}
```

- Pitfall: `@if (count$ | async)` hides the content when the value is `0`, because 0 is falsy; compare explicitly or use `@let`.
- Pitfall: calling a method that returns a new observable (`getUser() | async`) creates a new subscription on every change detection pass; store the observable in a field.

### Attribute directives
<!-- level: intermediate; ref: https://angular.dev/guide/directives/attribute-directives -->
A directive adds behaviour to an existing element without its own template. Attribute directives change appearance or behaviour: tooltips, autofocus, click-outside detection, permission-based disabling, input masks. Angular's own `NgClass`, `NgStyle` and `NgModel` are attribute directives.

A directive is a class with `@Directive({ selector: '[appSomething]' })`. It can have inputs (often aliased to the selector name so the attribute value becomes the main input), outputs, host bindings, host listeners, and can inject `ElementRef`, `Renderer2` or services. Like components, directives are standalone and imported where used.

Prefer host bindings over direct DOM manipulation, and use `Renderer2` or render callbacks when you must touch the DOM, so the directive is SSR-safe.

```ts
import { Directive, ElementRef, inject, output, input } from '@angular/core';

@Directive({
  selector: '[appClickOutside]',
  host: { '(document:click)': 'onDocumentClick($event)' },
})
export class ClickOutside {
  private el = inject<ElementRef<HTMLElement>>(ElementRef);
  clickOutside = output<void>({ alias: 'appClickOutside' });

  protected onDocumentClick(event: MouseEvent) {
    if (!this.el.nativeElement.contains(event.target as Node)) this.clickOutside.emit();
  }
}

@Directive({
  selector: '[appRequiresRole]',
  host: { '[attr.disabled]': 'allowed() ? null : ""', '[attr.title]': 'allowed() ? null : "Insufficient permissions"' },
})
export class RequiresRole {
  role = input.required<string>({ alias: 'appRequiresRole' });
  private auth = inject(AuthService);
  protected allowed = computed(() => this.auth.hasRole(this.role()));
}

// <div class="menu" (appClickOutside)="close()">…</div>
// <button appRequiresRole="admin">Delete user</button>
```

- Pitfall: a disabled attribute does not protect anything server-side; the API must check permissions.

### Structural directives and ng-template
<!-- level: advanced; ref: https://angular.dev/guide/directives/structural-directives -->
Structural directives change the DOM structure by creating or removing views from a template. `<ng-template>` defines a chunk of template that is not rendered by itself; a directive receives it as a `TemplateRef` and decides when and how often to render it into a `ViewContainerRef`, optionally passing a context object.

The asterisk syntax is sugar: `<li *appRepeat="3; let i = index">` desugars to an `<ng-template>` with inputs. Built-in control flow (`@if`, `@for`) has replaced `*ngIf` and `*ngFor` for most needs, but custom structural directives remain useful for permission checks, feature flags, or reusable rendering logic. `ngTemplateOutlet` renders a template passed in as an input, which is how components accept customisable row or cell templates.

```ts
@Directive({ selector: '[appIfFeature]' })
export class IfFeature {
  private tpl = inject(TemplateRef<unknown>);
  private vcr = inject(ViewContainerRef);
  private flags = inject(FeatureFlags);
  appIfFeature = input.required<string>();

  constructor() {
    effect(() => {
      this.vcr.clear();
      if (this.flags.isOn(this.appIfFeature())) this.vcr.createEmbeddedView(this.tpl);
    });
  }
}

// Usage: <section *appIfFeature="'new-checkout'">…</section>

// A list component that accepts a row template from its parent
@Component({
  selector: 'app-data-list',
  imports: [NgTemplateOutlet],
  template: `
    @for (item of items(); track item.id) {
      <ng-container *ngTemplateOutlet="rowTemplate(); context: { $implicit: item, index: $index }" />
    }
  `,
})
export class DataList<T extends { id: string }> {
  items = input.required<T[]>();
  rowTemplate = input.required<TemplateRef<{ $implicit: T; index: number }>>();
}
```

- Interview tip: add a static `ngTemplateContextGuard` to type-check the template context.

### Directive composition API
<!-- level: advanced; ref: https://angular.dev/guide/directives/directive-composition-api -->
The directive composition API (`hostDirectives`, since v15) lets a component or directive apply other standalone directives to its own host element, as if the consumer had written them in the template. It is composition instead of inheritance: a `Button` component can include `Focusable`, `Tooltip` and `RippleEffect` behaviours without a base class hierarchy and without every user adding three attributes.

By default, inputs and outputs of host directives are private. You opt in by listing which ones to expose, optionally with aliases. Host directives are instantiated before the host component, and they can inject the host and each other via DI.

This is the foundation of headless UI libraries (Angular CDK, Angular Aria, Spartan): behaviour lives in small directives that design-system components compose.

```ts
@Directive({
  selector: '[appTooltip]',
  host: { '(mouseenter)': 'show()', '(mouseleave)': 'hide()', '(focus)': 'show()', '(blur)': 'hide()' },
})
export class Tooltip {
  text = input('', { alias: 'appTooltip' });
  show() { /* render overlay */ }
  hide() { /* remove overlay */ }
}

@Directive({ selector: '[appTrackClick]', host: { '(click)': 'track()' } })
export class TrackClick {
  eventName = input('button_click');
  private analytics = inject(Analytics);
  track() { this.analytics.track(this.eventName()); }
}

@Component({
  selector: 'app-icon-button',
  hostDirectives: [
    { directive: Tooltip, inputs: ['appTooltip: label'] },
    { directive: TrackClick, inputs: ['eventName'] },
  ],
  host: { role: 'button', tabindex: '0', '[attr.aria-label]': 'label()' },
  template: `<ng-content />`,
})
export class IconButton {
  label = input.required<string>();
}

// <app-icon-button label="Delete" eventName="delete_click">🗑</app-icon-button>
```

- Pitfall: host directives must be standalone, and a directive applied twice (via template and host) throws.

## 12. Rendering performance

### Deferrable views with @defer
<!-- level: intermediate; ref: https://angular.dev/guide/templates/defer -->
`@defer` blocks lazily load part of a template. Everything inside the block — components, directives and pipes used only there — is split into a separate JavaScript chunk by the compiler and loaded only when a trigger fires. This shrinks the initial bundle without route-level code splitting or manual dynamic imports.

Triggers: `on idle` (default, browser idle), `on viewport` (element enters the viewport), `on interaction`, `on hover`, `on immediate`, `on timer(2s)`, or `when condition` for a custom boolean. `prefetch on ...` downloads the chunk earlier than it renders, for example prefetch on idle and render on interaction.

Companion blocks: `@placeholder` (shown before loading starts; can specify `minimum` time to avoid flicker), `@loading` (during loading, with `after` and `minimum` options), and `@error` (if loading fails). During SSR, `@defer` renders the placeholder; with incremental hydration it can render the full content and defer hydration instead.

```html
<app-product-hero [product]="product()" />

@defer (on viewport; prefetch on idle) {
  <app-reviews [productId]="product().id" />
} @placeholder (minimum 300ms) {
  <div class="reviews-skeleton" aria-hidden="true"></div>
} @loading (after 150ms; minimum 400ms) {
  <app-spinner />
} @error {
  <p>Reviews could not be loaded.</p>
}

@defer (on interaction(openChat)) {
  <app-chat-widget />
} @placeholder {
  <button #openChat>Chat with us</button>
}
```

- Pitfall: if a deferred component is also imported anywhere eagerly in the same file's other code paths, it cannot be split, and the block loads instantly.
- Pitfall: `on viewport` needs a placeholder with real size; an empty placeholder may be "visible" immediately.

### Template performance practices
<!-- level: intermediate; ref: https://angular.dev/best-practices/runtime-performance -->
Most runtime slowness in Angular apps comes from doing too much work per change detection pass, or re-creating DOM that could be reused. Practical rules:

1. Use OnPush (or zoneless with signals) so only affected components are checked.
2. Never call expensive functions in templates; each binding runs on every check of the component. Use `computed` signals or pure pipes, which are memoised.
3. Always `track` by a stable id in `@for`, so Angular moves existing DOM nodes instead of destroying and recreating them when data refreshes.
4. Virtualise long lists with the CDK's `cdk-virtual-scroll-viewport`, or paginate.
5. Avoid triggering change detection for high-frequency events that do not affect the view. In zone-based apps, run such listeners outside Angular (`NgZone.runOutsideAngular`); in zoneless apps, events not bound in templates do not trigger checks unless they set signals.
6. Profile with Angular DevTools: the profiler shows each change detection cycle, which components were checked and how long they took.

```ts
@Component({
  selector: 'app-orders-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollingModule, CurrencyPipe],
  template: `
    <cdk-virtual-scroll-viewport itemSize="48" class="viewport">
      <div *cdkVirtualFor="let o of visible(); trackBy: trackById" class="row">
        {{ o.number }} · {{ o.total | currency: 'INR' }}
      </div>
    </cdk-virtual-scroll-viewport>
  `,
  styles: `.viewport { height: 600px; }`,
})
export class OrdersTable {
  orders = input.required<Order[]>();
  query = input('');
  protected visible = computed(() => {
    const q = this.query().toLowerCase();
    return this.orders().filter(o => o.number.toLowerCase().includes(q));
  });
  protected trackById = (_: number, o: Order) => o.id;
}
```

- Pitfall: getters in templates look like properties but run on every check.

### Optimised images with NgOptimizedImage
<!-- level: basic; ref: https://angular.dev/guide/image-optimization -->
Images are frequently the Largest Contentful Paint element and the heaviest resources on a page. The `NgOptimizedImage` directive (`ngSrc` instead of `src`) enforces and automates image best practices:

- It requires `width` and `height` (or `fill`), preventing layout shifts.
- Images are lazy-loaded by default; marking the LCP image with `priority` makes it eager, sets `fetchpriority="high"`, and in SSR adds a preload link.
- With an image loader for your CDN (built-in loaders exist for Cloudinary, Imgix, ImageKit, Netlify and others, or write your own), it generates a responsive `srcset` automatically.
- In development it warns about common mistakes: oversized images, missing `priority` on the LCP image, distorted aspect ratios, and missing preconnects to the image origin.
- `placeholder` shows a low-quality blurred preview while loading.

```ts
import { NgOptimizedImage, provideImgixLoader } from '@angular/common';

// app.config.ts: providers: [provideImgixLoader('https://acme.imgix.net/')]

@Component({
  selector: 'app-product-hero',
  imports: [NgOptimizedImage],
  template: `
    <img
      [ngSrc]="product().image"
      [alt]="product().name"
      width="1200"
      height="800"
      sizes="(max-width: 768px) 100vw, 50vw"
      priority
      placeholder
    />
    @for (thumb of product().gallery; track thumb) {
      <img [ngSrc]="thumb" alt="" width="160" height="160" />
    }
  `,
})
export class ProductHero {
  product = input.required<Product>();
}
```

- Pitfall: `priority` on many images defeats its purpose; reserve it for the one or two above-the-fold images.
- Pitfall: decorative images should have `alt=""` so screen readers skip them.

### Builds, bundles and budgets
<!-- level: intermediate; ref: https://angular.dev/tools/cli/build -->
Since v17, the Angular CLI's default `application` builder uses esbuild for production builds and Vite for the development server. It is much faster than the old webpack builder and handles browser bundles, server bundles (SSR) and prerendering in one step. Projects created before v17 can migrate with `ng update`'s optional migration.

A production build (`ng build`, configuration `production` by default) performs AOT compilation, tree-shaking, minification, dead-code elimination of development checks, and content hashing of file names for long-term caching. Lazy routes and `@defer` blocks become separate chunks.

Budgets in `angular.json` turn bundle size into a CI check: the build warns or fails when the initial bundle or any component style exceeds a threshold. Use `ng build --stats-json` with a bundle analyser to find what is large.

```json
{
  "projects": {
    "shop": {
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "configurations": {
            "production": {
              "budgets": [
                { "type": "initial", "maximumWarning": "500kB", "maximumError": "1MB" },
                { "type": "anyComponentStyle", "maximumWarning": "4kB", "maximumError": "8kB" }
              ],
              "outputHashing": "all"
            }
          }
        }
      }
    }
  }
}
```

- Pitfall: CommonJS dependencies cannot be tree-shaken well and trigger build warnings; prefer ESM packages.
- Pitfall: importing an entire icon set or `lodash` instead of individual functions bloats bundles.
- Interview tip: mention that environment-specific configuration is handled with `fileReplacements` or `define` options, and secrets never belong in frontend bundles.

## 13. Server-side rendering and hydration

### Server-side rendering
<!-- level: intermediate; ref: https://angular.dev/guide/ssr -->
Server-side rendering (SSR) runs your Angular app on a Node.js server (or edge runtime) to produce HTML for each request. Users see content before JavaScript downloads, search engines and social previews receive real markup, and Largest Contentful Paint usually improves. Add it to a project with `ng add @angular/ssr`, or choose SSR when running `ng new`.

The setup includes a server entry (`server.ts`, using the `AngularNodeAppEngine` with Express or another framework), a server application config that merges server-only providers, and server route configuration. Since v19–v20, server routes let you choose a render mode per route: `RenderMode.Server` (render per request), `RenderMode.Prerender` (render at build time to static HTML) and `RenderMode.Client` (ship a client-rendered shell).

Code must be platform-aware. Browser globals (`window`, `localStorage`, `document` APIs beyond what Angular abstracts) do not exist on the server. Run browser-only code in `afterNextRender`, or inject `PLATFORM_ID` and check `isPlatformBrowser`. Use `HttpClient` with `withFetch()`; relative URLs are resolved on the server.

```ts
// app.routes.server.ts
import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'blog/:slug', renderMode: RenderMode.Prerender, getPrerenderParams: async () => (await listSlugs()).map(slug => ({ slug })) },
  { path: 'account/**', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Server },
];

// Browser-only code
export class ThemeToggle {
  constructor() {
    afterNextRender(() => {
      document.documentElement.dataset['theme'] = localStorage.getItem('theme') ?? 'light';
    });
  }
}
```

- Pitfall: per-user data rendered on the server must never be cached by a CDN as shared HTML.

### Hydration and event replay
<!-- level: intermediate; ref: https://angular.dev/guide/hydration -->
Hydration lets Angular reuse the DOM produced by the server instead of destroying it and rendering again on the client. Without hydration, the page flickers as server HTML is thrown away, and LCP and CLS can get worse. Enable it with `provideClientHydration()`; new SSR projects have it by default.

During hydration Angular walks the existing DOM, matches nodes to the component tree, and attaches listeners. For this to work, the DOM must match what the client would render. Direct DOM manipulation (`innerHTML`, `appendChild` outside Angular), invalid HTML that the browser auto-corrects (a `<div>` inside `<p>`, tables without `<tbody>`), or rendering different content on server and client causes hydration mismatch errors (NG0500 family). Components that cannot be hydrated can opt out with `ngSkipHydration`, which re-renders them on the client.

Event replay (`withEventReplay()`, enabled by default for new apps since v19) records user clicks and inputs that happen before hydration finishes, and replays them once the relevant code is ready, so early interactions are not lost. `withHttpTransferCacheOptions` controls the HTTP transfer cache, which serialises server-side HTTP responses into the page so the client does not repeat the same requests during hydration.

```ts
// app.config.ts
import { provideClientHydration, withEventReplay, withHttpTransferCacheOptions, withIncrementalHydration } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(
      withEventReplay(),
      withIncrementalHydration(),
      withHttpTransferCacheOptions({ includePostRequests: false }),
    ),
    provideHttpClient(withFetch()),
  ],
};
```

- Pitfall: using `ngSkipHydration` widely hides problems and brings back the flicker; fix the mismatch instead.

### Incremental hydration
<!-- level: advanced; ref: https://angular.dev/guide/incremental-hydration -->
Full hydration still downloads and executes JavaScript for the whole page on load. Incremental hydration (stable since v20) combines SSR with `@defer`: the server renders the complete content of deferred blocks, but the client leaves them as static, dehydrated HTML and does not download their code until a hydration trigger fires.

You add `hydrate` triggers to `@defer` blocks: `hydrate on viewport`, `hydrate on interaction`, `hydrate on hover`, `hydrate on idle`, `hydrate on timer(...)`, `hydrate when condition`, or `hydrate never` for content that should stay static forever. Event replay ensures that a click on a dehydrated button triggers hydration and then is replayed to the now-active component.

The result: users see the full server-rendered page immediately (good for SEO and LCP), while JavaScript cost is paid only for parts users actually reach (good for INP and Total Blocking Time). Enable it with `withIncrementalHydration()` in `provideClientHydration`.

```html
<app-header />
<app-product-summary [product]="product()" />

@defer (hydrate on viewport) {
  <app-reviews [productId]="product().id" />
} @placeholder {
  <div class="skeleton"></div>
}

@defer (hydrate on interaction) {
  <app-size-selector [sizes]="product().sizes" />
}

@defer (hydrate never) {
  <app-legal-footer />
}
```

The `@placeholder` is used only for client-side rendering (for example after client navigation); on initial SSR load, the real content is shown dehydrated.

- Pitfall: nested defer blocks hydrate parent-first; a parent with `hydrate never` prevents children from ever hydrating.
- Pitfall: dehydrated components cannot react to signal changes until they hydrate.

### Prerendering and static generation
<!-- level: intermediate; ref: https://angular.dev/guide/prerendering -->
Prerendering (static site generation) renders routes to HTML files at build time. Those files can be served from any static host or CDN with no Node.js server, giving the fastest possible time to first byte and resilience under load. It suits pages whose content is the same for every visitor and changes when you deploy or rebuild: marketing pages, documentation, blog posts, product catalogues refreshed nightly.

With the `@angular/ssr` server routes configuration, mark routes with `RenderMode.Prerender`. Parameterised routes provide `getPrerenderParams`, an async function that returns the list of parameter values to generate (it runs in an injection context, so it can inject services). A fallback strategy decides what happens for parameters not generated at build time: render on the server, render on the client, or 404.

Hybrid rendering, mixing prerendered, server-rendered and client-only routes in one app, is the recommended model: choose per route based on freshness and personalisation needs.

```ts
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'about', renderMode: RenderMode.Prerender },
  {
    path: 'products/:slug',
    renderMode: RenderMode.Prerender,
    async getPrerenderParams() {
      const catalog = inject(CatalogService);
      const slugs = await catalog.allSlugs(); // e.g. 2,000 products
      return slugs.map(slug => ({ slug }));
    },
    fallback: PrerenderFallback.Server, // new products render on demand
  },
  { path: 'cart', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Server },
];
```

- Pitfall: prerendering thousands of pages lengthens builds; combine with on-demand server fallback.
- Pitfall: prerendered HTML is stale until the next build; show prices or stock from a client-side request if they change frequently.

## 14. Testing, security and accessibility

### Component testing with TestBed
<!-- level: intermediate; ref: https://angular.dev/guide/testing/components-basics -->
`TestBed` creates a small Angular environment for tests: you configure providers and imports, create a component with `TestBed.createComponent`, and get a `ComponentFixture` exposing the instance, the host element and change detection controls.

For standalone components, import the component itself. Provide test doubles for dependencies with `providers: [{ provide: Api, useValue: fakeApi }]`. Set inputs with `fixture.componentRef.setInput('name', value)`. Trigger rendering with `fixture.detectChanges()` or, for zoneless and asynchronous flows, `await fixture.whenStable()`.

Test behaviour through the DOM, as users experience it: query elements, dispatch events, assert visible text and ARIA state. The Angular CDK's component harnesses provide stable, high-level APIs for interacting with components (including Angular Material) without depending on their internal DOM. Testing Library for Angular is a popular alternative with role-based queries.

Since v21, new projects use Vitest as the default unit test runner (Karma is deprecated); Jasmine-style syntax remains familiar, and existing projects can keep their runner or migrate.

```ts
import { TestBed } from '@angular/core/testing';
import { QtyStepper } from './qty-stepper';

describe('QtyStepper', () => {
  it('emits the increased quantity', async () => {
    const fixture = TestBed.createComponent(QtyStepper);
    fixture.componentRef.setInput('productId', 'p1');
    fixture.componentRef.setInput('qty', 2);
    const emitted: unknown[] = [];
    fixture.componentInstance.qtyChange.subscribe(v => emitted.push(v));
    await fixture.whenStable();

    const plus: HTMLButtonElement = fixture.nativeElement.querySelector('[aria-label="Increase"]');
    plus.click();

    expect(emitted).toEqual([{ productId: 'p1', qty: 3 }]);
  });
});
```

- Pitfall: asserting on private component fields couples tests to implementation.

### Testing services and HTTP
<!-- level: intermediate; ref: https://angular.dev/guide/http/testing -->
Services without Angular dependencies can be tested as plain classes. Services that use DI are obtained with `TestBed.inject(Service)` after configuring providers.

For HTTP, Angular provides a testing backend: add `provideHttpClient()` followed by `provideHttpClientTesting()`. Requests made through `HttpClient` are then captured instead of sent. `HttpTestingController` lets you assert that the expected request was made (`expectOne` by URL or predicate), inspect method, headers and body, and respond with data or errors via `flush`. `verify()` in `afterEach` fails the test if unexpected requests were made.

Because interceptors run in this pipeline too, you can test them by providing them with `withInterceptors` and checking the headers on the captured request.

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

describe('OrderApi', () => {
  let api: OrderApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { accessToken: () => 't0k3n' } },
      ],
    });
    api = TestBed.inject(OrderApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('gets an order with auth header', () => {
    let result: Order | undefined;
    api.get('42').subscribe(o => (result = o));

    const req = http.expectOne('/api/orders/42');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer t0k3n');
    req.flush({ id: '42', number: 'A-42' });

    expect(result?.number).toBe('A-42');
  });
});
```

- Pitfall: `provideHttpClientTesting()` must come after `provideHttpClient()` in the providers array.

### Security: XSS protection and sanitisation
<!-- level: advanced; ref: https://angular.dev/best-practices/security -->
Angular treats all values as untrusted by default. Interpolated text is escaped, and when you bind to security-sensitive contexts — `[innerHTML]`, `[style]`, URL attributes like `[href]` and `[src]`, and resource URLs like `<iframe [src]>` or `<script>` — Angular sanitises the value: it strips dangerous HTML (scripts, event handler attributes), and rewrites unsafe URLs (`javascript:`) to `unsafe:`. Resource URLs cannot be bound from strings at all unless explicitly trusted.

`DomSanitizer.bypassSecurityTrustHtml` (and siblings for style, URL, resource URL) marks a value as trusted. Use it only for values you fully control, and ideally sanitise first. Direct DOM APIs (`ElementRef.nativeElement.innerHTML = ...`) bypass Angular's protections entirely.

Further layers:

1. A strict Content Security Policy; Angular supports nonces through `CSP_NONCE` or the `ngCspNonce` attribute, and autoCsp in the CLI can generate hash-based policies for inline scripts.
2. Trusted Types, which Angular supports to lock down DOM sinks.
3. XSRF protection: `HttpClient` reads an `XSRF-TOKEN` cookie and sends it as `X-XSRF-TOKEN` on mutating same-origin requests; the server must validate it.
4. Never use the JIT compiler with user-supplied templates.

```ts
@Component({
  selector: 'app-article',
  template: `
    <div [innerHTML]="bodyHtml()"></div>          <!-- sanitised automatically -->
    <iframe [src]="videoUrl()" title="Product video"></iframe>
  `,
})
export class Article {
  private sanitizer = inject(DomSanitizer);
  bodyHtml = input.required<string>();
  videoId = input.required<string>();

  protected videoUrl = computed(() => {
    const id = this.videoId();
    if (!/^[\w-]{11}$/.test(id)) throw new Error('Invalid video id');      // validate first
    return this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.youtube-nocookie.com/embed/${id}`);
  });
}
```

- Pitfall: bypassing sanitisation on CMS or user content reintroduces XSS.

### Accessibility in Angular apps
<!-- level: intermediate; ref: https://angular.dev/best-practices/a11y -->
Angular compiles to normal HTML, so accessibility depends on what you render. The essentials: use native elements for interactive controls (a `<button>`, not a clickable `<div>`), label every form control, keep heading levels meaningful, maintain visible focus styles, ensure colour contrast, and support keyboard operation for every interaction.

Angular-specific tools help:

1. Attribute binding for ARIA: `[attr.aria-expanded]="open()"`, `[attr.aria-describedby]`.
2. Host bindings to give custom components roles and keyboard handlers, so they are accessible wherever they are used.
3. The CDK a11y package: `FocusTrap` for dialogs, `LiveAnnouncer` for screen-reader announcements, `FocusMonitor` to distinguish keyboard and mouse focus, and `ListKeyManager` for arrow-key navigation in menus and lists.
4. Angular Aria (developer preview in v21), a set of headless, accessible directives for common patterns such as tabs, listbox, combobox and menus.
5. Router focus management: after navigation, move focus to the main heading and update the title (the route `title` property helps).

```ts
@Component({
  selector: 'app-save-button',
  template: `
    <button type="button" (click)="save()" [attr.aria-busy]="saving()" [disabled]="saving()">
      {{ saving() ? 'Saving…' : 'Save' }}
    </button>
  `,
})
export class SaveButton {
  private announcer = inject(LiveAnnouncer);
  protected saving = signal(false);

  async save() {
    this.saving.set(true);
    await this.api.save();
    this.saving.set(false);
    this.announcer.announce('Changes saved', 'polite');
  }

  private api = inject(DraftApi);
}
```

- Pitfall: `(click)` on a `<div>` is unreachable by keyboard; Angular ESLint's template accessibility rules flag it.
- Interview tip: mention automated checks (axe in tests, Lighthouse) plus manual screen-reader testing.

### Internationalisation
<!-- level: intermediate; ref: https://angular.dev/guide/i18n -->
Angular's built-in internationalisation (`@angular/localize`) marks text for translation directly in templates with the `i18n` attribute and in code with the `$localize` tagged template. The CLI extracts messages into translation files (XLIFF, XMB, JSON), translators fill them in, and the build produces a separate, fully compiled bundle per locale. Because translation happens at build time, there is no runtime lookup cost, but switching language means loading a different build (usually a different URL path like `/fr/`).

ICU expressions handle plurals and selections within messages: `{count, plural, =0 {No items} =1 {One item} other {{{count}} items}}`. Custom ids (`i18n="@@cartTitle"`) keep translations stable when source text changes. Locale-aware pipes (`date`, `currency`, `number`) format according to the active locale's data.

Runtime translation libraries such as Transloco or ngx-translate are common alternatives when you need to switch language without reloading or load translations from a server.

```html
<h1 i18n="Cart page title|Heading shown at the top of the cart@@cartTitle">Your cart</h1>

<p i18n>
  {itemCount(), plural,
    =0 {Your cart is empty}
    =1 {You have one item}
    other {You have {{ itemCount() }} items}}
</p>

<p>{{ total() | currency }} · {{ deliveryDate() | date: 'fullDate' }}</p>
```

```ts
const message = $localize`:@@orderPlaced:Order ${orderNumber}:orderNumber: was placed`;
```

- Pitfall: concatenating translated fragments in code breaks grammar in other languages; translate whole sentences with placeholders.
- Pitfall: layouts must handle text expansion (German) and right-to-left languages (`dir="rtl"`).
