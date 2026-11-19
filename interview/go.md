# Go interview questions

### What makes Go different from languages like Java or Python, and when would you choose it?
<!-- level: basic; kind: concept; ref: https://go.dev/doc/faq -->
Go is a statically typed, compiled language with a garbage collector and a deliberately small feature set.

Distinguishing traits:
- Compiles to a single static native binary: fast startup, trivial deployment, small container images, easy cross-compilation.
- Concurrency built into the language (goroutines, channels, `select`) with a runtime scheduler that makes blocking I/O cheap.
- Composition instead of inheritance: structs, methods and implicitly satisfied interfaces.
- Errors are values returned explicitly, not exceptions.
- Opinionated tooling: `gofmt`, `go vet`, `go test`, modules, race detector and profiler all ship with the toolchain.
- Strong compatibility promise (Go 1 guarantee), with behaviour changes gated by the module's `go` version.

Choose Go for network services, APIs, CLIs, infrastructure tools (Docker, Kubernetes, Terraform are written in Go), and high-concurrency backends where predictable latency and operational simplicity matter. Python wins for data science and quick scripting; Java/Kotlin and C# have richer frameworks and more mature ORMs for large enterprise domains; Rust wins where you cannot afford a GC or need maximum control over memory.

Interview tip: emphasise readability for large teams and operational simplicity, not just speed.

### What is the difference between an array and a slice, and how does append work?
<!-- level: basic; kind: concept; ref: https://go.dev/blog/slices-intro -->
An array has a fixed length that is part of its type (`[4]int`), and it is a value: assigning or passing copies all elements.

A slice is a three-word descriptor: pointer to a backing array, length and capacity. Slicing creates a new descriptor over the same memory, so slices can share data.

`append(s, v)`:
- If `len < cap`, it writes into the existing backing array and returns a header with a larger length.
- Otherwise it allocates a larger array (roughly doubling for small slices, growing more gently above 256 elements), copies elements and returns a header pointing to the new array.

That is why you must use the result (`s = append(s, v)`) and why two slices sharing an array can overwrite each other.

```go
a := []int{1, 2, 3, 4}
b := a[:2]        // len 2, cap 4, shares a
b = append(b, 9)  // overwrites a[2]
fmt.Println(a)    // [1 2 9 4]

c := a[:2:2]      // full slice expression: cap 2
c = append(c, 7)  // forces a new array; a untouched
```

Also know: a nil slice is valid for `len`, `range` and `append`; `make([]T, 0, n)` preallocates; `copy` copies min(len) elements.

### When should a method have a value receiver vs a pointer receiver, and what are method sets?
<!-- level: intermediate; kind: concept; ref: https://go.dev/ref/spec#Method_sets -->
Use a pointer receiver when the method mutates the receiver, when the struct is large, or when it contains fields that must not be copied (`sync.Mutex`). Use value receivers for small, immutable types (`time.Time`, points, money). If any method needs a pointer receiver, use pointer receivers for all methods of that type for consistency.

Method sets decide interface satisfaction:
- The method set of `T` contains only value-receiver methods.
- The method set of `*T` contains both value- and pointer-receiver methods.

So if `Save()` has a pointer receiver, `*Repo` implements `Saver` but `Repo` does not. The reason is that a value stored in an interface is a copy that is not addressable; a pointer method would mutate a hidden copy.

```go
type Saver interface{ Save() error }
type Repo struct{}
func (r *Repo) Save() error { return nil }

var _ Saver = (*Repo)(nil) // ok
// var _ Saver = Repo{}    // compile error
```

Note that calling `r.Save()` on an addressable variable `r` works (Go takes `&r` automatically), but that convenience does not extend to interface satisfaction.

### How are interfaces represented at runtime, and why can an interface holding a nil pointer be non-nil?
<!-- level: advanced; kind: concept; ref: https://go.dev/doc/faq#nil_error -->
An interface value is two machine words:
- For non-empty interfaces: a pointer to an itab (dynamic type plus method table) and a data pointer.
- For `any`/`interface{}`: a pointer to the type descriptor and a data pointer.

Calls through an interface look up the method in the itab (dynamic dispatch). Assigning non-pointer values to interfaces typically copies them to the heap.

An interface is nil only when both words are nil. Assigning a typed nil pointer sets the type word, so the interface is non-nil:

```go
func find() error {
    var e *NotFoundError = nil
    return e // non-nil error!
}
fmt.Println(find() != nil) // true
```

Rule: functions return the `error` interface and use a literal `nil` for success. Interfaces are satisfied implicitly (structural typing), which lets consumers define small interfaces for exactly what they need.

### How do goroutines differ from OS threads? Explain the scheduler.
<!-- level: intermediate; kind: concept; ref: https://go.dev/doc/effective_go#goroutines -->
Goroutines are user-space tasks managed by the Go runtime. They start with a small stack of a few KB that grows by copying, and creation and context switches cost far less than OS threads, so programs routinely run hundreds of thousands.

The scheduler is the G-M-P model:
- G: goroutine.
- M: OS thread.
- P: logical processor with a local run queue; there are `GOMAXPROCS` of them (from Go 1.25 this respects container CPU limits on Linux).

An M must hold a P to run Go code. Idle Ps steal goroutines from other Ps. Blocking syscalls detach the M from its P so other goroutines keep running. Network I/O uses the netpoller (epoll/kqueue/IOCP), so a goroutine waiting on a socket is parked without blocking a thread. Since Go 1.14 goroutines are preempted asynchronously, so tight loops cannot starve others.

Consequence: you can write simple blocking code per connection and still get high concurrency. Caveats: goroutines are not free (leaks accumulate memory), and blocking cgo calls do consume threads.

### Explain buffered vs unbuffered channels and how nil and closed channels behave.
<!-- level: basic; kind: concept; ref: https://go.dev/ref/spec#Channel_types -->
Unbuffered channels (`make(chan T)`) synchronise: a send completes only when a receiver takes the value. They hand over data and guarantee both goroutines reached that point.

Buffered channels (`make(chan T, n)`) let senders proceed until the buffer is full, decoupling producer and consumer speed for bursts. They do not fix a consumer that is consistently slower.

Behaviour table to memorise:
- Send on nil channel: blocks forever. Receive on nil: blocks forever.
- Send on closed channel: panic.
- Receive on closed channel: returns buffered values, then the zero value immediately with `ok == false`.
- Close of nil or already-closed channel: panic.

```go
v, ok := <-ch     // ok false => closed and drained
for v := range ch { } // stops when closed
```

Conventions: only the sender closes; with multiple senders, close after a WaitGroup finishes. Closing is a broadcast to all receivers, which is why `close(done)` is used for cancellation. Nil channels are useful in `select` to disable a case.

### How does select work, and how do you implement timeouts and non-blocking operations?
<!-- level: intermediate; kind: concept; ref: https://go.dev/ref/spec#Select_statements -->
`select` blocks until one of its channel operations can proceed, then executes that case. If several are ready, one is chosen pseudo-randomly, preventing starvation. With a `default` case, `select` never blocks.

```go
select {
case msg := <-in:
    handle(msg)
case <-ctx.Done():          // cancellation
    return ctx.Err()
case <-time.After(2 * time.Second): // timeout
    return ErrTimeout
}

select {                     // non-blocking send
case out <- v:
default:
    dropped++
}
```

Details interviewers probe:
- All channel expressions and send values in the cases are evaluated once on entry.
- `break` inside `select` exits only the select, not an enclosing loop; use a label or return.
- An empty `select {}` blocks forever.
- Since Go 1.23, unreferenced timers are garbage collected even if not stopped, so `time.After` in loops no longer leaks until expiry, though reusing a `time.Timer` is still cheaper in hot loops.

### When do you use a mutex and when do you use channels?
<!-- level: intermediate; kind: concept; ref: https://go.dev/wiki/MutexOrChannel -->
Both are correct synchronisation tools; choose by the shape of the problem.

Use channels when:
- Transferring ownership of data between goroutines (pipelines, work queues).
- Signalling events or completion (done channels, results).
- Coordinating stages with backpressure.

Use a mutex when:
- Protecting shared state accessed by many goroutines: caches, counters, maps, struct fields.
- The critical section is short and there is no natural "message".

Use atomics for single-word counters, flags or pointer swaps (`atomic.Int64`, `atomic.Pointer[T]`).

```go
type Counter struct {
    mu sync.Mutex
    m  map[string]int
}

func (c *Counter) Inc(k string) {
    c.mu.Lock()
    c.m[k]++
    c.mu.Unlock()
}
```

