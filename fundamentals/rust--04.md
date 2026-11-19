## 9. Smart Pointers and Interior Mutability

### Box<T>: Heap Allocation and Recursive Types
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch15-01-box.html -->
`Box<T>` is the simplest smart pointer. It owns one heap-allocated `T` and frees it when dropped. A box is one pointer wide (two for unsized types such as `Box<dyn Trait>` or `Box<[T]>`). Apart from the allocation itself, it has no runtime overhead.

Use `Box` for:
1. Recursive types. `enum Expr { Num(f64), Add(Box<Expr>, Box<Expr>) }` would otherwise have infinite size.
2. Trait objects: `Box<dyn Error>`, `Vec<Box<dyn Handler>>`.
3. Moving large values cheaply. Moving a box copies one pointer, not the whole payload.
4. Shrinking enums by boxing a rarely used large variant.
5. Fixed-size buffers with `Box<[T]>`.

```rust
#[derive(Debug)]
enum Expr {
    Num(f64),
    Var(String),
    Add(Box<Expr>, Box<Expr>),
    Mul(Box<Expr>, Box<Expr>),
}

use Expr::*;

fn eval(e: &Expr, x: f64) -> f64 {
    match e {
        Num(n) => *n,
        Var(_) => x,
        Add(a, b) => eval(a, x) + eval(b, x), // &Box<Expr> auto-derefs to &Expr
        Mul(a, b) => eval(a, x) * eval(b, x),
    }
}

fn main() {
    // 2 * x + 1
    let expr = Add(
        Box::new(Mul(Box::new(Num(2.0)), Box::new(Var("x".into())))),
        Box::new(Num(1.0)),
    );
    println!("{}", eval(&expr, 5.0));

    let big = Box::new([0u8; 4096]);   // payload on heap; moving `big` copies 8 bytes
    let moved = big;
    println!("{}", moved.len());
}
```

`Box<T>` has a special ability no other library type has: you can move out of it with `*b`. The compiler treats `Box` as built in. `Box::leak` turns a box into a `&'static mut T` by giving up ownership.

- Pitfall: `Box::new([0u8; 10_000_000])` can overflow the stack in debug builds, because the array is built on the stack first. Use `vec![0; n].into_boxed_slice()`.
- Interview tip: `Vec<Box<T>>` adds an indirection for every element. Use it only when you need stable addresses or trait objects.

### Deref and Deref Coercion
<!-- level: intermediate; ref: https://doc.rust-lang.org/book/ch15-02-deref.html -->
The `Deref` trait makes `*x` work on smart pointers. More importantly, it enables deref coercion. When you pass `&U` where `&T` is expected and `U: Deref<Target = T>`, the compiler inserts as many `.deref()` calls as needed. That is how `&String` becomes `&str`, `&Vec<T>` becomes `&[T]`, `&Box<T>` becomes `&T`, and `&Arc<Mutex<T>>` gives access to the `Mutex`'s methods. Method calls also auto-deref: `rc_string.len()` resolves through `Rc` to `String` and then to `str`.

`DerefMut` does the same for `&mut`. Coercion happens only at coercion sites such as function arguments, `let` with a type annotation and method receivers. It never happens inside generic trait resolution.

```rust
use std::ops::{Deref, DerefMut};

// A guard that tracks whether the inner value was modified
struct Tracked<T> { value: T, dirty: bool }

impl<T> Deref for Tracked<T> {
    type Target = T;
    fn deref(&self) -> &T { &self.value }
}
impl<T> DerefMut for Tracked<T> {
    fn deref_mut(&mut self) -> &mut T { self.dirty = true; &mut self.value }
}

fn print_len(s: &str) { println!("len {}", s.len()); }

fn main() {
    let mut name = Tracked { value: String::from("ana"), dirty: false };
    print_len(&name);           // &Tracked<String> -> &String -> &str
    println!("{} dirty={}", name.to_uppercase(), name.dirty);
    name.push('!');             // DerefMut: marks dirty
    println!("{} dirty={}", *name, name.dirty);
}
```

Deref is meant for smart pointers: types whose job is to point to a `T`. That is exactly what `Tracked` above is.

