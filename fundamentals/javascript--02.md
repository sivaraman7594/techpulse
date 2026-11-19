## 3. Functions and Scope

### Declarations, expressions and arrow functions
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Functions -->
Functions are first-class objects: you can store them in variables, pass them as arguments, return them and attach properties to them. There are several ways to create one, and they behave differently.

- Function declarations (`function add() {}`) are fully hoisted, so you can call them before the line where they appear.
- Function expressions (`const add = function () {}`) are created when the line runs.
- Arrow functions (`const add = () => {}`) are concise and have no own `this`, `arguments`, `super` or `new.target`; they take these from the surrounding scope. They cannot be used as constructors.
- Methods in object literals and classes (`save() {}`) have access to `super` and are not constructible.

```js
console.log(square(4)); // 16 — declaration is hoisted
function square(n) { return n * n; }

const cube = (n) => n ** 3;
const toObj = (id) => ({ id }); // parentheses to return an object literal

const counter = {
  count: 0,
  start() {
    setInterval(() => {
      this.count++;           // arrow uses start()'s this
    }, 1000);
  },
};
```

#### Pitfalls
- Using an arrow function as an object method: `this` will not be the object.
- Forgetting the parentheses around an object literal in a concise arrow body; `() => { id }` returns undefined.

#### Interview tip
- Arrow functions are not just shorter syntax — explain the lexical `this` difference with an example.

### Parameters: defaults, rest and arguments
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Default_parameters -->
JavaScript does not enforce arity: missing arguments are `undefined`, extra arguments are ignored. Default parameter values kick in only when the argument is `undefined` (not `null`). Defaults are evaluated at call time, left to right, so later parameters can refer to earlier ones and you can even call functions to compute them.

Rest parameters (`...args`) gather the remaining arguments into a real array. The older `arguments` object is array-like, not available in arrow functions, and in sloppy mode is linked to named parameters — prefer rest parameters in new code.

A function's `length` property counts parameters before the first one with a default or rest.

```js
function required(name) {
  throw new TypeError(`${name} is required`);
}

function createUser(name = required('name'), role = 'viewer', createdAt = Date.now()) {
  return { name, role, createdAt };
}
createUser('Asha');            // role 'viewer'
createUser('Asha', null);      // role null — default not used!

function sum(...nums) {
  return nums.reduce((a, b) => a + b, 0);
}
sum(1, 2, 3); // 6

(function (a, b = 1, c) {}).length; // 1
```

#### Pitfalls
- A mutable default such as `items = []` is created fresh on each call in JavaScript (unlike Python), so it is safe — but mention the difference if asked.
- Long positional parameter lists are hard to read; prefer one options object with destructured defaults.

### Scope and lexical environments
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Glossary/Scope -->
Scope determines where a name is visible. JavaScript uses lexical (static) scope: what a name refers to is decided by where the code is written, not where it is called from.

There are several kinds of scope: global, module (each ES module has its own top-level scope), function, and block (for `let`, `const`, `class` and function declarations in strict mode).

Under the hood each running scope is backed by an environment record that maps names to values, plus a pointer to its outer environment. Looking up a name walks this chain outwards until the name is found or the global scope is reached, at which point a `ReferenceError` is thrown (or, in sloppy mode, an assignment silently creates a global).

```js
const level = 'module';

function outer() {
  const level = 'outer';     // shadows the module binding
  function inner() {
    return level;            // resolved lexically -> 'outer'
  }
  return inner;
}

function caller() {
  const level = 'caller';
  return outer()();          // still 'outer' — call site does not matter
}

if (true) {
  const blockOnly = 1;
}
// blockOnly -> ReferenceError
```

#### Pitfalls
- Accidental globals from assigning to an undeclared variable in sloppy mode — modules and strict mode prevent this.
- Shadowing a variable with the same name in an inner scope makes code hard to follow; linters can flag it.

### Hoisting and the temporal dead zone
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Glossary/Hoisting -->
Before a scope's code runs, the engine creates bindings for every declaration in it. This setup step is what people call hoisting. What differs is how each binding is initialised:

- `function` declarations: created and initialised with the full function — callable anywhere in the scope.
- `var`: created and initialised to `undefined`.
- `let`, `const`, `class`: created but left uninitialised. From the start of the scope until the declaration executes, the binding is in the temporal dead zone (TDZ), and any access throws a `ReferenceError`.
- `import` declarations are hoisted and resolved before the module body runs.

```js
console.log(a);   // undefined (var)
var a = 1;

console.log(fn()); // 'ok' (function declaration)
function fn() { return 'ok'; }

let x = 'outer';
{
  // console.log(x); // ReferenceError: TDZ for the inner x
  let x = 'inner';
}

new Service();     // ReferenceError: classes are in the TDZ
class Service {}
```

