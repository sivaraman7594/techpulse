## 1. async/await and structured concurrency

### async and await
<!-- level: basic; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/ -->
An `async` function can suspend without blocking its thread. Calling one requires `await`, which marks a possible suspension point where other work can run and where the function may resume on a different thread. This replaces completion-handler pyramids with straight-line code and normal `try`/`catch` (Swift 5.5 and later).

```swift
func loadProfile(id: Int) async throws -> Profile {
  let (data, response) = try await URLSession.shared.data(from: url(for: id))
  guard (response as? HTTPURLResponse)?.statusCode == 200 else {
    throw APIError.badStatus
  }
  return try JSONDecoder().decode(Profile.self, from: data)
}
```

Pitfalls:
- Every `await` is a point where shared state may change; do not assume invariants hold across it.
- Calling async code from a synchronous context needs a `Task { }`.

Interview tip: say that `await` marks suspension, not a new thread.

### Task and unstructured concurrency
<!-- level: intermediate; ref: https://developer.apple.com/documentation/swift/task -->
`Task { }` starts new asynchronous work from synchronous code. It inherits the current actor isolation, priority and task-local values. `Task.detached { }` does not inherit them and should be rare. A task handle lets you `await task.value` or call `cancel()`. A task is not automatically cancelled when its handle goes out of scope.

```swift
final class ViewModel {
  private var loadTask: Task<Void, Never>?

  func reload() {
    loadTask?.cancel()
    loadTask = Task { [weak self] in
      guard let self else { return }
      let items = try? await self.repo.fetch()
      if Task.isCancelled { return }
      self.items = items ?? []
    }
  }
}
```

Pitfalls:
- Fire-and-forget tasks lose errors; handle them inside the task.
- Detached tasks do not inherit `@MainActor`, so UI updates need an explicit hop.

Interview tip: contrast `Task` (unstructured) with `async let` and task groups (structured).

### async let and TaskGroup
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/#Tasks-and-Task-Groups -->
Structured concurrency ties child tasks to a scope: they cannot outlive their parent, and errors and cancellation propagate. `async let` starts a fixed number of child tasks in parallel. `withTaskGroup` and `withThrowingTaskGroup` handle a dynamic number.

```swift
async let user = api.user(id)
async let posts = api.posts(id)
let page = try await Page(user: user, posts: posts)   // both run concurrently

let thumbs = try await withThrowingTaskGroup(of: (Int, Image).self) { group in
  for (i, url) in urls.enumerated() {
    group.addTask { (i, try await download(url)) }
  }
  var result = [Int: Image]()
  for try await (i, img) in group { result[i] = img }
  return result
}
```

Pitfalls:
- Results arrive in completion order, so carry an index.
- Unbounded fan-out can overload the network; limit concurrency by adding tasks as others finish.

Interview tip: explain what happens to siblings when one child throws (they are cancelled).

### Cancellation
<!-- level: intermediate; ref: https://developer.apple.com/documentation/swift/task/cancel() -->
Swift cancellation is cooperative. `cancel()` sets a flag and propagates it to child tasks, but your code must check `Task.isCancelled` or call `try Task.checkCancellation()`. Many system APIs, such as `URLSession` async methods and `Task.sleep`, throw `CancellationError` when cancelled.

```swift
func process(_ items: [Item]) async throws {
  for item in items {
    try Task.checkCancellation()
    try await handle(item)
  }
}

let task = Task { try await process(items) }
task.cancel()
```

Use `withTaskCancellationHandler` to clean up resources that need immediate action. In SwiftUI, the `.task` modifier cancels automatically when the view disappears.

Pitfalls:
- Ignoring cancellation keeps work running after the user leaves.
- Treat `CancellationError` as normal flow rather than showing an error.

Interview tip: use "cooperative" and mention checkpoints in long loops.

### AsyncSequence and AsyncStream
<!-- level: intermediate; ref: https://developer.apple.com/documentation/swift/asyncstream -->
An `AsyncSequence` is like `Sequence` but its `next()` is async, consumed with `for await`. Examples: `URLSession.bytes`, `NotificationCenter.notifications(named:)`. `AsyncStream` creates a sequence from callback-style producers.

```swift
let stream = AsyncStream<Int> { continuation in
  let timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
    continuation.yield(Int.random(in: 0...100))
  }
  continuation.onTermination = { _ in timer.invalidate() }
}

for await value in stream {
  print(value)
}
```

Operators such as `map`, `filter`, and `prefix` exist; the `swift-async-algorithms` package adds debounce, merge, and more.

