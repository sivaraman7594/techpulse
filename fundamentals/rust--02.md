## 4. Structs, Enums and Pattern Matching

### Structs and impl Blocks
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch05-03-method-syntax.html -->
Structs group named fields. There are three kinds: named-field structs, tuple structs (`struct Meters(f64);`) and unit structs (`struct Marker;`). Behaviour goes in `impl` blocks. Functions that take `self`, `&self` or `&mut self` are methods. Functions without a receiver are associated functions, called with `Type::name()`. Constructors are usually written as `new`.

The receiver states the contract:
- `&self` reads.
- `&mut self` mutates.
- `self` consumes the value. Builders and state transitions such as `into_*` methods use this.

Fields are private to the module unless marked `pub`, which lets a type enforce invariants through its constructor.

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct Invoice {
    id: u64,
    lines: Vec<(String, u32)>, // (sku, cents)
    paid: bool,
}

impl Invoice {
    pub fn new(id: u64) -> Self {
        Self { id, lines: Vec::new(), paid: false }
    }
    pub fn add_line(&mut self, sku: &str, cents: u32) -> &mut Self {
        self.lines.push((sku.to_owned(), cents));
        self
    }
    pub fn total(&self) -> u32 {
        self.lines.iter().map(|(_, c)| c).sum()
    }
    pub fn pay(self) -> Self {           // consumes, returns new state
        Self { paid: true, ..self }      // struct update syntax
    }
}

fn main() {
    let mut inv = Invoice::new(1);
    inv.add_line("A1", 500).add_line("B2", 250);
    let inv = inv.pay();
    println!("{} {}", inv.total(), inv.paid);
}
```

Struct update syntax (`..other`) moves the remaining fields out of `other`. If any of those fields isn't `Copy`, `other` is partially moved afterwards.

- Pitfall: making every field `pub` and losing the ability to enforce invariants. Expose methods instead.
- Interview tip: Rust has no inheritance. Composition plus traits takes its place.

### Enums with Data (Algebraic Data Types)
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch06-01-defining-an-enum.html -->
Rust enums are sum types: a value is exactly one of several variants, and each variant can carry its own data. With structs (product types), they let you "make illegal states unrepresentable". The compiler forces every variant to be handled, so you can't forget a state.

In memory, an enum takes the size of its largest variant plus a discriminant tag, rounded up for alignment. The compiler uses niches (impossible bit patterns) to drop the tag where it can. `Option<&T>`, `Option<Box<T>>` and `Option<NonZeroU32>` are the same size as the inner type, because null or zero represents `None`.

```rust
#[derive(Debug)]
enum PaymentState {
    Pending,
    Authorized { auth_code: String, amount_cents: u64 },
    Captured(u64),
    Failed { reason: String, retryable: bool },
}

impl PaymentState {
    fn can_refund(&self) -> bool {
        matches!(self, PaymentState::Captured(_))
    }
}

fn main() {
    let states = [
        PaymentState::Pending,
        PaymentState::Authorized { auth_code: "X9".into(), amount_cents: 1200 },
        PaymentState::Captured(1200),
        PaymentState::Failed { reason: "card".into(), retryable: false },
    ];
    for s in &states {
        println!("{s:?} refundable={}", s.can_refund());
    }
    println!("{}", std::mem::size_of::<Option<Box<u8>>>()); // 8 on 64-bit
}
```

Compare this with a class holding nullable fields plus a "status" string. There, nothing stops `auth_code` from being set on a failed payment. With an enum, the data exists only in the variant where it makes sense.

- Pitfall: one huge variant makes every value large. Box the big payload (`Big(Box<Data>)`), and clippy's `large_enum_variant` lint will flag it.
- Interview tip: `#[non_exhaustive]` on public enums lets a library add variants without a semver break, because downstream code must then include a `_` arm.

### Option Instead of Null
<!-- level: basic; ref: https://doc.rust-lang.org/std/option/enum.Option.html -->
Rust has no null. A value that might be missing is `Option<T>`, which is either `Some(T)` or `None`. Because `Option<T>` and `T` are different types, you can't use a maybe-missing value without first deciding what happens when it's absent. That removes the "billion-dollar mistake" class of bugs at compile time.

