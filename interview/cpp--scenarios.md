# C++ scenario questions

### Your program works in Debug builds but crashes or gives wrong results in Release. How do you approach it?
<!-- level: intermediate; kind: scenario; ref: https://en.cppreference.com/w/cpp/language/ub -->
Answer: this pattern almost always points to undefined behaviour that the optimiser exploits, not to a compiler bug.

1. Observe: capture the exact failure (crash address, wrong output) and whether it is deterministic. Build Release with debug info (`-O2 -g` or RelWithDebInfo) so you can get a meaningful stack trace.
2. Hypothesise: the usual suspects are uninitialised variables (Debug builds often zero-fill or pattern-fill memory), out-of-bounds access, signed overflow used in loop conditions, dangling references, strict aliasing violations, and data races that timing hides in Debug.
3. Verify: build the optimised configuration with `-fsanitize=address,undefined` and run the failing scenario. Turn on `-Wall -Wextra -Wuninitialized -Wmaybe-uninitialized`; compilers often warn about exactly this. If threads are involved, run a ThreadSanitizer build. Bisecting with optimisation flags (`-O1`, `-fno-strict-aliasing`, `-fwrapv`) can narrow the category.
4. Fix the root cause, for example initialise members with default member initialisers, replace pointer punning with `std::bit_cast` or `memcpy`, use `std::cmp_less` or wider types for overflow checks.
5. Prevent: run sanitizer builds of the test suite in CI, treat warnings as errors, and add a regression test.

Common wrong answer: "disable optimisations for that file" or "add `volatile`". That hides the bug until the next compiler upgrade.

### A C++ service segfaults in production a few times a day. You have core dumps. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://sourceware.org/gdb/current/onlinedocs/gdb.html/ -->
Answer:

1. Observe: make sure the build ships with separate debug symbols (`-g` split into `.debug` files or a symbol server) so cores can be symbolised. Collect several cores and correlate with logs, request types, deploy versions and load.
2. Inspect the core:

```bash
gdb ./order-service core.12345
(gdb) bt full            # stack with locals
(gdb) info threads
(gdb) thread apply all bt
(gdb) frame 3
(gdb) print *session
```

3. Hypothesise from the evidence: a crash in `free`/`malloc` suggests heap corruption that happened earlier (the crash site is not the bug site); a garbage `this` pointer suggests use-after-free; crashes in different places under load suggest a data race.
4. Verify: reproduce in staging with replayed traffic under AddressSanitizer (which reports the original bad write and the free site) or ThreadSanitizer. Add targeted logging or assertions around the suspected object's lifetime.
5. Fix the ownership or synchronisation problem, not just the null check at the crash site.
6. Prevent: enable hardened standard library assertions, add fuzz tests for input parsing, and run sanitizer builds of integration tests.

Trade-off to mention: always-on ASan in production is too costly, but sampling tools like GWP-ASan (low-overhead sampled allocation guards) can catch heap bugs in production.

### Memory usage of a long-running C++ daemon grows steadily until it is OOM-killed. How do you find the cause?
<!-- level: intermediate; kind: scenario; ref: https://clang.llvm.org/docs/LeakSanitizer.html -->
Answer: growth is not always a leak in the strict sense, so separate the cases.

1. Observe: graph RSS over time and against traffic. Linear growth with requests suggests a per-request leak; plateaus suggest caches or allocator fragmentation.
2. Hypothesise:
   - True leaks: raw `new` without `delete`, `shared_ptr` reference cycles, forgotten `release()`.
   - Logical leaks: unbounded caches, maps keyed by session id never cleaned, queues that grow because consumers are slower than producers.
   - Fragmentation: the allocator holds freed memory it cannot return to the OS.
3. Verify:
   - Run tests and a load replay under LeakSanitizer (`-fsanitize=address` includes it) to find unreachable allocations.
   - Use heap profilers (heaptrack, jemalloc or tcmalloc heap profiling, Valgrind massif) to see which call sites own the growing memory.
   - Expose container sizes as metrics.
4. Fix: replace manual memory management with `unique_ptr` and containers, break cycles with `weak_ptr`, bound caches (LRU with max size and TTL), add back-pressure to queues. For fragmentation, try jemalloc/mimalloc or pool allocators.

```cpp
struct Node { std::shared_ptr<Node> parent; std::vector<std::shared_ptr<Node>> children; }; // cycle
struct FixedNode { std::weak_ptr<FixedNode> parent; std::vector<std::shared_ptr<FixedNode>> children; };
```

5. Prevent: LSan in CI, memory metrics with alerts, and code review rules against owning raw pointers.

### Under load, a multithreaded C++ service occasionally returns wrong totals, but you can never reproduce it locally. What next?
<!-- level: advanced; kind: scenario; ref: https://clang.llvm.org/docs/ThreadSanitizer.html -->
Answer: intermittent wrong results that depend on load are a strong signal of a data race or a race condition.

1. Observe: log inputs and outputs for wrong results; check whether errors correlate with concurrency (core count, request rate).
2. Hypothesise: shared mutable state accessed without synchronisation, such as a plain `int` counter, a `std::unordered_map` read while another thread inserts (rehash), a lazily initialised member, or a check-then-act sequence split across two locks.
3. Verify: build with ThreadSanitizer and run a concurrent stress test. TSan reports both conflicting accesses with stack traces. Code review all state reachable from multiple threads: globals, statics, singletons, objects captured by reference in thread lambdas.
4. Fix: protect the state with a mutex covering the whole invariant, make it atomic if it is a single value, or restructure so threads do not share mutable state (per-thread accumulation, then merge).

```cpp
// Before: data race
totals[region] += amount;

// After: lock covers the whole read-modify-write
{
    std::lock_guard lock(totals_mutex_);
    totals_[region] += amount;
}
```

5. Prevent: TSan job in CI with stress tests, document thread-safety of each class, and prefer immutable data plus message passing.

Common wrong answers: adding `volatile`, adding sleeps, or making each individual operation atomic while the multi-step logic remains racy.

### Your server occasionally freezes completely with low CPU usage. You suspect a deadlock. How do you confirm and fix it?
<!-- level: advanced; kind: scenario; ref: https://en.cppreference.com/w/cpp/thread/scoped_lock -->
Answer:

1. Observe: low CPU plus no progress suggests threads blocked on locks or I/O rather than a busy loop. Capture all thread stacks while frozen: `gdb -p <pid> -batch -ex "thread apply all bt"` or `eu-stack`, or a dump on Windows.
2. Hypothesise: look for two or more threads each waiting in `pthread_mutex_lock`/`std::mutex::lock` while holding another lock. Classic causes: inconsistent lock ordering (A then B vs B then A), calling a callback or virtual function while holding a lock that the callback also takes, recursive locking of a non-recursive mutex, or waiting on a future while holding a lock that the task needs.
3. Verify: map each blocked thread to the locks it holds, building the wait-for cycle. ThreadSanitizer also reports lock-order inversions even when the deadlock does not occur in the test.
4. Fix:

```cpp
// Lock both at once with deadlock avoidance
std::scoped_lock lock(a.mutex, b.mutex);

// Or never call out while locked
std::vector<Listener*> copy;
{ std::lock_guard g(m_); copy = listeners_; }
for (auto* l : copy) l->on_change();
```

5. Prevent: define a lock hierarchy, keep critical sections small, avoid holding locks during I/O or callbacks, and add watchdog health checks that detect stalls and dump stacks automatically.

Trade-off: replacing locks with lock-free structures removes deadlocks but introduces much harder correctness problems; it is rarely the first fix.

### After upgrading the compiler, a well-tested numerical function starts returning different results. Who is wrong?
<!-- level: advanced; kind: scenario; ref: https://en.cppreference.com/w/cpp/language/ub -->
Answer: assume your code first. Compiler bugs exist but are rare; new optimisations exposing existing UB are common.

1. Observe: find the smallest input that changes and the smallest function involved. Compare with `-O0` on the new compiler.
2. Hypothesise:
   - UB the new optimiser exploits: signed overflow in loop counters, uninitialised values, aliasing violations, out-of-bounds reads.
   - Legitimate floating-point differences: different instruction selection (FMA contraction, vectorised reductions reordering additions), `-ffast-math`, or x87 vs SSE.
   - Changed implementation-defined or unspecified behaviour such as argument evaluation order.
3. Verify: run UBSan and ASan. Toggle flags: `-fwrapv`, `-fno-strict-aliasing`, `-ffp-contract=off`. If a flag changes the result, you have found the category. Reduce a test case (C-Reduce or cvise) and compare on Compiler Explorer across versions.
4. Fix: remove the UB (wider types, explicit overflow checks, `std::bit_cast`), or, for floating point, decide what tolerance is acceptable and compare with an epsilon rather than bit-exact equality. If bit-reproducibility is required, pin flags like `-ffp-contract=off` and avoid fast-math.
5. If it really is a compiler bug, file a reduced report and work around it locally with a comment and a test.

Interview insight: show you understand that "it worked before" does not mean the code was correct.

### A junior developer stores pointers to elements of a std::vector and the program crashes later. Explain and fix.
<!-- level: basic; kind: scenario; ref: https://en.cppreference.com/w/cpp/container/vector -->
Answer:

1. Observe: crashes or garbage values appear after more items are added to the vector; ASan reports heap-use-after-free pointing at a `push_back`.
2. Hypothesise: `std::vector` stores elements contiguously. When `size()` exceeds `capacity()`, it allocates a new buffer, moves elements over and frees the old one. All pointers, references and iterators into the old buffer now dangle.

```cpp
std::vector<Player> players;
std::vector<Player*> team_a;
players.push_back(alice);
team_a.push_back(&players.back());
players.push_back(bob);        // may reallocate: team_a[0] dangles
```

3. Verify: print `capacity()` before and after, or run under ASan.
4. Fix, depending on the need:
   - Store indices or stable ids instead of pointers.
   - Use a container with stable addresses: `std::deque` (for push at ends), `std::list`, `std::map`, or `std::vector<std::unique_ptr<Player>>`.
   - If the final size is known, `reserve` up front, but only as a documented invariant.
   - C++26 `std::hive` provides stable references with good iteration performance.
5. Prevent: code review guidance on iterator invalidation, debug iterator modes (`_GLIBCXX_DEBUG`) in test builds.

Trade-off: `vector<unique_ptr<T>>` keeps stable addresses but loses contiguity and costs one allocation per element; indices keep cache-friendliness but need care when erasing.

### A hot loop processing millions of particles is slow. Profiling shows high cache-miss rates. What can you change?
<!-- level: advanced; kind: scenario; ref: https://en.cppreference.com/w/cpp/container/vector -->
Answer:

1. Observe: measure with a sampling profiler (perf, VTune, Visual Studio profiler) and hardware counters (`perf stat -e cache-misses,instructions`). Confirm the loop is memory-bound rather than compute-bound.
2. Hypothesise: common culprits are pointer chasing (`std::vector<std::unique_ptr<Particle>>`, linked lists, virtual objects scattered on the heap), large structs where the loop uses only a few fields (array of structs), and branches that defeat vectorisation.
3. Verify: experiment with a microbenchmark (Google Benchmark) comparing layouts.
4. Fix:

```cpp
// Array of structs: loop touching only position drags the whole 128-byte struct into cache
struct Particle { Vec3 pos, vel; Color c; std::string name; /* ... */ };

// Struct of arrays: tightly packed, vectorisable
struct Particles {
    std::vector<float> x, y, z, vx, vy, vz;
    void step(float dt) {
        for (std::size_t i = 0; i < x.size(); ++i) {
            x[i] += vx[i] * dt; y[i] += vy[i] * dt; z[i] += vz[i] * dt;
        }
    }
};
```

   Also store objects by value in contiguous containers, replace virtual dispatch over mixed types with separate homogeneous arrays, hoist allocations out of the loop, and let the compiler vectorise (`-O3 -march=native` where acceptable).
5. Prevent regressions with benchmarks in CI.

Trade-off: SoA improves throughput for bulk operations but makes per-object code clumsier; it is worth it in measured hot paths only.

### A large C++ project takes 40 minutes to build. How would you reduce build times?
<!-- level: intermediate; kind: scenario; ref: https://cmake.org/cmake/help/latest/command/target_precompile_headers.html -->
Answer:

1. Observe: measure where time goes. Use Clang's `-ftime-trace` with ClangBuildAnalyzer, MSVC's Build Insights, or Ninja's `.ninja_log`. Find the heaviest headers, the slowest TUs and serialisation in the dependency graph.
2. Hypothesise: typical causes are heavy headers included everywhere (`<windows.h>`, Boost, a giant "common.h"), template-heavy code instantiated in every TU, unnecessary includes, and a link step dominated by huge static libraries.
3. Fix, in increasing effort:
   - Use a compiler cache (ccache/sccache) and distributed builds where available.
   - Use Ninja and full parallelism; split monolithic libraries so targets build concurrently.
   - Remove unused includes (include-what-you-use), forward-declare types in headers, and use the pimpl idiom for classes with heavy private dependencies.
   - Precompiled headers for stable third-party headers.
   - `extern template` for common instantiations.
   - Faster linkers (lld or mold) and incremental linking.
   - Modules (C++20) for long-term structural gains where the toolchain supports them.

```cmake
target_precompile_headers(core PRIVATE <vector> <string> <unordered_map> <fmt/format.h>)
```

