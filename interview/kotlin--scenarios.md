### Your Android app crashes with NullPointerException in Kotlin code that has no !!. How is that possible?
<!-- level: intermediate; kind: scenario; ref: https://kotlinlang.org/docs/java-interop.html#null-safety-and-platform-types -->
Observe: the stack trace points to a line using a value from a Java library, an Android framework call, or reflection-based deserialisation.

Hypothesise: a platform type (`String!`) returned by Java was assumed non-null; or Gson/Moshi-reflection filled a non-null Kotlin property with null because the JSON field was missing and constructors were bypassed; or a `lateinit` property was read before assignment (different exception) ; or Kotlin's generated parameter null-check (`Intrinsics.checkNotNullParameter`) fired when Java passed null.

Verify: read the exception type and message; the intrinsic check names the parameter. Hover over the expression in the IDE to see the `!` type. Inspect the actual JSON.

Fix: declare nullable types at Java boundaries (`val s: String? = api.name()`) and handle them; model optional JSON fields as nullable or with defaults; use kotlinx.serialization which fails with a clear error for missing required fields.

Prevent: enable strict JSR-305 or Jakarta annotation handling with `-Xjsr305=strict`, annotate Java sources, and validate DTOs at the boundary.

Wrong answer: sprinkling `?.` everywhere to hide it; it masks bad data.

### A coroutine keeps running after the user leaves the screen, wasting battery. Why?
<!-- level: intermediate; kind: scenario; ref: https://kotlinlang.org/docs/coroutines-basics.html#structured-concurrency -->
Observe: logs or a profiler show network or polling work continuing after navigation.

Hypothesise: the coroutine was launched in `GlobalScope` or an application-lifetime scope; a Flow is collected in a lifecycle that stays STARTED; a loop does not check cancellation; blocking code inside a coroutine ignores cancellation.

Verify: search for `GlobalScope`; check which scope owns each `launch`; in loops call `ensureActive()` or `isActive`; put a log in `finally` to see if cancellation arrives.

Fix: use `viewModelScope` or `lifecycleScope`; collect flows with `repeatOnLifecycle(STARTED)` or `collectAsStateWithLifecycle()`; make long loops cooperative with suspend calls or `ensureActive()`; wrap blocking calls in `withContext(Dispatchers.IO)` and use interruptible APIs; use `stateIn(WhileSubscribed)` so upstream stops without collectors.

Prevent: lint rule against `GlobalScope`, inject scopes, and test cancellation behaviour.

Wrong answer: catching `CancellationException` and continuing; this breaks cancellation. Rethrow it.

### Two parallel API calls in your suspend function run one after the other. How do you fix it?
<!-- level: basic; kind: scenario; ref: https://kotlinlang.org/docs/coroutines-basics.html -->
Observe: total time equals the sum of both calls instead of the maximum.

Hypothesise: the calls are made sequentially in a plain suspend function; or `async` is used but `await()` is called immediately after each start; or the dispatcher has parallelism one.

Verify: log timestamps at start and end of each call.

Fix: start both before awaiting.

```kotlin
suspend fun load() = coroutineScope {
    val user = async { api.user() }
    val orders = async { api.orders() }
    Screen(user.await(), orders.await())
}
```

`coroutineScope` ensures that if one fails, the other is cancelled and the exception propagates. Use `awaitAll` for lists. Make sure the blocking client is not confined to a single-thread dispatcher.

Prevent: review sequential suspend calls for independence, and measure with timing tests under `runTest`.

Wrong answer: using `GlobalScope.async` or threads manually, which loses structured cancellation and error propagation.

### An exception in one launched coroutine silently cancelled unrelated work in the same scope. What happened?
<!-- level: advanced; kind: scenario; ref: https://kotlinlang.org/docs/exception-handling.html -->
Observe: several sibling jobs stop when one throws.

Hypothesise: the default `Job` propagates a child's failure to the parent, which cancels the other children. That is intended structured concurrency, but wrong for independent tasks.

