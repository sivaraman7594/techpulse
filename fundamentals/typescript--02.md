## 3. Typing Functions

### Function types and signatures
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/2/functions.html -->
Functions are typed by their parameters and return type. You can annotate a function declaration directly, or describe a function's shape as a type to use for callbacks and variables.

Ways to express function types:

- Function type expression: `(a: number, b: number) => number`.
- Call signature in an object type, useful when the function also has properties: `{ (input: string): Result; version: string }`.
- Construct signature for things called with `new`: `new (config: Config) => Client`.

Optional parameters use `?` and must come after required ones; default values make a parameter optional automatically and infer its type. Rest parameters are typed as arrays or tuples. When a parameter type is a tuple union, TypeScript can type different argument lists precisely.

```ts
type Comparator<T> = (a: T, b: T) => number;

const byPrice: Comparator<{ price: number }> = (a, b) => a.price - b.price;

function paginate<T>(items: T[], page = 1, size?: number): T[] {
  const s = size ?? 20;
  return items.slice((page - 1) * s, page * s);
}

type Logger = {
  (message: string, ...meta: unknown[]): void;
  level: 'debug' | 'info' | 'warn';
};

const log: Logger = Object.assign(
  (message: string, ...meta: unknown[]) => console.log(message, ...meta),
  { level: 'info' as const },
);

type ClientCtor = new (baseUrl: string) => { get(path: string): Promise<unknown> };
```

#### Pitfalls
- `Function` as a type accepts any function and returns `any` when called — use a specific signature instead.
- Optional parameters in callbacks are rarely needed: a callback that accepts fewer parameters is already assignable.

### Function overloads
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/functions.html#function-overloads -->
Overloads let one function expose several call signatures with different parameter and return type combinations. You write the overload signatures (visible to callers) followed by one implementation signature (invisible to callers) that must be compatible with all of them. TypeScript resolves calls against overloads top to bottom and picks the first match, so order specific signatures before general ones.

Overloads are useful when the return type depends on the arguments in a way a union cannot express — for example, a function that returns a single item for a string id and an array for an array of ids.

Often a union parameter or a generic with a conditional type is simpler. The handbook's guidance: prefer union types over overloads when the return type does not change.

```ts
function getUser(id: string): Promise<User>;
function getUser(ids: string[]): Promise<User[]>;
function getUser(idOrIds: string | string[]): Promise<User | User[]> {
  return Array.isArray(idOrIds)
    ? Promise.all(idOrIds.map(fetchUser))
    : fetchUser(idOrIds);
}

const one = await getUser('u1');           // User
const many = await getUser(['u1', 'u2']);  // User[]

// Overloads for DOM-style APIs
function createElement(tag: 'input'): HTMLInputElement;
function createElement(tag: 'canvas'): HTMLCanvasElement;
function createElement(tag: string): HTMLElement;
function createElement(tag: string): HTMLElement {
  return document.createElement(tag);
}
```

#### Pitfalls
- The implementation signature is not callable from outside; callers passing `string | string[]` get an error because no single overload accepts the union.
- The compiler does not verify the implementation returns the right type for each overload — that part is on you.

### Typing this
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/functions.html#declaring-this-in-a-function -->
JavaScript's `this` depends on how a function is called, so TypeScript lets you declare it. A fake first parameter named `this` specifies the expected receiver type. It is erased in the output and does not count as an argument.

With `noImplicitThis` (part of `strict`), using `this` in a standalone function without a declared type is an error, which catches the classic "lost this" bug at compile time.

Class methods automatically get `this` typed as the class instance. You can also return the polymorphic `this` type from methods to support fluent chaining that keeps working in subclasses, and use `this is T` predicates in methods.