- Pitfall: using `Deref` to imitate inheritance (`impl Deref for Manager { Target = Employee }`). Method resolution then gets confusing and the abstraction leaks.
- Pitfall: a method with the same name on both the wrapper and the target. The wrapper's method wins.
- Interview tip: be ready to say how many derefs `&&&String` needs to reach `&str` (the compiler finds the chain), and that `Deref` never fails, so it must be cheap.

### Rc, Arc and Weak
<!-- level: intermediate; ref: https://doc.rust-lang.org/book/ch15-04-rc.html -->
Some data really does have several owners: graph nodes, shared configuration, caches. `Rc<T>` (single-threaded) and `Arc<T>` (atomic, thread-safe) provide shared ownership through reference counting. `clone()` increments a strong count and returns another pointer to the same allocation. When the last strong reference is dropped, the value is dropped too. Both give shared (`&T`) access only. To mutate, combine them with `RefCell`, `Mutex`, `RwLock` or atomics.

`Arc` uses atomic increments and decrements, which cost more than `Rc`'s plain integer operations, especially under contention. `Rc` is `!Send`, so the compiler stops you from accidentally sharing it across threads.

`Weak<T>` is a non-owning handle created with `Rc::downgrade`. It doesn't keep the value alive. `upgrade()` returns `Option<Rc<T>>`. Use `Weak` for back-references (child to parent, observer to subject) to avoid cycles that would never be freed.

```rust
use std::rc::{Rc, Weak};
use std::cell::RefCell;

#[derive(Debug)]
struct Dept { name: String, staff: RefCell<Vec<Rc<Employee>>> }

#[derive(Debug)]
struct Employee { name: String, dept: Weak<Dept> } // back-ref is Weak

fn main() {
    let eng = Rc::new(Dept { name: "Eng".into(), staff: RefCell::new(vec![]) });
    let ana = Rc::new(Employee { name: "Ana".into(), dept: Rc::downgrade(&eng) });
    eng.staff.borrow_mut().push(Rc::clone(&ana));

    println!("strong={} weak={}", Rc::strong_count(&eng), Rc::weak_count(&eng));
    if let Some(d) = ana.dept.upgrade() {
        println!("{} works in {}", ana.name, d.name);
    }
    drop(eng); // Dept freed: only Weak refs remained
    println!("dept alive? {}", ana.dept.upgrade().is_some());
}
```

`Rc::make_mut` and `Arc::make_mut` give clone-on-write semantics: they mutate in place when you hold the only reference and clone otherwise. `Arc<str>` and `Arc<[T]>` are compact shared immutable buffers.

- Pitfall: `Rc` cycles leak memory, and that is not considered unsafe. Design ownership as a tree and use `Weak` for the edges that point back up.
- Interview tip: say "Arc only where you need thread sharing". The atomic operations are not free.

### Cell and RefCell: Interior Mutability
<!-- level: intermediate; ref: https://doc.rust-lang.org/book/ch15-05-interior-mutability.html -->
Interior mutability lets you mutate data through a shared reference `&T`. It is needed for caches, counters inside `&self` methods, and shared graphs. Every such type is built on `UnsafeCell<T>`, the only legal way to mutate through `&`. The safe wrappers enforce the aliasing rules by some other means:
- `Cell<T>`: copies or swaps whole values in and out (`get`/`set`/`replace`/`take`). It never hands out references, so it needs no runtime checks. Best for `Copy` flags and counters.
- `RefCell<T>`: checks the borrow rules at runtime. `borrow()` and `borrow_mut()` return guards and panic if the rules are broken (`try_borrow_mut` returns a `Result`). It costs a counter per access.
- `OnceCell<T>`: write once, read many.

All of these are `!Sync`. Their thread-safe equivalents are `Mutex`, `RwLock`, atomics and `OnceLock`.

