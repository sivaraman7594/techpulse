## 1. Angular foundations

### What Angular is
<!-- level: basic; ref: https://angular.dev/overview -->
Angular is a complete, opinionated web framework from Google, written in TypeScript. Where React is a rendering library you assemble with other tools, Angular ships the whole platform: components and templates, a template compiler, dependency injection, a router, forms, an HTTP client, testing utilities, server-side rendering, internationalisation, and the Angular CLI that builds and scaffolds everything consistently.

Angular compiles templates ahead of time (AOT) into efficient JavaScript instructions, so there is no template parsing in the browser and many template errors are caught at build time with full type checking.

Modern Angular (v17 onwards) looks quite different from the "AngularJS" (1.x) and early-2.x era: components are standalone by default, templates use built-in control flow (`@if`, `@for`), state is increasingly driven by signals, and new apps run without zone.js (zoneless is the default for new projects from v21). Angular releases a major version roughly every six months, each supported for 18 months, and provides automated migrations through `ng update`.

```bash
npm install -g @angular/cli
ng new shop --style=scss --ssr=false
cd shop
ng serve                    # dev server with hot module replacement
ng generate component product-card
ng build                    # production build (esbuild-based application builder)
```

- Interview tip: say why teams choose Angular: consistency across large teams, batteries included, strong typing, long-term support and an upgrade path driven by schematics.
- Pitfall: mixing tutorials from different eras. Prefer angular.dev material and current syntax over old NgModule-heavy examples.

### Project structure and bootstrapping
<!-- level: basic; ref: https://angular.dev/tools/cli -->
A new CLI project has a predictable layout: `src/main.ts` boots the app, `src/app/app.ts` is the root component, `src/app/app.config.ts` holds application-wide providers, `src/app/app.routes.ts` defines routes, and `angular.json` configures builds, budgets and test runners. Since the v20 style guide, generated files drop type suffixes: `user-profile.ts` exporting `UserProfile`, instead of `user-profile.component.ts` exporting `UserProfileComponent` (both styles work).

Standalone applications start with `bootstrapApplication`, passing the root component and an `ApplicationConfig` with providers. Features are added with functional `provide*` helpers rather than importing NgModules: `provideRouter`, `provideHttpClient`, `provideZonelessChangeDetection`, `provideClientHydration`, and so on.

```ts
// main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch(err => console.error(err));

// app.config.ts
import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
  ],
};
```

- Pitfall: providers added to a lazily loaded route's `providers` array create a separate environment injector for that route, not app-wide singletons.
- Interview tip: `ng update @angular/core @angular/cli` runs version migrations automatically; mention it when asked about upgrades.

### Components
<!-- level: basic; ref: https://angular.dev/guide/components -->
A component is a TypeScript class decorated with `@Component` that controls a piece of the screen. The decorator provides metadata: a `selector` (the custom element name used in other templates), a `template` or `templateUrl`, optional `styles`/`styleUrl`, the `imports` the template needs, and options such as `changeDetection`.

At compile time Angular turns the template into a function that creates DOM nodes and updates bindings. At runtime each component instance has a view: its DOM, its bindings and its child components. The class holds state and behaviour; the template reads class members directly (public or protected members are accessible; private ones are not).

Selectors are usually element selectors with a prefix (`app-`, `shop-`) to avoid clashing with native or third-party elements.

```ts
import { Component, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { CurrencyPipe } from '@angular/common';

@Component({
  selector: 'shop-product-card',
  imports: [CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3>{{ name() }}</h3>
    <p>{{ total() | currency: 'INR' }}</p>
    <button (click)="add()">Add one ({{ qty() }})</button>
  `,
  styles: `h3 { margin: 0 0 .25rem; }`,
})
export class ProductCard {
  protected readonly name = signal('Thermos 500 ml');
  protected readonly price = signal(899);
  protected readonly qty = signal(1);
  protected readonly total = computed(() => this.price() * this.qty());

