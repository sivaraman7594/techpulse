## 6. Error Handling

### panic! vs Result
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html -->
Rust separates two kinds of failure:
- Recoverable errors (file not found, invalid input, network timeout) are ordinary values of type `Result<T, E>`. The caller has to deal with them.
- Unrecoverable errors are bugs: a broken invariant, an out-of-bounds index, an "impossible" state. These `panic!`.

A panic unwinds the current thread's stack and runs destructors along the way. It can also be configured to abort the process (`panic = "abort"` in the profile), which gives smaller binaries and no unwinding.

Rust has no exceptions. Because errors appear in the type signature, the reader can see which operations can fail. Panics aren't meant for control flow. `std::panic::catch_unwind` exists for FFI boundaries and for thread pools that must survive a crashing job, not for normal error handling.

```rust
use std::fs;
use std::num::ParseIntError;

fn read_threshold(path: &str) -> Result<u32, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    text.trim().parse::<u32>().map_err(|e: ParseIntError| e.to_string())
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    assert!(!sorted.is_empty(), "percentile of empty slice"); // invariant: panic
    let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[idx]
}

fn main() {
    match read_threshold("threshold.txt") {
        Ok(t) => println!("threshold {t}"),
        Err(e) => eprintln!("using default, {e}"),
    }
    println!("{}", percentile(&[1.0, 2.0, 3.0], 0.5));
}
```

When panicking is acceptable:
- in tests,
- in examples and prototypes,
- when you know more than the compiler does (`.expect("regex literal is valid")`),
- when continuing would corrupt state.

- Pitfall: a panic in one thread doesn't stop the others, but it poisons any `Mutex` that thread held.
- Interview tip: library code should almost never panic on input it receives. Return `Result` and let the application decide what to do.

### Result and the ? Operator
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html -->
`Result<T, E>` is an enum, `Ok(T)` or `Err(E)`. It is marked `#[must_use]`, so the compiler warns if you ignore one. The `?` operator is the workhorse of error propagation. On `Ok(v)` it evaluates to `v`. On `Err(e)` it returns early from the function with `Err(From::from(e))`, converting the error into the function's error type.

`?` works in any function whose return type implements the right trait, which means `Result` and `Option` in practice. It also works in `main`, which may return `Result<(), E>` where `E: Debug`. A non-zero exit code and the debug-formatted error are printed for you.

```rust
use std::collections::HashMap;
use std::fs::File;
use std::io::{self, BufRead, BufReader};

fn load_env(path: &str) -> io::Result<HashMap<String, String>> {
    let file = File::open(path)?;                 // io::Error propagates
    let mut map = HashMap::new();
    for line in BufReader::new(file).lines() {
        let line = line?;
        if let Some((k, v)) = line.split_once('=') {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    Ok(map)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let env = load_env(".env")?;
    let port: u16 = env.get("PORT").map(String::as_str).unwrap_or("8080").parse()?;
    println!("port {port}");
    Ok(())
}
```

Useful `Result` methods:
- `map` and `map_err` transform the value or the error.
- `and_then` chains another fallible step.
- `unwrap_or_else` supplies a fallback.
- `ok()` converts to an `Option`.
- `inspect_err` (1.76) logs without consuming.
- Collecting an iterator of `Result`s into `Result<Vec<T>, E>` stops at the first error.

- Pitfall: `let _ = do_thing();` silences `must_use` and hides failures. Log the error, or handle it explicitly.
- Interview tip: `?` desugars to a match on the `Try` trait plus a `From` conversion. That is why error type design matters.

### Custom Error Types and the Error Trait
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/error/trait.Error.html -->
Libraries should expose structured error types, usually an enum, so callers can match on specific failures. A good error type:
1. implements `Debug` and `Display`, where Display gives a lowercase message with no trailing period,
2. implements `std::error::Error`,
3. exposes the underlying cause through `source()`,
4. is `Send + Sync + 'static` so it can cross threads and be boxed.

`std::error::Error` is also available as `core::error::Error` since 1.81, so `no_std` crates can implement it. Error chains are built through `source()`. Reporting tools walk that chain to print "failed to load config: invalid port: number too large".

