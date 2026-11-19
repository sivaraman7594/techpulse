# Rust scenario questions

### The compiler rejects a method that loops over self.items and calls self.log() inside the loop. How do you fix it without cloning everything?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html -->
Answer:
1. Observe. The error is E0502: "cannot borrow `*self` as mutable because it is also borrowed as immutable". `for item in &self.items` holds a shared borrow of one field. `self.log(..)` takes `&mut self`, which means the whole struct.
2. Hypothesise. The borrow checker sees disjoint fields inside one function body, but a method call borrows all of `self`. It can't see that `log` only touches `self.events`.
3. Fix, from the most to the least idiomatic:
   - Borrow fields directly instead of calling a method. Destructure (`let Self { items, events, .. } = self;`) or write `self.events.push(..)` inline, so the borrows are disjoint.
   - Turn the helper into an associated function that takes only the field it needs: `fn log(events: &mut Vec<Event>, msg: String)`.
   - Split the struct into sub-structs (`State` and `Logger`) and give the methods to them.
   - Run two passes: collect what you need (`Vec<String>` of messages), then mutate.

```rust
struct Processor { items: Vec<u32>, events: Vec<String>, total: u64 }

impl Processor {
    fn run(&mut self) {
        let Self { items, events, total } = self;     // disjoint field borrows
        for &i in items.iter() {
            *total += i as u64;
            Self::log(events, format!("processed {i}"));
        }
    }
    fn log(events: &mut Vec<String>, msg: String) { events.push(msg); }
}
```

4. Prevent. Design types so that data mutated together sits together, and keep `&mut self` methods small.

Wrong answers to avoid: `self.items.clone()` (wastes allocations and hides the design problem), `RefCell` on every field (turns a compile-time check into runtime panics), and unsafe pointer casts.

### Lifetime parameters are spreading through your whole codebase because one struct holds a &str. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html -->
Answer:
1. Observe. `Request<'a>` holds `&'a str`, so `Handler<'a>`, `Context<'a>` and `App<'a>` all gain lifetimes, and soon you can't store requests in a queue or spawn tasks with them.
2. Hypothesise. A borrowed field only makes sense when the struct is short-lived and strictly nested inside the owner's scope. Long-lived or shared data should be owned.
3. Decide by lifetime pattern:
   - Short-lived views (parsers, iterators, formatters used inside one function): keep the borrow, it is zero-copy.
   - Anything stored, cached, sent to threads or held across `.await`: own the data.
4. Fix options:
   - `String` or `Vec<u8>` when allocation cost is negligible, which is usually the case.
   - `Arc<str>` / `Arc<[T]>` when many places share the same immutable data. Clones are cheap refcount bumps.
   - `Cow<'a, str>` when most values are borrowed but some need to be owned.
   - `bytes::Bytes` for network buffers: cheap, reference-counted slices of a shared buffer.
   - Indices or ranges into an owned buffer instead of references, for parsers that must outlive their input variable.

```rust
// Before: pub struct Event<'a> { user: &'a str, payload: &'a [u8] }
use std::sync::Arc;

#[derive(Clone)]
pub struct Event {
    user: Arc<str>,               // shared, immutable, 'static
    payload: bytes::Bytes,        // zero-copy slice of the network buffer
}
```

5. Verify. Profile before and after. In most services the extra allocation is invisible next to I/O.
6. Prevent. Make "owned by default, borrow at function boundaries" a team guideline.

A common wrong answer is adding `'static` everywhere or using `Box::leak`. That compiles, but it leaks memory or pushes the problem onto callers.

### You need a get_or_insert function that returns &mut V from a HashMap, but the borrow checker rejects your get-then-insert code. Why, and how do you fix it?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/std/collections/hash_map/enum.Entry.html -->
Answer:
1. Observe. The code below fails with E0499/E0502 even though it is logically sound:

```rust
fn get_or_load<'m>(cache: &'m mut HashMap<u64, String>, id: u64) -> &'m mut String {
    if let Some(v) = cache.get_mut(&id) {
        return v;                     // borrow must last for 'm...
    }
    cache.insert(id, load(id));       // ...so this conflicts (NLL problem case #3)
    cache.get_mut(&id).unwrap()
}
```

2. Hypothesise. Returning `v` on one path forces the borrow from `get_mut` to last for the whole `'m`, including on the path where nothing was returned. The current borrow checker can't express a borrow that is conditional on control flow. Polonius will fix this eventually.
3. Fix. Use the Entry API, which does exactly one lookup and returns `&mut V`:

```rust
use std::collections::HashMap;
fn load(id: u64) -> String { format!("user-{id}") }

fn get_or_load(cache: &mut HashMap<u64, String>, id: u64) -> &mut String {
    cache.entry(id).or_insert_with(|| load(id))
}
```

When the loader is fallible, match on the entry:

```rust
use std::collections::hash_map::Entry;
fn try_get(cache: &mut HashMap<u64, String>, id: u64) -> Result<&mut String, String> {
    match cache.entry(id) {
        Entry::Occupied(e) => Ok(e.into_mut()),
        Entry::Vacant(e) => Ok(e.insert(fallible_load(id)?)),
    }
}
fn fallible_load(id: u64) -> Result<String, String> { Ok(id.to_string()) }
```

4. Alternatives. Check with `contains_key` first and then index. That costs two lookups but compiles. For general data structures, restructure into "find the index, then borrow by index".
5. Prevent. Know the NLL problem case #3 pattern so you recognise it quickly instead of fighting it with clones or unsafe code.

Wrong answer: using `unsafe` to extend the borrow. It is unnecessary here, and easy to get wrong.

### Design a tree where children need access to their parent (for example a UI widget tree or org chart). Rc/RefCell, arena, or something else?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/book/ch15-06-reference-cycles.html -->
Answer:
1. Clarify the requirements. How many nodes? Are there frequent insertions and deletions? Is the tree shared across threads? Do nodes need to be mutated while walking it? Must it be serialised?
2. Option A: `Rc<RefCell<Node>>` children with a `Weak` parent link.
   - Pros: it looks like the classic object graph, and nodes can be removed individually.
   - Cons: `.borrow_mut()` noise, runtime panics if borrows overlap during traversal, refcount overhead, and memory leaks if someone stores a strong parent reference. Across threads it becomes `Arc<Mutex<_>>`, which adds lock overhead and deadlock risk.
3. Option B: an arena with indices.

```rust
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct NodeId(u32);

struct Node { name: String, parent: Option<NodeId>, children: Vec<NodeId> }

struct Tree { nodes: Vec<Node> }

impl Tree {
    fn rename_ancestors(&mut self, mut id: NodeId, suffix: &str) {
        while let Some(p) = self.nodes[id.0 as usize].parent {
            self.nodes[p.0 as usize].name.push_str(suffix); // plain &mut, no RefCell
            id = p;
        }
    }
}
```

   - Pros: single ownership, no runtime borrow panics, cache friendly, trivially `Send`/`Sync`, easy to serialise.
   - Cons: removal leaves dangling ids. `slotmap`'s generational keys detect stale handles. You also lose the ability to hold a node independently of its tree.
4. Option C: an immutable tree plus a functional rebuild, for persistent or undo-heavy editors (`im`/`rpds` crates).
5. Recommendation. Use an arena or slotmap for most production cases, and `Rc/Weak` for small, single-threaded graphs where nodes have independent lifetimes.
6. Prevent. Write the invariants down, for example "a parent id is always valid", and test removal paths, under Miri if any unsafe code is involved.

Wrong answer: `Rc<RefCell<..>>` in both directions. That creates cycles that never free.

### You want a struct that owns a large String and also holds parsed &str slices into it. The compiler won't allow it. What are your options?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/std/pin/index.html -->
Answer:
1. Observe. `struct Doc { text: String, words: Vec<&str> }` can't name the lifetime of `text`. If you write `Doc<'a>`, the borrow has to come from outside the struct.
2. Understand why. Moving `Doc` moves the `String` header. The heap buffer doesn't move, but the compiler can't prove that in general, and `text` could be mutated or reallocated, which would invalidate the slices. A self-referential borrow is unsound in safe Rust.
3. Options:
   - Store ranges instead of references. `words: Vec<Range<usize>>` with an accessor `fn word(&self, i) -> &str { &self.text[self.words[i].clone()] }`. This is safe, simple, `Send`, serialisable and cheap. It is the default choice.
   - Split ownership. Keep the `String` in the caller and create `View<'a> { words: Vec<&'a str> }` when needed. That works if the view is short-lived.
   - Shared buffers. Use `Arc<str>` plus ranges, or `bytes::Bytes` slices, which own a refcounted piece of the buffer.
   - Crates like `yoke` or `self_cell` encapsulate the unsafe pattern correctly, for zero-copy deserialisation that must be cached.
   - Pinning plus unsafe. Only for low-level code such as async runtimes. Avoid it in application code.

```rust
use std::ops::Range;

struct Doc { text: String, words: Vec<Range<usize>> }

