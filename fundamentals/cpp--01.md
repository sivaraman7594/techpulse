## 1. How C++ Programs Are Built

### The compilation model
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/translation_phases -->
C++ is compiled ahead of time into native machine code. Building a program happens in three stages, and knowing them explains most confusing build errors.

1. Preprocessing: the preprocessor handles `#include`, `#define` and `#if`. An `#include` literally pastes the header text into the file. The result is a translation unit (TU).
2. Compilation: each TU is compiled independently into an object file (`.o` / `.obj`) containing machine code plus a symbol table of what it defines and what it needs.
3. Linking: the linker combines object files and libraries, resolving every symbol reference to exactly one definition, and produces an executable or library.

Because each `.cpp` file is compiled alone, the compiler only knows about functions it has seen declared in that TU. That is why headers exist: they carry declarations to every TU that needs them.

```bash
g++ -std=c++20 -Wall -Wextra -c math.cpp -o math.o   # compile only
g++ -std=c++20 -Wall -Wextra -c main.cpp -o main.o
g++ main.o math.o -o app                              # link
./app
```

- Pitfall: "undefined reference" is a linker error (definition missing or not linked), not a compiler error.
- Interview tip: separate compilation is why changing one header can trigger a rebuild of hundreds of files.

### Declarations, definitions and the ODR
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/definition -->
A declaration introduces a name and its type ("this function exists"). A definition provides the actual body or storage. You may declare something many times, but the One Definition Rule (ODR) says a non-inline function or variable must be defined exactly once in the whole program.

Headers should therefore contain declarations, class definitions, templates and `inline` functions. Ordinary function bodies and global variable definitions belong in `.cpp` files. Include guards (or `#pragma once`) stop a header from being pasted twice into the same TU.

```cpp
// math.h
#pragma once
int add(int a, int b);          // declaration
inline int twice(int x) { return 2 * x; }  // inline: OK in header
extern int counter;             // declaration of a global

// math.cpp
#include "math.h"
int add(int a, int b) { return a + b; }    // the one definition
int counter = 0;
```

Under the hood, `inline` tells the linker that identical definitions in multiple object files are allowed and it may keep any one of them. Since C++17, `inline` variables work the same way for globals and static members.

- Pitfall: defining a normal function in a header compiles fine but fails at link time with "multiple definition".
- Pitfall: ODR violations where two TUs see different definitions of the same class are undefined behaviour and often undiagnosed.

### Linkage and storage duration
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/storage_duration -->
Linkage controls whether a name in one TU refers to the same entity as that name in another TU. Storage duration controls how long the object lives.

- External linkage: visible to other TUs (default for non-const globals and functions).
- Internal linkage: private to the TU. Get it with `static` at namespace scope or, preferably, an unnamed namespace.
- Automatic storage: local variables, destroyed at end of scope.
- Static storage: globals and `static` locals, alive for the whole program.
- Dynamic storage: created with `new`, lives until `delete`.
- Thread storage: `thread_local`, one instance per thread.

```cpp
namespace {                 // internal linkage: helpers only this file sees
int hits = 0;
}

int& instance_counter() {
    static int count = 0;   // initialised once, thread-safe since C++11
    return count;
}
```

Function-local statics are initialised the first time control passes through, and the compiler inserts a guard so concurrent first calls are safe. This is the "Meyers singleton" pattern and also avoids the static initialisation order fiasco, where globals in different TUs depend on each other with unspecified initialisation order.

- Interview tip: prefer unnamed namespaces over `static` for file-private helpers; it also works for types.

### Your first program and iostreams
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/io -->
Every program starts at `main`, which returns an `int` exit code (0 means success; falling off the end of `main` implicitly returns 0). The standard library lives in namespace `std`. Console I/O traditionally uses streams: `std::cout` for output, `std::cin` for input, `std::cerr` for unbuffered errors.

Streams are type-safe: `operator<<` is overloaded for each type, so there are no format-string mismatches like in `printf`. C++23 adds `std::print`, which combines type safety with format strings and is usually faster.

```cpp
#include <iostream>
#include <string>

int main() {
    std::string name;
    std::cout << "Name? ";
    if (!(std::cin >> name)) {          // stream converts to false on failure
        std::cerr << "read failed\n";
        return 1;
    }
    std::cout << "Hello, " << name << '\n';
}
```

- Pitfall: `std::endl` writes a newline and flushes. Flushing in a tight loop is slow; use `'\n'`.
- Pitfall: `using namespace std;` in a header pollutes every file that includes it.
- Tip: for fast competitive-style I/O, `std::ios::sync_with_stdio(false);` decouples streams from C stdio.

## 2. Types, Values and Expressions