```rust
use std::{error::Error, fmt, io, num::ParseIntError};

#[derive(Debug)]
pub enum ConfigError {
    Io { path: String, source: io::Error },
    InvalidPort(ParseIntError),
    Missing(&'static str),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::Io { path, .. } => write!(f, "cannot read {path}"),
            ConfigError::InvalidPort(_) => write!(f, "invalid port"),
            ConfigError::Missing(k) => write!(f, "missing key {k}"),
        }
    }
}

impl Error for ConfigError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            ConfigError::Io { source, .. } => Some(source),
            ConfigError::InvalidPort(e) => Some(e),
            ConfigError::Missing(_) => None,
        }
    }
}

impl From<ParseIntError> for ConfigError {
    fn from(e: ParseIntError) -> Self { ConfigError::InvalidPort(e) }
}

fn parse_port(s: &str) -> Result<u16, ConfigError> { Ok(s.parse()?) }

fn main() {
    if let Err(e) = parse_port("99999") {
        println!("{e}; caused by: {}", e.source().unwrap());
    }
}
```

- Pitfall: putting the source's message into your own `Display` and also returning it from `source()`. Reporters then print it twice.
- Interview tip: mark public error enums `#[non_exhaustive]` so you can add variants without a breaking change.

### thiserror vs anyhow: Library vs Application Errors
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/error/trait.Error.html -->
Two crates dominate the ecosystem, and they solve different problems.

`thiserror` is a derive macro that writes the `Display`, `Error` and `From` boilerplate for a custom error enum. Use it in libraries and domain layers, where callers need to match on precise variants. It adds nothing to your public API: the result is an ordinary hand-written-style error type.

`anyhow` provides `anyhow::Error`, a boxed, type-erased error with cheap `.context("...")` chaining, backtraces and a `Result<T>` alias. Use it in applications (binaries, CLI tools, top-level handlers), where errors mostly get logged or reported rather than matched. `Box<dyn Error + Send + Sync>` is the std-only middle ground.

```rust
// Cargo.toml: thiserror = "2", anyhow = "1"
use thiserror::Error;
use anyhow::{Context, Result};

#[derive(Debug, Error)]
pub enum PaymentError {
    #[error("card declined: {0}")]
    Declined(String),
    #[error("gateway timeout after {ms} ms")]
    Timeout { ms: u64 },
    #[error("gateway I/O failure")]
    Io(#[from] std::io::Error),
}

fn charge(amount: u64) -> Result<String, PaymentError> {
    if amount > 10_000 { return Err(PaymentError::Declined("limit".into())); }
    Ok("txn_123".into())
}

// Application layer: add context, don't define more enums
fn checkout(order_id: u64, amount: u64) -> Result<String> {
    let txn = charge(amount)
        .with_context(|| format!("charging order {order_id}"))?;
    Ok(txn)
}

fn main() {
    if let Err(e) = checkout(42, 50_000) {
        eprintln!("{e:#}"); // "charging order 42: card declined: limit"
    }
}
```

- Pitfall: returning `anyhow::Error` from a public library API. Callers can no longer match on causes without downcasting.
- Pitfall: one giant error enum for the whole app. Keep error types per module or layer, and convert at the boundaries.
- Interview tip: the classic answer is "thiserror for libraries, anyhow for apps", and the reason is "who needs to match on the error?"

### Option and Result Combinators
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/result/enum.Result.html -->
Combinators let you transform `Option` and `Result` without writing a `match` for every step, and the pipelines they produce read top to bottom. Know these families:
- Transform the success value: `map`, `and_then` (flat-map), `map_or`, `map_or_else`.
- Transform the error: `map_err`, `or_else`.
- Convert between the two: `ok_or`/`ok_or_else` (Option to Result), `ok()` and `err()` (Result to Option), `transpose()` (swaps `Option<Result>` and `Result<Option>`).
- Defaults: `unwrap_or`, `unwrap_or_else`, `unwrap_or_default`.
- Inspect: `inspect`, `inspect_err`, `is_some_and` (1.70), `is_none_or` (1.82).
- Collections: `collect::<Result<Vec<_>, _>>()` and `.sum::<Option<_>>()` short-circuit at the first failure.

Choosing between the `_or` and `_or_else` forms matters. `unwrap_or(expensive())` always evaluates its argument, while `unwrap_or_else(|| expensive())` only runs the closure when it's needed.

