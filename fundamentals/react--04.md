## 10. Suspense, errors and concurrent rendering

### Suspense
<!-- level: intermediate; ref: https://react.dev/reference/react/Suspense -->
`<Suspense fallback={...}>` lets you declare a loading state for a part of the tree. When any component inside it "suspends" — because its code (via `lazy`) or its data (via `use` with a promise, or a Suspense-enabled library) is not ready — React shows the fallback in place of the whole boundary, then reveals the content when everything inside is ready.

Under the hood, a component suspends by throwing (or, with `use`, signalling) a pending promise during render. React catches it at the nearest boundary, renders the fallback, and retries rendering when the promise settles. Because rendering is pure, retrying is safe.

Boundary placement is a design decision: one boundary around a page shows a single spinner; nested boundaries reveal content progressively (header first, then feed, then comments). Siblings inside the same boundary appear together.

```jsx
import { Suspense, lazy } from 'react';

const Comments = lazy(() => import('./Comments'));

export function ArticlePage({ articlePromise, commentsPromise }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Article dataPromise={articlePromise} />
      <Suspense fallback={<p>Loading comments…</p>}>
        <Comments dataPromise={commentsPromise} />
      </Suspense>
    </Suspense>
  );
}
```

If an already visible boundary suspends again because of an urgent update, React swaps the content for the fallback. If the update was a transition, React keeps the old content visible instead, which avoids jarring spinners during navigation.

