# Swift interview questions

### What is an optional in Swift and how do you unwrap one safely?
<!-- level: basic; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/thebasics/#Optionals -->
An optional is a generic enum, `Optional<Wrapped>`, with cases `.some(value)` and `.none` (written `nil`). `Int?` is shorthand. The type system forces you to handle absence before using the value.

Safe options: `if let` and `guard let` (shorthand `if let x` since Swift 5.7), optional chaining `a?.b`, nil-coalescing `a ?? default`, and `map`/`flatMap`. Force unwrapping with `!` crashes when nil and should be reserved for cases where nil is a programmer error.

Implicitly unwrapped optionals (`T!`) still crash on nil and are mostly for two-phase initialisation like IBOutlets. A good answer mentions that `guard` keeps the unwrapped value in scope and encourages early exits.

### What is the difference between structs and classes, and when do you choose each?
<!-- level: basic; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/classesandstructures/ -->
Structs (and enums) are value types: assignment copies, so each variable has independent state. Classes are reference types: variables share one instance, with identity (`===`), inheritance, deinitialisers, and ARC.

Default to structs for models and data, since value semantics prevent shared-mutation bugs and are naturally safer across threads when Sendable. Choose classes when you need shared mutable identity (a file handle, a network session), Objective-C interop, or inheritance from framework classes.

Mention copy-on-write for standard collections, and that `let` on a struct freezes its properties while `let` on a class only freezes the reference.

### Explain protocol-oriented programming in Swift.
<!-- level: intermediate; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/protocols/ -->
Protocol-oriented programming designs around protocols and protocol extensions rather than class hierarchies. Protocols declare capabilities, extensions supply default behaviour, and value types can conform, so you get sharing without inheritance baggage.

Benefits: retroactive conformance via extensions, easy test doubles, composition (`Codable & Identifiable`), and static dispatch with generics. Caveats: methods in an extension but not in the protocol are statically dispatched, so a conformer's same-named method will not be called through the protocol type. Protocols with associated types need `some` or `any`.

A strong answer gives a dependency-injection example with a `Storage` protocol and a fake for tests.

### What is the difference between `some` and `any`?
<!-- level: advanced; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/opaquetypes/ -->
`some P` is an opaque type: a single concrete type known to the compiler but hidden from callers, with static dispatch. `any P` is an existential box that can store different conforming types at runtime, using dynamic dispatch and often a heap allocation.

Use `some` (or generics) when one type is returned or accepted, such as `var body: some View`. Use `any` for heterogeneous collections or when the concrete type varies at runtime, as in `[any Shape]`.

`any` is required to name protocols with associated types as types since Swift 5.7; primary associated types allow `any Collection<Int>`. Mention that `some` parameters are sugar for generics.

### How does ARC work, and how do you avoid retain cycles?
<!-- level: intermediate; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting/ -->
ARC inserts retain and release operations at compile time for class instances; when the strong count hits zero the object is deallocated and `deinit` runs. It is deterministic and has no collector pauses, but cannot break cycles.

Break cycles with `weak` (optional, becomes nil) or `unowned` (non-optional, crashes if misused). Typical cycles: parent and child, delegate properties, and escaping closures stored on the object that capture `self`. Use `[weak self]` in such closures, then `guard let self`.

Detect with the Memory Graph Debugger, Instruments, or by asserting `deinit` runs. Value types avoid reference counting for their own storage, though contained references still count.

### What is the difference between escaping and non-escaping closures?
<!-- level: intermediate; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/closures/#Escaping-Closures -->
A non-escaping closure (default) is guaranteed to finish before the function returns, so the compiler can optimise it and does not require explicit `self`. An `@escaping` closure can be stored or called after the function returns, such as completion handlers or properties.

Escaping closures capture references strongly and may cause retain cycles, so you often need a capture list `[weak self]`. Inside class methods you must write `self.` explicitly in escaping closures (not required for structs in many cases or after `[self]` capture).

Mention `@Sendable` closures for concurrency and that async code often removes the need for escaping completion handlers.

### How does error handling work in Swift?
<!-- level: basic; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/errorhandling/ -->
Functions marked `throws` can throw values conforming to `Error`, usually enums with associated data. Callers use `try` inside `do-catch`, propagate with `throws`, or convert: `try?` yields an optional and `try!` traps on failure. `Result` stores success or failure as a value.

Errors are normal control flow, not stack-unwinding exceptions, so they are cheap and visible in function signatures. Typed throws (`throws(MyError)`) arrived in Swift 6.0 for closed error sets. Use `LocalizedError` for user-facing messages, and map errors at layer boundaries.

