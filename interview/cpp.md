# C++ interview questions

### What is the difference between a pointer and a reference?
<!-- level: basic; kind: concept; ref: https://en.cppreference.com/w/cpp/language/reference -->
Both let you refer to an object indirectly, but they have different guarantees:

- A reference must be bound at initialisation, cannot be null (in a valid program) and cannot be reseated to another object. Syntax is the same as using the object.
- A pointer is an object holding an address. It can be null, reassigned, incremented through an array, and must be dereferenced with `*` or `->`.
- You can have pointers to pointers and arrays of pointers, but not references to references or arrays of references.

```cpp
void scale(Matrix& m, double k);      // must be given a real matrix
void maybe_log(const Logger* log);    // nullptr means "no logging"
```

Guideline: use references for parameters that must refer to an object, pointers when "nothing" is a valid value, and smart pointers when ownership is involved. A common wrong answer is "references are safer, so they can never dangle": a reference to a destroyed object dangles just like a pointer.

### What is RAII and why is it central to C++?
<!-- level: basic; kind: concept; ref: https://en.cppreference.com/w/cpp/language/raii -->
Resource Acquisition Is Initialisation binds a resource's lifetime to an object's lifetime: acquire in the constructor, release in the destructor. Because C++ destroys automatic objects deterministically at scope exit, including during exception unwinding, the resource is always released exactly once.

It applies to any resource: memory (`std::vector`, `std::unique_ptr`), files (`std::fstream`), locks (`std::lock_guard`), sockets, database transactions, even "restore this setting on exit" guards.

```cpp
void update(Db& db) {
    std::lock_guard lock(db.mutex());   // unlocked on every exit path
    Transaction tx(db);                 // rolls back in destructor unless committed
    tx.execute("UPDATE ...");
    tx.commit();
}
```

Why it matters: RAII is how C++ avoids leaks without a garbage collector, makes exception-safe code practical, and removes the need for `finally`. Interviewers like hearing that RAII also covers non-memory resources, which garbage-collected languages handle less deterministically.

### Explain the rule of zero, three and five.
<!-- level: intermediate; kind: concept; ref: https://en.cppreference.com/w/cpp/language/rule_of_three -->
- Rule of three: if a class needs a user-defined destructor, copy constructor or copy assignment operator, it probably needs all three, because it manages a resource and the defaults would copy the raw handle (leading to double frees).
- Rule of five: since C++11, also define the move constructor and move assignment; declaring a destructor or copy operation suppresses the implicit moves, so moves silently become copies.
- Rule of zero: preferred. Compose your class from members that already manage themselves (`std::string`, `std::vector`, `std::unique_ptr`) and declare none of the five.

```cpp
class Session {            // rule of zero
    std::string user_;
    std::unique_ptr<Socket> sock_;   // makes Session move-only automatically
};
```

A strong answer adds: write the five only in small, dedicated resource-wrapper classes, mark moves `noexcept`, and use `= default` or `= delete` to be explicit.

### What does std::move actually do?
<!-- level: intermediate; kind: concept; ref: https://en.cppreference.com/w/cpp/utility/move -->
`std::move` does not move anything. It is an unconditional cast to an rvalue reference (`static_cast<T&&>`), signalling "this object may be pilfered". Overload resolution then selects a move constructor or move assignment if one exists, and that function performs the actual transfer, typically stealing pointers and leaving the source empty.

```cpp
std::vector<std::string> names;
std::string n = load_name();
names.push_back(std::move(n));   // moves; n is valid but unspecified
```

Points to mention:

- If the type has no move constructor, or the object is `const`, the copy constructor is used instead.
- A moved-from object must remain destructible and assignable; standard types are "valid but unspecified".
- Do not write `return std::move(local);` since it disables copy elision.
- `std::forward` is the conditional counterpart used in templates.

### How do virtual functions work under the hood?
<!-- level: intermediate; kind: concept; ref: https://en.cppreference.com/w/cpp/language/virtual -->
Most compilers use vtables. Each polymorphic class has a static table of function pointers, one slot per virtual function, holding that class's final overrides. Each object contains a hidden pointer (vptr) to its class's vtable, set by the constructor.

A call `base->draw()` compiles to: load the vptr from the object, load the function pointer from the right slot, call it indirectly with `this`. This is dynamic dispatch.

