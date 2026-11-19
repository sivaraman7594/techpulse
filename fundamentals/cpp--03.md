## 7. Templates and Generic Programming

### Function templates
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/function_template -->
A function template is a recipe the compiler uses to generate functions for specific types. When you call `max_of(3, 7)`, the compiler deduces `T = int` and instantiates a concrete function. Each distinct set of template arguments produces its own code, so templates have zero runtime overhead compared with hand-written versions (at the cost of compile time and binary size).

Because instantiation happens at the call site, the full template definition must be visible there. That is why templates live in headers.

```cpp
template <typename T>
const T& max_of(const T& a, const T& b) {
    return (a < b) ? b : a;
}

max_of(3, 7);                        // T = int
max_of(std::string("a"), std::string("b"));
// max_of(3, 7.5);                   // error: T deduced as int and double
max_of<double>(3, 7.5);              // explicit argument

// C++20 abbreviated template syntax
auto clamp_to_byte(auto value) { return std::clamp<decltype(value)>(value, 0, 255); }
```

Templates use duck typing at compile time: any type supporting the operations used in the body works. Before C++20 errors for unsupported types appeared deep inside the template, which is why concepts were added.

- Pitfall: putting a template definition in a `.cpp` file causes "undefined reference" link errors for other TUs (unless you explicitly instantiate it).
- Tip: `extern template` declarations can cut compile times for commonly used instantiations.

### Class templates and specialisation
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/class_template -->
Class templates parameterise a whole type: `std::vector<T>`, `std::map<K, V>`, `std::array<T, N>`. Template parameters can be types, values (non-type parameters such as `std::size_t N`) or other templates.

Since C++17, class template argument deduction (CTAD) lets you omit the arguments when they can be deduced from constructor arguments: `std::pair p{1, 2.0};`.

Specialisation provides a different implementation for particular arguments. A full specialisation replaces the template for one exact set; a partial specialisation (class templates only) covers a family, such as all pointer types.

```cpp
template <typename T, std::size_t Capacity>
class RingBuffer {
public:
    bool push(const T& v) {
        if (size_ == Capacity) return false;
        data_[(head_ + size_++) % Capacity] = v;
        return true;
    }
private:
    std::array<T, Capacity> data_{};
    std::size_t head_ = 0, size_ = 0;
};

template <typename T> struct TypeName       { static constexpr const char* value = "unknown"; };
template <>           struct TypeName<int>  { static constexpr const char* value = "int"; };
template <typename T> struct TypeName<T*>   { static constexpr const char* value = "pointer"; };

RingBuffer<int, 64> rb;
```

- Pitfall: `std::vector<bool>` is a specialisation that packs bits; it does not hold real `bool` objects, so `&v[0]` is not a `bool*`.
- Interview tip: function templates cannot be partially specialised; use overloading instead.

### Variadic templates and fold expressions
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/language/fold -->
Variadic templates accept any number of template arguments through a parameter pack (`typename... Ts`). They power `std::tuple`, `std::make_unique`, `std::format` and `emplace_back`.

Before C++17, packs were processed recursively: handle the first element, recurse on the rest, and provide a base case. C++17 fold expressions apply a binary operator across the whole pack in one expression, which is simpler and compiles faster.

```cpp
template <typename... Ts>
auto sum(Ts... xs) {
    return (xs + ... + 0);          // right fold with initial value
}

template <typename... Args>
void log_line(const Args&... args) {
    ((std::cout << args << ' '), ...);  // comma fold: prints each
    std::cout << '\n';
}

template <typename T, typename... Ts>
constexpr bool is_one_of = (std::is_same_v<T, Ts> || ...);

sum(1, 2, 3);                    // 6
log_line("user", 42, 3.5);       // user 42 3.5
static_assert(is_one_of<int, char, int, long>);
```

`sizeof...(Ts)` gives the number of elements in a pack. Packs are expanded with `...` after a pattern, for example `std::forward<Args>(args)...`.

- Pitfall: a fold over an empty pack with `+` and no initial value does not compile; `&&`, `||` and `,` have defined empty results.
- Tip: C++26 adds pack indexing (`Ts...[0]`), but it is not yet in C++23.

### Type traits and SFINAE
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/language/sfinae -->
Type traits in `<type_traits>` are compile-time queries and transformations on types: `std::is_integral_v<T>`, `std::is_trivially_copyable_v<T>`, `std::remove_cvref_t<T>`, `std::decay_t<T>`. They let generic code adapt to the types it receives.

