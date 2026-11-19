## 4. Rendering and reconciliation

### Trigger, render and commit
<!-- level: intermediate; ref: https://react.dev/learn/render-and-commit -->
Every screen update in React goes through three steps. First, something triggers a render: either the initial mount (`createRoot(...).render(<App />)`) or a state update somewhere in the tree. Second, React renders: it calls the components that need updating, and recursively their children, to compute a new element tree. Third, React commits: it applies the minimal set of changes to the DOM, runs ref callbacks, then layout effects, and later passive effects (`useEffect`).

The render phase is pure computation and can be interrupted, restarted or thrown away, especially in concurrent rendering. The commit phase is synchronous and cannot be interrupted, so the user never sees a partially updated DOM. After commit, the browser paints.

"Rendering" therefore does not mean "touching the DOM". A component can render and produce exactly the same output, in which case React commits nothing for it.

```jsx
import { createRoot } from 'react-dom/client';

function Clock({ time }) {
  // Render: React calls this and gets JSX
  return (
    <>
      <h1>{time}</h1>
      <input placeholder="Typing here is not lost" />
    </>
  );
}

const root = createRoot(document.getElementById('root'));
setInterval(() => {
  // Trigger: a new render each second
  root.render(<Clock time={new Date().toLocaleTimeString()} />);
  // Commit: only the <h1> text node changes; the input keeps its value
}, 1000);
```

- Interview tip: "re-render" is cheap compared with DOM work, but unnecessary renders of big trees still cost CPU. Measure with the Profiler before optimising.

### Reconciliation and the diffing heuristics
<!-- level: advanced; ref: https://react.dev/learn/preserving-and-resetting-state -->
Reconciliation is the process of comparing the new element tree with the previous one to decide what to update. A general tree diff is O(n³), far too slow for UIs, so React uses two heuristics that make it O(n):

1. Elements of different types produce different trees. If a `<div>` becomes a `<section>`, or `<ProfileA>` becomes `<ProfileB>`, React destroys the old subtree (unmounting components and losing their state) and builds a new one. It does not try to reuse anything below.
2. Among children, keys identify which items are the same. With keys, React can detect insertions, deletions and moves in a list without re-creating items.

For elements of the same type, React keeps the underlying DOM node or component instance and only updates changed attributes or props, then recurses into the children.

```jsx
function Field({ isEditing, value }) {
  // Switching between <input> and <span> changes the type at this position:
  // the input is destroyed and recreated, losing focus and selection.
  return isEditing ? <input defaultValue={value} /> : <span>{value}</span>;
}

function Tabs({ tab }) {
  // Same type, same position: React reuses the instance and updates props.
  return <Panel title={tab.title} />;
}
```

The practical consequences are what interviewers look for: do not change element types needlessly, do not define components inside components (each render is a new type), and use stable keys.

- Pitfall: wrapping a subtree in a conditional `<div>` only on some renders changes its position and resets all state inside it.

### Fiber architecture
<!-- level: advanced; ref: https://react.dev/learn/render-and-commit -->
Fiber is the internal reimplementation of React's reconciler, shipped in React 16. A fiber is a JavaScript object representing one unit of work: a component instance or host element, with pointers to its child, sibling and parent (return) fibers, its pending props, memoised state (the linked list of hooks), effect flags, and priority lanes.

React keeps two fiber trees: the current tree (what is on screen) and a work-in-progress tree being built for the next update. Rendering walks the work-in-progress tree one fiber at a time. Because the work is broken into small units stored on the heap rather than on the JavaScript call stack, React can pause between units, yield to the browser so it can handle input, resume later, or discard the work if a higher-priority update arrives. When the tree is complete, React commits it and the work-in-progress tree becomes current (double buffering).

Lanes are bitmasks that represent update priority: a keystroke is urgent (sync lane), a `startTransition` update is lower priority (transition lanes), and hidden content (Activity, offscreen) is lowest.

```jsx
import { useState, useTransition } from 'react';

function Search({ allItems }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  function onChange(e) {
    setText(e.target.value);                       // urgent lane
    startTransition(() => setQuery(e.target.value)); // interruptible lane
  }

  return (
    <>
      <input value={text} onChange={onChange} />
      {isPending && <small>Updating…</small>}
      <Results items={allItems} query={query} />
    </>
  );
}
```

