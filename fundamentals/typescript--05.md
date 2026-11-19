## 11. Advanced Language Features

### Decorators
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#decorators -->
Decorators are functions applied with `@expression` to classes and class members to observe, replace or augment them. TypeScript has two incompatible implementations:

1. Legacy "experimental" decorators, enabled with `experimentalDecorators`. Used by Angular, NestJS, TypeORM and older MobX. Supports parameter decorators and, with `emitDecoratorMetadata`, emits runtime type metadata for dependency injection.
2. Standard ECMAScript decorators (TC39 stage 3), supported by default since TypeScript 5.0. A decorator receives the decorated value and a `context` object (`kind`, `name`, `addInitializer`, `metadata`). It can return a replacement method or field initialiser. There are no parameter decorators, and no `emitDecoratorMetadata`; TS 5.2 added `Symbol.metadata` support.

Decorators emit runtime code, so they are not erasable syntax and do not work with Node's type stripping. Native browser support is still pending, so they are compiled down.

```ts
function logged<This, Args extends unknown[], R>(
  target: (this: This, ...args: Args) => R,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => R>,
) {
  const name = String(context.name);
  return function (this: This, ...args: Args): R {
    console.time(name);
    try {
      return target.call(this, ...args);
    } finally {
      console.timeEnd(name);
    }
  };
}

function bound<This, F extends (this: This, ...a: any[]) => any>(
  method: F, context: ClassMethodDecoratorContext<This, F>,
) {
  context.addInitializer(function () {
    (this as any)[context.name] = method.bind(this);
  });
}

class ReportService {
  @logged
  generate(month: string) { return `report-${month}`; }

  @bound
  onClick() { return this; }
}
```

#### Pitfalls
- Mixing frameworks that require legacy decorators with code written for standard decorators fails: the signatures differ completely. Check which mode your framework expects.

### using and explicit resource management
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html#using-declarations-and-explicit-resource-management -->
TypeScript 5.2 implemented the ECMAScript explicit resource management proposal. A `using` declaration binds a resource whose `[Symbol.dispose]()` method is called automatically when the enclosing block exits — normally, by `return`, or by an exception. `await using` does the same with `[Symbol.asyncDispose]()` and awaits it.

This is deterministic cleanup, like C#'s `using` or Python's `with`, replacing error-prone `try/finally` blocks for file handles, database connections, locks, temporary directories and spans. Multiple resources are disposed in reverse order. `DisposableStack` and `AsyncDisposableStack` manage groups of resources.

Runtime support: Chrome 134+, Firefox 141+ and Node.js 24+ ship it natively; elsewhere, TypeScript downlevels the syntax and you may need polyfills for `Symbol.dispose` and the stack classes. Include `esnext.disposable` (or a newer `lib`) to get the types.

```ts
class DbConnection implements AsyncDisposable {
  static async open(url: string) { /* connect */ return new DbConnection(); }
  async query(sql: string) { return []; }
  async [Symbol.asyncDispose]() {
    console.log('closing connection');
    /* close socket */
  }
}

async function monthlyReport() {
  await using db = await DbConnection.open(process.env.DATABASE_URL!);
  using timer = startSpan('report');        // sync disposable
  const rows = await db.query('SELECT ...');
  if (rows.length === 0) return null;       // both disposed here
  return summarise(rows);                   // and here, even on throw
}

function startSpan(name: string): Disposable {
  const start = performance.now();
  return { [Symbol.dispose]: () => console.log(name, performance.now() - start) };
}
```

#### Interview tip
- Explain why this beats `finally`: cleanup is attached to the resource at the point of acquisition, so it cannot be forgotten or ordered incorrectly.

### Branded (nominal) types
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/type-compatibility.html -->
Structural typing treats all `string`s alike, so an `OrderId` can be passed where a `UserId` is expected. Branded types simulate nominal typing by intersecting a base type with a unique phantom property that never exists at runtime: `type UserId = string & { readonly __brand: 'UserId' }`.

A plain string is not assignable to `UserId` because it lacks the brand. You create branded values only through a constructor or validation function — which becomes the single place where the invariant is checked. After that, the type carries proof that validation happened: an `Email` is known to be validated, a `PositiveInt` known to be positive, a `Paise` known to be minor units of currency.

Using a `unique symbol` for the brand key prevents collisions and hides it from autocompletion.

