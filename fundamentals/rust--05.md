## 11. Async Rust

### Futures and the Polling Model
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/future/trait.Future.html -->
A `Future` is a value representing work that may not be finished yet. Rust futures are lazy and poll-based. Nothing happens until an executor calls `poll(self: Pin<&mut Self>, cx: &mut Context) -> Poll<Output>`. The future either returns `Poll::Ready(value)` or returns `Poll::Pending` after registering the `Waker` from `cx` with whatever event it is waiting for: a socket becoming readable, a timer, a channel. When the event happens, the waker reschedules the task, and the executor polls it again.

The compiler turns an `async fn` into a state machine, an anonymous enum with one variant per `.await` point that holds the local variables live at that point. No heap allocation is needed per future, and there are no green-thread stacks. That is why Rust async is "zero-cost", and why a task can take only a few hundred bytes.

```rust
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

// A hand-written future: ready after being polled `n` times
struct CountDown(u32);

impl Future for CountDown {
    type Output = &'static str;
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        if self.0 == 0 {
            Poll::Ready("liftoff")
        } else {
            self.0 -= 1;
            cx.waker().wake_by_ref(); // ask to be polled again
            Poll::Pending
        }
    }
}

async fn launch() -> String {
    let msg = CountDown(3).await;    // each .await = a suspension point
    format!("rocket: {msg}")
}

#[tokio::main]
async fn main() {
    println!("{}", launch().await);
}
```

Rust ships no executor in std. You choose a runtime (Tokio, smol, embassy for embedded), which supplies the scheduler, I/O reactor and timers. In Rust 2024, `Future` and `IntoFuture` are in the prelude.

- Pitfall: calling an async fn without `.await` does nothing. The future is created and then dropped, and the compiler warns about the unused future.
- Interview tip: compare this with JavaScript promises, which start eagerly. Rust futures run only while something polls them.

### async/await, Runtimes and Tasks
<!-- level: intermediate; ref: https://doc.rust-lang.org/book/ch17-00-async-await.html -->
`async fn` and `async { }` blocks produce futures. `.await` suspends until the inner future completes and gives back control to the executor in the meantime. Concurrency comes from running several futures at once, in two different ways:
- Within one task: `join!`/`try_join!` (all of them), `select!` (first to finish), or `futures::stream` with `buffer_unordered(n)` for bounded concurrency. These run on the same task and are not parallel.
- Across tasks: `tokio::spawn(fut)` puts a future on the runtime as an independent task. The multi-threaded runtime can run tasks in parallel on worker threads using work stealing, so spawned futures must be `Send + 'static`.

Async is for I/O-bound concurrency: thousands of sockets, HTTP calls, database queries. For CPU-bound parallelism, use threads or rayon.

```rust
use std::time::Duration;
use tokio::time::sleep;

async fn fetch_price(sku: &str) -> Result<f64, String> {
    sleep(Duration::from_millis(50)).await;          // stands in for an HTTP call
    if sku.is_empty() { Err("empty sku".into()) } else { Ok(sku.len() as f64 * 2.5) }
}

#[tokio::main]
async fn main() -> Result<(), String> {
    // Concurrent within one task: ~50ms total, not 100ms
    let (a, b) = tokio::try_join!(fetch_price("pen"), fetch_price("notebook"))?;

    // Independent tasks (may run in parallel); owned data moved in
    let handles: Vec<_> = ["a", "bb", "ccc"]
        .into_iter()
        .map(|s| tokio::spawn(async move { fetch_price(s).await }))
        .collect();

    let mut total = a + b;
    for h in handles {
        total += h.await.map_err(|e| e.to_string())??; // JoinError, then app error
    }
    println!("total {total}");
    Ok(())
}
```

- Pitfall: a sequential `for` loop of `.await`s when the calls are independent. Use `join_all` or `buffer_unordered` to overlap them.
- Pitfall: unbounded `tokio::spawn` in a loop over 1M items. Bound the concurrency with a `Semaphore` or `buffer_unordered`.
- Interview tip: `.await` is a yield point, and the only place a task can be suspended. Code between awaits runs without interruption on its thread.

### Pin and Unpin
<!-- level: advanced; ref: https://doc.rust-lang.org/std/pin/index.html -->
The state machine generated for an `async fn` can be self-referential. A local `buf` and a reference `&buf` held across an `.await` are both stored inside the future. If the future were moved in memory after it was first polled, that internal reference would dangle. `Pin<P>` solves this. It is a wrapper around a pointer (`Pin<&mut T>`, `Pin<Box<T>>`) that guarantees the pointee won't move again until it is dropped, unless `T: Unpin`.