```cpp
struct Shape { virtual ~Shape() = default; virtual void draw() const = 0; };
struct Circle : Shape { void draw() const override; };
```

Costs: one pointer per object, an indirect call that blocks inlining (unless the compiler devirtualises, helped by `final`), and possible branch misprediction. Constructors set the vptr progressively, which is why virtual calls in a constructor run the current class's version. The standard does not mandate vtables, but every mainstream ABI (Itanium, MSVC) uses them.

### Why should a base class have a virtual destructor?
<!-- level: basic; kind: concept; ref: https://en.cppreference.com/w/cpp/language/destructor -->
If you delete a derived object through a pointer to its base class and the base destructor is not virtual, the behaviour is undefined. In practice only the base destructor runs, so the derived part's members (strings, buffers, handles) leak, and with multiple inheritance the wrong address may be freed.

```cpp
struct Plugin { virtual ~Plugin() = default; virtual void run() = 0; };
struct Audio : Plugin { std::vector<float> buffer; void run() override; };

std::unique_ptr<Plugin> p = std::make_unique<Audio>();
// p's destructor calls ~Audio then ~Plugin because ~Plugin is virtual
```

Rule from the Core Guidelines: a base class destructor should be either public and virtual (for polymorphic deletion) or protected and non-virtual (to forbid deletion through the base). Note that `std::shared_ptr` created by `make_shared<Derived>` captures the right deleter even without a virtual destructor, but relying on that is fragile.

### Compare unique_ptr, shared_ptr and weak_ptr.
<!-- level: basic; kind: concept; ref: https://en.cppreference.com/w/cpp/memory -->
- `unique_ptr<T>`: sole ownership, move-only, zero overhead over a raw pointer. The default choice for heap objects.
- `shared_ptr<T>`: shared ownership through an atomic reference count in a control block. The object is deleted when the last owner goes away. Costs extra memory and atomic operations on copy.
- `weak_ptr<T>`: non-owning observer of a shared object. `lock()` returns a `shared_ptr` if the object is still alive. Used to break reference cycles and for caches.

```cpp
auto cfg = std::make_shared<Config>();
std::weak_ptr<Config> watcher = cfg;
if (auto c = watcher.lock()) use(*c);
```

Good answers mention: prefer `make_unique` / `make_shared`; a `unique_ptr` converts to a `shared_ptr` but not the reverse; parameters that only use an object should take `T&` or `T*` instead of smart pointers; and shared_ptr's thread safety covers the count, not the pointee.

### What is undefined behaviour? Give examples.
<!-- level: intermediate; kind: concept; ref: https://en.cppreference.com/w/cpp/language/ub -->
Undefined behaviour is code for which the C++ standard places no requirements on the result. The compiler assumes it never happens, which enables optimisations but means a program containing UB can do anything: crash, corrupt data, or silently work until a compiler upgrade.

Examples:

- Out-of-bounds array access, null or dangling pointer dereference, use-after-free, double delete.
- Signed integer overflow.
- Reading an uninitialised local variable.
- Data races between threads.
- Strict aliasing violations, modifying a const object.
- Calling `std::sort` with a comparator that is not a strict weak ordering.

```cpp
int x = INT_MAX;
x + 1 > x;   // compiler may assume true: overflow "cannot happen"
```

Contrast with implementation-defined behaviour (documented per platform, e.g. `sizeof(long)`) and unspecified behaviour (one of several valid outcomes, e.g. evaluation order of function arguments). Mention detection with sanitizers and compiler warnings.

### What is the difference between struct and class, and what does explicit do?
<!-- level: basic; kind: concept; ref: https://en.cppreference.com/w/cpp/language/explicit -->
`struct` and `class` are the same construct. The only difference is default access: members and base classes are public by default in a `struct` and private in a `class`. Convention: use `struct` for passive data aggregates and `class` for types with invariants.

`explicit` on a constructor (or conversion operator) prevents it from being used for implicit conversions and copy-initialisation.

```cpp
class Timeout {
public:
    explicit Timeout(int ms) : ms_(ms) {}
private:
    int ms_;
};

void wait(Timeout t);
// wait(500);          // error: no implicit int -> Timeout
wait(Timeout{500});    // intent is clear
```