### Fundamental types and their sizes
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/types -->
C++ has built-in arithmetic types: `bool`, `char`, `short`, `int`, `long`, `long long` (plus `unsigned` versions), `float`, `double` and `long double`. The standard only guarantees minimum ranges, so `int` is at least 16 bits and `long` is 32 bits on Windows but 64 bits on 64-bit Linux.

When the exact width matters (file formats, network protocols, hashing) use the fixed-width aliases in `<cstdint>`: `std::int32_t`, `std::uint64_t` and so on. Use `std::size_t` for sizes and indices returned by containers.

Integer behaviour differs by signedness: unsigned arithmetic wraps modulo 2^N, while signed overflow is undefined behaviour, which lets the optimiser assume it never happens. Mixed signed/unsigned comparisons convert the signed value to unsigned, a classic bug source.

```cpp
#include <cstdint>
#include <vector>

std::uint32_t crc = 0xFFFFFFFFu;
std::vector<int> v{1, 2, 3};
int i = -1;
bool bad = i < v.size();   // false! -1 converts to a huge unsigned value
bool ok  = std::cmp_less(i, v.size());  // C++20 safe comparison: true
```

- Pitfall: `float` has about 7 significant digits; use `double` by default and never compare floating values with `==` after arithmetic.
- Interview tip: `sizeof(char)` is always 1, but a byte is not guaranteed to be 8 bits (it is on every mainstream platform).

### auto and type deduction
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/auto -->
`auto` asks the compiler to deduce a variable's type from its initialiser. It uses the same rules as template argument deduction: top-level `const` and references are dropped. Write `auto&`, `const auto&` or `auto&&` when you want a reference.

`decltype(expr)` gives the declared type of an expression without evaluating it, preserving references. `decltype(auto)` deduces using `decltype` rules, useful for forwarding return types.

```cpp
std::map<std::string, int> ages{{"ana", 31}};

auto it = ages.find("ana");          // std::map<...>::iterator
for (const auto& [name, age] : ages) // structured bindings (C++17), no copies
    std::cout << name << ' ' << age << '\n';

const int x = 5;
auto a = x;          // int (const dropped)
auto& r = x;         // const int&
decltype(x) b = 7;   // const int
```

Why it matters: `auto` avoids long iterator types, prevents accidental conversions (`int n = v.size();` silently narrows) and keeps code correct when types change.

- Pitfall: `auto x = {1, 2};` deduces `std::initializer_list<int>`, not an int.
- Pitfall: `for (auto p : map)` copies every pair; use `const auto&`.
- Pitfall: `auto` with proxy types such as `std::vector<bool>::reference` may hold a reference to a temporary.

### const, constexpr and consteval
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/constexpr -->
`const` means "I promise not to modify this through this name". It documents intent and lets the compiler catch mistakes. On member functions, `const` means the function does not modify the object, so it can be called on const objects.

`constexpr` means the value or function can be evaluated at compile time. A `constexpr` variable must be initialised with a constant expression. A `constexpr` function may run at compile time when given constant arguments, and at run time otherwise. Since C++20 `consteval` forces compile-time evaluation, and `constinit` guarantees a static variable is initialised at compile time (avoiding initialisation order problems) without making it const.

```cpp
constexpr std::size_t kBufSize = 4096;

constexpr unsigned long long factorial(int n) {
    return n <= 1 ? 1 : n * factorial(n - 1);
}
static_assert(factorial(5) == 120);   // checked by the compiler

consteval int square(int x) { return x * x; }
int arr[square(4)];                   // 16, always compile time

class Account {
    double balance_ = 0;
public:
    double balance() const { return balance_; } // callable on const Account
};
```

- Pitfall: `const int* p` (pointer to const int) differs from `int* const p` (const pointer). Read right to left.
- Interview tip: constexpr moves work and error detection to compile time; C++20 even allows `std::vector` and `std::string` inside constexpr functions (transiently).

### Initialisation and narrowing
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/list_initialization -->
C++ has several initialisation syntaxes, and they behave differently:

- Copy init: `int x = 3;`
- Direct init: `std::string s("hi");`
- List (brace) init: `int y{3};` or `std::vector<int> v{1, 2, 3};`
- Value init: `int z{};` gives zero.
- Default init: `int w;` leaves a local uninitialised, so reading it is UB.

Brace initialisation is often called uniform initialisation. Its key safety benefit is that it rejects narrowing conversions such as `double` to `int`. Its gotcha is that if a class has a constructor taking `std::initializer_list`, braces strongly prefer it.

```cpp
double d = 3.7;
int a = d;        // compiles, silently 3
// int b{d};      // error: narrowing conversion

std::vector<int> v1(3, 7);  // {7, 7, 7}
std::vector<int> v2{3, 7};  // {3, 7}  initializer_list wins

struct Point { int x = 0; int y = 0; };
Point p{.x = 1, .y = 2};   // designated initialisers (C++20)
```