`Unpin` is an auto trait meaning "moving me is always fine, even when pinned". Almost every type is `Unpin`: integers, `String`, `Vec`, `Box<T>`. Compiler-generated futures are generally `!Unpin`. You meet `Pin` in practice when:
- storing futures in a struct or collection: `Pin<Box<dyn Future<Output = T> + Send>>`, often aliased as `BoxFuture`,
- polling a future by `&mut` inside `select!` in a loop: pin it first with `std::pin::pin!` (1.68) or `tokio::pin!`,
- implementing `Future` or `Stream` by hand: use the `pin-project-lite` crate for safe field projection.

```rust
use std::future::Future;
use std::pin::{pin, Pin};
use std::time::Duration;

type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

fn pick_backend(fast: bool) -> BoxFuture<&'static str> {
    if fast {
        Box::pin(async { "cache" })
    } else {
        Box::pin(async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            "database"
        })
    }
}

#[tokio::main]
async fn main() {
    println!("{}", pick_backend(false).await);

    // Reuse one future across loop iterations of select!
    let mut deadline = pin!(tokio::time::sleep(Duration::from_millis(100)));
    let mut ticks = 0;
    loop {
        tokio::select! {
            _ = &mut deadline => break,                       // needs Unpin -> pinned
            _ = tokio::time::sleep(Duration::from_millis(30)) => ticks += 1,
        }
    }
    println!("ticks before deadline: {ticks}");
}
```

- Pitfall: `Pin` does not allocate or move anything by itself. It is a type-level promise, and `Box::pin` is what places the value on the heap.
- Interview tip: one sentence is enough: "Pin exists because async state machines can contain references into themselves."

### async fn in Traits and Send Bounds
<!-- level: advanced; ref: https://doc.rust-lang.org/reference/items/traits.html -->
Since Rust 1.75 you can write `async fn` directly in traits, together with return-position `impl Trait` in traits (RPITIT). Before that, the `async-trait` crate rewrote them into `Pin<Box<dyn Future>>`, which cost a heap allocation per call. Native async trait methods are statically dispatched and don't allocate.

Two limitations remain:
1. dyn compatibility. Traits with `async fn` can't be used as `dyn Trait`, because each implementation returns a differently sized future type. Use generics, an enum of implementations, or a hand-written boxed variant (`fn fetch(&self) -> BoxFuture<'_, T>`). `async-trait` is still the pragmatic choice for `dyn`.
2. Send bounds. Callers can't easily require that the returned future is `Send`, which `tokio::spawn` needs. The current workarounds are to declare the method as `fn fetch(&self) -> impl Future<Output = T> + Send` in the trait (implementations can still use `async fn`), or to use the `trait-variant` crate. "Return type notation" (`T::fetch(..): Send`) is being designed for this but is not stable.

```rust
use std::future::Future;

trait UserStore {
    // Send-able future for multi-threaded runtimes
    fn get(&self, id: u64) -> impl Future<Output = Option<String>> + Send;
}

struct MemoryStore(Vec<(u64, String)>);

impl UserStore for MemoryStore {
    async fn get(&self, id: u64) -> Option<String> {          // async fn satisfies it
        self.0.iter().find(|(i, _)| *i == id).map(|(_, n)| n.clone())
    }
}

async fn greet<S: UserStore + Sync + 'static>(store: std::sync::Arc<S>, id: u64) -> String {
    let handle = tokio::spawn(async move { store.get(id).await }); // requires Send future
    handle.await.unwrap().map_or("unknown".into(), |n| format!("hi {n}"))
}

#[tokio::main]
async fn main() {
    let store = std::sync::Arc::new(MemoryStore(vec![(1, "Ana".into())]));
    println!("{}", greet(store, 1).await);
}
```

- Pitfall: a public library trait using a bare `async fn`. Downstream users can't add a Send bound, and the compiler warns about this (`async_fn_in_trait` lint).
- Interview tip: be able to explain why `dyn` doesn't work: the size of the returned future is unknown and differs per implementation.

### Async Closures (Rust 1.85)
<!-- level: advanced; ref: https://doc.rust-lang.org/reference/expressions/closure-expr.html -->
Rust 1.85 (released alongside the 2024 edition) stabilised async closures, `async |args| { ... }`, and the matching traits `AsyncFn`, `AsyncFnMut` and `AsyncFnOnce`. They are usable in all editions.

Before this, people wrote `|x| async move { ... }`, an ordinary closure returning a future, with bounds like `F: Fn(T) -> Fut, Fut: Future<Output = R>`. That pattern has a basic limitation: the returned future can't borrow from the closure's captures. Each call's future has to own its data, which forces clones, and the bounds are long-winded.

An async closure can lend its captured state to the future it returns, because the `AsyncFn*` traits are built for that borrowing relationship. The bound is also much shorter: `F: AsyncFn(T) -> R`.

```rust
use std::time::Duration;

