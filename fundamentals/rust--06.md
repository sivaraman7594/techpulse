## 13. Unsafe Rust and FFI

### What unsafe Unlocks: Raw Pointers and the Five Superpowers
<!-- level: advanced; ref: https://doc.rust-lang.org/nomicon/what-unsafe-does.html -->
`unsafe` does not turn off the borrow checker or type checking. It unlocks exactly five extra operations:
1. dereferencing raw pointers (`*const T`, `*mut T`),
2. calling `unsafe` functions, including FFI functions,
3. accessing or modifying `static mut` items,
4. implementing `unsafe` traits (`Send`, `Sync`, `GlobalAlloc`),
5. accessing fields of `union`s.

An `unsafe` block is a promise from the programmer: "I have checked the invariants the compiler can't check." If the promise is wrong, the result is undefined behaviour (UB). UB doesn't just mean a crash. The optimizer assumes UB never happens, so it can silently miscompile code anywhere around it.

Raw pointers can be null, dangling, unaligned or aliased. Creating them is safe. Only dereferencing them is unsafe. Since 1.82, `&raw const x` and `&raw mut x` create raw pointers directly, without first making a reference, which matters for packed fields and uninitialised memory.

The idiom is safe abstractions over unsafe code: keep the `unsafe` block small, put it behind a safe API whose checks uphold the invariants, and write a `// SAFETY:` comment that explains why it is sound.

```rust
/// Split a slice into two non-overlapping mutable halves (like std's split_at_mut).
pub fn split_halves(v: &mut [i32], mid: usize) -> (&mut [i32], &mut [i32]) {
    assert!(mid <= v.len(), "mid out of bounds");     // the check that makes it sound
    let len = v.len();
    let ptr = v.as_mut_ptr();
    // SAFETY: mid <= len was asserted, so both ranges are in bounds and disjoint;
    // the returned borrows are tied to the lifetime of `v`.
    unsafe {
        (
            std::slice::from_raw_parts_mut(ptr, mid),
            std::slice::from_raw_parts_mut(ptr.add(mid), len - mid),
        )
    }
}

fn main() {
    let mut data = [1, 2, 3, 4, 5];
    let (a, b) = split_halves(&mut data, 2);
    a[0] = 10; b[0] = 30;
    println!("{data:?}");
}
```

- Pitfall: creating two live `&mut` references to the same data is UB even if neither is ever written through.
- Interview tip: "unsafe means the compiler trusts you, not that the code is unchecked." Mention `#![forbid(unsafe_code)]` for crates that shouldn't need it.

### unsafe fn, Safety Contracts and Rust 2024 Changes
<!-- level: advanced; ref: https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-op-in-unsafe-fn.html -->
An `unsafe fn` has preconditions the caller must uphold, documented in a `# Safety` section of its doc comment. `Vec::set_len`, `get_unchecked`, `String::from_utf8_unchecked` and `ptr::read` are examples. Calling one requires an `unsafe` block, where the caller takes responsibility for meeting those preconditions.

Rust 2024 makes three changes here.
- The `unsafe_op_in_unsafe_fn` lint warns by default. The body of an `unsafe fn` is no longer one big implicit unsafe block. Each unsafe operation inside it needs its own `unsafe { }` with a `SAFETY` comment. This separates "this function has a contract" from "this operation is dangerous".
- `std::env::set_var` and `std::env::remove_var` are now `unsafe` functions. On many platforms, modifying the environment while other threads read it (including C libraries calling `getenv`) is a data race. Call them only before spawning threads, or avoid them altogether.
- `std::os::unix::process::CommandExt::before_exec` is also unsafe in this edition (it was already deprecated in favour of `pre_exec`).

```rust
/// Returns the element at `idx` without bounds checking.
///
/// # Safety
/// `idx` must be less than `data.len()`.
pub unsafe fn at_unchecked(data: &[u64], idx: usize) -> u64 {
    // SAFETY: the caller guarantees idx < data.len() (see # Safety)
    unsafe { *data.get_unchecked(idx) }   // explicit block required to avoid the 2024 lint
}

pub fn sum_even_indices(data: &[u64]) -> u64 {
    (0..data.len()).step_by(2)
        // SAFETY: i comes from 0..len, so it is always in bounds
        .map(|i| unsafe { at_unchecked(data, i) })
        .sum()
}

fn main() {
    // Rust 2024: environment mutation must be unsafe; do it before threads exist
    // SAFETY: single-threaded at this point in main
    unsafe { std::env::set_var("APP_MODE", "test") };
    println!("{} {:?}", sum_even_indices(&[1, 2, 3, 4, 5]), std::env::var("APP_MODE"));
}
```