Building this counter with a channel and a goroutine owning the map works but is slower and more code. Conversely, coordinating a worker pool with mutexes and condition variables is harder than with channels.

Pitfalls: mutexes are not re-entrant; never hold locks across I/O; channels used as locks often deadlock in subtle ways.

### What is context.Context and what are the rules for using it?
<!-- level: intermediate; kind: concept; ref: https://pkg.go.dev/context -->
`context.Context` carries cancellation, deadlines and request-scoped values across API boundaries and goroutines. Contexts form a tree; cancelling a parent cancels all descendants.

API: `Background()` at the root; `WithCancel`, `WithTimeout`, `WithDeadline` (and the `...Cause` variants in Go 1.20/1.21) to derive cancellable contexts; `WithValue` for request metadata; `WithoutCancel` and `AfterFunc` (Go 1.21).

Rules:
- Pass ctx as the first parameter; do not store it in structs.
- Always call the returned `cancel` (`defer cancel()`), or resources leak until the parent ends.
- Pass ctx to every blocking call (DB, HTTP, gRPC) and check `ctx.Done()` in long loops; cancellation is cooperative.
- `ctx.Err()` returns `context.Canceled` or `context.DeadlineExceeded`.
- Use values only for request-scoped data (trace IDs, auth principal), with unexported key types; never for dependencies like DB handles.

```go
ctx, cancel := context.WithTimeout(r.Context(), 300*time.Millisecond)
defer cancel()
row := db.QueryRowContext(ctx, `SELECT name FROM users WHERE id=$1`, id)
```

### Explain how defer works, including argument evaluation and named results.
<!-- level: intermediate; kind: concept; ref: https://go.dev/blog/defer-panic-and-recover -->
`defer f(args)` schedules `f` to run when the surrounding function returns, including during a panic. Rules:

1. Deferred calls run in LIFO order.
2. Arguments are evaluated when the `defer` statement executes, not when the call runs.
3. Deferred closures can read and modify named result parameters, after the `return` statement has set them.

```go
func demo() (n int) {
    for i := range 3 {
        defer fmt.Print(i, " ") // prints 2 1 0
    }
    x := 1
    defer fmt.Println("x =", x) // prints x = 1 (evaluated now)
    x = 2
    defer func() { n *= 10 }()  // modifies the result
    return 5                    // caller gets 50
}
```

Uses: releasing resources (`Close`, `Unlock`), recovering from panics, timing and tracing, annotating returned errors. Since Go 1.14 open-coded defers make the cost negligible in most functions.

Pitfalls: `defer` inside a loop delays all cleanups until the function ends (file handle exhaustion); `defer f.Close()` on a written file discards the close error.

### What is the difference between panic and error, and how does recover work?
<!-- level: intermediate; kind: concept; ref: https://go.dev/doc/effective_go#panic -->
Errors are values for expected failures: file not found, invalid input, network timeout. Callers inspect and handle them.

Panics are for unrecoverable situations and programmer bugs: nil dereference, index out of range, impossible states, failed initialisation in `main`. A panic unwinds the goroutine's stack, running deferred functions, and if not recovered it crashes the whole program, printing stacks.

`recover()` stops a panic only when called directly inside a deferred function in the panicking goroutine. Elsewhere it returns nil.

```go
func safe(fn func()) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    fn()
    return nil
}
```

Guidelines:
- Libraries should not panic across their API for ordinary errors.
- Recover at boundaries (HTTP middleware, worker supervisors) to keep a server alive and log the stack.
- A panic in a goroutine you started is not caught by recovery in another goroutine.
- Runtime fatal errors (concurrent map writes, out of memory, deadlock detection) cannot be recovered.

### How do error wrapping, errors.Is and errors.As work?
<!-- level: intermediate; kind: concept; ref: https://go.dev/blog/go1.13-errors -->
Since Go 1.13, `fmt.Errorf("context: %w", err)` wraps an error: the new error's `Unwrap()` returns the original. Go 1.20 allows multiple `%w` verbs and `errors.Join`, so wrapping forms a tree.

- `errors.Is(err, target)` traverses the tree and reports whether any error equals target (or whose `Is` method matches). Use with sentinel errors such as `io.EOF`, `sql.ErrNoRows`, `fs.ErrNotExist`.
- `errors.As(err, &target)` finds the first error assignable to target's type and sets target. Use with error types carrying data such as `*fs.PathError`.

