## 1. Getting Started with Rust

### Toolchain, rustup and Cargo
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch01-03-hello-cargo.html -->
Rust is a compiled systems language that gives you C-level control and performance with memory safety checked at compile time, and no garbage collector. You install it with rustup. Rustup manages toolchains (stable, beta, nightly), compilation targets and components such as clippy and rustfmt. Stable releases ship every six weeks and stay backward compatible.

Cargo is the build tool and package manager, and almost every project uses it. `cargo new` creates a project with a `Cargo.toml` manifest and `src/main.rs`. `cargo build` compiles into `target/debug`. `cargo run` builds and runs, `cargo check` type-checks without generating code (much faster while you edit), and `cargo build --release` turns on optimisations. Dependencies ("crates") come from crates.io, and the exact versions resolved are recorded in `Cargo.lock`.

```bash
rustup update stable
cargo new hello && cd hello
cargo run            # debug build + run
cargo check          # fast feedback loop
cargo build --release
```

```rust
fn main() {
    let name = "Rust";
    println!("Hello, {name}!"); // inline format args (1.58+)
}
```

`println!` ends in `!` because it is a macro, not a function. Macros can check the format string at compile time and accept a variable number of arguments.

- Pitfall: benchmarking a debug build. Debug builds can be 10–100x slower than release builds.
- Pitfall: committing `target/` to git. Commit `Cargo.lock` for binaries; for libraries it is optional, and current Cargo guidance says committing it is fine.
- Interview tip: say that `cargo check` plus rust-analyzer is the normal inner loop, and that a full build is only needed to run code.

### Variables, Mutability and Shadowing
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch03-01-variables-and-mutability.html -->
Bindings are immutable by default. You write `let mut` when you mean to change a value. The default makes code easier to reason about, and the compiler can rely on it when checking borrows. Constants (`const`) have to declare their type, are evaluated at compile time and are inlined wherever they are used. A `static` is a single value at a fixed memory address that lives for the whole program.

Shadowing means declaring a new binding with the same name using another `let`. This is different from mutation: the new binding can have a different type, and the old value is still there until it goes out of scope. It is common for staged transformations such as parsing input.

```rust
const MAX_RETRIES: u32 = 5;
static GREETING: &str = "hi";

fn main() {
    let input = "  42 ";
    let input = input.trim();              // shadow: still &str
    let input: u32 = input.parse().unwrap(); // shadow: now u32

    let mut attempts = 0;
    while attempts < MAX_RETRIES {
        attempts += 1;
    }
    println!("{GREETING} {input} {attempts}");
}
```

Under the hood, `mut` belongs to the binding, not the type. Moving a value into a `let mut` binding makes it mutable there. That is why `let mut v = v;` is a valid idiom.

- Pitfall: reaching for `static mut` to get global mutable state. In Rust 2024, taking references to `static mut` is denied by default. Use atomics, `Mutex`, or `LazyLock` instead.
- Interview tip: be able to explain the difference between `const` (inlined, with no single address) and `static` (one address, can hold interior mutability types).

### Scalar and Compound Types
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch03-02-data-types.html -->
Rust is statically typed with local type inference.

#### Scalar types
- Integers: `i8`–`i128`, `u8`–`u128`, plus `isize`/`usize`, which are pointer-sized and used for indexing.
- Floats: `f32` and `f64`.
- `bool`.
- `char`: a 4-byte Unicode scalar value, not a byte.

#### Compound types
- Tuples: `(i32, &str)`.
- Fixed-size arrays: `[u8; 4]`. These live inline, usually on the stack.

Integer overflow panics in debug builds and wraps in release builds by default. When overflow is part of the logic, use the explicit methods: `wrapping_add`, `checked_add`, `saturating_add` or `overflowing_add`. Conversions are never implicit. `as` casts can truncate silently, while `From`/`TryFrom` either can't lose data or return an error when they would.

```rust
fn main() {
    let small: u8 = 250;
    let checked = small.checked_add(10);        // None
    let saturated = small.saturating_add(10);   // 255
    let big: u32 = small.into();                // lossless From
    let back: Result<u8, _> = u8::try_from(300u32); // Err

    let point: (f64, f64) = (1.5, -2.0);
    let (x, y) = point;
    let bytes = [0u8; 4];
    println!("{checked:?} {saturated} {big} {back:?} {x} {y} {}", bytes.len());
}
```

