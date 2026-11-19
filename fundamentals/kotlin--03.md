## 9. Flow and Concurrency Patterns

### Cold flows with Flow
<!-- level: intermediate; ref: https://kotlinlang.org/docs/flow.html -->
A `Flow<T>` is an asynchronous stream of values built on coroutines. It is cold: the code in the `flow { }` builder does not run until a terminal operator such as `collect`, `first` or `toList` is called, and each collector triggers a fresh execution. Values are produced with `emit`, which is a suspend function, so a slow collector naturally applies back-pressure to the producer.

Use Flow when a suspend function returning one value is not enough: progress updates, database change streams, paged results, or periodic polling.

```kotlin
fun ticker(periodMs: Long): Flow<Int> = flow {
    var n = 0
    while (true) {
        emit(n++)
        delay(periodMs)
    }
}

suspend fun main() {
    ticker(100).take(3).collect { println(it) } // 0 1 2
}
```

Flow cancels cooperatively: cancelling the collecting coroutine stops the producer at the next suspension point.

Pitfalls:
- Calling `emit` from a different coroutine context inside `flow { }` throws; use `flowOn` or `channelFlow` instead.
- Assuming a cold flow caches results; every collector repeats the work.

Interview tip: contrast cold Flow with hot `StateFlow` and `SharedFlow`.

### Flow operators and flowOn
<!-- level: intermediate; ref: https://kotlinlang.org/docs/flow.html#flow-context -->
Flow has operators similar to collections (`map`, `filter`, `take`) plus stream-specific ones. `transform` emits any number of values per input. `flatMapLatest` cancels the previous inner flow when a new value arrives, ideal for search-as-you-type. `debounce` waits for a quiet period. `combine` merges the latest values of several flows; `zip` pairs them one to one. `buffer` and `conflate` decouple producer and collector speed.

Upstream context is controlled with `flowOn`, which changes the dispatcher for everything above it; the collector keeps its own context.

```kotlin
val results: Flow<List<Item>> = queryFlow
    .debounce(300)
    .distinctUntilChanged()
    .flatMapLatest { q -> repo.search(q) }   // search runs on IO
    .flowOn(Dispatchers.IO)
    .catch { emit(emptyList()) }
```

`catch` handles exceptions from upstream only; failures in `collect` are not caught by it.

Pitfalls:
- Placing `flowOn` below an operator and expecting that operator to switch threads.
- Using `withContext` inside `flow { }` to emit.

Interview tip: explain `flatMapLatest` versus `flatMapConcat` and `flatMapMerge`.

### StateFlow and SharedFlow
<!-- level: intermediate; ref: https://kotlinlang.org/docs/flow.html#stateflow-and-sharedflow -->
`StateFlow` is a hot flow that always holds a current value. It has an initial value, replays the latest value to new collectors, and conflates equal consecutive values via equality, so it models state such as a UI model. `SharedFlow` is a hot, configurable broadcast with optional replay and buffer, suited to events; `MutableSharedFlow` lets producers `emit` or `tryEmit`.

Expose read-only types from a class and keep the mutable one private.

```kotlin
class CounterModel {
    private val _count = MutableStateFlow(0)
    val count: StateFlow<Int> = _count.asStateFlow()

    fun inc() = _count.update { it + 1 }  // atomic read-modify-write
}

val events = MutableSharedFlow<String>(extraBufferCapacity = 16)
```

Convert a cold flow with `stateIn(scope, SharingStarted.WhileSubscribed(5_000), initial)` so upstream work stops when nobody collects.

Pitfalls:
- `_count.value = _count.value + 1` is not atomic; use `update`.
- Using StateFlow for one-off events: a repeated identical value is dropped and late collectors see stale ones.

Interview tip: say when to use each, state versus events.

### Channels
<!-- level: advanced; ref: https://kotlinlang.org/docs/channels.html -->
A `Channel` is a coroutine-safe queue: producers `send`, consumers `receive`, and both suspend when the buffer is full or empty. Capacity options are rendezvous (0, default), buffered, `UNLIMITED` and `CONFLATED`. Unlike a Flow, each element is delivered to exactly one receiver, so channels fit work distribution and fan-out between coroutines. Closing a channel signals completion; iterating with `for` ends when it is closed and drained.

```kotlin
val jobs = Channel<Int>(capacity = 10)
coroutineScope {
    repeat(3) { id ->
        launch { for (j in jobs) println("worker $id handles $j") }
    }
    for (i in 1..9) jobs.send(i)
    jobs.close()
}
```

