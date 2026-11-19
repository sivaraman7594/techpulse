## 9. Smart Pointers and Ownership

### unique_ptr: exclusive ownership
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/memory/unique_ptr -->
`std::unique_ptr<T>` owns a heap object exclusively and deletes it when the pointer is destroyed. It cannot be copied, only moved, so ownership is always explicit in the code. It has no overhead compared with a raw pointer (with the default deleter it is a single pointer in size).

Create one with `std::make_unique<T>(args...)` (C++14), which avoids a naked `new` and is exception-safe. Use `unique_ptr` for polymorphic objects, pimpl, large objects you want on the heap, and wrapping C resources with a custom deleter.

```cpp
auto parser = std::make_unique<JsonParser>(config);
parser->parse(text);

std::unique_ptr<Plugin> load_plugin(std::string_view name);   // factory returns ownership
void install(std::unique_ptr<Plugin> p);                      // sink takes ownership
install(load_plugin("audio"));
// install(parser);                    // error: copy
install_parser(std::move(parser));     // explicit transfer; parser is now null

// Custom deleter for a C API
struct FileCloser { void operator()(std::FILE* f) const { std::fclose(f); } };
std::unique_ptr<std::FILE, FileCloser> f(std::fopen("log.txt", "a"));

auto buf = std::make_unique<std::byte[]>(4096);   // array form
```

- Pitfall: `p.get()` returns a non-owning raw pointer; never `delete` it or wrap it in another smart pointer.
- Pitfall: `release()` gives up ownership without deleting; you now must manage it yourself.
- Interview tip: unique_ptr is the default owning pointer; reach for shared_ptr only when ownership is truly shared.

### shared_ptr and weak_ptr
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/memory/shared_ptr -->
`std::shared_ptr<T>` implements shared ownership via reference counting. Copies increment a count stored in a separate control block; when the last owner is destroyed, the object is deleted. `std::weak_ptr<T>` observes a shared object without keeping it alive; call `lock()` to get a temporary `shared_ptr` if the object still exists.

Under the hood, the control block holds a strong count, a weak count and the deleter. Count updates are atomic, so copying a shared_ptr across threads is safe but costs atomic operations. `std::make_shared` allocates the object and control block in one allocation.

```cpp
struct Subscriber;
class Publisher {
public:
    void subscribe(std::weak_ptr<Subscriber> s) { subs_.push_back(std::move(s)); }
    void publish(const Event& e) {
        std::erase_if(subs_, [&](auto& w) {
            if (auto s = w.lock()) { s->notify(e); return false; }
            return true;                     // subscriber gone, remove
        });
    }
private:
    std::vector<std::weak_ptr<Subscriber>> subs_;
};

auto sub = std::make_shared<Subscriber>();
publisher.subscribe(sub);
```

- Pitfall: reference cycles (A holds shared_ptr to B and B to A) never get freed. Break them with `weak_ptr`, typically for back-pointers.
- Pitfall: the object is thread-safe to share, but the pointed-to object is not automatically synchronised. C++20 provides `std::atomic<std::shared_ptr<T>>` for atomically swapping the pointer itself.
- Pitfall: creating two shared_ptrs from the same raw pointer causes a double delete. Use `enable_shared_from_this` to get a shared_ptr to `this`.

### Ownership guidelines and raw pointers
<!-- level: intermediate; ref: https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#S-resource -->
Modern C++ code expresses ownership through types, so a reader can tell who frees what without reading the implementation:

- Owning, single owner: `std::unique_ptr<T>` or a value member.
- Owning, shared: `std::shared_ptr<T>` (only when lifetimes are genuinely unpredictable, like caches or async callbacks).
- Non-owning, never null: `T&`.
- Non-owning, maybe null: `T*`.
- Non-owning view of a sequence: `std::span<T>` or `std::string_view`.

Functions that merely use an object should take `T&` or `T*`, not a smart pointer. Taking `const std::shared_ptr<T>&` forces callers to have a shared_ptr and says nothing useful; taking `std::shared_ptr<T>` by value signals the function will share ownership (and costs an atomic increment).

```cpp
void render(const Scene& scene);                       // uses, does not own
void attach(std::shared_ptr<Texture> tex);             // stores a shared owner
std::unique_ptr<Scene> build_scene(const Config&);     // returns ownership

auto scene = build_scene(cfg);
render(*scene);
```

Prefer values over pointers altogether. A member `std::vector<Item> items_;` is simpler and faster than `std::vector<std::unique_ptr<Item>>` unless you need polymorphism or stable addresses.

- Pitfall: "shared_ptr everywhere" hides ownership, adds overhead and invites cycles.
- Interview tip: explain that raw pointers are fine as long as they never own.

## 10. Lambdas and Callables

