## 1. Getting Started with TypeScript

### What TypeScript is
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/typescript-from-scratch.html -->
TypeScript is a superset of JavaScript that adds a static type system. You write `.ts` files with type annotations; the compiler checks them and emits plain JavaScript with the types removed. At runtime there is no TypeScript — the browser or Node.js only ever runs JavaScript.

This "type erasure" is the most important mental model. Types cannot affect runtime behaviour, cannot be inspected at runtime, and do not validate data coming from the network. They exist to catch mistakes before the code runs and to power editor features: autocompletion, go-to-definition, safe renames, and inline documentation.

TypeScript's checker is deliberately not perfectly sound. It trades some theoretical correctness for practicality, for example in array indexing, method parameter variance, and type assertions. Knowing where the holes are is part of using it well.

```ts
// greet.ts
function greet(user: { name: string; age?: number }): string {
  return `Hello ${user.name}`;
}
greet({ name: 'Asha' });
// greet({ nme: 'Asha' }); // compile error: did you mean 'name'?

// Emitted JavaScript (types erased):
// function greet(user) { return `Hello ${user.name}`; }
```

#### Interview tip
- When asked "does TypeScript check API responses?", the answer is no: `const user: User = await res.json()` is an unchecked claim. Runtime validation (for example with Zod or Valibot) is needed at boundaries.

### Compiling and running TypeScript
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/compiler-options.html -->
TypeScript code reaches a runtime in one of two ways, and real projects often use both.

1. Type-check and emit with `tsc`. It reads `tsconfig.json`, reports errors, and writes `.js` (plus optional `.d.ts` declarations and source maps). `tsc --noEmit` checks without writing output.
2. Strip types with a fast transpiler: esbuild, SWC, Babel, Vite, tsx, Bun, Deno — and Node.js itself, which strips erasable TypeScript syntax natively (unflagged since Node 23.6 and 22.18). These tools process one file at a time and do not type-check, so you still run `tsc --noEmit` in CI and your editor.

Because per-file transpilers cannot see other files, some features need care: `isolatedModules` makes `tsc` flag code they cannot handle (such as re-exporting a type without `export type`). TypeScript 5.8 added `erasableSyntaxOnly`, which rejects constructs that need code generation — `enum`, `namespace` with values, and constructor parameter properties — so the code is compatible with pure type stripping.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "strict": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "outDir": "dist"
  }
}
```

```bash
npx tsc --noEmit          # type-check only (CI)
node src/server.ts        # Node 23.6+: run directly by stripping types
```

#### Pitfalls
- A green build from esbuild or Vite does not mean the types are correct — add a separate type-check step.

### Type annotations and inference
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/type-inference.html -->
You can annotate variables, parameters, return types and properties with `: Type`, but most of the time you do not need to: TypeScript infers types from initialisers, return statements, and context.

Inference rules worth knowing:

- `let x = 'a'` infers `string` (widened, since it may change); `const x = 'a'` infers the literal type `'a'`.
- Function return types are inferred from all `return` statements.
- Contextual typing: a callback's parameters are inferred from where it is passed, e.g. in `arr.map((item) => ...)`.
- An empty array `[]` or an uninitialised `let` evolves its type based on later assignments in some cases, but explicit annotation is clearer.

Good practice: always annotate function parameters (they cannot be inferred from the inside), annotate exported functions' return types for stable public APIs and faster checking, and let inference handle local variables.

```ts
const port = 3000;               // type: 3000
let host = 'localhost';          // type: string

const users = [{ id: 1, name: 'Asha' }];   // { id: number; name: string }[]
const names = users.map((u) => u.name);     // u inferred, names: string[]

export function total(prices: number[]): number {
  return prices.reduce((sum, p) => sum + p, 0);
}

let result;                      // implicitly any (error under noImplicitAny in some forms)
const ids: string[] = [];        // annotate empty collections
```

#### Pitfalls
- Over-annotating everything adds noise and can widen types you wanted narrow (`const mode: string = 'dark'` loses the literal).

### Basic and special types
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html -->
TypeScript's primitive types mirror JavaScript: `string`, `number`, `bigint`, `boolean`, `symbol`, `null` and `undefined`. Note the lowercase names — `String` and `Number` refer to wrapper objects and should not be used as types.

Special types cover the edges of the type system:

- `any` disables checking for a value and everything derived from it. It spreads silently and should be a last resort.
- `unknown` is the safe top type: anything can be assigned to it, but you must narrow it before using it.
- `never` is the empty type with no values: the return of functions that always throw, impossible branches, and the result of filtering everything out of a union.
- `void` means a function's return value should be ignored.
- `object` means any non-primitive; `{}` means any value except `null` and `undefined` (surprisingly broad).

```ts
function parse(json: string): unknown {
  return JSON.parse(json);
}
const data = parse('{"n":1}');
// data.n;                         // error: 'data' is of type 'unknown'
if (typeof data === 'object' && data !== null && 'n' in data) {
  console.log(data.n);             // narrowed
}

