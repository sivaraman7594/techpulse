## 7. Context and state architecture

### Context basics
<!-- level: basic; ref: https://react.dev/learn/passing-data-deeply-with-context -->
Context lets a parent make a value available to every component below it, at any depth, without passing it through every intermediate component as props ("prop drilling"). It is designed for values that many components need: the current theme, the signed-in user, locale, feature flags, or a store's dispatch function.

You create a context with a default value, provide a value somewhere up the tree, and read it with `useContext` (or the React 19 `use` API). A component reads the value from the nearest provider above it; if there is none, it gets the default. In React 19 you can render `<ThemeContext value={...}>` directly as the provider; `<ThemeContext.Provider>` still works but is on a deprecation path.

```jsx
import { createContext, useContext, useState } from 'react';

const ThemeContext = createContext('light');

export function App() {
  const [theme, setTheme] = useState('light');
  return (
    <ThemeContext value={theme}>
      <Toolbar />
      <button onClick={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}>
        Toggle theme
      </button>
    </ThemeContext>
  );
}

function Toolbar() {
  return <nav><SaveButton /></nav>; // no theme prop passed through
}

function SaveButton() {
  const theme = useContext(ThemeContext);
  return <button className={`btn-${theme}`}>Save</button>;
}
```

Providers can be nested and overridden: a subtree can provide a different value to its descendants.

- Pitfall: context is not a state manager. It only transports a value; the state still lives in some component's `useState`/`useReducer`.
- Interview tip: before reaching for context, consider passing JSX as `children`, which often removes the drilling entirely.

### Context performance
<!-- level: advanced; ref: https://react.dev/reference/react/useContext#optimizing-re-renders-when-passing-objects-and-functions -->
When a provider's value changes (compared with `Object.is`), React re-renders every component that reads that context, and it does so even if the consumer is inside a `memo` component. There is no built-in way to subscribe to only part of a context value.

Two common mistakes make this expensive. First, passing a new object literal as the value (`value={{ user, login }}`) creates a new reference on every render of the provider, so all consumers re-render whenever the provider re-renders for any reason. Second, putting rapidly changing and rarely changing data in the same context, so every keystroke updates consumers that only needed a stable function.

Fixes, roughly in order:

1. Memoise the value with `useMemo` and functions with `useCallback`.
2. Split contexts: one for state, one for dispatch/actions (dispatch is stable).
3. Keep fast-changing state local or in an external store with selectors (Zustand, Redux, `useSyncExternalStore`).

```jsx
const AuthStateContext = createContext(null);
const AuthActionsContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  const actions = useMemo(() => ({
    login: async creds => setUser(await api.login(creds)),
    logout: () => setUser(null),
  }), []);

  return (
    <AuthActionsContext value={actions}>
      <AuthStateContext value={user}>{children}</AuthStateContext>
    </AuthActionsContext>
  );
}

export const useUser = () => useContext(AuthStateContext);
export const useAuthActions = () => useContext(AuthActionsContext);
```

Components that only call `logout` now never re-render when the user object changes.

### Scaling with reducer and context
<!-- level: intermediate; ref: https://react.dev/learn/scaling-up-with-reducer-and-context -->
A powerful built-in pattern for medium-sized features is combining `useReducer` with context. The reducer centralises update logic; one context provides the state, another provides `dispatch`. Any component in the subtree can read state or dispatch actions without prop drilling, and you get a small, dependency-free store.

Wrap everything in a provider component and expose custom hooks, so consumers never touch the contexts directly. The hooks can also throw a helpful error when used outside the provider.

```jsx
import { createContext, useContext, useReducer } from 'react';

const TasksContext = createContext(null);
const TasksDispatchContext = createContext(null);

function tasksReducer(tasks, action) {
  switch (action.type) {
    case 'added':
      return [...tasks, { id: action.id, text: action.text, done: false }];
    case 'toggled':
      return tasks.map(t => (t.id === action.id ? { ...t, done: !t.done } : t));
    case 'deleted':
      return tasks.filter(t => t.id !== action.id);
    default:
      throw new Error('Unknown action ' + action.type);
  }
}

export function TasksProvider({ children }) {
  const [tasks, dispatch] = useReducer(tasksReducer, []);
  return (
    <TasksContext value={tasks}>
      <TasksDispatchContext value={dispatch}>{children}</TasksDispatchContext>
    </TasksContext>
  );
}

export function useTasks() {
  const ctx = useContext(TasksContext);
  if (ctx === null) throw new Error('useTasks must be used inside <TasksProvider>');
  return ctx;
}

export const useTasksDispatch = () => useContext(TasksDispatchContext);
```