  add() {
    this.qty.update(q => q + 1);
  }
}
```

- Pitfall: putting heavy logic in the constructor. Use it only for dependency injection and simple field setup; inputs are not available yet.
- Interview tip: mark template-only members `protected` so they are usable in the template but not part of the public class API.

### Standalone components and imports
<!-- level: basic; ref: https://angular.dev/guide/components/importing -->
A standalone component lists everything its template uses — other components, directives and pipes — in its own `imports` array. Since v19, `standalone: true` is the default, so you no longer write it. The compiler uses `imports` to know what each tag or attribute in the template means; using `<app-avatar>` without importing `Avatar` is a compile error.

Before standalone, every component had to be declared in exactly one NgModule, and templates could use whatever that module imported. That indirection made dependencies hard to see and complicated lazy loading. Standalone components make dependencies local and explicit, enable fine-grained lazy loading with `loadComponent`, and reduce boilerplate.

NgModules still exist for backward compatibility, and standalone components can import NgModules (for example, libraries that still ship modules). The CLI provides a migration: `ng generate @angular/core:standalone`.

```ts
import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Avatar } from '../avatar/avatar';

@Component({
  selector: 'app-comment',
  imports: [Avatar, DatePipe, RouterLink],
  template: `
    <app-avatar [src]="comment().author.photo" />
    <a [routerLink]="['/users', comment().author.id]">{{ comment().author.name }}</a>
    <time>{{ comment().createdAt | date: 'short' }}</time>
    <p>{{ comment().text }}</p>
  `,
})
export class Comment {
  comment = input.required<CommentModel>();
}
```

- Pitfall: importing a whole library module (for example a big Material module from older code) when you only need one component inflates bundles.
- Interview tip: `@if`, `@for` and `@switch` are built into the template syntax and need no import, unlike the old `NgIf`/`NgFor` directives.

### Component styles and view encapsulation
<!-- level: intermediate; ref: https://angular.dev/guide/components/styling -->
Styles declared in a component apply only to that component's template by default. Angular achieves this with emulated view encapsulation: at compile time it adds unique attributes (such as `_ngcontent-abc-c12`) to the component's elements and rewrites its CSS selectors to include them. So `.title` in one component cannot leak into another.

Three encapsulation modes exist:

1. `ViewEncapsulation.Emulated` (default): scoped by attribute rewriting.
2. `ViewEncapsulation.ShadowDom`: uses the browser's real Shadow DOM, with full isolation (global styles do not get in either).
3. `ViewEncapsulation.None`: styles become global. Use sparingly, for example in a design system's root.

Useful selectors: `:host` targets the component's own host element, `:host(.active)` styles it conditionally, and `:host-context(.dark)` reacts to an ancestor class. The `::ng-deep` combinator pierces encapsulation but is deprecated and should be avoided; prefer CSS custom properties for theming children.

```ts
@Component({
  selector: 'app-badge',
  template: `<span class="label"><ng-content /></span>`,
  styles: `
    :host { display: inline-flex; }
    :host(.danger) .label { background: var(--badge-danger, #c62828); }
    .label {
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--badge-bg, #e0e0e0);
      color: var(--badge-fg, #222);
    }
  `,
})
export class Badge {}