impl Doc {
    fn parse(text: String) -> Self {
        let mut words = Vec::new();
        let mut start = None;
        for (i, c) in text.char_indices() {
            match (c.is_whitespace(), start) {
                (false, None) => start = Some(i),
                (true, Some(s)) => { words.push(s..i); start = None; }
                _ => {}
            }
        }
        if let Some(s) = start { words.push(s..text.len()); }
        Doc { text, words }
    }
    fn word(&self, i: usize) -> &str { &self.text[self.words[i].clone()] }
}
```

4. Verify with tests covering multi-byte characters. Ranges must land on character boundaries, and `char_indices` guarantees that.

Wrong answer: transmuting the lifetime to `'static`. That is UB waiting to happen.

### Several worker threads need to update shared state. How do you choose between Arc<Mutex<T>> and channels?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/book/ch16-03-shared-state.html -->
Answer:
1. Clarify the access pattern. Is the state read-mostly or write-heavy? Do updates have to be ordered? Is it one owner or many? Does the state need cross-key invariants, such as transferring between two accounts?
2. `Arc<Mutex<T>>` (or `RwLock`) fits when:
   - many parties read and update the same data in place, like a cache or counters,
   - critical sections are short and synchronous,
   - callers need the result immediately.
   Risks: contention under load, deadlocks with several locks, poisoning, and the guard being held across slow work.
3. Channels or the actor pattern fit when:
   - work flows through stages (a pipeline),
   - one owner should serialise all mutations, which makes invariants easy and needs no locks,
   - you need backpressure: a bounded `sync_channel` or `tokio::mpsc`,
   - the state is complex enough that fine-grained locking would be error-prone.
   Risks: an extra hop of latency, a single-consumer bottleneck, and request/response plumbing (oneshot reply channels).

```rust
use std::sync::mpsc::{sync_channel, Sender};
use std::collections::HashMap;

enum Cmd { Add(String, u64), Get(String, Sender<Option<u64>>) }

fn spawn_ledger() -> std::sync::mpsc::SyncSender<Cmd> {
    let (tx, rx) = sync_channel::<Cmd>(1024);
    std::thread::spawn(move || {
        let mut balances: HashMap<String, u64> = HashMap::new(); // owned by one thread
        for cmd in rx {
            match cmd {
                Cmd::Add(k, v) => *balances.entry(k).or_default() += v,
                Cmd::Get(k, reply) => { let _ = reply.send(balances.get(&k).copied()); }
            }
        }
    });
    tx
}
```

4. Middle ground: shard the locks (`dashmap`), use atomics for counters, or `arc-swap` for read-mostly config.
5. Verify. Load test and measure lock wait time, using `perf` or tracing spans around lock acquisition.

Common wrong answer: "channels are always better because Go says so". The right choice depends on the access pattern, and a well-scoped `Mutex` is often simpler and faster.

### tokio::spawn fails with "future cannot be sent between threads safely" after you added a lock. What is going on?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/std/marker/trait.Send.html -->
Answer:
1. Observe. The error points at an `.await` and says that a `std::sync::MutexGuard<..>`, which is `!Send`, "is held across an await point".
2. Hypothesise. An async fn compiles to a state machine that stores every local alive at each `.await`. If a guard is still alive at an await, it becomes part of the future. `MutexGuard` is `!Send`, so the whole future is `!Send`, and the multi-threaded runtime can't move it between workers. Even if it compiled, holding a blocking lock while suspended can deadlock other tasks on the same worker.
3. Fix: drop the guard before awaiting.

```rust
// Before
async fn bump(state: Arc<Mutex<Stats>>) {
    let mut g = state.lock().unwrap();
    g.count += 1;
    send_metric(g.count).await;          // guard alive here -> !Send
}

// After: scope the guard, copy what you need out
async fn bump(state: Arc<Mutex<Stats>>) {
    let count = {
        let mut g = state.lock().unwrap();
        g.count += 1;
        g.count
    };                                    // guard dropped
    send_metric(count).await;
}
```

   A plain `drop(g)` before the await also works in current compilers, but an explicit block is the clearest.
4. When the lock really must be held across the await (for example serialising use of a connection), use `tokio::sync::Mutex`. Its guard is `Send` and waiting for it yields instead of blocking. It is slower than the std lock, so use it only when needed.
5. Other `!Send` culprits: `Rc`, `RefCell` borrows, and `&mut` to `!Sync` data held across awaits.
6. Prevent. Enable clippy's `await_holding_lock` and `await_holding_refcell_ref` lints.

Wrong answer: switching every lock to `tokio::sync::Mutex` by default. That is slower and hides poor lock scoping.

### Your Tokio-based API has random p99 latency spikes of several seconds while CPU usage stays low. How do you debug it?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/book/ch17-00-async-await.html -->
Answer:
1. Observe. Spikes affect unrelated endpoints at the same moment. Health checks time out. CPU is low and there are no errors. Correlate with deploys, traffic and specific endpoints.
2. Hypothesise, most likely first:
   - Blocking calls on runtime threads: synchronous file or DB drivers, `std::thread::sleep`, heavy JSON or crypto, `reqwest::blocking`, DNS through `std::net::ToSocketAddrs`.
   - Long CPU-bound loops without yield points.
   - A contended `std::sync::Mutex` held during slow work.
   - Pool exhaustion: a DB pool that is too small, so tasks queue for connections.
   - Too few worker threads in the runtime configuration.
3. Verify:
   - Run `tokio-console` (with `console-subscriber`) and look for tasks with large "busy" times per poll, which mark blocking code.
   - Tokio runtime metrics: worker busy ratio, injection queue depth.
   - `tracing` spans with durations around DB acquire and external calls.
   - `perf` or a flame graph during a spike, looking for synchronous I/O syscalls on runtime worker threads.
4. Fix:

```rust
// CPU-heavy or blocking work off the async workers
let pdf = tokio::task::spawn_blocking(move || render_pdf(&report))
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;

// Long loops: yield periodically
for (i, row) in rows.iter().enumerate() {
    process(row);
    if i % 1024 == 0 { tokio::task::yield_now().await; }
}
```

   Replace blocking libraries with async ones (`tokio::fs`, `sqlx`, async `reqwest`). Narrow lock scopes. Size the pools, and add acquire timeouts so problems fail fast.
5. Prevent. Add a CI lint or review rule against blocking APIs in async modules, load tests with p99 SLOs, and alerts on runtime metrics.

Wrong answer: "add more worker threads". That only spreads the stall around and doesn't remove the blocking call.

### A multi-threaded batch job occasionally hangs forever. You suspect a deadlock. How do you find and fix it?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/std/sync/struct.Mutex.html -->
Answer:
1. Observe. The process is alive, CPU is at 0%, and progress logs stop. Take thread dumps: `gdb -p PID` then `thread apply all bt`, or `rust-gdb`/`lldb`. Look for threads parked in `futex_wait` inside `Mutex::lock`, `RwLock::write`, `Condvar::wait` or channel `recv`.
2. Hypothesise. Typical Rust deadlocks:
   - Lock-order inversion: thread A takes `accounts` then `audit`, while thread B takes `audit` then `accounts`.
   - Re-entrant locking: a function holding a guard calls a helper that locks the same `Mutex` again. std locks are not re-entrant, so this deadlocks or panics.
   - A guard that lives longer than you think: `match map.lock().unwrap().get(..) { .. }` keeps the temporary guard alive for the whole `match`. Rust 2024 shortens this for `if let` and tail expressions, but not for `match`.
   - A channel cycle: two threads each wait on `recv` from the other, or a bounded channel is full while its consumer waits on the producer.
   - `RwLock` writer starvation or a reader-to-writer upgrade attempt.
3. Verify. Map the backtraces to lock acquisition sites. With `parking_lot`, enable the `deadlock_detection` feature and check periodically. Add `tracing` around acquisitions.
4. Fix:

```rust
// Enforce a global order: always lock by ascending account id
fn transfer(a: &Account, b: &Account, amt: u64) {
    let (first, second) = if a.id < b.id { (a, b) } else { (b, a) };
    let mut g1 = first.balance.lock().unwrap();
    let mut g2 = second.balance.lock().unwrap();
    // ... adjust g1/g2 depending on direction
    let _ = (&mut g1, &mut g2, amt);
}
```

   Also bind guards to short, explicit scopes. Copy the data out before calling other code. Prefer a single owner (an actor) for state that spans several entities.
5. Prevent. Document lock ordering, add `try_lock_for` timeouts in debug builds, and stress-test with many threads.

Wrong answer: "Rust prevents deadlocks". It prevents data races, not deadlocks.