Verify: log completion and cancellation with `invokeOnCompletion`; check the scope's job type.

Fix: if tasks are independent, use `supervisorScope { }` or a scope built with `SupervisorJob()`, and handle each child's errors with try/catch inside the child or a `CoroutineExceptionHandler` on the root coroutine. Note that a handler installed on a non-root child has no effect. For `async`, exceptions surface at `await`, so catch there.

Prevent: decide per scope whether failures should be all-or-nothing, document it, and test failure paths.

Wrong answer: wrapping `launch { }` in try/catch outside; the exception is not thrown to the caller of `launch`. Another wrong answer: catching `Exception` broadly and swallowing `CancellationException`.

### Your Compose screen recomposes constantly and scrolling is janky. How do you find and fix it?
<!-- level: advanced; kind: scenario; ref: https://developer.android.com/develop/ui/compose/performance -->
Observe: use Layout Inspector's recomposition counts and a Macrobenchmark or profile to see which composables recompose and how often.

Hypothesise: state read too high in the tree (reading scroll offset in a parent), unstable parameters preventing skipping (for example `List<T>` on older compiler settings), new lambda or object allocations per recomposition, heavy work in composition, missing `key` in lists.

Verify: run Compose compiler reports to see which classes and functions are unstable and skippable; check that you are measuring a release build (debug builds are much slower).

Fix: defer state reads (use lambdas such as `Modifier.offset { }` or `graphicsLayer { }`); use `derivedStateOf` for thresholds; make models stable via immutable data classes, `@Immutable`, or kotlinx immutable collections (or rely on strong skipping in newer compilers); move computation into the ViewModel or `remember`; give `LazyColumn` items stable keys and `contentType`.

Prevent: add baseline profiles, benchmark critical screens, and review compiler reports in CI.

Wrong answer: profiling a debug build and optimising what is merely debug overhead.

### State disappears when the device rotates. What are the possible causes?
<!-- level: basic; kind: scenario; ref: https://developer.android.com/develop/ui/compose/state#restore-ui-state -->
Observe: text input or scroll position resets after rotation.

Hypothesise: state held with plain `remember`, which does not survive activity recreation; state stored in the Activity or a composable rather than a ViewModel; ViewModel recreated because it is created in the wrong scope; one-off events stored as state replay oddly.

Verify: rotate and observe whether the ViewModel's `init` runs again; check where each variable is declared.

Fix: use `rememberSaveable` for small UI state, or a `ViewModel` (survives rotation) for screen state, and `SavedStateHandle` in the ViewModel for state that must survive process death. Provide custom `Saver` for non-Bundle types. Obtain the ViewModel with `viewModel()` or `hiltViewModel()` at the right owner.

Prevent: test with "Don't keep activities" and rotation, and agree on where each kind of state lives.

Wrong answer: disabling rotation with `configChanges`, which hides the problem and does not cover process death or other configuration changes.

### Searching as the user types floods the backend and shows results out of order. How do you build this with Flow?
<!-- level: intermediate; kind: scenario; ref: https://kotlinlang.org/docs/flow.html -->
Observe: one request per keystroke and late responses overwriting newer ones.

Hypothesise: each keystroke launches an independent coroutine; responses race.

Verify: log request and response order.

Fix: model the query as a flow and cancel stale work.

```kotlin
val results = query
    .debounce(300)
    .map { it.trim() }
    .filter { it.length >= 2 }
    .distinctUntilChanged()
    .flatMapLatest { q -> flow { emit(repo.search(q)) }.catch { emit(emptyList()) } }
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
```

`flatMapLatest` cancels the previous request when a new query arrives, so outdated results cannot win. Handle errors inside the inner flow so one failure does not terminate the whole stream.

Prevent: test with virtual time (`runTest`, `advanceTimeBy`) to assert debouncing and cancellation.

