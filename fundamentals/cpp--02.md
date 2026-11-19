## 4. Functions

### Parameter passing: value, reference, const reference
<!-- level: basic; ref: https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Rf-conventional -->
How you declare a parameter communicates ownership and cost. The C++ Core Guidelines recommend a small set of conventions:

- Cheap-to-copy types (ints, pointers, small structs, `std::string_view`, `std::span`): pass by value.
- Read-only access to an expensive type: `const T&`.
- The function modifies the caller's object: `T&`.
- The function will keep its own copy (a "sink"): pass by value and `std::move` into place, so callers passing temporaries pay only a move.
- Ownership transfer of a heap object: `std::unique_ptr<T>` by value.

```cpp
struct User {
    std::string name;
    explicit User(std::string n) : name(std::move(n)) {}  // sink
};

bool is_admin(const User& u);            // read-only
void rename(User& u, std::string_view n) { u.name = n; }  // in-out
void adopt(std::unique_ptr<Session> s);  // takes ownership

User a{"ana"};                 // temporary moved, no extra copy
std::string n = "bo";
User b{n};                     // one copy, then a move
```

Returning by value is normally cheap thanks to copy elision and move semantics, so prefer returning results over output parameters.

- Pitfall: `const T` by value in a declaration adds nothing for callers; `const T&&` is almost never useful.
- Interview tip: explain why pass-by-value-then-move is good for constructors that store a string.

### Overloading and default arguments
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/overload_resolution -->
Several functions can share a name if their parameter lists differ. The compiler picks the best match at compile time through overload resolution, ranking candidates: exact match beats promotion (e.g. `char` to `int`), which beats standard conversion, which beats user-defined conversion. If two candidates tie, the call is ambiguous and fails to compile.

The compiler implements overloading through name mangling: the parameter types are encoded into the symbol name, which is why `extern "C"` is needed to call C++ functions from C (it disables mangling).

Default arguments fill in trailing parameters omitted by the caller. They are substituted at the call site, so they belong on the declaration in the header.

```cpp
void log(std::string_view msg);
void log(std::string_view msg, int code);
void log(int code);

void connect(std::string_view host, int port = 443, bool tls = true);

log("started");          // first overload
log(404);                // third overload
connect("example.com");  // port 443, tls true
```

- Pitfall: overloading `f(int)` and `f(char*)` and calling `f(0)` chooses `int`; `f(nullptr)` picks the pointer one.
- Pitfall: default arguments on virtual functions use the static type's default, not the overrider's.
- Tip: prefer distinct names when overloads would do semantically different things.

### Inline functions and the optimiser
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/inline -->
Today the `inline` keyword is mainly about linkage, not speed: it allows the same function definition to appear in multiple translation units (needed for functions defined in headers). Member functions defined inside a class body, `constexpr` functions and templates are implicitly inline.

Actual inlining, replacing a call with the function body, is decided by the optimiser at `-O2` and above regardless of the keyword. Inlining removes call overhead and, more importantly, exposes the body to further optimisations like constant folding and vectorisation. The cost is code size.

Because the optimiser can only inline what it can see, small hot functions are usually defined in headers. Link-Time Optimisation (LTO, `-flto`) lets the optimiser inline across translation units.

```cpp
// vec2.h
struct Vec2 {
    float x, y;
    float dot(const Vec2& o) const { return x * o.x + y * o.y; } // implicitly inline
};

inline float length_sq(Vec2 v) { return v.dot(v); }
```

```bash
g++ -O2 -flto a.cpp b.cpp -o app
```

- Pitfall: forcing everything inline bloats the binary and can hurt instruction-cache performance.
- Interview tip: say "the keyword controls ODR; the optimiser controls inlining".

## 5. Classes and RAII

### Classes, access control and member functions
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/classes -->
A class bundles data (members) with operations (member functions) and enforces invariants through access control. `public` members form the interface; `private` members are implementation details; `protected` members are visible to derived classes. `struct` and `class` are identical except the default access (public for struct, private for class).