### A long-running Rust service's memory grows steadily until it is OOM-killed. How do you investigate?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/book/ch15-06-reference-cycles.html -->
Answer:
1. Observe. Is the growth linear with traffic, or with time? Does it ever plateau? Check RSS and the allocator's own stats, and correlate with endpoints or jobs.
2. Hypothesise. Safe Rust can still "leak":
   - Unbounded collections: caches without eviction, `HashMap`s keyed by request id, metrics with unbounded label cardinality.
   - Unbounded channels where producers outpace consumers.
   - Task leaks: spawned tasks waiting forever on something that never resolves, each holding buffers.
   - `Rc`/`Arc` cycles, for example a callback capturing an `Arc` of its owner.
   - `mem::forget`, `Box::leak` in a loop.
   - Allocator fragmentation: glibc malloc with many threads can keep RSS high after frees.
   - `Vec` capacity kept after a `clear()` on a buffer that once grew huge.
3. Verify:
   - Heap profiling: jemalloc (`tikv-jemallocator` plus `jemalloc_pprof`), `heaptrack`, `bytehound`, or `dhat-rs` in a test harness. Compare snapshots taken several minutes apart and see which allocation sites keep growing.
   - `tokio-console` or runtime metrics for the number of live tasks.
   - Channel length metrics.
4. Fix according to the cause:

```rust
// Bounded cache with eviction instead of a growing HashMap
use std::num::NonZeroUsize;
let mut cache: lru::LruCache<String, Vec<u8>> = lru::LruCache::new(NonZeroUsize::new(10_000).unwrap());

// Break cycles with Weak
struct Child { parent: std::sync::Weak<Parent> }
struct Parent;

// Bounded channel: producers get backpressure
let (tx, rx) = tokio::sync::mpsc::channel::<Vec<u8>>(1_000);
```

   For fragmentation, try jemalloc or mimalloc via `#[global_allocator]`, or set `MALLOC_ARENA_MAX`. Use `shrink_to` on long-lived buffers.
5. Prevent. Bound every queue and cache, export collection sizes as metrics, and run soak tests with memory alerts.

Wrong answer: "Rust is memory safe, so it can't leak". Leaking is explicitly safe in Rust.

### Your library returns Result<T, String> everywhere and users complain they can't handle errors properly. How do you redesign error handling?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/std/error/trait.Error.html -->
Answer:
1. Observe. Callers match on substrings (`e.contains("timeout")`), the cause chain and backtraces are lost, and `String` doesn't implement `std::error::Error`, so it composes badly with `?` and `anyhow`.
2. Design principles:
   - Libraries expose typed errors: an enum per module or operation with variants callers can act on (retry, NotFound, Unauthorised).
   - Keep the underlying cause through `source()`, not by pasting it into the message.
   - Mark the type `#[non_exhaustive]` so variants can be added later.
   - Make it `Send + Sync + 'static`, so it works with threads and `anyhow`.
   - Keep the variant count focused. Not every internal failure needs to be public, so group them into an `Internal` variant with a source.
3. Implement with `thiserror` to avoid boilerplate:

```rust
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum FetchError {
    #[error("resource {id} not found")]
    NotFound { id: u64 },
    #[error("request timed out after {0:?}")]
    Timeout(std::time::Duration),
    #[error("transport error")]
    Transport(#[from] std::io::Error),
    #[error("invalid response body")]
    Decode(#[source] serde_json::Error),
}

impl FetchError {
    pub fn is_retryable(&self) -> bool {
        matches!(self, FetchError::Timeout(_) | FetchError::Transport(_))
    }
}
```

4. Migrate. Introducing a new error type changes the public API, so ship it in a semver-major release with notes for upgraders. In the meantime, `impl From<FetchError> for String` can ease the transition.
5. The application side uses `anyhow` with `.context()` for reporting, and downcasts only where it needs special handling.
6. Prevent. Add clippy lints such as `result_large_err` and review guidelines.

Wrong answers: one huge crate-wide enum mirroring every dependency error (it leaks implementation details), and exposing `anyhow::Error` from a library.

### A production service crashed due to an unwrap() on a None. How do you respond and prevent it from happening again?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html -->
Answer:
1. Contain. Restart or roll back. Find out whether the panic killed the process (`panic = "abort"`, or a panic on the main thread) or only a task or thread, and whether any Mutex was poisoned and is now failing every request.
2. Observe. Get the panic message and backtrace: `RUST_BACKTRACE=1`, and production builds with `debug = "line-tables-only"` for symbolised traces. Find the input that triggered it in the logs.
3. Root cause. Usually an assumption that external data is always present: a missing JSON field, an empty list, a config key, or an index lookup on user input.
4. Fix the code path. Turn the panic into a handled error:

```rust
// Before
let region = req.headers.get("x-region").unwrap().to_str().unwrap();

// After
let region = req.headers
    .get("x-region")
    .and_then(|v| v.to_str().ok())
    .ok_or(ApiError::BadRequest("missing or invalid x-region header"))?;
```

   Keep `expect("why this can't fail")` for real invariants, such as a compiled regex literal.
5. Make the system resilient:
   - Install a panic hook that logs the panic with request context and increments a metric.
   - The HTTP framework should catch panics per request. Axum with tower-http's `CatchPanicLayer` returns a 500 instead of dropping the connection.
   - Check spawned tasks' `JoinHandle` results.
6. Prevent:
   - Clippy `unwrap_used`/`expect_used` in non-test code through the `[lints]` table.
   - Property tests and fuzzing (`cargo fuzz`) for parsers.
   - Return `Result` from handlers.

Wrong answer: wrapping everything in `catch_unwind`. Panics are for bugs. Make expected failures into values instead.

### Someone rewrote a Python script in Rust and it runs slower. What do you check?
<!-- level: basic; kind: scenario; ref: https://doc.rust-lang.org/cargo/reference/profiles.html -->
Answer:
1. Build mode. Was it run with `cargo run` (a debug build)? Debug builds skip optimisation and can be 10–100x slower. Use `cargo run --release`. This explains most reports.
2. I/O patterns:
   - Unbuffered reads or writes. `File::read` byte by byte and `println!` in tight loops each make a syscall and take a lock.
   - Wrap them in `BufReader`/`BufWriter`, and lock stdout once (`let mut out = io::stdout().lock();`).

```rust
use std::io::{self, BufRead, BufWriter, Write};
let stdin = io::stdin().lock();
let mut out = BufWriter::new(io::stdout().lock());
for line in stdin.lines() {
    let line = line?;
    writeln!(out, "{}", line.to_uppercase())?;
}
```

3. Allocation churn: a new `String` per line (`read_line` into a reused buffer is better), `clone()` in loops, `format!` for every key, `collect()` between steps of a chain.
4. Hashing. The default SipHash is slower than Python's dict for small keys. Try `FxHashMap` or `ahash` for trusted data.
5. Regex compiled inside a loop. Compile it once with `LazyLock`.
6. Algorithmic differences: `Vec::contains` in a loop (O(n²)) where Python used a set.
7. Verify with a profiler (`cargo flamegraph`, `samply`) and not by intuition. Benchmark with `hyperfine` across runs.
8. Prevent. Add a release-mode benchmark to CI, plus a README note to run with `--release`.

Common wrong answer: "rewrite the hot loop with unsafe". The fixes are almost always build mode, buffering and allocation.

### Code review: a module has .clone() on almost every line to satisfy the borrow checker. How do you improve it?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html -->
Answer:
1. Observe and classify the clones:
   - Cheap and intentional: `Arc::clone`, `Copy`-like small types. These are fine.
   - Clones to satisfy a function signature that takes `String`/`Vec` by value but only reads them. Fix the signature.
   - Clones to work around overlapping borrows of `self`. Fix the structure.
   - Clones into closures or threads that really need owned data. These are legitimate, but consider `Arc`.
2. Fix patterns:
   - Accept borrowed forms: `&str`, `&[T]`, `&T`, `impl AsRef<Path>`.
   - Return borrowed data from getters: `fn name(&self) -> &str`.
   - Take ownership only when you store the value. `fn set_name(&mut self, name: impl Into<String>)` lets callers move in values they no longer need.
   - Use `std::mem::take` or `Option::take` to move values out of a `&mut` without cloning.
   - Iterate with `iter()` instead of `clone().into_iter()`.
   - Share large immutable data with `Arc<T>`/`Arc<str>`.

```rust
// Before
fn render(user: User, template: String) -> String { format!("{}{}", template, user.name.clone()) }
let html = render(user.clone(), tpl.clone());

// After
fn render(user: &User, template: &str) -> String { format!("{template}{}", user.name) }
let html = render(&user, &tpl);

// Move out of a struct field without cloning
let pending = std::mem::take(&mut self.pending); // leaves an empty Vec
```

3. Verify with benchmarks or allocation counts (dhat), and confirm behaviour stays the same with tests.
4. Prevent. Clippy flags `redundant_clone` (in the nursery group) and `needless_pass_by_value` (pedantic). Enable them selectively.

Nuance: a clone of a small `String` at startup is fine. Optimise hot paths and API shape, not every clone.