```rust
use std::cell::{Cell, RefCell};
use std::collections::HashMap;

struct PriceService {
    calls: Cell<u32>,
    cache: RefCell<HashMap<String, f64>>,
}

impl PriceService {
    fn price(&self, sku: &str) -> f64 {                 // &self, yet we mutate
        self.calls.set(self.calls.get() + 1);
        if let Some(p) = self.cache.borrow().get(sku) {
            return *p;
        }                                                // shared borrow ends here
        let p = sku.len() as f64 * 1.5;                  // "expensive" lookup
        self.cache.borrow_mut().insert(sku.to_owned(), p);
        p
    }
}

fn main() {
    let svc = PriceService { calls: Cell::new(0), cache: RefCell::new(HashMap::new()) };
    svc.price("ABC"); svc.price("ABC");
    println!("calls={} cached={}", svc.calls.get(), svc.cache.borrow().len());

    let r = RefCell::new(vec![1]);
    let _reader = r.borrow();
    println!("{:?}", r.try_borrow_mut().is_err()); // true: would panic with borrow_mut
}
```

- Pitfall: holding a `borrow()` guard while calling code that does `borrow_mut()` on the same cell panics with "already borrowed". Keep guard scopes tiny. Rust 2024's `if let` scope change helps here.
- Interview tip: interior mutability moves the borrow check from compile time to runtime. It is a tool, not a way to dodge the borrow checker.

### Rc<RefCell<T>> Graphs and Their Alternatives
<!-- level: advanced; ref: https://doc.rust-lang.org/book/ch15-06-reference-cycles.html -->
`Rc<RefCell<T>>` (or `Arc<Mutex<T>>` across threads) is the go-to pattern for shared mutable graph-like data such as trees with parent links, observers and GUI widget trees. It works, but it has costs: runtime borrow panics, reference-count overhead, leaks from cycles, and noisy code full of `.borrow_mut()`.

Experienced Rust developers often choose an arena or index-based design instead. Store all nodes in a `Vec<Node>` and refer to them with `usize` indices (or typed `NodeId(u32)` newtypes). Ownership becomes trivial: the arena owns everything. Borrowing is clear: you take `&mut arena` and update nodes by index. It is cache friendly, and serialisation is easy. Crates such as `slotmap` add generation counters to catch stale handles, and `petgraph` provides graph algorithms.

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
struct NodeId(usize);

#[derive(Debug)]
struct Node { name: String, parent: Option<NodeId>, children: Vec<NodeId> }

#[derive(Default)]
struct Tree { nodes: Vec<Node> }

impl Tree {
    fn add(&mut self, name: &str, parent: Option<NodeId>) -> NodeId {
        let id = NodeId(self.nodes.len());
        self.nodes.push(Node { name: name.into(), parent, children: vec![] });
        if let Some(p) = parent { self.nodes[p.0].children.push(id); }
        id
    }
    fn path(&self, mut id: NodeId) -> String {
        let mut parts = vec![];
        loop {
            let n = &self.nodes[id.0];
            parts.push(n.name.as_str());
            match n.parent { Some(p) => id = p, None => break }
        }
        parts.reverse();
        parts.join("/")
    }
}

fn main() {
    let mut t = Tree::default();
    let root = t.add("root", None);
    let etc = t.add("etc", Some(root));
    let conf = t.add("app.conf", Some(etc));
    println!("{}", t.path(conf));
}
```

- Pitfall: index-based designs can leave dangling indices after a removal. Use generational indices (`slotmap`) or never remove nodes.
- Interview tip: when asked to "implement a doubly linked list in Rust", discuss the `Rc/Weak` approach, the arena approach and the unsafe raw-pointer approach (std's `LinkedList` uses raw pointers), and their trade-offs.

### OnceCell, OnceLock, LazyCell and LazyLock
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/sync/struct.LazyLock.html -->
Lazily initialised values, especially globals, used to need the `lazy_static` or `once_cell` crates. They are now in std:
- `OnceCell<T>` (1.70): single-threaded, set at most once, `get_or_init(|| ...)`.
- `OnceLock<T>` (1.70): the thread-safe version. Concurrent initialisers block until one of them wins.
- `LazyCell<T, F>` (1.80): single-threaded, initialised on first `Deref` from a stored closure.
- `LazyLock<T, F>` (1.80): the thread-safe version, ideal for `static` globals such as compiled regexes, configuration and lookup tables.

Behind the scenes, `OnceLock` uses an atomic state plus a futex or OS wait for the slow path. Reading after initialisation is a single atomic load. If the initialiser panics, `LazyLock` is poisoned and later accesses panic.

```rust
use std::collections::HashMap;
use std::sync::{LazyLock, OnceLock};