Common pitfall: `try?` hides the reason; log it where it matters.

### Explain async/await and how it differs from completion handlers or GCD.
<!-- level: intermediate; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/ -->
`async` functions can suspend without blocking a thread; `await` marks suspension points. The runtime uses a cooperative thread pool, so thousands of suspended tasks cost far less than threads. Code reads linearly with ordinary `try`/`catch`, and structured concurrency (`async let`, task groups) provides parent-child lifetimes with automatic cancellation propagation.

Compared with completion handlers: no callback nesting, errors flow naturally, and no forgotten callbacks. Compared with GCD: priorities and isolation are tracked by the compiler, and cancellation is built in.

Mention that code after `await` may run on a different thread, and that shared state can change across it.

### What is an actor and what problem does it solve?
<!-- level: intermediate; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/#Actors -->
An actor is a reference type that serialises access to its mutable state. Only one task runs on an actor at a time, and outside callers use `await`. The compiler enforces that isolated state is not accessed directly, which prevents data races without manual locks.

Limits: actors are reentrant, so at any `await` inside an actor method other calls can interleave, which means invariants must hold before suspension. They also do not make long synchronous work free; blocking in an actor delays everyone waiting.

`@MainActor` is a global actor for UI work. Mention `nonisolated` for members that touch no mutable state.

### What does Sendable mean?
<!-- level: advanced; kind: concept; ref: https://developer.apple.com/documentation/swift/sendable -->
`Sendable` marks types that are safe to transfer between concurrency domains. Value types whose members are Sendable, actors, and immutable final classes qualify. The compiler checks conformance when values cross task or actor boundaries.

Non-final classes with mutable state do not qualify unless you protect them (locks) and declare `@unchecked Sendable`, which is a promise the compiler does not verify. Closures passed to tasks are `@Sendable`, so they cannot capture non-Sendable mutable state.

In Swift 6 language mode, violations are errors. A good answer links Sendable to data-race safety and describes the practical fix: make models structs, move mutable state into actors.

### What changed with Swift 6 and strict concurrency, and how would you migrate?
<!-- level: advanced; kind: concept; ref: https://www.swift.org/migration/documentation/migrationguide/ -->
Swift 6 language mode (Xcode 16 and later) turns data-race safety diagnostics into errors. It also brought typed throws, noncopyable generics improvements, and more.

Migrate incrementally: stay in Swift 5 mode, raise `StrictConcurrency` to targeted and then complete to see warnings, fix module by module (leaf modules first), then enable Swift 6 mode per target. Fixes include Sendable models, actors for shared state, `@MainActor` for UI types, removing global mutable state, and `@preconcurrency import` for libraries that are not updated.

Swift 6.2 adds options like default main-actor isolation for apps; check availability for your toolchain.

### What are the differences between `Task`, `Task.detached`, `async let` and task groups?
<!-- level: intermediate; kind: concept; ref: https://developer.apple.com/documentation/swift/task -->
`Task { }` creates unstructured work from synchronous code and inherits actor isolation, priority and task-locals. `Task.detached` inherits none of them. Neither is cancelled automatically when the handle disappears. `async let` and task groups are structured: children cannot outlive the scope, errors propagate, and cancelling the parent cancels children.

Use `async let` for a fixed number of parallel calls and task groups for a dynamic number. Prefer structured tasks; use unstructured tasks only to bridge from synchronous contexts such as button handlers.

Remember that cancellation is cooperative: check `Task.isCancelled` or call `try Task.checkCancellation()`.

### Explain `@State`, `@Binding`, `@Observable` and `@Environment` in SwiftUI.
<!-- level: intermediate; kind: concept; ref: https://developer.apple.com/documentation/swiftui/managing-model-data-in-your-app -->
`@State` is private storage owned by a view (value types, or an `@Observable` model instance). `@Binding` is a two-way reference to someone else's state, passed with `$`. `@Observable` (iOS 17 and later) makes a class's properties observable, with SwiftUI tracking only the properties each view reads. `@Environment` reads values injected from ancestors, such as system settings or models.

Before iOS 17 the equivalents were `ObservableObject`, `@Published`, `@StateObject`, `@ObservedObject` and `@EnvironmentObject`. The principle is a single source of truth: one owner, others receive bindings or read-only values.

