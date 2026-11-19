## 1. Values, Variables and Types

### What JavaScript is
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript -->
JavaScript is a dynamically typed, garbage-collected, multi-paradigm language standardised as ECMAScript (ECMA-262). A new edition ships every June (ES2015, ES2016 … ES2025), so "modern JavaScript" means the yearly additions rather than one big release.

The language itself is small: values, objects, functions, promises and a handful of built-ins. Everything else comes from the host environment. In a browser the host adds the DOM, `fetch`, timers and storage; in Node.js it adds the file system, networking and processes. Knowing which layer a feature belongs to helps you read documentation correctly — `setTimeout` is not part of ECMAScript, it is a host API.

Under the hood an engine (V8 in Chrome and Node, SpiderMonkey in Firefox, JavaScriptCore in Safari) parses your source, runs it in an interpreter, and hot functions are compiled to optimised machine code by a JIT compiler based on observed types. That is why code that keeps types consistent tends to run faster.

```js
// Pure language feature: works in every engine
const total = [3, 4, 5].reduce((sum, n) => sum + n, 0);

// Host feature: exists in browsers and Node 18+, not in ECMAScript
const res = await fetch('https://example.com/api/items');
```

#### Interview tip
- Be able to name the parts: engine (executes code), host/runtime (provides APIs), and event loop (schedules callbacks). Many "JavaScript" questions are really about one of these layers.

### let, const and var
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/let -->
Variables are named bindings to values. Modern code uses `const` for bindings that never get reassigned and `let` for ones that do; `var` is legacy.

The differences are about scope and initialisation:

- `var` is scoped to the enclosing function (or the script), is hoisted and initialised to `undefined`, can be redeclared, and at the top level creates a property on the global object.
- `let` and `const` are scoped to the nearest block `{ }`. They are hoisted too, but stay uninitialised until the declaration line runs; touching them earlier throws a `ReferenceError` (the temporal dead zone).
- `const` prevents reassignment of the binding, not mutation of the value it points to.

```js
const user = { name: 'Asha' };
user.name = 'Ravi';     // fine: the object is mutable
// user = {};           // TypeError: assignment to constant variable

for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i)); // 0 1 2 — a fresh i per iteration
}
for (var j = 0; j < 3; j++) {
  setTimeout(() => console.log(j)); // 3 3 3 — one shared j
}
```

#### Pitfalls
- Assuming `const` makes data immutable — use `Object.freeze` or immutable patterns for that.
- Using `var` in loops with async callbacks, which captures one shared variable.

### Primitive types
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures -->
JavaScript has seven primitive types: `string`, `number`, `bigint`, `boolean`, `undefined`, `symbol` and `null`. Everything else is an object (including arrays and functions).

Primitives are immutable and compared by value. When you call a method on one, such as `'abc'.toUpperCase()`, the engine briefly wraps it in a wrapper object (`String`, `Number`, …) to look up the method, then discards the wrapper. You never modify the original primitive — string methods always return new strings.

`undefined` means "no value was assigned" and is what the language produces by default (missing properties, missing arguments, functions without `return`). `null` is an explicit "intentionally empty" that you assign yourself.

```js
let s = 'hello';
s[0] = 'H';           // silently ignored (TypeError in strict mode)
console.log(s);       // 'hello'

typeof null;          // 'object'  — a historic bug kept for compatibility
typeof undefined;     // 'undefined'
typeof 10n;           // 'bigint'
typeof Symbol('id');  // 'symbol'

function greet(name) { return name; }
greet();              // undefined
```

#### Pitfalls
- Checking for null with `typeof x === 'object'` — it is also true for `null`. Use `x === null`.
- Creating wrapper objects with `new String('a')`; they are objects, so `new String('a') === 'a'` is false.

### Objects and references
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Working_with_objects -->
An object is a collection of properties (string or symbol keys mapped to values) plus a link to a prototype. Arrays, functions, dates, maps and class instances are all objects.

Variables never hold an object directly — they hold a reference to it. Assigning or passing an object copies the reference, so two variables can point at the same object, and mutating through one is visible through the other. Equality between objects (`===`) compares identity, not contents.

```js
const a = { count: 1 };
const b = a;           // same object
b.count = 2;
console.log(a.count);  // 2

console.log({ x: 1 } === { x: 1 }); // false: different objects

// Copies
const shallow = { ...a };            // nested objects still shared
const deep = structuredClone({ list: [1, 2] }); // independent copy

function rename(user) {
  user.name = 'changed'; // mutates caller's object
  user = { name: 'new' }; // rebinding local param does NOT affect caller
}
```

