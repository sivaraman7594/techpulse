### Your app crashes in production with "Unexpectedly found nil while unwrapping an Optional value". How do you investigate and prevent it?
<!-- level: intermediate; kind: scenario; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/thebasics/#Optionals -->
**Observe.** Crash reports (Xcode Organizer or your crash tool) show a trap at a specific symbolicated line, often a `!`, an implicitly unwrapped property, or `try!`.

**Hypothesise.** An assumption about data presence is wrong: a server field missing, a view accessed before outlets load, a dictionary lookup, or `as!` on an unexpected type.

**Verify.** Reproduce with the failing payload or lifecycle order. Look at breadcrumbs: which screen, which build, which OS. Search the codebase for `!` near the line.

**Fix.** Replace force unwraps with explicit handling.

```swift
guard let url = URL(string: raw) else {
  logger.error("Bad URL: \(raw, privacy: .public)")
  throw ConfigError.invalidURL(raw)
}
```

Model optional JSON fields as optionals, with defaults in a custom decoder when appropriate.

**Prevent.** Enable SwiftLint `force_unwrapping`, `force_cast`, and `force_try` rules, add decoding tests with partial payloads, and reserve `!` for compile-time constants (like a hard-coded URL) with a comment.

**Common wrong answers.** Adding `?? ""` everywhere (hides bad data), or wrapping with `if let` and silently doing nothing.

### A view model leaks: its deinit never runs after the screen is dismissed. How do you find and fix the retain cycle?
<!-- level: intermediate; kind: scenario; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting/ -->
**Observe.** Memory grows with each visit; a `print` in `deinit` never fires.

**Hypothesise.** Something holds a strong reference to the view model: an escaping closure capturing `self`, a `Timer`, a `NotificationCenter` observer block, a Combine `sink` stored in the same object, or a strong delegate.

**Verify.** Run the Memory Graph Debugger after dismissing the screen; look for instances still alive and follow the purple/red leak arrows to the retainer. Instruments Leaks and Allocations (filter by class name) confirm.

**Fix.**

```swift
timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
  self?.tick()
}

cancellable = publisher.sink { [weak self] value in self?.apply(value) }
weak var delegate: LoaderDelegate?
```

Invalidate timers in a lifecycle method; a timer retains its closure until invalidated.

**Prevent.** Add a test that creates the object, releases it, and asserts a weak reference is nil.

**Common wrong answers.** Using `unowned` everywhere (turns leaks into crashes) or `[weak self]` followed by `self!`.

### The UI freezes for a second when opening a screen that loads and parses data. How do you fix it with Swift concurrency?
<!-- level: intermediate; kind: scenario; ref: https://developer.apple.com/documentation/swift/mainactor -->
**Observe.** Instruments Time Profiler or the hang detector shows main-thread time in JSON decoding and sorting.

**Hypothesise.** The view model is `@MainActor`, and the heavy work runs inside it synchronously, even though the network call itself is async.

**Verify.** In the profile, the decode stack is on the main thread. Check which isolation the function inherits.

**Fix.** Move CPU work to a non-main context, then publish results on the main actor.

```swift
@MainActor final class FeedModel {
  var items: [Item] = []

  func load() async {
    let data = try? await api.fetchData()
    items = await Task.detached(priority: .userInitiated) {
      (try? JSONDecoder().decode([Item].self, from: data ?? Data()))?.sorted { $0.date > $1.date } ?? []
    }.value
  }
}
```

Alternatively mark a decoding function `nonisolated` or put it in a separate actor. In Swift 6.2 with nonisolated nonsending behaviour, use `@concurrent` for explicit offloading (version-specific).

**Prevent.** Set hang-rate alerts and use signposts around heavy work.

**Common wrong answers.** Believing `await` alone moves work off the main thread.

### Two taps trigger duplicate network requests and the UI shows the older response last. How do you fix the race?
<!-- level: intermediate; kind: scenario; ref: https://developer.apple.com/documentation/swift/task -->
**Observe.** Rapid taps (or fast typing) send multiple requests; responses return out of order, so stale data overwrites fresh data.

**Hypothesise.** Each action starts an unrelated `Task` with no cancellation or sequencing.

**Verify.** Log request ids with timestamps and use Network Link Conditioner to slow responses.

