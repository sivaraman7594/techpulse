## 6. Generics

### Generic functions
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/2/generics.html -->
Generics let you write code that works over many types while preserving the relationship between inputs and outputs. A type parameter like `<T>` is a placeholder filled in at each call site, usually by inference from the arguments.

Without generics you would choose between a specific type (not reusable) and `any` or `unknown` (reusable, but callers lose type information). With generics, `first(['a'])` returns `string` and `first([1])` returns `number` from the same function.

Good generics connect at least two positions — parameter to return type, or one parameter to another. A type parameter used only once usually adds nothing and can be replaced by its constraint ("the rule of two").

You can pass type arguments explicitly (`parse<User>(text)`), but if inference can work it out, let it.

```ts
function first<T>(items: readonly T[]): T | undefined {
  return items[0];
}
first(['a', 'b']);        // string | undefined
first([{ id: 1 }]);       // { id: number } | undefined

function groupBy<T, K extends PropertyKey>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    (out[key(item)] ??= []).push(item);
  }
  return out;
}
const byRole = groupBy(users, (u) => u.role);   // Record<'admin' | 'member', User[]>

// Pointless generic: T used once — just use the constraint
function logLength<T extends { length: number }>(x: T) { console.log(x.length); }
function logLength2(x: { length: number }) { console.log(x.length); }
```

#### Pitfalls
- A generic return type that is not tied to any argument (`function get<T>(key: string): T`) is just an unchecked cast in disguise.

### Generic constraints and keyof
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-constraints -->
A constraint `T extends Shape` limits which types can be substituted and, in exchange, lets the function body use members of `Shape`. Without a constraint, `T` could be anything (including `null`), so you can do almost nothing with it.

Constraints can reference other type parameters. The classic case is `K extends keyof T`: `K` must be one of `T`'s keys, and `T[K]` is the type of that property. This expresses relationships such as "the value passed must match the type of the key passed".

Since `keyof T` may include `number` and `symbol` keys, use `Extract<keyof T, string>` or `K extends string` when you need strings (for example, in template literals).

```ts
function pluck<T, K extends keyof T>(items: T[], key: K): T[K][] {
  return items.map((item) => item[key]);
}
const emails = pluck(users, 'email');     // string[]
// pluck(users, 'emial');                 // error

function setField<T, K extends keyof T>(obj: T, key: K, value: T[K]): T {
  return { ...obj, [key]: value };
}
setField(user, 'age', 30);
// setField(user, 'age', '30');           // error: string not assignable to number

function longest<T extends { length: number }>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}
longest('abc', 'de');       // string
longest([1, 2], [3]);       // number[]
```

#### Interview tip
- Be ready to write `getProperty<T, K extends keyof T>(obj: T, key: K): T[K]` from memory and explain why returning `T[keyof T]` instead would lose precision.

### Generic types, classes and defaults
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-classes -->
Type aliases, interfaces and classes can all be generic. This is how you model containers (`Box<T>`), API envelopes (`ApiResponse<T>`), repositories (`Repository<T extends { id: string }>`) and event maps.

Type parameters can have defaults, `<T = unknown>`, used when the type argument is neither provided nor inferable. Parameters with defaults must come after required ones.

For classes, the type parameter applies to the instance side only; static members cannot reference it, because statics are shared across all instantiations.

```ts
interface ApiResponse<T, E = { message: string }> {
  data?: T;
  error?: E;
  meta: { requestId: string };
}

type Page<T> = { items: T[]; nextCursor: string | null };

class Repository<T extends { id: string }> {
  private store = new Map<string, T>();
  save(entity: T): T {
    this.store.set(entity.id, entity);
    return entity;
  }
  find(id: string): T | undefined {
    return this.store.get(id);
  }
  findWhere(pred: (e: T) => boolean): T[] {
    return [...this.store.values()].filter(pred);
  }
}

const products = new Repository<Product>();

type EventMap = { login: { userId: string }; logout: undefined };
class Emitter<Events extends Record<string, unknown>> {
  on<E extends keyof Events>(event: E, fn: (payload: Events[E]) => void) { /* ... */ }
}
new Emitter<EventMap>().on('login', (p) => p.userId);
```