### Lambda expressions and captures
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/lambda -->
A lambda is an anonymous function object written inline: `[captures](params) { body }`. The compiler turns it into a unique unnamed class with an `operator()`, and captured variables become data members. That is why lambdas are as fast as hand-written functors and usually inline completely.

Capture options:

- `[x]` copies `x`; `[&x]` captures by reference.
- `[=]` / `[&]` capture everything used, by value or by reference.
- `[this]` captures the object pointer; `[*this]` (C++17) copies the object.
- Init captures (C++14): `[p = std::move(ptr)]` move a value in or compute one.

By default the call operator is `const`, so by-value captures cannot be modified unless the lambda is `mutable`.

```cpp
int threshold = 50;
auto expensive = std::count_if(items.begin(), items.end(),
                               [threshold](const Item& i) { return i.price > threshold; });

auto counter = [n = 0]() mutable { return ++n; };
counter(); counter();      // 1, 2

auto task = [buf = std::move(buffer), this] { upload(buf); };
```

- Pitfall: capturing locals by reference (`[&]`) in a lambda that runs later (a thread, a callback, an async task) leads to dangling references.
- Pitfall: `[=]` inside a member function captures `this` implicitly (deprecated in C++20), so the lambda still dangles if the object dies.
- Interview tip: describe the closure class the compiler generates.

### Generic lambdas and std::function
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/utility/functional/function -->
A generic lambda uses `auto` parameters (C++14), making its call operator a template. C++20 also allows explicit template parameter lists: `[]<typename T>(const std::vector<T>& v) {}`.

Each lambda has a unique type, so to store different callables in one variable or container you need type erasure: `std::function<R(Args...)>` can hold any callable with a compatible signature. The cost is a possible heap allocation for large captures and an indirect call that blocks inlining.

C++23 adds `std::move_only_function`, which can hold move-only callables (for example a lambda capturing a `unique_ptr`) and has better const-correctness.

```cpp
auto print_all = [](const auto& container) {
    for (const auto& x : container) std::cout << x << ' ';
};
print_all(std::vector{1, 2});
print_all(std::set<std::string>{"a", "b"});

class Button {
public:
    void on_click(std::function<void()> handler) { handlers_.push_back(std::move(handler)); }
    void click() { for (auto& h : handlers_) h(); }
private:
    std::vector<std::function<void()>> handlers_;
};

// Template parameter: zero overhead when you do not need to store it
template <std::invocable<int> F>
void repeat(int n, F f) { for (int i = 0; i < n; ++i) f(i); }
```

- Pitfall: calling an empty `std::function` throws `std::bad_function_call`.
- Tip: accept callables as template parameters in hot paths and `std::function` only when you must store them.

### Function pointers, functors and std::invoke
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/utility/functional/invoke -->
C++ has several kinds of callables: plain function pointers, pointers to member functions, function objects (classes with `operator()`), and lambdas. `std::invoke(f, args...)` (C++17) calls any of them uniformly, including member pointers, which generic code needs.

Captureless lambdas implicitly convert to function pointers, which is how you pass C++ logic to C callback APIs. Function objects carry state and are easy for the compiler to inline, which is why `std::sort` with a lambda often outperforms C's `qsort` with a function pointer.

```cpp
int compare_ints(const void* a, const void* b) {
    return *static_cast<const int*>(a) - *static_cast<const int*>(b);
}
std::qsort(data, n, sizeof(int), compare_ints);

struct Employee { std::string name; int age; int years() const; };
auto get_age = &Employee::age;
auto get_years = &Employee::years;
Employee e{"ana", 30};
std::invoke(get_age, e);     // 30
std::invoke(get_years, e);   // calls e.years()

// Captureless lambda as a C callback
register_callback(+[](int code) { std::fprintf(stderr, "code %d\n", code); });

auto add5 = std::bind_front(std::plus<>{}, 5);   // C++20
add5(3);                                         // 8
```

- Pitfall: the subtraction trick in `compare_ints` overflows for large values; use `(a > b) - (a < b)`.
- Tip: prefer lambdas over `std::bind`; they are clearer and optimise better.

## 11. Error Handling

### Exceptions and stack unwinding
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/exceptions -->
Exceptions separate error handling from normal flow. `throw` creates an exception object; the runtime searches up the call stack for a matching `catch`, and during this stack unwinding it calls destructors of all fully constructed local objects. That is why RAII and exceptions work together: resources are released automatically on the error path.

Major implementations use "zero-cost" table-based exception handling: the non-throwing path has no runtime overhead, but throwing is expensive (microseconds), so exceptions should signal exceptional conditions, not regular control flow.

Throw by value, catch by const reference. Derive custom exceptions from `std::exception` (often `std::runtime_error`) so generic handlers can log `what()`.