- Interview tip: Fiber is what made concurrent features (transitions, Suspense, streaming SSR) possible. You do not interact with fibers directly; DevTools shows them as the component tree.

### StrictMode
<!-- level: intermediate; ref: https://react.dev/reference/react/StrictMode -->
`<StrictMode>` is a development-only wrapper that enables extra checks to find bugs early. It renders nothing visible and has zero effect in production builds.

Inside a StrictMode tree, React:

1. Calls component bodies, initialisers and updater functions twice, to expose impure rendering.
2. Runs every effect setup and cleanup one extra time on mount (mount, unmount, mount), to prove that cleanup correctly undoes setup.
3. Runs ref callbacks setup and cleanup an extra time (React 19).
4. Warns about deprecated APIs.

The double effect run is the one that surprises people: an effect that subscribes without unsubscribing will subscribe twice, and a fetch without cancellation fires twice. That is not a bug in StrictMode; it reveals the problem users would hit when a component remounts, for example with Activity, fast refresh or navigation back and forth.

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);

function ChatRoom({ roomId }) {
  useEffect(() => {
    const conn = createConnection(roomId);
    conn.connect();
    return () => conn.disconnect(); // StrictMode proves this exists
  }, [roomId]);
  return <h1>Room {roomId}</h1>;
}
```

- Pitfall: removing StrictMode to "fix" double API calls hides real bugs. Fix the effect or move fetching to a data library.
- Interview tip: in the double render, React 19 reuses the result of `useMemo`/`useState` initialisers from the first call.

### When a component re-renders
<!-- level: intermediate; ref: https://react.dev/reference/react/memo -->
A component re-renders for exactly these reasons: its own state changed (via a setter or reducer dispatch), a context it reads changed, or its parent re-rendered. Notably, "its props changed" is not the trigger: when a parent renders, React re-renders all its children by default whether or not their props changed, unless a child is memoised.

Re-rendering a child whose output is identical is usually cheap, but in large trees or with expensive components it adds up. The tools to avoid wasted work are, in order of preference: restructure (move state down, pass content as children), memoise (`memo` plus stable props via `useMemo`/`useCallback`), or let the React Compiler do the memoisation automatically.

```jsx
import { memo, useState } from 'react';

function Page() {
  const [hover, setHover] = useState(false);
  return (
    <div onMouseMove={() => setHover(h => !h)}>
      <ExpensiveChart />        {/* re-renders on every mouse move */}
      <MemoChart />             {/* skipped: no props changed */}
    </div>
  );
}

const MemoChart = memo(function MemoChart() {
  return <ExpensiveChart />;
});

// Better: keep the fast-changing state in a small wrapper
function HoverArea({ children }) {
  const [hover, setHover] = useState(false);
  return <div onMouseMove={() => setHover(h => !h)}>{children}</div>;
}
// <HoverArea><ExpensiveChart /></HoverArea> — chart created by the parent, not re-rendered
```

- Pitfall: a memoised child still re-renders if a context it consumes changes.
- Interview tip: use React DevTools "Highlight updates when components render" and the Profiler's "Why did this render?" to confirm causes.

## 5. Hooks in depth

### Rules of Hooks
<!-- level: basic; ref: https://react.dev/reference/rules/rules-of-hooks -->
Hooks are functions whose names start with `use` that let components use React features: state, effects, context, refs and more. They come with two rules:

1. Only call hooks at the top level of a component or custom hook — never inside conditions, loops, nested functions, `try`/`catch`, or after an early `return`.
2. Only call hooks from React function components or from other custom hooks, never from plain functions or class components.

The reason is the implementation. React does not identify hooks by name; it stores them as an ordered linked list on the component's fiber. On each render, the first `useState` call gets the first slot, the second gets the second, and so on. If a condition skips a hook on one render, every following hook reads the wrong slot and state gets mixed up.

```jsx
// Wrong: hook order changes when user is null
function Profile({ user }) {
  if (!user) return <Login />;
  const [tab, setTab] = useState('posts'); // skipped on some renders
  return <Tabs tab={tab} onChange={setTab} />;
}