Pitfalls:
- A `for await` loop ends only when the sequence finishes or the task is cancelled.
- Buffering policy (`bufferingPolicy`) decides what happens to values when the consumer is slow.

Interview tip: say when you would use `AsyncStream` instead of Combine.

### Bridging callbacks with continuations
<!-- level: advanced; ref: https://developer.apple.com/documentation/swift/withcheckedthrowingcontinuation(isolation:function:_:) -->
To wrap an old completion-handler API, use `withCheckedThrowingContinuation` (or the non-throwing and `Unsafe` versions). You must resume the continuation exactly once. Checked continuations diagnose double or missing resumes at runtime.

```swift
func location() async throws -> CLLocation {
  try await withCheckedThrowingContinuation { cont in
    legacyManager.requestLocation { result in
      switch result {
      case .success(let loc): cont.resume(returning: loc)
      case .failure(let err): cont.resume(throwing: err)
      }
    }
  }
}
```

Pitfalls:
- A path that never resumes leaves the caller suspended forever.
- Delegate APIs that call back many times need `AsyncStream` instead.

Interview tip: state the "exactly once" rule and why you start with the checked variant.

## 2. Actors and Swift 6 strict concurrency

### Actors
<!-- level: intermediate; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/#Actors -->
An actor is a reference type that protects its mutable state by serialising access: only one task runs on an actor at a time. External callers use `await` to enter it. Within the actor, code runs synchronously and can access state freely. This removes most data races without manual locks.

```swift
actor Counter {
  private var value = 0
  func increment() -> Int { value += 1; return value }
}

let counter = Counter()
let n = await counter.increment()
```

Actors support `nonisolated` members for state-independent work, and immutable `let` properties of Sendable type can be read without `await`.

Pitfalls:
- An actor is not a lock around a whole workflow; other callers can interleave at every `await` inside the actor.
- Heavy synchronous work inside an actor blocks everyone waiting.

Interview tip: say "actor isolation gives mutual exclusion plus compiler-checked access".

### Actor reentrancy
<!-- level: advanced; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/#Actors -->
Actors are reentrant: when an actor-isolated function suspends at an `await`, other messages can run on the actor before it resumes. So state read before the `await` may be stale afterward. The fix is to re-check conditions after suspension, or finish state transitions before suspending.

```swift
actor ImageCache {
  private var cache: [URL: Image] = [:]
  private var inFlight: [URL: Task<Image, Error>] = [:]

  func image(for url: URL) async throws -> Image {
    if let hit = cache[url] { return hit }
    if let task = inFlight[url] { return try await task.value }
    let task = Task { try await download(url) }
    inFlight[url] = task
    defer { inFlight[url] = nil }
    let img = try await task.value
    cache[url] = img
    return img
  }
}
```

Storing the in-flight task deduplicates concurrent requests.

Pitfalls:
- Check-then-act across an `await` leads to duplicate work or invariant violations.

Interview tip: be ready to explain the bug in "check cache, await download, store" without the in-flight map.