```rust
#[derive(Debug)]
struct Row { id: String, qty: String }

fn parse_rows(rows: &[Row]) -> Result<Vec<(u32, u32)>, String> {
    rows.iter()
        .map(|r| {
            let id = r.id.parse::<u32>().map_err(|e| format!("id {}: {e}", r.id))?;
            let qty = r.qty.parse::<u32>().map_err(|e| format!("qty {}: {e}", r.qty))?;
            Ok((id, qty))
        })
        .collect() // Result<Vec<_>, String>: stops at first error
}

fn main() {
    let rows = vec![Row { id: "1".into(), qty: "3".into() }, Row { id: "x".into(), qty: "1".into() }];
    println!("{:?}", parse_rows(&rows));

    let maybe_qty: Option<&str> = Some("5");
    let parsed: Result<Option<u32>, _> = maybe_qty.map(str::parse::<u32>).transpose();
    let discount = parsed.ok().flatten().filter(|q| *q >= 5).map_or(0, |_| 10);
    println!("discount {discount}%");
}
```

- Pitfall: long chains with nested closures that are harder to read than a `match` or `let else`. Pick whichever is clearer.
- Interview tip: `transpose` and collecting into `Result<Vec<_>>` are two idioms that separate experienced Rust developers from beginners.

### Error Handling at Boundaries: main, Threads and FFI
<!-- level: advanced; ref: https://doc.rust-lang.org/std/process/trait.Termination.html -->
Errors have to be handled deliberately at system boundaries.
- `main` can return `Result<(), E>` or anything that implements `Termination`, including `ExitCode`. Return `ExitCode::from(2)` for scripted CLI exit codes.
- Threads: `JoinHandle::join()` returns `Err` if the thread panicked, and the payload is a `Box<dyn Any + Send>`. Turn it into an error and don't unwrap it blindly.
- FFI: unwinding a panic into C is undefined behaviour unless you use the `"C-unwind"` ABI. Wrap exported functions in `catch_unwind` and convert failures to error codes.
- Async tasks: `tokio::spawn` returns a `JoinError` for panics and cancellations.

Backtraces come from `std::backtrace::Backtrace` (1.65). Set `RUST_BACKTRACE=1` to print them for panics, or capture one when you create an error.

```rust
use std::process::ExitCode;
use std::thread;

fn run() -> Result<u32, String> {
    let worker = thread::spawn(|| {
        let data: Vec<u32> = vec![];
        data[0] // panics: index out of bounds
    });
    worker.join().map_err(|payload| {
        let msg = payload
            .downcast_ref::<String>().cloned()
            .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_else(|| "unknown panic".into());
        format!("worker crashed: {msg}")
    })
}

fn main() -> ExitCode {
    match run() {
        Ok(v) => { println!("{v}"); ExitCode::SUCCESS }
        Err(e) => { eprintln!("error: {e}"); ExitCode::from(2) }
    }
}
```

- Pitfall: with `panic = "abort"`, `catch_unwind` and panic-to-JoinError conversion stop working, because the process just dies. Choose this deliberately for servers.
- Interview tip: an install-time `std::panic::set_hook` that logs panics with structured context is a cheap production win.

## 7. Collections and Strings

### Vec<T> Internals
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/vec/struct.Vec.html -->
`Vec<T>` is a growable array: a pointer, a capacity and a length (three words), with the elements in one contiguous heap buffer. Pushing beyond capacity reallocates. The capacity roughly doubles, so `push` is O(1) amortised, but every reallocation copies all the elements to a new buffer and invalidates every pointer into the old one. The borrow checker forbids holding `&v[0]` across a `push` for exactly this reason.

Performance habits:
- Preallocate with `Vec::with_capacity(n)` or `reserve(n)` when you know the size.
- `extend` from exact-size iterators allocates once.
- `swap_remove` is O(1) when order doesn't matter, compared with O(n) for `remove`.
- `retain` filters in place.
- `drain(..)` moves elements out while keeping the allocation.
- `clear()` keeps the capacity. Call `shrink_to_fit()` if memory matters.

Contiguous memory makes `Vec` very cache friendly. It often beats `LinkedList` even for inserts in the middle.

```rust
fn main() {
    let mut ids: Vec<u64> = Vec::with_capacity(1_000);
    ids.extend(1..=10);
    println!("len={} cap={}", ids.len(), ids.capacity());

    ids.retain(|id| id % 2 == 0);        // in-place filter
    let removed = ids.swap_remove(0);    // O(1), changes order
    ids.sort_unstable();                 // faster, no allocation
    ids.dedup();

    let batch: Vec<u64> = ids.drain(..2).collect(); // move out first 2
    println!("{removed} {batch:?} {ids:?}");

    let chunks: Vec<&[u64]> = (1..=7u64).collect::<Vec<_>>().leak().chunks(3).collect();
    println!("{chunks:?}");
}
```

