## 12. Concurrency

### Threads: std::thread and std::jthread
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/thread/jthread -->
`std::thread` starts a new OS thread running a callable. Before a `std::thread` object is destroyed you must call `join()` (wait for it) or `detach()` (let it run independently); otherwise the destructor calls `std::terminate`. That makes plain `std::thread` easy to misuse, especially when an exception skips the `join`.

C++20 `std::jthread` fixes this with RAII: its destructor requests a stop and joins automatically. It also supports cooperative cancellation through `std::stop_token`, which the thread function can poll.

```cpp
#include <thread>

void worker(std::stop_token st, Queue& q) {
    while (!st.stop_requested()) {
        if (auto job = q.try_pop()) job->run();
        else std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
}

int main() {
    Queue q;
    std::vector<std::jthread> pool;
    for (unsigned i = 0; i < std::thread::hardware_concurrency(); ++i)
        pool.emplace_back(worker, std::ref(q));   // stop_token passed automatically
    run_server(q);
}   // each jthread: request_stop() then join()
```

Arguments are copied into the thread by default; use `std::ref` to pass references, and make sure the referenced object outlives the thread.

- Pitfall: `detach()` makes lifetime reasoning very hard; detached threads that touch globals during shutdown cause crashes.
- Pitfall: creating a thread per request does not scale; use a pool.
- Interview tip: name `jthread` as the modern default.

### Mutexes and locks
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/thread/mutex -->
A data race (two threads accessing the same memory, at least one writing, without synchronisation) is undefined behaviour in C++. A mutex provides mutual exclusion: only one thread at a time holds it.

Never call `lock()`/`unlock()` manually; use RAII lock types:

- `std::lock_guard`: simplest, locks for the scope.
- `std::unique_lock`: movable, can unlock early, required for condition variables.
- `std::scoped_lock` (C++17): locks several mutexes at once using a deadlock-avoidance algorithm.
- `std::shared_mutex` with `std::shared_lock`: many readers or one writer.

```cpp
class Accounts {
public:
    void transfer(Account& from, Account& to, long cents) {
        std::scoped_lock lock(from.m, to.m);   // no deadlock regardless of order
        from.balance -= cents;
        to.balance += cents;
    }
};

class Config {
    mutable std::shared_mutex m_;
    std::map<std::string, std::string> values_;
public:
    std::string get(const std::string& k) const {
        std::shared_lock lock(m_);            // concurrent readers
        auto it = values_.find(k);
        return it == values_.end() ? "" : it->second;
    }
    void set(std::string k, std::string v) {
        std::unique_lock lock(m_);            // exclusive writer
        values_[std::move(k)] = std::move(v);
    }
};
```

- Pitfall: deadlock when two threads lock the same mutexes in opposite orders; use `scoped_lock` or a global lock ordering.
- Pitfall: holding a lock while calling unknown code (callbacks, I/O) invites deadlocks and latency.
- Tip: keep critical sections small; copy data out and process it unlocked.

### Condition variables
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/thread/condition_variable -->
A condition variable lets threads sleep until some condition on shared state becomes true, without busy-waiting. The waiter holds a `std::unique_lock`, and `wait` atomically releases the mutex and sleeps; on wake-up it reacquires the mutex before returning.

Waits can wake spuriously, and a notification can arrive before anyone waits, so always wait on a predicate that checks the actual state. The predicate overload of `wait` loops for you.

```cpp
template <typename T>
class BlockingQueue {
public:
    void push(T value) {
        {
            std::lock_guard lock(m_);
            q_.push(std::move(value));
        }
        cv_.notify_one();                 // notify after unlocking
    }
    T pop() {
        std::unique_lock lock(m_);
        cv_.wait(lock, [&] { return !q_.empty(); });  // handles spurious wakeups
        T v = std::move(q_.front());
        q_.pop();
        return v;
    }
private:
    std::mutex m_;
    std::condition_variable cv_;
    std::queue<T> q_;
};
```

C++20 adds simpler primitives for common cases: `std::latch` (one-shot countdown), `std::barrier` (reusable phase sync), `std::counting_semaphore`, and `wait`/`notify` on atomics.

- Pitfall: modifying the shared state without holding the mutex, then notifying, can lose wake-ups.
- Pitfall: `wait` without a predicate is almost always a bug.