By convention, use `struct` for plain data aggregates without invariants and `class` when you need to protect invariants.

```cpp
class BankAccount {
public:
    explicit BankAccount(std::string owner) : owner_(std::move(owner)) {}

    void deposit(long cents) {
        if (cents <= 0) throw std::invalid_argument("deposit must be positive");
        balance_ += cents;
    }
    long balance() const { return balance_; }

private:
    std::string owner_;
    long balance_ = 0;   // invariant: never negative
};
```

Under the hood, a non-virtual member function is just a regular function with a hidden `this` pointer parameter. Objects of a class without virtual functions contain only their data members (plus padding for alignment), so classes have no hidden runtime cost.

- Pitfall: member layout affects size; ordering members from largest to smallest reduces padding.
- Tip: mark single-argument constructors `explicit` to prevent surprising implicit conversions.

### Constructors and member initialiser lists
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/constructor -->
A constructor establishes the object's invariants. Members are initialised in the member initialiser list, before the constructor body runs. Assigning inside the body means the member was first default-constructed and then assigned, which is wasteful and impossible for `const` members, references and types without default constructors.

Members are always initialised in the order they are declared in the class, not the order written in the initialiser list. Compilers warn (`-Wreorder`) when these differ.

```cpp
class Connection {
public:
    Connection(std::string host, int port)
        : host_(std::move(host)), port_(port), socket_(open_socket(host_, port_)) {}

    Connection(std::string host) : Connection(std::move(host), 443) {}  // delegating

private:
    std::string host_;   // initialised first
    int port_;
    Socket socket_;      // uses host_ and port_, so must be declared after them
};
```

Special constructors: the default constructor (no arguments), copy constructor, move constructor. If you declare any constructor, the compiler no longer generates the default one; write `Connection() = default;` to get it back.

- Pitfall: calling a virtual function from a constructor dispatches to the class being constructed, not the derived override.
- Pitfall: if a constructor throws, the destructor of that object does not run, but already-constructed members are destroyed.

### Destructors and RAII
<!-- level: basic; ref: https://en.cppreference.com/w/cpp/language/raii -->
Resource Acquisition Is Initialisation (RAII) is the central idiom of C++. You tie a resource (memory, file handle, socket, mutex, database transaction) to the lifetime of an object: the constructor acquires it and the destructor releases it. Because destructors run automatically when an object goes out of scope, including during exception unwinding, the resource is always released exactly once.

This gives C++ deterministic cleanup without a garbage collector, and it works for every resource, not just memory.

```cpp
class File {
public:
    explicit File(const char* path) : f_(std::fopen(path, "rb")) {
        if (!f_) throw std::runtime_error("cannot open file");
    }
    ~File() { if (f_) std::fclose(f_); }

    File(const File&) = delete;             // a handle must not be copied
    File& operator=(const File&) = delete;

    std::FILE* get() const { return f_; }
private:
    std::FILE* f_;
};

void process() {
    File in("data.bin");
    parse(in.get());     // even if parse throws, the file is closed
}
```

Standard RAII types you use every day: `std::vector`, `std::string`, `std::unique_ptr`, `std::lock_guard`, `std::fstream`, `std::jthread`.

- Pitfall: destructors should not throw; they are implicitly `noexcept`, and throwing during unwinding calls `std::terminate`.
- Interview tip: RAII is the answer to "how does C++ avoid leaks without GC?"

### Operator overloading
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/operators -->
You can define operators for your own types so they read naturally: `a + b` for vectors, `==` for value types, `<<` for printing, `[]` for containers, `()` for function objects. Overloading is just syntax sugar for calling a function named `operator+` and so on.

Guidelines: keep semantics unsurprising, implement symmetric binary operators as non-member functions (so implicit conversions work on both sides), and implement `+` in terms of `+=`.