// Right: hooks first, then branch
function ProfileFixed({ user }) {
  const [tab, setTab] = useState('posts');
  if (!user) return <Login />;
  return <Tabs tab={tab} onChange={setTab} />;
}
```

The exception is `use` (React 19), which may be called conditionally because it does not occupy a slot in the same way.

- Interview tip: `eslint-plugin-react-hooks` enforces these rules; its newer versions also include compiler-powered rules that flag impure render logic.

### useReducer
<!-- level: intermediate; ref: https://react.dev/reference/react/useReducer -->
`useReducer` is an alternative to `useState` for state with complex update logic. Instead of calling setters with new values, components dispatch actions that describe what happened ("item_added"), and a pure reducer function `(state, action) => newState` decides how the state changes.

Moving update logic into a reducer has several benefits. All transitions live in one place and are easy to read. The reducer is a plain function you can unit-test without rendering. Event handlers become simple and declarative. And `dispatch` has a stable identity, so passing it down through props or context never causes extra renders.

```jsx
import { useReducer } from 'react';

function cartReducer(state, action) {
  switch (action.type) {
    case 'added': {
      const existing = state.items.find(i => i.id === action.product.id);
      const items = existing
        ? state.items.map(i => (i.id === action.product.id ? { ...i, qty: i.qty + 1 } : i))
        : [...state.items, { ...action.product, qty: 1 }];
      return { ...state, items };
    }
    case 'removed':
      return { ...state, items: state.items.filter(i => i.id !== action.id) };
    case 'cleared':
      return { ...state, items: [] };
    default:
      throw new Error(`Unknown action: ${action.type}`);
  }
}

function Cart() {
  const [cart, dispatch] = useReducer(cartReducer, { items: [] });
  return (
    <>
      <ProductPicker onPick={product => dispatch({ type: 'added', product })} />
      <CartItems items={cart.items} onRemove={id => dispatch({ type: 'removed', id })} />
      <button onClick={() => dispatch({ type: 'cleared' })}>Empty cart</button>
    </>
  );
}
```

- Pitfall: reducers must be pure — no API calls, no `Date.now()`, no mutation.
- Interview tip: choose `useReducer` when the next state depends on the previous in several ways or many events update the same state.

### useRef for mutable values
<!-- level: intermediate; ref: https://react.dev/learn/referencing-values-with-refs -->
`useRef(initial)` returns a plain object `{ current: initial }` that React keeps for the whole lifetime of the component. You can read and write `ref.current` freely, and changing it does not trigger a re-render. Think of it as an instance variable: memory the component needs that is not displayed.

Typical uses are timer ids, the previous value of something, an AbortController, a WebSocket instance, a flag such as "has this run already", and DOM nodes. The rule of thumb: if the value affects what is rendered, it belongs in state; if it is only needed by event handlers or effects, a ref is fine.

```jsx
import { useRef, useState } from 'react';

function Stopwatch() {
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(null);
  const intervalRef = useRef(null);

  function start() {
    setStartedAt(Date.now());
    setNow(Date.now());
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => setNow(Date.now()), 10);
  }

  function stop() {
    clearInterval(intervalRef.current);
  }

  const seconds = startedAt && now ? (now - startedAt) / 1000 : 0;
  return (
    <>
      <h1>{seconds.toFixed(2)} s</h1>
      <button onClick={start}>Start</button>
      <button onClick={stop}>Stop</button>
    </>
  );
}
```

- Pitfall: do not read or write `ref.current` during rendering (except lazy one-time initialisation). Render output would then depend on a value React cannot track, breaking purity.
- Interview tip: refs are the "escape hatch" for stale-closure problems: a long-lived callback can read `latestRef.current`.

### Refs to DOM nodes and ref as a prop
<!-- level: intermediate; ref: https://react.dev/learn/manipulating-the-dom-with-refs -->
Passing a ref object to a built-in element's `ref` attribute makes React set `ref.current` to the DOM node after commit, and back to `null` on unmount. This is how you focus inputs, measure elements, scroll into view or integrate non-React libraries.

Since React 19, function components can receive `ref` as a normal prop, so `forwardRef` is no longer needed for new code (it still works and will be deprecated gradually). React 19 also lets ref callbacks return a cleanup function, which runs when the element is detached, mirroring effects.

```jsx
import { useRef } from 'react';

// React 19: ref is just a prop
function TextField({ label, ref, ...rest }) {
  return (
    <label>
      {label}
      <input ref={ref} {...rest} />
    </label>
  );
}