Default member initialisers (`int x = 0;` inside the class) are the simplest way to ensure members are never left with garbage values.

- Pitfall: uninitialised locals are a top source of heisenbugs; compile with `-Wall` and initialise everything.
- Interview tip: explain the `vector(3, 7)` vs `vector{3, 7}` difference.

### Scoped enums
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/enum -->
Classic C-style enums leak their enumerator names into the enclosing scope and implicitly convert to `int`, which allows nonsense like comparing a colour to a weekday. C++11 scoped enums (`enum class`) fix both: names must be qualified and there is no implicit conversion.

You can also choose the underlying type, which controls size and allows forward declaration. C++20 adds `using enum` to bring enumerators into a local scope, handy inside a `switch`. C++23 adds `std::to_underlying` for explicit conversion.

```cpp
enum class OrderState : std::uint8_t { Pending, Paid, Shipped, Cancelled };

std::string_view label(OrderState s) {
    switch (s) {
        using enum OrderState;         // C++20
        case Pending:   return "pending";
        case Paid:      return "paid";
        case Shipped:   return "shipped";
        case Cancelled: return "cancelled";
    }
    return "unknown";
}

auto raw = std::to_underlying(OrderState::Paid);  // C++23, gives 1
```

Why it matters: enums make state machines readable, and with `-Wswitch` the compiler warns when you add an enumerator but forget to handle it in a switch without a `default`.

- Pitfall: casting an arbitrary integer into an enum is allowed if it fits the underlying type, so validate data from files or the network.
- Tip: omit `default:` in switches over enums so the compiler can flag missing cases.

### Casts
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/static_cast -->
C++ replaces the all-powerful C cast `(T)x` with four named casts, each with a narrow purpose so dangerous conversions are easy to find in code review.

- `static_cast`: well-defined conversions such as `double` to `int`, enum to integer, or base pointer to derived when you know the dynamic type.
- `dynamic_cast`: checked downcast in polymorphic hierarchies. Returns `nullptr` for pointers (or throws `std::bad_cast` for references) on failure. Uses RTTI at run time.
- `const_cast`: adds or removes `const`. Modifying an object that was originally const is still UB.
- `reinterpret_cast`: reinterprets bits, for example pointer to integer. Very low level and mostly non-portable.

C++20 adds `std::bit_cast` for safely reinterpreting the bytes of one trivially copyable type as another, replacing the old (UB-prone) pointer-punning tricks.

```cpp
double ratio = 0.75;
int pct = static_cast<int>(ratio * 100);

void handle(Shape* s) {
    if (auto* c = dynamic_cast<Circle*>(s)) {
        c->set_radius(2.0);
    }
}

float f = 1.0f;
auto bits = std::bit_cast<std::uint32_t>(f);  // 0x3F800000
```

- Pitfall: a C-style cast silently becomes a `reinterpret_cast` or `const_cast` when needed. Avoid it.
- Interview tip: heavy use of `dynamic_cast` often signals a missing virtual function.

## 3. Pointers, References and Memory

### Pointers
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/pointer -->
A pointer is a variable that holds a memory address. `&x` takes the address of `x`; `*p` dereferences the pointer to reach the object. Pointers can be reassigned, can be null (`nullptr`), and support arithmetic within an array.

Under the hood, a pointer is just an address-sized integer (8 bytes on 64-bit systems). The type tells the compiler how to interpret the bytes and how far `p + 1` moves (by `sizeof(T)`).

```cpp
int values[4] = {10, 20, 30, 40};
int* p = values;          // array decays to pointer to first element
p += 2;
std::cout << *p << '\n';  // 30

int* missing = nullptr;
if (missing) { /* never dereference without checking */ }

struct Node { int value; Node* next; };
Node b{2, nullptr};
Node a{1, &b};
std::cout << a.next->value; // -> is (*a.next).value
```

In modern C++, raw pointers should be non-owning: they observe an object someone else owns. Ownership is expressed with smart pointers or containers.

- Pitfall: dereferencing null, a dangling pointer (object already destroyed) or a pointer past the end of an array is undefined behaviour.
- Pitfall: use `nullptr`, not `NULL` or `0`. `nullptr` has its own type and cannot be confused with an integer in overload resolution.
- Interview tip: be ready to explain pointer arithmetic and why `sizeof(arr)` differs from `sizeof(ptr)`.

### References
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/reference -->
A reference is an alias for an existing object. Once bound, it always refers to the same object; it cannot be null or reseated. Using a reference looks like using the object itself, with no `*` or `->`.