The TDZ is deliberate: it catches use-before-initialisation bugs that `var` silently turned into `undefined` values.

#### Interview tip
- Say "all declarations are hoisted, but `let`/`const`/`class` are not initialised" — that is more accurate than "let is not hoisted". The inner-block example above proves it: the outer `x` is shadowed even before the inner declaration line.

### Closures
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures -->
A closure is a function bundled with references to the variables of the scope in which it was created. Because functions keep a pointer to their outer environment, that environment stays alive as long as the function is reachable, even after the outer function has returned.

Closures power many everyday patterns: private state, function factories, callbacks that remember context, memoisation, and partial application. They capture variables, not values — if the variable changes later, the closure sees the new value.

```js
function createRateLimiter(limit, windowMs) {
  let calls = [];                         // private, captured state
  return function allow() {
    const now = Date.now();
    calls = calls.filter((t) => now - t < windowMs);
    if (calls.length >= limit) return false;
    calls.push(now);
    return true;
  };
}

const allow = createRateLimiter(5, 1000);
if (!allow()) console.warn('Too many requests');

function memoize(fn) {
  const cache = new Map();
  return (arg) => {
    if (!cache.has(arg)) cache.set(arg, fn(arg));
    return cache.get(arg);
  };
}
```

Engines optimise closures by keeping only the variables actually referenced by inner functions, but if any inner function uses `eval`, the whole scope must be retained.

#### Pitfalls
- Closures can keep large objects alive unintentionally (for example, an event handler that references a big data array), which looks like a memory leak.
- Unbounded caches inside closures grow forever; cap them or use `WeakMap` when keys are objects.

### IIFEs and the module pattern
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Glossary/IIFE -->
An immediately invoked function expression (IIFE) is a function that runs as soon as it is defined: `(function () { ... })()`. Before ES modules and block scoping existed, IIFEs were the only way to create a private scope so that variables did not leak into the global object.

The classic module pattern combines an IIFE with closures: private variables live inside the function and a returned object exposes the public API. You still meet this in older libraries, bundled output and UMD builds.

Today, ES modules give every file its own scope, and blocks with `let`/`const` give local scopes, so IIFEs are mostly used for one-off async setup in environments without top-level await, or to compute a `const` from complex logic.