static COUNTRY_CODES: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    println!("building table once");
    HashMap::from([("IN", "India"), ("DE", "Germany"), ("US", "United States")])
});

static CONFIG: OnceLock<String> = OnceLock::new();

fn config() -> &'static str {
    CONFIG.get_or_init(|| std::env::var("APP_MODE").unwrap_or_else(|_| "dev".into()))
}

fn main() {
    let handles: Vec<_> = (0..4)
        .map(|_| std::thread::spawn(|| COUNTRY_CODES.get("IN").copied()))
        .collect();
    for h in handles { println!("{:?}", h.join().unwrap()); }
    println!("mode={}", config());
}
```

Choose `OnceLock` when the value comes from runtime input, such as configuration loaded in `main` and then `set`. Choose `LazyLock` when the initialiser is known when you write the code.

- Pitfall: global state makes testing harder. Prefer passing dependencies explicitly, and keep globals for immutable tables and process-wide singletons.
- Interview tip: `static` values need a `Sync` type, so `static X: RefCell<..>` doesn't compile. That is the compiler protecting you from data races.

## 10. Fearless Concurrency

### Threads, spawn and join
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch16-01-threads.html -->
`std::thread::spawn` starts an OS thread (1:1 threading) running a closure and returns a `JoinHandle<T>`. `join()` waits for the thread to finish and returns `Result<T, Box<dyn Any + Send>>`, which is `Err` if the thread panicked. When `main` returns, the process exits and any threads still running are killed, so join the threads whose work matters.

The closure must be `Send + 'static`. The thread may outlive the caller, so it can't borrow the caller's locals. That is why `move` closures are standard here. For borrowing, use scoped threads. Thread names and stack sizes are set through `thread::Builder`.

```rust
use std::thread;
use std::time::Duration;

fn checksum(chunk: Vec<u8>) -> u64 {
    chunk.iter().map(|&b| b as u64).sum()
}

fn main() {
    let data: Vec<u8> = (0..=255).cycle().take(1_000_000).collect();
    let mut handles = Vec::new();

    for (i, chunk) in data.chunks(250_000).enumerate() {
        let owned = chunk.to_vec();                   // move owned data in
        let h = thread::Builder::new()
            .name(format!("worker-{i}"))
            .spawn(move || {
                thread::sleep(Duration::from_millis(10));
                checksum(owned)
            })
            .expect("spawn failed");
        handles.push(h);
    }

    let total: u64 = handles.into_iter().map(|h| h.join().expect("worker panicked")).sum();
    println!("total = {total}");
    println!("cores = {:?}", thread::available_parallelism());
}
```

OS threads cost roughly 8 KiB to 2 MiB of stack each and need a kernel context switch, so thousands are fine but millions aren't. For data parallelism, use `rayon`. For massive I/O concurrency, use async.

- Pitfall: spawning one thread per request with no limit. Use a pool or a bounded queue.
- Interview tip: Rust prevents data races at compile time. It does not prevent deadlocks or race conditions in program logic.

### Send and Sync
<!-- level: advanced; ref: https://doc.rust-lang.org/book/ch16-04-extensible-concurrency-sync-and-send.html -->
Thread safety in Rust comes from two marker traits that the compiler implements automatically (auto traits):
- `Send`: a value of this type can be moved to another thread. Almost everything is `Send`. Exceptions are `Rc<T>` (its non-atomic count would race), raw pointers, and `MutexGuard` (some OSes require unlocking on the locking thread).
- `Sync`: `&T` can be shared between threads. Formally, `T: Sync` exactly when `&T: Send`. `Cell` and `RefCell` are `Send` but not `Sync`. `Mutex<T>` is `Sync` when `T: Send`, which is how a lock turns a non-Sync type into a shareable one.