function fail(message: string): never {
  throw new Error(message);
}

function log(msg: string): void {
  console.log(msg);
}

let loose: any = 'x';
loose.foo.bar();                   // compiles, crashes at runtime
```

#### Interview tip
- Explain why `unknown` is preferred over `any` for `catch` clauses and parsed JSON: it forces a check at the point of use.

### Arrays and tuples
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/2/objects.html#tuple-types -->
Array types are written `T[]` or `Array<T>`; read-only arrays as `readonly T[]` or `ReadonlyArray<T>`, which remove mutating methods like `push` and `sort` from the type.

A tuple is a fixed-length array where each position has its own type: `[string, number]`. Tuples can have optional elements (`[string, number?]`), rest elements (`[string, ...number[]]`), and labels for readability (`[name: string, age: number]`). They are perfect for functions returning multiple values, like React's `useState`.

By default an array literal is inferred as an array, not a tuple: `[1, 'a']` becomes `(string | number)[]`. Use an annotation or `as const` to get a tuple.

```ts
const scores: number[] = [90, 85];
const names: ReadonlyArray<string> = ['a', 'b'];
// names.push('c');              // error: push does not exist on readonly array

type Entry = [key: string, value: number];
const entry: Entry = ['visits', 42];
const [key, value] = entry;

function useToggle(initial = false): [boolean, () => void] {
  let state = initial;
  return [state, () => { state = !state; }];
}
const [isOpen, toggle] = useToggle();

type Csv = [header: string[], ...rows: string[][]];

const point = [10, 20] as const;  // readonly [10, 20]
```

#### Pitfalls
- Indexing an array (`scores[5]`) is typed as `number`, not `number | undefined`, unless `noUncheckedIndexedAccess` is enabled.
- Tuples are still JavaScript arrays at runtime; `push` on a mutable tuple compiles but breaks the declared length.

### Object types, optional and readonly properties
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/2/objects.html -->
Object types describe property names and their types, either inline, with an `interface`, or with a `type` alias. Properties can be marked optional with `?` and immutable with `readonly`.

An optional property `email?: string` may be missing, so reading it gives `string | undefined`. That is not quite the same as `email: string | undefined`, which requires the key to be present (the flags differ more under `exactOptionalPropertyTypes`).

`readonly` prevents reassignment through that type at compile time. It is shallow and has no runtime effect — the object can still be mutated through another reference typed without `readonly`.

Methods can be written as method signatures `save(): void` or as function-typed properties `save: () => void`; the property form is checked more strictly under `strictFunctionTypes`.

```ts
interface Product {
  readonly id: string;
  name: string;
  price: number;
  description?: string;
  tags: readonly string[];
  discount(percent: number): number;
}

function label(p: Product): string {
  // p.id = 'x';                         // error: read-only
  const desc = p.description ?? 'No description';
  return `${p.name} – ${desc}`;
}

type Point = { x: number; y: number };
const origin: Readonly<Point> = { x: 0, y: 0 };
```

#### Pitfalls
- `readonly` on a property does not freeze nested objects; `p.tags` above is readonly only because its type is `readonly string[]`.
- Optional properties are easily misused to model state machines — a discriminated union is usually better.

## 2. The Structural Type System

### Structural typing
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/type-compatibility.html -->
TypeScript is structurally typed: compatibility is decided by shape, not by declared names. A value is assignable to a type if it has at least the required properties with compatible types. Two interfaces with the same members are interchangeable, and a class instance can satisfy an interface it never mentions with `implements`.

This matches how JavaScript is actually written (duck typing) and makes mocks and plain objects easy to use. The flip side is that types with identical shapes cannot be told apart — a `UserId` and an `OrderId` that are both `string` are fully interchangeable, which is why "branded types" exist.

For functions, parameters are compared contravariantly under `strictFunctionTypes` (except for method-style declarations, which stay bivariant), and a function with fewer parameters is assignable where more are expected, because JavaScript ignores extra arguments.

```ts
interface Point { x: number; y: number }

