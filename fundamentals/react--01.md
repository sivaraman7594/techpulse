## 1. Getting started with React and JSX

### What React is
<!-- level: basic; ref: https://react.dev/learn -->
React is a JavaScript library for building user interfaces out of components: small functions that take data and return a description of what the screen should look like. Instead of writing step-by-step DOM instructions ("find this element, change its text, add a class"), you describe the UI for the current state, and React works out the minimal DOM changes needed when that state changes. This is called a declarative model.

Under the hood React keeps a tree of the elements your components returned last time. When something changes, it calls the affected components again, compares the new output with the previous one, and applies only the differences to the real DOM (or to native views with React Native).

React itself is only the rendering layer. Routing, data fetching, bundling and server rendering come from tools around it, which is why the React team recommends starting new apps with a framework such as Next.js or React Router (framework mode), or with Vite for a client-only app.

```jsx
function Greeting({ name }) {
  return <h1>Hello, {name}!</h1>;
}

export default function App() {
  return <Greeting name="Asha" />;
}
```

- Interview tip: describe React as "UI = f(state)". Components are pure functions of props and state; React owns the DOM updates.
- Pitfall: Create React App is deprecated (2025). Do not start new projects with it.

### JSX syntax
<!-- level: basic; ref: https://react.dev/learn/writing-markup-with-jsx -->
JSX is a syntax extension that lets you write markup inside JavaScript. It is not HTML and not a template language: a compiler (Babel, SWC, esbuild or TypeScript) turns every tag into a function call. With the modern "automatic runtime", `<div className="box">Hi</div>` becomes roughly `jsx("div", { className: "box", children: "Hi" })`, which returns a plain object called a React element. Because JSX compiles to JavaScript, you get the full power of the language around it and type checking from TypeScript.

JSX has a few rules that differ from HTML:

1. A component must return a single root element (wrap siblings in a fragment `<>...</>`).
2. Every tag must be closed, including `<img />` and `<br />`.
3. Attributes use camelCase: `className` instead of `class`, `htmlFor` instead of `for`, `onClick` instead of `onclick`.
4. Inline `style` takes an object, not a string.

```jsx
export default function Avatar({ user }) {
  return (
    <>
      <img className="avatar" src={user.photoUrl} alt={user.name} />
      <label htmlFor="bio" style={{ fontWeight: 600 }}>Bio</label>
    </>
  );
}
```

- Pitfall: returning multiple adjacent tags without a wrapper is a compile error.
- Interview tip: since React 17 you no longer need `import React` in every file, because the automatic runtime imports the `jsx` helper for you.

### Embedding JavaScript with curly braces
<!-- level: basic; ref: https://react.dev/learn/javascript-in-jsx-with-curly-braces -->
Inside JSX, curly braces open a "window" back into JavaScript. Any expression can go there: a variable, a function call, a ternary, a template string, an array of elements. Statements such as `if`, `for` or `switch` cannot, because the braces must produce a value. You can use braces in two places: as text content between tags, and as attribute values instead of quotes.

The "double curlies" you see in `style={{ color: 'red' }}` are not special syntax. The outer pair means "JavaScript here", and the inner pair is an object literal.

React escapes strings rendered inside braces, so `{userInput}` cannot inject HTML. That is a built-in protection against cross-site scripting. The only way to inject raw HTML is the deliberately scary `dangerouslySetInnerHTML` prop.

```jsx
const today = new Date();

export default function TodoHeader({ owner, count }) {
  return (
    <header title={`${owner}'s list`}>
      <h2>{owner.toUpperCase()}'s todos ({count})</h2>
      <p>{today.toLocaleDateString('en-GB')}</p>
      <p>{count === 0 ? 'Nothing to do!' : `${count} remaining`}</p>
    </header>
  );
}
```

- Pitfall: `{count && <Badge />}` renders `0` when count is 0, because 0 is a valid value React will print. Use `count > 0 && ...`.
- Pitfall: never pass unsanitised user HTML to `dangerouslySetInnerHTML`.

### Function components
<!-- level: basic; ref: https://react.dev/learn/your-first-component -->
A component is a JavaScript function whose name starts with a capital letter and that returns JSX (or `null`, a string, a number or an array). The capital letter matters: JSX treats lowercase tags such as `<section>` as built-in DOM elements and capitalised tags such as `<Profile>` as components to call.

Components are the unit of reuse and composition in React. You build small components (Button, Avatar), combine them into bigger ones (UserCard), and eventually into pages. Each usage of a component is an independent instance with its own state.

Class components (`class X extends React.Component`) still work, but all new features — hooks, Server Components, the compiler — target function components. The only thing classes still uniquely provide is error boundaries.

```jsx
function Avatar({ src, name }) {
  return <img className="avatar" src={src} alt={name} width={48} />;
}