- Pitfall: this pattern re-renders every `useTasks` consumer on every change. When the state is large and updated often, move to a store with selector-based subscriptions.

### useSyncExternalStore
<!-- level: advanced; ref: https://react.dev/reference/react/useSyncExternalStore -->
`useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?)` lets a component read data from a store that lives outside React — a state library, a browser API like `navigator.onLine`, or a custom event emitter — in a way that is safe under concurrent rendering.

Why not just `useState` plus a subscription in `useEffect`? With concurrent rendering, React can render part of a tree, yield, and continue later. If an external store changes in between, different components could show different versions of the data ("tearing"). `useSyncExternalStore` detects this and forces a consistent synchronous re-render. It also handles subscription timing and server rendering correctly.

`getSnapshot` must return the same value (by `Object.is`) when the store has not changed; returning a new object each call causes an infinite render loop.

```jsx
import { useSyncExternalStore } from 'react';

function subscribe(callback) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function useOnlineStatus() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,   // client snapshot
    () => true                // server snapshot
  );
}

function SaveButton() {
  const online = useOnlineStatus();
  return <button disabled={!online}>{online ? 'Save' : 'Reconnecting…'}</button>;
}
```

- Interview tip: libraries such as Redux (react-redux), Zustand and Jotai are built on this hook.
- Pitfall: define `subscribe` outside the component or memoise it, or React will resubscribe on every render.

### Choosing where state lives
<!-- level: intermediate; ref: https://react.dev/learn/managing-state -->
Good state architecture starts with classifying state, because each kind has a natural home:

1. Local UI state (is this menu open, current input text): `useState` in the component that uses it.
2. Shared UI state for a subtree (selected tab across panels): lift to the common parent; use reducer plus context if many components need it.
3. Server state (data owned by an API): a cache such as TanStack Query, SWR, RTK Query, or the framework's loaders and Server Components. It needs caching, deduplication, refetching and invalidation, which hand-written state does not provide.
4. URL state (filters, page number, selected id): the URL search params, so it survives reloads and can be shared.
5. Global client state (cart, complex editors): an external store (Zustand, Redux Toolkit, Jotai) with selectors.
6. Form state: native forms with actions, or a form library for complex validation.

Then keep the state minimal: avoid duplicate and derived values, avoid contradictory booleans (`isLoading` and `isError` both true), and prefer a status enum.

```jsx
// Contradictions possible
const [isSending, setIsSending] = useState(false);
const [isSent, setIsSent] = useState(false);

// Single source of truth
const [status, setStatus] = useState('typing'); // 'typing' | 'sending' | 'sent'

// URL state with React Router
const [params, setParams] = useSearchParams();
const page = Number(params.get('page') ?? 1);
```

- Interview tip: the most common anti-pattern in interviews is copying server data into a global store and hand-syncing it. Name server state as a separate category.

## 8. Forms and actions

### Controlled and uncontrolled inputs
<!-- level: basic; ref: https://react.dev/reference/react-dom/components/input -->
A controlled input gets its `value` (or `checked`) from React state and reports every change through `onChange`. React is the single source of truth: you can validate, transform or reject input on every keystroke, and the displayed value always matches state.

An uncontrolled input keeps its own value in the DOM. You give it an initial `defaultValue` and read the value when needed — through `FormData` on submit or through a ref. Uncontrolled inputs are less code and avoid a re-render per keystroke, which matters for large forms.

React 19's form actions make uncontrolled forms the natural default: the action receives `FormData` and you rarely need to mirror every field in state. Use controlled inputs when the UI must react to each change (live validation, formatting, dependent fields, character counters).

```jsx
// Controlled
function Username() {
  const [name, setName] = useState('');
  const valid = /^[a-z0-9_]{3,16}$/.test(name);
  return (
    <>
      <input value={name} onChange={e => setName(e.target.value.toLowerCase())} />
      {!valid && name && <small>3–16 lowercase letters, digits or _</small>}
    </>
  );
}

// Uncontrolled
function Feedback() {
  function handleSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    sendFeedback(data);
  }
  return (
    <form onSubmit={handleSubmit}>
      <textarea name="message" defaultValue="" />
      <button>Send</button>
    </form>
  );
}
```

