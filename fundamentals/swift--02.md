## 1. Protocols and generics

### Protocols
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/protocols/ -->
A protocol defines a blueprint of methods, properties, and initialisers that conforming types must provide. Structs, enums, classes and actors can all conform, so protocols give abstraction without forcing inheritance. They are the backbone of dependency injection and testing in Swift.

```swift
protocol Storage {
  func save(_ data: Data, key: String) throws
  func load(key: String) throws -> Data?
}

struct DiskStorage: Storage { /* writes files */ 
  func save(_ data: Data, key: String) throws {}
  func load(key: String) throws -> Data? { nil }
}

final class Repo {
  private let storage: Storage
  init(storage: Storage) { self.storage = storage }
}
```

Inject a fake `Storage` in tests.

Pitfalls:
- Protocol requirements are dynamically dispatched, but methods added only in extensions are statically dispatched.
- Class-only protocols use `AnyObject` and allow `weak` references.

Interview tip: say "program to protocols, not concrete types", then give the testing example.

### Protocol extensions and default implementations
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/protocols/#Protocol-Extensions -->
A protocol extension supplies default method bodies to every conforming type, and can be constrained with `where`. This is the basis of protocol-oriented programming and how much of the standard library, such as `Sequence.map`, is implemented.

```swift
protocol Describable { var name: String { get } }

extension Describable {
  func describe() -> String { "I am \(name)" }
}

extension Collection where Element: Describable {
  func names() -> [String] { map(\.name) }
}
```

Dispatch rule: a method declared in the protocol is dispatched dynamically, so a conforming type's implementation wins. A method that exists only in the extension is statically dispatched on the declared type.

Pitfalls:
- Forgetting to declare the method in the protocol makes the default run even when a type "overrides" it, if called through the protocol type.

Interview tip: demonstrate the static-versus-dynamic dispatch surprise.

### Associated types and PATs
<!-- level: advanced; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/generics/#Associated-Types -->
An associated type is a placeholder type within a protocol, set by each conformer. A protocol with associated types (PAT), such as `Sequence` (`Element`) or `Collection` (`Index`), cannot be used as a plain concrete type without `some` or `any`, because the compiler needs to know the associated type.

```swift
protocol Repository {
  associatedtype Item
  func all() async throws -> [Item]
  func add(_ item: Item) async throws
}

struct UserRepo: Repository {
  func all() async throws -> [User] { [] }
  func add(_ item: User) async throws {}
}

func printAll<R: Repository>(_ r: R) async throws where R.Item: CustomStringConvertible {
  for i in try await r.all() { print(i) }
}
```

Primary associated types (Swift 5.7) allow `any Collection<Int>` or `some Sequence<String>`.

Pitfalls:
- "Protocol can only be used as a generic constraint" errors come from missing `some`/`any`.

Interview tip: be able to say why `[Repository]` is not valid but `[any Repository]` is (Swift 5.7+).

### some versus any
<!-- level: advanced; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/opaquetypes/ -->
`some P` is an opaque type: one specific concrete type, chosen by the implementation, hidden from the caller, and resolved at compile time with static dispatch. `any P` is an existential: a box that can hold any conforming type at runtime, with dynamic dispatch and extra indirection. SwiftUI's `var body: some View` uses opaque types so the full generic view type is preserved for the compiler.

```swift
func makeShape() -> some Shape { Circle() }     // always Circle

let shapes: [any Shape] = [Circle(), Square()]  // heterogeneous

func area(of s: some Shape) -> Double { s.area }  // generic shorthand
```

Swift 6 language mode requires `any` for existential types in more places (explicit `any` is mandatory for protocols with associated types since Swift 5.7).

Pitfalls:
- Returning different concrete types from branches of a `some` function does not compile.
- Existentials cannot be compared with `==` just because the underlying types are Equatable.

Interview tip: prefer `some` or generics for performance, `any` when heterogeneity is needed.

### Generics and constraints
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/generics/ -->
Generic functions and types abstract over types while remaining type-safe and, in optimised builds, specialised to avoid overhead. Constraints say what operations are available, using protocol conformance or class inheritance.

```swift
func largest<T: Comparable>(_ items: [T]) -> T? {
  items.max()
}

struct Stack<Element> {
  private var items: [Element] = []
  mutating func push(_ e: Element) { items.append(e) }
  mutating func pop() -> Element? { items.popLast() }
}

extension Stack: Equatable where Element: Equatable {}
```

Conditional conformance (`extension Stack: Equatable where Element: Equatable`) lets a type conform only when its parameters do.

Pitfalls:
- Unspecialised generic code across module boundaries can be slow; `@inlinable` and `@_specialize` help in libraries.
- Over-constraining generics reduces reuse; constrain to what you use.

Interview tip: explain how Swift generics differ from Java erasure (they can be specialised at compile time).

### where clauses and generic extensions
<!-- level: advanced; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/generics/#Generic-Where-Clauses -->
`where` clauses add precise requirements: equal associated types, protocol conformance of an associated type, or same-type constraints. They appear on functions, extensions and conformances.