export default function UserCard({ user }) {
  return (
    <article className="card">
      <Avatar src={user.avatar} name={user.name} />
      <h3>{user.name}</h3>
    </article>
  );
}
```

- Pitfall: never define a component inside another component's body. Each render creates a brand-new component type, so React unmounts and remounts it every time, losing state and focus.
- Interview tip: React calls your component; you never call `UserCard()` directly as a function in JSX.

### Fragments
<!-- level: basic; ref: https://react.dev/reference/react/Fragment -->
A fragment groups several children without adding an extra node to the DOM. This matters because a component must return one root, but adding a wrapping `<div>` can break CSS layouts (flexbox, grid, tables) and adds noise to the DOM.

There are two syntaxes. The short form `<>...</>` covers most cases. The long form `<Fragment>` (imported from `react`) is needed when you must pass a `key`, typically when mapping a list where each item renders several siblings.

```jsx
import { Fragment } from 'react';

function Glossary({ terms }) {
  return (
    <dl>
      {terms.map(term => (
        <Fragment key={term.id}>
          <dt>{term.word}</dt>
          <dd>{term.meaning}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Row() {
  return (
    <>
      <td>Name</td>
      <td>Role</td>
    </>
  );
}
```

Fragments are invisible to the DOM but visible to React: a fragment is still a position in the element tree, so switching between `<>A</>` and `<div>A</div>` changes structure and resets state below it.

- Pitfall: the short syntax cannot take a `key` or any other attribute.
- Interview tip: fragments are a classic answer to "why does my table markup become invalid?" — a `<div>` inside `<tr>` is not allowed.

### Conditional rendering
<!-- level: basic; ref: https://react.dev/learn/conditional-rendering -->
Because JSX is just JavaScript, conditional UI uses ordinary JavaScript: `if` statements before the `return`, the ternary operator inside JSX, or logical AND (`&&`) for "render this or nothing". Returning `null` from a component renders nothing at all.

A good guideline is to keep JSX readable. For two branches, a ternary is fine. For three or more, compute the content in a variable with `if`/`switch` above the return, or extract a small component.

```jsx
function OrderStatus({ order }) {
  if (!order) return null;

  let badge;
  switch (order.status) {
    case 'shipped':
      badge = <span className="ok">Shipped</span>;
      break;
    case 'cancelled':
      badge = <span className="err">Cancelled</span>;
      break;
    default:
      badge = <span>Processing</span>;
  }

  return (
    <div>
      {badge}
      {order.items.length > 0 && <p>{order.items.length} items</p>}
      {order.isGift ? <GiftNote /> : <Invoice id={order.id} />}
    </div>
  );
}
```

Conditional rendering affects state: when a condition switches a component out of the tree, React unmounts it and its state is destroyed. If you render the same component type in the same position in both branches, React keeps its state.

- Pitfall: `{items.length && <List />}` prints "0" for an empty list.
- Pitfall: deeply nested ternaries become unreadable; extract components.

## 2. Props, composition and purity

### Props
<!-- level: basic; ref: https://react.dev/learn/passing-props-to-a-component -->
Props are the inputs of a component: the attributes you write on a JSX tag become a single object passed as the function's first argument. Any JavaScript value can be a prop — strings, numbers, objects, arrays, functions and even other JSX elements. Data flows one way: parents pass props down, children cannot modify them.

Props are read-only snapshots. If a child needs to change something, the parent passes a callback (such as `onChange`) and the parent updates its own state, which produces new props on the next render.

Destructuring in the parameter list is the idiomatic style, and it makes default values easy. The spread syntax `{...props}` forwards everything, which is handy for wrapper components but can hide what a component really depends on.

```jsx
function Button({ variant = 'primary', disabled = false, onClick, children }) {
  return (
    <button className={`btn btn-${variant}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function Toolbar({ onSave }) {
  return <Button variant="secondary" onClick={onSave}>Save draft</Button>;
}
```

Default values apply only when the prop is missing or `undefined`, not when it is `null` or `0`.

- Pitfall: mutating a prop object (`props.user.name = 'x'`) silently breaks rendering assumptions and memoisation.
- Interview tip: "props vs state": props are configured by the parent; state is memory owned by the component itself.

### The children prop and composition
<!-- level: basic; ref: https://react.dev/learn/passing-props-to-a-component#passing-jsx-as-children -->
When you nest JSX inside a component tag, React passes it as a special prop called `children`. This lets you build "container" components — cards, modals, layouts — that do not need to know what they wrap. It is React's main tool for reuse: you compose components rather than inherit from them.

You are not limited to one slot. Any prop can hold JSX, so a layout can accept `header`, `sidebar` and `children` props. This "slots" pattern keeps components flexible without endless configuration flags.

```jsx
function Card({ title, actions, children }) {
  return (
    <section className="card">
      <header>
        <h2>{title}</h2>
        <div className="actions">{actions}</div>
      </header>
      <div className="card-body">{children}</div>
    </section>
  );
}

export default function Settings() {
  return (
    <Card title="Profile" actions={<button>Edit</button>}>
      <p>Name: Asha Rao</p>
      <p>Plan: Pro</p>
    </Card>
  );
}
```

Composition also helps performance: if a component that owns frequently changing state receives expensive content via `children`, that content was created by the parent and does not re-render when only the wrapper's state changes.

- Pitfall: treat `children` as opaque. Inspecting or cloning it with `Children.map`/`cloneElement` is fragile and discouraged.
- Interview tip: React docs explicitly recommend composition over inheritance; you will rarely, if ever, extend your own component classes.

### Keeping components pure
<!-- level: intermediate; ref: https://react.dev/learn/keeping-components-pure -->
React assumes every component is a pure function during rendering: given the same props, state and context, it returns the same JSX, and it does not change anything that existed before it was called. Rendering is a calculation, not a place for side effects.

Purity is what makes React's advanced features safe. React may render a component more than once, pause and resume rendering, throw away a render that was interrupted (concurrent rendering), or render on the server. If rendering mutated global variables or sent network requests, all of those would produce bugs.

Side effects belong in event handlers first (a click saves data) and in effects only when they must synchronise with something external. Local mutation is fine: creating an array inside the component and pushing into it is pure because nobody else can see it.

```jsx
let guestCount = 0;

// Impure: changes a variable outside the function on every render
function BadCup() {
  guestCount += 1;
  return <p>Tea cup for guest #{guestCount}</p>;
}

// Pure: output depends only on props
function Cup({ guest }) {
  return <p>Tea cup for guest #{guest}</p>;
}

function TeaSet() {
  const cups = [];
  for (let i = 1; i <= 3; i++) cups.push(<Cup key={i} guest={i} />);
  return <>{cups}</>;
}
```

- Interview tip: StrictMode calls your components twice in development precisely to surface impure rendering.
- Pitfall: reading `Date.now()` or `Math.random()` during render makes output non-deterministic and can cause hydration mismatches.

### Rendering lists and keys
<!-- level: basic; ref: https://react.dev/learn/rendering-lists -->
To render a collection you transform data into elements, usually with `Array.prototype.map`, and filter with `filter`. Each element in the resulting array needs a `key` prop: a string or number that uniquely identifies that item among its siblings.

Keys are how React's reconciliation matches items between renders. When the list changes, React compares keys, not positions: an item with the same key is updated in place and keeps its state and DOM node, a new key is mounted, and a missing key is unmounted. Good keys come from your data, such as database ids. For data created locally, generate an id when the item is created (for example with `crypto.randomUUID()`), never during render.

```jsx
function ContactList({ contacts, query }) {
  const visible = contacts.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );

  if (visible.length === 0) return <p>No matches.</p>;

  return (
    <ul>
      {visible.map(contact => (
        <li key={contact.id}>
          {contact.name} — {contact.email}
        </li>
      ))}
    </ul>
  );
}
```

Keys only need to be unique among siblings, not globally. The `key` is consumed by React and is not passed to your component as a prop.

- Pitfall: `key={Math.random()}` forces every item to remount on every render, destroying state and performance.
- Pitfall: the key goes on the outermost element returned from `map`, not on an inner element.

## 3. State and events

### Handling events
<!-- level: basic; ref: https://react.dev/learn/responding-to-events -->
You respond to user interaction by passing a function to an event prop such as `onClick`, `onChange` or `onSubmit`. You pass the function itself, not the result of calling it: `onClick={handleClick}` is correct, `onClick={handleClick()}` calls it during render.

React attaches a small number of listeners at the root container and dispatches synthetic events to your handlers. The synthetic event wraps the native one with a consistent cross-browser API; `e.nativeEvent` gives you the original. Events bubble up through the React tree (including through portals), so `e.stopPropagation()` and `e.preventDefault()` work as you would expect.

By convention handler props are named `onSomething` and the functions that implement them `handleSomething`. Event handlers are the best place for side effects: they run because of a specific user action, not because of rendering.

```jsx
function SignupForm({ onSignup }) {
  function handleSubmit(e) {
    e.preventDefault();                 // stop the full-page form post
    const data = new FormData(e.currentTarget);
    onSignup(data.get('email'));
  }

  return (
    <form onSubmit={handleSubmit}>
      <input name="email" type="email" required />
      <button type="submit">Join</button>
      <button type="button" onClick={() => alert('Help is on the way')}>
        Help
      </button>
    </form>
  );
}
```

- Pitfall: buttons inside a form default to `type="submit"`; set `type="button"` for non-submitting buttons.
- Interview tip: since React 17 listeners are attached to the root element rather than `document`, which makes embedding multiple React versions safer.

### useState: component memory
<!-- level: basic; ref: https://react.dev/reference/react/useState -->
Regular local variables do not survive between renders, and changing them does not tell React to re-render. `useState` solves both problems: it returns the current value and a setter function. Calling the setter stores the new value and schedules a re-render of that component.

React stores state outside your function, in the component's fiber (its internal record in the tree), and identifies each piece of state by the order in which hooks are called. That is why hooks must be called unconditionally at the top level.

The initial value is used only on the first render. If computing it is expensive, pass an initialiser function (`useState(() => parse(raw))`) so it does not run on every render.

```jsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);
  const [history, setHistory] = useState(() => loadHistory()); // lazy init

  function increment() {
    setCount(count + 1);
    setHistory([...history, Date.now()]);
  }

  return (
    <button onClick={increment}>
      Clicked {count} times ({history.length} logged)
    </button>
  );
}
```

If you call the setter with a value identical to the current one (compared with `Object.is`), React may skip re-rendering the children.

- Pitfall: `useState(loadHistory())` calls `loadHistory` on every render even though only the first result is used.
- Pitfall: storing values you can compute from props or other state (derived state) creates sync bugs; compute them during render instead.

### State as a snapshot
<!-- level: intermediate; ref: https://react.dev/learn/state-as-a-snapshot -->
Setting state does not change the variable in the code that is already running. Each render receives its own fixed snapshot of state, and every event handler and effect created during that render "closes over" that snapshot. The setter only requests a new render, which will receive the new value.

This explains a classic surprise: logging state right after setting it prints the old value. It also explains why an `alert` scheduled with `setTimeout` shows the value from when the button was clicked, not the latest value.

```jsx
function Messenger() {
  const [to, setTo] = useState('Alice');
  const [text, setText] = useState('');

  function handleSend() {
    setTimeout(() => {
      // Uses the snapshot from the render where Send was clicked
      alert(`Sent "${text}" to ${to}`);
    }, 3000);
    setText('');
    console.log(text); // still the old text: the variable did not change
  }

  return (
    <>
      <select value={to} onChange={e => setTo(e.target.value)}>
        <option>Alice</option>
        <option>Bob</option>
      </select>
      <input value={text} onChange={e => setText(e.target.value)} />
      <button onClick={handleSend}>Send</button>
    </>
  );
}
```

Snapshot semantics make reasoning predictable: within one render, values never change underneath you. When you genuinely need the latest value inside a long-lived callback, store it in a ref or use an updater function.

- Interview tip: "stale closure" bugs are the flip side of snapshots; they usually appear with timers, subscriptions and effects with missing dependencies.

### Batching and updater functions
<!-- level: intermediate; ref: https://react.dev/learn/queueing-a-series-of-state-updates -->
React batches state updates: it waits until all code in the current event handler (and, since React 18, in promises, timeouts and native handlers too) has finished, then processes the queued updates in a single re-render. This avoids half-updated UIs and wasted renders.

Because of snapshots, calling `setCount(count + 1)` three times in a row only adds one: every call reads the same `count`. To compute the next state from the previous one, pass an updater function. React queues updaters and runs them in order during the next render, each receiving the result of the previous one.

```jsx
function Score() {
  const [score, setScore] = useState(0);

  function addThreeWrong() {
    setScore(score + 1);
    setScore(score + 1);
    setScore(score + 1); // score becomes 1
  }

  function addThree() {
    setScore(s => s + 1);
    setScore(s => s + 1);
    setScore(s => s + 1); // score becomes 3
  }

  return (
    <>
      <p>{score}</p>
      <button onClick={addThreeWrong}>+3 (buggy)</button>
      <button onClick={addThree}>+3</button>
    </>
  );
}
```

Updater functions must be pure; in StrictMode React calls them twice in development to check. Naming the argument after the state's first letter (`s`, `prev`) is a common convention.

- Interview tip: React 18 introduced automatic batching everywhere. `flushSync` from `react-dom` forces a synchronous update when you must read the DOM immediately after it, but it hurts performance and should be rare.

### Updating objects and arrays immutably
<!-- level: basic; ref: https://react.dev/learn/updating-objects-in-state -->
React decides whether state changed by comparing references with `Object.is`. If you mutate an object or array in place and pass the same reference to the setter, React sees "no change" and may skip the render. Mutations also break memoisation, time-travel debugging and concurrent rendering, which may keep using old snapshots.

Treat state as read-only and create new values: spread objects, and use non-mutating array methods (`map`, `filter`, `slice`, `concat`, spread, `toSorted`, `toReversed`, `with`) instead of `push`, `splice`, `sort` or direct index assignment. Copy every level you change in nested structures.

```jsx
const [user, setUser] = useState({
  name: 'Asha',
  address: { city: 'Pune', pin: '411001' },
});
const [todos, setTodos] = useState([]);

function moveCity(city) {
  setUser(u => ({ ...u, address: { ...u.address, city } }));
}

function addTodo(title) {
  setTodos(t => [...t, { id: crypto.randomUUID(), title, done: false }]);
}

function toggle(id) {
  setTodos(t => t.map(todo => (todo.id === id ? { ...todo, done: !todo.done } : todo)));
}

function remove(id) {
  setTodos(t => t.filter(todo => todo.id !== id));
}
```

For deeply nested data, either flatten (normalise) the state shape or use a helper like Immer, which lets you write "mutating" code against a draft and produces a new immutable value.

- Pitfall: spread is shallow. `{ ...user }` still shares the same `address` object.
- Pitfall: `todos.sort()` mutates state; use `toSorted()` or `[...todos].sort()`.

### Lifting state up
<!-- level: basic; ref: https://react.dev/learn/sharing-state-between-components -->
When two components need to show or change the same data, move that state to their closest common parent and pass it down as props, together with callbacks to change it. This is called lifting state up, and it keeps a single source of truth for each piece of data.

Components whose important data comes from props are called controlled, because the parent controls them. Components that keep their own internal state are uncontrolled. Controlled components are more flexible to coordinate; uncontrolled ones are simpler to drop in. Many well-designed components support both.

```jsx
function Accordion({ panels }) {
  const [openId, setOpenId] = useState(panels[0]?.id);

  return panels.map(panel => (
    <Panel
      key={panel.id}
      title={panel.title}
      isOpen={panel.id === openId}
      onShow={() => setOpenId(panel.id)}
    >
      {panel.body}
    </Panel>
  ));
}

function Panel({ title, isOpen, onShow, children }) {
  return (
    <section>
      <h3>{title}</h3>
      {isOpen ? <div>{children}</div> : <button onClick={onShow}>Show</button>}
    </section>
  );
}
```

Lifting has a cost: every update now re-renders the parent and all its children. Lift state only as high as needed; do not reflexively move everything to the top of the app.

- Interview tip: the opposite move — "pushing state down" into the smallest component that uses it — is one of the most effective performance fixes in React.

### Preserving and resetting state
<!-- level: intermediate; ref: https://react.dev/learn/preserving-and-resetting-state -->
State is not stored "inside" the component function; React ties it to a position in the UI tree. As long as the same component type renders at the same position, React preserves its state across re-renders, even if props change. If a different type renders there, or the component disappears, its state (and the state of everything below it) is destroyed.

This leads to two useful techniques. To keep state while switching content, render the same component in the same place. To deliberately reset state, give the component a different `key`: a new key tells React it is a different instance, so it unmounts the old one and mounts a fresh one.

```jsx
function Chat({ contacts }) {
  const [to, setTo] = useState(contacts[0]);

  return (
    <div className="chat">
      <ContactList contacts={contacts} selected={to} onSelect={setTo} />
      {/* New key per contact: the draft message resets when switching */}
      <Composer key={to.id} contact={to} />
    </div>
  );
}

function Composer({ contact }) {
  const [draft, setDraft] = useState('');
  return (
    <textarea
      placeholder={`Message ${contact.name}`}
      value={draft}
      onChange={e => setDraft(e.target.value)}
    />
  );
}
```

The `key` reset is far cleaner than an effect that watches props and calls `setDraft('')`, which renders stale content first and then corrects it.

- Pitfall: `{isPlayerA ? <Counter /> : <Counter />}` keeps the same state for both branches because the type and position are identical. Add distinct keys to separate them.