SFINAE ("Substitution Failure Is Not An Error") is the pre-C++20 technique for constraining templates: if substituting template arguments into a declaration produces an invalid type, that overload is silently dropped instead of causing an error. `std::enable_if` exploits this. It works but produces unreadable code and terrible errors.

C++17 `if constexpr` offers a much simpler alternative for branching inside a function: the discarded branch is not instantiated.

```cpp
// Old style SFINAE
template <typename T, std::enable_if_t<std::is_integral_v<T>, int> = 0>
T half(T x) { return x / 2; }

// C++17: compile-time branch
template <typename T>
std::string to_text(const T& v) {
    if constexpr (std::is_arithmetic_v<T>)
        return std::to_string(v);
    else if constexpr (std::is_convertible_v<T, std::string_view>)
        return std::string(std::string_view(v));
    else
        return v.to_string();
}
```

- Pitfall: SFINAE only applies to the immediate declaration, not to errors inside the function body.
- Interview tip: say you would use concepts in C++20 code and `if constexpr` for internal dispatch.

### Concepts (C++20)
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/language/constraints -->
Concepts are named compile-time predicates on template arguments. They state a template's requirements in the interface, produce short readable errors, and participate in overload resolution (a more constrained overload wins).

The standard library provides many in `<concepts>` and `<iterator>`: `std::integral`, `std::floating_point`, `std::same_as`, `std::copyable`, `std::invocable`, `std::ranges::range`. You can define your own with a `requires` expression listing valid expressions and their result types.

```cpp
#include <concepts>

template <typename T>
concept Hashable = requires(const T& a) {
    { std::hash<T>{}(a) } -> std::convertible_to<std::size_t>;
};

template <typename T>
concept Shape = requires(const T& s) {
    { s.area() } -> std::floating_point;
    { s.name() } -> std::convertible_to<std::string_view>;
};

template <Shape S>
void print_area(const S& s) { std::cout << s.name() << ": " << s.area() << '\n'; }

void scale(std::integral auto factor);        // abbreviated form
template <typename T> requires std::copyable<T> && Hashable<T>
class Cache { /* ... */ };
```

Concepts give static polymorphism with interface-like checking but no vtables: every call is resolved at compile time.

- Pitfall: concepts check syntax, not semantics. `std::totally_ordered` cannot verify your `<` is actually a strict ordering.
- Interview tip: compare concepts with virtual interfaces: compile-time vs runtime dispatch, code size vs flexibility.

## 8. The Standard Library: Containers, Iterators, Algorithms

### std::vector, the default container
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/container/vector -->
`std::vector<T>` is a dynamic array: elements are stored contiguously on the heap, it grows automatically, and it frees its memory in the destructor. Contiguity makes it extremely cache-friendly, so it outperforms linked structures in most real workloads even for insertions in the middle of small collections.

It tracks size (elements in use) and capacity (allocated slots). When `push_back` exceeds capacity, it allocates a bigger buffer (typically 1.5x or 2x), moves the elements and frees the old buffer. This gives amortised O(1) appends.

```cpp
std::vector<Order> orders;
orders.reserve(expected_count);         // avoid repeated reallocations

orders.push_back(Order{101});           // constructs then moves
orders.emplace_back(102);               // constructs in place

for (const Order& o : orders) process(o);

// Remove all cancelled orders (C++20)
std::erase_if(orders, [](const Order& o) { return o.cancelled(); });

std::vector<int> grid(rows * cols, 0);  // flat 2D storage, index r*cols+c
```

- Pitfall: reallocation invalidates all pointers, references and iterators into the vector.
- Pitfall: `v.size() - 1` on an empty vector wraps to a huge unsigned value.
- Pitfall: `shrink_to_fit` is a non-binding request.
- Interview tip: "default to vector" is the standard answer; justify alternatives with measurements.

### Strings and string_view
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/string/basic_string_view -->
`std::string` owns a mutable sequence of `char`. Most implementations use the small string optimisation (SSO): short strings (around 15 to 22 characters) are stored inside the object itself without heap allocation.

`std::string_view` (C++17) is a non-owning view: just a pointer and a length. It is cheap to copy and accepts string literals, `std::string` and substrings without allocating, making it ideal for read-only function parameters.

```cpp
bool starts_with_api(std::string_view path) {
    return path.starts_with("/api/");    // C++20 member
}

std::vector<std::string_view> split(std::string_view s, char sep) {
    std::vector<std::string_view> parts;
    while (true) {
        auto pos = s.find(sep);
        parts.push_back(s.substr(0, pos));
        if (pos == std::string_view::npos) break;
        s.remove_prefix(pos + 1);
    }
    return parts;     // views into the caller's buffer
}

std::string line = "a,b,c";
auto fields = split(line, ',');   // valid while line is alive and unchanged
```