`channelFlow` and `produce` build on channels, with `produce` tied to a coroutine scope.

Pitfalls:
- Forgetting to close the channel, leaving consumers suspended forever.
- Unlimited buffers hiding a slow consumer until memory runs out.
- Reaching for channels when a Flow expresses the stream more simply.

Interview tip: contrast channel (hot, one consumer per element) with SharedFlow (hot, broadcast).

### Bridging callbacks with callbackFlow
<!-- level: advanced; ref: https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/callback-flow.html -->
Many APIs deliver results through listeners. `callbackFlow` converts them into a Flow: register the listener inside the block, send values with `trySend`, and finish with `awaitClose`, where you unregister the listener. `awaitClose` is mandatory; without it the builder throws, and without cleanup you leak the listener.

```kotlin
fun SensorManager.readings(sensor: Sensor): Flow<Float> = callbackFlow {
    val listener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) { trySend(e.values[0]) }
        override fun onAccuracyChanged(s: Sensor?, a: Int) = Unit
    }
    registerListener(listener, sensor, SensorManager.SENSOR_DELAY_UI)
    awaitClose { unregisterListener(listener) }
}
```

For one-shot callbacks use `suspendCancellableCoroutine` and resume once, registering `invokeOnCancellation` to cancel the underlying request.

Pitfalls:
- Calling `trySend` ignoring its result when the buffer is full; choose a buffer policy such as `conflate()`.
- Resuming a continuation twice.

Interview tip: explain that the cleanup block runs on cancellation or close, which makes lifecycle-safe listeners possible.

### Testing coroutines with runTest
<!-- level: intermediate; ref: https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-test/ -->
`runTest` from `kotlinx-coroutines-test` runs a suspend test body on a virtual-time scheduler. Calls to `delay` complete instantly in virtual time, so tests of timeouts and debouncing run in milliseconds and deterministically. `advanceTimeBy`, `advanceUntilIdle` and `runCurrent` control the scheduler explicitly.

Inject dispatchers into your classes rather than hard-coding `Dispatchers.IO`, so tests can pass a `StandardTestDispatcher`. For code using `Dispatchers.Main`, call `Dispatchers.setMain(testDispatcher)` in setup and `resetMain()` afterwards.

```kotlin
@Test
fun debounces() = runTest {
    val vm = SearchModel(StandardTestDispatcher(testScheduler))
    vm.onQuery("k"); vm.onQuery("ko")
    advanceTimeBy(299)
    assertEquals(0, vm.searchCount)
    advanceTimeBy(2)
    assertEquals(1, vm.searchCount)
}
```

Flows can be tested by collecting into a list in `backgroundScope`, or with a library such as Turbine.

Pitfalls:
- Using `runBlocking` and real delays in tests: slow and flaky.
- Launching on a scope with a different scheduler, so virtual time does not apply.

Interview tip: mention `StandardTestDispatcher` (queued, needs advancing) versus `UnconfinedTestDispatcher` (eager).

## 10. Java Interop and the Standard Library

### Platform types and nullability at the Java boundary
<!-- level: intermediate; ref: https://kotlinlang.org/docs/java-interop.html#null-safety-and-platform-types -->
Types coming from Java code without nullability information are platform types, written `T!` in tooling. The compiler lets you treat them as nullable or non-null; if you assume non-null and Java returns `null`, you get a `NullPointerException` at the use site (or an intrinsic check error when passed to a Kotlin parameter). Kotlin recognises annotations such as `@Nullable` and `@NotNull` (JetBrains, JSR-305, Android, Jakarta and others), turning them into real nullable and non-null types.

```kotlin
val name = javaObject.getName()      // String!
val len = name.length                // NPE if null
val safe: String? = javaObject.getName()
val n = safe?.length ?: 0
```

Best practice is to declare the type explicitly at the boundary so the decision is visible.

Pitfalls:
- Chaining calls on platform types through several lines, hiding where `null` entered.
- Java collections of unknown nullability, such as `List<String!>!`.

Interview tip: say that explicit types on Java results convert a late runtime crash into an early, local one.