#### Pitfalls
- Defaulting a type parameter to `any` silently disables checking for consumers who forget to pass it; prefer `unknown`.

### const type parameters
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#const-type-parameters -->
By default, when TypeScript infers a type parameter from an object or array literal, it widens it: `['a', 'b']` becomes `string[]`, `{ method: 'GET' }` becomes `{ method: string }`. Callers had to write `as const` to keep literal types.

TypeScript 5.0 added `const` modifiers on type parameters. Writing `<const T>` asks the compiler to infer as if the argument had `as const` applied, preserving literal and tuple types — without burdening callers.

It only affects inference from literals written directly at the call site; passing a variable that was already widened does not bring the literals back. Pairing it with a `readonly` constraint (`const T extends readonly string[]`) avoids surprising inference failures, because `as const`-style inference produces readonly arrays.

```ts
function defineRoutes<const T extends readonly { path: string; name: string }[]>(routes: T) {
  return routes;
}

const routes = defineRoutes([
  { path: '/', name: 'home' },
  { path: '/cart', name: 'cart' },
]);

type RouteName = (typeof routes)[number]['name'];   // 'home' | 'cart'

function enumOf<const T extends readonly string[]>(...values: T) {
  return values;
}
const sizes = enumOf('S', 'M', 'L');                // readonly ['S', 'M', 'L']

// Without const: string[], and RouteName would be just string
```

#### Interview tip
- Libraries such as routers, schema builders and state machines use this to give users precise types from plain configuration objects.

### NoInfer and inference control
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/utility-types.html#noinfertype -->
TypeScript infers a type parameter from every position where it appears. Sometimes a parameter should only be checked against `T`, not contribute to inferring it. The classic example: `createFSM(states, initial)` should infer `T` from `states` and then verify `initial` is one of them — but by default an invalid `initial` simply gets added to the inferred union.

`NoInfer<T>` (TypeScript 5.4) blocks inference through the marked position. The type is still `T` for checking purposes.

Other inference controls: explicit type arguments, splitting into curried functions (infer from the first call, check in the second), and ordering — TypeScript infers from context-insensitive arguments first, then from callbacks.

```ts
function createMachine<S extends string>(states: S[], initial: NoInfer<S>) {
  return { states, current: initial };
}

createMachine(['idle', 'loading', 'done'], 'idle');     // ok
// createMachine(['idle', 'loading'], 'finished');      // error with NoInfer

function useDefault<T>(values: T[], fallback: NoInfer<T>): T {
  return values[0] ?? fallback;
}

// Curried alternative used before 5.4
const machine = <S extends string>(states: S[]) => ({
  start: (initial: S) => ({ states, current: initial }),
});
machine(['on', 'off']).start('on');
```

#### Pitfalls
- Without `NoInfer`, the "wrong" argument widens the inferred type and the call compiles, giving a false sense of safety.

### Variance
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html -->
Variance describes how subtyping of type arguments carries over to a generic type. If `Dog` is assignable to `Animal`:

- Covariant: `Producer<Dog>` is assignable to `Producer<Animal>` (things you read from). Return types and readonly properties are covariant.
- Contravariant: `Consumer<Animal>` is assignable to `Consumer<Dog>` (things you write to). Function parameters are contravariant under `strictFunctionTypes`.
- Invariant: neither direction — types used for both reading and writing.
- Bivariant: both directions (unsound) — method-syntax parameters and, without `strictFunctionTypes`, all parameters.

TypeScript measures variance structurally. Arrays are treated as covariant even though they are mutable, an intentional unsoundness for convenience. TypeScript 4.7 added optional `in`/`out` annotations on type parameters to document intended variance and speed up checking for very complex types.