// Retry helper that accepts an async closure (Rust 1.85+)
async fn retry<T, E: std::fmt::Display>(
    attempts: u32,
    op: impl AsyncFn() -> Result<T, E>,
) -> Result<T, E> {
    let mut last = None;
    for i in 1..=attempts {
        match op().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                eprintln!("attempt {i} failed: {e}");
                tokio::time::sleep(Duration::from_millis(10 * i as u64)).await;
                last = Some(e);
            }
        }
    }
    Err(last.expect("attempts > 0"))
}

#[tokio::main]
async fn main() {
    let endpoint = String::from("https://api.example.com/health");
    let mut calls = 0u32;
    let counter = std::cell::Cell::new(0);

    // Borrows `endpoint` and `counter` from the environment; no clone needed
    let res = retry(3, async || {
        counter.set(counter.get() + 1);
        if counter.get() < 3 { Err(format!("{endpoint} busy")) } else { Ok(200) }
    }).await;
    calls += counter.get();
    println!("{res:?} after {calls} calls");
}
```

- Pitfall: using async closures with tokio::spawn still requires `Send + 'static` data. They remove clone gymnastics for borrowed use, not the spawn rules.
- Interview tip: the key improvement is that "the returned future may borrow from the closure", which the old `Fn() -> impl Future` pattern can't express.

### Cancellation, Timeouts and select!
<!-- level: advanced; ref: https://doc.rust-lang.org/std/future/trait.Future.html -->
In Rust, cancelling a future means dropping it. A future that is no longer polled stops at its last `.await` point, and its destructors run. `tokio::time::timeout(dur, fut)`, `select!` (which drops the branches that lose) and `JoinHandle::abort()` all work this way.

Cancellation is cooperative and can only happen at `.await` points, but it can happen at any of them. That makes cancellation safety an important concern. If a future is dropped midway, is the state consistent? Was data lost? Common hazards:
- A `select!` loop over `reader.read_line(&mut buf)`. The read is cancelled after consuming partial data, and that data is lost unless the operation is documented as cancel-safe.
- A multi-step database update that is cancelled between steps. Use transactions, or spawn the critical part as its own task so it can't be dropped from outside.
- Holding a resource like a semaphore permit. It is released on drop, which is usually what you want.

For graceful shutdown, prefer `tokio_util::sync::CancellationToken` or a `watch` channel, and have tasks check them at safe points.

```rust
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::{interval, timeout};
use tokio_util::sync::CancellationToken;

async fn worker(mut rx: mpsc::Receiver<u32>, token: CancellationToken) {
    let mut tick = interval(Duration::from_millis(50));
    loop {
        tokio::select! {
            _ = token.cancelled() => { println!("flushing and exiting"); break; }
            Some(job) = rx.recv() => println!("job {job}"),   // recv is cancel-safe
            _ = tick.tick() => println!("heartbeat"),
        }
    }
}

#[tokio::main]
async fn main() {
    let (tx, rx) = mpsc::channel(16);
    let token = CancellationToken::new();
    let h = tokio::spawn(worker(rx, token.clone()));

    tx.send(1).await.unwrap();
    match timeout(Duration::from_millis(10), tokio::time::sleep(Duration::from_secs(5))).await {
        Ok(_) => println!("done"),
        Err(_) => println!("timed out (inner future dropped)"),
    }
    token.cancel();
    h.await.unwrap();
}
```

- Pitfall: assuming a dropped future "finishes in the background". It doesn't: dropped means stopped. Spawned tasks are the exception, because dropping a `JoinHandle` detaches the task and doesn't cancel it.
- Interview tip: always check the "cancel safety" section in the Tokio docs for each method used inside a `select!` loop.