- Pitfall: Suspense does not detect data fetched in `useEffect`. Only Suspense-enabled sources (lazy, `use`, frameworks, TanStack Query's suspense hooks) trigger it.
- Interview tip: since React 19, when a component suspends React shows the fallback immediately and pre-warms the siblings afterwards, rather than rendering all siblings first.

### The use API
<!-- level: advanced; ref: https://react.dev/reference/react/use -->
`use(resource)` (React 19) reads the value of a promise or a context. With a promise, the component suspends until it resolves, and then `use` returns the value; if the promise rejects, the nearest error boundary renders. With a context, it behaves like `useContext`.

Unlike every other hook, `use` can be called inside conditions and loops, because it does not rely on a stable call order. It still must be called during render, inside a component or hook.

The important rule for promises: do not create the promise during render in a client component, because each render would create a new promise and suspend forever. Create promises outside — in a Server Component that passes them down as props, in a router loader, or in a cache — so the same promise instance is reused across renders.

```jsx
import { use, Suspense } from 'react';

// Server Component: starts the request without awaiting it
export default function Page({ params }) {
  const reviewsPromise = db.reviews.forProduct(params.id);
  return (
    <Suspense fallback={<p>Loading reviews…</p>}>
      <Reviews reviewsPromise={reviewsPromise} />
    </Suspense>
  );
}

// Client Component
'use client';
function Reviews({ reviewsPromise }) {
  const reviews = use(reviewsPromise);
  return reviews.map(r => <Review key={r.id} review={r} />);
}

function Header({ showTheme }) {
  if (showTheme) {
    const theme = use(ThemeContext); // allowed conditionally
    return <h1 className={theme}>Shop</h1>;
  }
  return <h1>Shop</h1>;
}
```

- Pitfall: `use` cannot be called inside `try`/`catch`; use an error boundary instead.

### Error boundaries
<!-- level: intermediate; ref: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary -->
By default, an error thrown during rendering unmounts the whole React root, leaving a blank page. An error boundary catches errors thrown while rendering its descendants (including in lifecycle methods and rejected promises read with `use`) and renders a fallback UI instead, isolating the failure to one part of the page.

Error boundaries are still written as class components implementing `static getDerivedStateFromError` (to switch to the fallback) and optionally `componentDidCatch` (to log). Most teams use the small `react-error-boundary` package, which adds a function-friendly API and a reset mechanism.

They do not catch errors in event handlers, in async code outside rendering (such as a `setTimeout`), in server rendering, or in the boundary itself. Handle those with `try`/`catch` and state.

```jsx
import { Component } from 'react';

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    logToService(error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert">
          <p>Something went wrong in this panel.</p>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// <ErrorBoundary><Suspense fallback={<Spinner />}><Widget /></Suspense></ErrorBoundary>
```

React 19 added root-level `onCaughtError` and `onUncaughtError` options to `createRoot`/`hydrateRoot` for central reporting, and reports each error once instead of duplicating logs.

- Interview tip: place boundaries around independent widgets and route segments, not only at the top.

### Streaming SSR and hydration
<!-- level: advanced; ref: https://react.dev/reference/react-dom/client/hydrateRoot -->
Server-side rendering produces HTML on the server so users see content before JavaScript loads, and search engines get real markup. Hydration is the client step where React attaches event handlers and state to that existing HTML instead of recreating it, using `hydrateRoot`.

Modern React streams HTML (`renderToPipeableStream` in Node, `renderToReadableStream` for web streams). The server sends the shell immediately, with Suspense fallbacks for slow parts, and streams each boundary's HTML along with a tiny inline script that swaps it in when its data is ready. Hydration is also selective: React hydrates boundaries independently, and prioritises the one the user interacts with first.

Hydration requires the first client render to produce exactly the same output as the server. Differences (hydration mismatches) come from reading `window`, dates, random values or locale during render, invalid HTML nesting, or browser extensions altering the DOM. React 19 reports mismatches with a single diff-style error.

```jsx
// client entry
import { hydrateRoot } from 'react-dom/client';
hydrateRoot(document, <App />, {
  onRecoverableError: (err) => reportError(err),
});

// Avoiding a mismatch for client-only values
function LocalTime({ iso }) {
  const [text, setText] = useState(null);
  useEffect(() => setText(new Date(iso).toLocaleTimeString()), [iso]);
  return <time dateTime={iso}>{text ?? iso}</time>;
}
```

- Pitfall: `suppressHydrationWarning` only silences one level of text mismatch; it is not a general fix.
- Interview tip: React 19.2 adds Partial Pre-rendering primitives (`prerender` and `resume`) to serve a static shell from a CDN and resume rendering dynamic parts later.

## 11. Server Components and Server Functions

### React Server Components
<!-- level: advanced; ref: https://react.dev/reference/rsc/server-components -->
React Server Components (RSC), stable in React 19 and used by frameworks such as Next.js App Router and React Router's RSC support, are components that render ahead of time on the server (at build time or per request) and never ship their code to the browser. They can be `async`, and they can read databases, files or secrets directly.

Their output is not HTML but a serialised description of the rendered tree (the RSC payload). The client merges it into the React tree; any interactive parts are Client Components, whose code is bundled and hydrated. This means heavy dependencies used only for rendering — markdown parsers, date libraries, syntax highlighters — add zero bytes to the client bundle.

Server Components cannot use state, effects, browser APIs or event handlers, because they do not run in the browser. Server Components are the default in RSC frameworks; you opt into client behaviour with `'use client'`.

```jsx
// app/blog/[slug]/page.jsx — a Server Component
import { marked } from 'marked';          // never sent to the browser
import { db } from '@/lib/db';
import LikeButton from './LikeButton';   // a Client Component

export default async function BlogPost({ params }) {
  const { slug } = await params;
  const post = await db.post.findUnique({ where: { slug } });
  if (!post) return <p>Not found</p>;

  return (
    <article>
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: marked(post.markdown) }} />
      <LikeButton postId={post.id} initialLikes={post.likes} />
    </article>
  );
}
```

- Interview tip: RSC is not the same as SSR. SSR produces HTML for the first load of any component; RSC decides where component code runs. They are usually combined.
- Pitfall: markdown from users still needs sanitising before `dangerouslySetInnerHTML`, even on the server.

### The 'use client' boundary
<!-- level: advanced; ref: https://react.dev/reference/rsc/use-client -->
The `'use client'` directive at the top of a file marks that module, and everything it imports, as client code. It creates a boundary in the module graph: Server Components can render Client Components, passing props, but a Client Component's imports are always bundled for the browser.

Important details:

1. Client Components still render on the server during SSR for the initial HTML; "client" means "also runs in the browser and is hydrated".
2. Props crossing the boundary must be serialisable: primitives, plain objects and arrays, Date, Map, Set, typed arrays, promises, JSX, and Server Functions. Ordinary functions and class instances cannot cross.
3. A Client Component cannot import a Server Component, but it can receive Server Component output as `children` or other JSX props. This lets you wrap server-rendered content in interactive shells.

Push the boundary as far down as possible: keep pages and layouts on the server and make only the interactive leaves client components.

```jsx
// Tabs.jsx
'use client';
import { useState } from 'react';

export function Tabs({ labels, children }) {
  const [i, setI] = useState(0);
  return (
    <>
      {labels.map((l, idx) => <button key={l} onClick={() => setI(idx)}>{l}</button>)}
      {children[i]}
    </>
  );
}

// page.jsx (Server Component)
import { Tabs } from './Tabs';
export default async function Product() {
  return (
    <Tabs labels={['Specs', 'Reviews']}>
      <Specs />      {/* still server-rendered */}
      <Reviews />
    </Tabs>
  );
}
```

- Pitfall: putting `'use client'` on a root layout turns the entire app into client code and loses RSC benefits.

### Server Functions
<!-- level: advanced; ref: https://react.dev/reference/rsc/server-functions -->
Server Functions (called Server Actions when used as form actions) are async functions that run on the server but can be called from client code. You mark them with `'use server'`, either at the top of a module (every export becomes a Server Function) or at the top of a function body inside a Server Component.

When a Client Component calls one, the framework sends a POST request with serialised arguments to a generated endpoint, runs the function on the server, and returns the serialised result. Passed to a `<form action>`, they enable progressive enhancement: the form works before hydration.

Every Server Function is a public HTTP endpoint. Anyone can call it with any arguments, so you must authenticate, authorise and validate inside it, exactly as for an API route.

```jsx
// actions.js
'use server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const Schema = z.object({ title: z.string().min(1).max(200) });

export async function createTodo(prevState, formData) {
  const session = await auth();
  if (!session) return { error: 'Please sign in' };

  const parsed = Schema.safeParse({ title: formData.get('title') });
  if (!parsed.success) return { error: 'Title is required' };

  await db.todo.create({ data: { ...parsed.data, userId: session.userId } });
  return { error: null };
}

// TodoForm.jsx
'use client';
import { useActionState } from 'react';
import { createTodo } from './actions';

export function TodoForm() {
  const [state, action, pending] = useActionState(createTodo, { error: null });
  return (
    <form action={action}>
      <input name="title" />
      <button disabled={pending}>Add</button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
```

- Pitfall: closures in inline Server Functions capture values that are sent to the client encrypted or as references depending on the framework; never rely on closures to hide secrets.

### Data fetching and caching on the server
<!-- level: advanced; ref: https://react.dev/reference/react/cache -->
In a Server Component you fetch data by simply awaiting it: `const user = await getUser(id)`. There is no effect, no loading state variable and no client-side waterfall. But naive server code can still create waterfalls and duplicate work, so a few techniques matter.

First, start independent requests in parallel with `Promise.all`, or start a promise without awaiting and pass it down to be read with `use` inside a Suspense boundary, so slow data streams in later. Second, deduplicate. React's `cache(fn)` (available in Server Components) memoises a function per server request: if the layout, the page and a nested component all call `getUser(id)`, only one query runs. Each request gets a fresh cache, so data is never leaked between users. React 19.2 adds `cacheSignal()` to know when that request-scoped cache is no longer needed, so you can abort work.

Longer-lived caching across requests (HTTP caching, revalidation, tags) is framework territory, for example Next.js's caching and `'use cache'` directive.

```jsx
import { cache } from 'react';
import { db } from '@/lib/db';

export const getUser = cache(async (id) => {
  return db.user.findUnique({ where: { id } });
});

export default async function Dashboard({ userId }) {
  // Parallel, not sequential
  const [user, stats] = await Promise.all([getUser(userId), getStats(userId)]);
  const activityPromise = getActivity(userId); // streamed later

  return (
    <>
      <Greeting user={user} />
      <Stats data={stats} />
      <Suspense fallback={<Spinner />}>
        <Activity promise={activityPromise} />
      </Suspense>
    </>
  );
}
```

- Pitfall: calling `cache` inside a component creates a new cache every render; define cached functions at module level.

### Security boundaries in RSC apps
<!-- level: advanced; ref: https://react.dev/reference/rsc/use-server -->
Server Components blur the line between frontend and backend code, so security mistakes become easier to make. Three rules cover most of it.

1. Everything passed from a Server Component to a Client Component ends up in the RSC payload in the browser. Pass only the fields the UI needs, never whole database records containing password hashes, tokens or internal flags. Use data transfer objects or select specific columns.
2. Every Server Function is a public endpoint. Re-check authentication and authorisation inside it, validate inputs with a schema, and never trust ids sent from the client to identify the current user.
3. Keep server-only modules out of client bundles. Mark them with the `server-only` package so that an accidental import from a Client Component fails the build, and keep secrets in server-only environment variables.

Also keep framework and React packages patched: in December 2025 a critical remote code execution flaw in the RSC "Flight" protocol handling (affecting React 19.0–19.2 server packages and frameworks built on them) required urgent upgrades, a reminder that the server boundary is real attack surface.

```jsx
// lib/users.js
import 'server-only';
import { db } from './db';

export async function getPublicProfile(id) {
  const u = await db.user.findUnique({ where: { id } });
  return { id: u.id, name: u.name, avatarUrl: u.avatarUrl }; // no email, no hash
}

// page.jsx
const profile = await getPublicProfile(params.id);
return <ProfileCard profile={profile} />; // safe to serialise
```

- Interview tip: React also offers experimental taint APIs (`taintObjectReference`, `taintUniqueValue`) to block specific objects or secrets from being passed to the client.

## 12. Routing and data fetching

### Client-side routing
<!-- level: intermediate; ref: https://react.dev/learn/creating-a-react-app -->
React has no built-in router; routing comes from a library or framework. Client-side routing intercepts link clicks, updates the URL with the History API and renders the matching components without a full page reload. Popular choices are React Router (v7, which merged Remix and offers declarative, data and framework modes), TanStack Router (fully type-safe routes and search params), and framework routers such as Next.js's file-based App Router.

The core ideas are shared: a route tree maps URL segments to components; nested routes render inside parent layouts through an outlet; dynamic segments (`:id`) become params; and links render real `<a>` elements so that middle-click, accessibility and prefetching work.

```jsx
import { createBrowserRouter, RouterProvider, Outlet, Link, useParams } from 'react-router';

function Layout() {
  return (
    <>
      <nav><Link to="/">Home</Link> <Link to="/orders">Orders</Link></nav>
      <main><Outlet /></main>
    </>
  );
}

function OrderDetail() {
  const { orderId } = useParams();
  return <h1>Order {orderId}</h1>;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'orders', element: <Orders /> },
      { path: 'orders/:orderId', element: <OrderDetail /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
```

- Pitfall: SPAs need the server to return `index.html` for unknown paths, or deep links and refreshes return 404.
- Interview tip: after navigation, move focus to the new page's heading or announce the route change for screen-reader users.

### Route loaders and avoiding waterfalls
<!-- level: intermediate; ref: https://react.dev/learn/build-a-react-app-from-scratch -->
Fetching data inside components with effects creates request waterfalls: the parent renders, then fetches, then renders children, which only then start their own fetches. Each level waits for the previous one, and nothing starts until the JavaScript for the route has loaded.

Route loaders fix this by attaching data requirements to routes. When navigation starts, the router knows every route segment that will match and calls all their loaders in parallel, often while the route's code is still downloading. Components then read the result synchronously. React Router's data APIs, TanStack Router and framework conventions all follow this model, and they also handle revalidation after mutations (actions).

```jsx
import { createBrowserRouter, useLoaderData } from 'react-router';

async function projectLoader({ params, request }) {
  const res = await fetch(`/api/projects/${params.id}`, { signal: request.signal });
  if (res.status === 404) throw new Response('Not found', { status: 404 });
  return res.json();
}

function ProjectPage() {
  const project = useLoaderData();
  return <h1>{project.name}</h1>;
}

const router = createBrowserRouter([
  {
    path: '/projects/:id',
    loader: projectLoader,
    lazy: () => import('./ProjectPage.route'), // code and data load in parallel
    errorElement: <RouteError />,
  },
]);
```

The `request.signal` aborts the fetch if the user navigates away before it completes.

- Pitfall: putting slow, non-critical data in a blocking loader delays the whole navigation; return a promise for it and render it with Suspense instead.
- Interview tip: name "fetch-on-render vs render-as-you-fetch" and explain why the latter removes waterfalls.

### Server-state libraries
<!-- level: intermediate; ref: https://react.dev/learn/synchronizing-with-effects#fetching-data -->
Data from an API is not really your application's state; it is a cached copy of state owned by the server. Managing it well requires caching, request deduplication, background refetching, stale-while-revalidate, retries, pagination, invalidation after mutations and race-condition handling. Hand-rolling this with `useEffect` and `useState` produces subtle bugs.

Libraries such as TanStack Query and SWR solve this. You describe a query by a key and a fetch function; the library caches results by key, shares them across components, refetches when data is stale (on window focus, reconnect or interval), and exposes status flags. Mutations can invalidate or update related queries, including optimistic updates.

```jsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

function useTodos(filter) {
  return useQuery({
    queryKey: ['todos', filter],
    queryFn: ({ signal }) => fetch(`/api/todos?filter=${filter}`, { signal }).then(r => r.json()),
    staleTime: 30_000,
  });
}

function TodoPanel({ filter }) {
  const qc = useQueryClient();
  const { data, isPending, error } = useTodos(filter);
  const addTodo = useMutation({
    mutationFn: title => fetch('/api/todos', { method: 'POST', body: JSON.stringify({ title }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos'] }),
  });

  if (isPending) return <Spinner />;
  if (error) return <p role="alert">{error.message}</p>;
  return (
    <>
      <TodoList todos={data} />
      <button onClick={() => addTodo.mutate('New task')}>Add</button>
    </>
  );
}
```

- Pitfall: query keys must include every variable the fetch depends on, or different filters will share one cache entry.
- Interview tip: in RSC frameworks, much of this moves to the server; client libraries remain useful for highly interactive, client-driven data.

## 13. Testing React

### React Testing Library fundamentals
<!-- level: intermediate; ref: https://react.dev/reference/react/act -->
React Testing Library (RTL) tests components the way users use them: it renders into a real (jsdom or browser) DOM and you query by accessible role, label and text rather than by component internals. The guiding principle: the more your tests resemble the way your software is used, the more confidence they give, and the less they break during refactors.

Query priority matters. Prefer `getByRole` (with `name`), then `getByLabelText`, `getByPlaceholderText`, `getByText`, and only as a last resort `getByTestId`. Role queries double as accessibility checks: if you cannot find a button by role and name, neither can a screen reader. Use `@testing-library/user-event` to simulate realistic interactions (it fires the full sequence of events a browser would), and `@testing-library/jest-dom` matchers for readable assertions. Vitest is now the common runner for Vite projects; Jest is still widespread.

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { LoginForm } from './LoginForm';

test('submits trimmed credentials', async () => {
  const user = userEvent.setup();
  const onLogin = vi.fn();
  render(<LoginForm onLogin={onLogin} />);

  await user.type(screen.getByLabelText(/email/i), '  asha@example.com ');
  await user.type(screen.getByLabelText(/password/i), 's3cret!');
  await user.click(screen.getByRole('button', { name: /sign in/i }));

  expect(onLogin).toHaveBeenCalledWith({ email: 'asha@example.com', password: 's3cret!' });
});
```

- Pitfall: asserting on internal state, hook calls or component instances couples tests to implementation.
- Pitfall: snapshot tests of large trees catch everything and therefore nothing; reviewers rubber-stamp updates.

### Testing async UI and network calls
<!-- level: advanced; ref: https://react.dev/reference/react/act -->
Most real components load data, so tests must wait for asynchronous updates. RTL's `findBy*` queries return promises that retry until the element appears or a timeout passes; `waitFor` retries an assertion; `waitForElementToBeRemoved` waits for spinners to disappear. Use `queryBy*` (which returns null instead of throwing) to assert something is absent.

React's `act()` makes sure all updates, effects and microtasks triggered by an action have been processed before assertions run. RTL's `render`, `user-event` and async utilities already wrap calls in `act`, so explicit `act` is only needed when you trigger updates yourself (timers, store updates). An "update not wrapped in act" warning usually means a test finished while an update was still pending.

For network calls, mock at the network layer rather than mocking `fetch` per test. Mock Service Worker (MSW) intercepts requests in Node and the browser with realistic handlers, so the same handlers serve tests, Storybook and local development.

```jsx
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { render, screen } from '@testing-library/react';

const server = setupServer(
  http.get('/api/orders', () => HttpResponse.json([{ id: 1, total: 499 }]))
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('shows orders', async () => {
  render(<Orders />);
  expect(await screen.findByText('₹499')).toBeInTheDocument();
});

test('shows an error when the API fails', async () => {
  server.use(http.get('/api/orders', () => new HttpResponse(null, { status: 500 })));
  render(<Orders />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
});
```

- Pitfall: using fixed `setTimeout` sleeps in tests makes them slow and flaky.

### Testing strategy: hooks, integration and end-to-end
<!-- level: intermediate; ref: https://react.dev/reference/react/act -->
A balanced React test suite usually looks like a "testing trophy": static analysis (TypeScript, ESLint with the hooks rules) catches typos and type errors cheaply; a broad layer of integration tests renders features with their real children and mocked network; a thin layer of unit tests covers pure logic (reducers, formatters, validation schemas); and a few end-to-end tests drive critical flows (sign-up, checkout) in a real browser with Playwright or Cypress.

Custom hooks are best tested through a small component that uses them, or with RTL's `renderHook` when the hook is a reusable library unit. Reducers are plain functions: test them with inputs and outputs, no rendering needed. Server Components are mostly tested via end-to-end tests or by testing the data functions they call, since tooling for rendering async Server Components in unit tests is still limited.

```jsx
import { renderHook, act } from '@testing-library/react';
import { useCounter } from './useCounter';
import { cartReducer } from './cartReducer';

test('useCounter increments with a step', () => {
  const { result } = renderHook(() => useCounter({ step: 5 }));
  act(() => result.current.increment());
  expect(result.current.count).toBe(5);
});

test('cartReducer adds quantity for existing items', () => {
  const state = { items: [{ id: 'a', qty: 1 }] };
  const next = cartReducer(state, { type: 'added', product: { id: 'a' } });
  expect(next.items[0].qty).toBe(2);
  expect(state.items[0].qty).toBe(1); // original not mutated
});
```

Add automated accessibility checks (axe via `jest-axe`/`vitest-axe` or Playwright's axe integration) to catch missing labels and roles.

- Interview tip: say which bugs each layer catches and why you would not unit-test every component in isolation with shallow rendering (removed from the ecosystem long ago).

## 14. React 19 platform features and escape hatches

### Document metadata and stylesheets
<!-- level: intermediate; ref: https://react.dev/reference/react-dom/components/title -->
Before React 19, setting the page `<title>` or `<meta>` tags from inside components required libraries like react-helmet or framework APIs. React 19 natively supports rendering `<title>`, `<meta>` and `<link>` tags anywhere in the component tree; React hoists them into the document `<head>`, both on the client and during server rendering (including streaming).

React 19 also gives stylesheets first-class treatment. A `<link rel="stylesheet">` with a `precedence` attribute is deduplicated, inserted into the head in precedence order, and, crucially, React waits for it to load before revealing the content that depends on it (it integrates with Suspense), preventing flashes of unstyled content. Async scripts (`<script async src>`) are also deduplicated wherever they are rendered.

```jsx
function ProductPage({ product }) {
  return (
    <article>
      <title>{`${product.name} | Acme Store`}</title>
      <meta name="description" content={product.summary} />
      <link rel="canonical" href={`https://acme.example/p/${product.slug}`} />
      <link rel="stylesheet" href="/styles/product.css" precedence="default" />

      <h1>{product.name}</h1>
      <p>{product.summary}</p>
    </article>
  );
}
```

- Pitfall: render only one `<title>` at a time; multiple titles are all hoisted and the browser picks one unpredictably.
- Pitfall: frameworks may provide their own metadata APIs (for example Next.js `generateMetadata`); follow the framework's convention to avoid duplicates.
- Interview tip: `<title>` expects a single string child; use a template literal rather than mixing text and expressions, which produces an array.

### Resource preloading APIs
<!-- level: advanced; ref: https://react.dev/reference/react-dom/preload -->
React 19 added functions in `react-dom` that tell the browser about resources it will need soon, so they download earlier: `prefetchDNS`, `preconnect`, `preload`, `preloadModule`, `preinit` and `preinitModule`. You can call them from components during render or from event handlers. React deduplicates the hints and, during server rendering, emits them as early as possible in the HTML head, even ahead of the content that needs them.

The difference between the main ones: `preconnect` opens a connection to an origin you will fetch from; `preload` downloads a resource (font, image, stylesheet, script) without executing it; `preinit` downloads and executes a script or inserts a stylesheet immediately.

```jsx
import { preconnect, preload, preinit, prefetchDNS } from 'react-dom';

function CheckoutPage() {
  preinit('https://js.payments.example/v3/sdk.js', { as: 'script' });
  preconnect('https://api.payments.example');
  preload('/fonts/Inter-var.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  prefetchDNS('https://cdn.analytics.example');
  return <CheckoutForm />;
}

function GalleryLink({ hero }) {
  return (
    <a
      href="/gallery"
      onMouseEnter={() => preload(hero, { as: 'image', fetchPriority: 'high' })}
    >
      View gallery
    </a>
  );
}
```

- Pitfall: preloading too many resources competes for bandwidth with what the page needs right now; preload only critical, late-discovered resources.
- Interview tip: these APIs matter most for Largest Contentful Paint, because they remove discovery delay for hero images and fonts.

### Activity: hiding UI while keeping state
<!-- level: advanced; ref: https://react.dev/reference/react/Activity -->
`<Activity mode="visible" | "hidden">` (stable since React 19.2) lets you hide part of the UI without unmounting it. When hidden, React visually hides the children (with `display: none`), unmounts their effects (running cleanups, so subscriptions stop), but preserves their state and DOM. When made visible again, effects re-run and the user sees the UI exactly as they left it — scroll position, form drafts, expanded sections.

Hidden Activity trees can still re-render at low priority when their props change, and React can pre-render content that is likely to be shown next (for example the next tab) in the background, so switching is instant.

Compare the alternatives: conditional rendering destroys state; hiding with CSS keeps effects running (timers, subscriptions, videos playing) and renders at normal priority.

```jsx
import { Activity, useState } from 'react';

function Workspace() {
  const [tab, setTab] = useState('editor');
  return (
    <>
      <TabBar value={tab} onChange={setTab} />
      <Activity mode={tab === 'editor' ? 'visible' : 'hidden'}>
        <Editor />        {/* unsaved text survives switching tabs */}
      </Activity>
      <Activity mode={tab === 'preview' ? 'visible' : 'hidden'}>
        <Preview />       {/* pre-rendered in the background */}
      </Activity>
    </>
  );
}
```

- Pitfall: effects must have correct cleanup, because hiding runs them; a video element that is hidden keeps playing unless an effect pauses it on cleanup.
- Pitfall: keeping many large trees alive costs memory; hide only what users are likely to return to.

### Portals
<!-- level: intermediate; ref: https://react.dev/reference/react-dom/createPortal -->
`createPortal(children, domNode, key?)` renders children into a different DOM node, outside the parent component's DOM hierarchy, while keeping them in the same place in the React tree. Modals, toasts, tooltips and dropdown menus use portals to escape ancestors with `overflow: hidden`, `transform` or a low `z-index` that would clip or bury them.

Because the portal is still a React child, it receives context from its React parents, and events bubble according to the React tree, not the DOM tree: a click inside a portal-rendered modal bubbles to the component that rendered the portal. That is usually helpful but can surprise you (an outer `onClick` fires for clicks inside the modal).

Accessibility is the hard part of modals, not the portal: trap focus inside, restore focus to the trigger on close, close on Escape, and mark the background inert. The native `<dialog>` element with `showModal()` provides much of this for free and renders in the browser's top layer, often removing the need for a portal.

```jsx
import { createPortal } from 'react-dom';

function Toast({ message, onClose }) {
  return createPortal(
    <div role="status" className="toast">
      {message}
      <button onClick={onClose} aria-label="Dismiss">×</button>
    </div>,
    document.getElementById('toast-root')
  );
}

function SaveButton() {
  const [saved, setSaved] = useState(false);
  return (
    <div style={{ overflow: 'hidden' }}>
      <button onClick={() => setSaved(true)}>Save</button>
      {saved && <Toast message="Saved" onClose={() => setSaved(false)} />}
    </div>
  );
}
```

- Pitfall: `document` does not exist during server rendering; render portals only on the client.

### TypeScript with React
<!-- level: intermediate; ref: https://react.dev/learn/typescript -->
TypeScript is the default for professional React work. It catches wrong props at compile time, documents component APIs, and powers editor autocompletion. React's types come from `@types/react` and `@types/react-dom`, and React 19 brought type changes (for example, `useRef` now requires an argument and ref callbacks may return cleanups).

Key patterns:

1. Type props with a type or interface and destructure them; avoid `React.FC`, which adds little and once implicitly included `children`.
2. Use `React.ReactNode` for anything renderable (children, slots).
3. Extend native element props with `React.ComponentProps<'button'>` to build wrappers that accept every valid attribute, including `ref` in React 19.
4. Let inference type `useState` when there is an initial value; supply a generic for unions or nullable values.
5. Type events with the specific handler types, such as `React.ChangeEvent<HTMLInputElement>`.

```tsx
import { useState, type ComponentProps, type ReactNode } from 'react';

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'ghost';
  icon?: ReactNode;
};

export function Button({ variant = 'primary', icon, children, ...rest }: ButtonProps) {
  return (
    <button className={`btn-${variant}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

type Status = 'idle' | 'loading' | 'error';

function Uploader() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }
  return <input type="file" onChange={onChange} aria-busy={status === 'loading'} />;
}
```

- Pitfall: typing API responses with `as User` hides malformed data; validate at the boundary with a schema library.