```go
_, err := os.Open("missing.txt")
err = fmt.Errorf("load settings: %w", err)

if errors.Is(err, fs.ErrNotExist) { /* create defaults */ }

var pe *fs.PathError
if errors.As(err, &pe) {
    fmt.Println("failed path:", pe.Path)
}
```

Guidelines: never compare wrapped errors with `==` or by string; use `%w` only when you are willing to make the inner error part of your API, otherwise `%v`; add context at each layer and handle the error once. Go 1.26 adds a generic `errors.AsType[T](err)` convenience.

### Explain Go generics: type parameters, constraints and the ~ operator. When would you avoid them?
<!-- level: intermediate; kind: concept; ref: https://go.dev/doc/tutorial/generics -->
Go 1.18 added type parameters for functions and types. Each type parameter has a constraint, which is an interface describing a type set.

```go
type Number interface{ ~int | ~int64 | ~float64 }

func Sum[T Number](xs []T) T {
    var s T
    for _, x := range xs { s += x }
    return s
}

type Stack[T any] struct{ items []T }
func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }
```

- `~int64` includes all types whose underlying type is int64 (e.g. `type Cents int64`).
- `any` allows any type; `comparable` allows `==` (needed for map keys); `cmp.Ordered` (Go 1.21) allows `<`.
- Type arguments are usually inferred from function arguments.
- Methods cannot declare their own type parameters.
- Implementation uses GC-shape stenciling with dictionaries, so generic code can be slightly slower than specialised code, especially when calling methods via type parameters.
- Go 1.24 supports generic type aliases.

Avoid generics when an ordinary interface suffices (you only call methods), when behaviour differs per type, or speculatively before a second use case exists. They shine for containers, slice/map/channel utilities and type-safe wrappers.

### What is the difference between make and new?
<!-- level: basic; kind: concept; ref: https://go.dev/doc/effective_go#allocation_new -->
`new(T)` allocates zeroed storage for a value of any type `T` and returns a `*T`. It does not initialise internal structures. Go 1.26 extends `new` to accept an expression, so `new(42)` returns an `*int` pointing at 42.

`make` is only for slices, maps and channels. It initialises their internal runtime data structures and returns the value itself (not a pointer):
- `make([]T, len, cap)` allocates a backing array and returns a slice header.
- `make(map[K]V, hint)` creates a ready-to-use hash table.
- `make(chan T, buf)` creates a channel.

```go
p := new(int)            // *int -> 0
m := make(map[string]int) // usable map
var nm map[string]int     // nil map: reads ok, writes panic
s := make([]byte, 0, 512) // len 0, cap 512
c := make(chan int, 10)

u := &User{Name: "a"}     // composite literal: more common than new(User)
```

Why the distinction: slices, maps and channels are descriptors referencing runtime structures; a zero value (nil) is a valid but empty descriptor, and `new` would only give you a pointer to that nil descriptor.

Where memory ends up (stack or heap) is decided by escape analysis, not by whether you used `new` or `make`.

### What should you know about Go maps?
<!-- level: intermediate; kind: concept; ref: https://go.dev/blog/maps -->
- Keys must be comparable: numbers, strings, pointers, channels, arrays and structs of comparable fields, interfaces. Not slices, maps or functions.
- A map is a reference to a runtime hash table; passing it shares the data. The zero value is nil: reading returns zero values, writing panics.
- Lookup of a missing key returns the zero value; use `v, ok := m[k]` to distinguish.
- Iteration order is unspecified and deliberately randomised. Sort keys if you need order (`slices.Sorted(maps.Keys(m))`, Go 1.23).
- Not safe for concurrent writes: the runtime may abort with the unrecoverable "fatal error: concurrent map writes". Use a mutex, `sync.Map` for specific patterns, or sharding.
- Map elements are not addressable (`&m[k]` is illegal) because entries move during growth.
- Maps grow but never shrink; recreate a map to release memory after mass deletion.
- Go 1.24 switched the implementation to Swiss tables, improving lookup speed and memory use.
- `clear(m)` (Go 1.21) deletes all entries; `maps.Clone`, `maps.Copy`, `maps.DeleteFunc` help with common operations.