4. Verify each change against the baseline trace.
5. Prevent: track build time in CI and flag headers whose include count or parse time spikes.

Trade-off: unity builds speed full rebuilds but can hide missing includes and slow incremental builds.

### After moving a template's implementation to a .cpp file you get "undefined reference" linker errors. Later a helper in a header causes "multiple definition". Explain both.
<!-- level: basic; kind: scenario; ref: https://en.cppreference.com/w/cpp/language/definition -->
Answer: both are about the One Definition Rule and separate compilation.

Undefined reference:

1. Observe: the compiler is happy, the linker says `undefined reference to Cache<std::string>::get(...)`.
2. Hypothesise: templates are instantiated where they are used. The TU that calls `Cache<std::string>::get` sees only the declaration, and `cache.cpp` never instantiated that specialisation, so no object file defines the symbol.
3. Fix: move the definitions back into the header, or add explicit instantiations in `cache.cpp`:

```cpp
template class Cache<std::string>;   // in cache.cpp
```

Multiple definition:

1. Observe: `multiple definition of format_price(double)` at link time.
2. Hypothesise: a non-inline function (or global variable) is defined in a header included by several TUs, so each object file contains its own definition.
3. Fix: declare in the header and define in one `.cpp`, or mark the function `inline` (and globals `inline` in C++17). Constants can be `inline constexpr`.

```cpp
inline std::string format_price(double p) { return std::format("{:.2f}", p); }
inline constexpr int kMaxRetries = 5;
```

Prevention: understand that headers are pasted textually; anything defined there must be inline, a template, or a class definition. Watch for missing library order or missing `target_link_libraries` too, which cause the same undefined reference symptom.

### The application crashes only during shutdown. How do you investigate?
<!-- level: advanced; kind: scenario; ref: https://isocpp.org/wiki/faq/ctors#static-init-order -->
Answer: shutdown crashes usually come from destruction order or lingering threads.

1. Observe: get the stack trace of the crash (core dump or debugger). Note whether it happens after `main` returns, during `exit()`, or in a background thread.
2. Hypothesise:
   - Static destruction order: global or function-local static objects in different TUs are destroyed in reverse order of construction, which is not controllable across TUs. A logger destroyed before another static's destructor logs leads to use-after-free.
   - Detached or never-joined threads still running while globals are destroyed.
   - Callbacks registered with a library that fires after your objects are gone.
   - `std::thread` destroyed while joinable calls `std::terminate`.
3. Verify: run under ASan, which reports use-after-free with the free site in a static destructor. Log in destructors of global singletons.
4. Fix:
   - Make shutdown explicit: stop and join all threads before `main` returns (`std::jthread` helps).
   - Avoid non-trivial global objects; create services in `main` and pass them down.
   - For singletons that must outlive everything, intentionally leak them (`static Logger& l = *new Logger;`) so they are never destroyed.
   - Unregister callbacks in destructors.

```cpp
Logger& logger() {
    static Logger* instance = new Logger("app.log");  // never destroyed by design
    return *instance;
}
```

5. Prevent: test shutdown paths in CI with sanitizers and keep an explicit, ordered shutdown sequence.

### A graph of nodes held by shared_ptr never frees its memory. What is happening and how do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://en.cppreference.com/w/cpp/memory/weak_ptr -->
Answer:

1. Observe: memory grows; LeakSanitizer reports leaked `Node` objects whose allocations come from `make_shared`.
2. Hypothesise: reference cycles. Each `shared_ptr` keeps its target alive; if A points to B and B points back to A (parent/child links, observers holding subjects, a lambda stored in an object that captures a `shared_ptr` to that same object), the counts never reach zero even after outside references disappear.
3. Verify: inspect `use_count()` in a debugger after the graph should be gone, or draw the ownership graph for the type.
4. Fix: decide the ownership direction. Owners hold `shared_ptr` (or `unique_ptr`), back-references and observers hold `weak_ptr` or raw non-owning pointers.

```cpp
struct TreeNode {
    std::vector<std::unique_ptr<TreeNode>> children;  // parent owns children
    TreeNode* parent = nullptr;                        // non-owning back-pointer
};

class Downloader : public std::enable_shared_from_this<Downloader> {
    void start() {
        auto weak = weak_from_this();
        client_.on_done([weak](Result r) {             // no self-cycle
            if (auto self = weak.lock()) self->finish(r);
        });
    }
};
```

For general graphs with arbitrary cycles, store nodes in an arena or `std::vector` and use indices for edges; the arena owns everything and frees it at once.

5. Prevent: review rule that shared ownership must be justified; prefer unique ownership plus non-owning references.

### Production logs show "terminate called without an active exception" or "terminate called after throwing". What could cause std::terminate?
<!-- level: intermediate; kind: scenario; ref: https://en.cppreference.com/w/cpp/error/terminate -->
Answer: `std::terminate` runs in a handful of specific situations, so enumerate and check them.

1. Observe: get the stack from a core dump; set a `std::set_terminate` handler that logs a stack trace (C++23 `std::stacktrace::current()`) before aborting.
2. Hypothesise the causes:
   - A `std::thread` destroyed while still joinable ("without an active exception").
   - An exception escaping a `noexcept` function, including destructors (implicitly noexcept).
   - An exception thrown during stack unwinding from another exception.
   - An exception escaping `main` or a thread's entry function.
   - Rethrowing with `throw;` when no exception is active.
3. Verify by matching the stack to one of the causes.
4. Fix:

```cpp
// Thread not joined on an error path -> use jthread
std::jthread worker(process_batch, std::ref(batch));

// Thread entry: never let exceptions escape
void entry() {
    try { run(); }
    catch (const std::exception& e) { log_error(e.what()); }
}

// Destructor: swallow and log
~Connection() {
    try { close(); } catch (...) { log_error("close failed"); }
}
```

5. Prevent: wrap all thread entry points, use RAII thread types, audit `noexcept` functions that call throwing code, and keep the terminate handler for diagnostics.

Common wrong answer: wrapping `main` in `catch (...)`, which does not help exceptions in other threads or noexcept functions.

### A callback registered by an object crashes intermittently after that object is deleted. How do you make it safe?
<!-- level: intermediate; kind: scenario; ref: https://en.cppreference.com/w/cpp/memory/enable_shared_from_this -->
Answer:

1. Observe: ASan shows heap-use-after-free inside a lambda body, with the free coming from the object's destructor.
2. Hypothesise: the lambda captured `this` (or locals by reference) and was stored in a timer, event loop, or network library that invokes it after the object died.

```cpp
void Uploader::start() {
    timer_.on_timeout([this] { retry(); });   // raw this, no lifetime guarantee
}
```