```ts
class Animal { name = ''; }
class Dog extends Animal { bark() {} }

let dogs: Dog[] = [new Dog()];
let animals: Animal[] = dogs;        // allowed (covariant arrays)
animals.push(new Animal());          // compiles…
// dogs[1].bark();                   // …runtime crash: unsound

type Handler<T> = (value: T) => void;
const handleAnimal: Handler<Animal> = (a) => console.log(a.name);
const handleDog: Handler<Dog> = handleAnimal;   // ok: contravariant
// const bad: Handler<Animal> = (d: Dog) => d.bark(); // error under strictFunctionTypes

interface Producer<out T> { get(): T }
interface Consumer<in T> { accept(value: T): void }
```

#### Interview tip
- Explain why method shorthand (`accept(v: T): void`) is bivariant while property syntax (`accept: (v: T) => void`) is contravariant — and which to prefer for safety.

## 7. Type Operators and Type-Level Programming

### keyof and typeof type operators
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/keyof-types.html -->
`keyof T` produces a union of the property keys of an object type. For `{ id: number; name: string }` it is `'id' | 'name'`. With an index signature, it is the index key type (for string index signatures, `string | number`, since numeric keys are converted to strings).

The type-level `typeof x` produces the type of a value-level variable or property. It lets you derive types from existing runtime values — configuration objects, constant arrays, functions — so that the value remains the single source of truth.

They are often combined: `keyof typeof config` gives the keys of a runtime object.

```ts
const defaultSettings = {
  theme: 'dark',
  fontSize: 14,
  autosave: true,
};

type Settings = typeof defaultSettings;     // { theme: string; fontSize: number; autosave: boolean }
type SettingKey = keyof Settings;           // 'theme' | 'fontSize' | 'autosave'

function updateSetting<K extends SettingKey>(key: K, value: Settings[K]) {}
updateSetting('fontSize', 16);

const handlers = {
  click: (e: MouseEvent) => {},
  keydown: (e: KeyboardEvent) => {},
};
type HandlerName = keyof typeof handlers;   // 'click' | 'keydown'

function createStore() {
  return { count: 0, increment() {} };
}
type Store = ReturnType<typeof createStore>;
```

#### Pitfalls
- `typeof` in a type position only works on identifiers and property accesses, not on arbitrary expressions such as function calls; use `ReturnType<typeof fn>` instead.

### Indexed access types
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/indexed-access-types.html -->
An indexed access type `T[K]` looks up the type of a property: `User['email']` is `string`. The index can be a union of keys, giving a union of property types, or `keyof T` to get all value types.

For arrays and tuples, indexing with `number` gives the element type: `(typeof list)[number]`. Indexing a tuple with a numeric literal gives that position's type. Lookups can be chained to reach nested types.

This lets you reuse pieces of large generated types (for example from OpenAPI or GraphQL code generators) without redeclaring them, so they stay in sync when the source changes.

```ts
interface ApiOrder {
  id: string;
  customer: { id: string; address: { city: string; pin: string } };
  lines: { sku: string; qty: number; price: number }[];
  status: 'new' | 'paid' | 'shipped';
}

type OrderStatus = ApiOrder['status'];                     // 'new' | 'paid' | 'shipped'
type Address = ApiOrder['customer']['address'];
type OrderLine = ApiOrder['lines'][number];
type IdOrStatus = ApiOrder['id' | 'status'];               // string | 'new' | ...
type AnyValue = ApiOrder[keyof ApiOrder];

const PLANS = [
  { id: 'free', seats: 1 },
  { id: 'team', seats: 10 },
] as const;
type PlanId = (typeof PLANS)[number]['id'];                // 'free' | 'team'

type Second = [string, number, boolean][1];                // number
```

#### Pitfalls
- You cannot use a value-level variable as the index: `ApiOrder[key]` with `const key = 'id'` fails; use `ApiOrder[typeof key]`.

### Conditional types
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/2/conditional-types.html -->
A conditional type chooses between two types based on an assignability test: `T extends U ? X : Y`. Read it as "if T is assignable to U, then X, else Y". It is the type-level `if`.

Conditional types are most useful with generics, where the decision is deferred until `T` is known. They let return types depend on input types, filter unions, and extract parts of types.

When `T` is still an unresolved type parameter inside a generic function body, the conditional stays deferred, which is why implementations often need an assertion to return a value of a conditional type.