JavaScript is always pass-by-value; the value being passed for objects just happens to be a reference ("call by sharing").

#### Interview tip
- Explain the difference between shallow and deep copies, and mention that `structuredClone` cannot copy functions, DOM nodes or class prototypes.

### Numbers and BigInt
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt -->
The `number` type is a 64-bit IEEE 754 double. It represents integers exactly only up to `Number.MAX_SAFE_INTEGER` (2^53 − 1); beyond that, adjacent integers collapse together. Decimal fractions like 0.1 cannot be represented exactly in binary, which causes the famous rounding errors.

Special values include `NaN` (the result of invalid maths, and the only value not equal to itself), `Infinity`, and `-0`.

`bigint` (ES2020) stores arbitrary-precision integers, written with an `n` suffix. You cannot mix bigint and number in arithmetic without explicit conversion, and `Math` functions do not accept bigints.

```js
0.1 + 0.2;                       // 0.30000000000000004
Math.abs(0.1 + 0.2 - 0.3) < Number.EPSILON; // true

9007199254740993 === 9007199254740992; // true! precision lost
9007199254740993n + 1n;          // 9007199254740994n

Number.isNaN(NaN);   // true (isNaN('abc') is also true — avoid global isNaN)
Number.parseInt('42px', 10); // 42
Number('42px');      // NaN

// Money: store integer cents, not floating-point rupees
const priceInPaise = 129_99; // numeric separators (ES2021)
```

#### Pitfalls
- Parsing 64-bit IDs from JSON as numbers silently corrupts them — keep them as strings.
- Using floating point for currency; use integer minor units or a decimal library.

### Strings and template literals
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals -->
Strings are immutable sequences of UTF-16 code units. Characters outside the Basic Multilingual Plane (most emoji) take two code units, so `length` and index access can split them. Iterating with `for...of` or spreading into an array walks code points instead.

Template literals use backticks and support interpolation with `${}`, multi-line text, and tagged templates. A tag is a function that receives the literal string parts and the interpolated values separately — useful for safe HTML escaping, SQL builders and i18n.

```js
const name = 'Asha';
const msg = `Hello, ${name}!
You have ${3 * 2} new messages.`;

'😀'.length;        // 2 (two UTF-16 code units)
[...'😀'].length;   // 1 (one code point)

function html(strings, ...values) {
  const escape = (v) => String(v).replace(/[&<>"']/g,
    (c) => `&#${c.charCodeAt(0)};`);
  return strings.reduce((out, s, i) =>
    out + s + (i < values.length ? escape(values[i]) : ''), '');
}
html`<p>${'<script>'}</p>`; // '<p>&#60;script&#62;</p>'
```

Useful modern methods: `includes`, `startsWith`, `padStart`, `trimEnd`, `replaceAll` (ES2021), `at(-1)` (ES2022), and `isWellFormed` (ES2024) for detecting lone surrogates.

#### Pitfalls
- Truncating user text with `slice` can cut an emoji in half; use `Intl.Segmenter` for user-perceived characters.

### Symbols
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol -->
A symbol is a unique, immutable primitive mostly used as a property key that cannot clash with any other key. `Symbol('desc')` always creates a new symbol; the description is only for debugging. `Symbol.for('key')` returns a shared symbol from a global registry, the same across modules and realms.

Symbol-keyed properties are skipped by `for...in`, `Object.keys` and `JSON.stringify`, which makes them handy for attaching metadata to objects you do not own without polluting their visible shape.

The most important use is well-known symbols: hooks the language calls to customise behaviour. `Symbol.iterator` makes an object iterable, `Symbol.asyncIterator` makes it async-iterable, `Symbol.toPrimitive` controls conversion, and `Symbol.dispose` supports explicit resource management in newer runtimes.

```js
const id = Symbol('id');
const user = { name: 'Asha', [id]: 42 };
Object.keys(user);       // ['name']
JSON.stringify(user);    // '{"name":"Asha"}'
user[id];                // 42

class Money {
  constructor(paise) { this.paise = paise; }
  [Symbol.toPrimitive](hint) {
    return hint === 'string' ? `₹${this.paise / 100}` : this.paise;
  }
}
const m = new Money(1050);
`${m}`;   // '₹10.5'
m + 50;   // 1100
```

#### Interview tip
- Symbols are not truly private — `Object.getOwnPropertySymbols` reveals them. For real privacy use `#private` class fields.