```cpp
struct Money {
    long cents = 0;

    Money& operator+=(Money o) { cents += o.cents; return *this; }
    friend Money operator+(Money a, Money b) { return a += b; }

    bool operator==(const Money&) const = default;             // C++20
    auto operator<=>(const Money&) const = default;            // C++20

    friend std::ostream& operator<<(std::ostream& os, Money m) {
        return os << m.cents / 100 << '.' << std::setw(2) << std::setfill('0') << m.cents % 100;
    }
};

Money total = Money{250} + Money{199};
```

In C++20, defaulting `operator<=>` (the three-way comparison or "spaceship") generates `<`, `<=`, `>`, `>=`, and defaulting `==` generates `!=`.

- Pitfall: never overload `&&`, `||` or `,`; overloaded versions lose short-circuit evaluation and sequencing.
- Pitfall: copy assignment must handle self-assignment (`a = a`).

### Inheritance and virtual functions
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/virtual -->
Inheritance lets a derived class reuse and extend a base class. Virtual functions enable runtime polymorphism: calling a virtual function through a base pointer or reference invokes the most-derived override.

Under the hood, each polymorphic class has a vtable (a table of function pointers) and each object stores a hidden vptr pointing to its class's vtable. A virtual call loads the vptr, indexes the table and calls indirectly. The cost is small, but it prevents inlining unless the compiler can devirtualise.

```cpp
class Shape {
public:
    virtual ~Shape() = default;           // essential for polymorphic deletion
    virtual double area() const = 0;      // pure virtual: Shape is abstract
};

class Circle final : public Shape {
public:
    explicit Circle(double r) : r_(r) {}
    double area() const override { return 3.14159265 * r_ * r_; }
private:
    double r_;
};

std::vector<std::unique_ptr<Shape>> shapes;
shapes.push_back(std::make_unique<Circle>(2.0));
for (const auto& s : shapes) std::cout << s->area() << '\n';
```

Always write `override`: the compiler then errors if the signature does not actually override anything (for example a missing `const`). `final` prevents further overriding and helps devirtualisation.

- Pitfall: deleting a derived object through a base pointer without a virtual destructor is undefined behaviour.
- Pitfall: object slicing: copying a `Circle` into a `Shape` by value cuts off the derived part.
- Interview tip: be able to sketch the vtable layout.

### Composition, interfaces and multiple inheritance
<!-- level: advanced; ref: https://isocpp.org/wiki/faq/multiple-inheritance -->
Inheritance creates the tightest coupling possible, so prefer composition (holding an object as a member) for reuse, and use public inheritance only for genuine "is-a" substitutability.

C++ has no `interface` keyword; an interface is an abstract class with only pure virtual functions and a virtual destructor. A class may implement several interfaces through multiple inheritance, which is safe and common.

Multiple inheritance of implementation can produce the "diamond": two bases sharing a common base. Without `virtual` inheritance, the derived object contains two copies of the shared base. Virtual inheritance keeps a single shared copy but adds complexity (the most-derived class initialises the virtual base).

```cpp
struct Readable { virtual ~Readable() = default; virtual std::size_t read(std::span<std::byte>) = 0; };
struct Writable { virtual ~Writable() = default; virtual void write(std::span<const std::byte>) = 0; };

class TcpStream : public Readable, public Writable {   // implements two interfaces
public:
    std::size_t read(std::span<std::byte> buf) override;
    void write(std::span<const std::byte> buf) override;
private:
    Socket sock_;          // composition, not inheritance
};
```

Static polymorphism alternatives avoid virtual calls entirely: templates, concepts, CRTP (`class Derived : Base<Derived>`) and `std::variant` with `std::visit`.

- Pitfall: protected data members break encapsulation just as public ones do.
- Interview tip: explain the diamond problem and when virtual inheritance is needed.

### Static members and friends
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/static -->
A `static` data member belongs to the class rather than to any object, so all instances share one copy. A `static` member function has no `this` pointer and can be called as `Class::fn()`. Since C++17, `inline static` members can be defined directly in the class body without a separate definition in a `.cpp` file.

A `friend` declaration grants a function or class access to private members. Friends are useful for operators that must be non-members (such as `operator<<`) and for tightly coupled helper classes, but overuse undermines encapsulation.

