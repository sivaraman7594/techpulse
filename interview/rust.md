# Rust interview questions

### What is ownership in Rust and what problems does it solve?
<!-- level: basic; kind: concept; ref: https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html -->
Ownership is Rust's compile-time system for managing memory and other resources without a garbage collector. There are three rules:
1. Each value has a single owner.
2. Ownership can be moved, but not duplicated implicitly.
3. When the owner goes out of scope, the value is dropped and its resources are freed.

It prevents, at compile time:
- double frees, because only one owner frees the memory,
- use-after-free, because moved-from bindings can't be used and references can't outlive their owner,
- memory leaks in normal code, because drops are inserted automatically,
- data races, together with the borrowing rules and Send/Sync.

```rust
fn consume(s: String) { println!("{s}"); } // s dropped at end

fn main() {
    let a = String::from("hi");
    let b = a;          // move: `a` is no longer usable
    consume(b);         // ownership moves into the function
    // println!("{b}"); // compile error: value moved
}
```

Interview tip: contrast this with GC languages (runtime tracing, pauses) and with C/C++ (manual or RAII management with no compiler-enforced aliasing rules). Ownership gives deterministic destruction like C++ RAII, plus safety checked by the compiler.

### Explain the difference between move, Copy and Clone.
<!-- level: basic; kind: concept; ref: https://doc.rust-lang.org/std/marker/trait.Copy.html -->
- **Move**: the default for assignment and passing by value. The bits of the value (for example a `String`'s pointer, length and capacity) are copied shallowly, and the source becomes invalid. The heap data is not duplicated.
- **Copy**: a marker trait for types where a bitwise copy is a complete duplicate: integers, floats, `bool`, `char`, `&T`, and tuples or arrays of `Copy` types. Assignment copies the value and the source remains usable. A type can't be `Copy` if it implements `Drop` or owns resources.
- **Clone**: an explicit, possibly expensive deep copy through `.clone()`, with custom logic allowed. Every `Copy` type is also `Clone`.

```rust
#[derive(Clone, Copy, Debug)]
struct Point { x: i32, y: i32 }

#[derive(Clone, Debug)]
struct User { name: String }

let p1 = Point { x: 1, y: 2 };
let p2 = p1;               // copy, p1 still valid
let u1 = User { name: "Ana".into() };
let u2 = u1.clone();       // explicit heap copy
let u3 = u1;               // move, u1 invalid now
```

Note that `Rc::clone`/`Arc::clone` only increment a reference count. Writing `Arc::clone(&x)` makes that obvious to readers.

### What are the borrowing rules and why does Rust enforce them?
<!-- level: basic; kind: concept; ref: https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html -->
At any point you may have either:
- any number of shared references `&T`, or
- exactly one mutable reference `&mut T`,

and every reference must stay valid, never outliving its referent.

This "aliasing XOR mutability" rule stops a whole family of bugs: iterator invalidation (mutating a `Vec` while iterating over it), use-after-free through dangling pointers, and data races, which need two aliases with at least one writer. It also lets the compiler optimise more aggressively, because a `&mut` is guaranteed unique (noalias).

Since 2018, non-lexical lifetimes (NLL) end a borrow at its last use, not at the end of the scope:

```rust
let mut v = vec![1, 2, 3];
let first = &v[0];
println!("{first}");     // last use of `first`
v.push(4);               // OK: shared borrow already ended

let r = &v[0];
// v.push(5);            // error: cannot borrow `v` as mutable
println!("{r}");
```

When the rules are too strict for a design, use interior mutability (`RefCell`, `Mutex`) to check them at runtime, or restructure the data, for example by borrowing disjoint fields.

### What are lifetimes, and when do you need to write them explicitly?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html -->
A lifetime is a compile-time label for the region in which a reference is valid. Annotations like `'a` don't change how long anything lives. They describe relationships between references, so the borrow checker can verify that no reference outlives the data it points to.

Most lifetimes are elided:
1. Each input reference gets its own lifetime.
2. If there is exactly one input lifetime, outputs get it.
3. If there is a `&self` or `&mut self`, outputs get its lifetime.

You must annotate when these rules can't tell where the output borrows from, and when a struct holds references.

```rust
fn longest<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() > b.len() { a } else { b }
}

struct Parser<'a> { input: &'a str }   // Parser can't outlive the input

impl<'a> Parser<'a> {
    fn rest(&self) -> &'a str { self.input } // tied to input, not to &self
}
```

`'static` means "valid for the whole program" (`&'static str` literals). As a bound (`T: 'static`) it means "contains no non-static borrows", which owned types like `String` satisfy.

### What is the difference between String and &str?
<!-- level: basic; kind: concept; ref: https://doc.rust-lang.org/book/ch08-02-strings.html -->
- `String` is an owned, heap-allocated, growable UTF-8 buffer (pointer, length, capacity). You can push to it and it frees its memory on drop.
- `&str` is a borrowed string slice (pointer, length) into UTF-8 data owned by someone else: a `String`, a literal in the binary (`&'static str`), or another buffer.

Functions should usually accept `&str`, so callers can pass literals, `&String` (through deref coercion) or substrings without allocating. Return `String` when you create new text.

```rust
fn greet(name: &str) -> String {
    format!("Hello, {name}")
}

let owned = String::from("Ana");
greet(&owned);        // &String -> &str
greet("Bo");          // literal
greet(&owned[0..2]);  // slice (must be on char boundaries)
```

Strings can't be indexed by integer (`s[0]`), because UTF-8 characters take 1–4 bytes. Use `.chars()`, `.bytes()` or `.char_indices()`. `len()` returns bytes, not characters. Related types: `OsString` for OS strings, `PathBuf` for paths, `CString` for FFI, and `Cow<str>` for "borrowed or owned".

### How do Option and Result work, and what does the ? operator do?
<!-- level: basic; kind: concept; ref: https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html -->
- `Option<T>` is `Some(T)` or `None`. It replaces null, and the compiler forces you to handle the absent case.
- `Result<T, E>` is `Ok(T)` or `Err(E)`. It is used for recoverable errors and marked `#[must_use]`.

The `?` operator unwraps a success value or returns early. On `Err(e)` it returns `Err(From::from(e))`, converting the error into the function's error type. On `None` it returns `None`.

```rust
use std::num::ParseIntError;

fn parse_pair(s: &str) -> Result<(i32, i32), ParseIntError> {
    let (a, b) = s.split_once(',').unwrap_or((s, "0"));
    Ok((a.trim().parse()?, b.trim().parse()?))   // ? propagates ParseIntError
}

fn first_even(v: &[i32]) -> Option<i32> {
    let x = v.iter().find(|n| *n % 2 == 0)?;    // returns None early
    Some(*x * 10)
}
```

Combinators avoid verbose matches: `map`, `and_then`, `map_err`, `unwrap_or_else`, `ok_or`, `transpose`. You can collect an iterator of `Result`s into `Result<Vec<_>, E>`, which stops at the first error.

### When should you panic and when should you return a Result?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html -->
- Return `Result` for errors that are expected in normal operation: bad user input, missing files, network failures, validation errors. The caller decides how to handle them.
- `panic!` for bugs and broken invariants: an impossible state, an out-of-bounds index caused by a logic error, or a situation where continuing would corrupt data.

Acceptable uses of `unwrap`/`expect`:
- tests, examples and prototypes,
- cases where you know more than the compiler (`Regex::new("^[a-z]+$").expect("valid literal regex")`),
- program setup, where failing fast is the right behaviour.

A panic unwinds the thread (running destructors) or aborts if `panic = "abort"`. It poisons any `Mutex` the thread held. Libraries should almost never panic on caller input. Document any panics in a `# Panics` doc section.

```rust
pub fn percent(part: u64, total: u64) -> Result<f64, &'static str> {
    if total == 0 { return Err("total must be > 0"); }   // expected failure
    Ok(part as f64 * 100.0 / total as f64)
}

fn bucket(idx: usize, buckets: &[u32]) -> u32 {
    debug_assert!(idx < buckets.len(), "caller bug");    // invariant
    buckets[idx]
}
```

### How do traits compare to interfaces in other languages? What is the orphan rule?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/book/ch10-02-traits.html -->
Traits define shared behaviour like interfaces do, with some differences:
- Implementations are separate from the type (`impl Display for Money`), so you can add a trait to an existing type, retroactively.
- Default methods, associated types and associated constants.
- Blanket implementations: `impl<T: Display> ToString for T`.
- They can be used for static dispatch (generics, monomorphised) or dynamic dispatch (`dyn Trait`).
- No inheritance of data. Supertraits only require that another trait is also implemented.

The orphan rule (coherence): you may write `impl Trait for Type` only if the trait or the type is defined in your crate. This guarantees there is at most one impl of a trait for a type across the whole dependency graph, so two crates can never provide conflicting impls.

```rust
use std::fmt;

struct Money(i64);                       // local type
impl fmt::Display for Money {            // foreign trait: allowed
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "${}.{:02}", self.0 / 100, self.0 % 100)
    }
}

// impl fmt::Display for Vec<i64> {}    // error: both foreign
struct Prices(Vec<i64>);                // newtype workaround
```

### What is the difference between static dispatch (generics) and dynamic dispatch (dyn Trait)?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/reference/types/trait-object.html -->
- **Static dispatch**: `fn f<T: Shape>(s: &T)` or `impl Shape`. The compiler monomorphises a copy for each concrete type. Calls are direct and can be inlined, which is fastest at runtime, but it costs compile time and binary size, and every element of a collection must have the same type.
- **Dynamic dispatch**: `&dyn Shape`, `Box<dyn Shape>`. A fat pointer (data plus vtable) is resolved at runtime. It allows heterogeneous collections and runtime plugin selection, and keeps binaries smaller. The costs are an indirect call per method, no inlining, and only dyn-compatible traits can be used.

A dyn-compatible ("object-safe") trait can't have methods that return `Self` or take generic type parameters, unless those methods are marked `where Self: Sized`. Native `async fn` in traits are not dyn compatible.

```rust
trait Shape { fn area(&self) -> f64; }
struct Circle(f64);
struct Square(f64);
impl Shape for Circle { fn area(&self) -> f64 { 3.14159 * self.0 * self.0 } }
impl Shape for Square { fn area(&self) -> f64 { self.0 * self.0 } }

fn total_static<T: Shape>(items: &[T]) -> f64 { items.iter().map(Shape::area).sum() }
fn total_dyn(items: &[Box<dyn Shape>]) -> f64 { items.iter().map(|s| s.area()).sum() }

let mixed: Vec<Box<dyn Shape>> = vec![Box::new(Circle(1.0)), Box::new(Square(2.0))];
```

Trait upcasting (`&dyn Sub` to `&dyn Super`) has been stable since Rust 1.86.

### What does impl Trait mean in argument position versus return position?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/reference/types/impl-trait.html -->
- **Argument position** (`fn log(x: impl Display)`) is shorthand for an anonymous generic parameter (`fn log<T: Display>(x: T)`). The caller chooses the type. Unlike a named generic, callers can't specify it with turbofish.
- **Return position** (`fn evens() -> impl Iterator<Item = u32>`) is an opaque type. The function chooses one concrete type, and callers only see the trait. It is essential for returning closures and iterator chains whose types can't be written, with no boxing or dynamic dispatch.

All return paths must produce the same concrete type. Use an enum or `Box<dyn Trait>` if they differ.

Rust 2024 capture rules: a return-position `impl Trait` automatically captures every in-scope generic type and lifetime parameter, meaning it may borrow from them. To promise it captures fewer, use precise capturing (stable since 1.82): `-> impl Iterator<Item = u32> + use<>`.

```rust
fn evens(limit: u32) -> impl Iterator<Item = u32> {
    (0..limit).filter(|n| n % 2 == 0)
}

fn words<'a>(s: &'a str) -> impl Iterator<Item = &'a str> {
    s.split_whitespace()          // captures 'a (implicitly in 2024)
}

fn make_adder(n: i32) -> impl Fn(i32) -> i32 { move |x| x + n }
```

Return-position `impl Trait` in traits (RPITIT) has been stable since 1.75.

### When do you use an associated type instead of a generic type parameter on a trait?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/reference/items/associated-items.html -->
- **Associated type** (`trait Iterator { type Item; }`): each implementing type has exactly one implementation, and the implementation decides the type. Callers never have to say which one, so `it.next()` just works. Use it when the type is an output determined by the implementor.
- **Generic parameter** (`trait From<T>`): a type can implement the trait many times with different `T`s (`String: From<&str> + From<char>`). Use it when the type is an input that callers choose.

```rust
trait Storage {
    type Key;                     // one key type per storage
    fn get(&self, k: &Self::Key) -> Option<String>;
}

struct ById(Vec<String>);
impl Storage for ById {
    type Key = usize;
    fn get(&self, k: &usize) -> Option<String> { self.0.get(*k).cloned() }
}

// Generic parameter: many impls per type
struct Meters(f64);
impl From<f64> for Meters { fn from(v: f64) -> Self { Meters(v) } }
impl From<i32> for Meters { fn from(v: i32) -> Self { Meters(v as f64) } }
```

Operator traits combine both: `Add<Rhs>` is generic over the right-hand side, while `type Output` is associated. Generic associated types (GATs, 1.65) let associated types take lifetime or type parameters.

### What are Box, Rc and Arc, and when do you use each?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/book/ch15-00-smart-pointers.html -->
- `Box<T>`: single owner, heap allocation. Use it for recursive types, trait objects (`Box<dyn Error>`), large values you want to move cheaply, and shrinking enum variants. No overhead beyond the allocation.
- `Rc<T>`: shared ownership through a non-atomic reference count. Single-threaded only (`!Send`). Use it for graph-like structures and shared immutable data within one thread.
- `Arc<T>`: like `Rc` but with an atomic count, so it can be shared between threads. Atomic operations are slightly more expensive.

`Rc` and `Arc` give only shared (`&T`) access. For mutation, combine them with `RefCell` (single-threaded) or `Mutex`/`RwLock`/atomics (multi-threaded). Use `Weak<T>` for non-owning back-references to break cycles, because reference cycles leak.

```rust
use std::rc::Rc;
use std::sync::{Arc, Mutex};

enum List { Cons(i32, Box<List>), Nil }            // recursive type needs Box

let shared = Rc::new(String::from("config"));
let a = Rc::clone(&shared);                        // count = 2, same allocation

let counter = Arc::new(Mutex::new(0));
let c = Arc::clone(&counter);
std::thread::spawn(move || *c.lock().unwrap() += 1).join().unwrap();
```

Rule of thumb: start with plain ownership, then `Box`, then `Rc`, and use `Arc` only when you actually cross threads.

### What is interior mutability? Compare Cell, RefCell and Mutex.
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/book/ch15-05-interior-mutability.html -->
Interior mutability lets you mutate data through a shared reference `&T`, with the borrow rules enforced in some other way. All of these types are built on `UnsafeCell`.
- `Cell<T>`: get, set or replace whole values. It never hands out references, so it needs no runtime check. Use it for `Copy` counters and flags. Single-threaded (`!Sync`).
- `RefCell<T>`: dynamic borrow checking. `borrow()` and `borrow_mut()` return guards and panic on conflicts (`try_borrow*` returns `Result`). Single-threaded.
- `Mutex<T>` / `RwLock<T>`: thread-safe. They block until access is available, and they are poisoned if a holder panics.
- Atomics: lock-free single values.
- `OnceCell`/`OnceLock`/`LazyLock`: initialise once.

```rust
use std::cell::{Cell, RefCell};

struct Memo { hits: Cell<u32>, cache: RefCell<Vec<u64>> }

impl Memo {
    fn fib(&self, n: usize) -> u64 {          // &self, but mutates internally
        self.hits.set(self.hits.get() + 1);
        if let Some(&v) = self.cache.borrow().get(n) { return v; }
        let mut c = self.cache.borrow_mut();
        while c.len() <= n { let l = c.len(); c.push(if l < 2 { l as u64 } else { c[l-1] + c[l-2] }); }
        c[n]
    }
}
```

Interior mutability doesn't remove the borrow checker's rules. It moves the check to runtime, so a mistake becomes a panic or a deadlock and not a compile error.

### Explain the Send and Sync traits.
<!-- level: advanced; kind: concept; ref: https://doc.rust-lang.org/book/ch16-04-extensible-concurrency-sync-and-send.html -->
Both are auto marker traits. The compiler implements them automatically when all of a type's fields implement them.
- `Send`: ownership of the value can be transferred to another thread.
- `Sync`: the value can be referenced from several threads at once. Formally, `T: Sync` if and only if `&T: Send`.

Examples:
- `Rc<T>` is neither, because its non-atomic count would race.
- `Cell`/`RefCell` are `Send` but not `Sync`.
- `Arc<T>` is Send + Sync if `T: Send + Sync`.
- `Mutex<T>` is Sync if `T: Send`, which is how a lock makes non-Sync data shareable.
- `MutexGuard` is `!Send`.
- Raw pointers are neither.

APIs state their requirements through bounds: `thread::spawn` needs `F: Send + 'static`, and `tokio::spawn` needs a `Send` future. A data race is therefore a compile error.

```rust
use std::rc::Rc;
use std::sync::Arc;

let rc = Rc::new(1);
// std::thread::spawn(move || println!("{rc}"));  // error: Rc<i32> cannot be sent between threads
let arc = Arc::new(1);
std::thread::spawn(move || println!("{arc}")).join().unwrap();

struct RawHandle(*mut u8);
unsafe impl Send for RawHandle {}   // manual promise; you must guarantee it's sound
```

A common async pitfall is holding a `!Send` value such as an `Rc` or a std `MutexGuard` across `.await`, which makes the whole future `!Send`.

### How does Rust prevent data races, and does it prevent deadlocks?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/book/ch16-00-concurrency.html -->
A data race needs:
1. two threads accessing the same memory,
2. at least one of them writing,
3. no synchronisation.

Rust rules this out at compile time with three mechanisms:
- The borrowing rules: you can't have shared and mutable aliases at the same time.
- `Send`/`Sync`: types that aren't thread-safe can't cross thread boundaries.
- Synchronised types own their data. `Mutex<T>` gives access only through a guard, so you can't touch the data without locking.

What Rust does not prevent:
- Deadlocks, from lock-order inversion or re-entrant locking.
- Logical race conditions: check-then-act sequences of individually atomic operations, or TOCTOU on files.
- Livelock and starvation.
- Memory leaks through `Rc`/`Arc` cycles.

```rust
use std::sync::{Arc, Mutex};
use std::thread;

let data = Arc::new(Mutex::new(vec![]));
let handles: Vec<_> = (0..4).map(|i| {
    let d = Arc::clone(&data);
    thread::spawn(move || d.lock().unwrap().push(i))
}).collect();
for h in handles { h.join().unwrap(); }

// let v = vec![1];
// thread::spawn(|| v.push(2));   // error: may outlive borrowed value / needs move
```

Prevent deadlocks with a consistent lock ordering, short critical sections, single-owner designs (actors and channels) and timeouts.

### Explain Fn, FnMut and FnOnce, and what move does to a closure.
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/book/ch13-01-closures.html -->
Closures are compiled into anonymous structs holding their captured variables. Which traits a closure implements depends on what its body does with those captures:
- `FnOnce`: may consume captured values, so it can be called only once. Every closure implements it.
- `FnMut`: mutates captured state, so it needs `&mut self` and can be called repeatedly.
- `Fn`: only reads captures, through `&self`. It can be called repeatedly, even concurrently.

The hierarchy is that every `Fn` is also `FnMut`, and every `FnMut` is also `FnOnce`. APIs should ask for the weakest bound they need: `Option::map` takes `FnOnce`, and `Iterator::map` takes `FnMut`.

`move` forces captures by value: `Copy` types are copied and others are moved. It doesn't decide which `Fn*` trait the closure implements. A `move` closure that only reads is still `Fn`. You need `move` when the closure outlives the current scope (threads, tasks, returned closures).

```rust
fn call_twice(mut f: impl FnMut()) { f(); f(); }

let mut count = 0;
call_twice(|| count += 1);                      // FnMut: mutates capture
let name = String::from("job");
let consume = move || drop(name);               // FnOnce: consumes capture
consume();
let factor = 3;
let triple = move |x: i32| x * factor;          // Fn (copied factor)
println!("{count} {}", triple(2));
```

Async closures (`async || {}`, Rust 1.85) have matching `AsyncFn`, `AsyncFnMut` and `AsyncFnOnce` traits.

### How do Rust iterators work? What is the difference between iter, iter_mut and into_iter?
<!-- level: basic; kind: concept; ref: https://doc.rust-lang.org/book/ch13-02-iterators.html -->
An iterator implements `Iterator`, whose only required method is `next(&mut self) -> Option<Item>`. Adapters (`map`, `filter`, `zip`, `take`, `flat_map`) are lazy: they wrap the iterator and do nothing until a consumer (`collect`, `sum`, `for`, `find`, `fold`) pulls items. Because everything is generic and inlined, chains compile down to tight loops, often with bounds checks removed and sometimes vectorised.

- `iter()` yields `&T`: borrow, read-only.
- `iter_mut()` yields `&mut T`: borrow, modify in place.
- `into_iter()` yields `T`: consumes the collection. For `&v` and `&mut v` it behaves like `iter` and `iter_mut`.

A `for x in expr` loop calls `IntoIterator::into_iter(expr)`, which is why `for x in v` moves `v`.

```rust
let mut prices = vec![10.0, 25.5, 7.25];

let total: f64 = prices.iter().sum();                 // borrow
for p in prices.iter_mut() { *p *= 1.1; }             // mutate
let labels: Vec<String> = prices
    .into_iter()                                       // consume
    .filter(|p| *p > 10.0)
    .map(|p| format!("${p:.2}"))
    .collect();
// prices is moved now
println!("{total} {labels:?}");
```

`collect` works for many targets through `FromIterator`: `Vec`, `String`, `HashMap`, `Result<Vec<_>, E>`.

### How does async/await work in Rust?
<!-- level: advanced; kind: concept; ref: https://doc.rust-lang.org/book/ch17-00-async-await.html -->
`async fn` returns a `Future`, a state machine that the compiler generates with one state per `.await` point, holding the locals that are still alive there. Futures are lazy. Nothing runs until an executor polls them.

`Future::poll` returns either `Ready(value)` or `Pending`. Before returning `Pending`, the future registers the `Waker` from its `Context` with an event source (an epoll/kqueue/IOCP reactor, a timer). When the event fires, the waker reschedules the task and the executor polls it again.

Key points:
- std ships no runtime. Tokio, smol and embassy provide executors, I/O and timers.
- Futures don't allocate per se. `tokio::spawn` boxes a task, and futures can be stack-allocated and combined (`join!`, `select!`).
- Spawned tasks on a multi-threaded runtime must be `Send + 'static`.
- Cancellation is dropping the future. It stops at the last `.await`.
- Blocking calls inside async code stall a runtime worker. Use `spawn_blocking`.
- `Pin` exists because these state machines may hold references into themselves.

```rust
async fn fetch(id: u32) -> String {
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("item {id}")
}

#[tokio::main]
async fn main() {
    let (a, b) = tokio::join!(fetch(1), fetch(2));   // concurrent, one task
    let h = tokio::spawn(fetch(3));                   // separate task
    println!("{a} {b} {}", h.await.unwrap());
}
```

### What is Pin, and why is it needed?
<!-- level: advanced; kind: concept; ref: https://doc.rust-lang.org/std/pin/index.html -->
`Pin<P>` wraps a pointer (`Pin<&mut T>`, `Pin<Box<T>>`) and guarantees that the value it points to won't be moved again until it is dropped, unless the type is `Unpin`.

It is needed because some types are self-referential. The state machine generated from an `async fn` can store a local variable and a reference to that variable across an `.await`. If the future were moved after polling began, the internal reference would dangle. `Future::poll` therefore takes `self: Pin<&mut Self>`.

`Unpin` is an auto trait meaning "safe to move even when pinned". Almost all ordinary types are `Unpin`. Compiler-generated futures generally are not.

Where you meet it:
- Storing heterogeneous futures: `Pin<Box<dyn Future<Output = T> + Send>>`, created with `Box::pin`.
- Polling a future through `&mut` repeatedly, for example in a `select!` loop: `let mut fut = std::pin::pin!(fut);`.
- Writing futures or streams by hand: use `pin-project-lite` for safe field projections.

```rust
use std::future::Future;
use std::pin::Pin;

fn pick(fast: bool) -> Pin<Box<dyn Future<Output = u32> + Send>> {
    if fast { Box::pin(async { 1 }) } else { Box::pin(async { 2 }) }
}
```

`Pin` doesn't allocate or move anything itself. It only restricts safe APIs, such as `mem::swap` through `&mut T`, so that moving pinned data requires `unsafe`.

### What is the Drop trait and how does RAII work in Rust?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/std/ops/trait.Drop.html -->
`Drop::drop(&mut self)` runs automatically when a value goes out of scope. That makes resource release deterministic: files close, locks unlock, sockets shut down and memory is freed. This is RAII. Drop order:
- Locals are dropped in reverse order of declaration.
- Struct fields are dropped in declaration order, after the struct's own `drop`.
- Temporaries are dropped at the end of their statement. Rust 2024 changed the scope of temporaries in `if let` and block tail expressions so they are dropped earlier.

You can't call `x.drop()` directly. Use `drop(x)` (that is, `std::mem::drop`) to release early, which is common for lock guards.

```rust
use std::sync::Mutex;

struct TempFile(&'static str);
impl Drop for TempFile {
    fn drop(&mut self) { println!("deleting {}", self.0); }
}

let m = Mutex::new(0);
{
    let mut g = m.lock().unwrap();
    *g += 1;
    drop(g);            // unlock before slow work
    // slow_io();
}
let _t = TempFile("a.tmp");
let _ = TempFile("b.tmp");  // `_` doesn't bind: dropped immediately
```

Important caveats:
- `Copy` types can't implement `Drop`.
- Drop is not guaranteed to run: `mem::forget`, `Rc` cycles, `process::exit` and aborts skip it. Leaking is safe, so unsafe code must never rely on a destructor running.

### What does the unsafe keyword allow you to do?
<!-- level: advanced; kind: concept; ref: https://doc.rust-lang.org/nomicon/what-unsafe-does.html -->
`unsafe` unlocks five operations the compiler can't verify:
1. dereferencing raw pointers (`*const T`, `*mut T`),
2. calling `unsafe` functions, including FFI functions,
3. accessing or modifying `static mut`,
4. implementing `unsafe` traits (`Send`, `Sync`),
5. reading `union` fields.

It does not disable borrow checking, type checking or any other analysis. An `unsafe` block is a promise that you have upheld the invariants yourself. Breaking that promise is undefined behaviour, which the optimizer may turn into arbitrary miscompilation.

Best practices:
- Keep unsafe blocks tiny, wrapped in safe APIs that validate their inputs.
- Write a `// SAFETY:` comment for each block, and a `# Safety` doc section on each `unsafe fn`.
- Test with Miri.

Rust 2024 changes:
- `unsafe_op_in_unsafe_fn` warns by default, so you need explicit blocks inside `unsafe fn`.
- `extern` blocks must be written `unsafe extern`.
- Some attributes must be written `#[unsafe(no_mangle)]`.
- `std::env::set_var` is unsafe.
- References to `static mut` are denied.

```rust
let v = vec![1, 2, 3];
let p = v.as_ptr();                 // creating a raw pointer: safe
// SAFETY: index 1 < len 3 and `v` is alive and not mutated meanwhile
let second = unsafe { *p.add(1) };
assert_eq!(second, 2);
```

### What is the difference between declarative and procedural macros?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/reference/procedural-macros.html -->
- **Declarative macros** (`macro_rules!`) match token patterns with fragment specifiers (`$e:expr`, `$i:ident`, `$t:ty`) and repetitions (`$(...),*`), then expand a template. They are defined inline, partly hygienic, and good for variadic helpers and repetitive impls. Examples: `vec!`, `println!`, `matches!`.
- **Procedural macros** are Rust functions run by the compiler that transform a `TokenStream`. They must live in a separate `proc-macro = true` crate and usually use `syn` and `quote`. There are three kinds:
  - derive: `#[derive(Serialize)]` adds items,
  - attribute: `#[tokio::main]` transforms the item,
  - function-like: `sql!(...)`.

```rust
macro_rules! square_all {
    ($($x:expr),* $(,)?) => { [$($x * $x),*] };
}
let sq = square_all!(1, 2, 3);   // [1, 4, 9]

// Procedural (separate crate):
// #[proc_macro_derive(Builder)]
// pub fn derive_builder(input: TokenStream) -> TokenStream { ... }
```

Trade-offs: macros add compile time (procedural ones especially), make errors harder to read and get weaker IDE support. Prefer functions and generics. Use macros for variadics, compile-time checking (`format!`, `sqlx::query!`) or code generation. Use `cargo expand` to inspect the output. Rust 2024 note: the `expr` fragment now also matches `const {}` blocks and `_`, and `expr_2021` keeps the old behaviour.

### What does "zero-cost abstraction" mean in Rust? How do generics achieve it?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/book/ch13-04-performance.html -->
A zero-cost abstraction costs nothing at runtime beyond what you would pay for equivalent hand-written code. Rust achieves this through:
- Monomorphization: generic functions are compiled into a specialised copy for each concrete type, so calls are static and can be inlined. `Vec<u8>` and `Vec<String>` each get optimal code.
- Inlining plus LLVM optimisation: iterator chains, closures and newtypes collapse into plain loops and values. Newtypes and `Option<&T>` have the same size as the inner type.
- No hidden runtime: no GC, no default boxing, no implicit vtables.

```rust
// These compile to essentially the same machine code in --release:
fn sum_loop(v: &[u32]) -> u32 {
    let mut s = 0;
    for i in 0..v.len() { s += v[i]; }
    s
}
fn sum_iter(v: &[u32]) -> u32 { v.iter().sum() }

#[repr(transparent)]
struct UserId(u64);              // same layout as u64, zero overhead
```

What still costs:
- Monomorphization increases compile time and binary size.
- `dyn Trait` adds an indirect call.
- `Rc`/`Arc` reference counting.
- Bounds checks the optimizer can't remove.
- Debug builds, which don't optimise abstractions away.

"Zero-cost" doesn't mean "free". It means "no worse than writing it by hand".

### What are Rust editions, and what changed in Rust 2024?
<!-- level: intermediate; kind: concept; ref: https://doc.rust-lang.org/edition-guide/rust-2024/index.html -->
Editions (2015, 2018, 2021, 2024) are opt-in, per-crate language versions that can make small backward-incompatible changes, such as new keywords or changed defaults, without splitting the ecosystem. Crates on different editions interoperate freely, because all of them compile to the same internal representation. `cargo fix --edition` automates most migrations.

Rust 2024, stabilised in 1.85 (February 2025), includes:
- RPIT lifetime capture: `-> impl Trait` captures all in-scope lifetimes. Narrow it with `use<..>`.
- `unsafe extern` blocks (items can be marked `safe`), unsafe attributes (`#[unsafe(no_mangle)]`), and `unsafe_op_in_unsafe_fn` warns by default.
- `static mut` references denied. `std::env::set_var`/`remove_var` become unsafe.
- Temporaries in `if let` scrutinees and in block tail expressions are dropped earlier, which avoids lock and RefCell surprises.
- `gen` reserved as a keyword. `Future`/`IntoFuture` added to the prelude. `Box<[T]>` gets by-value `IntoIterator`.
- Macro `expr` fragments match `const {}` and `_`.
- Cargo resolver 3 (MSRV-aware) by default.
- Let chains, `if let Some(x) = a && x > 0 { }`, stabilised in 1.88 for edition 2024 only.

```toml
[package]
edition = "2024"
rust-version = "1.85"
```

Features stabilised at the same time but available in every edition: async closures (1.85), trait upcasting (1.86).

### Explain Cargo workspaces, Cargo.lock and features.
<!-- level: basic; kind: concept; ref: https://doc.rust-lang.org/cargo/reference/features.html -->
- **Package/crate**: a package (`Cargo.toml`) contains at most one library crate and any number of binaries. Crates are the unit of compilation.
- **Workspace**: several packages sharing one `Cargo.lock` and one `target/` directory. It speeds up builds, keeps dependency versions consistent, and enforces module boundaries. `[workspace.dependencies]` and `[workspace.package]` centralise versions and metadata.
- **Cargo.lock**: records the exact resolved version of every dependency, so builds are reproducible. Commit it for applications. Current Cargo guidance says committing it for libraries is fine too (it affects only your CI, not your users).
- **Version requirements**: caret by default. `"1.4"` means `>=1.4.0, <2.0.0`.
- **Features**: named, additive compile-time options that enable optional code or dependencies (`json = ["dep:serde_json"]`). Cargo unifies features across the dependency graph, so they must never be mutually exclusive or remove functionality.

```toml
[workspace]
members = ["core", "api"]
resolver = "3"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }

# api/Cargo.toml
[dependencies]
serde.workspace = true
core = { path = "../core", package = "app-core" }

[features]
default = ["metrics"]
metrics = []
```

```bash
cargo build -p api --no-default-features
cargo tree -d      # duplicate dependency versions
```