Wrong answer: `flatMapMerge`, which allows out-of-order completion, or manual `Job` bookkeeping that is easy to get wrong.

### A StateFlow-based UI event (show a snackbar) fires again after rotation. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://developer.android.com/topic/architecture/ui-layer/events -->
Observe: the message shows once more whenever the screen is recreated.

Hypothesise: the event is held in state, so every new collector receives the current value again, including after configuration changes.

Verify: reproduce with rotation; inspect that the state still contains the message.

Fix: treat events as state that is consumed. The ViewModel exposes `UiState(userMessage: String?)`; the UI shows it and calls `vm.messageShown()`, which clears it. This guarantees delivery exactly once with no lost events when the UI is not collecting. Alternatives such as `Channel` with `receiveAsFlow` can lose or duplicate events in edge cases and are generally less robust, and a `SharedFlow` without replay drops events while nobody is collecting.

Prevent: define a team convention for one-off events and add a UI test with rotation.

Wrong answer: using `SingleLiveEvent`-style hacks or resetting state in `onCreate`, which is fragile.

### Gson parses your Kotlin data class with null in a non-null property. Why, and what do you do?
<!-- level: intermediate; kind: scenario; ref: https://github.com/Kotlin/kotlinx.serialization/blob/master/docs/serialization-guide.md -->
Observe: a NullPointerException occurs later, far from parsing, for a field declared `val name: String`.

Hypothesise: Gson uses reflection and `Unsafe` allocation, bypassing the Kotlin constructor, default values and null checks, so a missing or null JSON field stays null despite the non-null type.

Verify: log the raw JSON; read the field through reflection or print the object immediately after parsing.

Fix: migrate to kotlinx.serialization or Moshi with the Kotlin codegen or reflect adapter, both of which respect nullability and defaults and fail with explicit errors for missing required fields. Mark optional fields as nullable with defaults (`val note: String? = null`) and configure `ignoreUnknownKeys` consciously. Add a validation step on DTOs before mapping to domain models.

Prevent: keep DTOs separate from domain classes, and contract-test against recorded API responses.

Wrong answer: adding `?.` and `!!` downstream; the data contract remains broken.

### Your build after upgrading to Kotlin 2.x fails with KSP and Compose plugin errors. What do you check?
<!-- level: advanced; kind: scenario; ref: https://kotlinlang.org/docs/whatsnew20.html -->
Observe: errors mention incompatible plugin versions or metadata versions.

Hypothesise: compiler plugins and annotation processors are tied to specific Kotlin versions. KSP versions are named with the Kotlin version prefix; the Compose compiler moved into a Kotlin Gradle plugin (`org.jetbrains.kotlin.plugin.compose`) in Kotlin 2.0; kapt-based processors may run on the older language mode; libraries compiled with newer Kotlin than your compiler can read.

Verify: list plugin and dependency versions in the version catalog; run `./gradlew dependencies` and `--info` to find the failing task.

Fix: align KSP to the Kotlin version, apply the Compose compiler plugin with the same version as Kotlin, remove the old `composeOptions { kotlinCompilerExtensionVersion }`, update Hilt, Room and other processors, and fix new K2 diagnostics. Upgrade in a branch, in small steps.

Prevent: manage versions in one catalog, use dependency update tooling, and run CI on the upgraded toolchain before merging.

Wrong answer: pinning `languageVersion` to 1.9 permanently to avoid K2; it postpones the work.

### Unit tests with coroutines are slow and flaky because of delay() and real dispatchers. How do you fix them?
<!-- level: intermediate; kind: scenario; ref: https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-test/ -->
Observe: tests sleep for real time and sometimes fail on timing.

Hypothesise: tests use `runBlocking` and `Thread.sleep`, classes hard-code `Dispatchers.IO` or `Dispatchers.Main`, and background coroutines race with assertions.

Verify: search for `runBlocking` and sleeps in tests; see which dispatchers production classes use.

