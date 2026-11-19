## 11. Android and Jetpack Compose

### Declarative UI with Jetpack Compose
<!-- level: basic; ref: https://developer.android.com/develop/ui/compose/mental-model -->
Jetpack Compose is Android's declarative UI toolkit written in Kotlin. Instead of mutating a view tree, you write `@Composable` functions that describe the UI for the current state. When state changes, Compose re-runs only the affected composable functions (recomposition) and updates the screen. Composables are ordinary functions that can take parameters, call other composables, and use Kotlin control flow such as `if` and `for` to build UI.

```kotlin
@Composable
fun Greeting(name: String, modifier: Modifier = Modifier) {
    Text(text = "Hello, $name", modifier = modifier.padding(16.dp))
}

setContent {
    MaterialTheme { Greeting("Asha") }
}
```

A `Modifier` chain decorates layout, drawing and input handling; its order matters, for example `padding` before `background` differs from the reverse. Composables should be fast and free of side effects because Compose may call them often and in any order.

Pitfalls:
- Doing network or disk work directly in a composable body.
- Omitting a `modifier` parameter, making components hard to reuse.

Interview tip: explain that UI = f(state) and that you change state, not widgets.

### State, remember and recomposition
<!-- level: intermediate; ref: https://developer.android.com/develop/ui/compose/state -->
Compose observes state objects such as `MutableState`. Reading state inside a composable subscribes that composable to changes; writing triggers recomposition of readers. `remember` keeps a value across recompositions; `rememberSaveable` additionally survives configuration changes and process recreation by saving to a `Bundle`. Without `remember`, a local variable is recreated on every recomposition.

```kotlin
@Composable
fun Counter() {
    var count by rememberSaveable { mutableIntStateOf(0) }
    Button(onClick = { count++ }) { Text("Clicked $count") }
}
```

Use `derivedStateOf` for values computed from other state to avoid unnecessary recomposition, and `key` to give identity to dynamic content. Compose skips composables whose parameters are unchanged and considered stable; with strong skipping (default from Kotlin 2.0.20 compiler plugin) more lambdas and unstable parameters are skipped too.

Pitfalls:
- Mutating a plain mutable list held in state; the UI does not update because the object identity is unchanged. Use immutable collections or `mutableStateListOf`.
- Using `remember` for data that must survive rotation.

Interview tip: name the three things: state holder, remember, and recomposition scope.

### State hoisting
<!-- level: intermediate; ref: https://developer.android.com/develop/ui/compose/state-hoisting -->
State hoisting moves state out of a composable into its caller, leaving the composable stateless: it receives the current value and a callback for changes. This makes components reusable, testable and previewable, and keeps a single source of truth. The pattern is `value` plus `onValueChange`, the same shape as built-in `TextField`.

```kotlin
@Composable
fun SearchBox(query: String, onQueryChange: (String) -> Unit) {
    TextField(value = query, onValueChange = onQueryChange, label = { Text("Search") })
}

@Composable
fun SearchScreen(vm: SearchViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    SearchBox(state.query, vm::onQueryChange)
}
```

Hoist as high as the lowest common owner that needs the state, and no higher. Business state belongs in a ViewModel; purely visual state (scroll position, expanded flag) can live in a small state holder class in the UI layer.

Pitfalls:
- Passing a whole ViewModel deep into composables, which couples and complicates previews.
- Hoisting everything to the top and recomposing large trees.

Interview tip: events flow up, state flows down.

### Side effects in Compose
<!-- level: advanced; ref: https://developer.android.com/develop/ui/compose/side-effects -->
Composable bodies must be free of side effects, so Compose provides effect APIs tied to the composition lifecycle. `LaunchedEffect(key)` starts a coroutine when entering the composition and restarts it when the key changes, cancelling it on leave. `DisposableEffect(key)` registers something and cleans it up in `onDispose`. `rememberCoroutineScope` provides a scope for launching coroutines from event handlers. `SideEffect` runs after every successful recomposition, and `rememberUpdatedState` lets a long-running effect read the latest lambda without restarting.

```kotlin
@Composable
fun Toaster(messages: Flow<String>, snackbar: SnackbarHostState) {
    LaunchedEffect(messages) {
        messages.collect { snackbar.showSnackbar(it) }
    }
}

@Composable
fun BackHandlerCleanup(owner: LifecycleOwner, observer: LifecycleObserver) {
    DisposableEffect(owner) {
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
}
```

Pitfalls:
- Using `LaunchedEffect(Unit)` while capturing changing values, which then go stale.
- Launching coroutines with `GlobalScope` from composables.

Interview tip: choose the key deliberately, since it defines when the effect restarts.

### ViewModel and StateFlow with lifecycle awareness
<!-- level: intermediate; ref: https://developer.android.com/topic/libraries/architecture/viewmodel -->
A `ViewModel` holds UI state and survives configuration changes such as rotation. The common pattern exposes an immutable `StateFlow<UiState>` that the UI observes. Work launched in `viewModelScope` is cancelled when the ViewModel is cleared. In Compose, `collectAsStateWithLifecycle()` (from `lifecycle-runtime-compose`) collects only while the lifecycle is at least STARTED, stopping upstream work in the background; plain `collectAsState()` does not.