```js
// Legacy module pattern
const Cart = (function () {
  const items = [];                 // private
  return {
    add(item) { items.push(item); },
    total() { return items.reduce((s, i) => s + i.price, 0); },
  };
})();

// Modern: async IIFE in a CommonJS script
(async () => {
  const config = await loadConfig();
  start(config);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

#### Pitfalls
- A missing semicolon before a line starting with `(` makes the previous expression get called — a classic ASI bug.

### Higher-order functions and callbacks
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Glossary/First-class_Function -->
Because functions are values, a function can accept other functions or return new ones. Such functions are called higher-order functions. Array methods (`map`, `filter`, `reduce`), event listeners, `setTimeout`, and middleware chains are all built on this idea.

Returning functions enables composition and partial application: you build small, single-purpose functions and combine them. A callback is simply a function you pass to be called later — either synchronously (like `map`) or asynchronously (like an event handler).

```js
const pipe = (...fns) => (input) => fns.reduce((acc, fn) => fn(acc), input);

const slugify = pipe(
  (s) => s.trim(),
  (s) => s.toLowerCase(),
  (s) => s.replace(/[^a-z0-9]+/g, '-'),
);
slugify('  Hello World! '); // 'hello-world-'

const withLogging = (fn) => (...args) => {
  console.time(fn.name);
  try {
    return fn(...args);
  } finally {
    console.timeEnd(fn.name);
  }
};

const orders = [{ total: 500, paid: true }, { total: 200, paid: false }];
const revenue = orders.filter((o) => o.paid).reduce((s, o) => s + o.total, 0);
```

#### Pitfalls
- Passing a function reference that relies on `this`, e.g. `arr.forEach(obj.method)` — `this` is lost. Wrap it in an arrow or `bind` it.
- `['1', '2', '3'].map(parseInt)` returns `[1, NaN, NaN]` because `map` passes the index as `parseInt`'s radix.

### Strict mode
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Strict_mode -->
Strict mode is a restricted variant of JavaScript that turns silent mistakes into errors and removes some confusing features. It is enabled with a `'use strict';` directive at the top of a script or function, and it is automatically on inside ES modules and class bodies — so most modern code is already strict.

Key changes:

- Assigning to an undeclared variable throws instead of creating a global.
- `this` is `undefined` (not the global object) in plain function calls.
- Writing to read-only properties or adding properties to frozen objects throws.
- Duplicate parameter names, `with` statements and octal literals like `010` are syntax errors.
- `eval` cannot create variables in the surrounding scope; `arguments` no longer aliases parameters.

```js
'use strict';

function setup() {
  mistypedVariable = 17;   // ReferenceError instead of a new global
}

function show() {
  return this;
}
show();                    // undefined in strict mode, globalThis in sloppy

const frozen = Object.freeze({ a: 1 });
frozen.a = 2;              // TypeError in strict mode
```

#### Interview tip
- When asked why `this` is `undefined` inside a callback, mention that modules and classes are strict by default, so the old "falls back to window" behaviour no longer applies.

## 4. this, Prototypes and Classes

### How this is determined
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this -->
For normal functions, `this` is not fixed when the function is written — it is decided by how the function is called. Check these rules in order of priority:

1. Called with `new`: `this` is the newly created object.
2. Called with `call`, `apply`, or a function produced by `bind`: `this` is the supplied value.
3. Called as a method, `obj.fn()`: `this` is `obj` (the object left of the dot at call time).
4. Plain call `fn()`: `this` is `undefined` in strict mode, or the global object in sloppy mode.

Arrow functions ignore all of these and use the `this` of their enclosing scope. Class field arrow functions therefore capture the instance.

```js
const account = {
  owner: 'Asha',
  describe() { return this.owner; },
};

account.describe();            // 'Asha' (method call)
const fn = account.describe;
fn();                          // TypeError in strict mode: this is undefined

button.addEventListener('click', account.describe); // this === button

class Timer {
  seconds = 0;
  tick = () => { this.seconds++; }; // bound to the instance
}
const t = new Timer();
setInterval(t.tick, 1000);     // works
```

#### Pitfalls
- Extracting a method (`const { describe } = account`) loses its receiver.
- In DOM listeners declared with `function`, `this` is the element (`event.currentTarget`), which surprises people who expect the class instance.

### call, apply and bind
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind -->
These three methods on `Function.prototype` let you control `this` explicitly.

- `fn.call(thisArg, a, b)` invokes immediately with arguments listed one by one.
- `fn.apply(thisArg, [a, b])` invokes immediately with arguments as an array (largely replaced by spread).
- `fn.bind(thisArg, a)` does not invoke; it returns a new bound function with `this` permanently fixed and optionally some leading arguments pre-filled (partial application).

A bound function's `this` cannot be changed again by `call`, `apply` or another `bind`. The only exception is `new`, which ignores the bound `this` and constructs a new object. Arrow functions ignore `thisArg` entirely.

```js
function greet(greeting, punctuation) {
  return `${greeting}, ${this.name}${punctuation}`;
}
const user = { name: 'Asha' };

greet.call(user, 'Hi', '!');       // 'Hi, Asha!'
greet.apply(user, ['Hello', '.']); // 'Hello, Asha.'

const hiAsha = greet.bind(user, 'Hi');
hiAsha('?');                       // 'Hi, Asha?'
hiAsha.call({ name: 'Ravi' }, '!');// still 'Hi, Asha!'

// Borrowing a method
const args = Array.prototype.slice.call(arguments);
```

#### Interview tip
- A common exercise is to implement `bind` yourself: return a function that calls `fn.apply(thisArg, [...preset, ...args])`, and handle `new` by checking `new.target`.

### The prototype chain
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Inheritance_and_the_prototype_chain -->
Every object has an internal link, `[[Prototype]]`, to another object or `null`. When you read a property that the object does not have, the engine follows this link and searches the prototype, then its prototype, and so on until it reaches `null`. This is prototypal inheritance — objects inherit directly from other objects.

Writes are different: assigning a property creates or updates it on the object itself (shadowing the inherited one), unless the prototype defines a setter or a non-writable property.

You read the link with `Object.getPrototypeOf(obj)`, create objects with a chosen prototype using `Object.create(proto)`, and test own properties with `Object.hasOwn(obj, key)` (ES2022). The `__proto__` accessor works but is legacy.

```js
const animal = {
  speak() { return `${this.name} makes a sound`; },
};
const dog = Object.create(animal);
dog.name = 'Rex';
dog.speak();                         // found on the prototype

Object.getPrototypeOf(dog) === animal;  // true
Object.hasOwn(dog, 'speak');            // false
'speak' in dog;                         // true (in checks the chain)

const dict = Object.create(null);    // no prototype: safe as a map
dict.toString;                        // undefined
```

Engines cache prototype lookups using hidden classes (shapes) and inline caches, so changing an object's prototype after creation with `Object.setPrototypeOf` deoptimises code and should be avoided.

#### Pitfalls
- Using plain objects as dictionaries for user-supplied keys exposes you to `__proto__` and prototype pollution — use `Map` or `Object.create(null)`.

### Constructor functions and new
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/new -->
Before classes existed, objects were created with constructor functions called with `new`. Classes are still built on this mechanism, so it is worth knowing what `new F(args)` actually does:

1. Creates a new empty object.
2. Sets its `[[Prototype]]` to `F.prototype`.
3. Calls `F` with `this` bound to the new object.
4. Returns the new object, unless `F` explicitly returns another object.

Methods are placed on `F.prototype` so all instances share one copy instead of each instance getting its own function.

```js
function Product(name, price) {
  this.name = name;
  this.price = price;
}
Product.prototype.withTax = function (rate) {
  return this.price * (1 + rate);
};

const p = new Product('Pen', 100);
p.withTax(0.18);                           // 118
Object.getPrototypeOf(p) === Product.prototype; // true

// A minimal re-implementation of new
function construct(F, ...args) {
  const obj = Object.create(F.prototype);
  const result = F.apply(obj, args);
  return result !== null && typeof result === 'object' ? result : obj;
}
```

#### Pitfalls
- Calling a constructor without `new` in sloppy mode writes properties onto the global object. Classes throw a TypeError in that case, which is one reason to prefer them.

### Classes
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes -->
Classes (ES2015) provide a clearer syntax over prototypes. A class declaration creates a constructor function; methods go on its `prototype`; `static` members go on the constructor itself. `extends` sets up two prototype chains (instances and statics), and `super` calls the parent constructor or methods.

Classes differ from old constructor functions in important ways: their bodies are always strict, they must be called with `new`, they are in the TDZ until declared, and methods are non-enumerable.

Public instance fields (ES2022) are defined per instance before the constructor body runs (for derived classes, right after `super()` returns).

```js
class Shape {
  static count = 0;
  constructor(name) {
    this.name = name;
    Shape.count++;
  }
  area() { return 0; }
  toString() { return `${this.name} with area ${this.area().toFixed(2)}`; }
}

class Circle extends Shape {
  radius;
  constructor(radius) {
    super('circle');          // must run before using this
    this.radius = radius;
  }
  area() { return Math.PI * this.radius ** 2; }
}

String(new Circle(2)); // 'circle with area 12.57'
typeof Circle;         // 'function'
```

#### Pitfalls
- Accessing `this` in a derived constructor before `super()` throws a ReferenceError.
- Deep inheritance hierarchies become rigid; prefer composition for sharing behaviour across unrelated classes.

### Private fields, static blocks and accessors
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_properties -->
ES2022 added true privacy to classes. Names starting with `#` (fields, methods, getters, static members) are only accessible inside the class body. They are not properties in the normal sense: they do not appear in `Object.keys`, cannot be reached with bracket notation, and are not inherited by subclasses' code. Accessing a private name on an object that lacks it throws a TypeError; the `#field in obj` check (ES2022) tests for it safely, which is useful for brand checks.

Static initialisation blocks (`static { ... }`) run once when the class is evaluated and can access private statics — handy for complex setup.

Getters and setters (`get`/`set`) define computed properties with validation.

```js
class BankAccount {
  #balance = 0;
  static #instances = 0;

  static {
    BankAccount.currency = 'INR';
  }

  constructor() { BankAccount.#instances++; }

  get balance() { return this.#balance; }

  deposit(amount) {
    if (amount <= 0) throw new RangeError('Amount must be positive');
    this.#balance += amount;
  }

  static isAccount(obj) { return #balance in obj; }
}

const acc = new BankAccount();
acc.deposit(500);
acc.balance;        // 500
// acc.#balance     // SyntaxError outside the class
```

#### Pitfalls
- Private fields do not work through Proxies: a proxied instance throws when its methods touch `#fields`, because the proxy object itself lacks them.

### Property descriptors and immutability
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty -->
Each property has a descriptor. Data properties have `value` and `writable`; accessor properties have `get` and `set`. Both kinds have `enumerable` (shows up in `for...in`, `Object.keys`, spread) and `configurable` (can be deleted or redefined).

Properties created by normal assignment have all flags `true`; properties created with `Object.defineProperty` default to `false`. Built-in methods on prototypes are non-enumerable, which is why they do not show up when you loop over an array's keys.

Three levels of object locking exist, all shallow:

- `Object.preventExtensions` — no new properties.
- `Object.seal` — plus no deletion or reconfiguration.
- `Object.freeze` — plus all data properties read-only.

```js
const config = {};
Object.defineProperty(config, 'apiUrl', {
  value: 'https://api.example.com',
  writable: false,
  enumerable: true,
  configurable: false,
});

Object.getOwnPropertyDescriptor(config, 'apiUrl');

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}

const settings = deepFreeze({ db: { host: 'localhost' } });
Object.isFrozen(settings.db); // true
```

#### Pitfalls
- In sloppy mode, writes to frozen objects fail silently; in strict mode they throw.
- Freezing does not affect values inside a `Map` or `Set`, nor the internal state of a `Date`.