function SearchBar() {
  const inputRef = useRef(null);
  return (
    <>
      <TextField label="Search" ref={inputRef} />
      <button onClick={() => inputRef.current.focus()}>Focus</button>
    </>
  );
}

// Ref callback with cleanup (React 19)
function Measured() {
  return (
    <div
      ref={node => {
        const ro = new ResizeObserver(([e]) => console.log(e.contentRect.width));
        ro.observe(node);
        return () => ro.disconnect();
      }}
    />
  );
}
```

- Pitfall: avoid using refs to change DOM that React manages (for example, removing children). React will be confused on the next commit. Restrict yourself to non-destructive actions like focus, scroll and measurement.
- Pitfall: an inline ref callback is a new function each render, so it is detached and re-attached every render unless memoised.

### useImperativeHandle
<!-- level: advanced; ref: https://react.dev/reference/react/useImperativeHandle -->
Sometimes a parent needs to call a method on a child — focus a custom input, open a dialog, play a video — but you do not want to expose the raw DOM node with all its capabilities. `useImperativeHandle(ref, createHandle, deps)` lets a component decide exactly what object the parent's ref receives.

This keeps the child's internals encapsulated: the parent gets a small API (`focus`, `scrollToBottom`) rather than the full DOM node, so you can refactor the child's markup without breaking callers. With React 19 the component simply reads `ref` from its props.

```jsx
import { useImperativeHandle, useRef } from 'react';

function ChatLog({ messages, ref }) {
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useImperativeHandle(ref, () => ({
    scrollToBottom() {
      const el = listRef.current;
      el.scrollTop = el.scrollHeight;
    },
    focusInput() {
      inputRef.current.focus();
    },
  }), []);

  return (
    <div>
      <ul ref={listRef} className="log">
        {messages.map(m => <li key={m.id}>{m.text}</li>)}
      </ul>
      <input ref={inputRef} aria-label="Message" />
    </div>
  );
}

function ChatPage({ messages }) {
  const chatRef = useRef(null);
  return (
    <>
      <ChatLog ref={chatRef} messages={messages} />
      <button onClick={() => chatRef.current.scrollToBottom()}>Latest</button>
    </>
  );
}
```

- Pitfall: imperative handles are an escape hatch. If something can be expressed as a prop (`isOpen`), prefer the prop; imperative APIs are harder to reason about and test.
- Interview tip: mention that this replaces the old `forwardRef` + `useImperativeHandle` combination.

### useMemo
<!-- level: intermediate; ref: https://react.dev/reference/react/useMemo -->
`useMemo(calculate, deps)` caches the result of a calculation between renders. On each render React compares each dependency with its previous value using `Object.is`; if none changed, it returns the cached value instead of running the function again.

It serves two purposes. The first is skipping genuinely expensive computations (filtering or sorting thousands of items, building indexes). The second, often more important, is preserving referential identity: returning the same object or array reference so that a `memo` child or an effect dependency does not see a "new" value every render.

```jsx
import { useMemo, memo } from 'react';

function ProductTable({ products, query, sortBy }) {
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter(p => p.name.toLowerCase().includes(q))
      .toSorted((a, b) => a[sortBy] > b[sortBy] ? 1 : -1);
  }, [products, query, sortBy]);

  const columns = useMemo(() => ({ showPrice: true, currency: 'INR' }), []);

  return <Grid rows={visible} options={columns} />;
}

const Grid = memo(function Grid({ rows, options }) {
  return rows.map(r => <Row key={r.id} row={r} options={options} />);
});
```

How to tell if something is expensive: wrap it in `console.time` in a production-like build with CPU throttling; anything above about 1 ms per render is worth caching.

- Pitfall: `useMemo` is a performance hint, not a semantic guarantee. React may discard the cache (for example, when a component suspends). Your code must still be correct without it.
- Interview tip: with the React Compiler enabled, most manual `useMemo` calls become unnecessary.

### useCallback
<!-- level: intermediate; ref: https://react.dev/reference/react/useCallback -->
`useCallback(fn, deps)` returns the same function instance between renders as long as the dependencies have not changed. It is exactly `useMemo(() => fn, deps)`, specialised for functions.

Functions declared inside a component are recreated on every render. That is normally harmless and cheap. It only matters when the function's identity is observed: when it is passed to a child wrapped in `memo` (a new function defeats the memoisation), when it is a dependency of an effect or another hook, or when it is returned from a custom hook that others will put in dependency arrays.

```jsx
import { useCallback, useState, memo } from 'react';