The unit type `()` is the empty tuple. Functions that return nothing return `()`. The never type `!` belongs to expressions that never complete, such as `panic!()`, `loop {}` and `return`.

- Pitfall: `x as u8` on a value of 300 silently gives 44. Prefer `try_from` at trust boundaries.
- Interview tip: array indexing is bounds-checked and panics when out of range. `get()` returns an `Option` instead.

### Functions, Statements and Expressions
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch03-03-how-functions-work.html -->
Rust is expression-oriented. Blocks, `if`, `match` and `loop` all produce values. A statement ends in a semicolon and evaluates to `()`. The last expression in a block, with no semicolon, is the block's value. This is why functions usually end with a bare expression and not `return`.

Every function signature declares its parameter and return types. Type inference never crosses function boundaries. That is deliberate: signatures are contracts, so a change inside a function body cannot silently change how callers are type-checked.

```rust
fn clamp_percent(value: i64) -> u8 {
    let clamped = if value < 0 {
        0
    } else if value > 100 {
        100
    } else {
        value
    }; // `if` is an expression
    clamped as u8 // tail expression = return value
}

fn describe(n: u8) -> &'static str {
    match n {
        0 => "none",
        1..=49 => "some",
        _ => "most",
    }
}

fn main() {
    let p = clamp_percent(130);
    println!("{p} -> {}", describe(p));
}
```

Use early `return` for guard clauses. A trailing semicolon on the last line is the classic beginner error. It turns the value into `()`, and the compiler reports "expected u8, found ()", usually with a hint to remove the semicolon.

- Pitfall: the branches of an `if` expression must have the same type. Use `match` or an enum when they genuinely differ.
- Interview tip: "everything is an expression" is what makes `let x = match ... {}` and `let v = loop { break value; }` idiomatic.

### Control Flow: if, loop, while, for
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch03-05-control-flow.html -->
Rust has four control-flow constructs. `if` requires a real `bool`; there is no truthiness. `loop` runs forever until you `break`, and `break value` makes the loop evaluate to that value. `while` loops on a condition. `for` iterates over anything that implements `IntoIterator`.

Labels (`'outer:`) let `break` or `continue` target an enclosing loop. Labelled blocks (stable since 1.65) can also `break 'label value`, which avoids deeply nested ifs.

```rust
fn main() {
    let grid = vec![vec![1, 2, 3], vec![4, 99, 6]];

    let found = 'search: {
        for (r, row) in grid.iter().enumerate() {
            for (c, &cell) in row.iter().enumerate() {
                if cell == 99 {
                    break 'search Some((r, c));
                }
            }
        }
        None
    };

    let mut tries = 0;
    let result = loop {
        tries += 1;
        if tries == 3 { break tries * 10; }
    };

    for i in (0..10).rev().step_by(3) {
        print!("{i} ");
    }
    println!("{found:?} {result}");
}
```

Under the hood, `for x in coll` becomes a call to `IntoIterator::into_iter(coll)` and then a loop over `next()` until it returns `None`. That is why `for x in vec` consumes the vector and `for x in &vec` borrows it.

- Pitfall: indexing `for i in 0..v.len() { v[i] }` adds bounds checks and is less idiomatic than iterating directly.
- Interview tip: ranges are `a..b` (end excluded) and `a..=b` (end included). Exclusive-range patterns (`a..b` inside `match`) have been stable since 1.80.

### Editions and Rust 2024
<!-- level: intermediate; ref: https://doc.rust-lang.org/edition-guide/rust-2024/index.html -->
Editions let Rust make opt-in, backward-incompatible changes without splitting the ecosystem. Each crate declares `edition = "2015" | "2018" | "2021" | "2024"` in `Cargo.toml`. Crates on different editions link together without problems, because editions only change how source code is parsed and checked. The compiled representation is the same.

Rust 2024 was stabilised in Rust 1.85 (February 2025). Its main changes:
- `impl Trait` in return position captures every in-scope lifetime by default. Use `use<..>` to narrow what it captures.
- `extern` blocks must be written `unsafe extern`. Some attributes must be wrapped, e.g. `#[unsafe(no_mangle)]`.
- `unsafe_op_in_unsafe_fn` warns by default. References to `static mut` are denied.
- Temporaries in an `if let` scrutinee and in block tail expressions are dropped earlier.
- `gen` is a reserved keyword.
- `Future` and `IntoFuture` are added to the prelude.
- `std::env::set_var` and `remove_var` become `unsafe`.
- Cargo resolver "3" is the default; it takes `rust-version` into account when picking dependency versions.
- Let chains (`if let A = x && cond`) were stabilised in 1.88, for edition 2024 only.