## 2. Operators, Coercion and Equality

### Type coercion
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Glossary/Type_coercion -->
Coercion is the automatic conversion of a value from one type to another when an operator expects a different type. Understanding the rules explains most "JavaScript is weird" examples.

The core abstract operations are ToPrimitive, ToNumber, ToString and ToBoolean. For objects, ToPrimitive first tries `Symbol.toPrimitive`, then `valueOf`, then `toString` (the order flips when a string is preferred).

- The `+` operator: if either operand becomes a string after ToPrimitive, it concatenates; otherwise it adds numbers.
- Other arithmetic operators (`-`, `*`, `/`) always convert to numbers.
- Relational operators (`<`, `>`) compare strings lexicographically if both are strings, otherwise numerically.

```js
'5' + 1;        // '51'   (string wins)
'5' - 1;        // 4      (numeric only)
[] + [];        // ''     ([] -> '')
[] + {};        // '[object Object]'
true + 1;       // 2
'10' < '9';     // true  (string comparison!)
10 < 9;         // false
Number('');     // 0
Number(' 12 '); // 12
Number(null);   // 0
Number(undefined); // NaN
```

Explicit conversion is clearer: `Number(x)`, `String(x)`, `Boolean(x)`, or `parseInt(x, 10)` when you want to stop at the first non-digit.

#### Pitfalls
- Values read from inputs, query strings and environment variables are strings; `'2' + 1` silently produces `'21'`.
- Sorting numbers with the default `sort()` compares them as strings.

### Truthy and falsy
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Glossary/Truthy -->
Whenever a value is used in a boolean context — `if`, `while`, `&&`, `||`, `!`, the ternary — it is converted with ToBoolean. Only a short list of values is falsy: `false`, `0`, `-0`, `0n`, `''`, `null`, `undefined` and `NaN`. Everything else is truthy, including `'0'`, `'false'`, `[]` and `{}`.

The logical operators do not return booleans; they return one of their operands. `a || b` returns `a` if it is truthy, otherwise `b`. `a && b` returns `a` if it is falsy, otherwise `b`. This short-circuiting is used for defaults and guards, but it treats valid values like `0` and `''` as missing.

```js
const items = [];
if (items) console.log('runs: an empty array is truthy');
if (items.length) console.log('does not run');

const port = config.port || 3000;   // bug if port is 0
const port2 = config.port ?? 3000;  // only null/undefined fall back

user && user.logout();              // guard (prefer user?.logout())

// Logical assignment (ES2021)
options.retries ??= 3;
cache.hits ||= 0;
```

#### Pitfalls
- `if (count)` skips the legitimate value 0.
- `!!value` is a common idiom to coerce to a real boolean; `Boolean(value)` reads more clearly.

### Equality: ==, === and Object.is
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness -->
JavaScript has three equality algorithms:

- Strict equality `===` — no conversion; different types are never equal. `NaN === NaN` is false and `+0 === -0` is true.
- Loose equality `==` — converts operands first using a set of rules (null and undefined equal only each other; booleans become numbers; objects become primitives).
- SameValue `Object.is` — like `===` but treats `NaN` as equal to itself and distinguishes `+0` from `-0`.

There is also SameValueZero, used by `includes`, `Map` and `Set`: like `Object.is` but `+0` and `-0` are equal. That is why `[NaN].includes(NaN)` is true while `[NaN].indexOf(NaN)` is -1.

```js
0 == '';            // true
'0' == false;       // true
null == 0;          // false (null only loosely equals undefined)
null == undefined;  // true

Object.is(NaN, NaN); // true
Object.is(0, -0);    // false
[NaN].indexOf(NaN);  // -1  (uses ===)
[NaN].includes(NaN); // true (SameValueZero)

// The one idiomatic use of ==
if (value == null) { /* null or undefined */ }
```

#### Interview tip
- Default to `===`. Mention `x == null` as the accepted exception and explain why `indexOf` and `includes` disagree on NaN.

### Optional chaining and nullish coalescing
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining -->
Optional chaining `?.` (ES2020) stops evaluating an expression and returns `undefined` as soon as the value on its left is `null` or `undefined`. It works for property access `a?.b`, computed access `a?.[key]`, and calls `fn?.()`. The short-circuit covers the rest of the chain, so `a?.b.c.d` does not throw if `a` is null.