- Pitfall: marking a function `unsafe` "because it uses unsafe internally". If it upholds every invariant itself, it should be a safe fn with an unsafe block inside.
- Interview tip: the soundness rule is that safe code must never be able to cause UB, whatever inputs it passes to your safe API.

### FFI: unsafe extern Blocks and Unsafe Attributes
<!-- level: advanced; ref: https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-extern.html -->
Rust calls C through `extern "C"` declarations and exposes Rust functions to C with `extern "C" fn` plus a stable symbol name. Types that cross the boundary must have a C-compatible layout: `#[repr(C)]` structs, integers, raw pointers, `Option<extern "C" fn>`, and `CStr`/`CString` for strings. The compiler can't check a foreign declaration, so a wrong signature is UB.

Rust 2024 makes this explicit:
- `extern` blocks must be written `unsafe extern "C" { ... }` (allowed since 1.82, required in 2024). The `unsafe` is your claim that the declarations are correct.
- Inside the block, each item may be marked `safe fn` (callable without `unsafe`, for C functions with no preconditions) or `unsafe fn` (the default).
- Attributes that can cause UB, such as `#[no_mangle]`, `#[export_name]` and `#[link_section]`, must be written `#[unsafe(no_mangle)]` and so on, because two crates exporting the same symbol name is unsound.

```rust
use std::ffi::{c_char, c_int, CStr, CString};

unsafe extern "C" {
    // C's abs has no preconditions: callable from safe code
    pub safe fn abs(x: c_int) -> c_int;
    // strlen requires a valid NUL-terminated pointer: stays unsafe
    pub unsafe fn strlen(s: *const c_char) -> usize;
}

/// Exported for C callers: int add_scores(int a, int b);
#[unsafe(no_mangle)]
pub extern "C" fn add_scores(a: c_int, b: c_int) -> c_int {
    a.saturating_add(b)
}

#[repr(C)]
pub struct Point { x: f64, y: f64 }

fn main() {
    let name = CString::new("techpulse").expect("no interior NUL");
    // SAFETY: `name` is a valid NUL-terminated string that outlives the call
    let n = unsafe { strlen(name.as_ptr()) };
    let back: &CStr = name.as_c_str();
    println!("{} {n} {:?} {}", abs(-7), back, add_scores(2, 3));
}
```

Build integration: `bindgen` generates Rust declarations from C headers, `cbindgen` generates C headers from Rust, `cc` compiles C sources in `build.rs`, and `cxx` offers safe C++ interop. Panics must not unwind across `extern "C"`. If one tries, the process aborts. Use the `"C-unwind"` ABI when unwinding across the boundary is intended.

- Pitfall: passing `String::as_ptr()` to C. It isn't NUL-terminated. Use `CString`, and keep it alive for as long as C uses the pointer.
- Interview tip: be able to explain who frees memory that crosses the boundary. Memory allocated in Rust should be freed by a Rust function that you export.

### static mut, Undefined Behaviour and Miri
<!-- level: advanced; ref: https://doc.rust-lang.org/edition-guide/rust-2024/static-mut-references.html -->
`static mut` is a global that can be mutated, and any access to it is `unsafe`, because the compiler can't stop two threads, or two references, from aliasing it. In Rust 2024, the `static_mut_refs` lint is deny-by-default: taking `&STATIC_MUT` or `&mut STATIC_MUT` is an error, because even a short-lived reference that overlaps another access is instant UB. Replacements:
- atomics (`static COUNT: AtomicU64`),
- `Mutex`/`RwLock` in a `static`, since their constructors are `const`,
- `OnceLock`/`LazyLock`,
- `thread_local!` with `Cell` or `RefCell`,
- for the rare low-level case, `&raw mut STATIC` with raw-pointer reads and writes.

Common sources of UB to know: data races; dangling or misaligned pointer dereferences; aliased `&mut`; reading uninitialised memory (use `MaybeUninit`); invalid values (a `bool` that is 2, an invalid enum discriminant, a `char` surrogate); breaking `str`'s UTF-8 invariant; and unwinding out of `extern "C"`.

Miri is an interpreter for Rust's mid-level IR that detects many kinds of UB at runtime: aliasing violations under the Stacked or Tree Borrows models, out-of-bounds access, use-after-free, uninitialised reads, and data races. Run your test suite under it. Every crate containing `unsafe` should do this in CI.