Use combinators rather than nested matches:
- `map` and `and_then` transform the value.
- `unwrap_or`, `unwrap_or_else` and `unwrap_or_default` provide fallbacks.
- `ok_or` and `ok_or_else` convert to a `Result`.
- `filter`, `zip` and `take` cover other common cases.

The `?` operator also works on `Option` inside functions that return `Option`.

```rust
use std::collections::HashMap;

struct User { manager_id: Option<u32>, email: Option<String> }

fn manager_email(users: &HashMap<u32, User>, id: u32) -> Option<&str> {
    let user = users.get(&id)?;              // early-return None
    let manager = users.get(&user.manager_id?)?;
    manager.email.as_deref()                 // Option<String> -> Option<&str>
}

fn main() {
    let mut users = HashMap::new();
    users.insert(1, User { manager_id: Some(2), email: None });
    users.insert(2, User { manager_id: None, email: Some("boss@x.io".into()) });

    let e = manager_email(&users, 1).unwrap_or("<none>");
    let len = users.get(&9).and_then(|u| u.email.as_ref()).map_or(0, |s| s.len());
    println!("{e} {len}");
}
```

`as_ref()` and `as_deref()` turn `&Option<T>` into `Option<&T>`, so you can inspect a value without moving it out of a struct. `Option::take()` moves the value out and leaves `None` behind, which is handy in state machines.

- Pitfall: `unwrap()` in library or request-handling code turns a missing value into a panic. Use `expect("reason")` only for real invariants.
- Interview tip: `Option<T>` costs nothing extra for references and boxes thanks to the null-pointer niche.

### match and Exhaustiveness
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch06-02-match.html -->
`match` compares a value against patterns from top to bottom and runs the first arm that matches. It must be exhaustive: every possible value has to be covered, or the code doesn't compile. Add a variant to an enum, and every `match` without a wildcard becomes an error at exactly the places you need to update. That is a refactoring superpower.

Arms can bind variables, destructure nested data, match ranges (`1..=9`), combine alternatives with `|` and add guards (`if cond`). `match` is an expression, so every arm must produce the same type, or diverge with `return`, `panic!` or `continue`.

```rust
enum Cmd { Get(String), Set(String, i64), Del(Vec<String>), Ping }

fn exec(cmd: Cmd) -> String {
    match cmd {
        Cmd::Ping => "PONG".into(),
        Cmd::Get(key) if key.is_empty() => "ERR empty key".into(),
        Cmd::Get(key) => format!("value of {key}"),
        Cmd::Set(key, v @ 0..=1000) => format!("set {key}={v}"),
        Cmd::Set(_, v) => format!("ERR {v} out of range"),
        Cmd::Del(keys) if keys.len() > 100 => "ERR too many".into(),
        Cmd::Del(keys) => format!("deleted {}", keys.len()),
    }
}

fn main() {
    println!("{}", exec(Cmd::Set("a".into(), 5)));
    println!("{}", exec(Cmd::Del(vec!["a".into()])));
}
```

The compiler compiles a `match` into jump tables or decision trees, so it is usually at least as fast as an if-chain.

Guards are not counted when checking exhaustiveness. The compiler can't reason about arbitrary conditions, so you often need a final unguarded arm.

- Pitfall: a catch-all `_ =>` on your own enums throws away exhaustiveness checking. Prefer listing the variants.
- Interview tip: the compiler also warns about unreachable arms, for example a specific pattern placed after a wildcard.

### if let, let else and let chains
<!-- level: intermediate; ref: https://doc.rust-lang.org/reference/expressions/if-expr.html -->
For one interesting pattern, `match` is verbose. Rust has three shorter forms:
- `if let PATTERN = expr { ... } else { ... }` handles one pattern plus an optional fallback.
- `while let` loops while the pattern matches, for example `while let Some(job) = queue.pop()`.
- `let PATTERN = expr else { diverge };` (let-else, stable since 1.65) binds into the enclosing scope. The `else` branch must diverge with `return`, `break`, `continue` or a panic. It is ideal for guard clauses because it keeps the happy path unindented.

