## 1. Basics and optionals

### let, var and type inference
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/thebasics/ -->
`let` declares a constant and `var` a variable. Swift is statically typed with inference, so `let n = 42` is `Int` and `let s = "hi"` is `String`. Prefer `let`; the compiler warns when a `var` is never mutated. Constants make code easier to reason about, especially with value types and concurrency.

```swift
let name = "Asha"            // String, cannot change
var count = 0                // Int, can change
count += 1
let ratio: Double = 3        // explicit type, literal becomes 3.0
```

Swift never converts numeric types implicitly, so `Int + Double` needs an explicit conversion like `Double(count)`.

Pitfalls:
- A `let` class reference still allows mutating the object's `var` properties; only the reference is constant.
- Integer overflow traps at runtime; use `&+` or `addingReportingOverflow` when wrapping is intended.

Interview tip: explain why `let` on a struct makes the whole value immutable while `let` on a class does not.

### Optionals and unwrapping
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/thebasics/#Optionals -->
An optional is a type that either holds a value or `nil`: `Int?` is sugar for `Optional<Int>`, an enum with `.some` and `.none`. The compiler forces you to deal with absence before using the value, which removes a whole class of null-pointer bugs.

```swift
let input = "42"
let n: Int? = Int(input)        // nil if not a number

if let n { print(n + 1) }       // shorthand for if let n = n (Swift 5.7+)
let safe = n ?? 0               // default value
let risky = n!                  // force unwrap, crashes if nil
```

Prefer `if let`, `guard let`, and `??` over `!`.

Pitfalls:
- Implicitly unwrapped optionals (`String!`) still crash on nil; use them only for values set right after initialisation, such as outlets.
- `Optional<Optional<Int>>` can surprise when mapping.

Interview tip: say optionals are an enum, then show `switch` over `.some` and `.none`.

### guard and early exit
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/controlflow/#Early-Exit -->
`guard` checks a condition and requires the `else` branch to exit the scope (`return`, `throw`, `break`, `continue`, or a `Never` call). Values unwrapped by `guard let` stay available for the rest of the scope, which avoids pyramid-of-doom nesting.

```swift
func process(_ raw: String?) throws -> Int {
  guard let raw, !raw.isEmpty else { throw InputError.empty }
  guard let value = Int(raw) else { throw InputError.notNumber(raw) }
  return value * 2
}
```

Use `guard` for preconditions and `if let` when both branches have meaningful work.

Pitfalls:
- A `guard` body that does not exit fails to compile.
- Shadowing a name with `guard let x = x` is fine, but reusing unrelated names inside a closure may confuse readers.

Interview tip: describe guard as "handle the unhappy path first".

### Optional chaining and map
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/optionalchaining/ -->
Optional chaining (`a?.b?.c`) accesses members through optionals; if any link is `nil`, the whole expression is `nil` and the result is optional. `map` and `flatMap` on `Optional` transform the wrapped value without unwrapping explicitly.

```swift
struct User { var address: Address? }
struct Address { var city: String? }

let city = user?.address?.city          // String?
let upper = city.map { $0.uppercased() } // String?
let label = user?.address?.city ?? "Unknown"

user?.address?.city = "Pune"            // assignment silently skipped if nil
```

Calling a method through a chain returns an optional of its return type, `Void?` for functions returning nothing.

Pitfalls:
- A chain result being `nil` does not tell you which link failed.
- `flatMap` is needed when the closure itself returns an optional, to avoid `Int??`.

Interview tip: contrast `map` and `flatMap` on optionals with a failable initialiser.

### Enums with associated values
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/enumerations/ -->
Swift enums are value types that can carry data per case, can have methods and computed properties, and can conform to protocols. They model closed sets of states, making invalid states unrepresentable.

```swift
enum LoadState<T> {
  case idle
  case loading
  case loaded(T)
  case failed(Error)

  var value: T? {
    if case .loaded(let v) = self { return v }
    return nil
  }
}
```

`switch` over an enum must be exhaustive, so adding a case produces compile errors where you need to handle it. Use `indirect` for recursive enums, and `CaseIterable` to list all simple cases.

Pitfalls:
- Raw values (`enum E: String`) are not associated values; the two are different features.
- Adding a case to a public library enum is source-breaking unless it is marked `@frozen` or you use `@unknown default`.

Interview tip: use a loading-state enum instead of several booleans.

### switch and pattern matching
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/patterns/ -->
`switch` supports value binding, tuple patterns, ranges, `where` clauses, and `case let`. It does not fall through by default, and it must be exhaustive.

```swift
func describe(_ p: (Int, Int)) -> String {
  switch p {
  case (0, 0): return "origin"
  case (let x, 0): return "on x-axis at \(x)"
  case (_, let y) where y < 0: return "below"
  case (1...5, 1...5): return "near"
  default: return "elsewhere"
  }
}

if case .loaded(let items) = state, !items.isEmpty { /* ... */ }
```

