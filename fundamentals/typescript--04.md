## 8. Utility Types

### Object-shaping utility types
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/utility-types.html -->
TypeScript ships global utility types that transform object types. They are implemented with mapped and conditional types, so learning them also teaches type-level patterns.

- `Partial<T>` makes every property optional — update payloads, patch requests, builder defaults.
- `Required<T>` removes optionality — resolved configuration after defaults are applied.
- `Readonly<T>` marks properties readonly — frozen config, props.
- `Pick<T, K>` keeps the listed keys; `Omit<T, K>` removes them — deriving DTOs and view models from a domain type.
- `Record<K, V>` builds an object type from a key union and a value type.

Deriving types from one source of truth means a change to the base type flows to all derived types automatically, instead of drifting duplicates.

```ts
interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
}

type PublicUser = Omit<User, 'passwordHash'>;
type CreateUserInput = Pick<User, 'email' | 'name'> & { password: string };
type UpdateUserInput = Partial<Pick<User, 'email' | 'name'>>;

interface Options { retries?: number; timeoutMs?: number; baseUrl?: string }
const defaults: Required<Options> = { retries: 3, timeoutMs: 5000, baseUrl: '/' };
function resolve(opts: Options): Required<Options> {
  return { ...defaults, ...opts };
}

type Permissions = Record<'read' | 'write' | 'admin', boolean>;
```

#### Pitfalls
- `Omit` is not checked: `Omit<User, 'pasword'>` silently omits nothing. A stricter helper, `type StrictOmit<T, K extends keyof T> = Omit<T, K>`, catches typos.
- `Partial` is shallow; nested objects stay fully required.
- In `resolve`, spreading an `opts` that contains `retries: undefined` overrides the default with `undefined` — `exactOptionalPropertyTypes` helps detect this.

### Union-filtering utility types
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/utility-types.html#excludeuniontype-excludedmembers -->
Three utilities filter union types using distributive conditional types:

- `Exclude<T, U>` removes members of `T` assignable to `U`.
- `Extract<T, U>` keeps only members of `T` assignable to `U`.
- `NonNullable<T>` removes `null` and `undefined` (implemented today as `T & {}`).

They are especially useful with discriminated unions: `Extract<Event, { type: 'click' }>` pulls out one member by its tag, which you can use to type handlers precisely.

Note the difference from `Omit`: `Exclude` works on union members (values of a type), `Omit` works on object keys.

```ts
type Status = 'draft' | 'published' | 'archived' | 'deleted';
type VisibleStatus = Exclude<Status, 'deleted'>;    // 'draft' | 'published' | 'archived'

type AppEvent =
  | { type: 'click'; x: number; y: number }
  | { type: 'keypress'; key: string }
  | { type: 'scroll'; offset: number };

type ClickEvent = Extract<AppEvent, { type: 'click' }>;

type HandlerMap = {
  [T in AppEvent['type']]: (event: Extract<AppEvent, { type: T }>) => void;
};

const handlers: HandlerMap = {
  click: (e) => console.log(e.x, e.y),
  keypress: (e) => console.log(e.key),
  scroll: (e) => console.log(e.offset),
};

type MaybeUser = User | null | undefined;
type DefinitelyUser = NonNullable<MaybeUser>;       // User
```

#### Interview tip
- Explain why `Exclude` works: it is distributive, so each member is tested individually and failures become `never`, which vanishes from a union.

### Function and class utility types
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/utility-types.html#returntypetype -->
These utilities extract types from functions, classes and promises using `infer`:

- `ReturnType<F>` and `Parameters<F>` (a tuple of parameter types).
- `ConstructorParameters<C>` and `InstanceType<C>` for classes.
- `Awaited<T>` recursively unwraps promises and thenables, matching what `await` does. It is used by `Promise.all`'s typings.
- `ThisParameterType<F>` and `OmitThisParameter<F>` for functions with typed `this`.

They let you type wrappers around third-party functions without restating their signatures, so wrappers stay correct when the library changes.