function TodoApp() {
  const [todos, setTodos] = useState([]);
  const [filter, setFilter] = useState('all');

  // Stable across renders because it uses the updater form, so no deps needed
  const toggle = useCallback(id => {
    setTodos(ts => ts.map(t => (t.id === id ? { ...t, done: !t.done } : t)));
  }, []);

  return (
    <>
      <FilterBar value={filter} onChange={setFilter} />
      <TodoList todos={todos} onToggle={toggle} />
    </>
  );
}

const TodoList = memo(function TodoList({ todos, onToggle }) {
  return todos.map(t => (
    <label key={t.id}>
      <input type="checkbox" checked={t.done} onChange={() => onToggle(t.id)} />
      {t.title}
    </label>
  ));
});
```

Notice the trick: using updater functions removes state from the dependency list, which keeps the callback stable.

- Pitfall: wrapping every handler in `useCallback` without `memo` children only adds overhead and noise.
- Pitfall: a missing dependency gives you a stale closure that silently uses old values.

### useId
<!-- level: basic; ref: https://react.dev/reference/react/useId -->
`useId()` generates a unique string id that is stable for the lifetime of the component and identical on server and client. Its main purpose is connecting accessibility attributes: `htmlFor`/`id` on labels and inputs, `aria-describedby`, `aria-labelledby` and similar.

Why not a counter or `Math.random()`? Ids generated during render would differ between the server HTML and the client hydration, causing hydration mismatches, and a global counter depends on render order, which is not guaranteed. `useId` derives the id from the component's position in the tree, which is the same on both sides.

```jsx
import { useId } from 'react';

function PasswordField({ label }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={`${id}-input`}>{label}</label>
      <input id={`${id}-input`} type="password" aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`}>At least 12 characters, including a number.</p>
    </div>
  );
}

function SignupForm() {
  return (
    <form>
      {/* Two instances, two different ids, no collisions */}
      <PasswordField label="Password" />
      <PasswordField label="Confirm password" />
    </form>
  );
}
```

Call `useId` once per component and derive several ids with suffixes, as above.

- Pitfall: do not use `useId` for list keys. Keys must come from your data.
- Pitfall: the generated id contains colon-like characters in some versions, so it is not safe to use directly in CSS selectors without escaping.

### Custom hooks
<!-- level: intermediate; ref: https://react.dev/learn/reusing-logic-with-custom-hooks -->
A custom hook is a function whose name starts with `use` and which calls other hooks. It is React's mechanism for sharing stateful logic between components — subscriptions, form handling, media queries, online status — without changing the component tree (unlike the older render props and higher-order component patterns).

Custom hooks share logic, not state. Each component that calls `useOnlineStatus()` gets its own independent state and effects. If you need shared state, put it in context or an external store and read it through a hook.

A good custom hook has a narrow, concrete purpose and a name that describes what it does (`useChatRoom`, `useDebouncedValue`), not a lifecycle (`useMount`).

```jsx
import { useEffect, useState } from 'react';

export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = e => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function SearchPage() {
  const [text, setText] = useState('');
  const query = useDebouncedValue(text);
  const isMobile = useMediaQuery('(max-width: 600px)');
  return <Results query={query} compact={isMobile} />;
}
```

- Pitfall: a function that does not call any hooks should not be named `use…`; make it a regular function.

## 6. Effects

### useEffect: synchronising with external systems
<!-- level: basic; ref: https://react.dev/learn/synchronizing-with-effects -->
Effects let a component synchronise with something outside React: a browser API, a WebSocket, a third-party widget, a timer, analytics. `useEffect(setup, deps)` runs `setup` after React has committed the update and the browser has had a chance to paint, so it does not block the screen.

Think of an effect as describing how to start synchronising and how to stop, not as a lifecycle event. React may start and stop synchronisation many times: when dependencies change, it runs the previous cleanup and then the new setup. When the component unmounts, it runs the final cleanup.

The dependency array controls when the effect re-runs. Omitting it means after every render; an empty array means only after mount (and cleanup on unmount); a list means whenever any listed value changed (`Object.is` comparison).

```jsx
import { useEffect, useState } from 'react';

function DocumentTitle({ unread }) {
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Inbox` : 'Inbox';
  }, [unread]);
  return null;
}