```go
counts := make(map[string]int, 100)
for _, w := range words {
    counts[w]++
}
set := map[string]struct{}{"admin": {}}
_, isAdmin := set[role]
```

### Explain strings, bytes and runes in Go.
<!-- level: basic; kind: concept; ref: https://go.dev/blog/strings -->
A `string` is an immutable sequence of bytes, usually UTF-8. `len(s)` counts bytes and `s[i]` is a byte.

A `rune` is an alias for `int32` and represents a Unicode code point. `byte` is an alias for `uint8`.

- `for i, r := range s` decodes UTF-8 and yields the byte offset and rune.
- `[]rune(s)` converts to code points; `utf8.RuneCountInString(s)` counts them.
- `[]byte(s)` and `string(b)` usually copy, because strings are immutable.

```go
s := "naïve"
fmt.Println(len(s))                    // 6 bytes
fmt.Println(utf8.RuneCountInString(s)) // 5 runes
for i, r := range s {
    fmt.Println(i, string(r))          // offsets 0,1,2,4,5
}

var b strings.Builder                  // efficient concatenation
for i := range 3 { fmt.Fprintf(&b, "%d,", i) }
```

Pitfalls: byte-slicing can split a multi-byte character; `string(65)` yields "A", not "65" (use `strconv.Itoa`); concatenating with `+=` in loops is quadratic; a substring keeps the whole original string's memory alive (`strings.Clone` detaches it). User-perceived characters (grapheme clusters) can span several runes.

### How does struct embedding differ from inheritance?
<!-- level: intermediate; kind: concept; ref: https://go.dev/doc/effective_go#embedding -->
Embedding places a type inside a struct without a field name. Its fields and methods are promoted, so they can be accessed directly on the outer type, and the outer type satisfies interfaces that the embedded type's methods satisfy.

Differences from inheritance:
- No subtyping: a function taking `Animal` will not accept a `Dog` that embeds `Animal`. Polymorphism comes only through interfaces.
- No virtual dispatch from the embedded type back to the outer type. If `Base.Describe()` calls `b.Name()`, it calls `Base.Name`, even if the outer type defines its own `Name`. There is no "override" in that sense; the outer method merely shadows the promoted one for callers of the outer type.
- The embedded value is a real field (named after its type) and can be accessed explicitly: `d.Animal.Name()`.
- Ambiguous promoted names at the same depth cause compile errors only when used.

```go
type Base struct{}
func (Base) Name() string       { return "base" }
func (b Base) Describe() string { return "I am " + b.Name() }

type Child struct{ Base }
func (Child) Name() string { return "child" }

fmt.Println(Child{}.Describe()) // "I am base", not "I am child"
```

Use embedding for delegation and composing interfaces (`io.ReadWriter`); model polymorphism with interfaces.

### What is the Go memory model, and what is a data race?
<!-- level: advanced; kind: concept; ref: https://go.dev/ref/mem -->
The memory model specifies when a read in one goroutine is guaranteed to observe a write in another. Visibility is guaranteed only through a happens-before relationship created by synchronisation:
- A send on a channel happens before the corresponding receive completes; closing happens before a receive that observes the close.
- For a buffered channel of capacity C, the k-th receive happens before the (k+C)-th send completes.
- `Unlock` of a mutex happens before a later `Lock` returns.
- `sync.Once`, `WaitGroup.Wait`, and atomic operations (sequentially consistent since the Go 1.19 revision) also establish ordering.
- Starting a goroutine happens after the `go` statement's preceding writes.

A data race is two concurrent accesses to the same memory location, at least one a write, without happens-before ordering. Races can produce torn values, stale reads, corrupted maps and crashes; Go gives no guarantees for racy programs (beyond some limits on word-sized values).

```go
var ready bool
var data int

go func() { data = 42; ready = true }()
for !ready {} // racy: may spin forever or see data == 0
```

Fix with a channel, mutex or `atomic.Bool`. Detect with `go test -race`, which reports real races (no false positives) observed during execution.

### How does Go's garbage collector work and how do you tune it?
<!-- level: advanced; kind: concept; ref: https://go.dev/doc/gc-guide -->
Go uses a concurrent, non-generational, non-moving tri-color mark-and-sweep collector. Marking runs concurrently with the program (with write barriers enabled), and stop-the-world pauses are typically sub-millisecond. Goroutines that allocate during marking may be drafted into "assist" work, which can add latency.