- Pitfall: passing `value` without `onChange` makes a read-only input; React warns about it.
- Pitfall: switching between `value={undefined}` and a string flips the input from uncontrolled to controlled. Initialise with `''`.

### Form actions (React 19)
<!-- level: intermediate; ref: https://react.dev/reference/react-dom/components/form -->
In React 19 the `<form>` element's `action` prop (and `formAction` on buttons) accepts a function. When the form is submitted, React calls it with the form's `FormData`, inside a transition. You do not call `preventDefault`, and React tracks the pending state for you. After a successful action React resets uncontrolled fields automatically.

Actions can be synchronous or async, and they can be client functions or Server Functions (marked `'use server'`). With a Server Function in a framework that supports it, the form even works before JavaScript loads (progressive enhancement), because React renders a real form post.

```jsx
function NewsletterForm() {
  async function subscribe(formData) {
    const email = formData.get('email');
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  }

  return (
    <form action={subscribe}>
      <input type="email" name="email" required />
      <button type="submit">Subscribe</button>
      <button formAction={unsubscribeAction}>Unsubscribe</button>
    </form>
  );
}
```

Errors thrown by an action propagate to the nearest error boundary. For expected errors (validation, "email already used") return a result instead, using `useActionState`.

- Interview tip: actions unify "submit handler + loading flag + error state + optimistic update" into one model. The building blocks are `useActionState`, `useFormStatus` and `useOptimistic`.
- Pitfall: actions run inside a transition, so state updates after an `await` were not automatically part of the transition in early 19.x; wrap them in `startTransition` if you see flickers.

### useActionState
<!-- level: intermediate; ref: https://react.dev/reference/react/useActionState -->
`useActionState(action, initialState, permalink?)` wraps an action so that its return value becomes state. It returns `[state, formAction, isPending]`. You pass `formAction` to a form or button; when it runs, React calls your action with the previous state and the form data, and stores whatever it returns as the new state.

This is ideal for form results: validation errors, success messages, the server's response. Calls are queued and run in order, and `isPending` is true while one is in flight. With Server Functions and a framework, the optional permalink lets the form work before hydration.

```jsx
import { useActionState } from 'react';

async function updateProfile(prevState, formData) {
  const name = formData.get('name')?.trim();
  if (!name) return { ok: false, error: 'Name is required' };

  const res = await fetch('/api/profile', {
    method: 'PUT',
    body: formData,
  });
  if (!res.ok) return { ok: false, error: 'Could not save, try again' };
  return { ok: true, error: null, savedAt: Date.now() };
}

export function ProfileForm({ user }) {
  const [state, formAction, isPending] = useActionState(updateProfile, { ok: null });

  return (
    <form action={formAction}>
      <input name="name" defaultValue={user.name} aria-invalid={state.ok === false} />
      <button disabled={isPending}>{isPending ? 'Saving…' : 'Save'}</button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.ok && <p>Saved.</p>}
    </form>
  );
}
```

- Pitfall: the action's first parameter is the previous state, not the form data. Forgetting this is the most common mistake when converting an existing action.
- Interview tip: this hook was briefly called `useFormState` in React canaries (in `react-dom`); the final API lives in `react`.

### useFormStatus
<!-- level: intermediate; ref: https://react.dev/reference/react-dom/hooks/useFormStatus -->
`useFormStatus()` from `react-dom` returns the status of the parent `<form>` submission: `{ pending, data, method, action }`. It lets deeply nested components such as a reusable submit button know whether the form they live in is submitting, without passing an `isPending` prop through every layer.

The key restriction is that it reads the status of the form that contains the component calling the hook. It must therefore be called from a component rendered inside the `<form>`, not from the component that renders the form itself.

```jsx
import { useFormStatus } from 'react-dom';

function SubmitButton({ children }) {
  const { pending, data } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? `Sending ${data?.get('title') ?? ''}…` : children}
    </button>
  );
}

export function NewPostForm() {
  async function createPost(formData) {
    await api.posts.create(Object.fromEntries(formData));
  }
  return (
    <form action={createPost}>
      <input name="title" required />
      <textarea name="body" />
      <SubmitButton>Publish</SubmitButton>
    </form>
  );
}
```

`data` exposes the submitted `FormData`, which is handy for showing what is being sent.

- Pitfall: calling `useFormStatus` in the same component that renders `<form>` always returns `pending: false`.
- Interview tip: design systems use this hook to build buttons that automatically show spinners in any form.

