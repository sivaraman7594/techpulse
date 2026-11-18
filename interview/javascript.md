# JavaScript interview questions

### How does the event loop work? What is the difference between microtasks and macrotasks?
<!-- level: intermediate; kind: concept; ref: https://developer.mozilla.org/docs/Web/JavaScript/Event_loop -->
JavaScript runs on a single thread. Synchronous code runs on the call stack; async callbacks wait in queues.

After each task (macrotask — e.g. a `setTimeout` callback, an I/O event), the engine runs **all microtasks** (promise callbacks, `queueMicrotask`) before the next task.

```js
console.log('1');
setTimeout(() => console.log('4'), 0);
Promise.resolve().then(() => console.log('3'));
console.log('2');
// prints 1, 2, 3, 4
```

### What is the difference between `var`, `let` and `const`?
<!-- level: basic; kind: concept; ref: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/let -->
- `var`: function-scoped, hoisted and initialised to `undefined`, can be redeclared.
- `let`: block-scoped, can be reassigned; hoisted but not initialised (accessing it before the declaration throws — the "temporal dead zone").
- `const`: block-scoped, cannot be reassigned — but objects/arrays it points to can still be mutated.

Use `const` by default, `let` when you need to reassign, and avoid `var`.

### What is a closure? Give a practical example.
<!-- level: basic; kind: concept; ref: https://developer.mozilla.org/docs/Web/JavaScript/Closures -->
A closure is a function that remembers the variables from the scope where it was created, even after that scope has finished.

```js
function makeCounter() {
  let count = 0;            // private state
  return () => ++count;
}
const next = makeCounter();
next(); // 1
next(); // 2
```

Used for private state, factories, callbacks and memoisation.

### What is the difference between `==` and `===`?
<!-- level: basic; kind: concept; ref: https://developer.mozilla.org/docs/Web/JavaScript/Equality_comparisons_and_sameness -->
`===` compares value **and type** with no conversion. `==` converts types first, which gives surprising results: `0 == ''` is `true`, `null == undefined` is `true`, `'1' == 1` is `true`.

Always use `===`. The one common exception is `x == null`, which deliberately checks for both `null` and `undefined`.

### What is the difference between `Promise.all`, `allSettled`, `race` and `any`?
<!-- level: intermediate; kind: concept; ref: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise -->
- `Promise.all`: resolves with all results; **rejects as soon as one rejects**.
- `Promise.allSettled`: waits for all and returns each outcome (`fulfilled`/`rejected`) — never rejects.
- `Promise.race`: settles with the **first** promise to settle (success or failure) — useful for timeouts.
- `Promise.any`: resolves with the first **success**; rejects only if all fail (`AggregateError`).

### Implement debounce for a search box.
<!-- level: intermediate; kind: scenario; ref: https://developer.mozilla.org/docs/Web/API/setTimeout -->
Debounce delays a call until the user stops triggering it for a given time, so typing "react" sends one request instead of five.

```js
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

input.addEventListener('input', debounce(e => search(e.target.value), 300));
```

**Throttle** is the related technique that runs at most once per interval (good for scroll/resize). For search, also cancel outdated requests (`AbortController`) so old responses don't overwrite new ones.