class Pixel {
  constructor(public x: number, public y: number, public color: string) {}
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

distance(new Pixel(0, 0, 'red'), { x: 3, y: 4 }); // ok: Pixel has x and y

const handlers: Array<(event: string, time: number) => void> = [];
handlers.push((event) => console.log(event)); // fewer params: fine

type Celsius = number;
type Fahrenheit = number;
const temp: Celsius = 30;
const f: Fahrenheit = temp;      // no error — aliases are just names
```

#### Interview tip
- Contrast with nominal languages (Java, C#). Mention that private and protected class members make classes behave nominally: two classes with a same-named private field are not compatible.

### Excess property checks
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/objects.html#excess-property-checks -->
Structural typing allows extra properties — except in one case. When you assign a fresh object literal directly to a typed target, TypeScript performs an excess property check and reports properties the target type does not declare. Fresh literals with extra keys are almost always typos (`colour` instead of `color`) or misunderstandings of an API.

The check applies only to "fresh" literals. Once the object is stored in a variable first, it is no longer fresh and only the normal structural check applies. That is why the same object can be rejected inline but accepted via a variable.

For a union target, the check considers properties from any member, so typos may slip through unions. Index signatures `[key: string]: unknown` disable the check entirely.

```ts
interface Options {
  color?: string;
  width?: number;
}

function draw(opts: Options) {}

// draw({ colour: 'red' });   // error: 'colour' does not exist; did you mean 'color'?

const o = { colour: 'red', width: 2 };
draw(o);                      // ok: not fresh, and has 'width' in common

const p = { colour: 'red' };
// draw(p);                   // error: weak type detection — no properties in common
```

Note the last case: when every property of the target is optional (a "weak type"), TypeScript also errors if the source shares no properties with it.

#### Pitfalls
- Silencing the error with `as Options` hides genuine typos; fix the property name instead or extend the type.

### Union and intersection types
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types -->
A union `A | B` describes a value that is one of several types. You can only use members common to all constituents until you narrow it. Unions model optional values (`string | undefined`), alternative inputs (`string | URL`), and states (`'idle' | 'loading' | 'error'`).

An intersection `A & B` describes a value that is all of the types at once — it must have every property from both. It is used to combine object types, add fields to an existing type, and in mixin patterns.

Set intuition helps: a type is a set of values. A union is the set union (more values, fewer guaranteed properties). An intersection is the set intersection (fewer values, more guaranteed properties). Intersecting incompatible primitives produces `never`, e.g. `string & number`.

```ts
type Id = string | number;

function formatId(id: Id): string {
  // id.toUpperCase();            // error: not on number
  return typeof id === 'string' ? id.toUpperCase() : id.toFixed(0);
}

type Timestamps = { createdAt: Date; updatedAt: Date };
type User = { id: string; name: string };
type StoredUser = User & Timestamps;

const u: StoredUser = {
  id: '1', name: 'Asha', createdAt: new Date(), updatedAt: new Date(),
};

type Impossible = string & number;   // never
type Conflict = { a: string } & { a: number }; // property a: never
```

#### Pitfalls
- Intersections with conflicting properties do not error at declaration; they silently produce `never` properties that only fail later. `interface extends` reports such conflicts immediately.

### Literal types and as const
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types -->
Literal types are types with exactly one value: `'GET'`, `42`, `true`. Combined into unions, they give precise, autocompleted sets of allowed values without enums.

Widening controls when literals stay literal: `const` declarations keep them, while `let`, mutable object properties and array elements widen to the general type because they could change later. This causes the classic error of passing `{ method: 'GET' }` stored in a variable to a function expecting `'GET' | 'POST'` — the property was widened to `string`.

A `const` assertion (`as const`) prevents widening for an entire expression: object properties become `readonly` literals and arrays become `readonly` tuples. It is the idiomatic way to derive union types from runtime data, keeping one source of truth.

```ts
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
function request(url: string, method: Method) {}

const req = { url: '/api', method: 'GET' };
// request(req.url, req.method);  // error: string is not assignable to Method

const req2 = { url: '/api', method: 'GET' } as const;
request(req2.url, req2.method);    // ok

export const ROLES = ['admin', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number]; // 'admin' | 'editor' | 'viewer'

function isRole(x: string): x is Role {
  return (ROLES as readonly string[]).includes(x);
}
```

#### Interview tip
- Deriving a type from an `as const` array (`typeof ROLES[number]`) is a frequent interview pattern — it keeps runtime validation and types in sync.

### Type aliases vs interfaces
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#differences-between-type-aliases-and-interfaces -->
Both name a type, and for object shapes they are largely interchangeable. The practical differences:

- `type` can name anything: unions, tuples, primitives, function types, mapped and conditional types. `interface` describes only object shapes (including callable and constructable ones).
- Interfaces support declaration merging: two `interface Window` declarations combine. This is how libraries let you augment global or module types. Type aliases cannot be reopened.
- `interface B extends A` checks that B is compatible with A and reports conflicts; `type B = A & {...}` silently creates `never` properties on conflict.
- Interfaces are cached by name in the checker, which can make large hierarchies faster to check than deeply nested intersections.
- Error messages show interface names, while some aliases get expanded.

A common convention: use `interface` for public object contracts and extension, `type` for unions, utility compositions and everything else. Consistency within a codebase matters more than the choice.

```ts
interface Animal { name: string }
interface Dog extends Animal { breed: string }

type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'square'; size: number };