### How does SwiftUI decide when to re-render a view?
<!-- level: intermediate; kind: concept; ref: https://developer.apple.com/documentation/swiftui/state -->
SwiftUI builds a dependency graph. When a state or observable property that a view's `body` read changes, that view's `body` is re-evaluated and the framework diffs the new description against the old using identity, updating only what changed. View structs are re-created cheaply.

Implications: keep `body` free of heavy work and side effects, give list items stable identities, split large views so a change invalidates a smaller region, and avoid reading rarely-needed properties in a parent `body`. Debug with `Self._printChanges()` and the SwiftUI Instruments template.

### What is the difference between `let`, `var`, and `mutating`?
<!-- level: basic; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/methods/ -->
`let` declares an immutable binding, `var` a mutable one. For value types, mutability belongs to the binding: a `let` struct cannot change any property. For classes, `let` only fixes the reference.

A method on a struct or enum that modifies `self` must be marked `mutating`, and can only be called on a `var`. Behind the scenes `self` is passed `inout`. Protocol requirements can be `mutating` so value types can conform.

The Swift API guidelines suggest naming pairs like `sort()` (mutating) and `sorted()` (returns new). Prefer `let` by default.

### How do generics work in Swift, and what are constraints?
<!-- level: intermediate; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/generics/ -->
Generics let functions and types work over any type satisfying given requirements, with full type safety. Constraints use protocol conformance or class bounds, and `where` clauses express relationships between associated types. The optimiser can specialise generic code for concrete types to remove overhead, unlike type-erased approaches.

Conditional conformance lets `Array<Element>` be `Equatable` only when `Element` is. Use `some` for opaque parameters as generic shorthand. Primary associated types (Swift 5.7) allow constraints like `some Sequence<Int>`.

Avoid over-constraining; constrain only to the operations you use.

### What are property wrappers and result builders?
<!-- level: advanced; kind: concept; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/attributes/ -->
A property wrapper (`@propertyWrapper`) packages reusable get/set logic and optionally exposes a projected value via `$`. SwiftUI's `@State`, `@Binding`, and `@AppStorage` are built this way. A result builder (`@resultBuilder`) transforms a block of statements into one value; `@ViewBuilder` composes views this way.

Both are compile-time syntax transformations over ordinary Swift types. Trade-offs: wrappers can add storage overhead and affect initialisation, and result builders limit control flow to supported constructs and can produce long compiler errors.

An answer that explains what `$name` means shows real understanding.

### How do you make a type Codable and handle mismatched JSON?
<!-- level: basic; kind: concept; ref: https://developer.apple.com/documentation/foundation/archives_and_serialization/encoding_and_decoding_custom_types -->
Conform to `Codable` and the compiler synthesises `init(from:)` and `encode(to:)` when all properties are Codable. Use `CodingKeys` to rename keys, decoder strategies (`keyDecodingStrategy = .convertFromSnakeCase`, `dateDecodingStrategy = .iso8601`) for common conventions, and optional properties for fields that may be absent.

For irregular payloads write a custom `init(from:)` using `container(keyedBy:)`, `decodeIfPresent`, nested containers, and defaults. Catch `DecodingError` cases (`keyNotFound`, `typeMismatch`, `valueNotFound`, `dataCorrupted`) and log the `codingPath` for diagnostics.

### What is copy-on-write and which types use it?
<!-- level: intermediate; kind: concept; ref: https://developer.apple.com/documentation/swift/array -->
Copy-on-write lets value types share storage until a mutation happens. Swift's `Array`, `Dictionary`, `Set`, and `String` hold a reference to a heap buffer; assignment copies the reference. Before a mutation, they check uniqueness (`isKnownUniquelyReferenced`) and copy the buffer only if it is shared.

This gives value semantics with O(1) assignment. Custom structs do not get it automatically; implement it with a private final class storage. Pitfall: holding an extra reference to a collection while mutating forces a full copy, which can silently cause quadratic behaviour.

### How do you test async Swift code?
<!-- level: intermediate; kind: concept; ref: https://developer.apple.com/documentation/xctest -->
XCTest supports `async` test methods directly (`func testLoad() async throws`), and Swift Testing (Xcode 16 and later) uses `@Test func load() async throws` with `#expect`. Inject dependencies through protocols so you can fake network and clocks, and control time with an injected `Clock` rather than real sleeps.

For callback-based code use `XCTestExpectation` and `fulfillment(of:)`. To test cancellation, hold the `Task`, cancel it, and assert it stops. Mark UI-related test classes `@MainActor`. Avoid asserting on timing; assert on state after awaiting completion.