### Incremental builds of your 150k-line Rust service take 90 seconds. How do you speed up the edit-compile loop?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/cargo/reference/workspaces.html -->
Answer:
1. Observe. Run `cargo build --timings` and look at the HTML report: which crates dominate, how much is codegen versus linking, and how much parallelism there is. `cargo llvm-lines` shows monomorphization bloat.
2. Common causes:
   - One giant crate, so every edit recompiles everything. Codegen units help, but crate boundaries help much more.
   - Heavy generics instantiated many times (serde, builders, `impl Into` everywhere).
   - Proc-macro-heavy dependencies, and a `build.rs` that reruns on every build.
   - A slow linker. Linking can take 30%+ of an incremental build.
   - Iterating with `cargo build` when `cargo check` would do.
3. Fixes:
   - Split into a workspace (domain, storage, api, cli) so edits recompile only the affected crates.
   - Use a fast linker: `lld` (the default on x86_64 Linux since Rust 1.90) or `mold`.
   - Lower debug info in dev: `debug = "line-tables-only"` or `0`.
   - Optimise dependencies but not your own code in dev: `[profile.dev.package."*"] opt-level = 1`.
   - Make generic functions thin: generic outer shell, non-generic inner body.
   - Reduce proc-macro use, and make `build.rs` use `rerun-if-changed`.
   - `sccache` for CI caching. Disable unused dependency features (`default-features = false`).

```toml
# .cargo/config.toml (Linux)
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=mold"]

# Cargo.toml
[profile.dev]
debug = "line-tables-only"
```

4. Verify by comparing `--timings` before and after.
5. Prevent. Track build time in CI, and review new heavy dependencies.

Wrong answer: "turn off the borrow checker" or "use opt-level 0 everywhere". Borrow checking is rarely the bottleneck. Codegen and linking are.

### A job spawns a Tokio task per item for 2 million items and the service falls over. How do you fix the concurrency model?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/book/ch17-00-async-await.html -->
Answer:
1. Observe. Memory spikes, file descriptors run out ("too many open files"), the downstream API returns 429s, and the DB pool times out.
2. Hypothesise. Unbounded concurrency. `tokio::spawn` is cheap, but each task holds its buffers and opens a connection at the same moment as the others. The bottleneck has moved downstream, and nothing applies backpressure.
3. Fix: bound the in-flight work.

```rust
use futures::{stream, StreamExt, TryStreamExt};

async fn process_all(ids: Vec<u64>, client: &Client) -> anyhow::Result<Vec<Summary>> {
    stream::iter(ids)
        .map(|id| async move { client.fetch_summary(id).await })
        .buffer_unordered(64)          // at most 64 requests in flight
        .try_collect()
        .await
}

// Or with spawn + Semaphore when tasks must be independent
use std::sync::Arc;
use tokio::sync::Semaphore;
let permits = Arc::new(Semaphore::new(64));
let mut set = tokio::task::JoinSet::new();
for id in ids {
    let permit = Arc::clone(&permits).acquire_owned().await?;
    set.spawn(async move { let _p = permit; work(id).await });
}
while let Some(res) = set.join_next().await { res??; }
```

4. Tune the limit to match downstream capacity (DB pool size, API rate limits), and add retries with backoff and jitter. Stream the input (read from a file or DB cursor), so you never hold 2M items in memory.
5. Verify. Watch in-flight counts, latency and error rates while ramping up the limit.
6. Prevent. Make bounded concurrency a code-review rule. Use `JoinSet` so tasks are tracked and cancelled together.

Wrong answer: raising ulimits and pool sizes. That moves the overload to the database.

### Messages are occasionally lost in a tokio::select! loop that reads from a socket and also listens for shutdown. Why?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/std/future/trait.Future.html -->
Answer:
1. Observe. Loss happens only under load, and seems to line up with timer ticks or shutdown signals winning the select.
2. Hypothesise. Cancellation safety. Each loop iteration of `select!` creates fresh futures for every branch and drops the ones that lose. If a losing branch had partly done its work, such as reading bytes into an internal buffer, those bytes are discarded with the future. Methods like `AsyncBufReadExt::read_line` or a hand-written "read header, then body" async fn are not cancel-safe. `mpsc::Receiver::recv`, `TcpListener::accept` and `AsyncReadExt::read` (into your own buffer) are.
3. Verify. Check the "Cancel safety" section of each method's docs, and reproduce with a short interval timer branch to force frequent cancellations.
4. Fix options:
   - Keep the stateful future alive across iterations: create it once, pin it, and select on `&mut fut`.
   - Use a framed stream (`tokio_util::codec::FramedRead` + `StreamExt::next`), which is cancel-safe because the buffering lives in the stream, not in the future.
   - Move the reading into its own task that sends complete messages over a channel. The select loop then only does `rx.recv()`.

```rust
use futures::StreamExt;
use tokio_util::codec::{FramedRead, LinesCodec};

let mut lines = FramedRead::new(socket, LinesCodec::new());
loop {
    tokio::select! {
        _ = shutdown.cancelled() => break,
        maybe = lines.next() => match maybe {      // cancel-safe
            Some(Ok(line)) => handle(line).await,
            Some(Err(e)) => { tracing::warn!(%e); break; }
            None => break,
        },
    }
}
```

5. Prevent. Document cancel-safety assumptions, and prefer stream or channel-based designs in select loops.

Common wrong answer: "add biased; to the select". That changes which branch is checked first, but not the data loss.

### You are designing a plugin system for a data pipeline. Generics or trait objects?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/reference/types/trait-object.html -->
Answer:
1. Clarify. Is the set of plugins known at compile time? Are plugins chosen from configuration at runtime? Must third parties add them? How hot is the call path?
2. Generics (static dispatch): `Pipeline<S: Source, T: Transform>`.
   - Pros: inlining, zero call overhead, and the compiler knows every type, so associated types and `Self`-returning methods work.
   - Cons: the type is fixed at compile time, signatures balloon, compile times and binary size grow, and you can't hold a heterogeneous list.
3. Trait objects (dynamic dispatch): `Vec<Box<dyn Transform>>`.
   - Pros: runtime composition from config, heterogeneous collections, stable compile times, a simpler public API.
   - Cons: a vtable call per method with no inlining, plus the dyn-compatibility rules (no generic methods, no `-> Self`, and `async fn` needs boxing).
4. Typical hybrid: `dyn` at the composition boundary, batch processing inside, so the dynamic call cost is spread over many records.

```rust
pub trait Transform: Send + Sync {
    fn name(&self) -> &str;
    fn apply(&self, batch: &mut Vec<Record>) -> Result<(), PipelineError>; // batch-level
}

pub struct Pipeline { stages: Vec<Box<dyn Transform>> }

impl Pipeline {
    pub fn from_config(cfg: &[StageCfg]) -> Result<Self, PipelineError> {
        let stages = cfg.iter().map(build_stage).collect::<Result<_, _>>()?;
        Ok(Self { stages })
    }
    pub fn run(&self, mut batch: Vec<Record>) -> Result<Vec<Record>, PipelineError> {
        for s in &self.stages { s.apply(&mut batch)?; }
        Ok(batch)
    }
}
```

5. A closed set of plugins can be an `enum Stage { Filter(..), Map(..) }`. That is faster than `dyn`, exhaustive and serialisable.
6. For true third-party plugins in other binaries, a Rust trait isn't a stable ABI. Use WASM (wasmtime), a C ABI (`abi_stable`), or out-of-process plugins.

Wrong answer: "dyn is slow, never use it". Vtable calls cost a few nanoseconds and only matter per element in tight loops.

### You must expose a Rust library to C and Python callers. How do you design the FFI layer safely?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-extern.html -->
Answer:
1. Layering. Keep the core crate pure safe Rust. Add a thin `ffi` crate (`crate-type = ["cdylib", "staticlib"]`) that converts types and catches panics.
2. ABI design rules:
   - Use C types only: `#[repr(C)]` structs, integers, `*const c_char` (a NUL-terminated string), and opaque handles (`*mut Engine` created with `Box::into_raw`).
   - Ownership must be explicit. Every `*_new` has a matching `*_free` that calls `Box::from_raw`. Strings returned to C get a `string_free`.
   - Signal errors with return codes plus a `last_error_message()` getter. Never let a panic cross the boundary: wrap the body in `catch_unwind`.
   - Rust 2024: write `#[unsafe(no_mangle)]` and declare imports in `unsafe extern "C"` blocks.

```rust
use std::ffi::{c_char, c_int, CStr};
use std::panic::catch_unwind;

pub struct Engine { rules: Vec<String> }

#[unsafe(no_mangle)]
pub extern "C" fn engine_new() -> *mut Engine {
    Box::into_raw(Box::new(Engine { rules: vec![] }))
}

/// # Safety: `e` from engine_new, `rule` a valid NUL-terminated string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_add_rule(e: *mut Engine, rule: *const c_char) -> c_int {
    let result = catch_unwind(std::panic::AssertUnwindSafe(|| {
        // SAFETY: caller contract above
        let (e, rule) = unsafe { (e.as_mut(), rule.as_ref()) };
        let (Some(e), Some(_)) = (e, rule) else { return -1 };
        let s = unsafe { CStr::from_ptr(rule) }.to_string_lossy().into_owned();
        e.rules.push(s);
        0
    }));
    result.unwrap_or(-2)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_free(e: *mut Engine) {
    if !e.is_null() { drop(unsafe { Box::from_raw(e) }); }
}
```