### useOptimistic
<!-- level: advanced; ref: https://react.dev/reference/react/useOptimistic -->
Optimistic UI shows the expected result of an action immediately, before the server confirms it, then reconciles with the real result. `useOptimistic(state, updateFn)` gives you a temporary version of some state that exists only while an action (transition) is pending.

You call `addOptimistic(value)` inside an action; React applies `updateFn(currentState, value)` to produce the optimistic state. When the action finishes, React discards the optimistic state and renders the real state again. If the action succeeded, the real state now contains the item; if it failed, the optimistic item simply disappears, so rollback is automatic.

```jsx
import { useOptimistic } from 'react';

function Thread({ messages, sendMessage }) {
  const [optimisticMessages, addOptimistic] = useOptimistic(
    messages,
    (current, text) => [...current, { id: `tmp-${current.length}`, text, sending: true }]
  );

  async function formAction(formData) {
    const text = formData.get('message');
    addOptimistic(text);
    await sendMessage(text); // parent updates `messages` when the server replies
  }

  return (
    <>
      <ul>
        {optimisticMessages.map(m => (
          <li key={m.id} style={{ opacity: m.sending ? 0.5 : 1 }}>{m.text}</li>
        ))}
      </ul>
      <form action={formAction}>
        <input name="message" autoComplete="off" />
        <button>Send</button>
      </form>
    </>
  );
}
```

- Pitfall: calling `addOptimistic` outside an action or transition triggers a warning and the update is dropped immediately.
- Pitfall: optimistic UI is wrong for irreversible or high-stakes operations (payments); show a pending state instead.

### Accessible, validated forms
<!-- level: intermediate; ref: https://react.dev/reference/react-dom/components/input -->
A form is only finished when everyone can use it and invalid data is caught at the right layer. In React that means combining native HTML features with a little state.

Start with semantics: every input needs a programmatically associated `<label>` (`htmlFor` + `id`, generated with `useId`), group related controls with `<fieldset>`/`<legend>`, and use the correct `type` (`email`, `tel`, `number`) and `autoComplete` values. Native constraint attributes (`required`, `minLength`, `pattern`) give free browser validation.

Then report errors accessibly: link each message with `aria-describedby`, set `aria-invalid`, announce summary errors with `role="alert"`, and move focus to the first invalid field after a failed submit. Validate on the server too: client checks are for convenience, not security. For complex forms, libraries like React Hook Form (uncontrolled, ref-based) plus a schema validator (Zod, Valibot) avoid re-rendering per keystroke.

```jsx
function EmailField({ error }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>Work email</label>
      <input
        id={id}
        name="email"
        type="email"
        autoComplete="email"
        required
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      {error && <p id={`${id}-err`} className="error">{error}</p>}
    </div>
  );
}
```

- Pitfall: placeholders are not labels; they disappear when typing and often fail contrast.
- Pitfall: disabling the submit button until the form is valid hides why it is disabled. Prefer allowing submit and showing errors.

## 9. Performance

### memo
<!-- level: intermediate; ref: https://react.dev/reference/react/memo -->
`memo(Component, arePropsEqual?)` returns a memoised component that skips re-rendering when its parent re-renders with props that are shallowly equal to the previous ones. Each prop is compared with `Object.is`. You can supply a custom comparison function, but it is easy to get wrong.

`memo` is effective only when the props really are stable. Primitive props usually are. Objects, arrays, functions and JSX created during the parent's render are new references every time, so they defeat memoisation unless the parent stabilises them with `useMemo`/`useCallback` or moves them out of the component.

A memoised component still re-renders when its own state changes or when a context it reads changes.

```jsx
import { memo, useCallback, useMemo, useState } from 'react';

const Chart = memo(function Chart({ points, onSelect }) {
  // expensive SVG rendering
  return <svg>{points.map(p => <circle key={p.id} cx={p.x} cy={p.y} r={3} onClick={() => onSelect(p.id)} />)}</svg>;
});

function Dashboard({ readings }) {
  const [note, setNote] = useState('');
  const points = useMemo(() => readings.map(toPoint), [readings]);
  const onSelect = useCallback(id => console.log('selected', id), []);

  return (
    <>
      <input value={note} onChange={e => setNote(e.target.value)} />
      <Chart points={points} onSelect={onSelect} /> {/* skipped while typing */}
    </>
  );
}
```

- Pitfall: `memo` on cheap components adds comparison overhead for nothing. Profile first.
- Pitfall: a custom `arePropsEqual` that ignores function props can cause stale callbacks.