`Vec<T>` derefs to `[T]`, so every slice method (`sort`, `binary_search`, `windows`, `chunks`, `iter`) works on it. `Box<[T]>` is a vector with its capacity fixed, which saves one word and signals that the size won't change.

- Pitfall: `vec.iter().cloned().collect()` just to get a copy. `vec.clone()` or `to_vec()` is clearer and does the same thing.
- Pitfall: deleting by index inside a forward loop skips elements. Use `retain` instead.
- Interview tip: `sort` is stable (a merge-sort variant, driftsort since 1.81). `sort_unstable` (ipnsort) is faster and doesn't allocate.

### String, &str and UTF-8
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch08-02-strings.html -->
`String` is an owned, growable, UTF-8 encoded buffer; underneath it is a `Vec<u8>` with a validity guarantee. `&str` is a borrowed slice of UTF-8. Every `String` derefs to `&str`, so functions should take `&str`. Rust also has `OsString`/`OsStr` for platform strings such as file names, `PathBuf`/`Path` for paths, and `CString`/`CStr` for FFI.

Strings can't be indexed by integer, because UTF-8 is variable-width (1–4 bytes per scalar value). The `.len()` method returns bytes, not characters. Iterate with `.chars()` (Unicode scalar values), `.bytes()` or `.char_indices()`. User-perceived characters (grapheme clusters, such as emoji with modifiers) need the `unicode-segmentation` crate.

```rust
fn initials(full_name: &str) -> String {
    full_name
        .split_whitespace()
        .filter_map(|w| w.chars().next())
        .flat_map(char::to_uppercase)
        .collect()
}

fn main() {
    let mut s = String::from("Zoë");
    s.push_str(" Saldaña");
    s += "!";
    println!("bytes={} chars={}", s.len(), s.chars().count()); // 13 vs 11

    let greeting = format!("Hello, {s}");         // allocation
    let first_two: String = s.chars().take(2).collect();
    println!("{greeting} {first_two} {}", initials("ada king lovelace"));

    let csv = "a,b,,c";
    let parts: Vec<&str> = csv.split(',').collect(); // borrows, no allocation
    println!("{parts:?} {:?}", s.find("ña"));
}
```

Building strings efficiently:
- Use `String::with_capacity` plus `push_str`, or `write!` into a String through `std::fmt::Write`.
- Avoid `+` in loops: each step works, but many reallocations can follow.
- `to_string()`, `to_owned()` and `String::from()` all allocate a copy.

- Pitfall: `&s[..3]` can panic if byte 3 falls inside a multi-byte character. Use `s.get(..3)` or `char_indices`.
- Interview tip: `String::from_utf8(bytes)` checks validity and returns a `Result`. `from_utf8_lossy` replaces bad sequences with U+FFFD.

### HashMap and the Entry API
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/collections/struct.HashMap.html -->
`HashMap<K, V>` is a SwissTable hash map (ported from hashbrown) that uses SIMD-accelerated probing. Keys must implement `Eq + Hash`. The default hasher is SipHash-1-3 with random per-process keys, which resists HashDoS attacks from untrusted input but is slower than non-cryptographic hashers. For internal integer keys in hot paths, consider `FxHashMap` (rustc-hash) or `ahash`.

The Entry API does "look up, then insert or update" with a single hash and a single probe, and it avoids borrow-checker trouble with get-then-insert patterns. `entry(k).or_insert(v)`, `or_insert_with(|| ...)` and `or_default()` return `&mut V`. `and_modify` updates existing entries only.

```rust
use std::collections::HashMap;

#[derive(Debug, Default)]
struct Stats { count: u32, total_ms: u64 }

fn main() {
    let logs = [("GET /a", 12), ("GET /b", 40), ("GET /a", 8), ("POST /a", 100)];

    let mut per_route: HashMap<&str, Stats> = HashMap::new();
    for (route, ms) in logs {
        let s = per_route.entry(route).or_default(); // one lookup
        s.count += 1;
        s.total_ms += ms;
    }

    let mut words: HashMap<String, usize> = HashMap::with_capacity(64);
    for w in "the cat the hat".split(' ') {
        words.entry(w.to_owned()).and_modify(|c| *c += 1).or_insert(1);
    }

    // Borrow<str>: look up a String key with &str, no allocation
    println!("{:?} {:?}", per_route.get("GET /a"), words.get("the"));
}
```

Iteration order is random and changes between runs. Use `BTreeMap` for sorted output, or the `indexmap` crate to keep insertion order.