```toml
[package]
name = "orders"
version = "0.1.0"
edition = "2024"
rust-version = "1.85"
```

```bash
cargo fix --edition      # applies automatic migrations
# then bump edition = "2024" and run tests
```

- Pitfall: changing the edition string without first running `cargo fix --edition`. The drop-order changes can quietly alter behaviour around locks.
- Interview tip: editions are per crate and opt in. Unlike the Python 2 to 3 split, there was never an ecosystem divide.

## 2. Ownership

### Ownership Rules, Stack and Heap
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html -->
Ownership is how Rust manages memory without a garbage collector. There are three rules:
1. Each value has exactly one owner.
2. There is only one owner at a time.
3. When the owner goes out of scope, the value is dropped.

Dropping runs the value's destructor (`Drop`) and frees any heap memory it owns, at a point that is known at compile time.

Fixed-size values such as integers, arrays and structs of them can live entirely on the stack. Types like `String` and `Vec<T>` are a small stack "header" (pointer, length, capacity) that owns a buffer on the heap. Ownership says who is responsible for freeing that buffer. With exactly one owner, there are no double frees and no leaks in the normal case, and there is no runtime tracking cost.

```rust
fn make_report() -> String {
    let mut s = String::with_capacity(64); // heap allocation
    s.push_str("total=42");
    s // ownership moves to the caller; nothing freed here
}

fn main() {
    {
        let report = make_report();
        println!("{report}");
    } // `report` goes out of scope: heap buffer freed here

    let n = 5;          // plain stack value
    let m = n;          // copied, both usable
    println!("{n} {m}");
}
```

This is deterministic resource management (RAII). Files, sockets, lock guards and database transactions are all closed or released when their owner's scope ends. You don't need `finally` or `defer`.

- Pitfall: thinking ownership is about the stack versus the heap. It is about responsibility for cleanup. A `Box` on the stack still owns heap memory.
- Interview tip: "Rust has no GC and no manual free; the compiler inserts drops based on ownership" is the one-line summary interviewers want to hear.

### Move Semantics
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html -->
Assigning a non-`Copy` value, passing it to a function or returning it moves ownership. The move copies the stack header bitwise (a `String` is 24 bytes on 64-bit), and the source binding becomes unusable from then on. The heap data itself is not copied. Moves are always cheap, shallow memcpys. Rust has no implicit deep copies and no user-defined move constructors.

The compiler tracks moved-from state statically. Using a moved value is a compile-time error, not a runtime crash. If a value is moved on only some paths, Rust adds hidden drop flags so it is dropped exactly once.

```rust
#[derive(Debug)]
struct Order { id: u64, items: Vec<String> }

fn ship(order: Order) {          // takes ownership
    println!("shipping {}", order.id);
}                                // order dropped here

fn main() {
    let o = Order { id: 7, items: vec!["pen".into()] };
    let o2 = o;                  // move
    // println!("{:?}", o);      // error[E0382]: borrow of moved value
    ship(o2);

    let items = vec![1, 2, 3];
    let first_owner = items;
    let items = first_owner.clone(); // explicit deep copy if you need two
    println!("{items:?} {first_owner:?}");
}
```

You can also move out of a struct field (a partial move). The rest of the struct can still be used, but not the struct as a whole. Moving out through a reference is not allowed. Use `std::mem::take`, `replace` or `Option::take` to swap a value out and leave a valid one behind.

- Pitfall: calling `.clone()` everywhere to silence move errors. It hides design problems and costs allocations. Borrow first.
- Interview tip: "move = shallow bitwise copy + invalidate the source". Contrast this with C++, where std::move is only a cast and the moved-from object stays alive.

### Copy vs Clone
<!-- level: basic; ref: https://doc.rust-lang.org/std/marker/trait.Copy.html -->
`Clone` is an explicit, possibly expensive duplication through `.clone()`, and you can implement it with any logic. `Copy` is a marker trait. It means "a bitwise copy is a complete, valid duplicate", so assignment copies the value and does not move it. Integers, floats, `bool`, `char`, shared references `&T`, and tuples or arrays made only of `Copy` types are all `Copy`.