// Usage: <app-badge class="danger">3 failed</app-badge>
```

- Pitfall: component elements are display inline by default; set `:host { display: block; }` (or flex) for layout components.
- Interview tip: CSS custom properties pass through encapsulation boundaries, which makes them the cleanest theming mechanism.

## 2. Templates

### Interpolation and property binding
<!-- level: basic; ref: https://angular.dev/guide/templates/binding -->
Templates connect the class to the DOM with bindings. Interpolation, `{{ expression }}`, renders the expression's value as text (automatically escaped). Property binding, `[property]="expression"`, sets a DOM property, a component input or a directive input to the expression's value. Attribute binding, `[attr.aria-label]="..."`, sets an HTML attribute when no DOM property exists (ARIA, `colspan` on some elements, SVG attributes).

Template expressions are a restricted JavaScript-like language: no assignments (except in event handlers), no `new`, no globals like `window`. Recent versions added more operators: template literals (v19.2), exponentiation `**`, `in`, `void` and `typeof` (v20). Expressions are type-checked against the component class in strict template mode.

Angular re-evaluates bindings during change detection and only touches the DOM when a value changes. Because expressions may run often, they should be cheap and side-effect free.

```ts
@Component({
  selector: 'app-user-row',
  template: `
    <img [src]="user().avatarUrl" [alt]="user().name + ' avatar'" width="40" height="40" />
    <span>{{ user().name }} ({{ user().email }})</span>
    <td [attr.colspan]="wide() ? 2 : 1">{{ \`Joined \${user().joinedYear}\` }}</td>
    <progress [value]="user().profileCompletion" max="100"></progress>
    <button [disabled]="!canEdit()">Edit</button>
  `,
})
export class UserRow {
  user = input.required<User>();
  wide = input(false);
  canEdit = input(false);
}
```

- Pitfall: `[src]="..."` binds a property; `src="{{ ... }}"` interpolates into it too, but `[attr.x]` is needed for attributes without a matching property, otherwise you get "Can't bind to 'x' since it isn't a known property".
- Pitfall: calling expensive methods in bindings (`{{ computeTotal() }}`) runs them on every change detection pass; use `computed` signals.

### Event binding
<!-- level: basic; ref: https://angular.dev/guide/templates/event-listeners -->
Event binding, `(eventName)="statement"`, listens for DOM events or component outputs and runs a template statement when they fire. The special variable `$event` holds the DOM event object or the value emitted by an output.

Angular supports key event filtering in the event name: `(keydown.enter)`, `(keyup.escape)`, `(keydown.shift.tab)` and `(keydown.control.s)`, so you do not need manual `if (e.key === 'Enter')` checks. Listening on global targets is done with `window:`, `document:` or `body:` prefixes in `host` listeners.

Handlers run inside Angular's change detection scheduling: after a bound event fires, Angular marks the component (and its ancestors) for check, so the view updates even in OnPush or zoneless apps.

```ts
@Component({
  selector: 'app-todo-input',
  template: `
    <input
      #box
      [value]="draft()"
      (input)="draft.set(box.value)"
      (keydown.enter)="submit()"
      (keydown.escape)="draft.set('')"
      aria-label="New todo"
    />
    <button type="button" (click)="submit()" [disabled]="!draft().trim()">Add</button>
  `,
})
export class TodoInput {
  added = output<string>();
  protected draft = signal('');

  submit() {
    const text = this.draft().trim();
    if (!text) return;
    this.added.emit(text);
    this.draft.set('');
  }
}

// Parent: <app-todo-input (added)="todos.add($event)" />
```

- Pitfall: `(click)="save"` does nothing; you must call the method: `(click)="save()"`.
- Pitfall: very high-frequency events (`mousemove`, `scroll`) in templates trigger change detection each time; throttle them or listen outside the Angular-triggered path when they do not affect the view.

### Two-way binding and model inputs
<!-- level: intermediate; ref: https://angular.dev/guide/templates/two-way-binding -->
Two-way binding, written with the "banana in a box" syntax `[(value)]`, combines a property binding and an event binding: the parent passes a value down and receives updates back. It is sugar: `[(size)]="fontSize"` expands to `[size]="fontSize" (sizeChange)="fontSize = $event"`.

For your own components, the modern way to support two-way binding is a model input, `model()` (stable since v19). A model is a writable signal that is also an input: the child can call `.set()` or `.update()`, which updates its own value and emits a `<name>Change` event to the parent. If the parent binds a signal with `[(checked)]="isOn"`, Angular writes back into that signal directly.

`[(ngModel)]` is the forms-specific version of the same idea, used with template-driven forms.

```ts
import { Component, model } from '@angular/core';

@Component({
  selector: 'app-rating',
  template: `
    @for (star of stars; track star) {
      <button
        type="button"
        [attr.aria-pressed]="star <= value()"
        (click)="value.set(star)"
      >{{ star <= value() ? '★' : '☆' }}</button>
    }
  `,
})
export class Rating {
  value = model(0);
  protected readonly stars = [1, 2, 3, 4, 5];
}