- Pitfall: changing a key's hash while it is in the map (through interior mutability) corrupts lookups. The docs describe this as a logic error, not UB.
- Pitfall: `map[&key]` panics if the key is missing. Use `get`.
- Interview tip: say why the default hasher is slow: it trades speed for security. That is a classic senior-level detail.

### Choosing Collections: BTreeMap, HashSet, VecDeque, BinaryHeap
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/collections/index.html -->
`std::collections` provides a small, well-tuned set of collections. Choose by access pattern:
- `Vec<T>`: the default for sequences, a stack (`push`/`pop`), or small lookups where a linear scan is fast.
- `VecDeque<T>`: a ring buffer with O(1) push and pop at both ends, for queues, sliding windows and BFS.
- `HashMap`/`HashSet`: O(1) average lookup, unordered.
- `BTreeMap`/`BTreeSet`: sorted keys, O(log n), range queries (`range(a..b)`), first and last entries, deterministic iteration. Keys need `Ord`.
- `BinaryHeap<T>`: a max-heap priority queue. Wrap items in `std::cmp::Reverse` for a min-heap.
- `LinkedList`: rarely the right choice. Its pointer chasing defeats CPU caches.

```rust
use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap, HashSet, VecDeque};

fn main() {
    // Time-ordered events with range queries
    let mut events: BTreeMap<u64, &str> = BTreeMap::new();
    events.insert(1700, "login"); events.insert(1500, "boot"); events.insert(1900, "logout");
    let window: Vec<_> = events.range(1600..2000).collect();

    // Min-heap of (deadline, job)
    let mut jobs = BinaryHeap::new();
    jobs.push(Reverse((30, "report")));
    jobs.push(Reverse((10, "email")));
    let Reverse((due, next)) = jobs.pop().unwrap();

    // Sliding window of last 3 readings
    let mut recent = VecDeque::with_capacity(3);
    for r in [5, 7, 9, 11] {
        if recent.len() == 3 { recent.pop_front(); }
        recent.push_back(r);
    }

    let seen: HashSet<&str> = ["a", "b", "a"].into_iter().collect();
    println!("{window:?} {due}:{next} {recent:?} {}", seen.len());
}
```

Set operations (`union`, `intersection`, `difference`) return lazy iterators. `BTreeMap` lookups are cache friendly because each node holds many keys, unlike a binary tree.

- Pitfall: a `HashMap` where you need stable output for tests or snapshots. Use `BTreeMap`.
- Interview tip: Rust's std deliberately has no concurrent maps. Use `Mutex<HashMap>`, sharding, or crates like `dashmap`.

### Cow: Clone on Write
<!-- level: advanced; ref: https://doc.rust-lang.org/std/borrow/enum.Cow.html -->
`Cow<'a, B>` (clone-on-write) is an enum: either `Borrowed(&'a B)` or `Owned(<B as ToOwned>::Owned)`. It lets a function return borrowed data when no change was needed and allocate only when it had to modify something. That is a big win for hot paths that usually leave their input untouched: escaping, normalising, trimming, path handling.

`Cow` derefs to `&B`, so callers use it like a reference. `to_mut()` clones into an owned value on the first write, and `into_owned()` gives you the owned value at the end. Serde uses `Cow<'a, str>` for zero-copy deserialisation, borrowing from the input whenever the string had no escapes.

```rust
use std::borrow::Cow;

fn escape_html(input: &str) -> Cow<'_, str> {
    if !input.contains(['<', '>', '&']) {
        return Cow::Borrowed(input);            // no allocation (common case)
    }
    let mut out = String::with_capacity(input.len() + 16);
    for c in input.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            _ => out.push(c),
        }
    }
    Cow::Owned(out)
}

fn normalize(mut name: Cow<'_, str>) -> Cow<'_, str> {
    let trimmed_len = name.trim_end().len();
    if trimmed_len < name.len() {
        name.to_mut().truncate(trimmed_len); // clones only now
    }
    name
}

fn main() {
    let a = escape_html("plain text");
    let b = escape_html("<b>bold</b>");
    println!("{} {}", matches!(a, Cow::Borrowed(_)), b);
    println!("[{}]", normalize(Cow::Borrowed("Ana  ")));
}
```

- Pitfall: using `Cow` everywhere "for performance". It adds a branch and a lifetime parameter. Use it where profiling shows that allocations matter.
- Interview tip: `Cow` is the standard answer to "return a reference or an owned value from the same function".

## 8. Closures and Iterators