`std::string` is bytes, not characters. UTF-8 text stored in it has variable-width code points, so `size()` counts bytes.

- Pitfall: `string_view` is not guaranteed to be null-terminated; never pass `sv.data()` to a C API expecting a C string.
- Pitfall: returning a `string_view` into a local or temporary string dangles.
- Tip: C++23 adds `contains()` to both types.

### Associative containers: map and unordered_map
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/container/unordered_map -->
`std::map<K, V>` is an ordered balanced binary tree (usually red-black): O(log n) lookup, sorted iteration, and stable iterators. `std::unordered_map<K, V>` is a hash table: average O(1) lookup, no ordering. `std::set` and `std::unordered_set` are the key-only versions, and the `multi` variants allow duplicate keys.

Choose `unordered_map` for fast lookup by key, `map` when you need ordering, range queries (`lower_bound`) or deterministic iteration.

```cpp
std::unordered_map<std::string, int> word_count;
for (const auto& w : words) ++word_count[w];   // [] inserts 0 if missing

if (auto it = word_count.find("error"); it != word_count.end())
    std::cout << it->second;

word_count.try_emplace("warn", 0);             // no overwrite if present
word_count.insert_or_assign("info", 7);

std::map<int, std::string> by_time;            // sorted by timestamp
auto first_after = by_time.lower_bound(1700000000);

if (word_count.contains("debug")) {}           // C++20
```

Under the hood, `unordered_map` uses separate chaining with a node per element, so it allocates per insert and has poorer cache locality than open-addressing tables (such as Abseil or Boost `unordered_flat_map`). C++23 adds `std::flat_map`, a sorted-vector-backed map.

- Pitfall: `operator[]` inserts a default value on lookup; use `find` or `contains` for read-only checks, and it cannot be used on a const map.
- Pitfall: custom key types need `std::hash` specialisation and `==` for unordered containers.

### Other containers and adaptors
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/container -->
Beyond `vector` and the maps, know when each container fits:

- `std::deque`: fast push/pop at both ends, stored as chunks; references stay valid on end insertions.
- `std::list` / `std::forward_list`: doubly or singly linked lists. O(1) splice and insertion with an iterator, stable references, but poor cache locality. Rarely the right choice.
- `std::array`: fixed-size, stack allocated.
- Adaptors: `std::stack`, `std::queue` and `std::priority_queue` wrap an underlying container and restrict the interface.
- C++23 `std::flat_map`/`std::flat_set` keep sorted keys in contiguous storage: faster lookups and iteration, slower inserts.

```cpp
// Top-k largest with a min-heap
std::vector<int> top_k(const std::vector<int>& xs, std::size_t k) {
    std::priority_queue<int, std::vector<int>, std::greater<int>> heap;
    for (int x : xs) {
        heap.push(x);
        if (heap.size() > k) heap.pop();
    }
    std::vector<int> out;
    while (!heap.empty()) { out.push_back(heap.top()); heap.pop(); }
    return out;
}

std::deque<Task> work;
work.push_front(urgent);  work.push_back(normal);
```

- Pitfall: `std::priority_queue` is a max-heap by default; pass `std::greater` for a min-heap.
- Interview tip: big-O is not everything; a linear scan of a small vector often beats a tree lookup because of cache effects.

### Iterators and invalidation
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/iterator -->
Iterators are generalised pointers that let algorithms traverse any container uniformly. `begin()` points to the first element and `end()` one past the last. Iterator categories define capabilities: input, forward, bidirectional (`std::list`), random access (`std::deque`) and contiguous (`std::vector`, C++20 category). Algorithms require a minimum category, which is why `std::sort` does not work on a `std::list`.

Iterator invalidation is the key safety rule: modifying a container may make existing iterators, pointers and references dangle.

- `vector`: insertion invalidates everything if reallocation happens, otherwise everything at or after the insertion point. Erase invalidates at and after the erased element.
- `unordered_map`: rehashing invalidates iterators but not references to elements.
- `map`, `list`: only iterators to erased elements are invalidated.

```cpp
// Wrong: erase invalidates it, then ++it is UB
// for (auto it = v.begin(); it != v.end(); ++it) if (bad(*it)) v.erase(it);

// Right: use the iterator erase returns
for (auto it = sessions.begin(); it != sessions.end(); ) {
    if (it->second.expired()) it = sessions.erase(it);
    else ++it;
}

// Simplest (C++20)
std::erase_if(v, bad);
```

