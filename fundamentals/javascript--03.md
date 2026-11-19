## 5. Collections and Built-in Objects

### Arrays and iteration methods
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array -->
Arrays are ordered, zero-indexed objects whose `length` tracks the highest index plus one. Engines store them efficiently when elements are of one kind (all small integers, all doubles, all objects) and dense. Creating holes (`arr[1000] = x`) or mixing types moves the array to slower representations.

The iteration methods take a callback and express intent clearly:

- `map` transforms each element; `filter` keeps some; `reduce` folds into one value.
- `find`/`findIndex` and `findLast`/`findLastIndex` (ES2023) return the first or last match.
- `some`/`every` answer yes/no questions and stop early.
- `flat`/`flatMap` flatten nested arrays.
- `forEach` is for side effects only; it cannot be stopped early (use `for...of` with `break`).

Mutating methods include `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse` and `fill`.

```js
const orders = [
  { id: 1, status: 'paid', total: 1200 },
  { id: 2, status: 'pending', total: 300 },
  { id: 3, status: 'paid', total: 450 },
];

const paidTotal = orders
  .filter((o) => o.status === 'paid')
  .reduce((sum, o) => sum + o.total, 0);        // 1650

const hasPending = orders.some((o) => o.status === 'pending');
const ids = orders.map(({ id }) => id);
orders.at(-1);                                   // last element (ES2022)

[10, 9, 1].sort();               // [1, 10, 9]  string comparison!
[10, 9, 1].sort((a, b) => a - b); // [1, 9, 10]
```

#### Pitfalls
- `forEach` with an `async` callback does not wait; use `for...of` with `await` or `Promise.all(arr.map(...))`.
- `reduce` without an initial value throws on an empty array.

### Copying array methods (ES2023)
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted -->
Several classic array methods mutate the array in place, which causes bugs when the array is shared — for example state in React or a value returned from a cache. ES2023 ("change array by copy") added non-mutating counterparts that return a new array:

- `toSorted(compareFn)` instead of `sort`
- `toReversed()` instead of `reverse`
- `toSpliced(start, deleteCount, ...items)` instead of `splice`
- `with(index, value)` instead of `arr[index] = value`

They also exist on typed arrays (except `toSpliced`). They are shallow: the new array holds the same object references.

```js
const scores = [42, 7, 99];

const ranked = scores.toSorted((a, b) => b - a); // [99, 42, 7]
scores;                                          // unchanged [42, 7, 99]

const updated = scores.with(1, 8);               // [42, 8, 99]
const withoutFirst = scores.toSpliced(0, 1);     // [7, 99]

// Before ES2023 you had to copy first
const ranked2 = [...scores].sort((a, b) => b - a);

// Immutable update in a reducer
function toggleTodo(todos, index) {
  return todos.with(index, { ...todos[index], done: !todos[index].done });
}
```

Available in all evergreen browsers since 2023 and Node.js 20+.

#### Interview tip
- Know which classic methods mutate (`sort`, `reverse`, `splice`, `fill`, `copyWithin`, `push`, `pop`, `shift`, `unshift`) — this comes up constantly in front-end state questions.

### Map and Set
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map -->
`Map` is a key-value collection where keys can be any value, including objects, and insertion order is preserved. Unlike plain objects it has no inherited keys, reports its size in O(1) with `size`, and is optimised for frequent additions and deletions. `Set` stores unique values using the same SameValueZero equality.

Use plain objects for fixed-shape records and JSON; use `Map` for dynamic dictionaries, caches and lookups keyed by objects or user input.

ES2025 added set algebra methods to `Set.prototype`: `union`, `intersection`, `difference`, `symmetricDifference`, `isSubsetOf`, `isSupersetOf` and `isDisjointFrom`. ES2024 added `Map.groupBy` for grouping into a Map.

```js
const visits = new Map();
function track(user) {
  visits.set(user, (visits.get(user) ?? 0) + 1); // object as key
}

const unique = [...new Set(['a', 'b', 'a'])]; // ['a', 'b']

const admins = new Set(['asha', 'ravi']);
const online = new Set(['ravi', 'meera']);
admins.intersection(online);   // Set {'ravi'}  (ES2025)
admins.union(online);          // Set {'asha', 'ravi', 'meera'}

const byStatus = Map.groupBy(orders, (o) => o.status); // ES2024

// JSON does not understand Map
JSON.stringify(Object.fromEntries(visits));
```