A type can be `Copy` only if all its fields are `Copy` and it does not implement `Drop`. A type that owns heap memory (`String`, `Vec`) can never be `Copy`: two bitwise copies would both try to free the same buffer.

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
struct Point { x: f32, y: f32 }       // cheap, plain data: Copy

#[derive(Debug, Clone)]
struct Customer { name: String, tags: Vec<String> } // owns heap: Clone only

fn main() {
    let a = Point { x: 1.0, y: 2.0 };
    let b = a;                 // copy; `a` still usable
    println!("{a:?} {b:?}");

    let c1 = Customer { name: "Ana".into(), tags: vec![] };
    let c2 = c1.clone();       // explicit deep copy
    let c3 = c1;               // move
    println!("{c2:?} {c3:?}");
}
```

Every `Copy` type must also implement `Clone`, which is why you derive both. For `Copy` types, `clone()` is just a copy.

- Pitfall: making a big struct `Copy` because it is convenient. Each assignment then silently copies many bytes, and you can't add a `String` field later without a breaking change.
- Pitfall: `Rc::clone` and `Arc::clone` only bump a reference count. Write `Arc::clone(&x)` to make that obvious to readers.
- Interview tip: `&T` is `Copy` but `&mut T` is not. Copying a mutable reference would create two aliases that can both write.

### References and Borrowing
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html -->
Borrowing lets code use a value without taking ownership of it. A reference `&T` is a non-owning pointer that is guaranteed to be non-null, aligned, and to point to a live value of the right type. When the reference goes away, nothing is freed.

The borrow checker enforces one rule at every point in the program. You may have either any number of shared references (`&T`) or exactly one mutable reference (`&mut T`), never both at once. A reference must also never outlive the value it points to. Together these prevent use-after-free, iterator invalidation and data races at compile time.

```rust
fn total_len(words: &[String]) -> usize {      // borrow, read-only
    words.iter().map(|w| w.len()).sum()
}

fn add_suffix(words: &mut Vec<String>) {       // exclusive borrow
    for w in words.iter_mut() {
        w.push('!');
    }
}

fn main() {
    let mut words = vec!["hi".to_string(), "yo".to_string()];
    let n = total_len(&words);   // shared borrow ends after call
    add_suffix(&mut words);      // now a mutable borrow is fine
    println!("{n} {words:?}");
}
```

Method calls borrow automatically. `words.len()` takes `&words` for you (auto-ref), and the `.` operator also dereferences automatically. Function parameters should usually take the most general borrowed form: `&str` rather than `&String`, `&[T]` rather than `&Vec<T>`.

- Pitfall: returning a reference to a local variable. The compiler rejects it because the local is dropped when the function returns. Return an owned value.
- Interview tip: describe the rule as "aliasing XOR mutability". It is the core idea behind Rust's safety guarantees.

### Mutable Borrows, NLL and Two-Phase Borrows
<!-- level: intermediate; ref: https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html -->
Since the 2018 edition, borrows are checked with non-lexical lifetimes (NLL). A borrow lasts until its last use, not until the end of its enclosing block. A lot of code that once needed extra braces now compiles as written.

Two-phase borrows handle calls like `v.push(v.len())`. The mutable borrow for `push` is reserved first and only activated after the arguments are evaluated, so the shared borrow for `len()` doesn't conflict with it.

```rust
fn main() {
    let mut scores = vec![10, 20, 30];

    let first = &scores[0];      // shared borrow starts
    println!("first = {first}"); // ...and ends here (last use)
    scores.push(40);             // OK under NLL

    scores.push(scores.len());   // two-phase borrow: OK

    // Not OK: shared borrow still live when we mutate
    // let top = &scores[0];
    // scores.clear();
    // println!("{top}");        // error[E0502]

    if let Some(last) = scores.last_mut() {
        *last += 1;              // mutate through &mut
    }
    println!("{scores:?}");
}
```

Some patterns are sound but still rejected today. The best known is conditionally returning a mutable borrow from a function and then using the original value again on the other path ("NLL problem case #3"). The next-generation checker, Polonius, is meant to accept these. Until then, restructure the code: look up a key or index first, then borrow.

- Pitfall: holding a reference into a `Vec` while pushing. A push may reallocate and move the buffer, and this is exactly the bug the borrow checker prevents.
- Interview tip: when you hit E0502/E0499, shorten the borrow, clone a small key, or split the struct so you borrow disjoint fields.

### Slices and String Slices
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch04-03-slices.html -->
A slice is a view into a contiguous sequence that it doesn't own. `&[T]` and `&str` are "fat pointers": a data pointer plus a length, 16 bytes on 64-bit. Slices let one function accept arrays, vectors, parts of vectors and boxed slices without copying.

`&str` is a slice of valid UTF-8 bytes. String literals are `&'static str` stored in the binary. Indexing a string by a byte range must land on character boundaries or the program panics, and `s[0]` isn't allowed at all. A "character" is ambiguous in Unicode (bytes? scalar values? grapheme clusters?), so Rust makes you choose with `.bytes()`, `.chars()` or a grapheme crate.