Let chains (stable in Rust 1.88, edition 2024 only) join `let` patterns and boolean conditions with `&&` in `if` and `while` conditions. You no longer need nested `if let` pyramids.

```rust
fn parse_kv(line: &str) -> Option<(&str, u32)> {
    let Some((k, v)) = line.split_once('=') else {
        return None;                      // let-else guard
    };
    let Ok(n) = v.trim().parse::<u32>() else { return None };
    Some((k.trim(), n))
}

fn main() {
    let lines = ["port = 8080", "bad", "timeout=abc", "workers=4"];
    for l in lines {
        // let chain (Rust 2024 edition, 1.88+)
        if let Some((key, val)) = parse_kv(l)
            && val > 1
            && key != "debug"
        {
            println!("{key} -> {val}");
        }
    }
}
```

Edition 2024 also changes `if let` drop order. Temporaries created in the scrutinee are dropped before the `else` block runs. Code like `if let Some(x) = mutex.lock().unwrap().get() { } else { mutex.lock() }` no longer deadlocks.

- Pitfall: using a let chain in a 2021-edition crate. It won't compile there, so use nested `if let` or `matches!`.
- Interview tip: `let else` with an early `return` is the idiomatic way to flatten validation code.

### Advanced Patterns
<!-- level: intermediate; ref: https://doc.rust-lang.org/reference/patterns.html -->
Patterns appear in `let`, function parameters, `match`, `if let`, `while let` and `for` loops. The advanced forms are worth knowing:
- `@` bindings capture a value and test it at the same time: `n @ 1..=9`.
- Nested destructuring of structs, tuples, enums and slices.
- Slice patterns: `[first, .., last]`, `[head, rest @ ..]`.
- Ignoring parts with `_` and `..`.
- `ref`/`ref mut`, now mostly replaced by match ergonomics.

Match ergonomics (default binding modes): when you match on a reference such as `&Option<String>` with a non-reference pattern like `Some(s)`, the compiler automatically binds `s` as `&String`. You don't move anything out and you don't have to write `&Some(ref s)`.

Patterns are either irrefutable (they always match: `let (a, b) = pair;`) or refutable (they might not: `Some(x)`). `let` and function parameters require irrefutable patterns, unless you use `let else`.

```rust
#[derive(Debug)]
struct Pixel { x: i32, y: i32, rgb: (u8, u8, u8) }

fn classify(px: &Pixel) -> &'static str {
    match px {
        Pixel { rgb: (0, 0, 0), .. } => "black",
        Pixel { x: 0, y: 0, .. } => "origin",
        Pixel { rgb: (r, _, _), .. } if *r > 200 => "reddish",
        _ => "other",
    }
}

fn summarize(nums: &[i32]) -> String {
    match nums {
        [] => "empty".into(),
        [one] => format!("one: {one}"),
        [first, .., last] => format!("{first}..{last}"),
    }
}

fn main() {
    let p = Pixel { x: 0, y: 0, rgb: (255, 1, 1) };
    let Pixel { x, y, .. } = &p;   // binds &i32 via match ergonomics
    println!("{x},{y} {} {}", classify(&p), summarize(&[3, 4, 5]));
}
```

- Pitfall: when matching on `&self`, the bindings are references. Dereference with `*r`, or copy them out.
- Interview tip: slice patterns make recursive list processing clean, and they also remove bounds-checked indexing.

### Newtypes and Type Aliases
<!-- level: intermediate; ref: https://doc.rust-lang.org/book/ch05-01-defining-structs.html -->
The newtype pattern wraps an existing type in a one-field tuple struct, for example `struct UserId(u64);`. It costs nothing at runtime: the layout is the same as the inner type, and `#[repr(transparent)]` guarantees it for FFI. It still gives you a distinct type at compile time. Use newtypes to:
- stop mix-ups (passing an `OrderId` where a `UserId` was expected),
- enforce validation (an `Email` can only be built through `parse`),
- work around the orphan rule (implementing a foreign trait for a foreign type),
- hide an implementation detail behind a narrow API.

