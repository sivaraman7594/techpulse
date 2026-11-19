### How would you migrate a 200-file JavaScript codebase to TypeScript without stopping feature work?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html -->
Observe: a large JS project with active development, mixed quality, and no types; a big-bang rewrite would block the team.

Hypothesise: incremental adoption lowers risk, since TypeScript can coexist with JavaScript in one build.

Verify: first add `typescript` and a `tsconfig.json` with `allowJs: true` and `checkJs: false`, and confirm the build and tests still pass unchanged.

Fix, step by step:
1. Start with permissive settings (`strict: false`, `noImplicitAny: false`).
2. Rename leaf modules and shared utilities to `.ts` first, since they have few dependents.
3. Add types at boundaries: API responses, config, domain models.
4. Opt in per file with `// @ts-check` for files not yet converted.
5. Turn on strict flags one at a time (`noImplicitAny`, then `strictNullChecks`), fixing each batch.
6. Add a CI check so converted files cannot regress.

```json
{ "compilerOptions": { "allowJs": true, "checkJs": false, "noEmit": true, "strict": false } }
```

Prevent: forbid new `.js` files, track the count of `any` and `@ts-ignore`, and use `@ts-expect-error` (which errors when no longer needed) instead of `@ts-ignore`.

Common wrong answers: converting everything at once, or enabling `strict` on day one and silencing hundreds of errors with `any`.

### The API response is typed, yet production crashes with "cannot read property of undefined". What went wrong and how do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions -->
Observe: a function typed to return `User` receives a payload missing `address`; the crash occurs deep in UI code.

Hypothesise: types are erased at runtime. `const user = (await res.json()) as User` is an assertion, not a check, so TypeScript trusts a lie about external data.

Verify: log the actual payload and compare with the declared interface; search for `as` on parsed JSON.

Fix: validate at the boundary and derive the static type from the validator, so the two cannot drift. Libraries such as Zod, Valibot, or io-ts do this.

```ts
import { z } from 'zod';
const User = z.object({ id: z.number(), name: z.string(), address: z.object({ city: z.string() }).optional() });
type User = z.infer<typeof User>;
const user = User.parse(await res.json());   // throws with a clear message
```

Treat `res.json()` results as `unknown` until validated.

Prevent: ban `as` on external data via lint, generate types from an OpenAPI schema, and add contract tests.

Common wrong answer: adding more interfaces; they add no runtime safety.

### The compiler says "Object is possibly undefined" and a teammate adds `!` everywhere. How would you respond?
<!-- level: basic; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/2/narrowing.html -->
Observe: many non-null assertions (`user!.name`) added to silence errors; some later crash.

Hypothesise: the type correctly says a value may be absent; `!` overrides the checker without any runtime check.

Verify: find where the value could actually be missing: `Array.prototype.find`, `Map.get`, optional props, DOM queries.

Fix: narrow instead. Handle the missing case or make the data model stronger.

```ts
const user = users.find((u) => u.id === id);
if (!user) throw new Error(`User ${id} not found`);
console.log(user.name);          // narrowed to User

const city = order.customer?.address?.city ?? 'n/a';
```

Use a small assertion helper (`function assertDefined<T>(v: T | null | undefined): asserts v is T`) where absence is truly a bug, which gives a clear error rather than a later crash.

Prevent: enable `@typescript-eslint/no-non-null-assertion` and review any new `!`.

Common wrong answers: disabling `strictNullChecks`, or using `as User` to dodge the check.

### You enabled `strict` and got 900 errors. How do you plan the cleanup?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/tsconfig/#strict -->
Observe: a flood of errors; the team wants to revert.