### Closures and Captures
<!-- level: intermediate; ref: https://doc.rust-lang.org/book/ch13-01-closures.html -->
A closure is an anonymous function that can capture variables from its environment: `|x| x + offset`. The compiler turns each closure into a unique, unnameable struct whose fields are the captures, and implements one or more of the `Fn` traits on it. Calls are statically dispatched and usually inlined, so closures cost nothing extra compared with hand-written structs.

By default a closure captures each variable in the least demanding way its body allows: by shared reference, then by mutable reference, then by value. Since the 2021 edition, closures capture disjoint fields (`self.count`, not all of `self`), which removes many borrow conflicts.

`move` forces captures by value. You need it when the closure outlives the current scope: spawned threads, async tasks, returned closures. A `move` of a `Copy` value copies it, and a `move` of a `String` transfers ownership.

```rust
fn make_rate_limiter(max: u32) -> impl FnMut() -> bool {
    let mut used = 0;               // captured by value via move
    move || {
        if used < max { used += 1; true } else { false }
    }
}

struct Report { title: String, rows: Vec<u32> }

fn main() {
    let threshold = 10;
    let above: Vec<u32> = [5, 12, 30].into_iter().filter(|&n| n > threshold).collect();

    let mut allow = make_rate_limiter(2);
    println!("{above:?} {} {} {}", allow(), allow(), allow());

    let mut r = Report { title: "Q1".into(), rows: vec![1, 2] };
    let mut add_row = |n| r.rows.push(n);   // captures only r.rows (2021+)
    add_row(3);
    println!("{} {:?}", r.title, r.rows);    // title still accessible
}
```

To move a clone into a closure while keeping the original, clone it into a new binding first: `let tx2 = tx.clone(); move || tx2.send(..)`.

- Pitfall: each closure has its own type, so you can't put two different closures in one `Vec` without `Box<dyn Fn>`.
- Interview tip: be able to explain what `move` does to `Copy` captures (copies) versus owned captures (moves).

### Fn, FnMut and FnOnce
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/ops/trait.FnOnce.html -->
The three closure traits say how a closure uses what it captured, and they form a hierarchy:
- `FnOnce`: can be called at least once. It may consume its captures. Every closure implements it.
- `FnMut`: can be called many times and may mutate its captures. It needs `&mut self`.
- `Fn`: can be called many times through `&self`, with no mutation. It is safe to call concurrently if the captures are `Sync`.

Every `Fn` is also an `FnMut`, and every `FnMut` is also an `FnOnce`. When you accept a closure, ask for the least restrictive trait you can manage: `FnOnce` for callbacks called once (e.g. `Option::map`), `FnMut` for repeated calls (iterator adapters), `Fn` when you need shared or concurrent calls. Plain function items and function pointers (`fn(i32) -> i32`) implement all three.

```rust
fn retry<T, E>(mut attempts: u32, mut op: impl FnMut() -> Result<T, E>) -> Result<T, E> {
    loop {
        match op() {
            Ok(v) => return Ok(v),
            Err(e) if attempts <= 1 => return Err(e),
            Err(_) => attempts -= 1,
        }
    }
}

fn with_cleanup(cleanup: impl FnOnce() -> String) -> String {
    cleanup() // called exactly once, may consume captures
}

fn apply_twice(f: impl Fn(i32) -> i32, x: i32) -> i32 { f(f(x)) }

fn main() {
    let mut calls = 0;
    let r: Result<&str, &str> = retry(3, || { calls += 1; if calls < 3 { Err("busy") } else { Ok("done") } });

    let log = String::from("closing pool");
    let out = with_cleanup(move || log);       // moves `log` out: FnOnce

    println!("{r:?} after {calls} calls, {out}, {}", apply_twice(|n| n * 3, 2));
}
```

Stored closures need either a generic parameter (`struct Cache<F: Fn(u64) -> u64>`) or a box (`Box<dyn Fn(u64) -> u64 + Send>`). Async closures (Rust 1.85) add the matching `AsyncFn`, `AsyncFnMut` and `AsyncFnOnce` traits.

- Pitfall: asking for `Fn` when `FnMut` would do. Callers then can't pass closures that count or collect.
- Interview tip: the trait a closure gets depends on what its body does with the captures, not on the `move` keyword.

### The Iterator Trait and Laziness
<!-- level: basic; ref: https://doc.rust-lang.org/std/iter/trait.Iterator.html -->
An iterator is anything that implements `Iterator`, which has one required method: `fn next(&mut self) -> Option<Self::Item>`. Every adapter (`map`, `filter`, `zip`, `take`, `enumerate`, `flat_map`, `chain`, `skip_while`, `peekable`) is a provided method that wraps the iterator in a new struct.