```ts
interface Button {
  label: string;
  addEventListener(type: 'click', listener: (this: Button, ev: MouseEvent) => void): void;
}

function onClick(this: HTMLButtonElement, ev: MouseEvent) {
  this.disabled = true;           // typed receiver
}
button.addEventListener('click', onClick);
// onClick(new MouseEvent('click')); // error: 'this' context of type 'void'

class QueryBuilder {
  protected parts: string[] = [];
  where(cond: string): this {
    this.parts.push(`WHERE ${cond}`);
    return this;
  }
}
class PagedQuery extends QueryBuilder {
  limit(n: number): this {
    this.parts.push(`LIMIT ${n}`);
    return this;
  }
}
new PagedQuery().where('active').limit(10); // still PagedQuery after where()
```

#### Interview tip
- Explain that `this: Type` is erased and exists only for checking, and how the polymorphic `this` return type differs from returning the class name.

### void, undefined and callback assignability
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/functions.html#return-type-void -->
`void` as a return type means "the caller will not use the result". It is not the same as `undefined`. When a function type in a contextual position returns `void`, TypeScript allows assigning a function that returns something else; the result is just ignored. This is deliberate so that common code type-checks:

`[1, 2].forEach((n) => arr.push(n))` — `push` returns a number, but `forEach` expects a `void`-returning callback. Without this rule, you would need braces everywhere.

However, when you declare a function with a literal `: void` return annotation, its body may not return a value. And you cannot use the result of a `void` function as if it had a meaningful type.

Since TypeScript 5.1, functions annotated to return `undefined` no longer need an explicit `return` statement.

```ts
type Listener = (event: string) => void;

const results: number[] = [];
const listener: Listener = (e) => results.push(e.length); // ok, returns number

function notify(): void {
  // return 42;                     // error in a declared void function
}

function ensure(): undefined {
  // no return needed (TS 5.1+)
}

declare function onSave(cb: () => void): void;
onSave(async () => { await persist(); });   // allowed — but the promise is ignored!
```

#### Pitfalls
- The last line is a real bug source: passing an async function where `() => void` is expected means rejections are never awaited. The ESLint rule `no-misused-promises` catches it.

## 4. Narrowing

### Narrowing with typeof, truthiness and equality
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/2/narrowing.html -->
Narrowing is how TypeScript refines a broad type to a more specific one inside a branch, based on runtime checks it understands. The compiler performs control flow analysis: it follows `if`, `switch`, `return`, `throw`, `&&`, `||` and assignments, and tracks the possible type of each variable at each point.

Basic narrowing forms:

- `typeof x === 'string'` narrows primitives (`'string'`, `'number'`, `'bigint'`, `'boolean'`, `'symbol'`, `'undefined'`, `'object'`, `'function'`).
- Truthiness `if (x)` removes `null`, `undefined` and other falsy literal types.
- Equality `x === null`, `x !== undefined`, `x == null`, or comparing two variables narrows both to their common types.
- Early returns narrow the rest of the function.

```ts
function format(value: string | number | null | undefined): string {
  if (value == null) return '—';           // removes null and undefined
  if (typeof value === 'number') {
    return value.toLocaleString('en-IN');  // number
  }
  return value.trim();                     // string
}

function len(s: string | string[] | undefined) {
  if (!s) return 0;                        // undefined (and '') handled
  return s.length;
}

function compare(a: string | number, b: string | boolean) {
  if (a === b) {
    a.toUpperCase();                       // both narrowed to string
  }
}
```

#### Pitfalls
- `typeof x === 'object'` includes `null`; pair it with `x !== null`.
- Truthiness narrowing on numbers or strings discards valid values `0` and `''` — use explicit comparisons when those values are legitimate.

### Narrowing with in and instanceof
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#the-in-operator-narrowing -->
For object types, two more operators narrow unions.

The `in` operator checks whether a property exists. If `'swim' in animal` is true, TypeScript narrows to union members that have (or may have) `swim`. Since TypeScript 4.9, `in` on an unlisted property also narrows an unknown object, adding the property as `unknown` — very handy when validating parsed data.

`instanceof` narrows to a class type by checking the prototype chain. It works for classes and built-ins like `Date`, `Error`, `HTMLElement`, but not for interfaces or type aliases, which do not exist at runtime.