```ts
type IsString<T> = T extends string ? true : false;
type A = IsString<'hi'>;        // true
type B = IsString<42>;          // false

type ApiResult<T> = T extends 'list' ? Product[] : T extends 'detail' ? Product : never;

declare function fetchProducts<M extends 'list' | 'detail'>(mode: M): Promise<ApiResult<M>>;
const list = await fetchProducts('list');      // Product[]
const one = await fetchProducts('detail');     // Product

// Recursive conditional: unwrap nested promises
type Unwrap<T> = T extends Promise<infer U> ? Unwrap<U> : T;
type V = Unwrap<Promise<Promise<number>>>;      // number

type NonFunctionKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never : K;
}[keyof T];
```

#### Pitfalls
- Deeply nested conditional chains become unreadable and slow to check; prefer overloads or a lookup type (`Map[K]`) when they express the same thing more simply.

### The infer keyword
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#inferring-within-conditional-types -->
Inside the `extends` clause of a conditional type, `infer X` declares a type variable that TypeScript fills in by pattern matching. If the match succeeds, `X` is available in the true branch. This is how many built-in utilities are implemented: `ReturnType`, `Parameters`, `Awaited`, `InstanceType`.

You can infer from any position: function parameters and returns, array elements, promise contents, template literal pieces, tuple heads and tails. Since TypeScript 4.7 you can constrain an inferred type with `infer X extends string`; since 4.8 this also improves inference of number and boolean literals from template strings.

When a function type has overloads, `infer` matches the last overload signature.

```ts
type MyReturnType<F> = F extends (...args: any[]) => infer R ? R : never;
type ElementOf<T> = T extends readonly (infer E)[] ? E : never;
type FirstArg<F> = F extends (first: infer A, ...rest: any[]) => any ? A : never;

type Head<T extends unknown[]> = T extends [infer H, ...unknown[]] ? H : never;
type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : [];

type Port<S> = S extends `${string}:${infer P extends number}` ? P : never;
type P = Port<'localhost:8080'>;          // 8080 (a number literal)

type PropsOf<C> = C extends (props: infer P) => unknown ? P : never;

declare function handler(req: { body: { email: string } }): Promise<{ ok: boolean }>;
type Body = FirstArg<typeof handler>['body'];          // { email: string }
type Result = Awaited<MyReturnType<typeof handler>>;    // { ok: boolean }
```

#### Interview tip
- A frequent exercise is implementing `ReturnType`, `Parameters` or `Awaited` from scratch; practise them.

### Distributive conditional types
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types -->
When a conditional type checks a naked type parameter (`T extends ...` where `T` is not wrapped), and `T` is instantiated with a union, the conditional is applied to each member separately and the results are unioned. This is called distribution.

Distribution is what makes `Exclude<T, U> = T extends U ? never : T` filter a union: each member is tested and either kept or turned into `never`, which disappears from the union.

`never` is treated as an empty union, so a distributive conditional over `never` yields `never` — a common surprise when writing `IsNever<T>`.

To disable distribution, wrap both sides in a one-element tuple: `[T] extends [U]`.

```ts
type ToArray<T> = T extends unknown ? T[] : never;
type A = ToArray<string | number>;         // string[] | number[]

type ToArrayNonDist<T> = [T] extends [unknown] ? T[] : never;
type B = ToArrayNonDist<string | number>;  // (string | number)[]

type MyExclude<T, U> = T extends U ? never : T;
type C = MyExclude<'a' | 'b' | 'c', 'a'>;  // 'b' | 'c'

type IsNeverWrong<T> = T extends never ? true : false;
type D = IsNeverWrong<never>;              // never (!)
type IsNever<T> = [T] extends [never] ? true : false;
type E = IsNever<never>;                   // true

type EventPayload<E> = E extends { type: infer T; payload: infer P } ? { type: T; data: P } : never;
```

#### Pitfalls
- Unexpected distribution produces unions of arrays or unions of objects when you wanted one combined type; reach for the tuple wrapper.

### Mapped types
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/2/mapped-types.html -->
A mapped type creates a new object type by iterating over a set of keys: `{ [K in Keys]: Type }`. When the keys come from `keyof T`, it is a homomorphic mapped type that preserves the original's optional and readonly modifiers, and also maps arrays and tuples to arrays and tuples.

