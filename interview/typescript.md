# TypeScript interview questions

### What is the difference between `interface` and `type`?
<!-- level: basic; kind: concept; ref: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#differences-between-type-aliases-and-interfaces -->
Both describe object shapes and are mostly interchangeable.
- `interface` can be **reopened** (declaration merging) and extended with `extends`; often preferred for public object contracts.
- `type` can name **any** type — unions, intersections, tuples, primitives, mapped and conditional types.

```ts
interface User { id: number; name: string }
type Id = number | string;
type Admin = User & { permissions: string[] };
```

### What is the difference between `any`, `unknown` and `never`?
<!-- level: intermediate; kind: concept; ref: https://www.typescriptlang.org/docs/handbook/2/functions.html#unknown -->
- `any`: turns type checking off — anything goes. Avoid it.
- `unknown`: a type-safe "anything" — you must narrow it (`typeof`, `instanceof`, type guards) before use. Good for parsed JSON or `catch` errors.
- `never`: a value that can never exist — the return type of functions that always throw, and the result of exhaustive narrowing.

### How do generics with constraints work?
<!-- level: intermediate; kind: concept; ref: https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-constraints -->
Generics let a function or type work with many types while keeping type information. Constraints (`extends`) restrict what is allowed:

```ts
function getProp<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
const user = { id: 1, name: 'Asha' };
getProp(user, 'name');   // string
getProp(user, 'email');  // compile error
```

### Name some built-in utility types and when you use them.
<!-- level: basic; kind: concept; ref: https://www.typescriptlang.org/docs/handbook/utility-types.html -->
- `Partial<T>` — all properties optional (update payloads).
- `Required<T>`, `Readonly<T>`.
- `Pick<T, K>` / `Omit<T, K>` — select or remove properties (DTOs).
- `Record<K, V>` — object maps.
- `ReturnType<F>`, `Parameters<F>`, `Awaited<T>` — derive types from functions/promises.
- `NonNullable<T>`, `Exclude<T, U>`, `Extract<T, U>` — refine unions.

### What are discriminated unions, and how do they enable exhaustive checks?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions -->
A union whose members share a literal "tag" property. Checking the tag narrows the type, and assigning to `never` makes the compiler flag any case you forgot to handle:

```ts
type Result =
  | { status: 'ok'; data: string }
  | { status: 'error'; message: string }
  | { status: 'loading' };

function render(r: Result) {
  switch (r.status) {
    case 'ok': return r.data;
    case 'error': return r.message;
    case 'loading': return 'Loading…';
    default: const _exhaustive: never = r; return _exhaustive;
  }
}
```