### Blocking in Async and Holding Locks Across .await
<!-- level: advanced; ref: https://doc.rust-lang.org/std/sync/struct.MutexGuard.html -->
Async runtimes multiplex many tasks onto a few threads. A task that blocks the thread starves every other task on that worker. Blocking includes CPU-heavy loops, `std::thread::sleep`, synchronous file or database I/O, and waiting on a contended `std::sync::Mutex`. Symptoms are latency spikes, timeouts and a system that looks hung while CPU usage stays low.

Fixes:
- `tokio::task::spawn_blocking(|| ...)` for blocking calls. It runs on a separate, larger thread pool.
- rayon, or a dedicated thread, for CPU-bound work, sending the results back over a oneshot channel.
- Async-native libraries (`tokio::fs`, `sqlx`, `reqwest`).
- For long computations inside a task, an occasional `tokio::task::yield_now().await`.

Locks: holding a `std::sync::MutexGuard` across an `.await` makes the future `!Send`, and it can deadlock, because another task on the same thread may wait for that lock while the holder is suspended. Use a std `Mutex` for short, synchronous critical sections and drop the guard before awaiting. Use `tokio::sync::Mutex` only when the guard really must live across an await, such as serialising access to a connection.

```rust
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
struct Cache { entries: Mutex<Vec<String>> }

async fn refresh(cache: Arc<Cache>) {
    // BAD: guard alive across .await -> !Send future, possible deadlock
    // let mut g = cache.entries.lock().unwrap();
    // let fresh = fetch().await;
    // g.push(fresh);

    let fresh = fetch().await;                   // await first
    {
        let mut g = cache.entries.lock().unwrap();
        g.push(fresh);                           // short sync section
    }                                            // guard dropped before next await

    let report = tokio::task::spawn_blocking(|| expensive_cpu_report())
        .await
        .expect("blocking task panicked");
    println!("{report}");
}

async fn fetch() -> String { tokio::time::sleep(Duration::from_millis(5)).await; "v2".into() }
fn expensive_cpu_report() -> String { (0..5_000_000u64).sum::<u64>().to_string() }

#[tokio::main]
async fn main() {
    let c = Arc::new(Cache::default());
    tokio::spawn(refresh(Arc::clone(&c))).await.unwrap();
    println!("{:?}", c.entries.lock().unwrap());
}
```

- Pitfall: `block_on` inside an async context panics in Tokio ("Cannot start a runtime from within a runtime").
- Interview tip: `tokio-console` shows tasks with long poll times, which is how you find blocking code in production.

## 12. Macros

### Declarative Macros (macro_rules!)
<!-- level: intermediate; ref: https://doc.rust-lang.org/reference/macros-by-example.html -->
Declarative macros match token patterns and expand into code before type checking. A pattern uses fragment specifiers (`$x:expr`, `$name:ident`, `$t:ty`, `$p:pat`, `$b:block`, `$l:literal`, `$tt:tt`) and repetitions (`$( ... ),*` or `+` or `?`). Macros can take a variable number of arguments, generate repetitive impls, and create small DSLs. `vec!`, `println!`, `assert_eq!` and `matches!` are all macros.

Macros are partly hygienic. Local variables introduced inside a macro can't clash with the caller's variables. Items and paths are not hygienic, so use `$crate::path` inside exported macros so that paths resolve correctly in other crates.

Rust 2024 change: the `expr` fragment now also matches `const { ... }` blocks and `_` expressions. Use `expr_2021` to keep the old behaviour.

```rust
/// Build a HashMap literal: hashmap!{"a" => 1, "b" => 2}
macro_rules! hashmap {
    ($($k:expr => $v:expr),* $(,)?) => {{
        let mut m = ::std::collections::HashMap::new();
        $( m.insert($k, $v); )*
        m
    }};
}

/// Generate newtype IDs with common derives
macro_rules! id_type {
    ($($name:ident),+) => {
        $(
            #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
            pub struct $name(pub u64);
            impl std::fmt::Display for $name {
                fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                    write!(f, "{}-{}", stringify!($name), self.0)
                }
            }
        )+
    };
}

id_type!(UserId, OrderId);

fn main() {
    let prices = hashmap! { "pen" => 1.5, "book" => 12.0, };
    println!("{} {} {:?}", UserId(1), OrderId(9), prices.get("pen"));
}
```

`#[macro_export]` makes a macro available from the crate root. Inside a crate, macros are textually scoped: they must be defined before they are used.

- Pitfall: macros evaluate their arguments once for each time they appear in the expansion. `max!(a(), b())` written naively calls `a()` twice. Bind each argument to a local first.
- Interview tip: reach for a generic function first, and use a macro only when you need syntax functions can't express: variadics, generated items, or `stringify!`/`concat!`.