A struct is `Send`/`Sync` if all of its fields are. APIs require these bounds: `thread::spawn` needs `F: Send`, `Arc<T>` is `Send` only if `T: Send + Sync`, and `tokio::spawn` needs `Send` futures. The result is that a data race is a type error.

```rust
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::thread;

fn assert_send<T: Send>() {}
fn assert_sync<T: Sync>() {}

fn main() {
    assert_send::<Arc<Mutex<Vec<u8>>>>();
    assert_sync::<Mutex<std::cell::Cell<u8>>>(); // Mutex makes Cell shareable
    // assert_send::<Rc<u8>>();                 // error: Rc cannot be sent safely

    let shared = Arc::new(Mutex::new(0));
    let rc = Rc::new(5);
    let s2 = Arc::clone(&shared);
    let h = thread::spawn(move || { *s2.lock().unwrap() += 1; });
    // thread::spawn(move || println!("{rc}"));  // error[E0277]: Rc<i32> cannot be sent
    h.join().unwrap();
    println!("{} {rc}", shared.lock().unwrap());
}
```

Implementing `Send` or `Sync` by hand (`unsafe impl Send for MyPtrWrapper {}`) is `unsafe`: you are promising the type has no thread-safety hazards. It is typically needed for FFI handles and raw-pointer data structures.

- Pitfall: holding a `!Send` value (an `Rc`, a `RefCell` guard, a std `MutexGuard`) across an `.await` makes the whole future `!Send`, and `tokio::spawn` rejects it.
- Interview tip: memorise "T is Sync if &T is Send". Interviewers like asking why `RefCell` is Send but not Sync.

### Message Passing with Channels
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/sync/mpsc/index.html -->
"Do not communicate by sharing memory; share memory by communicating." `std::sync::mpsc` provides multi-producer, single-consumer channels. Since 1.67 they are built on the crossbeam implementation.
- `channel()` is unbounded: `send` never blocks, but memory can grow without limit.
- `sync_channel(n)` is bounded: `send` blocks when the buffer is full, which gives backpressure. `sync_channel(0)` is a rendezvous channel.

Sending a value moves ownership into the channel, so the sender can't touch it afterwards and the data needs no locking. `recv()` returns `Err` once every `Sender` has been dropped, which is a clean shutdown signal: iterate the receiver with `for msg in rx`.

```rust
use std::sync::mpsc;
use std::thread;

enum Job { Resize { id: u32, width: u32 }, Shutdown }

fn main() {
    let (tx, rx) = mpsc::sync_channel::<Job>(8);          // bounded: backpressure
    let (done_tx, done_rx) = mpsc::channel::<String>();

    let worker = thread::spawn(move || {
        for job in rx {                                    // ends when all senders drop
            match job {
                Job::Resize { id, width } => done_tx.send(format!("img {id} -> {width}px")).unwrap(),
                Job::Shutdown => break,
            }
        }
    });

    for id in 0..3 {
        let tx = tx.clone();                               // multi-producer
        thread::spawn(move || tx.send(Job::Resize { id, width: 800 }).unwrap());
    }
    drop(tx); // our copy; worker ends after the spawned senders finish

    for msg in done_rx.iter().take(3) { println!("{msg}"); }
    worker.join().unwrap();
}
```

For multi-consumer queues, `select!` over several channels, or better performance, use `crossbeam-channel`. In async code, use `tokio::sync::mpsc`, `broadcast`, `watch` and `oneshot`.

- Pitfall: forgetting to drop the original `Sender`. The receiving loop then never ends, because one sender is still alive.
- Interview tip: choose channels for pipelines and ownership hand-off, and locks for shared state that is read and updated in place.

### Mutex, RwLock and Poisoning
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/sync/struct.Mutex.html -->
`Mutex<T>` wraps the data it protects. The only way to reach the `T` is `lock()`, which returns a `MutexGuard<T>` that derefs to `T` and unlocks when dropped. You can't forget to lock and you can't forget to unlock. That is a big improvement over mutexes that sit next to the data they guard.

On Linux, std's `Mutex` is a futex-based lock (since 1.62), so it is small and fast when uncontended. `RwLock<T>` allows many readers or one writer. It helps when reads dominate and critical sections are long. For short sections, a `Mutex` is often faster.