Fix: use `runTest`, which skips delays with virtual time. Inject a `CoroutineDispatcher` into classes and provide `StandardTestDispatcher(testScheduler)` in tests. Replace `Dispatchers.Main` using `Dispatchers.setMain` and reset it after. Control time with `advanceTimeBy` and `advanceUntilIdle`. Collect flows in `backgroundScope` or use Turbine to assert emissions.

Prevent: a base test rule for the main dispatcher, and a convention that dispatchers are injected.

Wrong answer: increasing sleep durations to make tests pass, which makes them slower and still flaky. Another wrong answer is using `UnconfinedTestDispatcher` everywhere, which hides ordering bugs.

### A Java service calling your Kotlin library cannot use default arguments and companion functions. What do you change?
<!-- level: intermediate; kind: scenario; ref: https://kotlinlang.org/docs/java-to-kotlin-interop.html -->
Observe: Java code must pass every parameter and writes `Config.Companion.create()`.

Hypothesise: defaults compile into a synthetic method that Java does not see; companion members are instance methods of `Companion`.

Verify: decompile with `javap` or Show Kotlin Bytecode to see the signatures.

Fix: add `@JvmOverloads` to functions and constructors with defaults; `@JvmStatic` on companion and object functions; `@JvmField` or `const val` for constants; `@file:JvmName("Utils")` for readable top-level functions class names; `@Throws(IOException::class)` where Java callers must catch checked exceptions; expose `CompletableFuture` wrappers for suspend functions (`future { }` from kotlinx-coroutines-jdk8).

Prevent: if your library has Java consumers, add a small Java test module that calls the public API and fails when ergonomics regress. Consider binary compatibility validator tooling for public API.

Wrong answer: rewriting the library in Java or forcing callers to pass `Continuation` objects manually.

### Memory grows in a processing pipeline that maps and filters a very large list several times. What do you change?
<!-- level: intermediate; kind: scenario; ref: https://kotlinlang.org/docs/sequences.html -->
Observe: heap profiler shows many large intermediate `ArrayList`s alive during processing.

Hypothesise: each eager `map`/`filter` allocates a complete new list.

Verify: heap dump and allocation profile on the pipeline.

Fix: switch to sequences (`asSequence()`), so elements flow one at a time and only the final collection is materialised; or process the source in a streaming way (read file with `useLines`, a `Flow` from the database cursor, or chunked processing with `chunked`). If the final operation needs everything (sorting), consider whether it can be limited with `take` or pushed to the database.

Prevent: choose sequences for big multi-step pipelines, and keep eager operations for small data where sequences add overhead.

Trade-off: sequences are slower for small inputs and sometimes harder to debug; measure rather than assume. Wrong answer: calling `toList()` after every step of the sequence, which brings back the intermediate lists.

### Your sealed class hierarchy gains a new subtype and a bug appears in production, not at compile time. Why?
<!-- level: intermediate; kind: scenario; ref: https://kotlinlang.org/docs/sealed-classes.html -->
Observe: a new state is handled incorrectly in a branch that should have been flagged.

Hypothesise: a `when` used as a statement with an `else` branch (or `else -> Unit`) swallows new subtypes; the sealed type lives in another module so exhaustiveness is checked at different compile times; `when` on a non-sealed supertype.

Verify: search for `else` branches in `when` over that type. Kotlin 1.7 made non-exhaustive `when` statements on sealed types an error, but `else` still silences it.

Fix: remove the `else` so adding a subtype breaks compilation; use `when` as an expression to force exhaustiveness; keep the sealed hierarchy and its consumers in modules built together, or document a default behaviour deliberately.

Prevent: lint or detekt rule against `else` on sealed `when`, and tests for each subtype in state mapping.

Wrong answer: using an enum plus nullable fields or an open class hierarchy, which loses compiler help.

