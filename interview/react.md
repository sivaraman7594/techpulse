# React scenario questions
(Core React concepts come from the MIT-licensed sudheerj/reactjs-interview-questions collection.)

### A component re-renders too often and the page feels slow. How do you investigate and fix it?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/reference/react/memo -->
1. **Measure** with the React DevTools Profiler ("why did this render?") before optimising.
2. Common causes and fixes:
   - Parent state changes re-render all children → move state down closer to where it is used, or split components.
   - New object/array/function props on every render → `useMemo` / `useCallback`, combined with `React.memo` on the child.
   - A large context value changing → split contexts, or memoise the value.
   - Expensive calculations during render → `useMemo`.
   - Long lists → virtualisation (e.g. react-window) and stable `key`s.
3. Note: the React Compiler can apply memoisation automatically in projects that enable it.

### Fetching data in `useEffect` sometimes shows results for the wrong item. Why, and how do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/learn/synchronizing-with-effects#fetching-data -->
It is a **race condition**: the user changes the selection quickly, two requests are in flight, and the slower *older* response arrives last and overwrites the newer one.

Fix by ignoring or aborting stale requests in the effect's cleanup:

```jsx
useEffect(() => {
  const controller = new AbortController();
  fetch(`/api/users/${id}`, { signal: controller.signal })
    .then(r => r.json())
    .then(setUser)
    .catch(e => { if (e.name !== 'AbortError') setError(e); });
  return () => controller.abort();
}, [id]);
```

In real apps, prefer a data-fetching library (TanStack Query, SWR) or your framework's data loading, which handle caching, deduplication and races.

### Your `useEffect` runs in an infinite loop. What are the usual causes?
<!-- level: basic; kind: scenario; ref: https://react.dev/reference/react/useEffect#my-effect-keeps-re-running-in-an-infinite-cycle -->
- The effect **sets state that is also in its dependency array**, so each update triggers it again.
- A dependency is an **object, array or function created during render** — it is a new reference every time, so the effect always re-runs.

Fixes:
- Move object/function creation inside the effect, or memoise with `useMemo` / `useCallback`.
- Depend on primitive values (`user.id`) instead of whole objects.
- Ask whether you need an effect at all — derived values can be calculated during render.

### How do you choose between local state, Context, and a state-management library?
<!-- level: intermediate; kind: scenario; ref: https://react.dev/learn/managing-state -->
- **Local state** (`useState`/`useReducer`) for data used by one component or a small subtree; lift it up when siblings need it.
- **Context** to avoid prop drilling for values many components read but that change rarely (theme, current user, locale).
- **Server state** (data from APIs) belongs in a data-fetching cache such as TanStack Query — it handles loading, caching and refetching.
- **Global client state** shared widely and updated often → a store such as Redux Toolkit or Zustand.

Start simple and add tools only when the pain is real.

### Why shouldn't you use the array index as a `key` in lists?
<!-- level: basic; kind: concept; ref: https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key -->
React uses `key` to match list items between renders. If items are inserted, removed or reordered, index keys shift, so React may reuse the wrong component instance — causing input values, focus or component state to appear on the wrong row, plus unnecessary re-renders.

Use a stable, unique id from your data (`key={todo.id}`). Index keys are only acceptable for static lists that never change order.