```cpp
class ConfigError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

Config load_config(const std::filesystem::path& p) {
    std::ifstream in(p);
    if (!in) throw ConfigError("cannot open " + p.string());
    return parse(in);
}

int main() {
    try {
        auto cfg = load_config("app.toml");
        run(cfg);
    } catch (const ConfigError& e) {
        std::cerr << "config: " << e.what() << '\n';
        return 2;
    } catch (const std::exception& e) {
        std::cerr << "fatal: " << e.what() << '\n';
        return 1;
    }
}
```

- Pitfall: catching by value slices derived exceptions and copies them.
- Pitfall: an exception escaping `main`, a `noexcept` function or a destructor calls `std::terminate`.
- Pitfall: rethrow with `throw;` not `throw e;` to preserve the original dynamic type.

### Exception safety guarantees
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/language/exceptions#Exception_safety -->
Every function should offer one of the classic exception-safety guarantees, describing the program state if an exception propagates out:

1. No-throw guarantee: the operation never fails (destructors, swaps, moves marked `noexcept`).
2. Strong guarantee: commit-or-rollback; if it throws, state is as if the call never happened. `std::vector::push_back` offers this.
3. Basic guarantee: no leaks and invariants still hold, but the state may have changed.
4. No guarantee: invariants may be broken. Unacceptable in well-written code.

The copy-and-swap idiom is the classic way to get the strong guarantee: do all the throwing work on a copy, then commit with a non-throwing swap.

```cpp
class Inventory {
public:
    void apply(const std::vector<Change>& changes) {
        auto next = items_;                 // copy; may throw, items_ untouched
        for (const auto& c : changes)
            next.at(c.sku) += c.delta;      // may throw std::out_of_range
        items_.swap(next);                  // noexcept commit
    }
private:
    std::unordered_map<std::string, int> items_;
};
```

The pattern is "do the risky work first, mutate state last with operations that cannot fail".

- Pitfall: the strong guarantee often costs a copy; offer it only where callers need it.
- Interview tip: explain why `vector` needs `noexcept` move constructors to keep its strong guarantee during reallocation.

### noexcept
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/noexcept_spec -->
`noexcept` declares that a function will not throw. If an exception does try to escape, `std::terminate` is called immediately, without guaranteed unwinding. The `noexcept(expr)` operator checks at compile time whether an expression is declared non-throwing.

Why it matters: standard containers query `noexcept` to choose faster algorithms. `std::vector` reallocation moves elements only if the move constructor is `noexcept` (via `std::move_if_noexcept`); otherwise it copies to preserve the strong guarantee. The compiler can also generate smaller code when it knows no unwinding is needed.

Destructors are implicitly `noexcept`. Defaulted special members are `noexcept` when all members' corresponding operations are.

```cpp
class Packet {
public:
    Packet(Packet&& o) noexcept : data_(std::move(o.data_)) {}
    Packet& operator=(Packet&& o) noexcept { data_ = std::move(o.data_); return *this; }
    void swap(Packet& o) noexcept { data_.swap(o.data_); }
private:
    std::vector<std::byte> data_;
};

static_assert(std::is_nothrow_move_constructible_v<Packet>);

template <typename T>
void relocate(T& dst, T& src) noexcept(std::is_nothrow_move_assignable_v<T>) {
    dst = std::move(src);
}
```

- Pitfall: marking a function `noexcept` that calls something which can throw (like an allocation) turns a recoverable error into a crash.
- Tip: mark move operations, swap and destructors `noexcept`; be selective elsewhere.

### Error codes and std::expected (C++23)
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/utility/expected -->
Exceptions are not always appropriate: some codebases ban them (games, embedded, some Google-style code), and expected failures like "file not found" or "invalid user input" are part of normal flow. Alternatives:

- `std::error_code` / `std::error_condition`: used by `<filesystem>` and networking for OS-level errors.
- `std::optional<T>`: when the only information is "no value".
- `std::expected<T, E>` (C++23): holds either a value or an error, making failure explicit in the return type. It supports monadic chaining with `and_then`, `transform`, `or_else` and `transform_error`.

```cpp
enum class ParseError { Empty, NotANumber, OutOfRange };

std::expected<int, ParseError> parse_port(std::string_view s) {
    if (s.empty()) return std::unexpected(ParseError::Empty);
    int value{};
    auto [ptr, ec] = std::from_chars(s.data(), s.data() + s.size(), value);
    if (ec != std::errc{} || ptr != s.data() + s.size()) return std::unexpected(ParseError::NotANumber);
    if (value < 1 || value > 65535) return std::unexpected(ParseError::OutOfRange);
    return value;
}

auto port = parse_port(arg).value_or(8080);

std::error_code ec;
std::filesystem::remove("tmp.lock", ec);
if (ec) log("cleanup failed: " + ec.message());
```

Mark such functions `[[nodiscard]]` so callers cannot silently ignore the result.

- Pitfall: `.value()` on an expected holding an error throws `std::bad_expected_access`.
- Interview tip: discuss when to choose exceptions (rare, unrecoverable at the call site) vs expected (anticipated, handled locally).