```swift
func allEqual<C: Collection>(_ c: C) -> Bool
  where C.Element: Equatable {
  guard let first = c.first else { return true }
  return c.allSatisfy { $0 == first }
}

func merge<A: Sequence, B: Sequence>(_ a: A, _ b: B) -> [A.Element]
  where A.Element == B.Element {
  Array(a) + Array(b)
}
```

Parameter packs (`each T`, Swift 5.9) generalise to variable-length generics.

Pitfalls:
- Same-type constraints that are impossible to satisfy produce confusing errors; simplify the signature first.

Interview tip: use `where` to express relationships between associated types.

## 2. Closures

### Closure syntax and trailing closures
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/closures/ -->
A closure is an anonymous function that can capture values from its context. The full syntax is `{ (params) -> Return in body }`, but Swift infers types, allows omitting `return` for single expressions, and offers shorthand `$0`, `$1`. A trailing closure moves the last closure argument outside the parentheses.

```swift
let numbers = [3, 1, 2]
let sorted = numbers.sorted { $0 < $1 }
let doubled = numbers.map { n in n * 2 }

func fetch(completion: @escaping (Result<Data, Error>) -> Void) { /* ... */ }
fetch { result in
  if case .success(let data) = result { print(data.count) }
}
```

Closures are reference types: two variables can share the same closure and its captured state.

Pitfalls:
- Overusing `$0` in long closures hurts readability.
- Multiple trailing closures changed syntax in Swift 5.3; labels are required after the first.

Interview tip: be ready to rewrite a long closure down to the shortest legal form.

### Escaping closures and capture lists
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/closures/#Escaping-Closures -->
A non-escaping closure parameter (the default) must be used before the function returns. An `@escaping` closure may be stored or called later, so it can outlive the call, and in classes it must use `self` explicitly. Capture lists `[weak self]` or `[unowned self]` control how captured references are held.

```swift
final class Loader {
  var onDone: (() -> Void)?
  var items: [Int] = []

  func start() {
    api.fetch { [weak self] result in
      guard let self else { return }
      self.items = result
      self.onDone?()
    }
  }
}
```

Capturing a value type in the list (`[count]`) copies it at closure creation time.

Pitfalls:
- A closure stored on `self` that captures `self` strongly is a retain cycle.
- `unowned` crashes if the object is gone; use it only when lifetimes are guaranteed.

Interview tip: explain which closures need `[weak self]`: escaping closures stored by the object they capture.

### Higher-order functions
<!-- level: basic; ref: https://developer.apple.com/documentation/swift/sequence -->
`map` transforms elements, `filter` selects, `reduce` folds into one value, `compactMap` transforms and drops nils, `flatMap` flattens nested sequences, `sorted(by:)` orders, and `allSatisfy`/`contains(where:)` test conditions. Chains read declaratively but each step may create an intermediate array.

```swift
struct Order { let items: [Item]; let paid: Bool }

let revenue = orders
  .filter(\.paid)
  .flatMap(\.items)
  .reduce(0) { $0 + $1.price }

let grouped = Dictionary(grouping: items, by: \.category)
```

Key paths work as functions (`map(\.name)`) since Swift 5.2.

Pitfalls:
- `reduce(into:)` is faster than `reduce` for building collections, because it avoids copying.
- Side effects inside `map` are a smell; use `forEach` or a loop.

Interview tip: use `lazy` to stop at the first match without building arrays.

### @autoclosure and result builders
<!-- level: advanced; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/attributes/ -->
`@autoclosure` wraps an argument expression into a closure automatically, delaying evaluation. It powers `assert`, `&&`, `??` and logging APIs where the message should only be built if needed. Result builders (`@resultBuilder`) turn a sequence of statements into a combined value, which is how SwiftUI's `@ViewBuilder` works.

```swift
func log(_ message: @autoclosure () -> String, enabled: Bool) {
  if enabled { print(message()) }       // string built only when enabled
}
log("state: \(expensiveDump())", enabled: false)  // no cost

@resultBuilder
struct ArrayBuilder {
  static func buildBlock(_ parts: Int...) -> [Int] { parts }
}
@ArrayBuilder func nums() -> [Int] { 1; 2; 3 }
```

Pitfalls:
- Hidden laziness can surprise callers; document autoclosure parameters.
- Result builders have limited control flow support unless implemented.

Interview tip: link `@ViewBuilder` to result builders to show you understand how SwiftUI syntax compiles.

## 3. Error handling

### throws, try and do-catch
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/errorhandling/ -->
A function marked `throws` can fail by throwing any value conforming to `Error`. Callers must mark calls with `try` and handle errors with `do-catch`, propagate with their own `throws`, or convert them. Errors are usually enums.