3. Verify by checking the order of destruction vs callback execution in logs.
4. Fix options:
   - Cancel or unregister callbacks in the destructor, ideally with an RAII subscription handle whose destructor unregisters. This only works if the library guarantees no in-flight callback runs afterwards (careful with multiple threads).
   - Capture a `weak_ptr` and lock it when the callback runs:

```cpp
void Uploader::start() {
    timer_.on_timeout([weak = weak_from_this()] {
        if (auto self = weak.lock()) self->retry();
    });
}
```

   - Capture a `shared_ptr` (`shared_from_this()`) if the callback should keep the object alive until it runs, being careful not to create cycles.
   - Capture needed data by value instead of `this`.
5. Prevent: ban `[&]` and raw `[this]` in asynchronous callbacks via review guidelines or clang-tidy checks, and document lifetimes of callback registrations.

Trade-off: the weak_ptr pattern requires the object to be owned by a `shared_ptr`; subscription handles avoid that but need careful threading.

### In code review you see a class with a raw owning pointer member, a destructor that deletes it, and no copy constructor. What is the problem?
<!-- level: basic; kind: scenario; ref: https://en.cppreference.com/w/cpp/language/rule_of_three -->
Answer: this violates the rule of three and causes double frees.

1. Observe the code:

```cpp
class Buffer {
public:
    explicit Buffer(std::size_t n) : data_(new char[n]), n_(n) {}
    ~Buffer() { delete[] data_; }
private:
    char* data_; std::size_t n_;
};

Buffer a(1024);
Buffer b = a;   // implicit copy: b.data_ == a.data_
// both destructors delete[] the same pointer -> double free
```

2. Hypothesise effects: double free (crash or heap corruption), use-after-free if one copy outlives the other, and leaks on copy assignment (the old buffer is overwritten without being freed). Moves silently degrade to these broken copies because declaring a destructor suppresses implicit move operations.
3. Fix, preferably via rule of zero:

```cpp
class Buffer {
public:
    explicit Buffer(std::size_t n) : data_(n) {}
private:
    std::vector<char> data_;          // copy, move, destroy all correct
};
// or std::unique_ptr<char[]> data_; if the type should be move-only
```

If a raw resource must be wrapped manually, implement all five special members (or delete copying) and mark moves `noexcept`.
4. Prevent: enable clang-tidy `cppcoreguidelines-special-member-functions` and `cppcoreguidelines-owning-memory`, and add a review rule: no `delete` outside resource wrapper classes.

Interview bonus: mention that the compiler-generated copy is a shallow memberwise copy, which is wrong for owning raw pointers.

### A security audit finds that an image decoder can be crashed by a crafted file. How do you fix and harden it?
<!-- level: advanced; kind: scenario; ref: https://llvm.org/docs/LibFuzzer.html -->
Answer: treat this as a probable memory-safety vulnerability (potentially exploitable), not just a crash.

1. Observe: reproduce with the crafted file under ASan + UBSan to get the exact bad read or write.
2. Hypothesise typical decoder bugs: integer overflow in size computations (`width * height * channels` overflowing 32 bits, leading to a small allocation and a large write), trusting length fields from the file, signed/unsigned confusion, and unchecked offsets.

```cpp
// Vulnerable
uint32_t size = hdr.width * hdr.height * 4;     // can wrap
auto* pixels = new uint8_t[size];
read_rows(file, pixels, hdr.height, hdr.width * 4);

// Fixed
constexpr std::uint64_t kMaxPixels = 100'000'000;
std::uint64_t px = std::uint64_t{hdr.width} * hdr.height;
if (hdr.width == 0 || hdr.height == 0 || px > kMaxPixels) throw DecodeError("bad dimensions");
std::vector<std::uint8_t> pixels(px * 4);
```

3. Verify the fix with the reproducer and add it to a regression corpus.
4. Harden more broadly:
   - Fuzz the decoder continuously with libFuzzer or AFL++ plus sanitizers (OSS-Fuzz style).
   - Use bounds-checked access (`std::span`, hardened standard library, `at()` in parsing code).
   - Validate every field from untrusted input before use; centralise checked arithmetic.
   - Run the decoder in a sandboxed process with minimal privileges.
5. Prevent: compiler hardening flags (`-D_FORTIFY_SOURCE=3`, stack protector, CFI), and consider a memory-safe language for new parsers of untrusted data.

### Design a thread-safe in-memory LRU cache in C++. What trade-offs do you consider?
<!-- level: advanced; kind: scenario; ref: https://en.cppreference.com/w/cpp/container/list/splice -->
Answer:

1. Requirements: `get(key)` and `put(key, value)` in O(1), fixed capacity with LRU eviction, safe from many threads.
2. Core structure: a `std::list` of (key, value) ordered by recency plus an `std::unordered_map` from key to list iterator. `splice` moves a node to the front in O(1) without invalidating iterators.

```cpp
template <typename K, typename V>
class LruCache {
public:
    explicit LruCache(std::size_t cap) : cap_(cap) {}

    std::optional<V> get(const K& k) {
        std::lock_guard lock(m_);
        auto it = index_.find(k);
        if (it == index_.end()) return std::nullopt;
        items_.splice(items_.begin(), items_, it->second);   // mark recent
        return it->second->second;                           // copy out under lock
    }

    void put(K k, V v) {
        std::lock_guard lock(m_);
        if (auto it = index_.find(k); it != index_.end()) {
            it->second->second = std::move(v);
            items_.splice(items_.begin(), items_, it->second);
            return;
        }
        items_.emplace_front(k, std::move(v));
        index_[std::move(k)] = items_.begin();
        if (items_.size() > cap_) {
            index_.erase(items_.back().first);
            items_.pop_back();
        }
    }
private:
    std::mutex m_;
    std::size_t cap_;
    std::list<std::pair<K, V>> items_;
    std::unordered_map<K, typename std::list<std::pair<K, V>>::iterator> index_;
};
```

3. Trade-offs:
   - A single mutex is simple but contended; even `get` writes (recency), so a reader-writer lock does not help. Shard into N caches by key hash to scale.
   - Return copies (or `shared_ptr<const V>`) rather than references, which would dangle after eviction.
   - Approximate LRU (sampled eviction, CLOCK) reduces bookkeeping in high-throughput caches.
   - Consider TTLs and memory-based capacity rather than entry count.

### A trading system has rare latency spikes of several milliseconds. You suspect memory allocation. How do you confirm and fix?
<!-- level: advanced; kind: scenario; ref: https://en.cppreference.com/w/cpp/memory/polymorphic_allocator -->
Answer:

1. Observe: record latency histograms (p99, p99.9, max), not averages. Correlate spikes with events: GC-like pauses do not exist in C++, so look at allocation, page faults, logging, lock contention, and OS scheduling.
2. Hypothesise: `malloc` occasionally takes a slow path (lock contention between threads, requesting memory from the OS via `mmap`, page faults on first touch), containers reallocating (`vector` growth, `unordered_map` rehash), `std::string` building in log statements, or `shared_ptr` atomic contention.
3. Verify: count allocations on the hot path (override `operator new` in a test build, use heaptrack or `perf` probes on malloc), and check page-fault counters during spikes.
4. Fix:
   - Preallocate: `reserve` containers, pool and reuse message objects, warm up and touch memory at startup (and lock it with `mlock`).
   - Use arena or monotonic allocators via `std::pmr`:

```cpp
std::array<std::byte, 64 * 1024> buf;
std::pmr::monotonic_buffer_resource arena(buf.data(), buf.size());
std::pmr::vector<Order> batch(&arena);   // no heap calls until buf exhausted
```

   - Switch to a scalable allocator (jemalloc, mimalloc, tcmalloc) with per-thread caches.
   - Move logging off the hot path (pre-formatted binary logging to a ring buffer).
   - Pin threads to cores and isolate them from OS noise.
5. Prevent: an allocation-counting test that fails if the hot path allocates.

### You are asked to modernise a legacy C++98 codebase. How do you plan it?
<!-- level: intermediate; kind: scenario; ref: https://clang.llvm.org/extra/clang-tidy/checks/list.html -->
Answer: aim for incremental, test-protected improvements rather than a big-bang rewrite.

1. Observe: measure the current state: compiler versions, build system, test coverage, crash reports, hot spots of bugs.
2. Establish a safety net: get it building with a modern compiler at `-std=c++17` or later, enable warnings, add characterisation tests around risky modules, and add sanitizer builds to CI.
3. Prioritise by risk and value:
   - Ownership: replace manual `new`/`delete` with `std::unique_ptr` and containers; replace `char*` string handling with `std::string`/`std::string_view`.
   - Correctness: `override`, `nullptr`, `enum class`, `= delete` for non-copyable types.
   - Readability: `auto`, range-for, lambdas instead of functors, structured bindings.
   - Build: move to target-based CMake, add a package manager.
4. Automate mechanical changes with clang-tidy `modernize-*` fixes, reviewed in small PRs:

```bash
run-clang-tidy -checks='-*,modernize-use-nullptr,modernize-use-override,modernize-loop-convert' -fix src/
```

5. Verify each step with tests, sanitizers and performance benchmarks.
6. Prevent regression: coding guidelines (C++ Core Guidelines subset), clang-tidy in CI, and a "boy scout" rule for touched code.

Trade-offs: modernising ABI-visible interfaces may break plugins or clients; keep stable C or pimpl boundaries. Avoid rewriting stable, rarely touched code just for style.

### A minor update of your shared library makes existing client applications crash, even though the API did not change. Why?
<!-- level: advanced; kind: scenario; ref: https://en.cppreference.com/w/cpp/language/pimpl -->
Answer: the ABI (binary interface) changed even though the source-level API did not.

1. Observe: clients were compiled against the old headers and linked dynamically against the new `.so`/`.dll`. Crashes appear in seemingly unrelated code.
2. Hypothesise ABI breaks:
   - Adding, removing or reordering data members changes `sizeof` and member offsets; clients allocate the old size inline.
   - Adding or reordering virtual functions shifts vtable slots.
   - Changing inline functions or templates in headers: clients keep the old inlined code.
   - Changing default arguments, enum values, or compiler/standard library versions and flags (e.g. `_GLIBCXX_USE_CXX11_ABI`, debug vs release CRT on Windows).
3. Verify: compare old and new libraries with `abi-compliance-checker`/`libabigail` (`abidiff`).
4. Fix: restore the old layout or bump the major version (soname) so clients must rebuild.
5. Prevent with a stable ABI design:

```cpp
// widget.h - pimpl keeps layout private
class Widget {
public:
    Widget();
    ~Widget();
    void draw();
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;   // size never changes
};
```

   Also: only append virtual functions (or avoid them in public interfaces), avoid exposing STL types across DLL boundaries on Windows, consider a C API with opaque handles for maximum stability, and run ABI checks in CI.

Trade-off: pimpl costs an allocation and an indirection per call but buys binary compatibility and faster client builds.

### Resizing a std::vector of your own type is unexpectedly slow, even though the type has a move constructor. Why?
<!-- level: intermediate; kind: scenario; ref: https://en.cppreference.com/w/cpp/utility/move_if_noexcept -->
Answer:

1. Observe: a profiler shows time in the copy constructor during `push_back` reallocations.
2. Hypothesise: `std::vector` guarantees that `push_back` either succeeds or leaves the vector unchanged (strong guarantee). When it reallocates, it moves existing elements only if the move constructor is `noexcept` (or the type is not copyable). If moving could throw halfway, the old buffer would already be partly gutted, so it copies instead via `std::move_if_noexcept`.

```cpp
struct Record {
    Record(Record&& other) : name(std::move(other.name)) {}   // not noexcept -> copied
    Record(const Record&) = default;
    std::string name;
    std::vector<double> values;
};
```