Tuning knobs:
- `GOGC` (default 100): the heap may grow by this percentage over the live heap before the next cycle. Higher means less GC CPU but more memory.
- `GOMEMLIMIT` (Go 1.19): a soft memory ceiling; the GC runs more aggressively as total memory approaches it. Essential in containers to avoid OOM kills; commonly ~90% of the container limit.
- `GOGC=off` plus `GOMEMLIMIT`: collect only when nearing the limit; efficient but risky if the live heap grows.

Most effective tuning is reducing allocations: preallocate, reuse buffers, avoid boxing in hot paths, and prefer pointer-free data for large long-lived structures (less to scan).

Observe with `GODEBUG=gctrace=1`, `runtime/metrics`, and heap profiles. Recent releases introduced the Green Tea collector (experimental in Go 1.25, default in 1.26), which improves memory locality during marking.

### What is escape analysis, and how do you decide between stack and heap?
<!-- level: advanced; kind: concept; ref: https://go.dev/doc/faq#stack_or_heap -->
You do not decide; the compiler does. Escape analysis determines whether a value can live on the goroutine's stack (cheap, freed automatically when the function returns) or must be heap-allocated (garbage collected) because it may outlive the function or be shared.

Common reasons to escape:
- Returning or storing a pointer to a local variable.
- Assigning to an interface when the compiler cannot prove it does not escape (e.g. passing to `fmt.Println`).
- Capture by a closure that outlives the call.
- Sending a pointer on a channel or storing it in a global or heap object.
- Variable-size or very large allocations (`make([]byte, n)` with non-constant n).

```go
func newUser() *User { u := User{}; return &u } // u moved to heap: legal and safe
func sum() int { p := Point{1, 2}; return p.X }  // stays on stack
```

Inspect with `go build -gcflags=-m` (`-m=2` explains why). Reducing escapes reduces GC pressure, but only optimise hot paths identified by profiling; decisions vary between compiler versions. Goroutine stacks grow by copying, so stack pointers stay valid.

### How do Go modules work, and what is Minimal Version Selection?
<!-- level: intermediate; kind: concept; ref: https://go.dev/ref/mod -->
A module is a versioned collection of packages defined by `go.mod`, which declares the module path, the minimum Go version (`go` line), optional `toolchain`, required dependencies, and directives like `replace`, `exclude`, `retract` and `tool` (Go 1.24). `go.sum` records hashes of dependency contents, verified against the checksum database for integrity.

Minimal Version Selection: each module lists the minimum version it needs of each dependency. The build uses, for each module, the maximum of those minimums. It never picks a newer release automatically. This makes builds reproducible without a lock file and resolution fast and predictable. You upgrade explicitly with `go get pkg@version` or `go get -u`.

Semantic import versioning: major versions 2+ have a different path (`example.com/lib/v2`), so different majors can coexist.

```bash
go mod init example.com/app
go get github.com/google/uuid@v1.6.0
go mod tidy
go list -m -u all     # show available upgrades
```

Related: `GOPROXY` (module proxy), `GOPRIVATE` (skip proxy/checksum DB for private code), `go work` workspaces for multi-module development, and `govulncheck` for vulnerability scanning.

### What is the package initialisation order, and what are init functions for?
<!-- level: intermediate; kind: concept; ref: https://go.dev/ref/spec#Package_initialization -->
When a program starts:
1. Imported packages are initialised first, recursively, so each package is initialised after everything it imports. Each package is initialised only once, even if imported many times.
2. Within a package, package-level variables are initialised in dependency order (a variable is initialised after the variables it refers to), otherwise in declaration order across files as presented to the compiler.
3. Then the package's `init()` functions run, in the order they appear (a file may have several).
4. Finally `main.main` runs.

```go
var defaultTZ = mustLoad("UTC") // runs before init

func init() {
    sql.Register("mydriver", &Driver{}) // registration side effect
}
```

Legitimate uses of `init`: registering drivers, codecs or image formats with a registry (`database/sql`, `image/png`), and computing complex package-level tables. Blank imports (`import _ "github.com/lib/pq"`) exist to trigger such side effects.

Avoid heavy `init` logic: it cannot return errors, runs during tests and tooling, makes startup order implicit, and complicates testing. Prefer explicit constructors called from `main`.