```ts
async function fetchInvoice(id: string, opts?: { includeLines: boolean }) {
  return { id, total: 1200, lines: [] as { sku: string }[] };
}

type Invoice = Awaited<ReturnType<typeof fetchInvoice>>;
type FetchArgs = Parameters<typeof fetchInvoice>;   // [id: string, opts?: {...}]

function withRetry<F extends (...args: any[]) => Promise<unknown>>(fn: F, retries = 3) {
  return async (...args: Parameters<F>): Promise<Awaited<ReturnType<F>>> => {
    for (let i = 0; ; i++) {
      try {
        return (await fn(...args)) as Awaited<ReturnType<F>>;
      } catch (err) {
        if (i >= retries) throw err;
      }
    }
  };
}

const safeFetchInvoice = withRetry(fetchInvoice);   // same parameters and result

class HttpClient { constructor(public baseUrl: string, public timeout = 5000) {} }
type ClientArgs = ConstructorParameters<typeof HttpClient>;   // [baseUrl: string, timeout?: number]
type Client = InstanceType<typeof HttpClient>;
```

#### Pitfalls
- For overloaded functions, `ReturnType` and `Parameters` use the last overload only.

### Writing your own utility types
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/2/types-from-types.html -->
Once you understand mapped, conditional, indexed and template literal types, you can build project-specific utilities. Common ones:

- `DeepPartial<T>` — recursive optional, for nested config overrides.
- `RequireKeys<T, K>` — make only some properties required.
- `ValueOf<T>` — union of property value types.
- `Prettify<T>` — flattens intersections into one object for readable hover output.
- `Paths<T>` — dotted paths into a nested object, for typed i18n keys or form field names.

Keep custom utilities few, documented and tested. Overly clever types slow the compiler, produce baffling error messages, and are hard for teammates to maintain. If a runtime library (like a schema validator) can infer the type for you, that is usually better than a hand-written type puzzle.

```ts
type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

type RequireKeys<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

type ValueOf<T> = T[keyof T];

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type Paths<T> = T extends object
  ? { [K in keyof T & string]: T[K] extends object ? K | `${K}.${Paths<T[K]>}` : K }[keyof T & string]
  : never;

const messages = {
  auth: { login: 'Log in', logout: 'Log out' },
  cart: { empty: 'Your cart is empty' },
};
type MessageKey = Paths<typeof messages>;
// 'auth' | 'auth.login' | 'auth.logout' | 'cart' | 'cart.empty'

declare function t(key: MessageKey): string;
t('cart.empty');
```

#### Interview tip
- Show judgement: say when you would not write a complex type, as well as how you would.

## 9. Modules and Declaration Files

### Modules and type-only imports
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/2/modules.html -->
TypeScript uses ES module syntax. Any file with a top-level `import` or `export` is a module with its own scope; a file without them is a global script whose declarations leak into the global scope (add `export {}` to force module mode).

Types and values share import syntax, but types disappear at compile time. If an import is only used as a type, the compiler or bundler should remove it. `import type { X }` and inline `import { type X }` make that explicit.

`verbatimModuleSyntax` (TypeScript 5.0) is the modern, simple rule: imports and exports without `type` are kept exactly as written; those with `type` are dropped. It replaces the older `importsNotUsedAsValues` and `preserveValueImports` flags and keeps behaviour predictable for single-file transpilers. Under it, CommonJS output requires `import x = require()` syntax for CJS-style imports.

```ts
// user.ts
export interface User { id: string; name: string }
export function createUser(name: string): User {
  return { id: crypto.randomUUID(), name };
}

// service.ts
import { createUser, type User } from './user.js';
import type { Request, Response } from 'express';

export type { User };                       // re-export type only

export function handler(req: Request, res: Response) {
  const user: User = createUser(String(req.query.name));
  res.json(user);
}
```

#### Pitfalls
- With `module: nodenext`, relative imports in ESM need the `.js` extension (the emitted file name), even though the source is `.ts` — or enable `rewriteRelativeImportExtensions` (TS 5.7) and write `.ts`.
- Importing a type without `type` under `verbatimModuleSyntax` keeps a runtime import, which can fail or create cycles.