Adapters are lazy. Nothing runs until a consumer pulls items: `collect`, `sum`, `count`, `for_each`, `fold`, `find`, `any`, `all`, `max_by_key`, `last` or a `for` loop. Laziness means you can chain many steps without building intermediate collections, stop early (`find`, `take`), and even work with infinite sequences.

Collections offer three iteration forms:
- `iter()` yields `&T`.
- `iter_mut()` yields `&mut T`.
- `into_iter()` yields `T` and consumes the collection.

```rust
#[derive(Debug)]
struct Order { customer: &'static str, total: f64, paid: bool }

fn main() {
    let orders = vec![
        Order { customer: "ana", total: 120.0, paid: true },
        Order { customer: "bo", total: 80.0, paid: false },
        Order { customer: "ana", total: 45.5, paid: true },
    ];

    let paid_revenue: f64 = orders.iter().filter(|o| o.paid).map(|o| o.total).sum();

    let biggest = orders.iter().max_by(|a, b| a.total.total_cmp(&b.total));

    let first_unpaid = orders.iter().position(|o| !o.paid);

    // Nothing printed: map is lazy and never consumed
    let _lazy = orders.iter().map(|o| println!("never runs {}", o.customer));

    let evens: Vec<u64> = (1..).map(|n| n * n).filter(|n| n % 2 == 0).take(3).collect();
    println!("{paid_revenue} {biggest:?} {first_unpaid:?} {evens:?}");
}
```

The compiler warns that `iterators are lazy and do nothing unless consumed` (`unused_must_use`) when you forget a consumer.

- Pitfall: calling `collect()` in the middle of a chain only to iterate again. Keep the chain lazy.
- Interview tip: `for x in v` is sugar for `IntoIterator::into_iter(v)` followed by repeated `next()` calls.

### Iterator Adapters and collect
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/iter/trait.Iterator.html -->
`collect()` is generic over its result through the `FromIterator` trait. One chain can build a `Vec`, `String`, `HashMap` (from tuples), `HashSet`, `BTreeMap`, `Result<Vec<_>, E>` or `Option<Vec<_>>`. Name the target with a type annotation or turbofish: `collect::<Vec<_>>()`.

Adapters worth mastering:
- `filter_map`: filter and map in one step, dropping `None`s.
- `flat_map` and `flatten`: nested sequences.
- `zip`, `enumerate`, `rev` (needs `DoubleEndedIterator`).
- `chain`, `windows`/`chunks` (on slices).
- `scan`: running state.
- `take_while`/`skip_while`, `step_by`, `peekable` (lookahead).
- `fold` and `try_fold`: general reduction with optional early exit.
- `partition`: split into two collections.
- `unzip`.
- `min_by_key`/`max_by_key`.
- `sum`/`product`.
- `rev().find()`.

```rust
use std::collections::{BTreeMap, HashMap};

fn main() {
    let log = "200 /a\n500 /b\nbad line\n200 /b\n404 /a";

    let parsed: Vec<(u16, &str)> = log
        .lines()
        .filter_map(|l| {
            let (code, path) = l.split_once(' ')?;
            Some((code.parse().ok()?, path))
        })
        .collect();

    let (errors, ok): (Vec<_>, Vec<_>) = parsed.iter().partition(|(c, _)| *c >= 400);

    let by_path: BTreeMap<&str, Vec<u16>> = parsed.iter().fold(BTreeMap::new(), |mut m, &(c, p)| {
        m.entry(p).or_insert_with(Vec::new).push(c);
        m
    });

    let index: HashMap<usize, &str> = log.lines().enumerate().collect();
    let running: Vec<u32> = [3, 1, 4].iter().scan(0, |acc, &x| { *acc += x; Some(*acc) }).collect();

    println!("{} errors, {} ok, {by_path:?} {} {running:?}", errors.len(), ok.len(), index.len());
}
```

`size_hint` and `ExactSizeIterator` let `collect` preallocate the exact capacity. `try_fold` is what makes short-circuiting adapters like `find` and `all` fast.

- Pitfall: putting side effects inside `map` and relying on them. Use `for_each`, or a `for` loop, which is often clearer.
- Interview tip: a `for` loop and an iterator chain usually compile to the same code. Choose whichever is more readable.