```rust
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

// Before (2021 style, now denied in 2024):
// static mut REQUESTS: u64 = 0;
// unsafe { REQUESTS += 1; println!("{}", &REQUESTS); }

static REQUESTS: AtomicU64 = AtomicU64::new(0);
static RECENT: Mutex<Vec<String>> = Mutex::new(Vec::new()); // const constructor

thread_local! {
    static SCRATCH: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

fn record(path: &str) {
    REQUESTS.fetch_add(1, Ordering::Relaxed);
    RECENT.lock().unwrap().push(path.to_owned());
    SCRATCH.with_borrow_mut(|s| { s.clear(); s.push_str(path); });
}

fn main() {
    record("/a"); record("/b");
    println!("{} {:?}", REQUESTS.load(Ordering::Relaxed), RECENT.lock().unwrap());
}
```

```bash
rustup +nightly component add miri
cargo +nightly miri test
```

- Pitfall: "it works in release, so it's fine". UB can appear only with a different compiler version or target.
- Interview tip: knowing Miri, loom and sanitizers (`-Zsanitizer=address`, nightly) shows you take unsafe code seriously.

## 14. Cargo, Modules, Testing and Tooling

### Modules, Paths and Visibility
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch07-02-defining-modules-to-control-scope-and-privacy.html -->
Modules organise code inside a crate and control privacy. `mod name;` loads `name.rs` or `name/mod.rs`, with the `name.rs` + `name/` directory layout preferred since 2018. Everything is private to its module by default. Children can see their ancestors' private items, but parents can't see their children's private items.

Visibility levels:
- `pub`: visible everywhere the parent module is visible.
- `pub(crate)`: anywhere inside this crate. It is the workhorse for internal APIs.
- `pub(super)`: the parent module.
- `pub(in path)`: a specific ancestor module.

Paths start with `crate::` (crate root), `self::`, `super::` or an external crate name. `use` brings names into scope, and `pub use` re-exports them to shape a clean public API that doesn't mirror your file layout.

```rust
// src/lib.rs
pub mod billing {
    pub use self::invoice::Invoice;          // re-export: billing::Invoice

    mod invoice {                           // private module
        #[derive(Debug)]
        pub struct Invoice { pub id: u64, pub(crate) cents: u64, secret: String }

        impl Invoice {
            pub fn new(id: u64, cents: u64) -> Self {
                Self { id, cents, secret: super::tax::token() }
            }
        }
    }

    mod tax {
        pub(super) fn token() -> String { "t-1".into() } // only billing can call
    }
}

pub mod reports {
    use crate::billing::Invoice;
    pub fn total(invs: &[Invoice]) -> u64 {
        invs.iter().map(|i| i.cents).sum()   // pub(crate) field: OK in same crate
    }
}
```

Structs with private fields can't be built outside their module, which is how invariants get enforced. Enum variants and their fields are public whenever the enum is.

- Pitfall: `pub` items inside a private module are not reachable from outside the crate unless they are re-exported. Use `cargo doc` to see your real public API.
- Interview tip: crates are the unit of compilation and of the orphan rule. Modules are only namespaces and privacy boundaries.

### Packages, Crates and Workspaces
<!-- level: intermediate; ref: https://doc.rust-lang.org/cargo/reference/workspaces.html -->
A crate is one compilation unit: a library (`src/lib.rs`) or a binary (`src/main.rs`, `src/bin/*.rs`). A package is a `Cargo.toml` with at most one library crate and any number of binaries, plus examples, tests and benches. A workspace is a set of packages that share one `Cargo.lock` and one `target/` directory, so a dependency is built once for all of them.

Splitting a large codebase into several crates speeds up incremental and parallel compilation, because rustc parallelises across crates well. It also enforces architectural boundaries: one crate can't reach into another's private items, and dependency cycles between crates are impossible. A typical layout is `core` (domain), `storage`, `api` (binary) and `cli`.

Workspace inheritance (`[workspace.package]`, `[workspace.dependencies]`, `[workspace.lints]`) keeps versions and settings consistent across crates.

```toml
# Cargo.toml (workspace root)
[workspace]
resolver = "3"                 # default for edition 2024 (MSRV-aware)
members = ["crates/core", "crates/storage", "crates/api"]

[workspace.package]
edition = "2024"
rust-version = "1.85"
license = "MIT"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }

[workspace.lints.clippy]
unwrap_used = "warn"
```