### Your Kotlin Multiplatform shared module fails to compile for iOS with an unresolved reference to a JVM class. What happened?
<!-- level: intermediate; kind: scenario; ref: https://kotlinlang.org/docs/multiplatform-expect-actual.html -->
Observe: Android builds pass, iOS compilation errors on `java.util.UUID` or `java.io.File` in `commonMain`.

Hypothesise: JVM-only APIs leaked into common code, perhaps because the IDE resolved against the Android target.

Verify: check the source set where the file lives and the target the IDE analyses.

Fix: use Kotlin common stdlib alternatives (for example `kotlin.uuid.Uuid`, which is experimental in recent versions, kotlinx-datetime instead of `java.time`, Okio or kotlinx-io for files). Where there is no common API define `expect`/`actual`, or better an interface in common code with platform implementations injected. Move JVM-only dependencies into `androidMain` or `jvmMain`.

Prevent: build all targets in CI on every change, and prefer multiplatform libraries.

Wrong answer: copying logic separately for each platform; this defeats the purpose of sharing.

### Your lazy-initialised singleton was created twice under load. How is that possible in Kotlin?
<!-- level: advanced; kind: scenario; ref: https://kotlinlang.org/docs/delegated-properties.html#lazy-properties -->
Observe: duplicate instances or duplicate initialisation side effects.

Hypothesise: `by lazy(LazyThreadSafetyMode.PUBLICATION)` allows the initializer to run multiple times concurrently, with only the first result kept; `NONE` is unsynchronised; a manual `if (instance == null)` check is racy; an `object` is safe, but a class instantiated per DI scope is not a singleton.

Verify: check the lazy mode; add logging to the initializer; review DI scope definitions.

Fix: use the default `lazy` (synchronized), or an `object` declaration for true singletons, or DI singleton scope. Keep initialisers free of side effects if `PUBLICATION` is chosen deliberately for performance. For suspend initialisation, use a `Mutex` or a `CompletableDeferred`/`async(start = LAZY)` pattern.

Prevent: prefer the default mode unless profiling justifies another, and test concurrency with many coroutines starting simultaneously.

Wrong answer: adding `@Volatile` and double-checked locking by hand when `lazy` already provides it.

### Equal-looking data class instances are treated as different in a HashSet. Why?
<!-- level: intermediate; kind: scenario; ref: https://kotlinlang.org/docs/data-classes.html -->
Observe: duplicates appear in a set, or lookup in a map fails.

Hypothesise: a mutable property included in the primary constructor was changed after insertion, changing `hashCode` so the element sits in the wrong bucket; or the properties that define equality are declared in the class body and thus excluded; or a property holds an array (compared by reference).

Verify: print `hashCode()` before and after mutation; inspect which properties are in the constructor; check array fields.

Fix: use `val` properties and `copy` for changes; make key types immutable; put identity-defining fields in the constructor; for arrays use `List` or override `equals`/`hashCode` with `contentEquals` and `contentHashCode`.

Prevent: never use mutable objects as keys, and write equality tests for domain types.

Wrong answer: overriding `hashCode` to return a constant, which makes lookups linear. Also the surprising case: floating-point fields and `NaN` comparisons in equality.

### Production logs show ConcurrentModificationException in a Kotlin class that uses a mutableListOf from several coroutines. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://kotlinlang.org/docs/shared-mutable-state-and-concurrency.html -->
Observe: intermittent exception when iterating while another coroutine appends.

Hypothesise: `mutableListOf` is not thread-safe, and coroutines on multi-threaded dispatchers run in parallel.

Verify: identify all writers and readers and their dispatchers; reproduce with a stress test.

Fix: confine mutation to a single thread or coroutine (a single-thread dispatcher, or an actor-style `Channel`), or protect with a `Mutex` (`mutex.withLock { }`) for suspendable critical sections, or use `MutableStateFlow.update` with immutable collections for atomic replacement. For counters use `AtomicInteger`. Thread-safe collections such as `ConcurrentHashMap` help for simple cases but compound operations still need care.