- Pitfall: range-based for loops hold iterators internally, so adding to a vector inside one is UB.
- Tip: debug STL modes (`-D_GLIBCXX_DEBUG`, MSVC debug iterators) detect invalidated iterator use.

### Standard algorithms
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/algorithm -->
`<algorithm>` and `<numeric>` provide well-tested, optimised building blocks: searching (`find`, `find_if`, `binary_search`, `lower_bound`), sorting (`sort`, `stable_sort`, `partial_sort`, `nth_element`), transforming (`transform`, `copy_if`), aggregating (`accumulate`, `reduce`, `count_if`) and set operations on sorted ranges.

Using algorithms instead of raw loops names your intent, avoids off-by-one errors and gives the library room to optimise. C++17 adds execution policies (`std::execution::par`) for parallel versions of many algorithms.

```cpp
std::vector<Employee> staff = load();

std::sort(staff.begin(), staff.end(),
          [](const Employee& a, const Employee& b) { return a.salary > b.salary; });

auto seniors = std::count_if(staff.begin(), staff.end(),
                             [](const Employee& e) { return e.years >= 10; });

double payroll = std::accumulate(staff.begin(), staff.end(), 0.0,
                                 [](double acc, const Employee& e) { return acc + e.salary; });

// Remove-erase idiom (pre-C++20)
staff.erase(std::remove_if(staff.begin(), staff.end(), [](auto& e) { return e.left; }),
            staff.end());
```

- Pitfall: `std::remove` does not shrink the container; it moves kept elements forward and returns the new logical end.
- Pitfall: the comparator for `sort` must be a strict weak ordering; using `<=` is UB and can crash.
- Pitfall: `std::accumulate(v.begin(), v.end(), 0)` with doubles sums as `int` because the init value is an int.

### Ranges and views (C++20)
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/ranges -->
The Ranges library lets algorithms take a whole container (`std::ranges::sort(v)`) instead of an iterator pair, and adds views: lazy, composable adaptors chained with `|`. A view does not own data or compute anything until iterated.

Range algorithms also support projections, which apply a member or function to each element before comparing, removing many small lambdas.

```cpp
#include <ranges>
namespace rv = std::views;

std::vector<Employee> staff = load();
std::ranges::sort(staff, std::greater{}, &Employee::salary);  // projection

auto names_of_seniors = staff
    | rv::filter([](const Employee& e) { return e.years >= 10; })
    | rv::transform(&Employee::name)
    | rv::take(5);

for (const std::string& n : names_of_seniors) std::cout << n << '\n';

for (int i : rv::iota(0, 5)) std::cout << i;          // 01234

// C++23
auto v = rv::iota(1, 4) | std::ranges::to<std::vector>();
for (auto [i, e] : rv::enumerate(staff)) {}
```

C++23 added `std::ranges::to`, `views::zip`, `views::enumerate`, `views::chunk` and `views::slide`, filling many gaps.

- Pitfall: views hold references into the underlying range; returning a view over a local container dangles.
- Pitfall: some views (like `filter`) cache state on first `begin()`, so iterating a const view may not compile.
- Interview tip: laziness means no intermediate vectors are allocated.

### optional, variant and any
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/utility/variant -->
These C++17 vocabulary types model common situations without pointers or sentinel values.

- `std::optional<T>`: a value that may be absent. Better than returning `-1` or `nullptr`. C++23 adds monadic operations `and_then`, `transform` and `or_else`.
- `std::variant<A, B, C>`: a type-safe tagged union holding exactly one of the alternatives. Process it with `std::visit` and the compiler checks that every case is handled.
- `std::any`: holds a value of any copyable type, with type checking at runtime. Rarely needed.

```cpp
std::optional<User> find_user(std::string_view email);

if (auto u = find_user("a@b.com")) greet(*u);
std::string name = find_user("x@y.com").transform(&User::name).value_or("guest"); // C++23

struct Click { int x, y; };
struct Key   { char c; };
struct Quit  {};
using Event = std::variant<Click, Key, Quit>;

template <class... Fs> struct overloaded : Fs... { using Fs::operator()...; };

void handle(const Event& e) {
    std::visit(overloaded{
        [](const Click& c) { std::cout << "click " << c.x << ',' << c.y; },
        [](const Key& k)   { std::cout << "key " << k.c; },
        [](const Quit&)    { std::cout << "quit"; },
    }, e);
}
```

Under the hood, a variant stores enough bytes for the largest alternative plus an index; no heap allocation.

- Pitfall: `*opt` on an empty optional is UB; `.value()` throws `std::bad_optional_access`.
- Interview tip: variant is the closed-set alternative to inheritance (good when types are fixed but operations grow).