**Fix.** Keep the task handle and cancel the previous one; check cancellation before applying results.

```swift
private var searchTask: Task<Void, Never>?

func search(_ q: String) {
  searchTask?.cancel()
  searchTask = Task { [weak self] in
    try? await Task.sleep(for: .milliseconds(250))
    guard !Task.isCancelled, let self else { return }
    let result = try? await api.search(q)
    guard !Task.isCancelled else { return }
    self.results = result ?? []
  }
}
```

In SwiftUI, `.task(id: query)` does the same automatically.

**Prevent.** Test with a fake API that delays by request.

**Common wrong answers.** Disabling the button forever or using a boolean `isLoading` that can get stuck.

### The compiler reports "Capture of non-sendable type in a @Sendable closure" after enabling strict concurrency. How do you resolve it?
<!-- level: advanced; kind: scenario; ref: https://www.swift.org/migration/documentation/migrationguide/ -->
**Observe.** Dozens of warnings (errors in Swift 6 mode) at `Task { }` and actor boundaries.

**Hypothesise.** A class with mutable state is crossing concurrency domains, which is a potential data race.

**Verify.** Read the diagnostic for which type is not Sendable, and where it is captured.

**Fix.** In order of preference:
1. Make the type a struct with Sendable members.
2. Make a class `final` with only immutable `let` Sendable properties.
3. Move mutable state into an `actor` or isolate to `@MainActor`.
4. Capture only the needed Sendable values rather than the whole object.
5. As a last resort, `@unchecked Sendable` with a lock, and document why.

```swift
let id = model.id          // Sendable value
Task { await service.refresh(id: id) }
```

For legacy libraries use `@preconcurrency import`.

**Prevent.** Enable strict concurrency early on new targets.

**Common wrong answers.** Slapping `@unchecked Sendable` on every class or leaving Swift 5 mode forever.

### An actor-based cache sometimes downloads the same file twice. Why, and how do you fix it?
<!-- level: advanced; kind: scenario; ref: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/#Actors -->
**Observe.** Logs show two downloads for one URL when screens request an image at the same time.

**Hypothesise.** Actor reentrancy: the first call checks the cache (miss), suspends at `await download`, and a second call enters and also sees a miss.

**Verify.** Add logging before and after the `await`, and trigger two concurrent calls with `async let`.

**Fix.** Record in-flight work before suspending.

```swift
actor ImageLoader {
  private var cache: [URL: Image] = [:]
  private var tasks: [URL: Task<Image, Error>] = [:]

  func image(_ url: URL) async throws -> Image {
    if let img = cache[url] { return img }
    if let t = tasks[url] { return try await t.value }
    let t = Task { try await download(url) }
    tasks[url] = t
    do {
      let img = try await t.value
      cache[url] = img; tasks[url] = nil
      return img
    } catch { tasks[url] = nil; throw error }
  }
}
```

**Prevent.** Review rule: after any `await` inside an actor, assume state changed.

**Common wrong answers.** "Actors prevent all races" or adding locks inside the actor.

### Your SwiftUI list loses scroll position and animations glitch when data updates. What is the cause?
<!-- level: intermediate; kind: scenario; ref: https://developer.apple.com/documentation/swiftui/foreach -->
**Observe.** After a refresh, rows flicker, the list jumps to the top, and swipe actions reset.