Prevent: expose immutable snapshots to callers and keep mutable state private, and stress-test concurrent code.

Wrong answer: marking the list `@Volatile`; that protects the reference, not its contents. Also avoid `synchronized` around suspend calls, because it blocks threads.

### A network call inside a coroutine blocks the main thread and the app shows an ANR. How do you fix it?
<!-- level: basic; kind: scenario; ref: https://developer.android.com/kotlin/coroutines/coroutines-best-practices -->
Observe: ANR trace shows the main thread inside a socket or database call, or StrictMode reports network on main.

Hypothesise: a blocking call is executed on `Dispatchers.Main` because `launch` inherits the caller's dispatcher; being a `suspend` function does not make blocking code non-blocking.

Verify: log `Thread.currentThread().name` in the call; run StrictMode in debug builds.

Fix: make main-safe suspend functions that switch internally: `suspend fun load() = withContext(ioDispatcher) { client.execute(request) }`, so callers never need to know. Prefer libraries with true suspend APIs (Retrofit suspend, Ktor, Room suspend DAOs). Inject the dispatcher for testing.

Prevent: enable StrictMode, a rule that repositories are main-safe, and avoid `runBlocking` on the main thread.

Wrong answer: wrapping blocking code in `launch { }` and assuming that makes it asynchronous; without a dispatcher change it still runs on the same thread.

### Your reified inline helper cannot be called from Java and bloats the APK. What are your options?
<!-- level: advanced; kind: scenario; ref: https://kotlinlang.org/docs/inline-functions.html -->
Observe: Java callers get no usable method, and the method count and DEX size grow.

Hypothesise: `inline` with `reified` functions are not callable from Java with type arguments, and large inline bodies are copied at every call site.

Verify: check the bytecode size of call sites; inspect the DEX with the APK analyser.

Fix: keep the inline function tiny and delegate to a non-inline function that takes `Class<T>` or `KClass<T>`:

```kotlin
inline fun <reified T> Gson.parse(s: String): T = parse(s, T::class.java)
fun <T> Gson.parse(s: String, type: Class<T>): T = fromJson(s, type)
```

The reified wrapper stays a one-liner for Kotlin callers; Java uses the `Class` overload and the heavy code exists once. Use `@PublishedApi internal` for helpers an inline public function needs.

Prevent: inline only small lambda-taking or reified functions, and watch the build size in CI.

Wrong answer: removing `inline` and using unchecked casts; type safety is lost.

### A suspend function you wrapped around a callback API never resumes when the user cancels. How do you fix it?
<!-- level: advanced; kind: scenario; ref: https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/suspend-cancellable-coroutine.html -->
Observe: cancelled coroutines hang or the underlying request keeps going and later crashes by resuming a dead continuation.

Hypothesise: `suspendCoroutine` was used, which ignores cancellation; the callback may fire twice; the request is not cancelled.

Verify: write a test that cancels the caller and checks that the request is cancelled and resources released.

Fix:

```kotlin
suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, r: Response) = cont.resume(r)
        override fun onFailure(call: Call, e: IOException) { if (!cont.isCancelled) cont.resumeWithException(e) }
    })
    cont.invokeOnCancellation { cancel() }
}
```

Use `suspendCancellableCoroutine`, register `invokeOnCancellation`, and ensure resuming only once.

Prevent: prefer library-provided suspend adapters, and unit test cancellation paths.

Wrong answer: using `runBlocking` inside the callback or leaving the cancellation handler out.

### A Gradle multi-module Kotlin build has become very slow. What do you investigate?
<!-- level: intermediate; kind: scenario; ref: https://docs.gradle.org/current/userguide/performance.html -->
Observe: run a build scan or `--profile` and find which tasks and configuration phases dominate, for clean and incremental builds.

Hypothesise: kapt annotation processing, no build cache, configuration cache disabled, too few modules (monolith recompiles everything) or ABI changes cascading through `api` dependencies, daemon memory too small, scripts doing work during configuration.