A type alias (`type Result<T> = std::result::Result<T, MyError>;`) is only a new name for the same type. It gives no type safety and is meant for brevity.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct UserId(u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct OrderId(u64);

#[derive(Debug)]
pub struct Email(String);

impl Email {
    pub fn parse(s: &str) -> Result<Self, String> {
        if s.contains('@') { Ok(Email(s.to_lowercase())) }
        else { Err(format!("invalid email: {s}")) }
    }
    pub fn as_str(&self) -> &str { &self.0 }
}

fn cancel(order: OrderId, by: UserId) { println!("{order:?} by {by:?}"); }

fn main() {
    let (u, o) = (UserId(7), OrderId(99));
    cancel(o, u);
    // cancel(u, o);  // compile error: mismatched types
    println!("{}", Email::parse("A@B.io").unwrap().as_str());
}
```

- Pitfall: implementing `Deref` on a newtype so it "inherits" the inner type's methods. That leaks the abstraction and is considered an anti-pattern. Forward only the methods you mean to expose.
- Interview tip: "parse, don't validate". Once a value has been turned into a newtype, it is known to be valid everywhere else in the code.

## 5. Traits and Generics

### Defining and Implementing Traits
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch10-02-traits.html -->
A trait defines shared behaviour: a set of methods, associated types and constants that a type promises to provide. Traits play the role of interfaces, but they are more flexible. They can have default method implementations, you can implement them for types you didn't write (subject to the orphan rule), and you can use them for either static dispatch (generics) or dynamic dispatch (`dyn Trait`).

Implementations live in separate `impl Trait for Type` blocks. A trait's methods can only be called where the trait is in scope (`use`), which keeps extension methods from leaking everywhere.

```rust
pub trait Notifier {
    fn channel(&self) -> &'static str;
    fn send(&self, to: &str, msg: &str) -> Result<(), String>;

    // default method built on the required ones
    fn send_all(&self, to: &[&str], msg: &str) -> usize {
        to.iter().filter(|t| self.send(t, msg).is_ok()).count()
    }
}

struct Email;
struct Sms { max_len: usize }

impl Notifier for Email {
    fn channel(&self) -> &'static str { "email" }
    fn send(&self, to: &str, msg: &str) -> Result<(), String> {
        println!("mail {to}: {msg}"); Ok(())
    }
}

impl Notifier for Sms {
    fn channel(&self) -> &'static str { "sms" }
    fn send(&self, to: &str, msg: &str) -> Result<(), String> {
        if msg.len() > self.max_len { return Err("too long".into()); }
        println!("sms {to}: {msg}"); Ok(())
    }
}

fn main() {
    let n = Sms { max_len: 10 };
    println!("{} sent {}", n.channel(), n.send_all(&["a", "b"], "hi"));
    Email.send("x@y.z", "hello").unwrap();
}
```

Supertraits (`trait Audited: Notifier + Debug`) require implementors to implement other traits too. Blanket impls (`impl<T: Display> ToString for T`) give a trait to every type that meets a bound.

- Pitfall: "method not found" when the trait isn't imported. The compiler suggests the right `use`.
- Interview tip: the orphan rule says you can implement a trait for a type only if the trait or the type is local to your crate. This guarantees impls never conflict across crates.

### Generics and Monomorphization
<!-- level: intermediate; ref: https://doc.rust-lang.org/book/ch10-01-syntax.html -->
Generics let you write functions, structs, enums and traits that work over many types: `fn largest<T: PartialOrd>(xs: &[T]) -> &T`. Rust implements them through monomorphization. For each concrete type used, the compiler generates a specialized copy of the code. `Vec<i32>` and `Vec<String>` become separate machine code.

The upside is zero-cost abstraction. Calls are dispatched statically and can be inlined, which makes generic code as fast as hand-written code for each type. The downside is longer compile times and bigger binaries ("code bloat"), especially when large generic functions are instantiated with many types.

```rust
#[derive(Debug)]
struct Page<T> {
    items: Vec<T>,
    next_cursor: Option<String>,
}

impl<T> Page<T> {
    fn map<U>(self, f: impl FnMut(T) -> U) -> Page<U> {
        Page { items: self.items.into_iter().map(f).collect(), next_cursor: self.next_cursor }
    }
}

// specialised impl only for Page<String>
impl Page<String> {
    fn total_chars(&self) -> usize { self.items.iter().map(String::len).sum() }
}

fn largest<T: PartialOrd>(xs: &[T]) -> Option<&T> {
    let mut it = xs.iter();
    let mut best = it.next()?;
    for x in it { if x > best { best = x; } }
    Some(best)
}

fn main() {
    let p = Page { items: vec![1, 22, 3], next_cursor: None };
    println!("{:?}", largest(&p.items));
    let s = p.map(|n| n.to_string());
    println!("{}", s.total_chars());
}
```

A common trick to limit bloat is a thin generic wrapper that converts its argument and calls a non-generic inner function: `fn open<P: AsRef<Path>>(p: P) { inner(p.as_ref()) }`. The standard library does exactly this.

- Pitfall: putting trait bounds on a struct definition. Put them on the `impl` blocks that need them, or every user of the struct has to repeat them.
- Interview tip: compare this with Java's type erasure and C#'s reified generics. Rust is closest to C++ templates, except that bounds are checked when the generic is defined, not when it is instantiated.

### Trait Bounds and where Clauses
<!-- level: intermediate; ref: https://doc.rust-lang.org/reference/items/generics.html -->
Bounds limit what a generic type can be, and they are the only operations generic code may use. Inside `fn f<T>(x: T)` you can do almost nothing with `x` until you add `T: Display`, `T: Clone + Send` and so on. This is how Rust type-checks generic code once, at the definition.

You can write bounds inline (`<T: Clone>`), in a `where` clause (easier to read with many parameters or complex bounds), or with `impl Trait` in argument position (`fn f(x: impl Display)`). The last is shorthand for an anonymous generic parameter, except that callers can't name its type with turbofish.

A `where` clause can also bound types that aren't parameters, for example `where Vec<T>: Debug`, or associated types: `where I: Iterator, I::Item: Display`.

```rust
use std::collections::HashMap;
use std::fmt::Display;
use std::hash::Hash;

fn count_by<I, K, F>(items: I, key_fn: F) -> HashMap<K, usize>
where
    I: IntoIterator,
    F: Fn(&I::Item) -> K,
    K: Eq + Hash,
{
    let mut map = HashMap::new();
    for item in items {
        *map.entry(key_fn(&item)).or_insert(0) += 1;
    }
    map
}

fn print_all(items: &[impl Display]) {
    for i in items { print!("{i} "); }
    println!();
}

fn main() {
    let words = ["apple", "avocado", "banana", "blueberry", "cherry"];
    let by_letter = count_by(words, |w| w.chars().next().unwrap());
    println!("{by_letter:?}");
    print_all(&[1.5, 2.5]);
}
```

`?Sized` relaxes the implicit `Sized` bound so a generic can accept `str`, `[T]` or `dyn Trait` behind a reference: `fn show<T: ?Sized + Debug>(x: &T)`.

- Pitfall: over-constraining with `Clone + Debug + Send + Sync + 'static` "just in case". Every bound makes the API harder to use.
- Interview tip: when you see "the trait bound X is not satisfied", read which bound failed and where it came from, because the note often points to a blanket impl.

### Associated Types vs Generic Parameters
<!-- level: intermediate; ref: https://doc.rust-lang.org/reference/items/associated-items.html -->
A trait can be generic (`trait From<T>`) or have associated types (`trait Iterator { type Item; }`). The difference is how many implementations a type can have.
- Generic parameter: a type can implement the trait many times with different parameters. `String` implements `From<&str>`, `From<char>`, `From<Box<str>>` and more. Callers sometimes have to say which one they mean.
- Associated type: exactly one implementation per type, and the implementation chooses the type. An iterator has a single `Item`, so `iter.next()` never needs annotations.

Pick an associated type when the type is an output decided by the implementor. Pick a generic parameter when the type is an input that callers can vary. Associated constants (`const ID: u32;`) work the same way for values.

```rust
trait Repository {
    type Entity;
    type Error: std::fmt::Debug;
    const TABLE: &'static str;

    fn find(&self, id: u64) -> Result<Option<Self::Entity>, Self::Error>;
}

#[derive(Debug, Clone)]
struct Product { id: u64, name: String }

struct InMemoryProducts(Vec<Product>);

impl Repository for InMemoryProducts {
    type Entity = Product;
    type Error = std::convert::Infallible;
    const TABLE: &'static str = "products";

    fn find(&self, id: u64) -> Result<Option<Product>, Self::Error> {
        Ok(self.0.iter().find(|p| p.id == id).cloned())
    }
}

fn load<R: Repository>(repo: &R, id: u64) -> Option<R::Entity> {
    println!("SELECT * FROM {}", R::TABLE);
    repo.find(id).ok().flatten()
}

fn main() {
    let repo = InMemoryProducts(vec![Product { id: 1, name: "Pen".into() }]);
    println!("{:?}", load(&repo, 1));
}
```

Generic associated types (GATs, stable since 1.65) let an associated type take its own lifetime or type parameters: `type Item<'a> where Self: 'a;`. They enable "lending iterators" that hand out borrows of the iterator itself.

- Pitfall: making a trait generic when each type has only one sensible choice. Callers then have to write turbofish everywhere.
- Interview tip: `Add<Rhs = Self>` with `type Output` combines both. The right-hand operand varies, while the result is fixed per pair.

### impl Trait and Rust 2024 Capture Rules
<!-- level: advanced; ref: https://doc.rust-lang.org/edition-guide/rust-2024/rpit-lifetime-capture.html -->
`impl Trait` in return position (RPIT) returns "some concrete type that implements Trait" without naming it. That is essential for closures and iterator chains, whose types can't be written. The caller sees only the trait. The compiler knows the real type, so there is still no dynamic dispatch.

The hidden type may contain generic parameters and lifetimes, and the capture rules decide which ones it may use. In Rust 2024 (and for RPIT in traits since 1.75), RPIT automatically captures all generic and lifetime parameters in scope. Before 2024, lifetimes had to be captured explicitly with tricks such as `+ '_` or the `Captures<'a>` pattern.

To capture less, use precise capturing with `use<..>` (stable since 1.82). For example `-> impl Iterator<Item = u32> + use<>` promises that the return value borrows nothing from the arguments, so callers can drop or mutate those arguments right away.

```rust
// 2024: captures 'a automatically (it borrows `words`)
fn long_words<'a>(words: &'a [String], min: usize) -> impl Iterator<Item = &'a str> {
    words.iter().filter(move |w| w.len() >= min).map(String::as_str)
}

// Promise the result does NOT borrow `cfg`
fn port_range(cfg: &Vec<u16>) -> impl Iterator<Item = u16> + use<> {
    let (lo, hi) = (cfg[0], cfg[1]);
    lo..=hi
}

fn main() {
    let words = vec!["a".to_string(), "longer".to_string()];
    println!("{:?}", long_words(&words, 3).collect::<Vec<_>>());

    let mut cfg = vec![8000, 8003];
    let ports = port_range(&cfg);
    cfg.clear();                      // fine: `ports` doesn't borrow cfg
    println!("{:?}", ports.collect::<Vec<_>>());
}
```

- Pitfall: when a crate migrates to 2024, functions returning `impl Trait` may start capturing borrows they didn't capture before, and some callers stop compiling. `cargo fix --edition` adds `use<..>` where it's needed.
- Pitfall: different branches can't return different concrete types behind one RPIT. Use an enum (or `Either`) or `Box<dyn Trait>`.
- Interview tip: `impl Trait` in argument position is a generic parameter. In return position it is an existential (opaque) type.

### Trait Objects and dyn Compatibility
<!-- level: intermediate; ref: https://doc.rust-lang.org/reference/types/trait-object.html -->
`dyn Trait` is a type-erased value that is dispatched at runtime. It always sits behind a pointer, as `&dyn Trait`, `Box<dyn Trait>` or `Arc<dyn Trait>`, because its size is unknown at compile time. That pointer is a fat pointer: a data pointer plus a pointer to a vtable holding the method addresses, the size, the alignment and the drop function.

Reach for trait objects when you need heterogeneous collections (`Vec<Box<dyn Handler>>`), plugin-style extension points, or smaller binaries and faster compiles than generics would give.

Only dyn-compatible traits (formerly called "object safe") can become trait objects. Roughly, their methods must not return `Self`, must not have their own generic type parameters, and must take a receiver such as `&self` or `self: Box<Self>`. A method can opt out of the vtable with `where Self: Sized`.

```rust
use std::fmt::Debug;

trait Middleware: Debug {
    fn handle(&self, path: &str) -> Option<String>;
    fn boxed_clone(&self) -> Box<dyn Middleware>; // instead of Clone (returns Self)
}

#[derive(Debug, Clone)]
struct Auth;
#[derive(Debug, Clone)]
struct Logger { prefix: String }

impl Middleware for Auth {
    fn handle(&self, p: &str) -> Option<String> {
        p.starts_with("/admin").then(|| "401".to_string())
    }
    fn boxed_clone(&self) -> Box<dyn Middleware> { Box::new(self.clone()) }
}
impl Middleware for Logger {
    fn handle(&self, p: &str) -> Option<String> { println!("{}{p}", self.prefix); None }
    fn boxed_clone(&self) -> Box<dyn Middleware> { Box::new(self.clone()) }
}

fn main() {
    let chain: Vec<Box<dyn Middleware>> = vec![Box::new(Logger { prefix: "> ".into() }), Box::new(Auth)];
    let resp = chain.iter().find_map(|m| m.handle("/admin/users"));
    println!("{resp:?} {:?}", chain[1].boxed_clone());
}
```

Trait upcasting was stabilised in Rust 1.86. You can coerce `&dyn Sub` to `&dyn Super` when `Super` is a supertrait. A typical use is `&dyn MyTrait` to `&dyn Any` for downcasting.

- Pitfall: async fns in traits are not dyn compatible today. Box the futures yourself, or use the `async-trait` crate.
- Interview tip: generics give speed and inlining but cost code size. `dyn` gives flexibility, smaller binaries and one indirect call per method.

### Deriving Common Standard Traits
<!-- level: basic; ref: https://doc.rust-lang.org/book/appendix-03-derivable-traits.html -->
`#[derive(...)]` generates implementations of standard traits from a type's fields. Learn what each one means:
- `Debug`: `{:?}` formatting for developers. Derive it on almost everything.
- `Clone`/`Copy`: explicit duplication, or implicit bitwise copying.
- `PartialEq`/`Eq`: `==`. `Eq` promises reflexivity, which `f64` can't promise because NaN != NaN.
- `PartialOrd`/`Ord`: ordering. The derive compares fields in declaration order, and enum variants by declaration order.
- `Hash`: needed for `HashMap` keys. It must agree with `Eq`: equal values must hash the same.
- `Default`: zero or empty values. Mark one enum variant with `#[default]` (since 1.62).

`Display` (user-facing text) is never derived. You write it, because only you know how the type should look to users. Serde's `Serialize`/`Deserialize` are derive macros provided by an external crate.

```rust
use std::collections::BTreeSet;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
enum Priority { Low, #[default] Normal, High }

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct Ticket { priority: Priority, id: u32 } // sorts by priority, then id

impl fmt::Display for Ticket {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "#{} [{:?}]", self.id, self.priority)
    }
}

fn main() {
    let set: BTreeSet<Ticket> = [
        Ticket { priority: Priority::High, id: 3 },
        Ticket { priority: Priority::Low, id: 9 },
        Ticket { priority: Priority::default(), id: 1 },
    ].into_iter().collect();
    for t in &set { println!("{t}"); }
}
```

- Pitfall: field order silently decides the derived `Ord`. Reordering fields changes how values sort.
- Pitfall: implementing `PartialEq` by hand while deriving `Hash`, so the two disagree. Lookups in HashMaps then break silently.
- Interview tip: library types should implement `Debug`, `Clone`, `PartialEq` and `Default` wherever they make sense (the C-COMMON-TRAITS API guideline).

### Conversions: From, Into, TryFrom, AsRef
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/convert/index.html -->
Rust never converts between types implicitly. Conversions are traits:
- `From<T>`: infallible, value to value. Implementing `From` gives you the matching `Into` for free through a blanket impl, so implement `From` and call either one.
- `TryFrom<T>`/`TryInto`: conversions that can fail and return `Result`.
- `AsRef<T>`/`AsMut<T>`: cheap borrowed views (`AsRef<str>`, `AsRef<Path>`, `AsRef<[u8]>`), used for flexible parameters.
- `FromStr`: parsing via `"42".parse::<T>()`.
- `Borrow<T>`: like `AsRef` but with the extra promise that `Eq`/`Hash`/`Ord` agree. This is what lets a `HashMap<String, V>` be looked up with a `&str`.

The `?` operator calls `From::from` on the error, so a `From` impl between error types is what makes error propagation feel effortless.

```rust
use std::str::FromStr;

#[derive(Debug)]
struct Celsius(f64);
#[derive(Debug)]
struct Fahrenheit(f64);

impl From<Celsius> for Fahrenheit {
    fn from(c: Celsius) -> Self { Fahrenheit(c.0 * 9.0 / 5.0 + 32.0) }
}

#[derive(Debug)]
struct Port(u16);

impl TryFrom<i64> for Port {
    type Error = String;
    fn try_from(v: i64) -> Result<Self, Self::Error> {
        if (1..=65535).contains(&v) { Ok(Port(v as u16)) } else { Err(format!("bad port {v}")) }
    }
}

impl FromStr for Port {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        s.parse::<i64>().map_err(|e| e.to_string())?.try_into()
    }
}

fn main() {
    let f: Fahrenheit = Celsius(100.0).into();
    let p: Result<Port, _> = "8080".parse();
    println!("{f:?} {p:?} {:?}", Port::try_from(70000));
}
```

- Pitfall: hiding expensive or lossy work in `From`. `From` should be cheap-ish and lossless. Use a named method otherwise.
- Interview tip: generic parameters such as `impl Into<String>` make APIs nicer, but they can hurt type inference and monomorphization. Use them where callers clearly benefit.

### Operator Overloading and the Orphan Rule
<!-- level: intermediate; ref: https://doc.rust-lang.org/std/ops/index.html -->
Operators are syntactic sugar for traits in `std::ops`:
- `a + b` calls `Add::add`.
- `a[i]` calls `Index::index`.
- `-a` calls `Neg`.
- `a += b` calls `AddAssign`.

`std::cmp` covers comparisons, and `Deref` handles `*`. Overloading lets domain types such as money, vectors and matrices read naturally. Rust doesn't let you invent new operators, and `&&`, `||` and `=` can't be overloaded.

Coherence and the orphan rule control which impls you may write. `impl Trait for Type` is allowed only if the trait or the type is defined in your crate, with some relaxations for local types appearing as generic parameters. This guarantees there is never more than one impl of a trait for a type in a whole program, so adding a dependency can never make two impls collide.

```rust
use std::ops::{Add, Mul};

#[derive(Debug, Clone, Copy, PartialEq)]
struct Money { cents: i64 }

impl Add for Money {
    type Output = Money;
    fn add(self, rhs: Money) -> Money { Money { cents: self.cents + rhs.cents } }
}

impl Mul<i64> for Money {               // Money * quantity
    type Output = Money;
    fn mul(self, qty: i64) -> Money { Money { cents: self.cents * qty } }
}

// Orphan rule: can't `impl Display for Vec<Money>` (both foreign).
// Wrap it in a local newtype instead:
struct Cart(Vec<Money>);
impl std::fmt::Display for Cart {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let total = self.0.iter().fold(Money { cents: 0 }, |a, &b| a + b);
        write!(f, "{} items, ${:.2}", self.0.len(), total.cents as f64 / 100.0)
    }
}

fn main() {
    let unit = Money { cents: 250 };
    let cart = Cart(vec![unit * 3, Money { cents: 99 }]);
    println!("{cart}");
}
```

- Pitfall: `Add` takes its operands by value. For non-`Copy` types, also implement `Add<&T> for &T` so callers can avoid clones.
- Interview tip: specialization (more specific impls overriding blanket ones) is still unstable. Coherence is why it has been so hard to stabilise.