### MainActor and UI isolation
<!-- level: basic; ref: https://developer.apple.com/documentation/swift/mainactor -->
`@MainActor` is a global actor that isolates code to the main thread. UI frameworks (UIKit, SwiftUI views' `body`) are main-actor isolated. Annotate a class or function to have the compiler enforce that it is only touched from the main actor, hopping automatically with `await` when called from elsewhere.

```swift
@MainActor
final class ProfileViewModel: ObservableObject {
  @Published var name = ""

  func load() async {
    let profile = try? await api.profile()   // runs off-main inside api
    name = profile?.name ?? ""               // back on main actor
  }
}
```

Use `await MainActor.run { }` or `Task { @MainActor in }` as a hop when needed.

Pitfalls:
- Heavy computation on the main actor freezes UI; move it to a non-isolated async function or another actor.
- Annotating everything `@MainActor` just to silence warnings reduces concurrency.

Interview tip: contrast `@MainActor` with the older `DispatchQueue.main.async`.

### Sendable
<!-- level: advanced; ref: https://developer.apple.com/documentation/swift/sendable -->
`Sendable` marks types whose values can be safely shared across concurrency domains (actors, tasks). Value types with Sendable members, actors, immutable final classes, and types protected by locks (`@unchecked Sendable`) qualify. The compiler checks Sendable conformance when values cross boundaries such as `Task` closures and actor calls.

```swift
struct Config: Sendable { let url: URL; let retries: Int }

final class Cache: @unchecked Sendable {   // you promise it is thread safe
  private let lock = NSLock()
  private var store: [String: Data] = [:]
  func get(_ k: String) -> Data? { lock.withLock { store[k] } }
}

let work: @Sendable () -> Void = { print("safe") }
```

Pitfalls:
- `@unchecked Sendable` is a promise, not a proof; wrong use hides races.
- A non-final class with mutable state cannot be checked as Sendable.

Interview tip: explain that Sendable is how the compiler proves data-race safety at boundaries.

### Swift 6 language mode and strict concurrency
<!-- level: advanced; ref: https://www.swift.org/migration/documentation/migrationguide/ -->
Swift 6 (language mode, Xcode 16 and later) turns data-race safety violations from warnings into compile errors. Migration is incremental: enable the `StrictConcurrency` setting (minimal, targeted, complete) in Swift 5 mode to see warnings, fix them module by module, then switch the language mode to 6.

```swift
// Package.swift
.target(
  name: "App",
  swiftSettings: [.enableUpcomingFeature("StrictConcurrency")]
)
// later: swiftLanguageModes: [.v6]
```

Typical fixes: make models `Sendable` structs, isolate mutable state in actors or `@MainActor`, replace global mutable variables with actors or `nonisolated(unsafe)` (as a last resort), and pass only Sendable values to tasks. Newer toolchains (Swift 6.2) add options such as default main-actor isolation for app targets to reduce annotation noise; check availability for your Xcode version.

Pitfalls:
- Third-party libraries that are not yet Sendable-correct need `@preconcurrency import`.
- Global variables and singletons are the most common source of errors.

Interview tip: describe the incremental migration steps.

### Isolation inheritance and nonisolated
<!-- level: advanced; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/ -->
Isolation determines which actor a piece of code runs on. A method of an actor-isolated type inherits its isolation. A closure passed to `Task { }` inherits the isolation of its context, but `Task.detached` does not. `nonisolated` removes isolation, letting a member be called synchronously from anywhere, but then it cannot touch isolated state.

```swift
actor Account {
  let id: String
  private var balance = 0
  init(id: String) { self.id = id }

  nonisolated var label: String { "Account \(id)" }   // uses only immutable state
  func deposit(_ n: Int) { balance += n }
}
```

Since Swift 6.2, `nonisolated async` functions can run on the caller's actor by default under the `NonisolatedNonsendingByDefault` upcoming feature; earlier versions hop to the global executor.

Pitfalls:
- Accessing isolated properties from a `nonisolated` method is a compile error.
- Assuming a `Task` runs off the main thread when created inside a `@MainActor` context is wrong.

Interview tip: say how isolation flows through closures and tasks.

## 3. SwiftUI overview

### Declarative views and the View protocol
<!-- level: basic; ref: https://developer.apple.com/documentation/swiftui/view -->
In SwiftUI you describe what the UI should look like for the current state, and the framework updates the screen when state changes. A view is a lightweight struct conforming to `View` with a `body` property built using `@ViewBuilder`. Modifiers return new views, so order matters.

```swift
struct Greeting: View {
  let name: String
  var body: some View {
    Text("Hello, \(name)")
      .font(.title)
      .padding()
      .background(.yellow)     // applies after padding
  }
}
```

View structs are cheap, created and discarded often; the framework keeps identity and state separately.

Pitfalls:
- Heavy work in `body` runs on every update.
- `padding` before `background` and after `background` give different results.

Interview tip: explain that SwiftUI views are value-type descriptions, not UI objects.

### State and Binding
<!-- level: basic; ref: https://developer.apple.com/documentation/swiftui/state -->
`@State` stores value-type state owned by a view; SwiftUI keeps the storage outside the struct so it survives re-creation of the view, and re-renders when it changes. `@Binding` is a two-way reference to state owned elsewhere, created with the `$` projected value.

```swift
struct Parent: View {
  @State private var isOn = false
  var body: some View {
    VStack {
      Toggle("Enabled", isOn: $isOn)
      Child(isOn: $isOn)
    }
  }
}

struct Child: View {
  @Binding var isOn: Bool
  var body: some View { Button(isOn ? "Turn off" : "Turn on") { isOn.toggle() } }
}
```

Pitfalls:
- Mark `@State` properties `private` and give them an initial value; the owner creates them, children receive bindings.
- Initialising `@State` from a parameter only uses the first value.

Interview tip: state the rule: single source of truth, owner uses `@State`, others use `@Binding`.

### Observation with @Observable
<!-- level: intermediate; ref: https://developer.apple.com/documentation/observation -->
The Observation framework (Swift 5.9, iOS 17 and later) provides the `@Observable` macro for reference-type models. SwiftUI tracks which properties each view's `body` actually reads and re-renders only when those change. This replaces `ObservableObject` with `@Published` on newer deployment targets, and uses `@State` to own the model.

```swift
@Observable
final class Library {
  var books: [Book] = []
  var filter = ""
}

struct LibraryView: View {
  @State private var library = Library()
  var body: some View {
    List(library.books.filter { $0.title.contains(library.filter) }) { Text($0.title) }
      .searchable(text: $library.filter)
  }
}
```

Use `@Bindable` to create bindings to properties of an observable passed in.

Pitfalls:
- Before iOS 17 you need `ObservableObject`, `@Published`, `@StateObject`, and `@ObservedObject`.
- Mixing the two systems in one model causes missing updates.

Interview tip: explain property-level tracking versus whole-object invalidation.

### Environment and dependency passing
<!-- level: intermediate; ref: https://developer.apple.com/documentation/swiftui/environment -->
The environment passes values implicitly down the view hierarchy. System values include `colorScheme`, `dismiss`, `locale`, and `scenePhase`. You can add your own with `EnvironmentKey` (or the `@Entry` macro in newer Xcode versions) and inject observable models with `.environment(model)`.

```swift
struct SettingsKey: EnvironmentKey { static let defaultValue = Settings() }
extension EnvironmentValues {
  var settings: Settings {
    get { self[SettingsKey.self] }
    set { self[SettingsKey.self] = newValue }
  }
}

struct Row: View {
  @Environment(\.settings) private var settings
  @Environment(\.dismiss) private var dismiss
  var body: some View { Text(settings.title) }
}
// Root: ContentView().environment(\.settings, Settings(title: "Prod"))
```

Pitfalls:
- A missing injected `@Observable` object crashes at runtime when read.
- Overusing the environment hides dependencies; pass explicit values for simple cases.

Interview tip: mention previews and tests can inject different environment values.

### Navigation with NavigationStack
<!-- level: intermediate; ref: https://developer.apple.com/documentation/swiftui/navigationstack -->
`NavigationStack` (iOS 16 and later) manages a stack of values-driven destinations. Link with `NavigationLink(value:)`, register `navigationDestination(for:)`, and optionally bind a `NavigationPath` to control the stack programmatically, for example to deep link or pop to root.

```swift
struct Root: View {
  @State private var path = NavigationPath()
  var body: some View {
    NavigationStack(path: $path) {
      List(items) { item in
        NavigationLink(item.title, value: item)
      }
      .navigationDestination(for: Item.self) { DetailView(item: $0) }
      .toolbar { Button("Reset") { path.removeLast(path.count) } }
    }
  }
}
```

Pitfalls:
- The older `NavigationView` is deprecated.
- Destinations must be registered for each value type, and values need to be `Hashable`.

Interview tip: say state-driven navigation is easier to test and restore.

### The task modifier and view lifecycle
<!-- level: intermediate; ref: https://developer.apple.com/documentation/swiftui -->
`.task { }` starts async work when a view appears and cancels it when the view disappears. `.task(id:)` restarts when the id changes, making it good for loading data in response to input. `onAppear` is synchronous and can run multiple times, and `onChange(of:)` reacts to value changes.

```swift
struct SearchResults: View {
  @State private var results: [Item] = []
  let query: String

  var body: some View {
    List(results) { Text($0.name) }
      .task(id: query) {
        try? await Task.sleep(for: .milliseconds(300))   // debounce
        guard !Task.isCancelled else { return }
        results = (try? await api.search(query)) ?? []
      }
  }
}
```

Pitfalls:
- Work started in `onAppear` with `Task { }` is not cancelled automatically.
- `.task` runs on the main actor by default for view bodies; offload heavy work.

Interview tip: explain how `.task(id:)` replaces manual debounce and cancellation code.

### Identity, ForEach and performance
<!-- level: intermediate; ref: https://developer.apple.com/documentation/swiftui/foreach -->
SwiftUI diffs views using identity. In lists, `ForEach` needs stable identifiers: an `Identifiable` model or an explicit `id:` key path. Unstable ids (like `UUID()` generated in `body`) make SwiftUI treat every update as new content, losing state and animation. Keep `body` cheap, split views so only the changed part re-renders, and use `LazyVStack` or `List` for large collections.

```swift
struct TodoItem: Identifiable, Hashable {
  let id: UUID
  var title: String
}

List(todos) { todo in
  TodoRow(todo: todo)
}

// avoid:
ForEach(todos.indices, id: \.self) { i in TodoRow(todo: todos[i]) } // breaks on reorder
```

Pitfalls:
- Using indices as ids breaks animations and state on insert or delete.
- Large non-lazy `VStack`s build all children immediately.

Interview tip: use Instruments' SwiftUI template or `Self._printChanges()` to find unnecessary updates.