type Handler = (event: CustomEvent) => void;

// Declaration merging — augmenting a library type
declare global {
  interface Window {
    analytics?: { track(event: string): void };
  }
}
```

#### Pitfalls
- Accidental declaration merging: two unrelated interfaces with the same name in the same scope combine instead of erroring.

### Enums and their alternatives
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/enums.html -->
An `enum` defines named constants. Unlike most TypeScript features, it emits runtime code: a JavaScript object. Numeric enums also generate a reverse mapping (value to name), and any number is assignable to a numeric enum type, which weakens safety. String enums have no reverse mapping and are nominal: you must use `Status.Active`, not `'active'`.

`const enum` inlines values at use sites and emits nothing, but it does not work with isolated per-file transpilers and is problematic in published libraries.

Because of these quirks — and because enums are not erasable syntax (rejected under `erasableSyntaxOnly` and by Node's type stripping) — many teams prefer union literal types or an `as const` object, which give the same autocompletion with plain JavaScript semantics.

```ts
enum Status {
  Active = 'active',
  Suspended = 'suspended',
}
function setStatus(s: Status) {}
setStatus(Status.Active);
// setStatus('active');        // error: string enums are nominal

enum Direction { Up, Down }    // Up = 0, Down = 1
Direction[0];                  // 'Up' (reverse mapping)

// Alternative: as const object + derived union
export const OrderStatus = {
  Pending: 'pending',
  Shipped: 'shipped',
  Delivered: 'delivered',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

function track(status: OrderStatus) {}
track(OrderStatus.Shipped);
track('shipped');              // also allowed
```

#### Interview tip
- Be ready to list enum downsides: runtime emission, numeric enum unsoundness, `const enum` and isolatedModules issues, and incompatibility with type stripping.

### Type assertions and the non-null operator
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions -->
A type assertion `value as T` tells the compiler to treat a value as a different type. It performs no runtime conversion or check — it is purely a claim you make. TypeScript allows assertions only between types that sufficiently overlap; to force anything else you need a double assertion through `unknown`, which is a strong code smell.

The non-null assertion `value!` removes `null` and `undefined` from a type. Like `as`, it is unchecked: if you are wrong, you get a runtime `TypeError` later.

Legitimate uses exist: DOM queries where you know the element type, test fixtures, and narrowing the compiler cannot follow. But each assertion is a hole in type safety, so prefer narrowing, type guards, or validation.

```ts
const input = document.querySelector('#email') as HTMLInputElement;
input.value = 'a@b.com';

// Safer: check and narrow
const el = document.querySelector('#email');
if (el instanceof HTMLInputElement) el.value = 'a@b.com';

const map = new Map<string, number>();
map.set('a', 1);
const a = map.get('a')!;           // ok if you are sure

// Dangerous: compiles, but lies
const user = JSON.parse(body) as { id: string; email: string };
const n = 'hello' as unknown as number;  // double assertion: almost always wrong
```

#### Pitfalls
- `as` on API responses gives a false sense of safety; one renamed field and the bug surfaces far from its cause.
- Prefer `satisfies` when you want the compiler to check a value against a type without changing its inferred type.

### The satisfies operator
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html -->
`satisfies` (TypeScript 4.9) checks that an expression conforms to a type without changing the expression's inferred type. It solves a long-standing dilemma:

- With an annotation `const x: T = ...`, you get checking, but the variable's type becomes `T`, losing specific information (literal values, which keys exist).
- With no annotation, you keep precise inference, but nothing checks the value against `T`.
- With `as T`, you get neither real checking nor precise types.

`satisfies T` gives checking against `T` (including excess property checks and typo detection) while the variable keeps its narrower inferred type. It pairs well with `as const`.

```ts
type Route = { path: string; auth: boolean };

const routes = {
  home: { path: '/', auth: false },
  dashboard: { path: '/dashboard', auth: true },
  // settings: { path: '/settings', auht: true }, // error: typo caught
} satisfies Record<string, Route>;

routes.dashboard.path;           // ok: key known
// routes.unknown;               // error: key does not exist

const annotated: Record<string, Route> = routes;
annotated.anything;              // allowed: keys widened to string

type Color = 'red' | 'green' | 'blue';
const palette = {
  primary: [255, 0, 0],
  accent: 'green',
} satisfies Record<string, Color | [number, number, number]>;

palette.accent.toUpperCase();    // knows it is a string
palette.primary.map((c) => c / 255); // knows it is a tuple
```

#### Interview tip
- Summarise as: annotation = "this is a T", `as` = "trust me, this is a T", `satisfies` = "check this is a T, but remember what it really is".