function MapWidget({ center, zoom }) {
  const [node, setNode] = useState(null);
  useEffect(() => {
    if (!node) return;
    const map = new ThirdPartyMap(node, { center, zoom });
    return () => map.destroy();
  }, [node, center, zoom]);
  return <div ref={setNode} className="map" />;
}
```

- Interview tip: effects run only on the client, never during server rendering.
- Pitfall: effects are not for transforming data for rendering or for responding to user events — those belong in render logic and event handlers.

### Effect dependencies
<!-- level: intermediate; ref: https://react.dev/learn/removing-effect-dependencies -->
Every reactive value an effect reads — props, state, and anything computed from them in the component body — must be listed in its dependencies. You do not choose dependencies; the code determines them, and the `react-hooks/exhaustive-deps` lint rule checks them. Lying to the linter leads to stale values and bugs that appear only later.

If an effect re-runs too often, the fix is to change the code so it does not need the dependency, not to remove it from the array:

1. Move objects and functions that are only used by the effect inside the effect.
2. Depend on primitives (`options.roomId`) instead of whole objects created during render.
3. Use updater functions (`setCount(c => c + 1)`) to avoid reading state.
4. Move non-reactive logic into an effect event (`useEffectEvent`, React 19.2).
5. Ask whether the code should be an event handler instead.

```jsx
// Problem: options is a new object every render, so the effect reconnects every render
function ChatRoom({ roomId, serverUrl }) {
  const options = { roomId, serverUrl };
  useEffect(() => {
    const c = createConnection(options);
    c.connect();
    return () => c.disconnect();
  }, [options]);
}

// Fix: create the object inside the effect and depend on primitives
function ChatRoomFixed({ roomId, serverUrl }) {
  useEffect(() => {
    const c = createConnection({ roomId, serverUrl });
    c.connect();
    return () => c.disconnect();
  }, [roomId, serverUrl]);
}
```

- Pitfall: `// eslint-disable-next-line react-hooks/exhaustive-deps` is almost always hiding a real bug.
- Interview tip: refs and setter functions from `useState`/`useReducer` are stable and may be omitted.

### Effect cleanup
<!-- level: intermediate; ref: https://react.dev/reference/react/useEffect -->
The function you return from an effect is its cleanup. React calls it before re-running the effect with new dependencies and when the component unmounts. Cleanup must undo whatever setup did: unsubscribe, clear timers, remove listeners, close connections, abort requests, destroy widgets.

A useful mental test is "setup → cleanup → setup should behave the same as a single setup". StrictMode enforces this in development by running an extra cycle on mount. If users would notice the difference, your cleanup is incomplete.

For data fetching, cleanup prevents race conditions: when props change quickly, older requests may finish after newer ones. Aborting the request, or ignoring results with a flag, ensures only the latest response is used.

```jsx
function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

function Ticker({ symbol }) {
  const [price, setPrice] = useState(null);
  useEffect(() => {
    const ws = new WebSocket(`wss://quotes.example.com/${symbol}`);
    ws.onmessage = e => setPrice(JSON.parse(e.data).price);
    return () => ws.close(); // runs when symbol changes or on unmount
  }, [symbol]);
  return <span>{symbol}: {price ?? '…'}</span>;
}
```

- Pitfall: removing a listener requires the same function reference that was added; an inline arrow in `removeEventListener` does nothing.
- Pitfall: an `async` function cannot be the effect itself because it returns a promise, not a cleanup. Define an async function inside and call it.

### You might not need an effect
<!-- level: intermediate; ref: https://react.dev/learn/you-might-not-need-an-effect -->
Effects are an escape hatch for synchronising with external systems. A large share of effects in real codebases do not involve any external system and should not exist. They add an extra render pass, cause flicker, and create chains of updates that are hard to follow.

Common cases and their replacements:

1. Deriving data from props or state: compute it during render (with `useMemo` if expensive).
2. Resetting all state when a prop changes: pass a `key`.
3. Adjusting some state when a prop changes: usually restructure, or compute during render.
4. Doing something because the user clicked: do it in the event handler.
5. Notifying the parent of a change: call the parent's callback in the same handler that changes state.
6. Chains of effects that set state that triggers other effects: compute the next state in one handler or reducer.

```jsx
// Unnecessary effect: extra render and a frame of stale data
function TodoListBad({ todos, filter }) {
  const [visible, setVisible] = useState([]);
  useEffect(() => {
    setVisible(todos.filter(t => matches(t, filter)));
  }, [todos, filter]);
  return <List items={visible} />;
}