Verify: check task timings, cache hit rate and which module changes force the most recompilation.

Fix: migrate kapt to KSP where libraries support it; enable build cache and configuration cache; switch `api` to `implementation` to limit recompilation; split large modules along stable boundaries; give the daemon enough memory (`org.gradle.jvmargs`); use convention plugins to avoid per-module overhead; keep Kotlin incremental compilation enabled.

Prevent: track build times in CI, and review dependency scopes in code reviews.

Wrong answer: only buying faster hardware, or disabling tests to look faster.

### Reviewers find !! all over a codebase. How do you reduce it responsibly?
<!-- level: basic; kind: scenario; ref: https://kotlinlang.org/docs/null-safety.html -->
Observe: categorise each `!!`: after a null check that smart cast cannot see (mutable property), Java boundary, `findViewById`-style lookups, map access, or lazy laziness.

Hypothesise: the type design lets null states exist where they should not.

Verify: for each, ask what would happen if it were null and whether that is truly impossible.

Fix: copy mutable properties into a local `val` to allow smart casts; use `?:` with `return`, `error()` or `requireNotNull(x) { "message" }` so failures are explained; model required values as non-null constructor parameters; use `getValue` or `getOrElse` for maps; use sealed state instead of nullable fields that are valid together; resolve platform types at the boundary; use `lateinit` or `lazy` for deferred initialisation.

Prevent: detekt rule `UnsafeCallOnNullableType`, and code review guidance.

Wrong answer: banning `!!` mechanically and replacing it with `?.let` that silently does nothing; failing fast with a clear message is sometimes better than hiding bad state.

### Moving shared logic to Kotlin Multiplatform: how do you decide what to share and what to keep native?
<!-- level: advanced; kind: scenario; ref: https://kotlinlang.org/docs/multiplatform-intro.html -->
Observe: list features, team skills, release cadence and what is duplicated across Android and iOS today.

Hypothesise: the biggest, safest gains are in logic with no UI or platform dependence: networking, models, validation, caching, business rules, analytics; UI sharing has different trade-offs.

Verify: prototype one slice, such as an API client plus repository, in a shared module; measure build times, binary size, debugging experience and iOS developer feedback.

Fix or decide: share domain and data layers first via a shared module exposed to Swift (watch for coroutine and Flow ergonomics in Swift, using wrappers or libraries that bridge them); keep platform-specific code behind interfaces; decide on Compose Multiplatform only if the team wants shared UI and accepts platform-feel trade-offs; adopt incrementally, module by module.

Prevent: define module boundaries, a test strategy in `commonTest`, and CI building all targets.

Wrong answer: rewriting the entire app at once or sharing code merely because it is possible; adoption should follow measured duplication cost.

### Your Compose preview works but the screen crashes at runtime because a ViewModel cannot be created. What is wrong?
<!-- level: intermediate; kind: scenario; ref: https://developer.android.com/develop/ui/compose/tooling/previews -->
Observe: exception such as "Cannot create an instance of class ...ViewModel" or a missing Hilt component.

Hypothesise: the ViewModel has constructor parameters but no factory; Hilt is not set up on the Activity (`@AndroidEntryPoint`) or the ViewModel (`@HiltViewModel`); previews call the composable with a real ViewModel.

Verify: read the stack trace for the missing binding or factory; check annotations and graph setup.

Fix: provide a `ViewModelProvider.Factory` (or use `viewModelFactory { initializer { } }`), or use Hilt with `@HiltViewModel` and `hiltViewModel()`. Design composables so that screen-level composables get the ViewModel and pass plain state and lambdas to stateless composables; previews then call the stateless version with sample data.

Prevent: keep ViewModel access at the screen boundary, and add a UI test that launches each screen.

Wrong answer: constructing the ViewModel with `ViewModel()` manually inside the composable, losing lifecycle scoping and state retention.