### Implementing Iterators and IntoIterator
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/iter/index.html -->
To make your own type iterable, implement `Iterator` on a cursor struct. To make it usable in `for` loops, implement `IntoIterator` for the type itself, and usually for `&Type` and `&mut Type` too. That mirrors the std pattern where `for x in &collection` borrows and `for x in collection` consumes.

For simple cases, `std::iter::from_fn(|| ...)` or `std::iter::successors(first, |prev| ...)` build an iterator from a closure, so you don't need a named struct. A method can also return `impl Iterator<Item = &T> + '_` to expose a filtered or mapped view of internal data without exposing the concrete type.

```rust
struct Paginator { total: u32, page_size: u32, next_offset: u32 }

impl Iterator for Paginator {
    type Item = (u32, u32); // (offset, limit)
    fn next(&mut self) -> Option<Self::Item> {
        if self.next_offset >= self.total { return None; }
        let offset = self.next_offset;
        let limit = self.page_size.min(self.total - offset);
        self.next_offset += self.page_size;
        Some((offset, limit))
    }
}

struct Team { members: Vec<String> }

impl Team {
    fn active(&self) -> impl Iterator<Item = &str> + '_ {
        self.members.iter().map(String::as_str).filter(|m| !m.starts_with('~'))
    }
}

impl<'a> IntoIterator for &'a Team {
    type Item = &'a String;
    type IntoIter = std::slice::Iter<'a, String>;
    fn into_iter(self) -> Self::IntoIter { self.members.iter() }
}

fn main() {
    let pages: Vec<_> = Paginator { total: 25, page_size: 10, next_offset: 0 }.collect();
    let team = Team { members: vec!["ana".into(), "~bot".into()] };
    for m in &team { print!("{m} "); }
    let fib: Vec<u64> = std::iter::successors(Some((0u64, 1u64)), |&(a, b)| Some((b, a + b)))
        .map(|p| p.0).take(8).collect();
    println!("{pages:?} {:?} {fib:?}", team.active().collect::<Vec<_>>());
}
```

Rust 2024 reserves the `gen` keyword for future generator blocks, which will make writing iterators even simpler. They are not stable yet.

- Pitfall: an iterator that returns `None` and later `Some` again surprises adapters. Implement `FusedIterator` only when your iterator really stays finished.
- Interview tip: a "lending iterator", where items borrow from the iterator itself, can't be expressed with `Iterator`. That limitation is why GATs exist.

### Zero-Cost Abstractions and Iterator Performance
<!-- level: advanced; ref: https://doc.rust-lang.org/book/ch13-04-performance.html -->
"Zero-cost abstraction" means you pay nothing for the abstraction that you couldn't avoid by writing the code by hand. Iterator chains are the textbook example. Each adapter is a small generic struct, every closure is inlined, and LLVM fuses the whole pipeline into one loop. Bounds checks often disappear, because the iterator already knows the length. The result can even be auto-vectorised (SIMD).

Indexing in a loop (`for i in 0..v.len() { v[i] }`) may keep a bounds check on each access. `zip`, `chunks_exact` and slice iterators let the optimizer prove the accesses are in range. Patterns like `iter().map().sum()` over primitives frequently compile to vector instructions.

Some things are not zero-cost:
- `Box<dyn Iterator>`: dynamic dispatch on each `next()` call, which also blocks inlining.
- `collect()` in the middle of a chain: an allocation.
- `chain` and `flat_map` in very hot loops: the inner branch can stop vectorisation, so check the generated code.
- Debug builds: abstractions are not optimised away, which is why debug iterator code can be 10x+ slower.

```rust
// Both compile to similar, vectorised code in --release
pub fn dot_indexed(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let mut s = 0.0;
    for i in 0..n { s += a[i] * b[i]; } // bounds checks often elided after min()
    s
}

pub fn dot_iter(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

pub fn sum_chunks(data: &[u32]) -> u32 {
    data.chunks_exact(4)
        .map(|c| c[0] + c[1] + c[2] + c[3]) // no bounds checks: length known
        .sum()
}

fn main() {
    let a = vec![1.0; 1024]; let b = vec![2.0; 1024];
    println!("{} {} {}", dot_indexed(&a, &b), dot_iter(&a, &b), sum_chunks(&[1; 16]));
}
```

- Pitfall: floating-point sums don't vectorise unless reordering is allowed, because FP addition isn't associative. Integer sums do.
- Interview tip: check claims with `cargo asm` or Compiler Explorer, and benchmark with `criterion`. Don't guess.