References are mostly used for function parameters and return values. Passing `const T&` avoids copying large objects while promising not to modify them; passing `T&` signals an "out" or "in-out" parameter.

A special rule: binding a temporary to a `const T&` (or `T&&`) local reference extends the temporary's lifetime to that of the reference.

```cpp
void normalise(std::string& s) {           // modifies caller's string
    for (char& c : s) c = std::tolower(static_cast<unsigned char>(c));
}

std::size_t count_words(const std::string& text);  // read-only, no copy

int x = 1;
int& alias = x;
alias = 5;          // x is now 5

const std::string& tmp = std::string("hi"); // lifetime extended
```

Under the hood a reference is usually implemented as a pointer, but the language guarantees it is bound to a valid object at creation.

- Pitfall: returning a reference to a local variable gives a dangling reference. Compilers warn; heed it.
- Pitfall: lifetime extension does not propagate through function calls, e.g. `const auto& s = make_obj().name();` may dangle.
- Interview tip: pointer vs reference: nullability, reseating, and syntax.

### Stack, heap and new/delete
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/new -->
Local variables live on the stack: allocation is just moving the stack pointer, so it is extremely fast, and objects are destroyed automatically at the end of the scope. The stack is small (often 1 to 8 MB), so large or long-lived data goes on the heap (free store).

`new T(args)` allocates heap memory and constructs an object; `delete p` destroys it and frees the memory. Arrays use `new T[n]` and `delete[] p`. Mixing the forms is undefined behaviour.

```cpp
void legacy() {
    Widget* w = new Widget(42);
    w->run();          // if run() throws, the delete below never runs: leak
    delete w;
}

void modern() {
    auto w = std::make_unique<Widget>(42);  // freed automatically
    w->run();
    std::vector<double> samples(1'000'000); // heap buffer managed by vector
}
```

Heap allocation calls into an allocator (malloc and friends), which may take locks and fragment memory, so it is much slower than stack allocation. Hot loops should avoid repeated allocation.

- Pitfall: manual `new`/`delete` leads to leaks, double frees and use-after-free. In modern code, a naked `new` is almost always a code smell.
- Pitfall: deep recursion or huge local arrays cause stack overflow.
- Interview tip: say "use containers and smart pointers; never write `delete` in application code".

### Arrays, std::array and decay
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/container/array -->
C arrays (`int a[10]`) have a fixed size known at compile time, but they "decay" into a pointer to their first element when passed to a function, losing the size. They cannot be copied or assigned with `=`.

`std::array<T, N>` wraps a C array with zero overhead and behaves like a normal value: it can be copied, compared, returned from functions, and knows its `size()`. For runtime-sized data use `std::vector`. To pass a view of contiguous elements without copying, use `std::span` (C++20).

```cpp
#include <array>
#include <span>

void legacy(int* data, std::size_t n);   // size travels separately

double average(std::span<const double> xs) {
    double sum = 0;
    for (double x : xs) sum += x;
    return xs.empty() ? 0 : sum / xs.size();
}

std::array<double, 3> temps{20.5, 21.0, 19.8};
std::vector<double> more{1, 2, 3, 4};
average(temps);   // works with array
average(more);    // and vector, no copy
```

- Pitfall: `sizeof(param)` inside a function taking `int param[]` gives the pointer size, not the array size.
- Pitfall: `operator[]` does not check bounds; `at()` does and throws `std::out_of_range`.
- Tip: hardened standard libraries (for example libc++ hardening modes or `_GLIBCXX_ASSERTIONS`) add cheap bounds checks to `operator[]`.

### Object lifetime and dangling
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/lifetime -->
Every object has a lifetime: it begins when construction completes and ends when the destructor starts (or storage is released). Accessing an object outside its lifetime is undefined behaviour, and it is the root cause of most C++ memory-safety bugs.

Common ways to create a dangling pointer, reference or view:

- Returning a pointer or reference to a local variable.
- Keeping an iterator or pointer into a `std::vector` and then calling `push_back`, which may reallocate.
- Storing a `std::string_view` to a temporary string.
- A lambda capturing a local by reference and running after the function returns.

```cpp
std::string_view first_word(const std::string& s) {
    return std::string_view(s).substr(0, s.find(' '));
}

auto w = first_word("hello world");   // temporary std::string destroyed
std::cout << w;                       // UB: view dangles

std::vector<int> v{1, 2, 3};
int& ref = v[0];
v.push_back(4);                       // may reallocate
ref = 10;                             // UB if it did
```

Temporaries live until the end of the full expression that created them, which is why passing a temporary into a function is fine but storing a view of it is not.

- Tip: AddressSanitizer catches most use-after-free and stack-use-after-return bugs at runtime.
- Interview tip: describe lifetime issues as "who owns this, and does the owner outlive every user?"