```ts
type Fish = { swim(): void };
type Bird = { fly(): void };

function move(pet: Fish | Bird) {
  if ('swim' in pet) pet.swim();
  else pet.fly();
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String(err.message);            // err: object & Record<'message', unknown>
  }
  return String(err);
}

function toDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input);
}
```

#### Pitfalls
- `instanceof` fails across realms (iframes, separate Node VM contexts) and with duplicated package copies — two versions of a library mean two different classes.
- `in` checks the prototype chain too, so `'toString' in obj` is true for almost every object.

### Type predicates
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates -->
When narrowing logic is too complex to inline or should be reused, write a user-defined type guard: a function whose return type is a type predicate `param is Type`. If it returns `true`, the caller's variable is narrowed to `Type`; if `false`, it is narrowed to the remaining union members.

The compiler trusts your predicate — it does not verify the body actually checks what it claims, so a wrong guard is as dangerous as an `as` assertion.

TypeScript 5.5 added inferred type predicates: for simple functions such as `(x) => x !== undefined`, the compiler now infers `x is T` automatically. That makes `array.filter(x => x !== null)` produce a non-nullable array without manual guards.

```ts
interface Admin { role: 'admin'; permissions: string[] }
interface Member { role: 'member' }
type Account = Admin | Member;

function isAdmin(a: Account): a is Admin {
  return a.role === 'admin';
}

function grant(a: Account) {
  if (isAdmin(a)) a.permissions.push('billing');
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

const raw: (string | null)[] = ['a', null, 'b'];
const clean = raw.filter((x) => x !== null);   // string[] in TS 5.5+

// Before 5.5 you needed an explicit predicate:
const clean2 = raw.filter((x): x is string => x !== null);
```

#### Interview tip
- Mention that the predicate is unchecked and show how to keep guards honest: keep them small, test them, or generate them from a runtime schema.

### Assertion functions
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html#assertion-functions -->
An assertion function (TypeScript 3.7) narrows by throwing instead of returning a boolean. Its return type is `asserts condition` or `asserts param is Type`. After a call that returns normally, the compiler assumes the condition holds for the rest of the scope.

They are ideal for invariants and validation where failure should abort: config loading, test helpers, and request handlers that should stop on bad input.

Requirements: the function must be declared with an explicit type annotation (a function declaration, or a `const` with an explicit function type) because the compiler needs the signature during control flow analysis. Arrow functions assigned without a type annotation do not work as assertions.

```ts
function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

function assertIsDefined<T>(value: T, name: string): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(`${name} must be defined`);
  }
}

function loadConfig(env: NodeJS.ProcessEnv) {
  const url = env.DATABASE_URL;
  assertIsDefined(url, 'DATABASE_URL');
  return new URL(url);             // url: string
}

function handle(input: unknown) {
  assert(typeof input === 'object' && input !== null, 'Expected an object');
  input;                            // object
}
```

#### Pitfalls
- Like type predicates, assertion functions are trusted, not verified.
- Defining `const check = (x: unknown): asserts x is string => {...}` then calling through an untyped alias produces error TS2775; ensure every call site sees an explicit type.

### Discriminated unions and exhaustiveness
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions -->
A discriminated (tagged) union is a union of object types that share a property with a distinct literal type in each member — the discriminant, often `kind`, `type` or `status`. Checking that property narrows the whole object to one member, giving access to fields that only exist in that case.

This is the most important modelling pattern in TypeScript. It makes illegal states unrepresentable: instead of one object with many optional fields that may or may not be set together, each state lists exactly the fields it has.

Exhaustiveness checking ensures every case is handled. In the `default` branch, assign the value to `never`; if someone later adds a new member, that assignment fails to compile. Alternatively, enable the `switch-exhaustiveness-check` lint rule or rely on an explicit return type plus `noImplicitReturns`.

```ts
type PaymentState =
  | { status: 'idle' }
  | { status: 'processing'; startedAt: Date }
  | { status: 'succeeded'; receiptId: string }
  | { status: 'failed'; error: string; retryable: boolean };

function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

function message(state: PaymentState): string {
  switch (state.status) {
    case 'idle': return 'Ready to pay';
    case 'processing': return `Processing since ${state.startedAt.toLocaleTimeString()}`;
    case 'succeeded': return `Paid. Receipt ${state.receiptId}`;
    case 'failed': return state.retryable ? `Retry: ${state.error}` : state.error;
    default: return assertNever(state);
  }
}
```