Swift 5.9 added `if` and `switch` expressions that produce values.

Pitfalls:
- `default` hides missing cases when you later add enum cases; omit it for your own enums.
- Overlapping patterns match in order, first wins.

Interview tip: show `if case` and `for case let` as concise filters.

### Functions, labels and default arguments
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/functions/ -->
Swift parameters have an external argument label and an internal name. Labels make call sites read like sentences, and `_` omits a label. Functions support default values, variadic parameters, `inout`, multiple returns through tuples, and nested functions.

```swift
func move(from start: Int, to end: Int = 0, steps: Int...) -> (distance: Int, count: Int) {
  (abs(end - start), steps.count)
}

let r = move(from: 5, steps: 1, 2, 3)
print(r.distance)

func swapValues(_ a: inout Int, _ b: inout Int) { (a, b) = (b, a) }
```

Functions are first-class: they can be stored, passed and returned.

Pitfalls:
- `inout` arguments need `&` at the call site and exclusive access; overlapping access is a compile or runtime error.
- Changing a label is a source-breaking API change.

Interview tip: follow the Swift API Design Guidelines on clarity at the call site.

## 2. Value and reference types

### Structs versus classes
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/classesandstructures/ -->
Structs and enums are value types, copied on assignment. Classes are reference types, where assignments share one instance and `===` tests identity. Classes add inheritance, deinitialisers, and reference counting. Apple recommends starting with structs and using classes when you need identity, shared mutable state, or Objective-C interoperability.

```swift
struct Point { var x = 0 }
class Box { var x = 0 }

var a = Point(); var b = a; b.x = 5   // a.x still 0
let c = Box();  let d = c; d.x = 5    // c.x is 5
```

Value semantics make code predictable and are naturally thread safe when the value is `Sendable`. Most standard library types (`Array`, `String`, `Dictionary`) are structs.

Pitfalls:
- Large structs holding class references are shallow-copied, so the referenced object is shared.
- Structs cannot inherit.

Interview tip: define "value semantics" as "independent copies", not "stack allocation".

### Copy-on-write
<!-- level: intermediate; ref: https://developer.apple.com/documentation/swift/array -->
Swift's `Array`, `Dictionary`, `Set` and `String` are value types but avoid copying eagerly. They share storage until one copy is mutated, then the mutating copy duplicates the buffer. The check uses `isKnownUniquelyReferenced` on an internal storage class. You can implement the same for your own types.

```swift
struct Stack {
  private final class Storage { var items: [Int] = [] }
  private var storage = Storage()

  mutating func push(_ x: Int) {
    if !isKnownUniquelyReferenced(&storage) {
      let new = Storage(); new.items = storage.items; storage = new
    }
    storage.items.append(x)
  }
}
```

Pitfalls:
- Mutating a collection inside a loop that also holds another reference can trigger an unexpected full copy.
- Copy-on-write does not make your own struct thread safe by itself.

Interview tip: explain that assignment is O(1) until mutation.

### Mutating methods and let semantics
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/methods/ -->
Methods of a struct or enum that change `self` must be marked `mutating`, and can only be called on `var` instances. Internally a mutating method receives `self` as `inout`. Classes need no such marker because a reference lets you change the instance regardless.

```swift
struct Counter {
  private(set) var value = 0
  mutating func increment() { value += 1 }
  func incremented() -> Counter { var c = self; c.increment(); return c }
}

let a = Counter()
// a.increment()        // error: a is a let constant
var b = Counter(); b.increment()
```

Protocols marking requirements `mutating` allow structs to conform while classes may implement them without the keyword.

Pitfalls:
- You cannot call a mutating method on a temporary or on a `let`.
- Mutating `self` inside an escaping closure is not allowed for structs.

Interview tip: use the "functional" variant (returns a new value) versus "mutating" variant naming guidance (`sorted()` versus `sort()`).

### Properties: stored, computed, lazy and observers
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/properties/ -->
Stored properties hold values; computed properties calculate them in `get`/`set` and take no storage. `lazy var` initialises on first access (only for `var`). Observers `willSet` and `didSet` run when a stored property changes, but not during initialisation.

```swift
struct Rect {
  var width = 0.0, height = 0.0
  var area: Double { width * height }          // computed

  lazy var thumbnail: String = expensiveRender() // lazy

  var title = "" {
    didSet { print("changed from \(oldValue) to \(title)") }
  }
}
```

Type properties use `static` (or `class` in classes for overridable ones).

Pitfalls:
- `lazy` properties are not thread safe.
- A heavy computed property called in a loop silently repeats the work.