### What are sync.WaitGroup, sync.Once and sync.Pool used for?
<!-- level: intermediate; kind: concept; ref: https://pkg.go.dev/sync -->
WaitGroup waits for a set of goroutines to finish: `Add` before starting, `Done` when finished, `Wait` to block. Go 1.25 added `wg.Go(func())`, which does Add/Done for you. It does not propagate errors; use `errgroup` for that.

Once guarantees a function runs exactly once across goroutines, used for lazy initialisation and idempotent `Close`. Go 1.21 added `sync.OnceFunc`, `OnceValue` and `OnceValues`, which wrap the pattern and cache results (including errors).

Pool is a cache of reusable temporary objects (buffers, encoders) to reduce allocation and GC pressure. It is per-P for speed and is cleared gradually by the GC, so it must not be used for objects that need to persist (like connections).

```go
var bufs = sync.Pool{New: func() any { return new(bytes.Buffer) }}

var cfg = sync.OnceValue(func() *Config { return mustLoad("app.yaml") })

func handle() {
    b := bufs.Get().(*bytes.Buffer)
    b.Reset()
    defer bufs.Put(b)
    _ = cfg().Port
}

var wg sync.WaitGroup
for _, j := range jobs {
    wg.Go(func() { run(j) }) // Go 1.25
}
wg.Wait()
```

None of these may be copied after first use; `go vet` checks for it.

### What are range-over-func iterators (Go 1.23)?
<!-- level: advanced; kind: concept; ref: https://go.dev/blog/range-functions -->
Go 1.23 allows `for range` over functions of the forms `func(yield func() bool)`, `func(yield func(V) bool)` and `func(yield func(K, V) bool)`. The `iter` package names the common ones `iter.Seq[V]` and `iter.Seq2[K, V]`.

The iterator pushes values by calling `yield`. If the loop body breaks or returns, `yield` returns false and the iterator must stop. The compiler transforms the loop body into the yield function and preserves the semantics of `break`, `continue`, `return`, `goto` and `defer`.

```go
func Evens(limit int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < limit; i += 2 {
            if !yield(i) {
                return
            }
        }
    }
}

for n := range Evens(100) {
    if n > 10 { break }
    fmt.Println(n)
}

keys := slices.Sorted(maps.Keys(m)) // standard iterator helpers
```

Benefits: a uniform way to expose sequences from custom containers, lazy pipelines without intermediate slices, and early termination. `iter.Pull` converts push iterators into pull-style `next/stop` functions when you need to consume two sequences in lockstep. The standard library added many iterator functions (`slices.All`, `maps.Keys`, `strings.SplitSeq`/`Lines` in 1.24).

Pitfall: calling yield after it returned false panics.

### How do you write tests, benchmarks and fuzz tests in Go?
<!-- level: basic; kind: concept; ref: https://pkg.go.dev/testing -->
Testing is built in. Files ending in `_test.go` hold:
- Tests: `func TestX(t *testing.T)`, using `t.Errorf`/`t.Fatalf`. Idiomatic style is table-driven tests with `t.Run` subtests.
- Benchmarks: `func BenchmarkX(b *testing.B)`. Since Go 1.24, write `for b.Loop() { ... }`; run with `go test -bench=. -benchmem` and compare runs with `benchstat`.
- Fuzz tests (Go 1.18): `func FuzzX(f *testing.F)` with seed inputs and property checks; run with `go test -fuzz=FuzzX`. Failures are saved under `testdata/fuzz` as regression cases.
- Examples: `func ExampleX()` with `// Output:` comments, verified by `go test` and shown in documentation.

```go
func TestSlug(t *testing.T) {
    cases := []struct{ in, want string }{
        {"Hello World", "hello-world"},
        {"  Go  ", "go"},
    }
    for _, c := range cases {
        t.Run(c.in, func(t *testing.T) {
            if got := Slug(c.in); got != c.want {
                t.Errorf("Slug(%q) = %q, want %q", c.in, got, c.want)
            }
        })
    }
}
```

Useful flags and helpers: `-race`, `-cover`/`-coverprofile`, `-run`, `-count=1` (disable caching), `-shuffle=on`, `t.Parallel`, `t.Cleanup`, `t.TempDir`, `t.Context` (1.24), `net/http/httptest`, and `testing/synctest` (Go 1.25) for time-dependent concurrent code.