@Component({
  selector: 'app-review',
  imports: [Rating],
  template: `
    <app-rating [(value)]="score" />
    <p>You chose {{ score() }} stars</p>
  `,
})
export class Review {
  protected score = signal(3);
}
```

- Pitfall: binding `[(value)]="score()"` (calling the signal) is an error; bind the signal itself.
- Interview tip: use `input()` for one-way data and `model()` only when the child legitimately owns edits to the value.

### Built-in control flow
<!-- level: basic; ref: https://angular.dev/guide/templates/control-flow -->
Since v17 (stable in v18), templates have built-in control flow blocks that replace the `*ngIf`, `*ngFor` and `ngSwitch` directives. They need no imports, read like JavaScript, are type-checked with narrowing, and are faster because the compiler generates the logic directly.

- `@if (cond) { } @else if (other) { } @else { }`, with `as` aliasing: `@if (user(); as u)`.
- `@for (item of items; track item.id) { } @empty { }`. The `track` expression is mandatory; it tells Angular how to identify items so DOM nodes are reused on reordering. Implicit variables: `$index`, `$first`, `$last`, `$even`, `$odd`, `$count`.
- `@switch (value) { @case ('a') { } @default { } }`.

```html
@if (orders.isLoading()) {
  <app-spinner />
} @else if (orders.error()) {
  <p role="alert">Could not load orders.</p>
} @else {
  <ul>
    @for (order of orders.value(); track order.id; let i = $index, last = $last) {
      <li [class.last]="last">
        {{ i + 1 }}. #{{ order.number }}
        @switch (order.status) {
          @case ('shipped') { <span class="ok">Shipped</span> }
          @case ('cancelled') { <span class="err">Cancelled</span> }
          @default { <span>Processing</span> }
        }
      </li>
    } @empty {
      <li>No orders yet.</li>
    }
  </ul>
}
```

Migrate existing templates automatically with `ng generate @angular/core:control-flow`.

- Pitfall: `track $index` on lists that are reordered or filtered defeats DOM reuse and can attach state to the wrong row; track a stable id.
- Pitfall: `@switch` does not fall through, and cases compare with `===`.

### Template variables and @let
<!-- level: intermediate; ref: https://angular.dev/guide/templates/variables -->
Templates have two kinds of local variables.

Template reference variables, declared with `#name`, give you a reference to a DOM element, a component instance, or a directive (with `#form="ngForm"`, the `exportAs` name). They are handy for reading an input's value or calling a child component's method directly in the template.

`@let` declarations (stable since v19) store the result of an expression in a read-only local variable: `@let total = price() * qty();`. They are re-evaluated on every change detection pass, are scoped to the current view and its children, and are especially useful for avoiding repeated expressions and for unwrapping async values once with the `async` pipe.

```html
<!-- Reference variable to a DOM element -->
<input #search type="search" placeholder="Filter" (input)="filter.set(search.value)" />
<button (click)="search.focus()">Focus search</button>

<!-- @let to avoid repeating an expression and to unwrap an observable once -->
@let user = user$ | async;
@let fullName = user?.firstName + ' ' + user?.lastName;

@if (user) {
  <h2>Welcome back, {{ fullName }}</h2>
  <p>{{ user.email }}</p>
}

<!-- Reference to a child component instance -->
<app-video-player #player [src]="videoUrl()" />
<button (click)="player.togglePlay()">Play / pause</button>
```

- Pitfall: `@let` variables cannot be reassigned from the template and are not available before their declaration.
- Pitfall: reaching into child component instances via template references couples components tightly; prefer inputs and outputs for regular communication.

### Class and style bindings
<!-- level: basic; ref: https://angular.dev/guide/templates/binding -->
Angular has dedicated bindings for CSS classes and inline styles, which are cleaner and safer than string concatenation.

- `[class.active]="isActive()"` toggles a single class.
- `[class]="expr"` accepts a string, an array or an object map (`{ selected: isSelected(), disabled: !enabled() }`).
- `[style.width.px]="width()"` sets one style property with a unit suffix.
- `[style]="expr"` accepts a string or an object map.

Angular merges static `class`/`style` attributes with bound ones, and when several sources (template, host bindings, directives) set the same class or style, it resolves them with a defined precedence: template bindings win over host bindings, and specific bindings win over map bindings. The `NgClass` and `NgStyle` directives still work, but native bindings are now recommended because they are lighter and need no import.

```ts
@Component({
  selector: 'app-progress',
  template: `
    <div
      class="bar"
      [class.complete]="value() >= 100"
      [class]="{ warning: value() < 30, striped: animated() }"
      [style.width.%]="value()"
      [style.--bar-color]="color()"
      role="progressbar"
      [attr.aria-valuenow]="value()"
      aria-valuemin="0"
      aria-valuemax="100"
    ></div>
  `,
  styles: `.bar { height: 8px; background: var(--bar-color, steelblue); transition: width .3s; }`,
})
export class Progress {
  value = input(0);
  animated = input(false);
  color = input('steelblue');
}
```