Hypothesise: `strict` bundles flags (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictPropertyInitialization`, and more). Most errors come from one or two flags.

Verify: turn flags on individually and count errors for each with `tsc --noEmit | grep -c error`.

Fix: ratchet. Enable the cheapest flags first, then the heavy ones, per package or directory using multiple tsconfigs that extend a base, so strict code grows over time.

```json
// tsconfig.strict.json
{ "extends": "./tsconfig.json",
  "compilerOptions": { "strict": true },
  "include": ["src/billing/**/*"] }
```

Run both configs in CI. Add `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` later, as they are stricter than `strict`.

Prevent: a baseline file of existing errors that may not grow, and a "new files must be strict" rule.

Common wrong answer: sprinkling `// @ts-ignore` to reach zero errors, which hides the same bugs.

### Why does `Object.keys(obj).forEach(k => obj[k])` fail to type-check, and what should you do?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/2/keyof-types.html -->
Observe: "Element implicitly has an 'any' type because expression of type 'string' can't be used to index type".

Hypothesise: `Object.keys` returns `string[]`, not `(keyof T)[]`, because TypeScript objects are structurally typed and may carry extra properties at runtime. Indexing a specific shape by arbitrary `string` is unsafe.

Verify: hover over `k`; it is `string`.

Fix options, from safest:
1. Iterate with `Object.entries(obj)`, which gives values directly.
2. If the key set is known and closed, use a typed key list.
3. Narrow with a type guard when you accept the risk.

```ts
const prices = { apple: 1, pear: 2 };
for (const [name, price] of Object.entries(prices)) { /* price: number */ }

const keys = Object.keys(prices) as Array<keyof typeof prices>; // only if no extras can exist
```

For dynamic dictionaries, type them as `Record<string, number>`.

Prevent: review casts of `Object.keys`; document why it is safe.

Common wrong answer: changing the object type to `any`.

### `tsc` takes four minutes in a monorepo and the editor is sluggish. How do you speed it up?
<!-- level: advanced; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/project-references.html -->
Observe: slow full builds, slow IntelliSense, CI dominated by type-checking.

Hypothesise: one huge program re-checks everything each time; heavy generic or union types; unnecessary `include` globs pulling in `node_modules` or tests; `skipLibCheck` off.

Verify: run `tsc --extendedDiagnostics` to see files, instantiations, and check time; `tsc --listFiles | wc -l` to catch accidental inclusion; `--generateTrace` for hot spots.

Fix:
- Split into packages with project references and `composite: true`, then build with `tsc -b` so unchanged projects are skipped.
- Enable `incremental` (build info cache).
- Set `skipLibCheck: true`, tighten `include`/`exclude`.
- Separate type-check from transpile: use esbuild, SWC, or Vite for emitting and run `tsc --noEmit` only in CI.
- Simplify pathological types: replace giant unions or deeply recursive conditional types with named interfaces.

```bash
tsc -b --verbose
```

Prevent: track check time in CI and add a budget.

Common wrong answer: disabling type checks in CI.

### A JavaScript library has no types and you get "Could not find a declaration file". What are your options?
<!-- level: basic; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/declaration-files/consumption.html -->
Observe: error TS7016 on `import legacy from 'legacy-lib'`.

Hypothesise: the package ships no `.d.ts`, and no community types exist under DefinitelyTyped.

Verify: check the package's `types` field, then `npm view @types/legacy-lib`.

Fix, in order:
1. Install `@types/<name>` if available.
2. Write a minimal local declaration covering only the functions you use.
3. As a last resort, declare the module as `any`.

```ts
// types/legacy-lib.d.ts
declare module 'legacy-lib' {
  export function parse(input: string): { id: number; tags: string[] };
}
```

Make sure the `.d.ts` is covered by `include` or `typeRoots`. Consider contributing the types upstream or to DefinitelyTyped.

Prevent: wrap untyped libraries behind one adapter module so typing effort stays in one place.

Common wrong answer: `declare module 'legacy-lib';` everywhere, which turns off checking silently; use it only temporarily.

### Narrowing works in an `if`, then stops working inside a callback. Why?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#control-flow-analysis -->
Observe: after `if (user.email) { items.map(() => user.email.toLowerCase()) }` the compiler complains that `email` may be undefined.

Hypothesise: narrowing applies to references that cannot change. For mutable properties and `let` variables, TypeScript resets narrowing inside functions because the callback might run later, after another assignment. (Recent versions preserve narrowing for `const` and for never-reassigned variables.)

Verify: change to a `const email = user.email` and see if the error disappears.

Fix: capture the narrowed value in a `const` before the callback.

```ts
if (user.email) {
  const email = user.email;      // string
  items.map(() => email.toLowerCase());
}
```

Alternatively use a type guard function or restructure to return early.

Prevent: prefer `const` and immutable data (`readonly`) to keep narrowing stable.

Common wrong answer: using `!` inside the callback.

### An `enum` is bloating the bundle and numeric values leak into JSON. Would you keep it?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/enums.html -->
Observe: a numeric enum `Status { Active, Inactive }` serialized as `0` and `1`; reordering members silently changes stored data; each enum emits runtime code.

Hypothesise: numeric enums create runtime objects with reverse mappings and are fragile when values are implicit. They also accept any number in older versions.

Verify: inspect the emitted JavaScript and check what is stored in the database.

Fix: prefer a union of string literals, or a `const` object with `as const` when you also need runtime values.

```ts
const Status = { Active: 'active', Inactive: 'inactive' } as const;
type Status = typeof Status[keyof typeof Status];   // 'active' | 'inactive'
```

If you keep an enum, use string enums with explicit values. Note `const enum` is incompatible with `isolatedModules` setups in many toolchains and is best avoided in libraries.

Prevent: a lint rule or team convention, and explicit values for anything persisted.

Common wrong answer: "enums are bad, never use them"; they are fine when values are explicit and the team accepts the runtime object.

### A generic helper infers `string` instead of the literal `'admin'`, breaking later checks. How do you fix the inference?
<!-- level: advanced; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-constraints -->
Observe: `function pick<T>(v: T): T` returns type `string` when passed `"admin"` in some positions, and a config object's `role: 'admin'` widens to `string`.

Hypothesise: object properties and mutable positions widen literals; inference needs a hint that a literal is wanted.

Verify: hover the inferred types; try the call with `as const`.

Fix: constrain the type parameter with a primitive to request literal inference, or use `as const` / `satisfies` at the call site (`satisfies` needs TypeScript 4.9+; `const` type parameters need 5.0+).

```ts
function role<T extends string>(r: T): T { return r; }
const r = role('admin');                 // 'admin'

const config = { role: 'admin' } as const;

function tuple<const T extends readonly unknown[]>(v: T): T { return v; }  // TS 5.0+
```

Prevent: design APIs so the generic reflects what callers pass, and add type tests.

Common wrong answer: casting results `as 'admin'`, which defeats inference instead of fixing it.

### How do you add a `user` property to Express's `Request` type without casting everywhere?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/declaration-merging.html#module-augmentation -->
Observe: `req.user` errors with "Property 'user' does not exist"; code uses `(req as any).user`.

Hypothesise: authentication middleware attaches data at runtime, but the library's declared `Request` interface does not know about it.

Verify: check where middleware sets the value and that it always runs before the handlers that read it.

Fix: use module augmentation (declaration merging) in a `.d.ts` or module file included by `tsconfig`.

```ts
// src/types/express.d.ts
import 'express';
declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; roles: string[] };
  }
}
```

Mark it optional unless the route is guaranteed to be authenticated. For routes behind auth, create a narrower type or a helper that asserts the user exists.

Prevent: keep augmentations in one folder and verify the file is in `include`; test that unauthenticated routes do not read `user`.

Common wrong answers: global `any`, or a custom `AuthedRequest` cast on every handler without checking the middleware actually ran.

### How would you type a form state where every field has a value, an error, and a touched flag?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/2/mapped-types.html -->
Observe: duplicated interfaces (`Values`, `Errors`, `Touched`) that drift whenever a field is added.

Hypothesise: all three shapes are derived from one source of truth, which mapped types express.

Verify: add a field to the source and see whether the derived types update.

Fix:

```ts
interface Values { email: string; age: number; newsletter: boolean }

type Errors  = { [K in keyof Values]?: string };
type Touched = { [K in keyof Values]: boolean };
type Field<K extends keyof Values> = {
  value: Values[K]; error?: string; touched: boolean;
};
type FormState = { [K in keyof Values]: Field<K> };

function setValue<K extends keyof Values>(s: FormState, k: K, v: Values[K]): FormState {
  return { ...s, [k]: { ...s[k], value: v } };
}
```

The generic `K` ties key to value type, so `setValue(s, 'age', 'x')` is rejected.

Prevent: keep one root type and derive everything else; add `// @ts-expect-error` tests for invalid calls.

Common wrong answer: typing the setter as `(key: string, value: any)`.

### Your library's consumers report missing types after you publish. What do you check?
<!-- level: advanced; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html -->
Observe: "Could not find a declaration file for module 'my-lib'" or wrong types under `moduleResolution: node16` or `bundler`.

Hypothesise: the tarball lacks `.d.ts` files, or `package.json` does not point to them, or `exports` omits a `types` condition.

Verify: run `npm pack --dry-run` to list contents, install the tarball into a scratch project, and import from both ESM and CJS. Tools such as `@arethetypeswrong/cli` check resolution across modes.

Fix: emit declarations (`declaration: true`), include them in `files`, and set the entry points.

```json
{
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" }
  },
  "files": ["dist"]
}
```

Put `types` first within each condition block. For dual ESM/CJS builds, CJS needs `.d.cts` declarations.

Prevent: add an install-and-import smoke test to CI before publish.

Common wrong answer: relying on `main` alone when `exports` exists.

### A teammate uses `as` casts to make errors disappear. When is a cast acceptable and what is the alternative?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator -->
Observe: casts like `value as Config` or `as unknown as Foo` spread across the code.

Hypothesise: casts assert the opposite of what the compiler knows; wrong ones produce runtime errors with no warning.

Verify: list casts (`grep " as "`), and for each decide whether the compiler can be convinced legitimately.

Fix: prefer, in order: type annotations that make the value correct; a type guard or assertion function that checks at runtime; `satisfies` (TypeScript 4.9+) to validate a literal against a type while preserving its precise inferred type.

```ts
const routes = {
  home: '/',
  user: '/users/:id',
} satisfies Record<string, string>;

routes.home;   // typed as string, and the keys are known
// a cast would have lost the keys or hidden mistakes
```

A cast is acceptable when you know more than the compiler (for example, narrowing a DOM element after checking) and the reason is commented.

Prevent: lint on `as unknown as` and on `any`; require review for casts.

Common wrong answer: "casts convert the value"; they change only the static type.

### In a `catch` block, `error.message` fails to compile. How do you handle errors safely?
<!-- level: basic; kind: scenario; ref: https://www.typescriptlang.org/tsconfig/#useUnknownInCatchVariables -->
Observe: "'error' is of type 'unknown'" (default under `strict` since TypeScript 4.4 via `useUnknownInCatchVariables`).

Hypothesise: JavaScript lets code throw anything: strings, objects, `null`. The compiler is right that you cannot assume an `Error`.

Verify: check whether libraries in the call chain throw non-Error values.

Fix: narrow before use, and centralize the logic.

```ts
function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  try { return new Error(typeof e === 'string' ? e : JSON.stringify(e)); }
  catch { return new Error('Unknown error'); }
}

try { await run(); }
catch (e) { log(toError(e).message); }
```

For domain errors, define classes and branch on `instanceof` (or a `code` field when crossing realms or serialization).

Prevent: always throw `Error` instances, and use `cause` (`new Error('x', { cause: e })`) to keep context.

Common wrong answer: `catch (e: any)`, which restores the unsafety.

### The compiler reports "Type instantiation is excessively deep and possibly infinite". How do you approach it?
<!-- level: advanced; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/2/conditional-types.html -->
Observe: error TS2589, usually after adding a recursive conditional type or a complex library generic.

Hypothesise: the checker hit its recursion limit (about 50 instantiations; tail-recursive conditional types allow more since TypeScript 4.5). Causes: recursive types over large unions, template literal types producing huge unions, or a self-referential generic.

Verify: isolate the type in a scratch file and reduce the input until it compiles; use `--generateTrace` and the trace viewer for hotspots.

Fix:
- Rewrite recursion to be tail-recursive with an accumulator parameter.
- Reduce the union size (do you need all combinations as types?).
- Replace the clever type with a simpler, slightly looser one plus a runtime check.
- Break the work into named intermediate aliases to help caching.

```ts
type Reverse<T extends unknown[], Acc extends unknown[] = []> =
  T extends [infer H, ...infer R] ? Reverse<R, [H, ...Acc]> : Acc;
```

Prevent: type-level code needs tests with large inputs; favor readability over cleverness.

Common wrong answer: `// @ts-ignore` on the usage, which leaves slow and untrustworthy types.

### Two IDs, `UserId` and `OrderId`, are both strings and someone passed one where the other belongs. How do you prevent that?
<!-- level: advanced; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/type-compatibility.html -->
Observe: a bug where `getOrder(userId)` compiled and returned nothing.

Hypothesise: TypeScript is structural, so two aliases of `string` are interchangeable.

Verify: confirm that `type UserId = string` accepts any string, including an order ID.

Fix: brand the types with a phantom property that exists only at compile time, and create values through a validating constructor.

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId  = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;

const asUserId = (s: string): UserId => {
  if (!/^u_/.test(s)) throw new Error('bad user id');
  return s as UserId;
};

declare function getOrder(id: OrderId): Promise<unknown>;
// getOrder(asUserId('u_1'))   // error
```

The brand has zero runtime cost; the only cast lives in the constructor.

Prevent: parse IDs at system boundaries so branded values are the norm inside.

Common wrong answer: wrapping IDs in objects at runtime for type safety, which costs allocations and changes serialization.

### A reducer handles actions with a `switch`, and adding a new action type did not cause any compile error. How do you enforce exhaustiveness?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking -->
Observe: a new `'reset'` action silently falls through to the default branch in production.

Hypothesise: the switch has a permissive `default` returning state, so unhandled members are never reported.

Verify: add a union member and confirm that the code still compiles.

Fix: model actions as a discriminated union and assert `never` in the default branch.

```ts
type Action =
  | { type: 'add'; item: string }
  | { type: 'remove'; id: number }
  | { type: 'reset' };

function assertNever(x: never): never {
  throw new Error(`Unhandled: ${JSON.stringify(x)}`);
}

function reducer(s: string[], a: Action): string[] {
  switch (a.type) {
    case 'add': return [...s, a.item];
    case 'remove': return s.filter((_, i) => i !== a.id);
    case 'reset': return [];
    default: return assertNever(a);   // errors at compile time if a case is missing
  }
}
```

Prevent: the ESLint rule `switch-exhaustiveness-check` provides the same guarantee without a helper.

Common wrong answer: `default: return s`, which hides missing cases.

### Overloads or generics: how would you type a function that returns a string for one input and an array for another?
<!-- level: advanced; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/2/functions.html#function-overloads -->
Observe: `function read(x: boolean): string | string[]` forces callers to narrow the result every time.

Hypothesise: the return type depends on the input type; a plain union loses that relationship.

Verify: write call sites and see if narrowing is needed.

Fix: use overloads for a small fixed set of input-output pairs, or a generic with a conditional type when the relationship is systematic.

```ts
function read(asList: true): string[];
function read(asList: false): string;
function read(asList: boolean): string | string[] {
  return asList ? ['a', 'b'] : 'ab';
}
const a = read(true);    // string[]

type Result<T extends boolean> = T extends true ? string[] : string;
declare function read2<T extends boolean>(asList: T): Result<T>;
```

The implementation signature is not visible to callers, and its body is not checked against each overload precisely, so test it.

Prevent: keep overload lists short and ordered from specific to general; do not use overloads where optional parameters suffice.

Common wrong answer: returning `any` and leaving callers to cast.

### Mutating an array that a function receives caused a hard-to-find bug. How can types prevent it?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/2/objects.html#the-readonlyarray-type -->
Observe: a sort inside a helper reordered the caller's list; a UI did not update because React state was mutated in place.

Hypothesise: arrays are mutable by default and typed that way; callers cannot tell whether a function mutates.

Verify: search for `sort`, `splice`, `push`, and `reverse` on parameters.

Fix: accept `readonly T[]` (or `ReadonlyArray<T>`) in function parameters, which removes mutating methods from the type, and return new arrays. Use `as const` for literal tuples and `Readonly<T>` or `readonly` modifiers for objects.

```ts
function topThree(scores: readonly number[]): number[] {
  return [...scores].sort((a, b) => b - a).slice(0, 3);
  // scores.sort(...) would be a compile error
}
```

`readonly` is compile-time only and shallow; it does not freeze at runtime, so use `Object.freeze` or immutable libraries if you need a guarantee.

Prevent: make `readonly` params the default in shared utilities.

Common wrong answer: assuming `const arr` prevents mutation (it prevents reassignment only).

### Imports like `@/utils` compile fine but fail at runtime with "Cannot find module". Why?
<!-- level: intermediate; kind: scenario; ref: https://www.typescriptlang.org/tsconfig/#paths -->
Observe: `tsc` and the editor are happy; Node or the bundled output cannot resolve the path.

Hypothesise: `compilerOptions.paths` only teaches the type checker how to resolve names. TypeScript does not rewrite import specifiers in emitted JavaScript.

Verify: inspect the compiled output; the import still reads `'@/utils'`.

Fix: configure the same alias in the actual runtime tool: your bundler (Vite `resolve.alias`, webpack `resolve.alias`), a Node loader or `tsx` setup, a package `imports` map (`"#utils/*"`), or a post-compile rewrite step. Keeping aliases consistent in one place avoids drift.

```json
{
  "imports": { "#utils/*": "./dist/utils/*.js" }
}
```

Under Node ESM you also need explicit file extensions in relative imports (`./a.js`), and `moduleResolution: node16` or `nodenext` makes the compiler enforce this.

Prevent: run the built output in a CI smoke test, not just `tsc`.

Common wrong answer: believing `paths` creates runtime aliases.

### A build tool complains about `isolatedModules` and re-exported types. What is the issue?
<!-- level: advanced; kind: scenario; ref: https://www.typescriptlang.org/tsconfig/#isolatedModules -->
Observe: errors such as "Re-exporting a type when 'isolatedModules' is set requires using 'export type'", or runtime failures importing a name that is only a type.

Hypothesise: transpilers like esbuild, SWC, and Babel compile each file independently without type information. They cannot know whether `export { Foo } from './foo'` refers to a type (to erase) or a value (to keep).

Verify: check whether your bundler is transpile-only and whether `isolatedModules` or `verbatimModuleSyntax` is enabled.

Fix: mark type-only imports and exports explicitly.

```ts
import type { User } from './types';
import { type Role, makeRole } from './roles';
export type { User } from './types';
```

`verbatimModuleSyntax` (TypeScript 5.0+) enforces this by keeping non-`type` imports exactly as written and flagging ambiguities.

Prevent: turn on `isolatedModules` (or `verbatimModuleSyntax`) so the editor flags it the moment code is written, and use the lint rule `consistent-type-imports`.

Common wrong answer: disabling the flag so the compiler stops complaining, then discovering failures at bundle time.

### An update endpoint takes the same fields as a create endpoint, but all optional. How do you type it without duplication?
<!-- level: basic; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/utility-types.html#partialtype -->
Observe: `CreateUser` and `UpdateUser` interfaces copied and diverging.

Hypothesise: the update shape is derivable from the create shape.

Verify: list which fields may change: perhaps `id` and `createdAt` must not.

Fix: derive with utility types.

```ts
interface User { id: string; name: string; email: string; createdAt: Date }

type CreateUser = Omit<User, 'id' | 'createdAt'>;
type UpdateUser = Partial<CreateUser>;
type UpdateUserRequired = Required<Pick<User, 'name'>> & Partial<Omit<User, 'name'>>;

function update(id: string, patch: UpdateUser) { /* ... */ }
```

`Partial` is shallow; for nested patch objects write a `DeepPartial` recursive type, and consider that `undefined` values may overwrite fields if you spread blindly. With `exactOptionalPropertyTypes` you can distinguish "missing" from "explicitly undefined".

Prevent: derive request types from one model, and validate payloads at runtime.

Common wrong answer: making every field optional on the base `User` interface, which weakens every other use.

### `array.forEach(async ...)` compiled, but the code after it ran before the work finished. How would the type system help?
<!-- level: intermediate; kind: scenario; ref: https://typescript-eslint.io/rules/no-misused-promises/ -->
Observe: results saved after the loop are incomplete; errors are unhandled.

Hypothesise: `forEach` ignores callback return values, and a callback typed `(x) => void` accepts an async function because a function returning `Promise<void>` is assignable to one returning `void`.

Verify: hover over the callback; the promise is dropped silently.

Fix: use `for...of` with `await` for sequential work, or `Promise.all(items.map(async ...))` for parallel work.

```ts
await Promise.all(items.map(async (item) => { await save(item); }));

for (const item of items) { await save(item); }
```

Turn on typescript-eslint rules `no-floating-promises` and `no-misused-promises` (they need type-aware linting) to flag promises passed where `void` is expected.

Prevent: enforce those rules in CI; they catch an entire class of async bugs the compiler allows.

Common wrong answer: assuming the compiler would reject it; `void`-returning callback assignability is intentional.

### How do you deprecate a field in a shared type and make sure types do not regress in a library?
<!-- level: advanced; kind: scenario; ref: https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html -->
Observe: many consumers use `options.timeout`; you want to rename it to `timeoutMs` without breaking them or silently changing public types.

Hypothesise: public types are an API; changes should be visible, gradual, and tested.

Verify: search known consumers, and inspect the emitted `.d.ts` diff between versions.

Fix: support both for a release, mark the old field with a JSDoc `@deprecated` tag (editors strike it through), and make the types express the allowed combinations.

```ts
interface Options {
  /** @deprecated Use `timeoutMs`. Removed in v3. */
  timeout?: number;
  timeoutMs?: number;
}
```

Handle both at runtime with a clear precedence. Then add type tests so future edits cannot break inference, for example with `tsd` or Vitest's `expectTypeOf`, and use `// @ts-expect-error` for calls that must fail. Run API Extractor or compare `.d.ts` snapshots in CI to review public surface changes.

Prevent: follow semver strictly, since tightening a type is a breaking change for consumers.

Common wrong answer: removing the field in a minor release because "it was only a type".