#### Pitfalls
- `map[key] = value` on a Map sets an ordinary property, not an entry — always use `set`/`get`.
- Two different objects with identical contents are different keys.

### WeakMap, WeakSet and WeakRef
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap -->
Weak collections hold their keys weakly: an entry does not prevent its key from being garbage-collected. When nothing else references the key object, the entry disappears automatically. Because the contents can change at any time due to GC, weak collections are not iterable and have no `size`.

Keys must be objects or non-registered symbols (ES2023). Typical uses: associating metadata or caches with objects you do not own (DOM nodes, request objects), and private data per instance in pre-`#field` code.

`WeakRef` (ES2021) holds a weak reference to a single object, and `FinalizationRegistry` runs a callback some time after an object is collected. Both are low-level tools whose timing is unspecified — use them only for caches where losing the value is acceptable.

```js
const computed = new WeakMap();

function getLayout(element) {
  if (!computed.has(element)) {
    computed.set(element, expensiveMeasure(element));
  }
  return computed.get(element);
}
// When the element is removed and dropped, its cache entry can be GC'd.

const ref = new WeakRef(bigImageBitmap);
const img = ref.deref();       // the object, or undefined if collected
if (img) draw(img);
```

#### Pitfalls
- Never rely on `FinalizationRegistry` for correctness (closing files, releasing locks); it may run late or never.
- A WeakMap value that references its own key keeps nothing alive — but a strong reference to the key elsewhere does.

### JSON
<!-- level: basic; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON -->
JSON is a text format with a subset of JavaScript's types: objects, arrays, strings, finite numbers, booleans and null. `JSON.stringify` converts values to JSON text and `JSON.parse` converts back.

What gets lost on stringify: `undefined`, functions and symbols are dropped from objects (and become `null` in arrays); `NaN` and `Infinity` become `null`; `Date` objects become ISO strings via their `toJSON` method; `Map`, `Set` and class prototypes are not preserved; `BigInt` throws a TypeError; circular references throw.

Both functions accept hooks: a replacer (function or allow-list of keys) for stringify, a reviver for parse. Objects can define `toJSON()` to control their serialised form.

```js
const payload = {
  id: 7,
  createdAt: new Date('2025-01-01'),
  password: 'secret',
  tags: new Set(['a']),
};

JSON.stringify(payload, (key, value) => {
  if (key === 'password') return undefined;      // drop
  if (value instanceof Set) return [...value];    // convert
  return value;
}, 2);

const data = JSON.parse(text, (key, value) =>
  key === 'createdAt' ? new Date(value) : value);

try {
  JSON.parse('{bad json}');
} catch (err) {
  console.error('Invalid JSON', err.message);
}
```

#### Pitfalls
- Always wrap `JSON.parse` of external input in `try/catch` and validate the shape afterwards.
- `JSON.parse(JSON.stringify(x))` as a deep clone silently loses dates, maps and undefined — use `structuredClone`.

### Dates and the Intl API
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl -->
A `Date` stores a single number: milliseconds since 1 January 1970 UTC. It has no time zone of its own — methods like `getHours()` interpret that instant in the runtime's local zone, while `getUTCHours()` use UTC. Months are zero-based, and parsing non-ISO strings is implementation-dependent.

For display, use the `Intl` API, which formats according to locale and time zone without libraries: `Intl.DateTimeFormat`, `Intl.NumberFormat` (currency, units, compact notation), `Intl.RelativeTimeFormat`, `Intl.PluralRules`, `Intl.ListFormat` and `Intl.Segmenter`.

The `Temporal` API is a modern replacement for `Date` with explicit types (`PlainDate`, `ZonedDateTime`, `Instant`). It shipped in Firefox 139 and is rolling out to other engines, but it is not part of ES2025 — check support before relying on it.

```js
const d = new Date('2025-03-15T10:30:00Z');  // ISO with Z: unambiguous
d.toISOString();                              // store/transmit this

new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
}).format(d);                                 // '15 Mar 2025, 4:00 pm'

new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
  .format(1234567.5);                         // '₹12,34,567.50'

new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-1, 'day'); // 'yesterday'
```

#### Pitfalls
- `new Date('2025-03-15')` is parsed as UTC midnight, but `new Date('2025-03-15T00:00')` as local time.
- Adding 24 hours is not the same as adding a day across daylight-saving changes.