Poisoning: if a thread panics while holding the lock, the lock is marked poisoned, and later `lock()` calls return `Err(PoisonError)`. The idea is that the data may have been left half-updated. You can still recover the guard with `into_inner()` if you know the data is consistent.

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::thread;

#[derive(Default)]
struct Metrics { hits: Mutex<HashMap<String, u64>>, config: RwLock<String> }

fn main() {
    let m = Arc::new(Metrics::default());
    *m.config.write().unwrap() = "v1".into();

    let handles: Vec<_> = (0..4).map(|i| {
        let m = Arc::clone(&m);
        thread::spawn(move || {
            let route = if i % 2 == 0 { "/a" } else { "/b" };
            let cfg = m.config.read().unwrap().clone(); // many readers at once
            {
                let mut hits = m.hits.lock().unwrap();   // short critical section
                *hits.entry(route.to_string()).or_insert(0) += 1;
            } // guard dropped: unlocked
            cfg
        })
    }).collect();

    for h in handles { h.join().unwrap(); }
    let hits = m.hits.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    println!("{hits:?}");
}
```

- Pitfall: doing I/O or expensive work while holding the guard. Copy what you need, drop the guard, then do the work.
- Pitfall: locking two mutexes in different orders on different threads causes deadlocks. Always acquire locks in one global order.
- Interview tip: `parking_lot` offers smaller, non-poisoning locks. In async code, use `tokio::sync::Mutex` only if the guard must live across an `.await`.

### Arc<Mutex<T>> and Shared-State Patterns
<!-- level: intermediate; ref: https://doc.rust-lang.org/book/ch16-03-shared-state.html -->
`Arc<Mutex<T>>` is the standard way to share mutable state between threads. `Arc` gives shared ownership across threads, and `Mutex` gives exclusive mutation. You clone the `Arc` for each thread, which only bumps a count, and lock whenever you need access.

Under heavy load, a single global `Arc<Mutex<BigState>>` becomes a contention bottleneck. Ways to scale it:
- Shrink the critical section: lock, copy or swap, unlock.
- Shard: split into N independently locked maps chosen by key hash. This is what `dashmap` does.
- Use `RwLock` for read-mostly data, or `arc-swap` to swap whole immutable snapshots.
- Use atomics for counters.
- Use an actor: one task owns the state and others send it messages, so no lock is needed.

```rust
use std::collections::HashMap;
use std::hash::{BuildHasher, RandomState};
use std::sync::{Arc, Mutex};
use std::thread;

struct ShardedCounter { shards: Vec<Mutex<HashMap<String, u64>>>, hasher: RandomState }

impl ShardedCounter {
    fn new(n: usize) -> Self {
        Self { shards: (0..n).map(|_| Mutex::new(HashMap::new())).collect(), hasher: RandomState::new() }
    }
    fn incr(&self, key: &str) {
        let idx = (self.hasher.hash_one(key) as usize) % self.shards.len();
        *self.shards[idx].lock().unwrap().entry(key.to_owned()).or_default() += 1;
    }
    fn total(&self) -> u64 {
        self.shards.iter().map(|s| s.lock().unwrap().values().sum::<u64>()).sum()
    }
}