// Correct: derive during render
function TodoList({ todos, filter }) {
  const visible = useMemo(() => todos.filter(t => matches(t, filter)), [todos, filter]);
  return <List items={visible} />;
}

// Event-specific logic belongs in the handler
function BuyButton({ product, onBought }) {
  async function handleClick() {
    await addToCart(product.id);
    showToast(`Added ${product.name}`);
    onBought(product);
  }
  return <button onClick={handleClick}>Buy</button>;
}
```

- Interview tip: ask "why does this code run?" If the answer is "because the user did X", it belongs in a handler; if it is "because the component is displayed", it may be an effect.

### useLayoutEffect and useInsertionEffect
<!-- level: advanced; ref: https://react.dev/reference/react/useLayoutEffect -->
`useLayoutEffect` has the same signature as `useEffect` but runs synchronously after React has mutated the DOM and before the browser paints. Any state update made inside it is processed synchronously too, so the user never sees the intermediate frame.

Use it when you must measure layout and immediately adjust what is rendered — positioning a tooltip relative to its anchor, scrolling to preserve position, measuring text to decide truncation. With `useEffect`, the user could see the tooltip flash in the wrong place for one frame.

The cost is that it blocks painting, so heavy work in it makes the UI janky. During server rendering it does nothing (there is no layout), and older React versions warned about that.

`useInsertionEffect` runs even earlier, before layout effects, and exists only for CSS-in-JS libraries to inject `<style>` tags before anything reads layout. Application code should not need it.

```jsx
import { useLayoutEffect, useRef, useState } from 'react';

function Tooltip({ anchorRect, children }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    setHeight(ref.current.getBoundingClientRect().height);
  }, [children]);

  const top = anchorRect.top - height < 0
    ? anchorRect.bottom + 8          // not enough room above: show below
    : anchorRect.top - height - 8;

  return (
    <div ref={ref} className="tooltip" style={{ position: 'fixed', top, left: anchorRect.left }}>
      {children}
    </div>
  );
}
```

- Pitfall: reaching for `useLayoutEffect` by default; prefer `useEffect` unless you can see a flicker.

### Effect events with useEffectEvent
<!-- level: advanced; ref: https://react.dev/reference/react/useEffectEvent -->
Sometimes an effect needs to read a value without reacting to it. Example: a chat effect should reconnect when `roomId` changes, but showing a "connected" toast should use the current `theme` without reconnecting when the theme changes. Listing `theme` as a dependency causes needless reconnections; omitting it gives a stale value and a lint error.

`useEffectEvent` (stable since React 19.2, October 2025) solves this. It wraps a function so that it always sees the latest props and state, while its identity is not reactive and must not be listed in dependencies. Conceptually it separates the reactive part of an effect (what triggers re-synchronisation) from the non-reactive part (what happens in response).

```jsx
import { useEffect, useEffectEvent } from 'react';

function ChatRoom({ roomId, theme }) {
  const onConnected = useEffectEvent(() => {
    showNotification('Connected!', theme); // always the latest theme
  });

  useEffect(() => {
    const connection = createConnection(roomId);
    connection.on('connected', () => onConnected());
    connection.connect();
    return () => connection.disconnect();
  }, [roomId]); // theme is not a dependency, and the linter agrees

  return <h1>Welcome to {roomId}</h1>;
}
```

Restrictions: only call the returned function from inside effects (including callbacks they set up), never during rendering, and do not pass it to other components or hooks.

- Pitfall: using it to silence the dependency linter for values that really should re-run the effect.
- Interview tip: before 19.2 people emulated this with a "latest ref" pattern (`ref.current = callback` in a layout effect); `useEffectEvent` is the supported replacement.