Interview tip: say computed properties should be cheap and side-effect free.

### Property wrappers
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/properties/#Property-Wrappers -->
A property wrapper (`@propertyWrapper`) encapsulates get/set logic in a reusable type. The wrapped property gets a `wrappedValue`, and an optional `projectedValue` is exposed with a `$` prefix. SwiftUI's `@State`, `@Binding` and `@AppStorage` are property wrappers.

```swift
@propertyWrapper
struct Clamped {
  private var value: Int
  let range: ClosedRange<Int>
  init(wrappedValue: Int, _ range: ClosedRange<Int>) {
    self.range = range
    self.value = min(max(wrappedValue, range.lowerBound), range.upperBound)
  }
  var wrappedValue: Int {
    get { value }
    set { value = min(max(newValue, range.lowerBound), range.upperBound) }
  }
}

struct Volume { @Clamped(0...10) var level = 5 }
```

Pitfalls:
- Wrappers add storage, so large numbers of them affect memory.
- Wrappers on properties interacting with strict concurrency need `Sendable` care.

Interview tip: connect `$name` projected values to SwiftUI bindings.

### Access control
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/accesscontrol/ -->
Swift has `open`, `public`, `package` (Swift 5.9+), `internal` (default), `fileprivate` and `private`. `open` allows subclassing and overriding outside the module, `public` does not. `private(set)` exposes read-only access to a property from outside while keeping writes inside.

```swift
public struct Account {
  public private(set) var balance: Decimal = 0
  public init() {}
  public mutating func deposit(_ amount: Decimal) {
    precondition(amount > 0)
    balance += amount
  }
}
```

Access levels also protect invariants: callers cannot set `balance` directly.

Pitfalls:
- Public structs do not get a public memberwise initialiser; declare one explicitly.
- Types cannot be more public than the types in their signatures.

Interview tip: contrast `public` and `open` and mention `package` for multi-module apps.

### Equatable, Hashable and Codable
<!-- level: intermediate; ref: https://developer.apple.com/documentation/swift/codable -->
Conforming to `Equatable` provides `==`; `Hashable` provides hashing for `Set` and `Dictionary` keys; `Codable` (`Encodable` plus `Decodable`) enables JSON and plist encoding. When all stored properties conform, the compiler synthesises the implementations.

```swift
struct User: Codable, Hashable, Identifiable {
  let id: UUID
  var name: String
  var joinedAt: Date
  enum CodingKeys: String, CodingKey { case id, name, joinedAt = "joined_at" }
}

let decoder = JSONDecoder()
decoder.dateDecodingStrategy = .iso8601
let user = try decoder.decode(User.self, from: data)
```

Pitfalls:
- Equal values must have equal hashes; custom `==` requires a matching `hash(into:)`.
- Missing keys cause `DecodingError.keyNotFound`; make optional fields optional or provide defaults in a custom `init(from:)`.

Interview tip: be able to name `DecodingError` cases and explain custom coding keys.

### Extensions
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/extensions/ -->
Extensions add computed properties, methods, initialisers, subscripts, nested types and protocol conformances to existing types, including ones you do not own. They cannot add stored properties or override existing methods. Organise code by putting each protocol conformance in its own extension.

```swift
extension String {
  var isValidEmail: Bool { contains("@") && contains(".") }
}

extension User: CustomStringConvertible {
  var description: String { "\(name) (\(id))" }
}

extension Array where Element: Numeric {
  var total: Element { reduce(0, +) }
}
```

Pitfalls:
- Retroactive conformances (a type you do not own to a protocol you do not own) can conflict across modules; Swift 6 warns about them (`@retroactive`).
- Putting too much into global extensions pollutes autocomplete.

Interview tip: remember that you can constrain extensions with `where`.

### Collections and common operations
<!-- level: basic; ref: https://developer.apple.com/documentation/swift/array -->
Arrays, sets and dictionaries are generic value-type collections. Standard higher-order functions are `map`, `filter`, `reduce`, `compactMap`, `flatMap`, `sorted`, `first(where:)` and `contains(where:)`. Dictionaries return optionals on lookup.

```swift
let words = ["apple", "bob", "cat", "apple"]
let counts = Dictionary(grouping: words, by: { $0 }).mapValues(\.count)
let unique = Set(words).sorted()
let lengths = words.map(\.count)
let numbers = ["1", "x", "3"].compactMap(Int.init)   // [1, 3]
let price = ["a": 1.5]["b", default: 0]
```

Use `lazy` to avoid intermediate arrays for long chains.

Pitfalls:
- Indexing out of range traps; use `first`, `indices.contains(i)` or `safe` helpers.
- `String` is indexed by `String.Index`, not `Int`, because characters have variable length.

Interview tip: know that `Array` lookup is O(1) while `String.count` is O(n).