```ts
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

type UserId = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;
type Email = Brand<string, 'Email'>;

function toEmail(input: string): Email {
  const v = input.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new Error('Invalid email');
  return v as Email;                    // the only assertion, in one place
}

declare function getOrders(user: UserId): Promise<unknown[]>;

const userId = 'u_123' as UserId;
const orderId = 'o_456' as OrderId;
getOrders(userId);
// getOrders(orderId);                  // error: OrderId is not UserId
// getOrders('u_123');                  // error: plain string

function sendWelcome(to: Email) {}
sendWelcome(toEmail('Asha@Example.com'));
```

#### Pitfalls
- Branded values still behave as their base type, so `userId + orderId` compiles; brands protect function boundaries, not arithmetic.

### Recursive types
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/2/objects.html -->
Types can refer to themselves to describe recursive data: trees, linked lists, nested menus, comment threads and JSON. Interfaces and object type aliases can reference themselves in properties directly. Since TypeScript 3.7, type aliases can also be recursive in many positions, and since 4.1, conditional types can recurse, enabling type-level algorithms.

The compiler limits recursion depth (around 50 levels for non-tail-recursive conditional types, about 1,000 with tail recursion since TS 4.5) and reports "Type instantiation is excessively deep and possibly infinite" when exceeded.

A precise `Json` type is a common and useful example: it rejects functions, dates, `undefined` and class instances that would not survive serialisation.

```ts
type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

function save(key: string, value: Json) {
  localStorage.setItem(key, JSON.stringify(value));
}
save('prefs', { theme: 'dark', recent: [1, 2] });
// save('bad', { when: new Date() });      // error: Date is not Json

interface MenuItem {
  label: string;
  href?: string;
  children?: MenuItem[];
}

function flatten(items: MenuItem[]): string[] {
  return items.flatMap((i) => [i.label, ...flatten(i.children ?? [])]);
}

// Type-level recursion: join a tuple of strings
type Join<T extends string[], Sep extends string> =
  T extends [infer F extends string, ...infer R extends string[]]
    ? R extends [] ? F : `${F}${Sep}${Join<R, Sep>}`
    : '';
type Path = Join<['api', 'v1', 'users'], '/'>;   // 'api/v1/users'
```

#### Pitfalls
- Recursive types over large objects (deep `Paths<T>` on a huge generated type) can make the editor sluggish; cap the depth with a counter tuple.

## 12. Patterns and Practice

### Validating data at runtime boundaries
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/narrowing.html -->
Types are erased, so every place where data enters your program — HTTP responses and requests, `JSON.parse`, `localStorage`, environment variables, message queues, file contents — is a boundary where static types cannot help. Annotating `const body: Order = await res.json()` merely asserts.

The robust pattern is "parse, don't validate": treat external data as `unknown`, run it through a validator that checks the shape at runtime, and get back a typed value (or an error). Schema libraries such as Zod, Valibot, ArkType or TypeBox let you declare the schema once and infer the TypeScript type from it, so the runtime check and the static type can never disagree. Many of them implement the shared Standard Schema interface, so frameworks accept any of them.

Validate once at the edge; inside the core of your application you can then trust the types.

```ts
import { z } from 'zod';

const OrderSchema = z.object({
  id: z.string().uuid(),
  total: z.number().int().nonnegative(),
  status: z.enum(['pending', 'paid', 'shipped']),
  items: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })),
});
type Order = z.infer<typeof OrderSchema>;

async function getOrder(id: string): Promise<Order> {
  const res = await fetch(`/api/orders/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const result = OrderSchema.safeParse(await res.json());
  if (!result.success) {
    throw new Error(`Bad order payload: ${result.error.message}`);
  }
  return result.data;                 // typed and verified
}

const Env = z.object({ PORT: z.coerce.number().default(3000), DATABASE_URL: z.string().url() });
export const env = Env.parse(process.env);   // fail fast at startup
```

#### Interview tip
- When asked how to keep front-end and back-end types in sync, mention shared schema packages, OpenAPI/GraphQL code generation, or end-to-end typed RPC (tRPC) — plus runtime validation on the server regardless.

### Typing errors and async code
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-4.html#defaulting-to-the-unknown-type-in-catch-variables---useunknownincatchvariables -->
TypeScript cannot declare which errors a function throws — there is no `throws` clause — and in JavaScript anything can be thrown. Therefore caught errors are typed `unknown` (with `useUnknownInCatchVariables`, part of `strict`), and promise rejection reasons are effectively `any`.

Practical patterns:

- Narrow caught errors with `instanceof` checks against your own error classes.
- Write a small `toError(e: unknown): Error` helper for logging.
- For expected, recoverable failures (validation, not found, payment declined), consider returning a result type instead of throwing, so the compiler forces callers to handle both cases.
- Always type async functions' return as `Promise<T>`, and enable lint rules `no-floating-promises` and `no-misused-promises` (typescript-eslint) to catch un-awaited promises.

```ts
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