Without `explicit`, any `int` could silently become a `Timeout`, a classic source of bugs. Guideline: make single-argument constructors explicit unless the conversion is genuinely natural (like `std::string` from `const char*`). C++20 adds conditional `explicit(bool)` for wrapper templates.

### Explain const, mutable and constexpr.
<!-- level: intermediate; kind: concept; ref: https://en.cppreference.com/w/cpp/language/cv -->
- `const` on a variable: it cannot be modified after initialisation. On a member function: it does not change the object's observable state and can be called on const objects.
- `mutable` on a data member: it can be modified even inside const member functions. Used for caches, lazy values and mutexes that do not change logical state.
- `constexpr`: the value or function can be evaluated at compile time. A `constexpr` variable is implicitly const and must have a constant initialiser.

```cpp
class PriceList {
public:
    double total() const {
        std::lock_guard lock(m_);                 // OK: m_ is mutable
        if (!cached_) cached_ = compute();
        return *cached_;
    }
private:
    mutable std::mutex m_;
    mutable std::optional<double> cached_;
    double compute() const;
};

constexpr int kMaxUsers = 1000;
```

Note that const member functions should be safe to call concurrently (standard library assumption), so mutable state usually needs synchronisation.

### How do new/delete differ from malloc/free?
<!-- level: basic; kind: concept; ref: https://en.cppreference.com/w/cpp/language/new -->
- `malloc` allocates raw bytes and returns `void*`; `free` releases them. No constructors or destructors run.
- `new` allocates (via `operator new`) and then constructs the object; `delete` calls the destructor and then deallocates. `new` returns a correctly typed pointer.
- On failure, `malloc` returns null, while `new` throws `std::bad_alloc` (unless `new (std::nothrow)` is used).
- Array forms `new[]` / `delete[]` must be paired; mixing `new` with `free` or `new[]` with `delete` is undefined behaviour.
- `operator new` can be overloaded per class or globally; placement new constructs an object in existing memory.

```cpp
auto* w = new Widget(3);   // allocate + construct
delete w;                  // destroy + free

void* raw = std::malloc(sizeof(Widget));
auto* w2 = new (raw) Widget(4);  // placement new
w2->~Widget();
std::free(raw);
```

In modern code neither is used directly: containers and `std::make_unique` handle it.

### What is object slicing?
<!-- level: intermediate; kind: concept; ref: https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Res-slice -->
Slicing happens when a derived-class object is copied into a base-class object by value. Only the base sub-object is copied; the derived members and the derived behaviour are "sliced off". The resulting object really is a `Base`, so virtual calls on it dispatch to `Base`'s versions.

```cpp
struct Animal { virtual std::string sound() const { return "..."; } virtual ~Animal() = default; };
struct Dog : Animal { std::string name; std::string sound() const override { return "woof"; } };

void speak(Animal a) { std::cout << a.sound(); }    // by value: slices
Dog d;
speak(d);                                          // prints "..."

std::vector<Animal> zoo{d};                        // sliced too
std::vector<std::unique_ptr<Animal>> ok;           // keeps the dynamic type
```

Prevention: pass polymorphic objects by reference or pointer, store them via smart pointers, and make polymorphic base classes non-copyable (delete copy operations) or provide a virtual `clone()` when copying is needed. Catching exceptions by value is another slicing trap.

### Why are templates usually defined in header files?
<!-- level: intermediate; kind: concept; ref: https://isocpp.org/wiki/faq/templates#templates-defn-vs-decl -->
A template is not code; it is a recipe. The compiler generates (instantiates) a concrete function or class only when it sees the template used with specific arguments, and it needs the full definition at that point. Since each translation unit is compiled separately, a TU that only sees the declaration cannot instantiate it, and the linker then reports an undefined reference.

Options:

- Put the definitions in the header (most common, also for `.tpp`/`.ipp` files included by the header).
- Explicit instantiation: define the template in a `.cpp` and write `template class Matrix<float>;` for every type you support. Users can only use those types.
- C++20 modules: export the template from a module interface; no header needed.

```cpp
// matrix.cpp
template class Matrix<float>;   // explicit instantiation definition
// matrix.h
extern template class Matrix<float>;  // tell other TUs not to instantiate
```

Bonus: duplicate instantiations across TUs are merged by the linker because templates are implicitly inline-like.

### When are vector iterators and references invalidated?
<!-- level: intermediate; kind: concept; ref: https://en.cppreference.com/w/cpp/container/vector -->
`std::vector` stores elements contiguously. Rules:

- `push_back`, `emplace_back`, `insert`, `resize`, `reserve`: if the new size exceeds capacity, the vector reallocates and every iterator, pointer and reference is invalidated. If no reallocation occurs, only those at or after the insertion point (and `end()`) are invalid.
- `erase`: invalidates iterators and references at or after the erased position.
- `clear`: invalidates all.
- `swap` and move: iterators remain valid but now refer into the other container.

```cpp
std::vector<int> v{1, 2, 3};
int* first = &v[0];
v.push_back(4);          // may reallocate
// *first = 9;           // UB if it did

for (auto it = v.begin(); it != v.end();)
    it = (*it % 2 == 0) ? v.erase(it) : it + 1;   // use erase's return value
```

Mention that `reserve` up front can guarantee stability during a known number of insertions, and that debug iterator modes or ASan catch violations.

### std::map vs std::unordered_map: which and why?
<!-- level: basic; kind: concept; ref: https://en.cppreference.com/w/cpp/container/map -->
- `std::map`: balanced binary search tree (red-black). O(log n) lookup, insert and erase. Keys are kept sorted, so you get ordered iteration and range queries (`lower_bound`, `upper_bound`). Needs `operator<` (or a comparator). Iterators remain valid except for erased elements.
- `std::unordered_map`: hash table. Average O(1), worst case O(n) with bad hashes. No ordering. Needs `std::hash` and `==`. Rehashing invalidates iterators.

```cpp
std::map<std::chrono::sys_seconds, Event> timeline;   // need time ranges
auto from = timeline.lower_bound(start);

std::unordered_map<UserId, Session> sessions;         // pure lookup
```

Both allocate one node per element, so cache behaviour is mediocre. For read-heavy small maps, a sorted `std::vector` or C++23 `std::flat_map` is often faster, and open-addressing hash maps (Abseil, Boost) beat `unordered_map`. Mention hash flooding: untrusted keys can trigger worst-case behaviour.

### What are the different meanings of the static keyword?
<!-- level: basic; kind: concept; ref: https://en.cppreference.com/w/cpp/keyword/static -->
`static` means different things depending on context:

1. At namespace scope (global function or variable): internal linkage, so the name is private to the translation unit. Unnamed namespaces are the modern preference.
2. Local variable inside a function: static storage duration. Initialised once on first pass (thread-safe since C++11) and persists between calls.
3. Data member of a class: shared by all instances; one copy per class. `inline static` (C++17) allows in-class definition.
4. Member function: no `this` pointer; called as `Class::f()`; can access only static members directly.

```cpp
namespace { int helper_calls = 0; }        // internal linkage

Logger& logger() {
    static Logger instance{"app.log"};     // lazy, thread-safe init
    return instance;
}

struct Id { static int next(); inline static int counter = 0; };
```

A good answer also mentions the static initialisation order fiasco between TUs and how function-local statics avoid it.

### What is the difference between push_back and emplace_back?
<!-- level: intermediate; kind: concept; ref: https://en.cppreference.com/w/cpp/container/vector/emplace_back -->
- `push_back(value)` takes an already-constructed object and copies or moves it into the container.
- `emplace_back(args...)` forwards the arguments to the element's constructor and constructs it directly in the container's storage, avoiding a temporary.

```cpp
std::vector<std::pair<std::string, int>> scores;
scores.push_back({"ana", 10});        // builds a temporary pair, then moves it
scores.emplace_back("bo", 12);        // constructs the pair in place

std::vector<std::unique_ptr<Job>> jobs;
jobs.emplace_back(new Job);           // risky: leaks if reallocation throws
jobs.push_back(std::make_unique<Job>()); // safe
```

Nuances interviewers look for:

- For an existing object, both just copy or move; there is no difference.
- `emplace_back` can call explicit constructors, which can hide mistakes (for example `std::vector<std::vector<int>> v; v.emplace_back(1000000);` creates a million-element vector).
- Since C++17 `emplace_back` returns a reference to the new element.
- Prefer `push_back` for readability unless constructing in place is a real win.

### Explain exception safety guarantees and the role of noexcept.
<!-- level: advanced; kind: concept; ref: https://en.cppreference.com/w/cpp/language/exceptions -->
Functions promise one of these if an exception escapes:

- No-throw: never fails. Required of destructors, swap, and ideally moves.
- Strong: commit-or-rollback; on failure, state is unchanged.
- Basic: no leaks, invariants hold, but state may have changed.

`noexcept` declares the no-throw guarantee. If an exception tries to leave a `noexcept` function, `std::terminate` is called.

Why it matters: `std::vector::push_back` gives the strong guarantee. During reallocation it can only move elements if the move constructor is `noexcept`; otherwise a throw midway would leave both buffers partly moved, so it falls back to copying. A missing `noexcept` on a move constructor can therefore make vector growth dramatically slower.

```cpp
struct Row {
    Row(Row&&) noexcept = default;
    Row& operator=(Row&&) noexcept = default;
    std::vector<std::string> cells;
};
```

Technique for the strong guarantee: do all throwing work on a copy, then commit with a non-throwing swap.

### What is a data race, and how is it different from a race condition?
<!-- level: advanced; kind: concept; ref: https://en.cppreference.com/w/cpp/language/memory_model -->
A data race is a specific C++ term: two threads access the same memory location concurrently, at least one access is a write, and at least one is not atomic, with no happens-before ordering between them. A data race is undefined behaviour: the compiler may cache values in registers, tear writes or reorder code.

A race condition is a broader logic bug where the outcome depends on timing, even if every access is properly synchronised. For example, "check balance, then withdraw" with two separate atomic operations has no data race but can still overdraw.

```cpp
std::atomic<int> balance{100};
if (balance.load() >= 80)          // no data race...
    balance.fetch_sub(80);         // ...but a race condition: two threads can both pass

int expected = balance.load();     // fix: compare-and-swap loop
while (expected >= 80 && !balance.compare_exchange_weak(expected, expected - 80)) {}
```

Prevention: mutexes, atomics, immutable shared data, message passing, and ThreadSanitizer in CI to detect data races.

### What is copy elision and RVO?
<!-- level: advanced; kind: concept; ref: https://en.cppreference.com/w/cpp/language/copy_elision -->
Copy elision is the compiler constructing an object directly where it will finally live, skipping copy or move constructors.

- Since C++17, it is guaranteed when initialising from a prvalue of the same type, such as `return Widget{};` or `Widget w = make_widget();` where `make_widget` returns a temporary. The copy/move constructor does not even need to exist.
- Named RVO (`Widget w; ... return w;`) is allowed but not mandatory. When it does not happen, the return is treated as an rvalue and moved.

```cpp
std::string build() {
    std::string s = "hello";
    s += " world";
    return s;                 // NRVO, or a move at worst
    // return std::move(s);   // anti-pattern: blocks NRVO
}
```

Implementation: the caller allocates space for the return value and passes its address as a hidden argument. Consequences: returning containers by value is cheap, side effects in copy constructors may not run, and `std::move` on return values is usually counterproductive.

### Compare static_cast, dynamic_cast, const_cast and reinterpret_cast.
<!-- level: intermediate; kind: concept; ref: https://en.cppreference.com/w/cpp/language/dynamic_cast -->
- `static_cast`: compile-time checked conversions between related types: numeric conversions, enum to int, `void*` to `T*`, upcasts and unchecked downcasts.
- `dynamic_cast`: runtime-checked downcasts and cross-casts in polymorphic hierarchies (requires a virtual function). Returns `nullptr` for pointers or throws `std::bad_cast` for references when the object is not of the target type. Costs a runtime type check.
- `const_cast`: adds or removes `const`/`volatile`. Writing to an originally-const object is still UB; mostly used to call legacy APIs that forgot `const`.
- `reinterpret_cast`: reinterprets bits or addresses (pointer to integer, unrelated pointer types). Low-level and easy to turn into aliasing UB.

```cpp
auto ms = static_cast<int>(seconds * 1000.0);
if (auto* admin = dynamic_cast<Admin*>(user)) admin->audit();
auto addr = reinterpret_cast<std::uintptr_t>(ptr);
```

Named casts are searchable and narrow; C-style casts try them in sequence and can silently do the dangerous ones. For type punning, use `std::bit_cast` (C++20) or `std::memcpy`.