### React Compiler
<!-- level: advanced; ref: https://react.dev/learn/react-compiler -->
React Compiler is a build-time tool (a Babel plugin, also integrated into Vite, Next.js and Expo setups) that automatically memoises components and hooks. Version 1.0 was released as stable in October 2025. It analyses your code's data flow and inserts fine-grained caching, so values, JSX and callbacks are only recomputed when their inputs change. In effect it applies `memo`, `useMemo` and `useCallback` everywhere they help, with more precision than hand-written code (it can even memoise after a conditional return).

The compiler relies on your code following the Rules of React: pure rendering, no mutation of props or state, hooks called correctly. Components that break the rules are skipped rather than miscompiled, and the companion ESLint rules (in `eslint-plugin-react-hooks`) report those violations.

```jsx
// You write plain code...
function ProductList({ products, filter, onSelect }) {
  const visible = products.filter(p => p.category === filter);
  const handleClick = id => onSelect(id);
  return visible.map(p => <ProductRow key={p.id} product={p} onClick={handleClick} />);
}
// ...and the compiler caches `visible`, `handleClick` and the JSX,
// recomputing them only when products, filter or onSelect change.
```

Adoption can be incremental: enable it for a directory, or opt specific files in or out with the `'use memo'` and `'use no memo'` directives.

- Interview tip: the compiler does not make slow algorithms fast or reduce the cost of rendering huge lists; virtualisation and code splitting are still needed.
- Pitfall: existing manual memoisation is fine to keep; removing it should be done carefully because it can change effect firing when dependencies were relied upon.

### useTransition and startTransition
<!-- level: advanced; ref: https://react.dev/reference/react/useTransition -->
A transition marks a state update as non-urgent. `const [isPending, startTransition] = useTransition()` gives you a function to wrap such updates and a flag that is true while they are being processed.

React renders transition updates in the background, in a separate lane. If an urgent update arrives (typing, clicking), React interrupts the transition render, handles the urgent update, then restarts the transition with the latest state. The previous UI stays on screen and interactive meanwhile, rather than freezing. Transitions also integrate with Suspense: navigating inside a transition keeps the current page visible instead of replacing it with a fallback.

In React 19 the function passed to `startTransition` can be async; updates after `await` must be wrapped in another `startTransition` call to be marked as transitions (a current limitation).

```jsx
import { useState, useTransition } from 'react';

function TabContainer() {
  const [tab, setTab] = useState('about');
  const [isPending, startTransition] = useTransition();

  function selectTab(next) {
    startTransition(() => setTab(next)); // the slow Posts tab will not block clicks
  }

  return (
    <>
      <nav style={{ opacity: isPending ? 0.6 : 1 }}>
        <button onClick={() => selectTab('about')}>About</button>
        <button onClick={() => selectTab('posts')}>Posts (slow)</button>
        <button onClick={() => selectTab('contact')}>Contact</button>
      </nav>
      {tab === 'about' && <About />}
      {tab === 'posts' && <Posts />}
      {tab === 'contact' && <Contact />}
    </>
  );
}
```

- Pitfall: you cannot use a transition for a controlled input's own value; text input updates must be urgent, or typing becomes laggy.
- Interview tip: `startTransition` (the standalone import) works outside components but gives no `isPending`.

### useDeferredValue
<!-- level: advanced; ref: https://react.dev/reference/react/useDeferredValue -->
`useDeferredValue(value, initialValue?)` returns a version of a value that may lag behind the latest one. On an update, React first re-renders with the old deferred value (fast, because memoised parts are skipped), then tries a background render with the new value. If the value changes again before that finishes, React abandons the stale background render and starts over.

It solves the same problem as transitions when you do not control the state update, for example when the value arrives as a prop or from a third-party hook. A common pattern: keep the input urgent and pass a deferred query to an expensive, memoised list.

Unlike debouncing, there is no fixed delay. On fast devices the deferred render happens almost immediately; on slow devices it adapts to available CPU, and the background render is interruptible, so it never blocks typing.

```jsx
import { memo, useDeferredValue, useState } from 'react';

function SearchPage({ products }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search 10,000 products" />
      <div style={{ opacity: isStale ? 0.5 : 1 }}>
        <ProductResults products={products} query={deferredQuery} />
      </div>
    </>
  );
}

const ProductResults = memo(function ProductResults({ products, query }) {
  const q = query.toLowerCase();
  return products.filter(p => p.name.toLowerCase().includes(q)).map(p => <Row key={p.id} p={p} />);
});
```