type PaymentError =
  | { code: 'CARD_DECLINED'; reason: string }
  | { code: 'INSUFFICIENT_FUNDS' }
  | { code: 'GATEWAY_TIMEOUT'; retryAfterMs: number };

async function charge(amount: number): Promise<Result<{ receiptId: string }, PaymentError>> {
  const res = await gateway.charge(amount);
  if (res.declined) return { ok: false, error: { code: 'CARD_DECLINED', reason: res.reason } };
  return { ok: true, value: { receiptId: res.id } };
}

const r = await charge(500);
if (!r.ok) {
  switch (r.error.code) {
    case 'GATEWAY_TIMEOUT': scheduleRetry(r.error.retryAfterMs); break;
    default: showMessage(r.error.code);
  }
} else {
  console.log(r.value.receiptId);
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
}
```

#### Pitfalls
- Result types for every function lead to verbose code; reserve them for domain failures callers must handle, and keep exceptions for bugs and infrastructure failures.

### Typing the DOM
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/dom-manipulation.html -->
With `lib: ["DOM"]`, TypeScript knows every browser API. Most DOM typing questions come down to narrowing:

- `document.querySelector('input')` with a tag name returns `HTMLInputElement | null` thanks to overloads mapping tag names to element types. With a CSS selector string, it returns `Element | null`, and you pass a type argument or narrow with `instanceof`.
- `event.target` is `EventTarget | null`, because the event may originate from any descendant. Use `event.currentTarget` (typed from the element you attached to in many cases) or narrow `target` with `instanceof`.
- `addEventListener('keydown', e => ...)` infers `KeyboardEvent` from the event name through the `HTMLElementEventMap`.
- Custom events can be typed by augmenting `HTMLElementEventMap` or `WindowEventMap`.

```ts
const form = document.querySelector<HTMLFormElement>('#checkout');
if (!form) throw new Error('Checkout form missing');

form.addEventListener('submit', (e) => {      // e: SubmitEvent
  e.preventDefault();
  const data = new FormData(form);
  const qty = Number(data.get('qty'));
});

document.addEventListener('click', (e) => {
  if (!(e.target instanceof HTMLElement)) return;
  const button = e.target.closest<HTMLButtonElement>('button[data-id]');
  if (button) remove(button.dataset.id!);
});