### JVM interop annotations
<!-- level: intermediate; ref: https://kotlinlang.org/docs/java-to-kotlin-interop.html -->
Kotlin code compiled for the JVM looks different from Java by default, so annotations tune the generated bytecode. `@JvmStatic` on companion or object members generates a real static method. `@JvmField` exposes a property as a public field without getter and setter. `@JvmOverloads` generates overloads for default parameters, since Java cannot use Kotlin defaults. `@JvmName` renames a method or file class, avoiding clashes and the `FileKt` default. `@Throws` declares checked exceptions so Java callers can catch them.

```kotlin
@file:JvmName("Strings")
package util

@JvmOverloads
fun pad(s: String, width: Int = 10, ch: Char = ' '): String = s.padEnd(width, ch)

class Config {
    companion object {
        @JvmStatic fun default() = Config()
        @JvmField val VERSION = "1"
    }
}
```

From Java: `Strings.pad("a")` and `Config.default()`.

Pitfalls:
- Kotlin has no checked exceptions; Java cannot catch a checked exception that is not declared with `@Throws`.
- Top-level `suspend` functions are awkward from Java; offer a blocking or `CompletableFuture` wrapper.

Interview tip: know that without `@JvmStatic` Java calls `Config.Companion.default()`.

### Sequences versus collections
<!-- level: intermediate; ref: https://kotlinlang.org/docs/sequences.html -->
Collection operations such as `map` and `filter` are eager: each creates a full intermediate list. A `Sequence` is lazy: operations are chained and elements flow through the whole pipeline one at a time, only when a terminal operation like `toList`, `first` or `sum` runs. This avoids intermediate collections and allows early termination and infinite sources.

```kotlin
val firstBig = generateSequence(1) { it + 1 }
    .map { it * it }
    .filter { it % 3 == 0 }
    .first { it > 1000 }       // stops as soon as found

val total = bigList.asSequence()
    .filter { it.active }
    .map { it.price }
    .sum()
```

Sequences pay off with large inputs, multi-step pipelines, or short-circuiting terminals. For small collections or a single operation, eager lists are simpler and often faster, since sequences add per-element overhead.

Pitfalls:
- Operations like `sorted` need all elements and break laziness.
- Reusing a one-shot sequence (such as from `Sequence` built on an iterator) can throw.
- Expecting side effects inside `map` to run without a terminal operation.

Interview tip: describe the order of execution: element by element through all stages, not stage by stage.

### Value classes
<!-- level: advanced; ref: https://kotlinlang.org/docs/inline-classes.html -->
A value class wraps a single value to give it a distinct type without a heap allocation in most uses (stable since Kotlin 1.5, declared with `@JvmInline value class`). It prevents mix-ups such as passing a `UserId` where an `OrderId` is expected, with near-zero cost because the compiler usually inlines the underlying value.

```kotlin
@JvmInline
value class UserId(val raw: Long)

@JvmInline
value class Email(val value: String) {
    init { require("@" in value) { "invalid email" } }
}

fun load(id: UserId) { /* ... */ }
```

A value class has exactly one property in the primary constructor, may have methods and `init` blocks, and can implement interfaces, but cannot have backing fields beyond that property or extend classes. It is boxed when used as a nullable of a non-reference type, as a generic argument, or via an interface type.

Pitfalls:
- Assuming it is never boxed; generic collections box values.
- Function names get mangled in bytecode, so Java interop needs `@JvmName` care.

Interview tip: contrast with `typealias`, which gives a new name but no new type safety.

### kotlinx.serialization
<!-- level: intermediate; ref: https://github.com/Kotlin/kotlinx.serialization/blob/master/docs/serialization-guide.md -->
`kotlinx.serialization` is Kotlin's multiplatform serialisation library. A compiler plugin generates serialisers for classes annotated with `@Serializable`, avoiding runtime reflection, so it works on JVM, Native and JS. Formats are separate libraries: JSON, ProtoBuf, CBOR and others.

```kotlin
@Serializable
data class User(
    val id: Long,
    @SerialName("full_name") val name: String,
    val email: String? = null,
)

val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }
val text = json.encodeToString(User(1, "Asha"))
val user = json.decodeFromString<User>("""{"id":2,"full_name":"Ravi","extra":1}""")
```

Polymorphism uses sealed classes with a class discriminator; custom behaviour comes from `KSerializer` implementations.

Pitfalls:
- Missing required properties or unknown keys throw unless defaults and `ignoreUnknownKeys` are set.
- Forgetting the Gradle plugin, which makes `@Serializable` appear to do nothing.
- Serialising classes with non-serialisable property types.

Interview tip: compare with Gson and Moshi: no reflection, compile-time checked, null-safety aware, and multiplatform.