```cpp
class Order {
public:
    Order() : id_(next_id_++) {}
    static std::size_t created() { return next_id_ - 1; }

    friend std::ostream& operator<<(std::ostream& os, const Order& o) {
        return os << "Order#" << o.id_;
    }
private:
    inline static std::size_t next_id_ = 1;   // C++17
    std::size_t id_;
};
```

- Pitfall: a mutable static counter like the one above is a data race if objects are created from multiple threads; use `std::atomic<std::size_t>`.
- Pitfall: non-local statics across translation units have unspecified initialisation order.
- Tip: a "hidden friend" (defined inside the class) is only found by argument-dependent lookup, which keeps overload sets small and compile times down.

## 6. Copy and Move Semantics

### Rule of zero, three and five
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/rule_of_three -->
A class has five special member functions related to resource handling: destructor, copy constructor, copy assignment, move constructor and move assignment.

- Rule of three (C++98): if you need a custom destructor, copy constructor or copy assignment, you almost certainly need all three, because a custom destructor means you own a resource.
- Rule of five (C++11): add the move constructor and move assignment, otherwise copies are used where moves would be cheaper.
- Rule of zero: the best option. Let members that are already RAII types (`std::string`, `std::vector`, `std::unique_ptr`) manage resources, and write none of the five. The compiler-generated versions do the right thing member by member.

```cpp
// Rule of zero: nothing to write
class Document {
    std::string title_;
    std::vector<std::string> lines_;
    std::unique_ptr<Renderer> renderer_;   // makes Document move-only
};

// Rule of five: a raw-resource wrapper
class Buffer {
public:
    explicit Buffer(std::size_t n) : data_(new char[n]), size_(n) {}
    ~Buffer() { delete[] data_; }
    Buffer(const Buffer& o) : Buffer(o.size_) { std::memcpy(data_, o.data_, size_); }
    Buffer& operator=(Buffer o) noexcept { swap(o); return *this; }  // copy-and-swap
    Buffer(Buffer&& o) noexcept : data_(std::exchange(o.data_, nullptr)), size_(std::exchange(o.size_, 0)) {}
    void swap(Buffer& o) noexcept { std::swap(data_, o.data_); std::swap(size_, o.size_); }
private:
    char* data_; std::size_t size_;
};
```

- Pitfall: declaring a destructor suppresses the implicit move operations, silently turning moves into copies.
- Interview tip: say "rule of zero by default; rule of five only in low-level resource classes".

### Value categories and rvalue references
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/language/value_category -->
Every expression has a value category. Simplified: an lvalue has identity and a name you can take the address of (`x`, `v[0]`); a prvalue is a pure temporary (`42`, `make_string()`); an xvalue is an object about to expire, typically the result of `std::move(x)`. Rvalues are prvalues plus xvalues.

C++11 introduced rvalue references (`T&&`), which bind only to rvalues. This lets overloads distinguish "a temporary I may steal from" from "an object the caller still uses".

```cpp
void store(const std::string& s) { data.push_back(s); }          // copies
void store(std::string&& s)      { data.push_back(std::move(s)); } // steals

std::string name = "alice";
store(name);              // lvalue: copy overload
store(name + "!");        // prvalue: move overload
store(std::move(name));   // xvalue: move overload; name now valid but unspecified
```

Important subtlety: a named rvalue reference is itself an lvalue. Inside `store(std::string&& s)`, `s` has a name, so you must `std::move(s)` again to pass it on as an rvalue.

- Pitfall: after moving from an object, only assign to it or destroy it unless the type documents its moved-from state (standard containers are valid but unspecified, typically empty).
- Interview tip: explain that `std::move` does not move; it is a cast to an rvalue reference.

### std::move and move constructors
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/utility/move -->
Move semantics let an object transfer its resources instead of duplicating them. Moving a `std::vector` with a million elements copies three pointers and leaves the source empty; copying would allocate and copy a million elements.