```swift
enum ParseError: Error { case empty, invalid(String) }

func parse(_ s: String) throws -> Int {
  guard !s.isEmpty else { throw ParseError.empty }
  guard let n = Int(s) else { throw ParseError.invalid(s) }
  return n
}

do {
  let n = try parse(input)
} catch ParseError.invalid(let text) {
  print("bad: \(text)")
} catch {
  print("other: \(error)")
}
```

Pitfalls:
- A bare `catch` hides specific cases; order specific catches first.
- Swift errors are not exceptions with stack unwinding; they are ordinary return paths, so they are cheap.

Interview tip: contrast Swift error handling with Objective-C `NSError**` and Java exceptions.

### try?, try! and Result
<!-- level: basic; ref: https://developer.apple.com/documentation/swift/result -->
`try?` converts a thrown error to `nil`, `try!` asserts no error and crashes if one occurs. `Result<Success, Failure>` is an enum that stores either outcome, useful for completion handlers and for storing failures as values; `get()` converts it back to throwing code.

```swift
let n = try? parse("12")              // Int?
let config = try! loadBundledConfig() // only if failure is a programmer error

func load(completion: (Result<Data, URLError>) -> Void) {}

let r: Result<Int, ParseError> = Result { try parse("5") }
let value = try r.get()
```

With async/await, prefer `throws` over `Result` for new code.

Pitfalls:
- `try?` discards the error reason; log or surface it where it matters.
- `try!` in production paths becomes a crash report.

Interview tip: say when `try?` is acceptable (optional cache read) and when it is not (saving user data).

### Typed throws and error design
<!-- level: advanced; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/errorhandling/ -->
Swift 6.0 introduced typed throws: `func f() throws(ParseError)` states the exact error type, so `catch` blocks get a typed `error` and no existential boxing is needed. It suits embedded Swift and tightly scoped modules. For most application code, untyped `throws` remains the default, and the documentation recommends it unless you have a closed set of errors that callers handle exhaustively.

```swift
func parseStrict(_ s: String) throws(ParseError) -> Int {
  guard let n = Int(s) else { throw .invalid(s) }
  return n
}

do { _ = try parseStrict("x") }
catch { print(error) }  // error is ParseError
```

Design guidance: define error enums per domain, include context in associated values, conform to `LocalizedError` for user messages, and map low-level errors at layer boundaries.

Pitfalls:
- Typed throws leak implementation errors into your public API; changing the error type is a breaking change.

Interview tip: mention that this feature is Swift 6.0 and later.

## 4. Memory management with ARC

### ARC basics
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting/ -->
Automatic Reference Counting tracks how many strong references point to each class instance (and actors and closures). When the count reaches zero, the instance is deallocated and `deinit` runs. ARC is deterministic: there is no garbage collector pause. Value types such as structs have no reference count of their own, though their stored class references do.

```swift
final class Session {
  let id: Int
  init(id: Int) { self.id = id; print("init \(id)") }
  deinit { print("deinit \(id)") }
}

var a: Session? = Session(id: 1)
var b = a        // count 2
a = nil          // count 1
b = nil          // count 0 -> deinit prints
```

Pitfalls:
- ARC cannot break cycles automatically.
- Retain and release operations add overhead in hot loops; prefer value types or `final` classes where possible.

Interview tip: say ARC is compile-time inserted retain/release, not a runtime collector.

### Retain cycles, weak and unowned
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting/#Resolving-Strong-Reference-Cycles-Between-Class-Instances -->
Two objects that hold strong references to each other will never reach zero. Break the cycle with `weak` (becomes `nil` when the target deallocates, so it must be an optional `var`) or `unowned` (non-optional, assumes the target outlives the holder, and traps if accessed after deallocation).

```swift
final class Parent {
  var children: [Child] = []
}
final class Child {
  weak var parent: Parent?        // child does not own parent
}

final class Customer { var card: Card? }
final class Card { unowned let owner: Customer; init(owner: Customer) { self.owner = owner } }
```

Delegates are typically `weak var delegate: SomeDelegate?` with a class-bound protocol.

Pitfalls:
- `unowned` on an object that can disappear is a crash.
- `weak` has a small runtime cost because of side tables.

Interview tip: give the parent-child and delegate examples.

### Closure capture and leaks
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting/#Strong-Reference-Cycles-for-Closures -->
Closures capture references strongly by default. If an object stores a closure that references `self`, you get a cycle: object to closure to object. Use a capture list to capture weakly. `Task { }` closures capture `self` too, but a short-lived task does not form a permanent cycle unless the task itself is stored and runs indefinitely.

```swift
final class Poller {
  private var timer: Timer?

  func start() {
    timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
      self?.poll()
    }
  }
  func stop() { timer?.invalidate(); timer = nil }
  deinit { timer?.invalidate() }
}
```

Detect leaks with the Memory Graph Debugger and Instruments Leaks, or by checking that `deinit` runs.

Pitfalls:
- `[weak self]` then `self!` defeats the purpose.
- Timers retain their targets until invalidated.

Interview tip: describe how you verify `deinit` is called in tests.