- Pitfall: without `memo` on the expensive child, the first (old-value) render is not cheap and you gain nothing.
- Pitfall: deferral does not reduce network requests; use debouncing for that.

### Code splitting with lazy
<!-- level: intermediate; ref: https://react.dev/reference/react/lazy -->
Bundlers put all statically imported code into the initial download unless you split it. `lazy(() => import('./Heavy'))` defines a component whose code is loaded only when it is first rendered. While the code is loading, the component suspends, and the nearest `<Suspense>` boundary shows its fallback.

Good split points are routes, rarely opened dialogs, editors, charts and admin areas: anything large that most users do not need on the first screen. Frameworks split by route automatically.

The `import()` must resolve to a module whose default export is a component. Declare lazy components at module top level, never inside a component, or the lazy component's identity changes every render and its state resets.

```jsx
import { lazy, Suspense, useState } from 'react';

const MarkdownEditor = lazy(() => import('./MarkdownEditor'));
const SalesChart = lazy(() =>
  import('./charts').then(m => ({ default: m.SalesChart })) // named export
);

export function Post({ canEdit }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      {canEdit && <button onClick={() => setEditing(true)}>Edit</button>}
      {editing && (
        <Suspense fallback={<p>Loading editor…</p>}>
          <MarkdownEditor />
        </Suspense>
      )}
    </>
  );
}

// Warm the chunk on hover so the click feels instant
const preloadEditor = () => import('./MarkdownEditor');
```

- Pitfall: if a chunk fails to load (for example after a deployment removed old files), `lazy` throws; wrap boundaries in an error boundary with a "reload" option.
- Interview tip: inspect bundle composition with a bundle analyser before choosing split points.

### List virtualisation
<!-- level: intermediate; ref: https://react.dev/learn/rendering-lists -->
Rendering thousands of rows creates thousands of DOM nodes and component instances. Even if each is cheap, the total cost of rendering, layout, memory and style recalculation makes scrolling and typing sluggish. Virtualisation (windowing) renders only the rows currently visible in the viewport, plus a small overscan buffer, and positions them inside a container sized to the full list height. As the user scrolls, rows are recycled.

React has no built-in virtualiser; common libraries are TanStack Virtual (headless, works with any markup), react-window and react-virtuoso (handles variable heights and chat-style reverse lists).

```jsx
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

function LogViewer({ lines }) {
  const parentRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  return (
    <div ref={parentRef} style={{ height: 480, overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(item => (
          <div
            key={item.key}
            style={{ position: 'absolute', top: 0, transform: `translateY(${item.start}px)`, height: item.size }}
          >
            {lines[item.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
```

Trade-offs: in-page find (Ctrl+F) cannot see unrendered rows, screen readers see only part of the list (set `aria-rowcount`/`aria-setsize`), and variable-height rows need measurement. For a few hundred rows, pagination or `content-visibility: auto` in CSS may be simpler.

- Pitfall: virtualising but then filtering the full list on every keystroke still burns CPU; memoise the filter too.

### Profiling React apps
<!-- level: intermediate; ref: https://react.dev/reference/react/Profiler -->
Performance work should begin with measurement, not guesses. React offers several tools:

1. React DevTools Profiler: record an interaction, then inspect a flame graph of every commit, how long each component took, and (with the setting enabled) why it rendered — props changed, state changed, hooks changed, or parent rendered.
2. "Highlight updates when components render" in DevTools, for a quick visual of render storms.
3. The `<Profiler id onRender>` component, which reports timing programmatically and can feed production monitoring.
4. React Performance Tracks (React 19.2+) in the Chrome DevTools Performance panel, showing scheduler lanes, component renders and effects alongside browser work.

Always profile a production build (development mode is several times slower and includes StrictMode double renders). Use CPU throttling to approximate low-end devices, and pair React tools with Core Web Vitals, especially Interaction to Next Paint (INP).

```jsx
import { Profiler } from 'react';

function onRender(id, phase, actualDuration, baseDuration) {
  if (actualDuration > 16) {
    reportMetric({ id, phase, actualDuration, baseDuration });
  }
}

export function App() {
  return (
    <Profiler id="Inbox" onRender={onRender}>
      <Inbox />
    </Profiler>
  );
}
```

`actualDuration` is the time spent rendering this commit; `baseDuration` estimates the cost of rendering the whole subtree without memoisation. A big gap between them means memoisation is working.

- Pitfall: optimising components that take 0.2 ms while the real cost is a long task in a third-party script.