`std::move(x)` is just `static_cast<T&&>(x)`. It marks `x` as movable so overload resolution picks the move constructor or move assignment. The actual work happens in those functions, which typically steal pointers and reset the source.

```cpp
class Image {
public:
    Image(Image&& other) noexcept
        : pixels_(std::move(other.pixels_)), w_(std::exchange(other.w_, 0)), h_(std::exchange(other.h_, 0)) {}

    Image& operator=(Image&& other) noexcept {
        pixels_ = std::move(other.pixels_);
        w_ = std::exchange(other.w_, 0);
        h_ = std::exchange(other.h_, 0);
        return *this;
    }
private:
    std::vector<std::uint8_t> pixels_;
    int w_ = 0, h_ = 0;
};
```

Mark move operations `noexcept`. `std::vector` uses the move constructor when reallocating only if it cannot throw (to keep the strong exception guarantee); otherwise it falls back to copying.

- Pitfall: `return std::move(local);` usually prevents copy elision and makes code slower. Just `return local;`.
- Pitfall: moving a `const` object silently copies, because `const T&&` cannot bind to the move constructor.

### Copy elision and RVO
<!-- level: intermediate; ref: https://en.cppreference.com/w/cpp/language/copy_elision -->
Copy elision lets the compiler construct a returned object directly in the caller's storage, skipping copies and moves entirely.

- Since C++17, returning a prvalue (`return Widget{...};`) is guaranteed elision: no copy or move constructor is even required to exist.
- Named Return Value Optimisation (NRVO), returning a named local (`Widget w; ...; return w;`), is permitted but not guaranteed. All major compilers do it in simple cases. If NRVO does not happen, the local is implicitly moved.

Under the hood, the caller reserves space for the result and passes a hidden pointer to it; the callee constructs the object at that address.

```cpp
std::vector<int> make_primes(int limit) {
    std::vector<int> primes;            // NRVO: built directly in caller's slot
    for (int n = 2; n < limit; ++n)
        if (is_prime(n)) primes.push_back(n);
    return primes;                      // no copy, at worst a move
}

auto p = make_primes(1000);

std::mutex make_mutex() { return std::mutex{}; }  // OK in C++17 though mutex is not movable
```

Why it matters: returning large objects by value is idiomatic and cheap, so APIs do not need output parameters.

- Pitfall: returning different named objects from different branches can defeat NRVO (a move happens instead).
- Interview tip: mention guaranteed elision is about prvalues and changed the language rules, not just optimisation.

### Perfect forwarding
<!-- level: advanced; ref: https://en.cppreference.com/w/cpp/utility/forward -->
Generic wrappers (factory functions, `emplace_back`, logging decorators) need to pass arguments to another function exactly as they were received: lvalues as lvalues, rvalues as rvalues. This is perfect forwarding.

It relies on forwarding references: in a template, a parameter declared `T&&` where `T` is deduced binds to anything. If an lvalue is passed, `T` deduces to `U&` and reference collapsing makes the parameter `U&`. If an rvalue is passed, `T` is `U` and the parameter is `U&&`. `std::forward<T>(arg)` then casts back to the original category.

```cpp
template <typename T, typename... Args>
std::unique_ptr<T> make_tracked(Args&&... args) {
    log_allocation(typeid(T).name());
    return std::make_unique<T>(std::forward<Args>(args)...);
}

std::string host = "db.local";
auto c1 = make_tracked<Connection>(host, 5432);              // host copied
auto c2 = make_tracked<Connection>(std::string("x"), 5432);  // moved
```

Reference collapsing rules: `& &`, `& &&` and `&& &` collapse to `&`; only `&& &&` gives `&&`.

- Pitfall: `T&&` is only a forwarding reference when `T` is deduced for that function call. `std::vector<T>&&` or a class template's `T&&` in a member function is a plain rvalue reference.
- Pitfall: forward an argument at most once; forwarding twice may move from it twice.
- Interview tip: contrast `std::move` (unconditional cast) with `std::forward` (conditional cast).