```kotlin
class ProfileViewModel(private val repo: ProfileRepo) : ViewModel() {
    val state: StateFlow<ProfileUi> = repo.profile()
        .map { ProfileUi.Loaded(it) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProfileUi.Loading)

    fun refresh() = viewModelScope.launch { repo.refresh() }
}
```

Model screen state as a sealed interface (Loading, Loaded, Error) so illegal combinations are unrepresentable.

Pitfalls:
- Holding a reference to an Activity or Context in a ViewModel, leaking it.
- Modelling one-off events (navigation, toasts) as state, so they replay after rotation.

Interview tip: explain what `WhileSubscribed(5_000)` buys: surviving rotation without restarting upstream.

### Lazy lists and stable keys
<!-- level: intermediate; ref: https://developer.android.com/develop/ui/compose/lists -->
`LazyColumn` and `LazyRow` compose and lay out only visible items, like RecyclerView without adapters. You describe content with the `items` DSL. Supplying a stable, unique `key` per item lets Compose track items when the list is reordered or changed, keeping remembered state attached to the right row and enabling correct animations; without keys, state is tied to position.

```kotlin
LazyColumn {
    items(items = orders, key = { it.id }) { order ->
        OrderRow(order, modifier = Modifier.animateItem())
    }
}
```

Use `contentType` when rows have different layouts to improve reuse, and `rememberLazyListState` to observe or control scroll position. For very large or remote data, use Paging 3 with `collectAsLazyPagingItems()`.

Pitfalls:
- Nesting a vertically scrolling lazy list inside another vertically scrolling container without bounded height, which crashes.
- Heavy work inside item composables; pre-compute in the ViewModel.
- Using index as the key when the list changes.

Interview tip: say that keys preserve state and identity across reordering, and that `animateItem` replaced `animateItemPlacement` in newer Compose versions.

## 12. Kotlin Multiplatform, Testing and Tooling

### Kotlin Multiplatform project structure
<!-- level: intermediate; ref: https://kotlinlang.org/docs/multiplatform-intro.html -->
Kotlin Multiplatform (KMP) lets you share Kotlin code across JVM, Android, iOS, desktop, web and server while keeping native UI or platform code where needed. A shared module is split into source sets. `commonMain` holds platform-independent code and may only use common libraries; platform source sets such as `androidMain`, `iosMain` and `jvmMain` hold platform-specific code; intermediate source sets (for example `iosMain` shared by all iOS targets) are managed by the default hierarchy template. Each source set has a matching test set.

```kotlin
// build.gradle.kts
kotlin {
    androidTarget()
    iosArm64(); iosSimulatorArm64()
    sourceSets {
        commonMain.dependencies {
            implementation("io.ktor:ktor-client-core:3.0.0")
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
        }
    }
}
```

Typical shared layers are networking, persistence, domain and business logic. The UI can stay native (SwiftUI, Compose) or be shared with Compose Multiplatform.

Pitfalls:
- Putting JVM-only libraries in `commonMain`.
- Sharing too much too early; start with logic that has the most duplication.

Interview tip: KMP shares logic, not a mandatory UI; it is an incremental adoption approach.

### expect and actual declarations
<!-- level: intermediate; ref: https://kotlinlang.org/docs/multiplatform-expect-actual.html -->
`expect` declares an API in common code whose implementation differs per platform; each platform provides a matching `actual`. The compiler checks that every target has an implementation. Use it for platform capabilities: UUIDs, file paths, secure storage, logging, or clocks.

```kotlin
// commonMain
expect fun platformName(): String

// androidMain
actual fun platformName(): String = "Android ${android.os.Build.VERSION.SDK_INT}"

// iosMain
actual fun platformName(): String = UIDevice.currentDevice.systemName()
```

Often an interface plus dependency injection is cleaner than expect/actual for classes, since it is easier to fake in tests. Expect/actual classes are in Beta in recent Kotlin versions, whereas functions and properties are stable; check the current status before relying on classes.

Pitfalls:
- Large expect classes duplicating behaviour on each platform.
- Forgetting an `actual` for a newly added target, which fails compilation.

Interview tip: justify choosing an interface and injection versus expect/actual based on testability.

### Ktor client for shared networking
<!-- level: intermediate; ref: https://ktor.io/docs/client-create-new-application.html -->
Ktor is a Kotlin-first, coroutine-based framework with a multiplatform HTTP client. You choose an engine per platform (OkHttp on Android, Darwin on iOS, CIO on JVM) and install plugins for JSON content negotiation, logging, timeouts and auth. Requests are suspend functions.

```kotlin
val client = HttpClient {
    install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
    install(HttpTimeout) { requestTimeoutMillis = 15_000 }
}

@Serializable data class Todo(val id: Int, val title: String)

suspend fun todos(): List<Todo> =
    client.get("https://api.example.com/todos").body()
```

Combined with kotlinx.serialization the same networking layer compiles for every platform. Create one `HttpClient` and reuse it, and close it when no longer needed.