```rust
fn first_word(s: &str) -> &str {
    s.split_whitespace().next().unwrap_or("")
}

fn sum(xs: &[i64]) -> i64 { xs.iter().sum() }

fn main() {
    let owned = String::from("hello world");
    let w = first_word(&owned);          // &String coerces to &str
    let lit = first_word("static text"); // &'static str works too

    let v = vec![1, 2, 3, 4, 5];
    let arr = [10, 20];
    println!("{w} {lit} {} {} {}", sum(&v), sum(&v[1..3]), sum(&arr));

    let (left, right) = v.split_at(2);   // two disjoint borrows
    println!("{left:?} {right:?}");
}
```

Mutable slices `&mut [T]` support in-place algorithms like `sort` and `swap`. `split_at_mut` hands out two non-overlapping mutable halves, which the borrow checker couldn't prove disjoint from two separate index expressions.

- Pitfall: `&s[0..1]` on "é" panics because 'é' takes 2 bytes. Use `char_indices` or `s.get(0..1)`, which returns `Option`.
- Interview tip: accept `&str` / `&[T]` in APIs. Deref coercion makes `&String` and `&Vec<T>` work automatically.

### Drop and RAII
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/ops/trait.Drop.html -->
`Drop::drop` runs automatically when a value goes out of scope. This is RAII: tie a resource to an object's lifetime, and release is deterministic. The compiler inserts the calls. Locals are dropped in reverse order of declaration. Struct fields are dropped in declaration order, after the struct's own `drop`.

You can't call `x.drop()` directly, because it would then run twice. Use `std::mem::drop(x)` (in the prelude as `drop`) to end a value early. It simply takes ownership and lets the value go out of scope.

```rust
struct Span { name: &'static str }

impl Drop for Span {
    fn drop(&mut self) {
        println!("end {}", self.name);
    }
}

fn main() {
    let _outer = Span { name: "outer" };
    let inner = Span { name: "inner" };
    let _ = Span { name: "temp" };  // `_` doesn't bind: dropped immediately
    drop(inner);                    // explicit early drop
    println!("work");
} // prints: end temp, end inner, work, end outer
```

Lock guards are the most important use of RAII. `MutexGuard` unlocks in its `drop`, so drop placement directly controls how long the lock is held.

#### Rust 2024 drop-order changes
- Temporaries in an `if let` scrutinee are now dropped before the `else` branch.
- Temporaries in a block's tail expression are dropped before the block's locals.

Both changes fix deadlocks and borrow errors around `RefCell::borrow()` and `Mutex::lock()`.

- Pitfall: `let _ = mutex.lock();` releases the lock straight away. `let _guard = ...` holds it until the end of the scope.
- Pitfall: destructors are not guaranteed to run. `mem::forget` and `Rc` cycles leak, and leaking is considered safe. Never rely on `Drop` for memory safety.
- Interview tip: Drop and Copy are mutually exclusive.

## 3. Lifetimes

### What Lifetimes Are
<!-- level: intermediate; ref: https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html -->
A lifetime is the compiler's name for the region of code in which a reference must stay valid. Every reference has one. Most are inferred, and you write them (`'a`) only when the compiler can't work out how the lifetimes of inputs and outputs relate. Lifetimes are a compile-time concept only. They produce no runtime code and never change how long a value actually lives. They describe constraints that the borrow checker verifies.

Think of `'a` as a generic parameter, just like `T`. `fn f<'a>(x: &'a str) -> &'a str` says the returned reference is valid for at most as long as the input. Callers get a guarantee, and the implementation is checked against that promise.

```rust
// Without annotations the compiler can't know whether the result
// borrows from `a` or `b`.
fn longest<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() >= b.len() { a } else { b }
}