### What does extern "C" do, and what is name mangling?
<!-- level: intermediate; kind: concept; ref: https://en.cppreference.com/w/cpp/language/language_linkage -->
C++ supports overloading, namespaces and templates, so a function name alone is not unique. Compilers encode the full signature into the symbol name (name mangling): `int add(int, int)` might become `_Z3addii` on GCC/Clang. Mangling schemes differ between ABIs (Itanium vs MSVC), which is one reason C++ libraries are not binary-compatible across compilers.

`extern "C"` gives a function C language linkage: no mangling, the plain name is used. This is needed to:

- Call C libraries from C++ (their headers wrap declarations in `extern "C"`).
- Expose C++ functions to C, Python ctypes, Rust FFI, or `dlsym`/`GetProcAddress` plugin loading.

```cpp
#ifdef __cplusplus
extern "C" {
#endif
int image_resize(const unsigned char* in, int w, int h, unsigned char* out);
#ifdef __cplusplus
}
#endif
```

Restrictions: `extern "C"` functions cannot be overloaded, and exceptions must not escape across the C boundary. Use `c++filt` or `undname` to demangle symbol names in linker errors.

### What is CRTP and when would you use it?
<!-- level: advanced; kind: concept; ref: https://en.cppreference.com/w/cpp/language/crtp -->
The Curiously Recurring Template Pattern is a class deriving from a template instantiated with itself: `class Derived : public Base<Derived>`. The base can `static_cast<Derived&>(*this)` and call derived members, giving static (compile-time) polymorphism with no vtable and full inlining.

Uses: mixins that add functionality (comparison operators, counters, `enable_shared_from_this` is a CRTP base), static interfaces in performance-critical code, and expression templates.

```cpp
template <typename Derived>
struct Shape {
    double area() const { return static_cast<const Derived&>(*this).area_impl(); }
    double cost(double per_unit) const { return area() * per_unit; }
};

struct Square : Shape<Square> {
    double side;
    double area_impl() const { return side * side; }
};
```

Trade-offs: no runtime heterogeneity (you cannot store different shapes in one container without type erasure), more template code, and harder error messages. In C++23, deducing `this` replaces many CRTP uses: a base member function written as `void f(this auto& self)` sees the derived type directly. Concepts are another modern alternative.

### What is the difference between volatile and std::atomic?
<!-- level: advanced; kind: concept; ref: https://en.cppreference.com/w/cpp/atomic/atomic -->
`volatile` tells the compiler that every read and write of the variable is an observable side effect, so it must not be cached in a register or eliminated. It exists for memory-mapped hardware registers and signal handlers (with `volatile std::sig_atomic_t`).

It provides no atomicity and no inter-thread ordering. Two threads incrementing a `volatile int` still race (undefined behaviour), and writes may become visible to other cores in any order.

`std::atomic<T>` provides indivisible read-modify-write operations and memory ordering guarantees (sequential consistency by default, or acquire/release/relaxed) defined by the C++ memory model.

```cpp
volatile std::uint32_t* const UART_STATUS = reinterpret_cast<std::uint32_t*>(0x4000'1000);  // hardware
std::atomic<bool> shutdown_requested{false};                                                // threads
```

Common wrong answer: "volatile makes it thread-safe" (true in Java and in old MSVC extensions, not in standard C++). C++20 deprecated many compound operations on volatile variables to discourage misuse.

### What are forwarding references and perfect forwarding?
<!-- level: advanced; kind: concept; ref: https://en.cppreference.com/w/cpp/language/reference#Forwarding_references -->
A forwarding (universal) reference is a parameter of the form `T&&` where `T` is a template parameter deduced from that call, or `auto&&`. It binds to both lvalues and rvalues: for an lvalue argument `T` becomes `X&`, and reference collapsing turns `X& &&` into `X&`; for an rvalue `T` becomes `X` and the parameter is `X&&`.

Perfect forwarding passes such arguments on with their original value category using `std::forward<T>(arg)`, which casts back to an rvalue only if one was passed.

```cpp
template <typename... Args>
Widget& add_widget(std::vector<Widget>& v, Args&&... args) {
    return v.emplace_back(std::forward<Args>(args)...);
}
```

Gotchas: `std::vector<T>&&` and `T&&` in a non-template member of a class template are ordinary rvalue references; forwarding the same argument twice may move from it twice; braced initialiser lists cannot be deduced and do not forward. Contrast: `std::move` always casts to rvalue, `std::forward` does so conditionally.