Pitfalls:
- Creating a client per request, wasting connections.
- Not setting timeouts; mobile networks fail slowly.
- Treating non-2xx as exceptions without configuring `expectSuccess` consciously.

Interview tip: mention engines are swappable, so tests can use `MockEngine`.

### Unit testing with kotlin.test and JUnit
<!-- level: basic; ref: https://kotlinlang.org/api/latest/kotlin.test/ -->
`kotlin.test` offers a multiplatform assertion API (`assertEquals`, `assertTrue`, `assertFailsWith`) over JUnit, TestNG or native runners; on the JVM, JUnit 5 is the usual runner. Kotlin allows backtick test names that read like sentences, and `@Test` works the same across platforms in common tests. Test coroutines with `runTest` and use constructor injection to substitute fakes.

```kotlin
class PriceCalculatorTest {
    private val calc = PriceCalculator(taxRate = 0.18)

    @Test
    fun `adds tax to subtotal`() {
        assertEquals(118.0, calc.total(100.0), absoluteTolerance = 0.001)
    }

    @Test
    fun `rejects negative price`() {
        assertFailsWith<IllegalArgumentException> { calc.total(-1.0) }
    }
}
```

Prefer small fakes over heavy mocking for simple collaborators, and test behaviour rather than call counts. Kotest and Spek provide alternative styles and property-based testing.

Pitfalls:
- Final-by-default classes cannot be mocked by older tools without the allopen plugin or a mock-maker that supports finals.
- Comparing floating-point numbers without a tolerance.

Interview tip: explain why fakes and constructor injection beat static singletons for testability.

### Mocking with MockK
<!-- level: intermediate; ref: https://mockk.io/ -->
MockK is a Kotlin-native mocking library that handles final classes, extension functions, objects and coroutines. Create mocks with `mockk<T>()`, stub with `every { ... } returns ...` or `coEvery` for suspend functions, and verify with `verify` and `coVerify`. A relaxed mock returns defaults instead of throwing for unstubbed calls; `spyk` wraps a real object.

```kotlin
@Test
fun `loads user from repo`() = runTest {
    val repo = mockk<UserRepo>()
    coEvery { repo.find(7) } returns User(7, "Asha")

    val service = UserService(repo)
    assertEquals("Asha", service.displayName(7))

    coVerify(exactly = 1) { repo.find(7) }
}
```

Capture arguments with `slot()` and use matchers like `any()` and `match { }`. Mock static or top-level functions with `mockkStatic` and objects with `mockkObject`, undoing them with `unmockkAll()` after tests.

Pitfalls:
- Over-specifying interactions so tests break on refactoring.
- Relaxed mocks hiding missing stubs.
- Leaking global static mocks between tests.

Interview tip: say you mock at architectural boundaries (network, database) and use real objects inside the domain.

### Gradle Kotlin DSL
<!-- level: basic; ref: https://docs.gradle.org/current/userguide/kotlin_dsl.html -->
Gradle build scripts can be written in Kotlin (`build.gradle.kts`) instead of Groovy. You get static typing, code completion, navigation and refactoring in the IDE, and compile-time detection of typos. Plugins are applied in the `plugins { }` block and dependencies declared in `dependencies { }`. Shared versions belong in a version catalog (`gradle/libs.versions.toml`), accessed as type-safe accessors such as `libs.ktor.client.core`.

```kotlin
plugins {
    kotlin("jvm") version "2.0.21"
    kotlin("plugin.serialization") version "2.0.21"
}

dependencies {
    implementation(libs.kotlinx.coroutines.core)
    testImplementation(kotlin("test"))
}

kotlin { jvmToolchain(17) }
tasks.test { useJUnitPlatform() }
```

Convention plugins in `build-logic` or `buildSrc` remove duplicated configuration across modules.

Pitfalls:
- The first sync of `.kts` scripts is slower than Groovy; keep the Gradle daemon and build cache enabled.
- Version strings scattered across modules; centralise them in the catalog.

Interview tip: know that `jvmToolchain` pins the JDK so builds are reproducible across machines.

### The K2 compiler and Kotlin 2.0
<!-- level: advanced; ref: https://kotlinlang.org/docs/whatsnew20.html -->
Kotlin 2.0 (May 2024) made the K2 compiler the default. K2 has a new frontend, based on a single unified representation (FIR), and a new intermediate representation backend, giving faster compilation, better smart casts, and a consistent base for IDE tooling and multiplatform compilation. Examples of improved smart casts include locally declared boolean conditions, `||` combinations that infer a common supertype, and casts that survive in lambdas when the variable is not modified afterwards.

```kotlin
fun describe(x: Any) {
    val isText = x is String
    if (isText) println(x.length)   // smart cast works with K2
}
```

Source compatibility is high but not total; some corner cases around resolution and visibility changed, so run the build, fix new diagnostics, and update compiler plugins such as Compose, serialization and KSP to matching versions. The Compose compiler is now shipped as a Kotlin Gradle plugin tied to the Kotlin version.

Pitfalls:
- Upgrading Kotlin without upgrading KSP or kapt-based processors.
- Treating experimental language features as stable.

Interview tip: summarise K2 as the new compiler front end, not a new language: same Kotlin, better inference and speed.