fn main() {
    let outer = String::from("long string");
    let result;
    {
        let inner = String::from("xyz");
        result = longest(&outer, &inner);
        println!("{result}");          // OK: both alive here
    }
    // println!("{result}");           // error: `inner` does not live long enough
}
```

When `'a` is applied to two inputs, the compiler picks the intersection: a region in which both are valid. Subtyping lets a longer-lived reference stand in where a shorter one is expected (`&'static str` works as `&'a str`).

- Pitfall: adding lifetime parameters to "make it compile" without understanding which value the output really borrows from. Ask yourself which input owns the data.
- Interview tip: "lifetimes don't make things live longer; they prove references don't outlive owners."

### Lifetime Elision Rules
<!-- level: intermediate; ref: https://doc.rust-lang.org/reference/lifetime-elision.html -->
Elision is a set of deterministic rules that fill in common lifetime patterns, so most signatures need no annotations. They are not inference: the compiler applies them mechanically to the signature, and if the rules don't settle the output lifetime, you must write it.

The rules for functions:
1. Each elided input lifetime gets its own distinct parameter.
2. If there is exactly one input lifetime, it is assigned to every elided output lifetime.
3. If there is a `&self` or `&mut self` parameter, its lifetime is assigned to the elided outputs.

```rust
struct Config { name: String }

impl Config {
    // Rule 3: returns borrow from self
    fn name(&self) -> &str { &self.name }

    // Explicit needed if output borrows from `other`, not `self`
    fn pick<'b>(&self, other: &'b str) -> &'b str { other }
}

fn trim_prefix(s: &str) -> &str {             // Rule 2
    s.strip_prefix("v").unwrap_or(s)
}

// fn bad(a: &str, b: &str) -> &str { a }     // error: missing lifetime specifier

fn main() {
    let c = Config { name: "svc".into() };
    println!("{} {} {}", c.name(), c.pick("x"), trim_prefix("v1.2"));
}
```

Rule 3 can be wrong for your intent. If a method returns data borrowed from an argument and not from `self`, the default ties the result to `self`, and callers get confusing errors later. Write the lifetime explicitly in that case.

Use `'_` (the anonymous lifetime) to make an elided lifetime visible, e.g. `fn iter(&self) -> Iter<'_, T>`. The lint `elided_lifetimes_in_paths` encourages this, so readers can see a borrow is involved.

- Pitfall: `impl Trait` return types follow capture rules, not elision. In Rust 2024 they capture every in-scope lifetime.
- Interview tip: be able to recite the three rules. Interviewers often ask why `fn f(a: &str, b: &str) -> &str` doesn't compile.

### Lifetimes in Structs
<!-- level: intermediate; ref: https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html -->
A struct that holds references needs a lifetime parameter. `struct Parser<'a> { input: &'a str }` means a Parser can't outlive the string it borrows. This gives you zero-copy designs such as tokenizers, views and borrowed configs, but the lifetime spreads to every type that contains the struct.

When should a struct hold references and when should it own its data? Borrow for short-lived helper types that are created and used inside a single function: parsers, iterators, formatters. Own (`String`, `Vec`, `Arc<str>`) for long-lived state, anything sent across threads or `.await` points, and anything stored in collections or caches.

```rust
struct Tokenizer<'a> {
    src: &'a str,
    pos: usize,
}

impl<'a> Tokenizer<'a> {
    fn new(src: &'a str) -> Self { Self { src, pos: 0 } }

    // Tokens borrow from the source, not from the Tokenizer
    fn next_token(&mut self) -> Option<&'a str> {
        let rest = self.src[self.pos..].trim_start();
        if rest.is_empty() { return None; }
        let start = self.src.len() - rest.len();
        let end = rest.find(' ').map_or(self.src.len(), |i| start + i);
        self.pos = end;
        Some(&self.src[start..end])
    }
}

fn main() {
    let line = String::from("GET /orders HTTP/1.1");
    let mut t = Tokenizer::new(&line);
    let method = t.next_token();
    let path = t.next_token();   // still OK: tokens tied to 'a, not &mut self
    println!("{method:?} {path:?}");
}
```