### Module resolution settings
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/modules/reference.html -->
Module resolution decides which file an import specifier refers to. TypeScript must model the resolver of the runtime or bundler you actually use, or it will type-check against files that will not be loaded.

The key compiler options:

- `module: nodenext` (or `node16`/`node18`): for code run directly by Node.js. Respects `package.json` `"type"`, `exports` and `imports`, requires file extensions in ESM relative imports, and models ESM/CJS interop rules. `moduleResolution` follows automatically.
- `module: preserve` with `moduleResolution: bundler`: for code processed by Vite, webpack, esbuild and similar. Supports `exports` maps but allows extensionless imports.
- Legacy `moduleResolution: node10` (formerly `node`): ignores `exports`; avoid for new projects.

`paths` in tsconfig only affects type-checking; your runtime or bundler needs matching configuration (or use package.json `imports` with `#` specifiers, understood by both Node and TypeScript).

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "es2023",
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

```json
{
  "name": "orders-api",
  "type": "module",
  "imports": {
    "#db/*": "./dist/db/*.js"
  }
}
```

```ts
import { pool } from '#db/pool.js';      // resolved by Node and TypeScript alike
```

#### Interview tip
- When a library's types work in one project but not another, check `moduleResolution`: a `bundler` or `nodenext` setting reads `exports` conditions (`types`, `import`, `require`) that `node10` ignores.

### Declaration files
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html -->
A declaration file (`.d.ts`) contains only types — no implementations. It describes the shape of JavaScript code so TypeScript can check usage of it. Declaration files come from three places:

1. Generated by `tsc` with `declaration: true` when you publish a TypeScript library, so consumers get types alongside `.js` output.
2. Bundled with JavaScript libraries by their authors and referenced via the `types` field or `exports` conditions in `package.json`.
3. Written by hand for untyped code, legacy scripts, or assets.

Inside `.d.ts` files you use `declare` for values (`declare function`, `declare const`, `declare class`) and plain `interface`/`type` for types. `isolatedDeclarations` (TS 5.5) requires explicit types on exports so declaration files can be generated per file by fast tools.

```ts
// legacy-analytics.d.ts — types for an untyped script loaded via <script>
declare namespace Analytics {
  interface EventProps { [key: string]: string | number | boolean }
}
declare const analytics: {
  track(event: string, props?: Analytics.EventProps): void;
  identify(userId: string): void;
};

// assets.d.ts — let TypeScript understand bundler imports
declare module '*.svg' {
  const url: string;
  export default url;
}
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

// untyped-lib.d.ts — minimal types for a dependency without any
declare module 'tiny-slugify' {
  export default function slugify(input: string, sep?: string): string;
}
```

#### Pitfalls
- `skipLibCheck: true` speeds builds by not checking `.d.ts` files, but can hide conflicting type definitions between packages.

### Using @types and DefinitelyTyped
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/declaration-files/consumption.html -->
Many JavaScript packages do not include their own types. The community repository DefinitelyTyped publishes them as separate npm packages under the `@types` scope, such as `@types/node` or `@types/express`.

How TypeScript finds them: when you import `express`, it looks first for types shipped by the package itself (`types`/`typings` field or `exports` `types` condition), then for `node_modules/@types/express`. Global type packages (like `@types/node` or test framework globals) are included automatically from `@types` unless you restrict them with the `types` compiler option. TypeScript 6.0 changes the default so that `types` is an empty list — check release notes when upgrading and list global type packages explicitly.

Install type packages as dev dependencies. Their major and minor versions are meant to track the library's version, so keep them aligned.

```bash
npm install express
npm install --save-dev @types/express @types/node
```

```json
{
  "compilerOptions": {
    "types": ["node", "vitest/globals"]
  }
}
```

```ts
import express from 'express';
const app = express();
app.get('/health', (req, res) => {
  res.json({ ok: true });       // req and res fully typed from @types/express
});
```

#### Pitfalls
- Installing `@types/x` for a package that already ships types can cause duplicate or conflicting declarations — check the package first.
- Mismatched versions (`express@5` with `@types/express@4`) cause confusing errors about missing or wrong members.