3. Generate headers with `cbindgen`. For Python, skip the C layer and use PyO3 with maturin, which handle reference counting, the GIL and exceptions safely.
4. Verify with C-side tests under ASan/Valgrind, Miri for the Rust parts, and fuzzing of inputs.
5. Prevent. Version the ABI, and never expose Rust types like `String`/`Vec` directly.

Wrong answer: passing `&str` or `Vec` across `extern "C"`. Their layout is not part of any stable ABI.

### A pull request adds an unsafe block to speed up a hot loop. How do you review it?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/nomicon/what-unsafe-does.html -->
Answer:
1. Justify the need. Ask for a benchmark (criterion) that shows a meaningful gain in the real workload, and check whether a safe alternative gets the same result: iterators, `chunks_exact`, an assert before the loop so LLVM drops bounds checks, or `slice::split_at`.
2. Check soundness. For each unsafe operation, write down the precondition and confirm that the surrounding code enforces it on every path, including edge cases (empty input, `usize` overflow in `ptr.add(i)`, alignment, zero-sized types).
   - Raw pointers: in bounds? aligned? initialised? no aliasing `&mut`?
   - `get_unchecked`: is the index provably below `len`, including after any mutation?
   - `from_utf8_unchecked`: are the bytes really UTF-8 on every path?
   - `transmute`: are the layouts guaranteed (`repr(C)` or `transparent`)? Are the target type's values all valid?
   - `Send`/`Sync` impls: is the type really thread-safe?