Notice that the return type is `&'a str`, not an elided `&str`. With elision, each token would borrow `&mut self`, and you couldn't keep two tokens at once.

- Pitfall: self-referential structs (a struct holding a reference into its own field) can't be expressed safely. Store indices or ranges instead, or use crates like `ouroboros`/`yoke`.
- Interview tip: "if a struct needs `'a` everywhere, consider owning the data." It is usually the right trade-off.

### 'static and Lifetime Bounds
<!-- level: intermediate; ref: https://doc.rust-lang.org/reference/trait-bounds.html -->
`'static` means "can live for the entire program". There are two different uses:
- `&'static T` is a reference valid forever: string literals, leaked boxes, statics.
- The bound `T: 'static` means `T` contains no non-static borrows. Owned types such as `String`, `Vec<u8>` and `Arc<Mutex<X>>` satisfy it even though they are freed long before the program ends.

`T: 'static` is the bound you see on `std::thread::spawn` and `tokio::spawn`. A spawned task may outlive the caller's stack frame, so it can't hold references into that frame. The fix is almost always to move owned data, or an `Arc`, into the task.

```rust
use std::sync::Arc;
use std::thread;

fn spawn_logger<T: std::fmt::Debug + Send + 'static>(item: T) {
    thread::spawn(move || println!("{item:?}"));
}

fn main() {
    let owned = String::from("owned is 'static-bound");
    spawn_logger(owned);                      // OK: no borrows

    let local = String::from("borrowed");
    // spawn_logger(&local);                  // error: `local` does not live long enough

    let shared = Arc::new(vec![1, 2, 3]);
    let s2 = Arc::clone(&shared);
    thread::spawn(move || println!("{s2:?}")).join().unwrap();
    println!("{local} {shared:?}");
}
```

`T: 'a` (an outlives bound) means every reference inside `T` lives at least as long as `'a`. Since 2018 it is mostly inferred for struct fields.

- Pitfall: thinking `'static` means "allocated forever" or "leaked". For a bound it only means "owns everything".
- Pitfall: `Box::leak` really does give you `&'static mut T`, but the memory is never freed. Use it only for one-time global configuration.
- Interview tip: when spawning, use `std::thread::scope` (1.63+) to borrow locals without needing `'static`.

### Variance and Higher-Ranked Trait Bounds
<!-- level: advanced; ref: https://doc.rust-lang.org/reference/subtyping.html -->
Variance answers the question "if `'long` outlives `'short`, can `Foo<'long>` be used where `Foo<'short>` is expected?"
- `&'a T` is covariant in `'a` and `T`. A longer lifetime can shrink to a shorter one.
- `&'a mut T` is covariant in `'a` but invariant in `T`. If it weren't, you could write a short-lived reference into a slot that expects a long-lived one.
- `Cell<T>` and `UnsafeCell<T>` are invariant in `T`.
- `fn(T)` is contravariant in `T`.

Variance matters when you design generic containers with `PhantomData`, or when lifetimes refuse to shrink for reasons that are hard to spot.

Higher-ranked trait bounds (HRTBs) say "for every lifetime": `F: for<'a> Fn(&'a str) -> &'a str`. You need them when a closure has to accept references whose lifetimes are chosen by the callee, not by the caller. `Fn(&str) -> &str` written in a bound is shorthand for the `for<'a>` form.

```rust
fn apply_to_lines<F>(text: &str, f: F) -> Vec<String>
where
    F: for<'a> Fn(&'a str) -> &'a str, // works for each line's own lifetime
{
    text.lines().map(|l| f(l).to_string()).collect()
}

fn main() {
    let out = apply_to_lines("  a  \n b ", |s| s.trim());
    println!("{out:?}");
}

// Invariance in action: &mut Vec<&'static str> cannot accept &'short str
fn push_short<'short>(v: &mut Vec<&'short str>, s: &'short str) { v.push(s); }
```

- Pitfall: picking `PhantomData<T>`, `PhantomData<fn(T)>` or `PhantomData<*const T>` without thinking. Each one sets different variance and auto-trait (`Send`/`Sync`) behaviour.
- Interview tip: the "&mut T is invariant in T" example shows why Rust needs variance rules at all.