- Pitfall: binding untrusted strings to `[style]` is sanitised, but URL values inside styles (`background-image`) from users should still be avoided.

## 3. Component communication

### Signal inputs
<!-- level: basic; ref: https://angular.dev/guide/components/inputs -->
Inputs let a parent pass data to a child. The modern API is the `input()` function (stable since v19), which creates a read-only signal on the child: `name = input<string>()`, `name = input('default')` or `name = input.required<string>()`. In the template and class you read it like any signal, `name()`, and you can derive values from it with `computed`.

Because inputs are signals, Angular knows exactly which views depend on them, they work naturally with OnPush and zoneless change detection, and you no longer need `ngOnChanges` to react to changes: use `computed` for derived values and `effect` for side effects.

Options include `alias` (public name differs from the property) and `transform` (convert the incoming value, for example the built-in `booleanAttribute` and `numberAttribute`).

```ts
import { Component, computed, input, booleanAttribute, numberAttribute } from '@angular/core';

@Component({
  selector: 'app-price',
  template: `
    <span [class.strike]="onSale()">{{ amount() }}</span>
    @if (onSale()) { <strong>{{ salePrice() }}</strong> }
  `,
})
export class Price {
  amount = input.required({ transform: numberAttribute });
  discountPercent = input(0);
  onSale = input(false, { transform: booleanAttribute });   // <app-price onSale />
  salePrice = computed(() => Math.round(this.amount() * (1 - this.discountPercent() / 100)));
}

// Parent: <app-price amount="1999" [discountPercent]="20" onSale />
```

The older `@Input()` decorator still works, and the CLI offers a migration (`ng generate @angular/core:signal-input-migration`).

- Pitfall: signal inputs are read-only inside the child; you cannot `set` them. If the child needs a local editable copy, use `linkedSignal` or `model`.
- Pitfall: reading a required input in the constructor throws because it has no value yet.

### Outputs
<!-- level: basic; ref: https://angular.dev/guide/components/outputs -->
Outputs let a child notify its parent that something happened. The modern `output()` function (stable since v19) returns an `OutputEmitterRef`; the child calls `.emit(value)` and the parent listens with event binding: `(saved)="onSaved($event)"`.

Outputs are not signals and do not hold state. They are a lightweight event channel, simpler than the older `@Output() x = new EventEmitter()`, and not tied to RxJS. If you already have an observable you want to expose as an output, `outputFromObservable(obs$)` from `@angular/core/rxjs-interop` converts it; `outputToObservable` goes the other way for programmatic subscriptions.

Name outputs after what happened (`saved`, `selectionChange`), not after DOM events like `click`, which would collide with native events on the host element.

```ts
import { Component, input, output } from '@angular/core';

export interface CartLine { productId: string; qty: number; }

@Component({
  selector: 'app-qty-stepper',
  template: `
    <button type="button" (click)="change(-1)" [disabled]="qty() <= 1" aria-label="Decrease">−</button>
    <span aria-live="polite">{{ qty() }}</span>
    <button type="button" (click)="change(1)" aria-label="Increase">+</button>
    <button type="button" (click)="removed.emit(productId())">Remove</button>
  `,
})
export class QtyStepper {
  productId = input.required<string>();
  qty = input.required<number>();
  qtyChange = output<CartLine>();
  removed = output<string>();

  change(delta: number) {
    this.qtyChange.emit({ productId: this.productId(), qty: this.qty() + delta });
  }
}

// <app-qty-stepper [productId]="line.id" [qty]="line.qty" (qtyChange)="cart.update($event)" (removed)="cart.remove($event)" />
```

- Pitfall: outputs only reach the direct parent; they do not bubble. For distant components, use a shared service.

### Content projection
<!-- level: intermediate; ref: https://angular.dev/guide/components/content-projection -->
Content projection lets a component accept markup from its parent and render it in a chosen place, much like `children` in React or slots in web components. You mark the spot with `<ng-content />`. Multiple slots are created with the `select` attribute, which takes a CSS selector (element, attribute or class), and an unselected `<ng-content />` catches everything else.