#### Interview tip
- Contrast the union with `{ status: string; receiptId?: string; error?: string }` and explain which bugs the union prevents.

### Limits of control flow analysis
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#control-flow-analysis -->
Narrowing is powerful but conservative; knowing its limits avoids confusing errors.

1. Narrowing does not survive into callbacks for mutable variables. A `let` variable narrowed outside a closure is widened inside it, because the closure might run after the variable changes. `const` variables keep narrowing (and TS 5.4 preserves narrowing in closures created after the last assignment to a `let`).
2. Property narrowing is reset by function calls in some cases, and narrowing `obj.prop` does not narrow `obj` unless `prop` is a discriminant.
3. Destructured discriminants narrow together only when destructured from a `const` parameter or variable (supported since TS 4.6).
4. Aliased conditions work (TS 4.4+): `const isString = typeof x === 'string'; if (isString) ...` narrows `x`, provided both are `const` or readonly.
5. `array.find` or `map.get` results are not linked to earlier `has` checks.

```ts
function process(input: string | null) {
  let value = input;
  if (value !== null) {
    setTimeout(() => {
      // value.length;  // may error pre-5.4 or if value is reassigned later
    });
  }
  const fixed = input;
  if (fixed !== null) {
    setTimeout(() => fixed.length);   // ok: const keeps narrowing
  }
}

const cache = new Map<string, number>();
function read(key: string) {
  if (cache.has(key)) {
    return cache.get(key)!;          // has() does not narrow get()
  }
  return 0;
}
```

#### Pitfalls
- Reaching for `!` whenever narrowing fails; usually copying into a `const` or restructuring the check is cleaner and safer.

## 5. Classes and Object Patterns

### Classes in TypeScript
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/2/classes.html -->
TypeScript adds type annotations and access modifiers to JavaScript classes.

- Fields must be declared with types; under `strictPropertyInitialization`, each must be initialised in its declaration or the constructor (or marked with `!` if set elsewhere).
- `public` (default), `protected` (class and subclasses) and `private` (class only) are compile-time modifiers. JavaScript `#private` fields are enforced at runtime too.
- `readonly` fields can be assigned only in the declaration or constructor.
- Parameter properties (`constructor(private repo: Repo)`) declare and assign a field in one step — convenient, but not erasable syntax, so they are rejected under `erasableSyntaxOnly`.
- `override` marks methods that override a base method; `noImplicitOverride` makes it mandatory, catching renamed base methods.

```ts
class OrderService {
  private readonly cache = new Map<string, Order>();
  #requests = 0;                       // runtime-private

  constructor(
    private readonly repo: OrderRepository,
    protected readonly logger: Logger,
  ) {}

  async get(id: string): Promise<Order> {
    this.#requests++;
    const cached = this.cache.get(id);
    if (cached) return cached;
    const order = await this.repo.findById(id);
    this.cache.set(id, order);
    return order;
  }
}

class AuditedOrderService extends OrderService {
  override async get(id: string) {
    this.logger.info(`read ${id}`);
    return super.get(id);
  }
}
```

#### Pitfalls
- TypeScript `private` is erased; at runtime the field is visible to anyone. Use `#field` when privacy matters.

### Abstract classes and implements
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/classes.html#abstract-classes-and-members -->
An abstract class cannot be instantiated directly. It can contain implemented methods and shared state, plus `abstract` members that subclasses must implement. It is a good fit for the template method pattern: the base class defines an algorithm and delegates specific steps.

`implements Interface` asks the compiler to check that a class satisfies an interface. It does not change the class's type or inherit anything; it is purely a check. A class can implement several interfaces but extend only one class.

Interfaces are erased; abstract classes exist at runtime (as JavaScript classes), so they can be used with `instanceof` and dependency-injection containers that need runtime tokens.