### Regular expressions
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions -->
Regular expressions describe text patterns. Create them with a literal `/pattern/flags` or `new RegExp(string, flags)`. Common flags: `g` (global), `i` (case-insensitive), `m` (multiline anchors), `s` (dot matches newlines), `u` (Unicode code points), `v` (ES2024, Unicode sets with set operations), `y` (sticky) and `d` (match indices).

Named capture groups `(?<name>...)` make matches readable. `String.prototype.matchAll` returns an iterator of all matches with groups. ES2025 added `RegExp.escape()` for safely embedding user text in a pattern, inline modifiers like `(?i:...)`, and duplicate named groups in different alternatives.

A regex with `g` or `y` is stateful: `lastIndex` advances after each `test` or `exec`, which surprises people who reuse one instance.

```js
const re = /(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/;
const { year, month } = '2025-06-30'.match(re).groups;

const text = 'Order #12, Order #57';
for (const m of text.matchAll(/#(\d+)/g)) {
  console.log(m[1]);           // '12', '57'
}

'a-b_c'.replace(/[-_]/g, ' '); // 'a b c'

// Safe search for user input (ES2025; older code escapes manually)
const needle = new RegExp(RegExp.escape(userInput), 'i');
```

#### Pitfalls
- Nested quantifiers like `(a+)+$` can backtrack exponentially (ReDoS) on crafted input — a real denial-of-service risk on servers.
- `/g` regexes reused with `test()` alternate between true and false due to `lastIndex`.

## 6. Iterators, Generators and Metaprogramming

### Iteration protocols
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols -->
The iteration protocols are a contract that lets any object participate in `for...of`, spread, array destructuring, `Array.from`, `Promise.all`, and `new Map(...)`.

- An iterable is an object with a `[Symbol.iterator]()` method that returns an iterator.
- An iterator is an object with a `next()` method returning `{ value, done }`. It may also have `return()` — called when a consumer exits early (a `break` or thrown error), allowing cleanup.

Arrays, strings, Maps, Sets, typed arrays, `arguments` and NodeLists are built-in iterables. Plain objects are not; use `Object.entries(obj)` to iterate them.

```js
class Range {
  constructor(start, end, step = 1) {
    Object.assign(this, { start, end, step });
  }
  [Symbol.iterator]() {
    let current = this.start;
    const { end, step } = this;
    return {
      next() {
        if (current > end) return { value: undefined, done: true };
        const value = current;
        current += step;
        return { value, done: false };
      },
      return() {
        console.log('cleanup');
        return { value: undefined, done: true };
      },
    };
  }
}

[...new Range(1, 5)];           // [1, 2, 3, 4, 5]
for (const n of new Range(1, 100)) {
  if (n > 2) break;             // logs 'cleanup'
}
```

Iterators are lazy: values are produced on demand, so a range of a billion numbers costs no memory until consumed.

#### Interview tip
- Explain the difference between iterable and iterator, and why `for...in` (enumerable keys) is not the same as `for...of` (iterator values).

### Generators
<!-- level: intermediate; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function* -->
A generator function (`function*`) returns a generator object, which is both an iterator and an iterable. The function body does not run until `next()` is called; it then runs until the next `yield`, pauses, and hands out the yielded value. Its local variables and position are preserved between calls — the engine saves the function's execution context instead of discarding it.

Generators make custom iterators trivial and enable lazy pipelines and infinite sequences. They are also two-way: `next(value)` sends a value back in as the result of the `yield` expression, `throw(err)` raises an error at the pause point, and `return(value)` finishes early (running any `finally` blocks). `yield*` delegates to another iterable.

```js
function* idGenerator(prefix) {
  let n = 1;
  while (true) yield `${prefix}-${n++}`;
}
const ids = idGenerator('ORD');
ids.next().value; // 'ORD-1'
ids.next().value; // 'ORD-2'

function* paginate(items, size) {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}
for (const page of paginate(rows, 100)) insertBatch(page);

function* walk(tree) {
  yield tree.value;
  for (const child of tree.children ?? []) yield* walk(child);
}
```

Before async/await, libraries like co used generators yielding promises to write async code synchronously — async functions are essentially that pattern built into the language.

#### Pitfalls
- A generator object can be iterated only once; calling the generator function again creates a fresh one.