Projected content is created and owned by the parent: it is compiled in the parent's template, its bindings use the parent's context, and its lifecycle is tied to the parent even if the child does not display it. That means `<ng-content>` inside an `@if` does not prevent the content from being instantiated. For truly conditional or repeated content, the child should accept an `ng-template` (a `TemplateRef`) and render it with `ngTemplateOutlet`.

Since v18, `<ng-content>` can contain fallback content shown when nothing is projected.

```ts
@Component({
  selector: 'app-card',
  template: `
    <header>
      <ng-content select="[card-title]">Untitled</ng-content>
    </header>
    <section class="body">
      <ng-content />
    </section>
    <footer>
      <ng-content select="app-card-actions" />
    </footer>
  `,
})
export class Card {}

// Usage
// <app-card>
//   <h2 card-title>Monthly report</h2>
//   <p>Revenue grew 12%.</p>
//   <app-card-actions><button>Open</button></app-card-actions>
// </app-card>
```

- Pitfall: projecting the same content twice is impossible; content goes to the first matching slot only.
- Interview tip: query projected children with `contentChild`/`contentChildren`, not `viewChild`.

### View and content queries
<!-- level: intermediate; ref: https://angular.dev/guide/components/queries -->
Queries give a component references to elements, directives or child components. View queries look inside the component's own template; content queries look at projected content.

The signal-based functions (stable since v19) are `viewChild`, `viewChildren`, `contentChild` and `contentChildren`. Each returns a signal that Angular updates as the view changes, so you can use the result in `computed` or `effect` and never need `ngAfterViewInit` bookkeeping. Locators can be a component or directive class, or a template reference name as a string. The `read` option returns a different token for the matched node, for example `ElementRef` or `ViewContainerRef`.

`viewChild.required` asserts that the element always exists; reading it before the view is created throws.

```ts
import { Component, ElementRef, afterNextRender, viewChild, contentChildren } from '@angular/core';

@Component({
  selector: 'app-tab-group',
  template: `
    <div role="tablist">
      @for (tab of tabs(); track tab; let i = $index) {
        <button role="tab" [attr.aria-selected]="i === active()" (click)="active.set(i)">{{ tab.label() }}</button>
      }
    </div>
    <ng-content />
  `,
})
export class TabGroup {
  readonly tabs = contentChildren(Tab);
  readonly active = signal(0);
}

@Component({
  selector: 'app-search-box',
  template: `<input #field type="search" />`,
})
export class SearchBox {
  private field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  constructor() {
    afterNextRender(() => this.field().nativeElement.focus());
  }
}
```

- Pitfall: queries do not see inside child components' templates; each component queries only its own view.
- Pitfall: using `nativeElement` directly bypasses SSR safety; guard DOM work with `afterNextRender`.

### Host element bindings
<!-- level: intermediate; ref: https://angular.dev/guide/components/host-elements -->
Every component renders into a host element: the element matching its selector (`<app-chip>`). You can bind properties, attributes, classes, styles and event listeners on that host element from inside the component using the `host` property of the decorator. This keeps the component self-contained: callers do not need to remember to add roles or classes.

The `host` property is now preferred over the older `@HostBinding` and `@HostListener` decorators (which still work). Host listeners can target global objects with `window:` or `document:` prefixes, and Angular removes them automatically on destroy.

```ts
import { Component, input, model } from '@angular/core';

@Component({
  selector: 'app-toggle-chip',
  template: `<ng-content />`,
  host: {
    role: 'switch',
    tabindex: '0',
    '[attr.aria-checked]': 'checked()',
    '[class.chip--on]': 'checked()',
    '[class.chip--disabled]': 'disabled()',
    '(click)': 'toggle()',
    '(keydown.space)': 'toggle(); $event.preventDefault()',
    '(document:keydown.escape)': 'checked.set(false)',
  },
  styles: `
    :host { display: inline-flex; padding: 4px 12px; border-radius: 16px; cursor: pointer; }
    :host(.chip--on) { background: #1565c0; color: white; }
  `,
})
export class ToggleChip {
  checked = model(false);
  disabled = input(false);

  toggle() {
    if (!this.disabled()) this.checked.update(v => !v);
  }
}
```

- Pitfall: global host listeners (`window:scroll`) on many component instances add many listeners; for list items, prefer a single listener on the parent.
- Interview tip: host bindings are how you make custom components keyboard- and screen-reader-friendly without wrapper markup.