```ts
interface Notifier {
  send(to: string, message: string): Promise<void>;
}

abstract class BaseNotifier implements Notifier {
  async send(to: string, message: string) {
    const formatted = this.format(message);
    await this.deliver(to, formatted);
    console.log(`sent via ${this.channel}`);
  }
  protected format(message: string) { return message.trim(); }
  protected abstract readonly channel: string;
  protected abstract deliver(to: string, body: string): Promise<void>;
}

class SmsNotifier extends BaseNotifier {
  protected readonly channel = 'sms';
  protected async deliver(to: string, body: string) {
    await smsGateway.post({ to, body: body.slice(0, 160) });
  }
}

// new BaseNotifier();   // error: cannot create an instance of an abstract class
const n: Notifier = new SmsNotifier();
```

#### Interview tip
- When asked "interface or abstract class?", answer: interface for contracts (zero runtime cost, multiple allowed), abstract class when you need shared implementation or a runtime type.

### Index signatures and Record
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/objects.html#index-signatures -->
An index signature describes objects used as dictionaries where property names are not known in advance: `{ [key: string]: number }`. Keys may be `string`, `number`, `symbol`, template literal patterns, or unions of these. All declared properties must be compatible with the index signature's value type.

`Record<K, V>` is the utility type equivalent. With a broad key like `string`, it is the same as an index signature; with a union of literal keys, it requires every key to be present — perfect for exhaustive lookup tables.

By default, reading `dict[anyKey]` is typed as `V`, not `V | undefined`, even though the key might not exist. Enable `noUncheckedIndexedAccess` to get the honest type. For dynamic dictionaries with frequent adds and deletes, a `Map<K, V>` is often clearer.

```ts
type Inventory = { [sku: string]: number };
const stock: Inventory = { 'SKU-1': 10 };

type Locale = 'en' | 'hi' | 'ta';
const greetings: Record<Locale, string> = {
  en: 'Hello',
  hi: 'Namaste',
  ta: 'Vanakkam',          // removing a key here is a compile error
};

type DataAttrs = { [K: `data-${string}`]: string };
const attrs: DataAttrs = { 'data-id': '7' };

const qty = stock['SKU-404'];   // number (but actually undefined!)
// With noUncheckedIndexedAccess: number | undefined
```

#### Pitfalls
- `Record<string, T>` combined with `Object.keys` still returns `string[]`; TypeScript intentionally does not type keys as `keyof T` because objects may have extra properties.

### Readonly and immutability
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/utility-types.html#readonlytype -->
TypeScript offers several compile-time immutability tools:

- `readonly` modifier on properties and class fields.
- `Readonly<T>` utility to make all top-level properties readonly.
- `readonly T[]` / `ReadonlyArray<T>`, `ReadonlyMap`, `ReadonlySet` to hide mutating methods.
- `as const` to make a literal deeply readonly and literal-typed.

These are shallow (except `as const`) and erased at runtime. For real runtime immutability, combine them with `Object.freeze` (whose return type is `Readonly<T>`).

Readonly types are mainly about API intent: a function taking `readonly Item[]` promises not to mutate the caller's array, and callers can pass both mutable and readonly arrays to it. The reverse is not allowed — you cannot pass a readonly array where a mutable one is expected.

```ts
type DeepReadonly<T> = T extends (...args: any[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

interface State {
  user: { name: string; roles: string[] };
  items: { id: string; qty: number }[];
}

function total(items: readonly { qty: number }[]): number {
  // items.push(...);        // error
  return items.reduce((s, i) => s + i.qty, 0);
}

const frozen = Object.freeze({ retries: 3 }); // Readonly<{ retries: number }>
// frozen.retries = 4;        // compile error and runtime TypeError (strict mode)

function reducer(state: DeepReadonly<State>): DeepReadonly<State> {
  return { ...state, items: state.items.filter((i) => i.qty > 0) };
}
```

#### Pitfalls
- Readonly is not enforced through aliasing: a mutable reference to the same object can still change it.