3. Verify: `static_assert(std::is_nothrow_move_constructible_v<Record>);` fails.
4. Fix: mark the move constructor and move assignment `noexcept`, or better, delete the hand-written ones so the defaulted versions are generated (they are noexcept if all members' moves are).

```cpp
struct Record {
    std::string name;
    std::vector<double> values;   // rule of zero: implicit noexcept moves
};
```

   Also `reserve` when the final size is known.
5. Prevent: add `static_assert`s for nothrow movability on types stored in containers, and the clang-tidy check `performance-noexcept-move-constructor`.

Another hidden cause: a user-declared destructor suppresses implicit move operations entirely, making every "move" a copy.

### Implement a bounded producer-consumer pipeline with graceful shutdown. What does your design look like?
<!-- level: advanced; kind: scenario; ref: https://en.cppreference.com/w/cpp/thread/condition_variable -->
Answer:

1. Requirements: multiple producers and consumers, bounded memory (back-pressure when full), and a way to stop that drains or discards pending work deterministically.
2. Design: a queue protected by a mutex with two condition variables (not-full, not-empty) and a `closed` flag.

```cpp
template <typename T>
class BoundedQueue {
public:
    explicit BoundedQueue(std::size_t cap) : cap_(cap) {}

    bool push(T v) {
        std::unique_lock lock(m_);
        not_full_.wait(lock, [&] { return closed_ || q_.size() < cap_; });
        if (closed_) return false;
        q_.push(std::move(v));
        not_empty_.notify_one();
        return true;
    }

    std::optional<T> pop() {
        std::unique_lock lock(m_);
        not_empty_.wait(lock, [&] { return closed_ || !q_.empty(); });
        if (q_.empty()) return std::nullopt;          // closed and drained
        T v = std::move(q_.front()); q_.pop();
        not_full_.notify_one();
        return v;
    }

    void close() {
        { std::lock_guard lock(m_); closed_ = true; }
        not_full_.notify_all(); not_empty_.notify_all();
    }
private:
    std::mutex m_;
    std::condition_variable not_full_, not_empty_;
    std::queue<T> q_;
    std::size_t cap_;
    bool closed_ = false;
};
```

3. Consumers loop `while (auto job = q.pop()) process(*job);` in `std::jthread`s; shutdown calls `close()` and lets jthreads join.
4. Trade-offs: blocking producers provides back-pressure but can stall callers; alternatives are `try_push` with drop or timeout. A lock-free ring buffer gives lower latency for single-producer/single-consumer but is harder to verify.
5. Verify with TSan and stress tests including shutdown under load.

### A loop that iterates backwards over a vector never terminates or crashes. What is wrong?
<!-- level: basic; kind: scenario; ref: https://en.cppreference.com/w/cpp/utility/intcmp -->
Answer:

1. Observe the code:

```cpp
for (std::size_t i = v.size() - 1; i >= 0; --i) {   // i >= 0 is always true
    process(v[i]);
}
```

2. Hypothesise: `std::size_t` is unsigned. `i >= 0` is always true, and decrementing past 0 wraps to the maximum value, so the loop reads far out of bounds. If `v` is empty, `v.size() - 1` already wraps on the first iteration.
3. Verify: compilers warn (`-Wtype-limits`, "comparison is always true"); UBSan will not flag unsigned wrap because it is well defined, but ASan catches the out-of-bounds access.
4. Fix options:

```cpp
for (std::size_t i = v.size(); i-- > 0; ) process(v[i]);

for (auto it = v.rbegin(); it != v.rend(); ++it) process(*it);

for (auto& x : std::views::reverse(v)) process(x);   // C++20
```

   For comparisons between signed and unsigned values, use C++20 `std::cmp_less`/`std::cmp_greater` or `std::ssize(v)` (signed size).
5. Prevent: compile with `-Wall -Wextra -Wsign-compare -Werror`, prefer range-based loops and algorithms over index arithmetic.

Interview insight: mixed signed/unsigned arithmetic is one of the most common C++ bug sources; the committee itself regrets that `size()` returns an unsigned type.

### std::sort crashes with a segmentation fault when sorting with a custom comparator. Why?
<!-- level: intermediate; kind: scenario; ref: https://en.cppreference.com/w/cpp/named_req/Compare -->
Answer:

1. Observe: the crash happens inside `std::sort` internals, only for some inputs (often larger ones with duplicates).
2. Hypothesise: the comparator does not satisfy strict weak ordering, which `std::sort` requires. Classic violations:
   - Using `<=` or `>=`: `comp(a, a)` returns true (must be false).
   - Inconsistent multi-key comparisons, for example comparing by price, then by name only sometimes.
   - Comparisons involving NaN floating-point values.
   - Comparators depending on mutable external state.

Because the implementation assumes the ordering is valid, it may use unguarded loops that walk past the end of the range: undefined behaviour, often a crash.

```cpp
std::sort(v.begin(), v.end(), [](const Item& a, const Item& b) {
    return a.price <= b.price;          // wrong: not irreflexive
});

std::sort(v.begin(), v.end(), [](const Item& a, const Item& b) {
    return std::tie(a.price, a.name) < std::tie(b.price, b.name);   // correct lexicographic
});
std::ranges::sort(v, {}, &Item::price);   // projection, uses std::less
```

3. Verify: debug STL modes (`_GLIBCXX_DEBUG`, MSVC debug) check comparator irreflexivity and report the error; recent libc++ hardening also detects some violations.
4. Fix the comparator; filter or handle NaN explicitly (or use `std::strong_order` for total ordering of floats).
5. Prevent: use `std::tie`/defaulted `<=>` for multi-key ordering and unit-test comparators with duplicates.

### Configuration values read via std::string_view are occasionally garbage. What is the bug?
<!-- level: intermediate; kind: scenario; ref: https://en.cppreference.com/w/cpp/string/basic_string_view -->
Answer:

1. Observe: values look fine immediately after loading but become garbage later; ASan reports heap-use-after-free on reads through a `string_view`.
2. Hypothesise: a `std::string_view` does not own memory. It is valid only while the underlying string is alive and unmodified. Typical mistakes:

```cpp
class Config {
    std::unordered_map<std::string, std::string_view> values_;
public:
    void load(const std::string& path) {
        std::string text = read_file(path);       // local buffer
        for (auto line : split_lines(text))
            values_[key_of(line)] = value_of(line); // views into text
    }                                              // text destroyed: all views dangle
};

std::string_view host = get_env("HOST") + ":443";  // view to a temporary
```

   Also: views into a `std::string` member that later grows (reallocation), or into a vector element that moves.
3. Verify: ASan, or inspect lifetimes: for every stored view, ask "who owns the bytes and do they outlive the view?"
4. Fix: store owning `std::string` values in long-lived structures, and use `string_view` only for parameters and short-lived local processing. If you need views for performance, keep the owning buffer as a member with a stable lifetime and never modify it after creating views.

```cpp
std::unordered_map<std::string, std::string> values_;   // owning
```

5. Prevent: rule of thumb: `string_view` as function parameter, rarely as a member or return type. Clang's `-Wdangling` and lifetime annotations (`[[clang::lifetimebound]]`) catch some cases.

### An invoicing module produces totals that are off by a cent. The amounts are stored as double. What do you do?
<!-- level: basic; kind: scenario; ref: https://en.cppreference.com/w/cpp/types/numeric_limits/epsilon -->
Answer:

1. Observe: reproduce with specific values, for example summing 0.1 ten times does not give exactly 1.0.
2. Hypothesise: binary floating point cannot represent most decimal fractions exactly (0.1 is a repeating binary fraction). Errors accumulate over many additions, and rounding at different steps (per line vs per total) gives different cents.
3. Verify: print with full precision, `std::println("{:.17f}", total);`.
4. Fix: represent money as an integer number of the smallest unit (cents, or micro-units if you need fractional prices), or use a decimal library. Define rounding rules explicitly (banker's rounding vs half-up) and where they apply (per line item or per invoice), matching business and tax requirements.

```cpp
struct Money {
    std::int64_t minor = 0;          // cents
    friend Money operator+(Money a, Money b) { return {a.minor + b.minor}; }
};

Money apply_tax(Money net, int rate_basis_points) {     // 1950 = 19.5%
    __int128 t = static_cast<__int128>(net.minor) * rate_basis_points;  // GCC/Clang extension
    return {static_cast<std::int64_t>((t + 5000) / 10000)};             // half-up rounding
}
```

   Guard against overflow for large totals (check or use 128-bit intermediates as above where supported) and handle currency explicitly.
5. Prevent: a `Money` type that does not implicitly convert from `double`, tests with known tricky values, and documentation of rounding policy.

Common wrong answer: "use `long double`" or "round at display time". That reduces but does not remove the error.

### A plugin registry populated by global objects is sometimes empty when main starts. Why?
<!-- level: advanced; kind: scenario; ref: https://en.cppreference.com/w/cpp/language/siof -->
Answer: this is the static initialisation order fiasco, possibly combined with linker dead-stripping.

1. Observe: plugins register themselves via global objects:

```cpp
// registry.cpp
std::map<std::string, Factory> g_registry;

// csv_plugin.cpp
static bool registered = (g_registry["csv"] = make_csv, true);
```

2. Hypothesise:
   - Order: dynamic initialisation order across translation units is unspecified. If `csv_plugin.cpp` initialises first, it inserts into a `std::map` that has not been constructed yet (UB), and the later construction of `g_registry` wipes it.
   - Dead stripping: if the plugin object file lives in a static library and nothing references its symbols, the linker never pulls it in, so its registration never runs.
3. Verify: log in the registry constructor and in each registration; check link maps or `nm` for plugin symbols.
4. Fix:

```cpp
std::map<std::string, Factory>& registry() {
    static std::map<std::string, Factory> r;   // constructed on first use
    return r;
}
static const bool registered = (registry().emplace("csv", make_csv), true);
```

   For the stripping problem: link plugins as object libraries, use `--whole-archive` (or `/WHOLEARCHIVE`), or replace self-registration with explicit registration calls in `main` (`register_builtin_plugins(registry)`), which is more transparent.
5. Prevent: avoid non-trivial globals; use `constinit` for globals that must be constant-initialised so the compiler errors if they are not.

### You are designing a C++ library used by teams with different error-handling policies. Exceptions or error codes?
<!-- level: intermediate; kind: scenario; ref: https://en.cppreference.com/w/cpp/utility/expected -->
Answer: there is no single right answer; reason from the consumers and failure types.

1. Gather constraints: do any consumers compile with `-fno-exceptions` (games, embedded, some large codebases)? Is the API called across a C or language boundary? Which failures are expected (invalid input, file not found) versus truly exceptional (out of memory, broken invariants)? What are the latency constraints?
2. Options:
   - Exceptions: clean happy-path code, cannot be silently ignored, carry rich context, zero cost on the success path. Costly when thrown, invisible in signatures, unusable for no-exceptions consumers.
   - `std::expected<T, E>` (C++23) or a similar result type: explicit in the type, cheap, composable with `and_then`. More verbose at call sites; errors can propagate only manually.
   - `std::error_code`: interoperates with OS errors; used by `<filesystem>` with dual overloads.
3. A pragmatic design: return `std::expected` for anticipated failures and mark functions `[[nodiscard]]`; reserve exceptions (or `std::terminate`/contracts) for programming errors. Optionally offer throwing convenience wrappers, mirroring `<filesystem>`'s overload pairs.

```cpp
[[nodiscard]] std::expected<Image, DecodeError> decode(std::span<const std::byte> data) noexcept;
Image decode_or_throw(std::span<const std::byte> data);   // throws DecodeException
```

4. Document the policy and keep it consistent across the library.

Common wrong answer: mixing styles arbitrarily, or returning `bool` and logging, which loses error information for callers.

### In an interview you are asked to implement a simplified unique_ptr. What must you get right?
<!-- level: advanced; kind: scenario; ref: https://en.cppreference.com/w/cpp/memory/unique_ptr -->
Answer: the interviewer is checking ownership semantics, move semantics and exception safety.

```cpp
template <typename T>
class UniquePtr {
public:
    UniquePtr() noexcept = default;
    explicit UniquePtr(T* p) noexcept : p_(p) {}
    ~UniquePtr() { delete p_; }

    UniquePtr(const UniquePtr&) = delete;               // exclusive ownership
    UniquePtr& operator=(const UniquePtr&) = delete;

    UniquePtr(UniquePtr&& o) noexcept : p_(std::exchange(o.p_, nullptr)) {}
    UniquePtr& operator=(UniquePtr&& o) noexcept {
        if (this != &o) reset(std::exchange(o.p_, nullptr));
        return *this;
    }

    void reset(T* p = nullptr) noexcept {
        T* old = std::exchange(p_, p);   // update first: safe if ~T re-enters
        delete old;
    }
    T* release() noexcept { return std::exchange(p_, nullptr); }
    T* get() const noexcept { return p_; }
    T& operator*() const { return *p_; }
    T* operator->() const noexcept { return p_; }
    explicit operator bool() const noexcept { return p_ != nullptr; }
private:
    T* p_ = nullptr;
};

template <typename T, typename... Args>
UniquePtr<T> make_unique_ptr(Args&&... args) {
    return UniquePtr<T>(new T(std::forward<Args>(args)...));
}
```

Points to discuss:

- Copy deleted, move transfers and nulls the source; moves are `noexcept`.
- Self-move-assignment safety and the order inside `reset`.
- `explicit` constructor so raw pointers do not convert implicitly.
- Extensions: custom deleter as a template parameter (empty-base or `[[no_unique_address]]` to keep size), array specialisation using `delete[]`, converting moves from `UniquePtr<Derived>`.
- Why `make_unique` matters: exception safety in expressions with multiple allocations (pre-C++17) and no naked `new` in user code.

### A JSON parser crashes with a stack overflow on certain inputs from users. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://en.cppreference.com/w/cpp/container/stack -->
Answer:

1. Observe: the crash stack shows hundreds of thousands of frames of `parse_value` → `parse_array` → `parse_value`. The input contains deeply nested arrays like `[[[[[[...]]]]]]`.
2. Hypothesise: a recursive-descent parser uses one or more stack frames per nesting level. The default thread stack (often 1 MB on Windows, 8 MB on Linux main thread, less on worker threads) is exhausted by a malicious or accidental deep nesting. This is a denial-of-service vector.
3. Verify: generate nested input of increasing depth and find the crash threshold; ASan reports stack-overflow clearly.
4. Fix options:
   - Enforce a maximum nesting depth (for example 512) and return a parse error beyond it. This is what most production JSON libraries do.

```cpp
Value Parser::parse_value(int depth) {
    if (depth > kMaxDepth) throw ParseError("nesting too deep");
    switch (peek()) {
        case '[': return parse_array(depth + 1);
        case '{': return parse_object(depth + 1);
        default:  return parse_scalar();
    }
}
```

   - Convert recursion to an explicit heap-allocated stack (iterative parser), which removes the dependency on thread stack size.
   - Also cap total input size and number of elements.
   - Destruction of deep trees can overflow too: recursive destructors of nested nodes need an iterative teardown.
5. Prevent: fuzz the parser with depth-heavy inputs, and document limits in the API.

### Several threads increment their own counters in a shared array, and adding threads makes it slower. Why?
<!-- level: advanced; kind: scenario; ref: https://en.cppreference.com/w/cpp/thread/hardware_destructive_interference_size -->
Answer: classic false sharing.

1. Observe: throughput drops as threads are added even though there is no lock and each thread writes only its own element.

```cpp
std::array<std::atomic<std::uint64_t>, 16> counters;   // 8 bytes each, contiguous
void worker(int id) { for (...) counters[id].fetch_add(1, std::memory_order_relaxed); }
```

2. Hypothesise: CPUs keep caches coherent at cache-line granularity (typically 64 bytes, 128 on some Apple and ARM designs). Eight counters share one line, so each write by one core invalidates the line in every other core's cache, and the line ping-pongs between cores.
3. Verify: hardware counters (`perf c2c` on Linux is built for this) show heavy HITM (hit-modified) traffic on that line. A quick experiment: pad the counters and compare.
4. Fix:

```cpp
struct alignas(std::hardware_destructive_interference_size) PaddedCounter {
    std::atomic<std::uint64_t> value{0};
};
std::array<PaddedCounter, 16> counters;   // one cache line each
```

   Even better: accumulate in a thread-local plain variable and publish occasionally, or merge results when threads finish. Avoid atomics entirely when data is not truly shared.
5. Prevent: be aware when laying out per-thread data, and benchmark scaling with thread count.

Note: `std::hardware_destructive_interference_size` (C++17) is not supported on every standard library version and GCC warns that its value can vary with tuning flags; some code hardcodes 64 or 128 instead.

### Your service must parse a large CSV file (10 GB) quickly with bounded memory. How would you implement it in C++?
<!-- level: intermediate; kind: scenario; ref: https://en.cppreference.com/w/cpp/utility/from_chars -->
Answer:

1. Requirements: throughput (ideally limited by disk), memory independent of file size, correct handling of quotes and malformed rows.
2. Design:
   - Stream the file in large chunks (for example 1 to 4 MB) into a reusable buffer, or memory-map it (`mmap`) and let the OS page it in. Handle records spanning chunk boundaries by carrying over the partial line.
   - Parse fields as `std::string_view`s into the buffer: no per-field allocation.
   - Convert numbers with `std::from_chars`, which is locale-independent, non-allocating and much faster than `std::stod` or streams.
   - Process each row immediately (aggregate, write out) rather than storing all rows.

```cpp
double parse_double(std::string_view s) {
    double v{};
    auto [ptr, ec] = std::from_chars(s.data(), s.data() + s.size(), v);
    if (ec != std::errc{}) throw ParseError(std::string(s));
    return v;
}
```

3. Scale out: split the file into byte ranges, align each range to the next newline, and parse ranges in parallel threads with per-thread aggregation merged at the end (careful: quoted fields can contain newlines, which breaks naive splitting).
4. Avoid: `std::getline` with `std::istringstream` per row and `std::stod`, which allocate and use locales; `std::endl` in output loops.
5. Verify with benchmarks against `wc -l` or raw read speed, and test malformed input, empty fields, quotes, and CRLF line endings.

Trade-off: `mmap` is simple and fast for local files but behaves poorly on network filesystems and makes I/O errors appear as signals.

### A service uses a singleton accessed from many threads, and tests are hard to write. How would you refactor it?
<!-- level: intermediate; kind: scenario; ref: https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Ri-singleton -->
Answer:

1. Observe: classes call `Database::instance()` directly, so tests cannot substitute a fake; test order dependencies appear because the singleton keeps state between tests.
2. Hypothesise the costs: hidden dependencies, global mutable state (thread-safety burden), uncontrolled initialisation and destruction order, and no way to run two configurations in one process.
3. Refactor incrementally with dependency injection:
   - Extract an interface (or concept) for what callers need.
   - Pass the dependency through constructors; create real instances in `main` (the composition root).
   - Keep a temporary adapter so old call sites still compile while you migrate.

```cpp
class OrderStore {
public:
    virtual ~OrderStore() = default;
    virtual std::optional<Order> find(OrderId) = 0;
};

class CheckoutService {
public:
    explicit CheckoutService(OrderStore& store) : store_(store) {}
private:
    OrderStore& store_;
};

int main() {
    PostgresOrderStore store(connect(cfg));
    CheckoutService checkout(store);
}

// test
FakeOrderStore fake;
CheckoutService svc(fake);
```

4. Thread safety becomes explicit: the injected object documents whether it is safe for concurrent use.
5. Prevent: avoid adding new singletons; allow true process-wide services (logging) only with immutable configuration after startup.

Trade-off: virtual interfaces add an indirect call; for hot paths, templates or concepts give injection without runtime cost.

### Interview: what happens, step by step, when you call a virtual function on an object inside its base-class constructor?
<!-- level: advanced; kind: scenario; ref: https://isocpp.org/wiki/faq/strange-inheritance#calling-virtuals-from-ctors -->
Answer: the call dispatches to the base class's version, not the derived override, and calling a pure virtual function this way is undefined behaviour (often "pure virtual function called" and abort).

Explanation:

1. Construction proceeds base-first. While the `Base` constructor runs, the `Derived` members are not yet initialised.
2. To keep this safe, the language treats the object as a `Base` during the `Base` constructor: the vptr is set to `Base`'s vtable, and it is updated to `Derived`'s vtable only when `Derived`'s constructor starts. Destruction mirrors this in reverse.
3. So a virtual call resolves to `Base::f` (or to the pure virtual handler).

```cpp
struct Base {
    Base() { init(); }                     // calls Base::init, not Derived::init
    virtual void init() { std::puts("Base::init"); }
    virtual ~Base() = default;
};
struct Derived : Base {
    std::string name = "x";
    void init() override { name += "!"; }  // would touch uninitialised name
};
Derived d;   // prints Base::init
```

How to design around it:

- Two-phase initialisation via a factory: construct, then call `init()` before handing the object out.

```cpp
template <typename T, typename... A>
std::unique_ptr<T> create(A&&... a) {
    auto p = std::make_unique<T>(std::forward<A>(a)...);
    p->init();
    return p;
}
```

- Pass the needed information into the base constructor as parameters instead of asking the derived class virtually.
- Static analysers (clang-tidy `clang-analyzer-optin.cplusplus.VirtualCall`) flag the pattern.

Contrast with Java and C#, where the derived override runs before the derived constructor, a different but equally dangerous behaviour.