### Atomics and the memory model
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/atomic/memory_order -->
`std::atomic<T>` provides indivisible operations (load, store, `fetch_add`, `compare_exchange`) that are free of data races without a mutex. For integers and pointers they map to single CPU instructions (like `lock xadd` on x86).

The C++ memory model defines what other threads may observe. Compilers and CPUs reorder memory operations, so atomics also carry ordering constraints:

- `memory_order_seq_cst` (default): a single global order of all seq_cst operations. Easiest to reason about.
- `acquire` / `release`: a release store "publishes" all prior writes to any thread that does an acquire load of that value. The basis of most lock-free handoffs.
- `relaxed`: atomicity only, no ordering. Fine for statistics counters.

```cpp
std::atomic<std::uint64_t> requests{0};
requests.fetch_add(1, std::memory_order_relaxed);   // counter only

Data payload;
std::atomic<bool> ready{false};

void producer() {
    payload = build();                                // plain write
    ready.store(true, std::memory_order_release);     // publish
}
void consumer() {
    while (!ready.load(std::memory_order_acquire)) {}  // synchronises-with
    use(payload);                                      // guaranteed to see build()
}
```

- Pitfall: `volatile` is not for threads; it does not provide atomicity or ordering in C++.
- Pitfall: lock-free code beyond simple counters and flags is extremely hard to get right; prefer mutexes unless profiling proves otherwise.
- Pitfall: false sharing: atomics on the same cache line written by different cores slow each other down; pad with `alignas(std::hardware_destructive_interference_size)`.

### Futures, async and task-based concurrency
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/thread/async -->
Rather than managing threads, you can think in tasks that produce results. `std::async` runs a callable and returns a `std::future<T>`; `future.get()` waits for and returns the result, rethrowing any exception the task threw. `std::promise<T>` lets you set a future's value manually from another thread, and `std::packaged_task` wraps a callable for use in thread pools.

```cpp
#include <future>

std::vector<Report> build_all(const std::vector<Region>& regions) {
    std::vector<std::future<Report>> futures;
    for (const auto& r : regions)
        futures.push_back(std::async(std::launch::async, build_report, std::cref(r)));

    std::vector<Report> out;
    for (auto& f : futures) out.push_back(f.get());   // exceptions surface here
    return out;
}
```

Limitations: `std::async` with the default policy may defer execution until `get()`, the standard has no built-in thread pool or continuation (`then`), and the future returned by `std::async` blocks in its destructor. Production code often uses a thread pool library, parallel algorithms (`std::execution::par`), Intel TBB, or Asio. C++26 introduces `std::execution` (senders and receivers) as the standard asynchronous framework.

- Pitfall: discarding the result, `std::async(f);`, blocks immediately because the temporary future's destructor waits.
- Pitfall: always specify `std::launch::async` if you need real concurrency.
- Interview tip: mention that parallel STL algorithms are often the simplest way to use multiple cores.

## 13. Modern C++20 and C++23

### Modules (C++20)
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/language/modules -->
Modules replace textual `#include` with compiled interfaces. A module interface unit declares what it exports; importers load a precompiled binary module interface instead of re-parsing headers. Benefits: much faster builds for large codebases, no macro leakage between modules, and no include-order dependencies.

C++23 adds `import std;`, which imports the entire standard library as one module, often faster than including a few headers.

```cpp
// geometry.cppm  (module interface unit)
export module geometry;

import std;

export struct Point { double x, y; };

export double distance(Point a, Point b) {
    return std::hypot(a.x - b.x, a.y - b.y);
}

double internal_helper();   // not exported: invisible to importers

// main.cpp
import geometry;
int main() { return distance({0, 0}, {3, 4}) == 5.0 ? 0 : 1; }
```

Tooling status (late 2026): MSVC, Clang and GCC 15 support named modules, and CMake 3.28+ supports them with the Ninja or Visual Studio generators; `import std` support in CMake is newer and still maturing. Many projects adopt modules gradually, keeping headers for public APIs.

- Pitfall: build systems must scan sources to discover module dependencies before compiling, which older build setups cannot do.
- Pitfall: macros are not exported from modules; config macros still need headers.
- Interview tip: compare modules with precompiled headers: both save parsing, but only modules give isolation.

### Coroutines (C++20)
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/language/coroutines -->
A coroutine is a function that can suspend and resume later, keeping its local state. Any function using `co_await`, `co_yield` or `co_return` is a coroutine. They are ideal for asynchronous I/O (writing async code that reads sequentially) and lazy generators.