Modifiers can be added or removed with `+` and `-`: `-readonly` makes properties writable, `-?` makes them required. `Partial`, `Required`, `Readonly`, `Pick` and `Record` are all mapped types.

Mapped types are the backbone of deriving related types: form state from a model, validation errors per field, setter functions per property, or feature flags per environment.

```ts
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Concrete<T> = { [K in keyof T]-?: T[K] };

interface SignupForm {
  email: string;
  password: string;
  referral?: string;
}

type FormErrors<T> = { [K in keyof T]?: string };
type Touched<T> = { [K in keyof T]: boolean };
type Validators<T> = { [K in keyof T]-?: (value: T[K]) => string | null };

const validators: Validators<SignupForm> = {
  email: (v) => (v.includes('@') ? null : 'Invalid email'),
  password: (v) => (v.length >= 8 ? null : 'Too short'),
  referral: () => null,
};

type Nullable<T> = { [K in keyof T]: T[K] | null };
```

#### Interview tip
- Explain homomorphism: why `Partial<[string, number]>` gives `[string?, number?]` and how mapped types preserve modifiers from `keyof T`.

### Key remapping with as
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/2/mapped-types.html#key-remapping-via-as -->
TypeScript 4.1 added an `as` clause to mapped types to transform or filter keys: `{ [K in keyof T as NewKey]: ... }`. Mapping a key to `never` removes it. Combined with template literal types, this generates new property names such as getters, setters or event handlers.

Remapping lets you write utilities that would otherwise need `Pick` plus a separately computed key union — for example "only the function properties" or "only string-valued keys".

Note that a remapped type is no longer homomorphic in all cases, so modifier preservation and array mapping may not apply as you expect.

```ts
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

interface Person { name: string; age: number }
type PersonGetters = Getters<Person>;
// { getName: () => string; getAge: () => number }

type PickByValue<T, V> = {
  [K in keyof T as T[K] extends V ? K : never]: T[K];
};
type StringFields = PickByValue<Person, string>;   // { name: string }

type EventHandlers<E extends Record<string, unknown>> = {
  [K in keyof E as `on${Capitalize<string & K>}`]?: (payload: E[K]) => void;
};
type Props = EventHandlers<{ change: string; submit: { valid: boolean } }>;
// { onChange?: (p: string) => void; onSubmit?: (p: { valid: boolean }) => void }

type WithoutPrivate<T> = { [K in keyof T as K extends `_${string}` ? never : K]: T[K] };
```

#### Pitfalls
- `Capitalize<K>` requires a string; `keyof T` can include numbers and symbols, hence the `string & K` intersection.

### Template literal types
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html -->
Template literal types (TypeScript 4.1) build string literal types using the same backtick syntax as JavaScript template strings. When a placeholder is a union, the result is the cross product of all combinations. Placeholders can also be `string`, `number` or `bigint`, producing pattern types that match any string of that shape.

Intrinsic helpers transform casing: `Uppercase`, `Lowercase`, `Capitalize`, `Uncapitalize`.

Combined with `infer`, template literal types parse strings at the type level — extracting route parameters from `'/users/:id'`, splitting dotted paths, or validating CSS units.

```ts
type Size = 'sm' | 'md' | 'lg';
type Variant = 'primary' | 'ghost';
type ButtonClass = `btn-${Variant}-${Size}`;   // 6 combinations

type Px = `${number}px`;
const w: Px = '12px';
// const bad: Px = '12em';                     // error

type RouteParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof RouteParams<`/${Rest}`>]: string }
    : Path extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : {};

type P = RouteParams<'/shops/:shopId/orders/:orderId'>;
// { shopId: string; orderId: string }

function route<Path extends string>(path: Path, params: RouteParams<Path>) {}
route('/users/:id', { id: '42' });
// route('/users/:id', {});                    // error: id missing
```

#### Pitfalls
- Large unions in template literals explode combinatorially; TypeScript caps union sizes (around 100,000 members) and reports an error when exceeded.