```toml
# crates/api/Cargo.toml
[package]
name = "api"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true

[dependencies]
orders-core = { path = "../core" }
serde.workspace = true
tokio.workspace = true

[lints]
workspace = true
```

```bash
cargo build -p api          # one member
cargo test --workspace      # everything
```

- Pitfall: one giant crate with 100k lines. Each small edit then recompiles the whole crate, slowly.
- Interview tip: in a workspace, every member shares one lockfile and gets the same version of each dependency, which avoids "works in one crate, not the other" bugs.

### Dependencies, Features and SemVer
<!-- level: intermediate; ref: https://doc.rust-lang.org/cargo/reference/features.html -->
Cargo dependency versions use SemVer caret requirements by default. `serde = "1.0.200"` means `>=1.0.200, <2.0.0`, and for 0.x versions, `0.4.3` means `<0.5.0`. `Cargo.lock` pins the exact versions resolved. `cargo update` refreshes them within the declared ranges. Multiple semver-incompatible versions of one crate can coexist in a single build, which is allowed but makes the build bigger and slower.

Features are named, additive flags that turn on optional code (`#[cfg(feature = "json")]`) and optional dependencies (`dep:serde_json`). Cargo unifies features: if any crate in the graph enables a feature, every user of that crate gets it. So features must be strictly additive. Never use a feature to remove functionality or switch between mutually exclusive implementations.

Resolver "3" (the default with edition 2024, available since Cargo 1.84) prefers dependency versions whose `rust-version` is compatible with yours, which makes MSRV support practical.

```toml
[package]
name = "reportgen"
version = "1.4.0"
edition = "2024"
rust-version = "1.85"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = { version = "1.0", optional = true }
tracing = "0.1"

[features]
default = ["json"]
json = ["dep:serde_json"]
pdf = []

[dev-dependencies]
proptest = "1"
```

```rust
#[cfg(feature = "json")]
pub fn to_json<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).expect("serializable")
}
```

```bash
cargo add tokio --features full   # edit Cargo.toml from the CLI
cargo tree -d                      # find duplicate versions
cargo build --no-default-features --features pdf
```

- Pitfall: removing a public item or adding a required trait method in a minor release. Use `cargo-semver-checks` before publishing.
- Interview tip: CI should test with `--all-features` and `--no-default-features`, because feature combinations are a common source of breakage.

### Build Profiles and Release Optimisation
<!-- level: intermediate; ref: https://doc.rust-lang.org/cargo/reference/profiles.html -->
Profiles control how code is compiled. `dev` (`cargo build`) uses `opt-level = 0` with debug assertions and overflow checks for fast compiles. `release` uses `opt-level = 3` with no debug assertions. You can define custom profiles that inherit from these, for example `[profile.profiling]` with debug symbols turned on.

Settings that matter:
- `lto`: link-time optimisation across crates. `"thin"` is a good balance and `"fat"` gives the most speed. Both build more slowly.
- `codegen-units = 1`: better optimisation, but less parallel compilation.
- `panic = "abort"`: smaller and slightly faster binaries, with no unwinding.
- `debug = "line-tables-only"` or `true`: for profiling or symbolised production backtraces.
- `strip = true`: smaller binaries.
- `opt-level = "s"`/`"z"`: optimise for size (WASM, embedded).
- Per-package overrides such as `[profile.dev.package."*"] opt-level = 2` optimise dependencies even in debug builds, which is great for game, image or crypto crates.

```toml
[profile.release]
lto = "thin"
codegen-units = 1
panic = "abort"
debug = "line-tables-only"   # usable stack traces in production

[profile.dev.package."*"]
opt-level = 2                # fast deps, fast-compiling own code

[profile.profiling]
inherits = "release"
debug = true
strip = false
```

```bash
cargo build --release
cargo build --profile profiling
RUSTFLAGS="-C target-cpu=native" cargo build --release   # only if binary runs on same CPU family
```

PGO (profile-guided optimisation) with `cargo-pgo`, and allocator swaps (`mimalloc`, `jemalloc` via `#[global_allocator]`) can add 10–20% on allocation-heavy servers. Always measure.

- Pitfall: `target-cpu=native` binaries can crash with an illegal instruction on older production CPUs.
- Interview tip: debug builds check for integer overflow and release builds wrap. Use `overflow-checks = true` in release if correctness matters more than a few percent of speed.