### Declaration merging and module augmentation
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/declaration-merging.html -->
Declaration merging combines multiple declarations with the same name into one definition. Interfaces merge their members; namespaces merge with classes, functions and enums to add static members; and modules can be augmented from outside.

Module augmentation lets you add to types declared in another module — for example, adding a `user` property to Express's `Request`, or custom fields to a library's config interface. You write `declare module 'library-name' { ... }` inside a file that is itself a module (has an import or export), and redeclare the interface you want to extend.

Global augmentation uses `declare global { ... }` to extend global interfaces like `Window` or `globalThis`.

You can only add new members or overloads; you cannot change existing property types, and you cannot augment type aliases.

```ts
// types/express.d.ts
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; roles: string[] };
    requestId: string;
  }
}

// types/env.d.ts
export {};
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL: string;
      NODE_ENV: 'development' | 'production' | 'test';
    }
  }
}

// Now typed everywhere
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});
```

#### Pitfalls
- Augmentations only apply if the file is included in compilation; if your types do not show up, check `include` and `typeRoots`.
- Typing `process.env` keys as required strings is a promise, not a check; validate them at startup.

### Ambient declarations and global types
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/declaration-files/templates/global-d-ts.html -->
An ambient declaration tells the compiler something exists at runtime without providing it: `declare const __APP_VERSION__: string` for a constant injected by a bundler, `declare function gtag(...args: unknown[]): void` for a script loaded via a tag.

Files without imports or exports are global scripts. Declarations in such `.d.ts` files become globally visible. Once you add an import (for example to reference a type from a package), the file becomes a module and its declarations are local — you must then wrap global ones in `declare global`.

Triple-slash directives (`/// <reference types="vite/client" />`) pull in other declaration files; they are mostly used in `.d.ts` files and generated environment types.

`globalThis` augmentation uses `var` inside `declare global` so the property exists on the global object type.

```ts
// globals.d.ts (no imports: global script)
declare const __APP_VERSION__: string;
declare function gtag(command: 'event', name: string, params?: Record<string, unknown>): void;

// vite-env.d.ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

// metrics.d.ts (a module because of the import)
import type { Counter } from 'prom-client';
declare global {
  var requestCounter: Counter<string> | undefined;
}
export {};
```

#### Pitfalls
- Overusing globals hides dependencies; prefer explicit imports, and keep ambient declarations for things the runtime truly provides.

## 10. Configuration and Strictness

### tsconfig.json essentials
<!-- level: basic; ref: https://www.typescriptlang.org/docs/handbook/tsconfig-json.html -->
`tsconfig.json` marks a TypeScript project root and configures the compiler. Its main parts:

- `include`, `exclude`, `files`: which source files belong to the project.
- `compilerOptions`: how to check and emit.
- `extends`: inherit from a base config, including shared community bases like `@tsconfig/node22` or `@tsconfig/strictest`.
- `references`: link to other projects for monorepos.

Important options:

- `target`: which JavaScript version to emit (downlevels newer syntax). Choose based on your runtime.
- `lib`: which built-in API types exist (`ES2023`, `DOM`). Defaults follow `target`.
- `module` / `moduleResolution`: how imports are emitted and resolved.
- `strict`: enables the strict family of checks.
- `outDir`, `rootDir`, `declaration`, `sourceMap`: output layout.
- `noEmit`: check only, when a bundler emits.
- `skipLibCheck`: skip checking `.d.ts` files.

```json
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts"]
}
```

#### Pitfalls
- Setting `target` lower than needed bloats output; setting `lib` to include `DOM` in a Node project lets you use `window` without errors.
- `tsc file.ts` with a file argument ignores `tsconfig.json` entirely.

### The strict family
<!-- level: intermediate; ref: https://www.typescriptlang.org/docs/handbook/compiler-options.html -->
`strict: true` turns on a set of checks; new strict flags added in future versions are included automatically. The main members:

- `noImplicitAny`: error when a type cannot be inferred and would fall back to `any`.
- `strictNullChecks`: `null` and `undefined` are separate types, not members of every type. The single most valuable flag.
- `strictFunctionTypes`: function parameters are checked contravariantly.
- `strictBindCallApply`: typed `bind`, `call` and `apply`.
- `strictPropertyInitialization`: class fields must be initialised.
- `noImplicitThis`: `this` must have a known type.
- `useUnknownInCatchVariables`: `catch (e)` gives `e: unknown` instead of `any`.
- `alwaysStrict`: emit `'use strict'`.
- `strictBuiltinIteratorReturn` (5.6): built-in iterators' return type is `undefined` rather than `any`.

New projects should always start with `strict: true`. TypeScript 6.0 makes `strict` the default.

```ts
function find(users: User[], id: string) {
  return users.find((u) => u.id === id);  // User | undefined
}

const u = find(list, '1');
// u.name;                                 // error with strictNullChecks
console.log(u?.name ?? 'unknown');

try {
  riskyOperation();
} catch (e) {
  // e.message;                            // error: e is unknown
  const message = e instanceof Error ? e.message : String(e);
  log(message);
}
```

#### Interview tip
- When migrating a legacy codebase, enable flags one at a time, starting with `noImplicitAny` and `strictNullChecks`, and use per-directory configs or `// @ts-expect-error` budgets to make progress incrementally.

### Extra-strict options
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/compiler-options.html -->
Beyond `strict`, several flags catch real bugs and are worth enabling in new codebases:

- `noUncheckedIndexedAccess`: indexing arrays and index signatures includes `| undefined`. Catches out-of-bounds reads and missing dictionary keys, at the cost of more checks.
- `exactOptionalPropertyTypes`: `prop?: string` means "absent or string" — explicitly assigning `undefined` is an error unless the type includes it. Distinguishes "not provided" from "provided as undefined", which matters for PATCH payloads and object spreads.
- `noImplicitReturns`: every code path in a function with a return type must return.
- `noFallthroughCasesInSwitch`: non-empty cases must `break` or `return`.
- `noImplicitOverride`: requires `override` on overriding methods.
- `noPropertyAccessFromIndexSignature`: forces `obj['key']` for index-signature keys, making dynamic access visible.
- `noUnusedLocals` / `noUnusedParameters`: often left to a linter instead.

```ts
// noUncheckedIndexedAccess
const parts = 'a,b'.split(',');
const third = parts[2];             // string | undefined
console.log(third?.toUpperCase());

for (const p of parts) p.toUpperCase();   // for...of is not affected

// exactOptionalPropertyTypes
interface Patch { nickname?: string }
const patch: Patch = {};
// patch.nickname = undefined;     // error: use delete or add | undefined
interface PatchExplicit { nickname?: string | undefined }
```

#### Pitfalls
- Turning these on in a large existing codebase produces thousands of errors; enable them gradually or only for new packages.

### Project references and build performance
<!-- level: advanced; ref: https://www.typescriptlang.org/docs/handbook/project-references.html -->
Project references split a large codebase into smaller TypeScript projects that depend on each other. Each referenced project has `composite: true`, produces declaration files, and is built with `tsc --build` (`tsc -b`), which builds projects in dependency order and skips those that are up to date.

Benefits: faster incremental builds, enforced boundaries (a project can only import from projects it references), and better editor performance because the language service loads declaration outputs instead of all source files.

Other performance tools:

- `incremental: true` stores a `.tsbuildinfo` file so subsequent builds only recheck what changed.
- `tsc --extendedDiagnostics` and `--generateTrace` show where checking time goes.
- `skipLibCheck` avoids rechecking dependency declaration files.
- Explicit return types on exported functions and interfaces over large intersections reduce checker work.
- The native TypeScript compiler port (TypeScript 7, written in Go, previewed as `tsgo`) aims for roughly 10x faster builds; check its status before adopting.

```json
{
  "files": [],
  "references": [
    { "path": "./packages/shared" },
    { "path": "./packages/api" },
    { "path": "./packages/web" }
  ]
}
```

```json
{
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "references": [{ "path": "../shared" }]
}
```

```bash
npx tsc --build --verbose
```

#### Interview tip
- Mention that monorepo tools (Nx, Turborepo) and package managers' workspaces complement project references; they handle task caching, while references handle type-level boundaries.