**Hypothesise.** Identity is unstable: ids are regenerated (`UUID()` in the model's init or in `body`), or `ForEach(items.indices, id: \.self)` is used.

**Verify.** Print ids across two refreshes; they differ for the same logical item.

**Fix.** Use stable ids from your data.

```swift
struct Message: Identifiable, Decodable {
  let id: Int            // from the server, not generated per decode
  var text: String
}

List(messages) { MessageRow(message: $0) }
```

If no server id exists, derive a deterministic id from content. Avoid reconstructing the array with new ids on refresh. Do not wrap rows in `AnyView`.

**Prevent.** A lint check or code review item: `Identifiable.id` must be stable.

**Common wrong answers.** Using `.id(UUID())` to force refresh, which destroys all state each time.

### A SwiftUI view re-renders constantly and the app gets warm. How do you find the cause?
<!-- level: advanced; kind: scenario; ref: https://developer.apple.com/documentation/swiftui/state -->
**Observe.** CPU is high while the screen is idle; the profiler shows `body` called repeatedly.

**Hypothesise.** State is changing in a loop: an `onChange` or `onReceive` writing to the state it observes, a timer publishing frequently, or a large observable object that invalidates many views.

**Verify.** Add `let _ = Self._printChanges()` in `body` to see which property triggered the update; use the SwiftUI template in Instruments to view update counts.

**Fix.** Break the feedback loop (only write when the value really differs), throttle publishers, and reduce dependency scope.

```swift
.onChange(of: query) { _, new in
  if new != model.lastQuery { model.lastQuery = new }
}
```

With `@Observable`, read only needed properties in each subview; split views so a ticking clock does not invalidate the full screen. Use `Equatable` views or extract subviews.

**Prevent.** Profile new screens before merging.

**Common wrong answers.** Sprinkling `.drawingGroup()` or `EquatableView` without a measurement.

### Decoding the API response fails for some users with "keyNotFound". How would you make decoding resilient?
<!-- level: basic; kind: scenario; ref: https://developer.apple.com/documentation/swift/decodingerror -->
**Observe.** Logs show `DecodingError.keyNotFound(CodingKeys(stringValue: "avatar_url"), ...)` for a subset of accounts.

**Hypothesise.** The backend omits the field for users without avatars (or an older API version), while the model treats it as required.

**Verify.** Capture the raw JSON for a failing account, and write a unit test with it.

**Fix.** Make genuinely optional fields optional, and write a custom decoder for defaults.

```swift
struct User: Decodable {
  let id: Int
  let name: String
  let avatarURL: URL?

  enum CodingKeys: String, CodingKey { case id, name, avatarURL = "avatar_url" }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(Int.self, forKey: .id)
    name = try c.decodeIfPresent(String.self, forKey: .name) ?? "Unknown"
    avatarURL = try? c.decodeIfPresent(URL.self, forKey: .avatarURL)
  }
}
```

Log the `codingPath` on failures.

**Prevent.** Agree an API contract (OpenAPI) and keep decode-fixtures per version.

**Common wrong answers.** Making every property optional, or catching and ignoring decode errors.

### A background `URLSession` download works in debug but never completes when the app is suspended. What do you check?
<!-- level: advanced; kind: scenario; ref: https://developer.apple.com/documentation/foundation/downloading-files-in-the-background -->
**Observe.** Downloads stop when the app goes to the background and never report completion.

**Hypothesise.** A default session was used instead of a background configuration, or the app does not handle the system relaunch callback.

**Verify.** Check `URLSessionConfiguration`. Test by sending the app to background, then killing it from Xcode and observing the system relaunch.

**Fix.** Use a background configuration with a stable identifier, delegate-based completion, and the app delegate hook.

```swift
let config = URLSessionConfiguration.background(withIdentifier: "com.app.downloads")
config.isDiscretionary = false
config.sessionSendsLaunchEvents = true
let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)

func application(_ app: UIApplication,
                 handleEventsForBackgroundURLSession id: String,
                 completionHandler: @escaping () -> Void) {
  store.completionHandler = completionHandler
}
```

Call the stored handler from `urlSessionDidFinishEvents(forBackgroundURLSession:)`. Move the downloaded file out of the temporary location in the delegate method. Async/await APIs do not support background sessions fully.

**Prevent.** Test on a real device, with low battery and no foreground time.

**Common wrong answers.** Using `beginBackgroundTask` for long downloads (only about 30 seconds).

### Your tests for a class using `Date()` and `URLSession` are flaky. How do you make it testable?
<!-- level: intermediate; kind: scenario; ref: https://developer.apple.com/documentation/xctest -->
**Observe.** Tests fail around midnight, or when the network is slow.

**Hypothesise.** The class depends directly on global singletons (`Date.now`, `URLSession.shared`), so tests cannot control them.

**Verify.** Search for singletons and implicit time dependencies.

**Fix.** Inject protocols or closures.

```swift
protocol HTTPClient { func data(for request: URLRequest) async throws -> (Data, URLResponse) }
extension URLSession: HTTPClient {}

final class SubscriptionService {
  init(client: HTTPClient, now: @escaping () -> Date = Date.init) { ... }
}

struct StubClient: HTTPClient { /* returns canned data */ }
// test: SubscriptionService(client: StubClient(), now: { fixedDate })
```

For delays use a `Clock` abstraction (`any Clock<Duration>`) so tests advance time instantly.

**Prevent.** Rule: no direct use of singletons in business logic; inject at the composition root.

**Common wrong answers.** Using `sleep` in tests, or mocking by method swizzling.

### A SwiftUI screen loads data in onAppear and sometimes shows stale results after navigating back. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://developer.apple.com/documentation/swiftui -->
**Observe.** Back navigation shows the old state; sometimes two loads run concurrently.

**Hypothesise.** `onAppear` runs on every appearance, starts an unmanaged `Task`, and nothing cancels the previous one.

**Verify.** Log in `onAppear` and in the task completion with a counter.

**Fix.** Use `.task`, which ties work to the view's lifetime, and key it on the input.

```swift
.task(id: userID) {
  do {
    profile = try await api.profile(userID)
  } catch is CancellationError {
    // view disappeared, ignore
  } catch {
    errorMessage = error.localizedDescription
  }
}
```

For pull-to-refresh use `.refreshable { await model.reload() }`. Share the loading logic in the view model, so state survives navigation.

**Prevent.** Avoid `Task { }` inside `onAppear` unless you store and cancel it.

**Common wrong answers.** Adding a boolean `hasLoaded` that never refreshes.

### An actor method works but UI updates from it crash with "UI API called on a background thread". What went wrong?
<!-- level: intermediate; kind: scenario; ref: https://developer.apple.com/documentation/swift/mainactor -->
**Observe.** The Main Thread Checker warns, or UIKit crashes, when updating a label after an actor call.

**Hypothesise.** The code after the `await` resumed in a non-main context, because the surrounding function is not `@MainActor`, or a callback from a legacy API ran on a background queue.

**Verify.** Print `Thread.isMainThread` and check isolation of the calling function.

**Fix.** Make UI-touching types `@MainActor`.

```swift
@MainActor
final class ProfileViewController: UIViewController {
  func refresh() async {
    let profile = await store.profile()   // hops to actor, resumes on main
    nameLabel.text = profile.name         // safe: main actor isolated
  }
}
```

For legacy callbacks use `await MainActor.run { }` or `Task { @MainActor in }`.

**Prevent.** Turn on strict concurrency so the compiler flags cross-isolation access.

**Common wrong answers.** Sprinkling `DispatchQueue.main.async` randomly instead of fixing isolation.

### Your app's launch time is slow in cold start. How do you measure and reduce it in an iOS app?
<!-- level: advanced; kind: scenario; ref: https://developer.apple.com/documentation/xcode/reducing-your-app-s-launch-time -->
**Observe.** Users and MetricKit report launch above one to two seconds.

**Hypothesise.** Heavy work before the first frame: many dynamic frameworks, big static initialisers, synchronous disk or network I/O in `application(_:didFinishLaunching:)`, or eager SDK initialisation.

**Verify.** Use Instruments' App Launch template, check pre-main (dyld) time and post-main time, add `os_signpost` intervals, and review MetricKit launch histograms.

**Fix.**
- Merge or statically link frameworks, remove unused ones.
- Defer non-critical SDKs and warm-up to after the first frame, using `Task` with lower priority.
- Replace synchronous disk reads with lazy loading.
- Avoid heavy global `let` initialisers, which run on first use.
- Render a lightweight first screen, load content asynchronously.

**Prevent.** Add a launch-time performance test (`XCTApplicationLaunchMetric`) in CI.

**Common wrong answers.** Hiding the delay with a longer launch screen or moving all work to a background queue without checking dependencies.

### You must migrate a callback-based networking layer to async/await without breaking callers. How do you do it?
<!-- level: intermediate; kind: scenario; ref: https://developer.apple.com/documentation/swift/withcheckedthrowingcontinuation(isolation:function:_:) -->
**Observe.** A large codebase uses `completion: (Result<T, Error>) -> Void` everywhere.

**Hypothesise.** A big-bang rewrite is risky; both styles can coexist during migration.

**Verify.** Identify the lowest layer (transport) and callers by module.

**Fix.** Provide async wrappers over the old API with continuations, then migrate callers gradually, and eventually invert (callback versions call async ones).

```swift
func fetchUser(id: Int) async throws -> User {
  try await withCheckedThrowingContinuation { cont in
    legacy.fetchUser(id: id) { cont.resume(with: $0) }   // Result overload
  }
}
```

Ensure each path resumes exactly once; delegate APIs called many times should become `AsyncStream`. Xcode's refactor action "Convert Function to Async" helps. Add `@available(*, deprecated)` on callback versions.

**Prevent.** Test cancellation: wrap with `withTaskCancellationHandler` to cancel the underlying request.

**Common wrong answers.** Using semaphores to block async code in sync functions (deadlocks and thread starvation).

### A struct with a closure property no longer conforms to Hashable or Codable. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://developer.apple.com/documentation/swift/hashable -->
**Observe.** Compiler: "Type does not conform to protocol Hashable" after adding `var onTap: () -> Void`.

**Hypothesise.** Closures are not Equatable, Hashable, or Codable, so synthesis fails.

**Verify.** Read which member is blamed.

**Fix.** Separate identity data from behaviour, or implement conformance manually over stable fields.

```swift
struct Row: Identifiable, Hashable {
  let id: Int
  let title: String
  var onTap: () -> Void = {}

  static func == (l: Row, r: Row) -> Bool { l.id == r.id && l.title == r.title }
  func hash(into h: inout Hasher) { h.combine(id); h.combine(title) }
}
```

Better design: keep models pure data (Codable, Hashable) and pass actions separately, for example through the view or a view model. For Codable, add `CodingKeys` that exclude the closure.

**Prevent.** Keep model types free of behaviour closures.

**Common wrong answers.** Ignoring `==`/hash mismatch, which breaks sets and diffing.

### A Core Data or SwiftData-backed screen shows "Unable to access object from a different thread". How do you handle it?
<!-- level: advanced; kind: scenario; ref: https://developer.apple.com/documentation/swiftdata -->
**Observe.** Random crashes when background work touches model objects fetched on another context.

**Hypothesise.** Persistent model objects are bound to the context (and queue/actor) that created them, and are not Sendable.

**Verify.** Check which context fetched the object and where it is used; in Swift 6 mode the compiler flags the capture.

**Fix.** Do not pass model objects across isolation boundaries. Pass identifiers (`PersistentIdentifier` or `NSManagedObjectID`) or plain value snapshots, and refetch in the destination context.

```swift
@ModelActor
actor Importer {
  func importItems(_ dtos: [ItemDTO]) throws {
    for d in dtos { modelContext.insert(Item(name: d.name)) }
    try modelContext.save()
  }
}
// call: await importer.importItems(dtos)  // DTOs are Sendable structs
```

Use `@Query` in views (main context) and background actors for imports. For Core Data use `perform` blocks and background contexts.

**Prevent.** Define DTO structs for transfer.

**Common wrong answers.** Sharing one context across threads with locks.

### Memory spikes while processing hundreds of photos in a loop. How do you contain it?
<!-- level: intermediate; kind: scenario; ref: https://developer.apple.com/documentation/xcode/gathering-information-about-memory-use -->
**Observe.** Memory climbs until the system terminates the app; Instruments Allocations show many large images alive.

**Hypothesise.** Full-size images are decoded for each item, and autoreleased Objective-C objects (UIImage, Data bridged) accumulate until the loop ends. All images are held in an array.

**Verify.** Profile with Allocations and watch the live bytes during the loop.

**Fix.**

```swift
for url in urls {
  autoreleasepool {
    guard let image = downsample(url, maxPixel: 1024) else { return }
    process(image)
  }
}

func downsample(_ url: URL, maxPixel: Int) -> UIImage? {
  let opts = [kCGImageSourceCreateThumbnailFromImageAlways: true,
              kCGImageSourceThumbnailMaxPixelSize: maxPixel] as CFDictionary
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
        let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts) else { return nil }
  return UIImage(cgImage: cg)
}
```

Process lazily or in bounded batches and avoid keeping results in memory when you can write them out.

**Prevent.** Cap concurrency with a task group that limits in-flight tasks.

**Common wrong answers.** Increasing available memory expectations or loading everything first.

### Two SwiftUI screens need the same shared model, but changes in one do not appear in the other. What is wrong?
<!-- level: intermediate; kind: scenario; ref: https://developer.apple.com/documentation/swiftui/managing-model-data-in-your-app -->
**Observe.** Editing a profile on screen A leaves screen B stale.

**Hypothesise.** Each screen creates its own copy of the model (`@State private var model = ProfileModel()` in both), or a value-type model is passed by copy.

**Verify.** Print object identity (`ObjectIdentifier(model)`) in both views.

**Fix.** Create the model once at the owner (the app or a common ancestor) and share it via the environment.

```swift
@Observable final class ProfileStore { var name = "" }

@main struct MyApp: App {
  @State private var store = ProfileStore()
  var body: some Scene {
    WindowGroup { RootView().environment(store) }
  }
}

struct EditView: View {
  @Environment(ProfileStore.self) private var store
  var body: some View { @Bindable var s = store; TextField("Name", text: $s.name) }
}
```

On iOS 16 and earlier use `ObservableObject` with `@StateObject` at the owner and `@EnvironmentObject` below.

**Prevent.** One owner per piece of state.

**Common wrong answers.** `@ObservedObject` created inline in a child (recreated on every update).

### Your app must support deep links and restore navigation after relaunch. How do you design it in SwiftUI?
<!-- level: advanced; kind: scenario; ref: https://developer.apple.com/documentation/swiftui/navigationstack -->
**Observe.** Push notifications and universal links should land on a detail screen several levels deep.

**Hypothesise.** Navigation using `NavigationLink(destination:)` closures has no addressable state.

**Verify.** Check whether any route can be described as data.

**Fix.** Model routes as `Hashable` values and store the path.

```swift
enum Route: Hashable, Codable { case order(Int), profile(String) }

@Observable final class Router {
  var path: [Route] = []
  func open(_ url: URL) {
    if url.pathComponents.contains("orders"), let id = Int(url.lastPathComponent) {
      path = [.order(id)]
    }
  }
}

NavigationStack(path: $router.path) {
  Home().navigationDestination(for: Route.self) { route in
    switch route { case .order(let id): OrderView(id: id); case .profile(let u): ProfileView(user: u) }
  }
}
.onOpenURL { router.open($0) }
```

Persist `path` as JSON with `SceneStorage` or app storage for restoration. Fetch data in the destination using the id.

**Prevent.** Unit-test the URL-to-route parser.

**Common wrong answers.** Passing whole model objects through links, which cannot be restored.

### A third-party SDK is not Sendable-correct and blocks your move to Swift 6 mode. What are your options?
<!-- level: advanced; kind: scenario; ref: https://www.swift.org/migration/documentation/migrationguide/ -->
**Observe.** Errors originate from SDK types used across actors.

**Hypothesise.** The SDK predates concurrency checking and does not annotate Sendable or isolation.

**Verify.** Check the SDK's latest release notes and issue tracker, and whether it offers async APIs.

**Fix.**
1. Update the SDK if a Swift 6-ready version exists.
2. Use `@preconcurrency import SDK` to downgrade its diagnostics.
3. Wrap the SDK in your own actor or `@MainActor` type, exposing Sendable value types, so unsafe types never cross boundaries.
4. Retroactive conformance `extension SDKType: @retroactive @unchecked Sendable {}` only after verifying thread-safety, with a comment.
5. Keep that target in Swift 5 mode while others move to 6 (mode is per target).

```swift
actor SDKGateway {
  private let client = LegacyClient()
  func track(_ event: String) { client.track(event) }
}
```

**Prevent.** Prefer SDKs that publish Sendable annotations.

**Common wrong answers.** Disabling checking globally.

### A date formatted for users shows the wrong day or format in some regions. How do you debug it?
<!-- level: basic; kind: scenario; ref: https://developer.apple.com/documentation/foundation/date/formatstyle -->
**Observe.** A due date displays one day early for some users, or in a US format in a UK locale.

**Hypothesise.** A hard-coded `DateFormatter` format and time zone, parsing date-only strings as UTC midnight, or a formatter created with `en_US_POSIX` used for display.

**Verify.** Run with different scheme regions and time zones in Xcode (Options, App Region and time zone overrides) and print `TimeZone.current`.

**Fix.** Use locale-aware formatting for display and `en_US_POSIX` with fixed formats only for parsing wire data.

```swift
let text = date.formatted(date: .abbreviated, time: .omitted)   // iOS 15+

let parser = DateFormatter()
parser.locale = Locale(identifier: "en_US_POSIX")
parser.timeZone = TimeZone(secondsFromGMT: 0)
parser.dateFormat = "yyyy-MM-dd"
```

Store timestamps as `Date` (absolute instants) and calendar days as `DateComponents`.

**Prevent.** Unit tests in several locales and time zones; reuse formatters because creating them is costly.

**Common wrong answers.** Adding or subtracting 24 hours to compensate.

### Your app uses Combine pipelines and the team wants to adopt async/await. How do you decide what to migrate?
<!-- level: advanced; kind: scenario; ref: https://developer.apple.com/documentation/combine -->
**Observe.** Mixed code with `sink`, `flatMap`, `AnyCancellable` sets, and new async code.

**Hypothesise.** Not everything benefits from rewriting; Combine's operators (debounce, combineLatest, merge) are strong for event streams, while one-shot requests fit async/await.

**Verify.** Inventory pipelines: one-shot request, long-lived stream, UI binding.

**Fix.**
- Convert one-shot `URLSession.dataTaskPublisher` chains to `async throws` functions.
- Keep or bridge streams: `for await value in publisher.values` consumes a publisher as an AsyncSequence.
- In SwiftUI, prefer `@Observable` and `.task` over publishers for view state.
- For debounce and merge, either keep Combine or use `swift-async-algorithms`.

```swift
for await text in searchSubject.debounce(for: .milliseconds(300), scheduler: RunLoop.main).values {
  results = await api.search(text)
}
```

**Prevent.** Settle on conventions: async for request/response, streams for events.

**Common wrong answers.** Rewriting everything at once, or leaving cancellables unmanaged during bridging.

### A struct containing an array is copied in a loop and performance degrades to quadratic. How do you diagnose it?
<!-- level: advanced; kind: scenario; ref: https://developer.apple.com/documentation/swift/array -->
**Observe.** Processing 100k items takes seconds; the Time Profiler shows `Array` buffer copies (`_copyToNewBuffer`).

**Hypothesise.** The array's storage is shared by two references when mutated, which triggers copy-on-write of the whole buffer each iteration, for instance when a copy of the struct is kept alive or a property is read through a non-inout path.

**Verify.** Check the profile for allocation and memcpy hot spots; test `isKnownUniquelyReferenced` on custom storage, and review whether you take snapshots in loops.

**Fix.** Ensure unique ownership during mutation, avoid holding extra copies, and mutate in place.

```swift
// slow: result copied each iteration because `state` still references it
for x in input { var copy = state.items; copy.append(x); state.items = copy }

// fast: mutate in place
for x in input { state.items.append(x) }
state.items.reserveCapacity(input.count)
```

Use `reduce(into:)` rather than `reduce(_:_:)` when building collections.

**Prevent.** Benchmark with Instruments before and after.

**Common wrong answers.** Switching to a class to "avoid copies" without understanding the cause.

### The App Store build crashes at launch but debug builds run fine. How do you debug a release-only crash?
<!-- level: advanced; kind: scenario; ref: https://developer.apple.com/documentation/xcode/diagnosing-issues-using-crash-reports-and-device-logs -->
**Observe.** TestFlight users crash on launch; no repro in debug.

**Hypothesise.** Differences: optimisation (`-O`) exposes undefined behaviour or concurrency races, missing resources or entitlements in the release configuration, `#if DEBUG` code paths, missing `Info.plist` privacy strings, or a server configuration only present in production.

**Verify.** Download crash logs from Xcode Organizer, symbolicate with the dSYM (check it was uploaded), and read the crashed thread's last frames. Reproduce by running the Release scheme on a device (Edit Scheme, Run, Build Configuration: Release). Enable Address Sanitizer and Thread Sanitizer in testing.

**Fix.** Address the root cause (for example a force unwrap on a value that is only set in debug config), and add the privacy usage strings or entitlement.

**Prevent.** Run UI tests against a Release-configured build in CI, keep dSYM upload automated, and stage releases with TestFlight and phased rollout.

**Common wrong answers.** Disabling optimisation permanently or ignoring unsymbolicated logs.