fn main() {
    let counter = Arc::new(ShardedCounter::new(16));
    let hs: Vec<_> = (0..8).map(|t| {
        let c = Arc::clone(&counter);
        thread::spawn(move || for i in 0..1000 { c.incr(&format!("user-{}", (i + t) % 50)); })
    }).collect();
    hs.into_iter().for_each(|h| h.join().unwrap());
    println!("{}", counter.total()); // 8000
}
```

- Pitfall: `Arc<Mutex<Vec<T>>>` used as a work queue. A channel is simpler and avoids contention.
- Interview tip: `Mutex` doesn't need an `Arc` in a `static` (`static M: Mutex<Vec<u8>> = Mutex::new(Vec::new());` works because `Mutex::new` is `const`), or with scoped threads.

### Atomics and Memory Ordering
<!-- level: advanced; ref: https://doc.rust-lang.org/std/sync/atomic/index.html -->
Atomic types (`AtomicBool`, `AtomicUsize`, `AtomicU64`, `AtomicPtr`, ...) give lock-free operations on single values: `load`, `store`, `fetch_add`, `swap` and `compare_exchange`. Each operation takes an `Ordering`, which controls how it is ordered relative to other memory accesses. Rust uses the C++20 memory model.
- `Relaxed`: only atomicity, no ordering with other variables. Fine for statistics counters.
- `Release` (on a store) paired with `Acquire` (on a load): everything written before the release store is visible to a thread whose acquire load sees that store. This is the standard way to publish data and the basis of locks.
- `AcqRel`: for read-modify-write operations that both acquire and release.
- `SeqCst`: one total order across all SeqCst operations. Simplest to reason about, slightly more expensive on some architectures.

```rust
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;

struct Stats { requests: AtomicU64, shutting_down: AtomicBool }

fn main() {
    let stats = Arc::new(Stats { requests: AtomicU64::new(0), shutting_down: AtomicBool::new(false) });

    let workers: Vec<_> = (0..4).map(|_| {
        let s = Arc::clone(&stats);
        thread::spawn(move || {
            while !s.shutting_down.load(Ordering::Acquire) {
                let n = s.requests.fetch_add(1, Ordering::Relaxed); // just a counter
                if n >= 10_000 { s.shutting_down.store(true, Ordering::Release); }
            }
        })
    }).collect();
    for w in workers { w.join().unwrap(); }

    // compare_exchange: claim a slot only if it's still 0
    let leader = AtomicU64::new(0);
    let won = leader.compare_exchange(0, 42, Ordering::AcqRel, Ordering::Acquire).is_ok();
    println!("requests>={} won={won}", stats.requests.load(Ordering::Relaxed));
}
```

The x86 memory model is strong, so ordering bugs often hide there and only appear on ARM (Apple Silicon, Graviton). Test with `loom`, which explores interleavings, and Miri.

- Pitfall: using `Relaxed` for a "data is ready" flag. The reader may see the flag before it sees the data.
- Interview tip: if you can't explain why `Relaxed` is correct in a given place, use `SeqCst` or a `Mutex`.

### Scoped Threads and Data Parallelism
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/thread/fn.scope.html -->
`std::thread::scope` (stable since 1.63) creates threads that are guaranteed to finish before the scope returns. Because of that guarantee, they can borrow local data. No `'static` bound, `Arc` or cloning is needed. Mutable borrows of disjoint parts (from `chunks_mut` or `split_at_mut`) can be handed to different threads, and the borrow checker still proves there is no data race. Every scoped thread is joined automatically when the scope ends. If any of them panicked, the panic propagates.

For CPU-bound data parallelism, `rayon` is the de facto standard. Replace `.iter()` with `.par_iter()`, and a work-stealing pool spreads the work across cores, with all the same Send/Sync guarantees.

```rust
use std::thread;

fn normalize_in_parallel(samples: &mut [f32], workers: usize) -> f32 {
    let max = samples.iter().cloned().fold(f32::MIN, f32::max); // borrowed read
    let chunk = samples.len().div_ceil(workers);

    thread::scope(|s| {
        for part in samples.chunks_mut(chunk) {          // disjoint &mut slices
            s.spawn(move || {
                for x in part { *x /= max; }
            });
        }
    }); // all threads joined here

    max
}

fn main() {
    let mut data: Vec<f32> = (1..=8).map(|n| n as f32).collect();
    let config = String::from("unit-scale");
    let max = thread::scope(|s| {
        let h = s.spawn(|| println!("using {config}")); // borrows `config`, no move
        h.join().unwrap();
        normalize_in_parallel(&mut data, 4)
    });
    println!("max={max} {data:?}");

    // With rayon (external crate):
    // let sum: f64 = data.par_iter().map(|&x| x as f64).sum();
}
```

- Pitfall: spawning threads for tiny workloads. Thread startup costs tens of microseconds, so measure first.
- Interview tip: scoped threads answer "how do I share a local `Vec` with threads without `Arc`?"