### Async iterators and for await...of
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of -->
Async iteration (ES2018) is the asynchronous twin of the iteration protocol. An async iterable has `[Symbol.asyncIterator]()` returning an iterator whose `next()` returns a promise of `{ value, done }`. `for await...of` consumes it, awaiting each step before running the loop body — giving natural backpressure because the next item is not requested until the current one is processed.

Async generator functions (`async function*`) combine `await` and `yield` and are the easiest way to produce async iterables: paginated APIs, streaming responses, message queues. Node.js readable streams, `readline` interfaces and `events.on` are async iterable, and in browsers a `ReadableStream` is async iterable in recent Chrome, Firefox and Node (check Safari support).

`Array.fromAsync` (a newer addition, available in modern browsers and Node.js 22+) collects an async iterable into an array.

```js
async function* fetchAllPages(url) {
  let next = url;
  while (next) {
    const res = await fetch(next);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    yield* body.items;
    next = body.nextPageUrl;
  }
}

for await (const item of fetchAllPages('/api/orders?page=1')) {
  await process(item);
  if (item.id === stopId) break;  // stops fetching more pages
}
```

#### Pitfalls
- `for await` processes items sequentially. For independent items you may want bounded concurrency instead.
- Breaking out early calls `return()` on the iterator; make sure your generator releases resources in `finally`.

### Iterator helpers (ES2025)
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator -->
ES2025 introduced a global `Iterator` class with helper methods on `Iterator.prototype`, so all built-in iterators (from arrays' `values()`, Maps, Sets, generators) can be transformed lazily without first converting to an array.

Lazy methods returning new iterators: `map`, `filter`, `take`, `drop`, `flatMap`. Eager methods that consume the iterator: `reduce`, `toArray`, `forEach`, `some`, `every`, `find`. `Iterator.from(obj)` wraps any iterable or iterator-like object so it gains these helpers.

The key difference from array methods is laziness: each value flows through the whole chain one at a time, and nothing happens until a consuming method pulls values. This means you can work with infinite sequences and avoid allocating intermediate arrays.

```js
function* naturals() {
  let n = 1;
  while (true) yield n++;
}

const firstFiveEvenSquares = naturals()
  .filter((n) => n % 2 === 0)
  .map((n) => n * n)
  .take(5)
  .toArray();                     // [4, 16, 36, 64, 100]

const activeEmails = users.values()
  .filter((u) => u.active)
  .map((u) => u.email)
  .toArray();

const firstLarge = new Map(entries).values().find((v) => v.size > 1e6);
```

Supported in Chrome 122+, Firefox 131+, Safari 18.4+ and Node.js 22+. Async iterator helpers are a separate, later proposal.

#### Pitfalls
- Helpers are on iterators, not iterables: call `.values()` on an array or `Map` first.
- An iterator is single-use; after `toArray()` it is exhausted.

### Proxy and Reflect
<!-- level: advanced; ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy -->
A `Proxy` wraps a target object and intercepts fundamental operations through handler functions called traps: `get`, `set`, `has`, `deleteProperty`, `ownKeys`, `apply`, `construct` and more. `Reflect` provides functions with the same names that perform the default behaviour, so traps can add logic and then forward to the target correctly (including the right receiver for getters).

Proxies power reactivity systems (Vue 3, MobX), validation layers, logging, mocks, and API clients that turn property access into requests.

Traps must respect invariants — for example, `get` cannot report a different value for a non-writable, non-configurable property — otherwise the engine throws.

```js
function createValidated(target, schema) {
  return new Proxy(target, {
    set(obj, key, value, receiver) {
      const check = schema[key];
      if (check && !check(value)) {
        throw new TypeError(`Invalid value for ${String(key)}`);
      }
      return Reflect.set(obj, key, value, receiver);
    },
  });
}

const user = createValidated({}, {
  age: (v) => Number.isInteger(v) && v >= 0,
});
user.age = 30;      // ok
// user.age = -1;   // TypeError

function observe(obj, onChange) {
  return new Proxy(obj, {
    set(o, k, v, r) {
      const ok = Reflect.set(o, k, v, r);
      onChange(k, v);
      return ok;
    },
  });
}
```

#### Pitfalls
- Proxies add overhead on every operation; avoid them in hot loops.
- Built-ins with internal slots (Map, Date, private fields) break when their methods are called with a proxy as `this`.
- `proxy !== target`, so identity checks against the original object fail.