### Procedural Macros
<!-- level: advanced; ref: https://doc.rust-lang.org/reference/procedural-macros.html -->
Procedural macros are Rust functions that run at compile time. They take a `TokenStream` and return a new one. They must live in their own crate with `proc-macro = true`. There are three kinds:
1. Derive macros, `#[derive(Serialize)]`, add items such as impls next to a struct or enum. They can't modify the input.
2. Attribute macros, `#[tokio::main]` or `#[instrument]`, transform the item they're attached to.
3. Function-like macros, `sql!(...)`, which look like `macro_rules!` calls but can do arbitrary computation.

Almost everyone uses `syn` to parse tokens into a syntax tree, `quote!` to produce output, and `proc-macro2` for testable token types. Report errors with `syn::Error::to_compile_error()` and span information, so the user sees the error on their own code and not in your macro.

```rust
// my_derive/Cargo.toml: [lib] proc-macro = true; deps: syn, quote
use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, DeriveInput};

/// #[derive(Describe)] adds `fn describe() -> &'static str`
#[proc_macro_derive(Describe)]
pub fn derive_describe(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let name = &ast.ident;
    let kind = match &ast.data {
        syn::Data::Struct(_) => "struct",
        syn::Data::Enum(_) => "enum",
        syn::Data::Union(_) => "union",
    };
    let text = format!("{name} is a {kind}");
    let (impl_g, ty_g, where_c) = ast.generics.split_for_impl();
    quote! {
        impl #impl_g #name #ty_g #where_c {
            pub fn describe() -> &'static str { #text }
        }
    }
    .into()
}

// user crate:
// #[derive(my_derive::Describe)] struct Order { id: u64 }
// assert_eq!(Order::describe(), "Order is a struct");
```

Costs: proc macros add compile time (syn is a big dependency, and expansion runs on every build) and hide generated code. Inspect the expansion with `cargo expand`.

- Pitfall: forgetting generics in the generated impl. `split_for_impl` handles that for you.
- Interview tip: name the three kinds and say why they need a separate crate: they are compiled for the host and loaded by the compiler as plugins.

### When to Use Macros: Hygiene, Debugging and Alternatives
<!-- level: intermediate; ref: https://doc.rust-lang.org/reference/macros.html -->
Macros are powerful, but they have costs. They are harder to read, IDE support for them is weaker, error messages are more confusing, and they slow compilation. Use this rule: write a function first, then generics or traits, and use a macro only when you need something those can't do:
- variadic arguments (`println!`),
- compile-time checking of literals (`sqlx::query!` checks SQL against a database, `format!` checks placeholders),
- generating many similar items (impls for each tuple size or each numeric type),
- syntax-level DSLs (`html!`, `json!`),
- capturing source text or location (`stringify!`, `file!`, `line!`, `assert!` messages).

Debugging: `cargo expand` (from cargo-expand) prints the fully expanded code. `trace_macros!` and `log_syntax!` are nightly only. For proc macros, unit test the `proc_macro2` logic directly, and use `trybuild` for compile-fail tests of error messages.

```rust
// Good use: generate trait impls for many types at once
trait Bounded { const MIN: Self; const MAX: Self; }

macro_rules! impl_bounded {
    ($($t:ty),* $(,)?) => {
        $( impl Bounded for $t { const MIN: Self = <$t>::MIN; const MAX: Self = <$t>::MAX; } )*
    };
}
impl_bounded!(u8, u16, u32, i32, i64);

// Not a good use: this should simply be a function
// macro_rules! square { ($x:expr) => { $x * $x }; }   // also evaluates $x twice
fn square(x: i64) -> i64 { x * x }

fn main() {
    println!("{} {} {}", u8::MAX, <i32 as Bounded>::MIN, square(3 + 1));
}
```

The commented-out `square!` points at two traps. In C, a textual `#define SQUARE(x) x*x` turns `SQUARE(3+1)` into `3+1*3+1`, which is 7. Rust treats `$x:expr` as one grouped expression, so `square!(3 + 1)` correctly gives 16. It still evaluates the argument twice, which breaks if the argument has side effects. The function avoids both problems.

- Pitfall: exported macros that refer to helper items without `$crate::` break in downstream crates.
- Interview tip: say that Rust macros work on token trees, not on text like the C preprocessor, and that they are partly hygienic.