Under the hood, the compiler transforms the function into a state machine and allocates a coroutine frame (usually on the heap, though it can be elided) holding locals and the resume point. The return type's `promise_type` customises behaviour. C++20 provided only the low-level machinery; libraries (cppcoro, Asio, folly) supply task types. C++23 adds `std::generator`.

```cpp
#include <generator>   // C++23

std::generator<std::uint64_t> fibonacci() {
    std::uint64_t a = 0, b = 1;
    while (true) {
        co_yield a;
        a = std::exchange(b, a + b);
    }
}

for (auto x : fibonacci() | std::views::take(10)) std::cout << x << ' ';

// Async style with Asio
asio::awaitable<void> echo(tcp::socket s) {
    char buf[1024];
    for (;;) {
        auto n = co_await s.async_read_some(asio::buffer(buf), asio::use_awaitable);
        co_await asio::async_write(s, asio::buffer(buf, n), asio::use_awaitable);
    }
}
```

- Pitfall: coroutine parameters taken by reference may dangle after the first suspension; take parameters by value.
- Pitfall: lambdas that are coroutines must not capture by reference if the lambda object dies before the coroutine finishes.

### Formatting and printing: std::format and std::print
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/utility/format -->
C++20 `std::format` brings Python-style format strings to C++: type-safe like iostreams, concise like `printf`, and fast. Format strings are checked at compile time, so a mismatched specifier is a compile error. C++23 `std::print` and `std::println` write formatted output directly to stdout (or a `FILE*`), handling Unicode correctly on Windows consoles.

```cpp
#include <format>
#include <print>     // C++23

std::string msg = std::format("{} scored {:.1f}% ({}/{})", name, pct, hits, total);
std::println("{:>10} | {:08.3f} | {:#x}", "latency", 12.3456, 255);
//    latency | 0012.346 | 0xff

struct Point { int x, y; };

template <>
struct std::formatter<Point> : std::formatter<std::string> {
    auto format(const Point& p, std::format_context& ctx) const {
        return std::formatter<std::string>::format(std::format("({}, {})", p.x, p.y), ctx);
    }
};
std::println("at {}", Point{3, 4});

std::println("{}", std::vector{1, 2, 3});   // C++23 range formatting: [1, 2, 3]
```

For runtime format strings (for example translations), use `std::vformat` with `std::make_format_args`; C++26 adds `std::runtime_format`.

- Pitfall: compile-time checking means `std::format(user_string, ...)` will not compile; this is intentional, since user-controlled format strings are a security risk.
- Tip: the open-source `{fmt}` library provides the same API for older compilers.

### Other C++20/23 essentials
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/20 -->
Several smaller features change everyday code:

- `std::span<T>` (C++20): a non-owning view of contiguous memory, replacing pointer plus length pairs.
- Three-way comparison `<=>` and defaulted comparisons (C++20).
- `constexpr` everywhere: virtual functions, `try`, dynamic allocation (transient) in C++20; `constexpr` `std::unique_ptr` and more in C++23.
- `std::source_location` (C++20): file and line without macros.
- Designated initialisers (C++20): `Config{.port = 8080}`.
- C++23: deducing `this` (explicit object parameter) removes const/non-const duplication and enables recursive lambdas; `std::expected`; `std::mdspan` for multidimensional views; `std::unreachable()`; `if consteval`; `std::stacktrace`; the `[[assume(expr)]]` attribute.

```cpp
struct Matrix {
    template <typename Self>
    auto& at(this Self&& self, std::size_t r, std::size_t c) {   // C++23
        return self.data_[r * self.cols_ + c];   // one function for const and non-const
    }
    std::vector<double> data_;
    std::size_t cols_;
};

void log(std::string_view msg, std::source_location loc = std::source_location::current()) {
    std::println("{}:{} {}", loc.file_name(), loc.line(), msg);
}

auto fib = [](this auto self, int n) -> int {     // recursive lambda, C++23
    return n < 2 ? n : self(n - 1) + self(n - 2);
};
```

- Tip: check compiler support tables on cppreference before relying on a feature; library support often lags language support.
- Interview tip: knowing deducing `this` and `std::expected` signals up-to-date knowledge.

### C++26 at a glance
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/26 -->
C++26 was finalised by the committee in 2025 and compilers are implementing it progressively, so treat these as "coming soon" in most production toolchains. Highlights worth knowing for interviews:

- Static reflection: inspect types at compile time with the `^^` operator and `std::meta` functions, enabling automatic serialisation and enum-to-string without macros.
- Contracts: `pre`, `post` and `contract_assert` to state function preconditions and postconditions, with configurable checking.
- `std::execution` (senders/receivers): a standard model for asynchronous and parallel work.
- Erroneous behaviour for uninitialised reads: reading an uninitialised automatic variable is no longer unbounded UB but "erroneous", giving a defined (if wrong) value.
- Library additions such as `std::inplace_vector`, `std::hive`, saturation arithmetic, linear algebra, and hardened standard library preconditions.
- Pack indexing (`Ts...[0]`) and `= delete("reason");`.

```cpp
// C++26 contracts (syntax as standardised; check compiler support)
int safe_div(int a, int b)
    pre (b != 0)
    post (r : r * b <= a)
{
    return a / b;
}

// C++26 reflection idea: enumerate enum names at compile time
template <typename E> requires std::is_enum_v<E>
constexpr std::string_view enum_name(E value);   // implementable with std::meta
```

- Pitfall: do not assume availability; gate usage with feature-test macros like `__cpp_contracts` and `__cpp_impl_reflection`.
- Interview tip: memory-safety improvements (hardening, erroneous behaviour) are the committee's response to industry pressure for safer languages.

## 14. Undefined Behaviour, Safety and Tooling

### Undefined behaviour
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/language/ub -->
Undefined behaviour (UB) means the standard imposes no requirements at all. The program may crash, appear to work, or behave differently with each compiler version or optimisation level. Crucially, optimisers assume UB never happens and use that to transform code, so UB can affect code before the faulty line ("time travel").

Common sources:

- Out-of-bounds access, use-after-free, double free, null dereference.
- Signed integer overflow.
- Reading uninitialised variables (erroneous behaviour in C++26).
- Data races.
- Violating strict aliasing (accessing an object through a pointer of an unrelated type).
- Modifying a const object; shifting by more than the bit width; infinite loops without side effects.

```cpp
bool will_overflow(int x) {
    return x + 1 < x;         // signed overflow is UB, so the compiler
}                             // may fold this to `return false;`

int table[4];
int read(int i) {
    if (i <= 4) return table[i];   // i == 4 is UB; optimiser may assume i < 4
    return -1;
}

bool fixed(int x) { return x == std::numeric_limits<int>::max(); }
```

Related categories: implementation-defined (documented per platform, like `sizeof(long)`), unspecified (one of several outcomes, like argument evaluation order).

- Pitfall: "it works on my machine" means nothing for UB.
- Interview tip: explain how UB enables optimisation and why sanitizers matter.

### Sanitizers and debugging tools
<!-- level: intermediate; ref: https://clang.llvm.org/docs/AddressSanitizer.html -->
Sanitizers instrument your program at compile time to detect bugs at runtime with precise reports (stack traces of the bad access, the allocation and the free). They belong in every test and CI configuration.

- AddressSanitizer (ASan): out-of-bounds, use-after-free, double free, leaks (via LeakSanitizer). About 2x slowdown.
- UndefinedBehaviorSanitizer (UBSan): signed overflow, misaligned access, invalid shifts, null dereference.
- ThreadSanitizer (TSan): data races and some deadlocks. Cannot combine with ASan.
- MemorySanitizer (Clang only): reads of uninitialised memory.

Other tools: Valgrind (no recompilation, slow), debuggers (gdb, lldb, Visual Studio), core dumps, and hardened standard library modes.

```bash
clang++ -std=c++23 -g -O1 -fsanitize=address,undefined -fno-omit-frame-pointer app.cpp -o app
./app
# ==1234==ERROR: AddressSanitizer: heap-use-after-free on address 0x6020...
#     #0 in Session::close() session.cpp:42

clang++ -g -O1 -fsanitize=thread server.cpp -o server_tsan
```

MSVC supports ASan via `/fsanitize=address`.

- Pitfall: sanitizers only find bugs on executed paths; pair them with good tests and fuzzing (libFuzzer).
- Tip: run unit tests under ASan+UBSan and integration tests under TSan in CI.

### Writing memory-safe modern C++
<!-- level: intermediate; ref: https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines -->
C++ cannot be made fully memory safe, but disciplined modern code eliminates most bug classes that plague legacy code:

- No owning raw pointers; no naked `new`/`delete`. Use containers, `unique_ptr`, values.
- Use `std::span` and `std::string_view` instead of pointer plus length, and `std::array` instead of C arrays.
- Prefer range-for and algorithms to index arithmetic.
- Initialise every variable; enable `-Wall -Wextra -Werror` plus `-Wconversion` where practical.
- Enable standard library hardening (`-D_GLIBCXX_ASSERTIONS`, libc++ `_LIBCPP_HARDENING_MODE`) in production where overhead is acceptable.
- Run static analysis: clang-tidy (with `cppcoreguidelines-*` and `bugprone-*` checks), compiler `-fanalyzer`, or commercial tools.
- Treat external input as hostile: validate sizes before copying, use `std::from_chars` rather than `atoi`.

```cpp
// Legacy
void copy_name(char* dst, const char* src) { std::strcpy(dst, src); }  // overflow risk

// Modern
std::string copy_name(std::string_view src) {
    if (src.size() > 64) throw std::length_error("name too long");
    return std::string(src);
}
```

```bash
clang-tidy src/*.cpp -checks='bugprone-*,cppcoreguidelines-*,modernize-*' -- -std=c++20
```

- Interview tip: governments and large companies now publish guidance favouring memory-safe languages; show you know how C++ teams respond (hardening, guidelines, sanitizers, safe subsets).

### CMake basics
<!-- level: basic; ref: https://cmake.org/cmake/help/latest/guide/tutorial/index.html -->
CMake is the de facto build system generator for C++. You describe targets in `CMakeLists.txt`, and CMake generates build files for Ninja, Make, Visual Studio or Xcode. Builds are done out-of-source, in a separate build directory.

Modern CMake is target-based: everything (include paths, compile options, dependencies) is attached to targets with visibility keywords:

- `PRIVATE`: needed to build this target only.
- `INTERFACE`: needed only by consumers.
- `PUBLIC`: both.

```cmake
cmake_minimum_required(VERSION 3.28)
project(inventory LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(core src/stock.cpp src/pricing.cpp)
target_include_directories(core PUBLIC include)
target_compile_options(core PRIVATE
    $<$<CXX_COMPILER_ID:GNU,Clang>:-Wall -Wextra -Wpedantic>
    $<$<CXX_COMPILER_ID:MSVC>:/W4>)

add_executable(inventory src/main.cpp)
target_link_libraries(inventory PRIVATE core)
```

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
ctest --test-dir build
```

- Pitfall: avoid global commands like `include_directories()` and `add_compile_options()` that leak settings to every target.
- Pitfall: `file(GLOB ...)` for sources does not notice new files without re-running CMake.

### Dependencies, testing and CI with CMake
<!-- level: intermediate; ref: https://cmake.org/cmake/help/latest/module/FetchContent.html -->
C++ has no single official package manager, so teams choose between:

- `find_package()`: use libraries already installed on the system or provided by a package manager.
- vcpkg or Conan: package managers that build and cache dependencies; integrate via a CMake toolchain file or manifest (`vcpkg.json`).
- `FetchContent`: download and build a dependency as part of your project. Simple for small dependencies like test frameworks.

CMake presets (`CMakePresets.json`) record configure and build options so every developer and CI job builds the same way. CTest runs tests registered with `add_test` or discovered with GoogleTest's `gtest_discover_tests`.

```cmake
include(FetchContent)
FetchContent_Declare(googletest
    URL https://github.com/google/googletest/archive/refs/tags/v1.15.2.tar.gz)
FetchContent_MakeAvailable(googletest)

find_package(fmt CONFIG REQUIRED)        # e.g. provided by vcpkg
target_link_libraries(core PUBLIC fmt::fmt)

enable_testing()
add_executable(core_tests tests/stock_test.cpp)
target_link_libraries(core_tests PRIVATE core GTest::gtest_main)
include(GoogleTest)
gtest_discover_tests(core_tests)
```

```bash
cmake --preset debug-asan
cmake --build --preset debug-asan
ctest --preset debug-asan --output-on-failure
```

- Pitfall: mixing debug and release builds of dependencies on Windows causes ABI and runtime-library mismatches.
- Tip: export `compile_commands.json` (`CMAKE_EXPORT_COMPILE_COMMANDS=ON`) so clang-tidy and IDEs understand your build.