declare global {
  interface WindowEventMap {
    'cart:updated': CustomEvent<{ count: number }>;
  }
}
window.addEventListener('cart:updated', (e) => console.log(e.detail.count));
```

#### Pitfalls
- `querySelector<HTMLInputElement>('.email')` is an unchecked claim; if the selector matches a `div`, you find out at runtime.

### Migrating JavaScript to TypeScript
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html -->
Migrating a large JavaScript codebase works best incrementally, keeping the app shippable throughout.

1. Add a `tsconfig.json` with `allowJs: true` so TypeScript compiles JS and TS side by side, and `checkJs: false` initially.
2. Add type checking to CI (`tsc --noEmit`) even before converting files.
3. Install `@types/*` for dependencies.
4. Convert leaf modules first (utilities, models) — files with few dependencies. Rename `.js` to `.ts` and fix errors.
5. Start with `strict: false` if needed, then enable `noImplicitAny` and `strictNullChecks` once most files are converted. Some teams instead start strict and use `// @ts-expect-error` comments with a tracked count.
6. Type the boundaries early: API clients, shared models, and configuration give the most value.
7. Avoid sprinkling `any`; use `unknown` and narrow, or a temporary named alias like `type TODO = any` you can search for.

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "strict": false,
    "noImplicitAny": true,
    "target": "es2022",
    "module": "preserve",
    "moduleResolution": "bundler"
  },
  "include": ["src"]
}
```

```js
// Enable checking for one JS file before converting it
// @ts-check
/** @param {number[]} values */
export function average(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
```

#### Interview tip
- Interviewers look for risk management: incremental conversion, CI checks from day one, measurable progress, and no big-bang rewrite.

### JSDoc types and checkJs
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html -->
TypeScript can type-check plain JavaScript using JSDoc comments. With `checkJs: true` (or a `// @ts-check` comment per file), the compiler reads annotations like `@param`, `@returns`, `@type`, `@typedef`, `@template` and `@satisfies`, and checks the code just like a `.ts` file.

This gives most of TypeScript's safety with no build step: the code runs unchanged in browsers and Node. Some well-known projects use this approach for libraries. You can still import types from `.ts` or `.d.ts` files with `@import` (TS 5.5) or `import('...')` type expressions, and generate `.d.ts` files for consumers with `declaration: true` and `allowJs`.

Trade-offs: annotations are more verbose, some advanced constructs are awkward to express, and the syntax is less familiar to teammates.

```js
// @ts-check

/** @import { Order } from './types.ts' */

/**
 * @typedef {object} Money
 * @property {number} amount  minor units
 * @property {'INR' | 'USD'} currency
 */

/**
 * @param {Order[]} orders
 * @param {'INR' | 'USD'} currency
 * @returns {Money}
 */
export function revenue(orders, currency) {
  const amount = orders.reduce((sum, o) => sum + o.total, 0);
  return { amount, currency };
}

/**
 * @template T
 * @param {T[]} items
 * @returns {T | undefined}
 */
export const last = (items) => items.at(-1);

/** @type {import('./config.js').Config} */
const config = { port: 3000 };
```

#### Pitfalls
- JSDoc types are not checked at all unless `checkJs` or `// @ts-check` is on — they silently rot otherwise.

### Testing types
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html#-ts-expect-error-comments -->
When your code exports complex types — generic helpers, library APIs, inferred schemas — the types themselves need tests: that valid usage compiles, invalid usage fails, and inference produces the expected type.

Tools:

- `// @ts-expect-error` (TS 3.9) on a line that must not compile. If the line unexpectedly compiles, the directive itself becomes an error, so negative tests cannot silently pass. Prefer it to `@ts-ignore`, which never complains.
- Type-level equality assertions such as `Expect<Equal<A, B>>`, a common hand-written helper.
- Vitest's `expectTypeOf` and `assertType`, run with `vitest typecheck`, or the `tsd` and `expect-type` libraries.
- Running `tsc --noEmit` over a `*.test-d.ts` file in CI.

```ts
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type cases = [
  Expect<Equal<Paths<{ a: { b: string } }>, 'a' | 'a.b'>>,
  Expect<Equal<Awaited<Promise<Promise<number>>>, number>>,
];

// @ts-expect-error — unknown key must be rejected
t('cart.missing');

import { expectTypeOf, test } from 'vitest';
test('pluck infers element type', () => {
  expectTypeOf(pluck([{ id: 1 }], 'id')).toEqualTypeOf<number[]>();
});
```

#### Interview tip
- Explain why naive equality `A extends B ? B extends A ? true : false : false` is wrong (it treats `any` as equal to everything and distributes over unions) and why the generic-function trick is stricter.

### Choosing types for API design
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/types-from-types.html -->
Good TypeScript APIs are easy to call correctly and hard to call incorrectly. Guidelines used by experienced teams:

1. Be liberal in what you accept, precise in what you return: accept `readonly T[]` and `Iterable<T>`, return concrete types.
2. Model states as discriminated unions rather than optional field soups.
3. Prefer options objects over long parameter lists or boolean flags (`render(true, false)` is unreadable).
4. Derive types from a single source of truth (schemas, `as const` objects, generated code) instead of duplicating.
5. Keep generics purposeful: each type parameter should relate inputs to outputs.
6. Use `unknown` rather than `any` for things you do not know.
7. Annotate exported function return types to stabilise the public API and catch accidental changes.
8. Avoid exporting deeply computed types to users when a named interface would read better in errors.

```ts
// Hard to use correctly
function fetchData(url: string, json?: boolean, retry?: boolean, cache?: number): any;

// Clear, precise and extensible
interface FetchOptions {
  retries?: number;
  cacheTtlMs?: number;
  signal?: AbortSignal;
}
type FetchResult<T> =
  | { kind: 'ok'; data: T; fromCache: boolean }
  | { kind: 'not-found' }
  | { kind: 'error'; error: Error };

export async function fetchJson<T>(
  url: string,
  parse: (raw: unknown) => T,
  options: FetchOptions = {},
): Promise<FetchResult<T>> {
  /* ... */
  return { kind: 'not-found' };
}
```

#### Interview tip
- Point out that `fetchJson` takes a `parse` function instead of a bare `<T>`: the type parameter is now inferred from real validation instead of being an unchecked cast.