### Testing: Unit, Integration and Doc Tests
<!-- level: basic; ref: https://doc.rust-lang.org/book/ch11-03-test-organization.html -->
Testing is built into the language and Cargo.
- Unit tests live next to the code in a `#[cfg(test)] mod tests` module with `#[test]` functions. They can test private functions, because they're in a child module.
- Integration tests live in `tests/*.rs`. Each file is a separate crate that can only use your public API, the way real users do.
- Doc tests are code blocks in `///` comments. They compile and run with `cargo test`, so examples can't silently go stale.

Assertions: `assert!`, `assert_eq!` and `assert_ne!`, each with optional custom messages. `#[should_panic(expected = "...")]` tests panics. A test may return `Result<(), E>` so you can use `?`. `#[ignore]` marks slow tests, which you run with `cargo test -- --ignored`. Tests run in parallel threads by default, so shared global state (environment variables, files, ports) needs care.

```rust
/// Splits a full name.
///
/// ```
/// assert_eq!(mylib::split_name("Ada Lovelace"), Some(("Ada", "Lovelace")));
/// ```
pub fn split_name(full: &str) -> Option<(&str, &str)> {
    full.trim().split_once(' ')
}

fn normalize(s: &str) -> String { s.trim().to_lowercase() } // private

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_two_words() {
        assert_eq!(split_name(" Ana Lima "), Some(("Ana", "Lima")));
    }

    #[test]
    fn single_word_is_none() {
        assert!(split_name("Cher").is_none(), "mononyms have no surname");
    }

    #[test]
    fn private_fn_is_testable() -> Result<(), String> {
        let n = normalize("  MiXeD ");
        if n == "mixed" { Ok(()) } else { Err(format!("got {n}")) }
    }

    #[test]
    #[should_panic(expected = "index out of bounds")]
    fn panics_on_bad_index() { let v: Vec<u8> = vec![]; let _ = v[1]; }
}
```

```bash
cargo test                       # all tests
cargo test split -- --nocapture  # filter by name, show println!
cargo test --doc                 # doc tests only
```

- Pitfall: integration tests for a binary-only crate. They can't import `main.rs`, so move the logic into `lib.rs`.
- Interview tip: mention `proptest`/`quickcheck` for property-based tests, `insta` for snapshot tests, `mockall` for mocks, and `cargo-nextest` for a faster runner.

### Benchmarking, Profiling and Lints
<!-- level: advanced; ref: https://doc.rust-lang.org/cargo/commands/cargo-bench.html -->
Measure, don't guess. The built-in `#[bench]` harness is still nightly-only, so stable projects use `criterion` or `divan`. They handle warm-up, statistics and regression detection. Wrap inputs and outputs in `std::hint::black_box` (stable since 1.66) so the optimizer can't delete the code being measured.

Profiling a release build that includes debug info:
- Linux: `perf record` with `cargo flamegraph`.
- macOS: Instruments or `samply`.
- Windows: `samply` or VTune.
- Heap usage: `dhat-rs` or `heaptrack`.
- Async apps: `tokio-console`.
- Compile times: `cargo build --timings` shows which crates are slow.

Lints and formatting:
- `cargo clippy` runs hundreds of extra lints. Use `-D warnings` in CI.
- `cargo fmt --check` enforces a uniform style.
- `cargo doc --open` builds the docs.
- `cargo audit`/`cargo deny` check dependencies for vulnerabilities and licence problems.
- Set project lint levels in the `[lints]` table of `Cargo.toml` (1.74+).

```rust
// benches/parse.rs  (Cargo.toml: [[bench]] name = "parse", harness = false; criterion in dev-deps)
use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;

fn parse_csv_line(line: &str) -> Vec<&str> { line.split(',').collect() }

fn bench_parse(c: &mut Criterion) {
    let line = "id,name,email,created_at,country,plan,status";
    c.bench_function("parse_csv_line", |b| {
        b.iter(|| parse_csv_line(black_box(line)))
    });
}

criterion_group!(benches, bench_parse);
criterion_main!(benches);
```

```bash
cargo bench                               # runs criterion, compares with last run
cargo flamegraph --bin api -- --port 8080 # CPU flame graph
cargo clippy --all-targets -- -D warnings
```

- Pitfall: benchmarking on a laptop on battery, or with CPU frequency scaling. Expect noise, and use criterion's confidence intervals.
- Pitfall: optimising without profiling. In Rust services, the hotspot is often allocation, cloning or serialisation, not your algorithm.
- Interview tip: describe a loop: profile, form a hypothesis, change one thing, benchmark again, and keep the benchmark in CI to catch regressions.