3. Encapsulation. The unsafe code should sit behind a safe function whose API makes misuse impossible. If a caller can trigger UB with safe code, the function must be marked `unsafe fn`, or the abstraction is unsound.
4. Documentation. Require a `// SAFETY:` comment on every block (clippy's `undocumented_unsafe_blocks`) and a `# Safety` section on unsafe fns.
5. Testing. Run Miri on tests for this module (`cargo +nightly miri test`), add property tests and fuzzing around boundaries, and `loom` if atomics are involved.

```rust
// Often the safe version is just as fast:
fn sum_pairs(a: &[u32], b: &[u32]) -> u64 {
    let n = a.len().min(b.len());
    let (a, b) = (&a[..n], &b[..n]);          // re-slice: bounds checks elided
    a.iter().zip(b).map(|(&x, &y)| (x as u64) * (y as u64)).sum()
}
```

6. Prevent. Set `#![deny(unsafe_op_in_unsafe_fn)]` (the 2024 default warns), keep unsafe code in a dedicated module, and make sure reviewers know the Nomicon.

Wrong approach: approving because "the tests pass". UB often passes tests.

### How would you migrate a large workspace from Rust 2021 to the 2024 edition?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/edition-guide/rust-2024/index.html -->
Answer:
1. Preparation. Upgrade the toolchain to 1.85 or later (pin it in `rust-toolchain.toml`). Make sure CI is green and clippy is clean. Editions are per crate, so migrate one crate at a time, starting with leaf crates.
2. Automatic migration, per crate:

```bash
cargo fix --edition -p orders-core --all-targets --all-features
# then in Cargo.toml: edition = "2024"
cargo build -p orders-core --all-targets && cargo test -p orders-core
```

   It adds `unsafe extern`, `#[unsafe(no_mangle)]`, explicit `unsafe {}` inside unsafe fns, `use<..>` bounds where RPIT capture would change, `expr_2021` in macros, and renames identifiers named `gen`.
3. Review manually what tools can't decide:
   - Drop order changes in `if let` scrutinees and tail expressions. Lock guards and `RefCell` borrows are now released earlier. That usually fixes bugs, but check code that relied on a guard staying alive (for example `if let Some(x) = lock.lock().unwrap().get() { .. } else { .. }`).
   - `impl Trait` returns now capture all lifetimes, so some callers may hit new borrow errors. Add `+ use<..>` to restrict the capture where needed.
   - `std::env::set_var`/`remove_var` are now unsafe. Move them to startup, or remove them (often found in tests, where it is a real race risk because tests run in parallel).
   - `static mut` references are now denied. Replace with atomics, `Mutex`, `OnceLock` or `&raw mut`.
   - `Box<[T]>::into_iter` now yields values, not references.
   - Never-type fallback changes may affect code that unwraps results of `!`-typed expressions.
4. Cargo. Resolver 3 (MSRV-aware) becomes the default. Set `rust-version` so dependency selection respects it.
5. Verify. Run the full test suite, benchmarks, Miri for unsafe crates, and a canary deployment.
6. Prevent. Add a CI job with the edition lints (`cargo clippy -- -W rust-2024-compatibility`) on crates that haven't migrated yet.

Wrong answer: bumping the edition string across the whole workspace in one commit without running `cargo fix`.

### Two threads read a counter with an atomic load, check a limit and then increment it. Sometimes the limit is exceeded. Why, and how do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/std/sync/atomic/index.html -->
Answer:
1. Observe. With a limit of 100 the counter reaches 103 under load. There are no crashes and no compiler errors.
2. Hypothesise. A check-then-act race condition. Each `load` and `fetch_add` is atomic by itself, but the sequence of the two isn't. Two threads can both load 99, both pass the check, and both increment. Rust prevents data races (unsynchronised memory access). It does not prevent logical race conditions.
3. Fix: make the check and the update one atomic operation.

```rust
use std::sync::atomic::{AtomicU32, Ordering};

static IN_FLIGHT: AtomicU32 = AtomicU32::new(0);
const LIMIT: u32 = 100;

fn try_acquire() -> bool {
    IN_FLIGHT
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| (n < LIMIT).then_some(n + 1))
        .is_ok() // CAS loop: retries if another thread changed it meanwhile
}

fn release() { IN_FLIGHT.fetch_sub(1, Ordering::Release); }
```

   Alternatives: a `Mutex` around the counter and the check (simple, and fine at moderate contention), a `Semaphore` (`tokio::sync::Semaphore` in async code, which also gives you RAII permits), or "increment first, then roll back if over the limit".
4. Verify with a stress test of many threads and many iterations, asserting the counter never goes above the limit. Use `loom` to check every possible interleaving exhaustively in unit tests.
5. Prevent. Use RAII guards for acquire/release so early returns and panics can't leak permits.

Wrong answer: "use SeqCst". Stronger ordering doesn't make two separate operations atomic together.

### You need an event bus where components register callbacks that capture state and can be invoked from worker threads. How do you type it?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/std/ops/trait.Fn.html -->
Answer:
1. Requirements:
   - Different closures with different captured state, so each has its own type: you need trait objects.
   - Invoked from other threads: `Send + Sync` (or a lock).
   - Stored indefinitely: `'static`, so they can't borrow locals.
   - May mutate their own state: `FnMut` behind a `Mutex`, or `Fn` with interior mutability.
2. Typical type: `Arc<dyn Fn(&Event) + Send + Sync>`. `Arc` allows cloning the handler list so you can call handlers without holding the registry lock.

```rust
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone)]
pub enum Event { OrderPlaced(u64), OrderCancelled(u64) }

type Handler = Arc<dyn Fn(&Event) + Send + Sync + 'static>;

#[derive(Default)]
pub struct Bus { handlers: RwLock<HashMap<u64, Handler>>, next_id: std::sync::atomic::AtomicU64 }

impl Bus {
    pub fn subscribe(&self, f: impl Fn(&Event) + Send + Sync + 'static) -> u64 {
        let id = self.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.handlers.write().unwrap().insert(id, Arc::new(f));
        id // return a handle so callers can unsubscribe
    }
    pub fn unsubscribe(&self, id: u64) { self.handlers.write().unwrap().remove(&id); }
    pub fn publish(&self, e: &Event) {
        let snapshot: Vec<Handler> = self.handlers.read().unwrap().values().cloned().collect();
        for h in snapshot { h(e); }        // no lock held while running user code
    }
}
```

3. Pitfalls handled here: re-entrancy (a handler that subscribes during publish would deadlock if we held the lock), unsubscription through ids, and stateful closures that use atomics or a `Mutex` internally.
4. Cycles. If a handler captures an `Arc<Bus>`, you create a cycle. Capture a `Weak<Bus>` instead.
5. Alternatives: a `tokio::sync::broadcast` channel, where subscribers own receivers (no callbacks, natural backpressure), which is often a cleaner design for async systems.

Wrong answer: `Vec<Box<dyn FnMut(&Event)>>` inside a `Mutex` that is held during dispatch. It deadlocks on re-entrancy and serialises everything.

### You must process a 20 GB log file and aggregate counts per endpoint with bounded memory. How do you write it?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/std/io/trait.BufRead.html -->
Answer:
1. Constraints. The file doesn't fit in memory, so stream it. The number of distinct endpoints is probably small. The process is CPU-bound on parsing.
2. Streaming with buffer reuse. Avoid `lines()`, which allocates a `String` per line. Use `read_line` or `read_until` into one buffer that you clear on each iteration, and borrow slices from it.

```rust
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};

fn aggregate(path: &str) -> std::io::Result<HashMap<String, u64>> {
    let mut reader = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut buf = Vec::with_capacity(512);
    let mut counts: HashMap<String, u64> = HashMap::new();

    while reader.read_until(b'\n', &mut buf)? != 0 {
        // e.g. `2026-11-18T10:00:00Z GET /orders 200 12ms`
        if let Some(endpoint) = buf.split(|&b| b == b' ').nth(2) {
            let ep = String::from_utf8_lossy(endpoint);
            if let Some(c) = counts.get_mut(ep.as_ref()) {
                *c += 1;                                   // no allocation on hit
            } else {
                counts.insert(ep.into_owned(), 1);
            }
        }
        buf.clear();
    }
    Ok(counts)
}
```

3. Notes:
   - Work on bytes, so invalid UTF-8 doesn't abort the job, and decode only the field you need.
   - `get_mut` before `insert` avoids allocating a key for endpoints you've already seen. The Entry API would allocate a `String` for every line.
   - A 1 MiB buffer reduces syscalls.
4. Parallelism. Split the file into byte ranges aligned to newlines, process each chunk on a rayon thread with its own map, then merge. Alternatively, `memmap2` gives zero-copy access, with care about files that are modified underneath.
5. Verify. Compare against a known subset, and measure throughput (GB/s) with `hyperfine`. Expect to be I/O bound at about 1–2 GB/s per core.
6. Bounded memory. If the key cardinality is unknown, cap it with a count-min sketch or top-K, or spill to disk.

Wrong answer: `fs::read_to_string` of the whole file.

### Configuration must be hot-reloaded while hundreds of request threads read it on every request. How do you share it?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/std/sync/struct.RwLock.html -->
Answer:
1. Requirements. Reads are extremely frequent and must be fast and consistent: a request should see one config version, not half an old one and half a new one. Writes are rare (a reload every few minutes).
2. Options:
   - `RwLock<Config>`: simple, but readers hold the lock while they use the config, and clones or long reads block the writer. Under heavy read contention, the lock's cache line bounces between cores.
   - `RwLock<Arc<Config>>`: readers take the lock only long enough to clone the `Arc`, then release it. That gives a consistent snapshot per request and very short critical sections.
   - `arc_swap::ArcSwap<Config>`: lock-free reads through `load()`, and an atomic pointer swap on reload. Best for read-heavy hot paths.
   - `tokio::sync::watch`: async-friendly, and lets tasks be notified of changes.

```rust
use std::sync::{Arc, RwLock};

#[derive(Debug)]
pub struct Config { pub rate_limit: u32, pub feature_x: bool }

pub struct Shared { current: RwLock<Arc<Config>> }

impl Shared {
    pub fn snapshot(&self) -> Arc<Config> {
        Arc::clone(&self.current.read().unwrap()) // lock held for nanoseconds
    }
    pub fn reload(&self, new_cfg: Config) {
        let new = Arc::new(new_cfg);               // build outside the lock
        *self.current.write().unwrap() = new;      // old Arc freed when last reader drops it
    }
}

fn handle_request(shared: &Shared) {
    let cfg = shared.snapshot();                   // consistent for the whole request
    if cfg.feature_x { /* ... */ }
}
```

3. Validation. Parse and validate the new config fully before swapping. Keep the old one if validation fails, and log the change.
4. Verify with a microbenchmark of `snapshot()` under N threads, and a test that a reload during requests never yields a mixed state.
5. Prevent. Make the `Config` type immutable (no interior mutability), so snapshots really are snapshots.

Wrong answer: a `static mut CONFIG` that you swap with unsafe code. It is a data race, UB, and denied by default in Rust 2024.

### Code that calls an external payment API and the system clock is hard to unit test. How do you make it testable in Rust?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/book/ch11-01-writing-tests.html -->
Answer:
1. Identify the seams: HTTP calls, time, randomness and the database. Put each behind a small trait that describes what the domain needs, not the vendor's API.
2. Inject the dependencies. For static dispatch, use generics: `PaymentService<G: Gateway, C: Clock>`. That has zero cost, but the generics spread. Alternatively, store `Arc<dyn Gateway>` fields, which are simpler to wire up. The vtable cost is irrelevant next to network calls.

```rust
use std::time::{Duration, SystemTime};

pub trait Clock: Send + Sync { fn now(&self) -> SystemTime; }
pub trait Gateway: Send + Sync {
    fn charge(&self, cents: u64, idempotency_key: &str) -> Result<String, String>;
}

pub struct PaymentService<G, C> { gateway: G, clock: C }

impl<G: Gateway, C: Clock> PaymentService<G, C> {
    pub fn charge_if_open(&self, cents: u64, closes_at: SystemTime) -> Result<String, String> {
        if self.clock.now() > closes_at { return Err("window closed".into()); }
        self.gateway.charge(cents, "order-42")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FixedClock(SystemTime);
    impl Clock for FixedClock { fn now(&self) -> SystemTime { self.0 } }

    #[derive(Default)]
    struct FakeGateway { calls: Mutex<Vec<u64>> }
    impl Gateway for FakeGateway {
        fn charge(&self, cents: u64, _: &str) -> Result<String, String> {
            self.calls.lock().unwrap().push(cents); Ok("txn_1".into())
        }
    }

    #[test]
    fn rejects_after_close() {
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
        let svc = PaymentService { gateway: FakeGateway::default(), clock: FixedClock(t0) };
        assert!(svc.charge_if_open(500, t0 - Duration::from_secs(1)).is_err());
        assert!(svc.gateway.calls.lock().unwrap().is_empty());
    }
}
```

3. In async code, `#[tokio::test(start_paused = true)]` with `tokio::time::advance` controls timers deterministically.
4. HTTP-level tests: run `wiremock` as a local mock server for integration tests of the real client.
5. `mockall` can generate mocks from traits. Hand-written fakes are often clearer.

Wrong answer: environment-variable switches or `#[cfg(test)]` branches scattered through production logic.

### A repository trait with async methods must be used as Arc<dyn Repository> chosen at runtime. How do you make it work?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/reference/items/traits.html -->
Answer:
1. Observe. With a native `async fn` in the trait (stable since 1.75), `dyn Repository` fails with "the trait is not dyn compatible". Each implementation's async fn returns a different, unnamed future type, so a vtable can't describe the return type.
2. Options:
   - The `async-trait` crate. The macro rewrites methods to return `Pin<Box<dyn Future + Send + 'a>>`. It is dyn compatible and widely used, at the cost of one heap allocation per call, which is negligible next to a DB round trip.
   - Write it by hand: declare methods returning a `BoxFuture` yourself. No macro, and the same cost.
   - Avoid `dyn`: make services generic over `R: Repository`. This keeps native async fns with no allocation, but the generics spread through the code.
   - Use an enum of implementations (`enum Repo { Postgres(PgRepo), Memory(MemRepo) }`) with match-based delegation. It is fast and supports a closed set.

```rust
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait UserRepo: Send + Sync {
    fn find(&self, id: u64) -> BoxFuture<'_, Result<Option<String>, String>>;
}

pub struct MemRepo(Vec<(u64, String)>);

impl UserRepo for MemRepo {
    fn find(&self, id: u64) -> BoxFuture<'_, Result<Option<String>, String>> {
        Box::pin(async move {
            Ok(self.0.iter().find(|(i, _)| *i == id).map(|(_, n)| n.clone()))
        })
    }
}

pub fn build(env: &str) -> Arc<dyn UserRepo> {
    match env {
        // "prod" => Arc::new(PgRepo::connect(..)),
        _ => Arc::new(MemRepo(vec![(1, "ana".into())])),
    }
}
```

3. Make sure the futures are `Send`, which `tokio::spawn` requires. The `+ Send` in `BoxFuture` enforces it.
4. Prevent. Choose consciously per trait: `dyn` at app wiring boundaries, generics in hot paths.

Wrong answer: thinking 1.75 made async traits dyn compatible. It didn't. Dyn async traits still need boxing.

### Design a builder for an HTTP client config so that invalid configurations can't compile. How?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/book/ch18-03-oo-design-patterns.html -->
Answer:
1. The requirement: some fields are mandatory (base URL), some combinations are invalid (mTLS requires both a cert and a key), and runtime validation errors would arrive too late.
2. The typestate pattern. Encode builder state in type parameters. `build()` exists only in the state where every requirement is met. Zero-sized marker types cost nothing at runtime.

```rust
use std::marker::PhantomData;
use std::time::Duration;

pub struct NoUrl;
pub struct HasUrl(String);

pub struct ClientBuilder<U> { url: U, timeout: Duration, retries: u8 }

pub struct Client { url: String, timeout: Duration, retries: u8 }

impl ClientBuilder<NoUrl> {
    pub fn new() -> Self { Self { url: NoUrl, timeout: Duration::from_secs(30), retries: 3 } }
    pub fn base_url(self, url: impl Into<String>) -> ClientBuilder<HasUrl> {
        ClientBuilder { url: HasUrl(url.into()), timeout: self.timeout, retries: self.retries }
    }
}

impl<U> ClientBuilder<U> {
    pub fn timeout(mut self, t: Duration) -> Self { self.timeout = t; self }
    pub fn retries(mut self, n: u8) -> Self { self.retries = n; self }
}

impl ClientBuilder<HasUrl> {
    pub fn build(self) -> Client { Client { url: self.url.0, timeout: self.timeout, retries: self.retries } }
}

fn main() {
    let c = ClientBuilder::new().timeout(Duration::from_secs(5)).base_url("https://api").build();
    // ClientBuilder::new().build();   // compile error: no method `build` for ClientBuilder<NoUrl>
    let _ = (c.url, c.timeout, c.retries, PhantomData::<()>);
}
```

3. Trade-offs: more types and generics, less readable error messages, and it's awkward for many independent required fields. For those, take required values directly in the constructor (`Client::new(url)`) and use setters for the optional ones. The `bon` and `typed-builder` crates generate typestate builders automatically.
4. Combine this with newtypes (`BaseUrl::parse` validates the URL), so you don't pass raw strings around.
5. Test with compile-fail tests (`trybuild`) to check that invalid usage is rejected.

Wrong answer: an `Option` for every field and `unwrap` in `build()`. That pushes errors to runtime.

### Your HashMap-heavy hot path shows up as the top item in the profiler. How do you speed it up?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/std/collections/struct.HashMap.html -->
Answer:
1. Observe. The flame graph shows time in `core::hash::sip::Hasher`, `HashMap::insert`, `RawTable::reserve_rehash` and `String` allocation.
2. Hypothesise and fix, in order of typical impact:
   - Hasher. The default SipHash-1-3 resists HashDoS but is slow for small keys. For trusted or internal keys, use `rustc_hash::FxHashMap` or `ahash`, and keep SipHash for maps keyed by untrusted input such as HTTP headers from clients.
   - Rehashing. Preallocate with `with_capacity(n)` when you know the size.
   - Double lookups. `contains_key` then `insert`, or `get` then `insert`, hash twice. Use `entry()`. But `entry(key.to_owned())` allocates on every call, so for string keys use `get_mut` first and allocate only on a miss.
   - Key type. Intern strings into `u32` ids, or use small fixed arrays instead of `String`, to shrink keys and make hashing cheaper.
   - Data layout. If keys are dense integers, a `Vec<V>` indexed by id beats any map. For small maps (fewer than about 16 entries), a linear scan over a `Vec<(K, V)>` can win.

```rust
use rustc_hash::FxHashMap;

fn count_words<'a>(text: &'a str) -> FxHashMap<&'a str, u32> {
    let mut m: FxHashMap<&str, u32> = FxHashMap::default();
    m.reserve(4096);
    for w in text.split_ascii_whitespace() {
        *m.entry(w).or_insert(0) += 1;   // &str keys: no allocation per word
    }
    m
}
```

3. Verify each change with criterion, using realistic data and key distributions.
4. Prevent. Encapsulate the map behind a type so you can change its implementation without touching callers.

Wrong answer: switching to `BTreeMap` "because it's faster". It is O(log n), and usually slower for point lookups.

### A minor release of your library broke downstream users' builds. How do you prevent this in future?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/cargo/reference/semver.html -->
Answer:
1. Observe what broke. These are typical semver hazards in Rust:
   - Adding a variant to a public enum breaks exhaustive matches downstream.
   - Adding a public field to a struct with all-public fields breaks struct literals and patterns.
   - Adding a required method to a public trait (without a default) breaks implementors.
   - Adding a blanket impl, or an impl of a trait for a foreign type, can cause coherence conflicts or ambiguous method calls downstream.
   - Tightening generic bounds, or changing a function from generic to concrete.
   - Losing an auto trait. An internal change, such as adding an `Rc` field, can make a public type `!Send`, which breaks async users.
   - Raising the MSRV, or removing a default feature.
2. Fix now. Yank the broken release with `cargo yank` and publish a patch that restores compatibility, or re-release the change as a major version.
3. Design for evolution:
   - `#[non_exhaustive]` on public enums and structs that may grow.
   - Private fields plus constructors and builders rather than public fields.
   - Sealed traits (a supertrait from a private module) for traits users should call but not implement, so you can add methods freely.
   - Static assertions of auto traits in tests: `fn _assert_send<T: Send>() {} _assert_send::<Client>();`.

```rust
mod private { pub trait Sealed {} }

pub trait Codec: private::Sealed {          // users can't implement it
    fn encode(&self, v: &[u8]) -> Vec<u8>;
}

#[non_exhaustive]
#[derive(Debug)]
pub enum Format { Json, Cbor }
```

4. Prevent with tooling. Run `cargo-semver-checks` in CI against the last published version. Test the MSRV, `--no-default-features` and `--all-features`. Keep a CHANGELOG.

Wrong answer: "pin exact versions downstream". That pushes the problem onto every user.

### After adding a dependency you get "expected `http::Request`, found `http::Request`" type errors. What is happening?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/cargo/reference/resolver.html -->
Answer:
1. Observe. Two types with the same path and name don't match. This almost always means two semver-incompatible versions of the same crate are in the dependency graph (for example `http 0.2` and `http 1.x`), and their types are different types to the compiler.
2. Verify:

```bash
cargo tree -d                 # list duplicated crates
cargo tree -i http@0.2.12     # who depends on the old version?
```

3. Hypothesise. Your crate uses `http 1.x`, while one dependency, such as an older `reqwest` or `aws-sdk` adapter, is still on `0.2` and exposes `http` types in its public API.
4. Fix options:
   - Upgrade the lagging dependency to a version on the same major version of `http`.
   - Use the type through the dependency's re-export (`their_crate::http::Request`), so you always get the version that matches its API. Well-designed libraries re-export the crates that appear in their public API for exactly this reason.
   - Convert between the versions at the boundary, field by field, if both must coexist temporarily.
   - As a last resort, use `[patch.crates-io]` to point at a fork that has been updated.
5. Prevent:
   - `cargo deny check bans` with `multiple-versions = "warn"`.
   - Library authors: re-export public dependencies, and treat upgrading a public dependency's major version as a breaking change in your own crate.

Common wrong answer: transmuting one type into the other. The layouts aren't guaranteed to match, so it's UB.

### You need to remove items from a Vec while also reading other items in the same Vec (e.g. remove orders whose parent order is cancelled). The borrow checker complains. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/std/vec/struct.Vec.html -->
Answer:
1. Observe. Iterating with `iter()` while calling `remove(i)`, or reading `orders[parent]` inside `retain`'s closure, fails because `retain` already holds `&mut` to the vector.
2. Hypothesise. You need read access to the whole collection and mutation at the same time. That is aliasing plus mutation, which Rust forbids, and rightly so: removing elements shifts indices, so the reads would be inconsistent.
3. Fix: two-phase processing. First compute a decision from immutable data, then mutate.

```rust
use std::collections::HashSet;

#[derive(Debug)]
struct Order { id: u64, parent: Option<u64>, cancelled: bool }

fn drop_children_of_cancelled(orders: &mut Vec<Order>) {
    // Phase 1: immutable read
    let cancelled: HashSet<u64> = orders.iter().filter(|o| o.cancelled).map(|o| o.id).collect();
    // Phase 2: mutation using only the precomputed set
    orders.retain(|o| !o.parent.is_some_and(|p| cancelled.contains(&p)));
}

// Variant: when updates depend on other elements, compute new values first
fn propagate_flags(orders: &mut [Order]) {
    let flags: Vec<bool> = orders.iter()
        .map(|o| o.parent.is_some_and(|p| orders.iter().any(|x| x.id == p && x.cancelled)))
        .collect();
    for (o, f) in orders.iter_mut().zip(flags) { o.cancelled |= f; }
}
```

4. Other tools:
   - `split_at_mut` when you need one mutable element plus read access to the others.
   - `Vec::extract_if` (stable since 1.87) to remove and collect matching elements in one pass.
   - Index-based loops with `swap_remove`, iterating backwards.
   - `Cell` fields for small flags, if the data structure really must be updated during traversal.
5. Complexity. The `HashSet` keeps this O(n), compared with O(n²) for nested scans.
6. Prevent. Prefer pure "compute, then apply" functions. They are easier to test as well.

Wrong answer: indexing with `unsafe` raw pointers to get around the borrow checker.

### Your Axum/Tokio server must shut down gracefully on SIGTERM in Kubernetes without dropping in-flight requests. How do you implement it?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/book/ch21-03-graceful-shutdown-and-cleanup.html -->
Answer:
1. Requirements. On SIGTERM:
   - stop accepting new connections,
   - let in-flight requests finish within a deadline below K8s' `terminationGracePeriodSeconds`,
   - stop background workers cleanly, flushing queues, committing offsets, closing DB pools,
   - exit with code 0.
2. Design. Listen for the signal, broadcast cancellation with `CancellationToken`, and track tasks with `TaskTracker` or `JoinSet`.

```rust
use tokio::signal;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

async fn shutdown_signal() {
    let ctrl_c = async { signal::ctrl_c().await.expect("ctrl-c handler") };
    #[cfg(unix)]
    let term = async {
        signal::unix::signal(signal::unix::SignalKind::terminate()).expect("sigterm").recv().await;
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let token = CancellationToken::new();
    let tracker = TaskTracker::new();

    let worker_token = token.clone();
    tracker.spawn(async move { run_consumer(worker_token).await }); // checks token.cancelled()

    let app = axum::Router::new().route("/health", axum::routing::get(|| async { "ok" }));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    let server_token = token.clone();
    axum::serve(listener, app)
        .with_graceful_shutdown(async move { shutdown_signal().await; server_token.cancel(); })
        .await?;                                     // returns after in-flight requests finish

    tracker.close();
    tokio::time::timeout(std::time::Duration::from_secs(20), tracker.wait()).await.ok();
    Ok(())
}

async fn run_consumer(token: CancellationToken) {
    token.cancelled().await; // real code: select! between work and cancellation
}
```

3. Kubernetes details. Fail the readiness probe as soon as the signal arrives, so the Service removes the pod. A `preStop` sleep of a few seconds covers endpoint propagation delays. Keep the deadline below the grace period.
4. Verify with a load test that sends SIGTERM mid-traffic and expects zero 5xx errors or connection resets.

Wrong answer: `std::process::exit` in a signal handler. Destructors don't run, buffers aren't flushed, and in-flight work is lost.

### Clippy and the borrow checker are fine, but a reviewer says your public function signature is "un-idiomatic". What makes a good Rust API signature?
<!-- level: intermediate; kind: scenario; ref: https://doc.rust-lang.org/std/convert/trait.AsRef.html -->
Answer:
1. Look at the signature under review: `pub fn load(path: String, opts: &Vec<String>, verbose: bool) -> Option<Box<Config>>`.
2. Problems and fixes:
   - `path: String` forces callers to allocate. Use `impl AsRef<Path>` (accepts `&str`, `String`, `PathBuf`, `&Path`) and call a non-generic inner function to limit monomorphization.
   - `&Vec<String>` is needlessly specific. Use `&[String]`, or better, `&[impl AsRef<str>]` or `impl IntoIterator<Item = S>`.
   - A bare `bool` is unclear at call sites (`load(p, &o, true)`). Use an enum (`Verbosity::Quiet`) or an options struct.
   - `Option` hides why it failed. Return `Result<Config, LoadError>`.
   - `Box<Config>` is pointless indirection. Return `Config` by value. Moves are cheap.

```rust
use std::path::Path;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Verbosity { #[default] Quiet, Verbose }

#[derive(Debug, Default)]
pub struct LoadOptions<'a> { pub overrides: &'a [&'a str], pub verbosity: Verbosity }

pub fn load(path: impl AsRef<Path>, opts: &LoadOptions<'_>) -> Result<Config, LoadError> {
    load_inner(path.as_ref(), opts)          // non-generic body
}

fn load_inner(path: &Path, opts: &LoadOptions<'_>) -> Result<Config, LoadError> {
    let _ = (path, opts);
    Ok(Config)
}

#[derive(Debug)] pub struct Config;
#[derive(Debug)] pub struct LoadError;
```

3. General guidelines (from the Rust API Guidelines):
   - Borrow when you only read, take ownership when you store.
   - Return owned values or iterators (`impl Iterator`) rather than `&Vec`.
   - Implement common traits (`Debug`, `Clone`, `Default`).
   - Name conversions consistently: `as_` (cheap borrow), `to_` (expensive copy), `into_` (consumes).
4. Prevent. Enable clippy's pedantic lints selectively (`needless_pass_by_value`, `fn_params_excessive_bools`), and review with the API guidelines checklist.

Wrong answer: making everything generic with `impl Into<..>`. It hurts type inference and compile times. Use it where callers clearly benefit.

### A spawned thread needs to process a large Vec owned by main, and you don't want to clone it or wrap it in Arc. How?
<!-- level: basic; kind: scenario; ref: https://doc.rust-lang.org/std/thread/fn.scope.html -->
Answer:
1. Observe. `thread::spawn(|| process(&data))` fails because "borrowed value does not live long enough": `spawn` requires `'static`, since the thread might outlive `data`.
2. Options:
   - Scoped threads (1.63+). `std::thread::scope` guarantees every spawned thread is joined before the scope returns, so borrowing locals is safe. You can even split the data into disjoint `&mut` chunks.
   - Move ownership. If main no longer needs the data, `move` it into the thread and get it back through the `JoinHandle`'s return value.
   - Use `Arc<Vec<T>>` only when several threads share the data indefinitely.
   - Use rayon: `data.par_iter()` borrows internally and handles chunking.

```rust
use std::thread;

fn main() {
    let mut readings: Vec<f64> = (0..1_000_000).map(|i| i as f64).collect();
    let threshold = 500_000.0;

    let (count_above, total) = thread::scope(|s| {
        let h1 = s.spawn(|| readings.iter().filter(|&&r| r > threshold).count()); // shared borrow
        let h2 = s.spawn(|| readings.iter().sum::<f64>());
        (h1.join().unwrap(), h2.join().unwrap())
    });

    // Mutable, disjoint borrows in parallel
    thread::scope(|s| {
        for chunk in readings.chunks_mut(250_000) {
            s.spawn(move || chunk.iter_mut().for_each(|r| *r /= 1_000.0));
        }
    });

    // Ownership round-trip
    let handle = thread::spawn(move || { readings.sort_by(f64::total_cmp); readings });
    let sorted = handle.join().unwrap();
    println!("{count_above} {total} {}", sorted.len());
}
```

3. Why it's safe. The scope can't return until all its threads are joined, and the borrow checker treats the borrows as lasting for the whole scope.
4. Prevent. Default to scoped threads or rayon for fork-join parallelism, and use `spawn` plus `'static` for long-lived background workers.

Wrong answer: `unsafe` lifetime transmutes, or `Box::leak` to fake a `'static` lifetime.

### A tight numeric loop is 3x slower than the equivalent C. How do you find out why and close the gap?
<!-- level: advanced; kind: scenario; ref: https://doc.rust-lang.org/std/hint/fn.black_box.html -->
Answer:
1. Verify the measurement first:
   - Both built with optimisations (`--release`, and `-O2`/`-O3` for C).
   - The same algorithm and data types (`f64` vs `float`, `usize` vs `int`).
   - No I/O in the timed region.
   - The benchmark doesn't let the compiler delete work (`black_box`).
   - Repeated runs with criterion or hyperfine.
2. Hypothesise the usual Rust-specific costs:
   - Bounds checks preventing vectorisation (`v[i]` with an index the compiler can't prove is in range).
   - Integer overflow checks, if `overflow-checks = true` in release.
   - No `target-cpu`. C may have been built with `-march=native`, so AVX2 was used.
   - Aliasing. Rust's `&mut` gives noalias information that usually helps, but raw pointers or `Cell` remove it.
   - Strict floating point. Neither language reorders FP sums unless you allow it (`-ffast-math` in C).
   - Iterator chains that don't vectorise because of `chain`/`flat_map` branches.
3. Inspect: `cargo asm` or `cargo show-asm` for the function, or Compiler Explorer, looking for vector instructions and panic branches. Use `perf annotate` for the hot instructions.
4. Fix:

```rust
// Help the optimizer: prove lengths once, iterate with zip
pub fn saxpy(a: f32, x: &[f32], y: &mut [f32]) {
    let n = x.len().min(y.len());
    let (x, y) = (&x[..n], &mut y[..n]);
    for (yi, &xi) in y.iter_mut().zip(x) {
        *yi += a * xi;                 // no bounds checks -> auto-vectorised
    }
}

// Manual multi-accumulator for FP reductions (reassociation made explicit)
pub fn sum(v: &[f32]) -> f32 {
    let mut acc = [0.0f32; 8];
    let chunks = v.chunks_exact(8);
    let rem = chunks.remainder();
    for c in chunks { for i in 0..8 { acc[i] += c[i]; } }
    acc.iter().sum::<f32>() + rem.iter().sum::<f32>()
}
```

   Also: build with `-C target-cpu=x86-64-v3` (or native) if the deployment hardware allows it, use `std::arch` intrinsics as a last resort, and try PGO.
5. Prevent. Keep criterion benchmarks in CI with regression thresholds.

Wrong answer: blaming the borrow checker. It has no runtime cost.