Nullish coalescing `??` returns the right-hand side only when the left is `null` or `undefined`, unlike `||` which also replaces `0`, `''` and `false`. The assignment form `??=` (ES2021) assigns only when the target is nullish.

```js
const city = order?.customer?.address?.city ?? 'Unknown';

const limit = query.limit ?? 20;     // keeps 0 if explicitly passed
const name = input.name || 'Anon';   // replaces '' too — sometimes desired

callbacks.onDone?.(result);          // call only if provided

settings.theme ??= 'light';

// Mixing ?? with || or && requires parentheses
const v = (a || b) ?? c;
```

#### Pitfalls
- Overusing `?.` can hide bugs: if a value should always exist, let it fail loudly rather than silently propagating `undefined`.
- `?.` does not protect against the property being a non-function when you call it: `obj.fn?.()` still throws if `fn` is a string.

### typeof, instanceof and type checks
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof -->
`typeof` returns a string describing a value's type: `'undefined'`, `'boolean'`, `'number'`, `'bigint'`, `'string'`, `'symbol'`, `'function'` or `'object'`. It is safe on undeclared variables (returns `'undefined'`), but it reports `'object'` for null, arrays, dates and plain objects.

`instanceof` checks whether a constructor's `prototype` appears in an object's prototype chain. It fails across realms (an array from an iframe is not `instanceof Array` in the parent) and can be customised with `Symbol.hasInstance`.

For reliable checks prefer purpose-built helpers.

```js
typeof [];                  // 'object'
Array.isArray([]);          // true — works across realms
typeof null;                // 'object'
value === null;             // correct null check

Number.isInteger(5.0);      // true
Number.isFinite('5');       // false (no coercion)

class ApiError extends Error {}
const e = new ApiError('x');
e instanceof ApiError;      // true
e instanceof Error;         // true

Object.prototype.toString.call(new Date()); // '[object Date]'

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
```

#### Interview tip
- For untrusted input, check shape rather than class: `typeof x.id === 'string'`, or use a schema validator at boundaries.

### Destructuring
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment -->
Destructuring unpacks values from arrays (by position) or objects (by property name) into variables. It supports defaults, renaming, nesting and rest elements, and works in variable declarations, assignments and function parameters.

Array destructuring uses the iterable protocol, so it works with any iterable (strings, maps, generators). Object destructuring reads properties, including inherited ones. Defaults apply only when the value is `undefined`, not `null`.

```js
const [first, , third = 'none', ...others] = ['a', 'b', undefined, 'd', 'e'];
// first 'a', third 'none', others ['d', 'e']

const { id, name: fullName, address: { city } = {}, ...rest } = user;

// Swap without a temp variable
let x = 1, y = 2;
[x, y] = [y, x];

// Named options with defaults
function connect({ host = 'localhost', port = 5432, ssl = false } = {}) {
  return `${host}:${port} ssl=${ssl}`;
}
connect({ port: 6543 });

for (const [key, value] of Object.entries(config)) {
  console.log(key, value);
}
```

#### Pitfalls
- Destructuring `null` or `undefined` throws a TypeError; give parameters a `= {}` default.
- An assignment statement starting with `{` needs parentheses: `({ a, b } = obj);`.

### Spread and rest syntax
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax -->
The same `...` token means two opposite things depending on position.

- Spread expands an iterable or object into individual elements: in array literals `[...a, ...b]`, in calls `fn(...args)`, and in object literals `{ ...defaults, ...overrides }`.
- Rest collects remaining items into one array or object: in parameters `function f(...args)` and in destructuring patterns.

Object spread copies own enumerable properties (including symbols) into a new object, later keys winning. It does not copy getters as getters (they are evaluated), and it does not copy the prototype. All copies are shallow.

```js
const defaults = { retries: 3, timeout: 5000 };
const options = { ...defaults, timeout: 10000 }; // override

const merged = [...new Set([...listA, ...listB])]; // dedupe

Math.max(...[4, 9, 2]); // 9

function log(level, ...messages) {
  console[level](...messages);
}

// Immutable update of nested state
const next = {
  ...state,
  user: { ...state.user, name: 'Ravi' },
};
```

#### Pitfalls
- Spreading huge arrays into a function call can exceed the engine's argument limit (stack overflow) — use `reduce` or a loop.
- Nested objects remain shared after spreading; mutating `next.user.address` changes the original.
