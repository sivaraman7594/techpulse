## 5. Functional Kotlin

### Lambdas and function types
<!-- level: basic; ref: https://kotlinlang.org/docs/lambdas.html -->
Functions are first-class values in Kotlin. Function types are written `(Int, Int) -> Int`, `() -> Unit`, or with a receiver `String.() -> Int`, and nullable as `((Int) -> Unit)?`. A lambda literal is written in braces: `{ a: Int, b: Int -> a + b }`. If a lambda has one parameter, it can use the implicit name `it`. The last expression is the return value.

Trailing lambda syntax: when the last parameter of a function is a function type, the lambda can go outside the parentheses, and the parentheses can be dropped if it is the only argument. This is what makes `list.filter { it > 0 }` and DSLs read naturally. Function references (`::isValid`, `String::length`, `user::greet`) pass existing functions.

Unlike Java, lambdas can modify captured `var`s; the compiler wraps them in a `Ref` object. A bare `return` inside a lambda is only allowed when the lambda is inlined; otherwise use a labelled return such as `return@forEach`.

On the JVM, lambdas compile to `invokedynamic` (Kotlin 2.0 default) like Java lambdas.

```kotlin
val add: (Int, Int) -> Int = { a, b -> a + b }
val isEven: (Int) -> Boolean = { it % 2 == 0 }

fun retry(times: Int, block: () -> Unit) {
    repeat(times) { attempt ->
        try { block(); return } catch (e: IOException) { println("attempt $attempt failed") }
    }
}

retry(3) { uploadReport() }                     // trailing lambda

var count = 0
listOf(1, 2, 3, 4).forEach { if (isEven(it)) count++ }   // captured var can be modified

val lengths = listOf("a", "bbb").map(String::length)
listOf(1, 2, 3).forEach { if (it == 2) return@forEach; println(it) }
```

- Pitfall: `{ }` where a function is expected versus `fun f() = { }` returning a lambda confuses newcomers.

### Higher-order and inline functions
<!-- level: intermediate; ref: https://kotlinlang.org/docs/inline-functions.html -->
A higher-order function takes functions as parameters or returns one. Normally each lambda passed becomes an object and each call goes through an interface, which costs allocations for capturing lambdas and prevents some optimisations.

Marking a higher-order function `inline` tells the compiler to copy the function body and the lambda bodies into every call site. Benefits: no lambda objects, no virtual calls, and non-local `return` from inside the lambda (returning from the enclosing function), plus `break`/`continue` since Kotlin 2.2. Most standard collection functions (`map`, `filter`, `forEach`, `let`, `use`) are inline.

Modifiers refine this: `noinline` keeps a particular lambda parameter as an object (so you can store it), and `crossinline` forbids non-local returns in a lambda that will be called from another context.

`reified` type parameters work only in inline functions: because the body is copied, the actual type argument is known at each call site, so you can use `T::class` or `is T`, which type erasure normally prevents.

```kotlin
inline fun <T> measure(label: String, block: () -> T): T {
    val start = System.nanoTime()
    try { return block() } finally {
        println("$label took ${(System.nanoTime() - start) / 1_000_000} ms")
    }
}

val users = measure("load users") { repo.findAll() }

inline fun <reified T> Any.castOrNull(): T? = this as? T
inline fun <reified T : Any> Gson.parse(json: String): T = fromJson(json, T::class.java)

fun findFirstAdmin(users: List<User>): User? {
    users.forEach { if (it.isAdmin) return it }    // non-local return: exits findFirstAdmin
    return null
}
```

- Pitfall: inlining large functions bloats bytecode; inline only small functions that take lambdas.
- Pitfall: public inline functions cannot access private members, because their bodies are copied into callers.

### Extension functions and properties
<!-- level: intermediate; ref: https://kotlinlang.org/docs/extensions.html -->
Extension functions let you add functions to an existing type without inheriting from it or modifying its source: `fun String.isEmail(): Boolean`. Inside, `this` refers to the receiver. Extension properties work the same way but cannot have backing fields, so they are computed.

Under the hood an extension is a static method that takes the receiver as its first parameter; `"a@b".isEmail()` compiles to `StringExtKt.isEmail("a@b")`. Consequences:
- Extensions are resolved statically, by the declared type of the expression, not the runtime type. They are not polymorphic.
- A member function always wins over an extension with the same signature.
- Extensions cannot access private or protected members of the receiver.
- They must be imported where used, if declared in another package.

Extensions on nullable receivers (`fun String?.orDash()`) can be called on null values. Much of the standard library (`let`, `apply`, collection operators) is built from extensions.

```kotlin
fun String.isEmail(): Boolean = matches(Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"))

val Int.paiseToRupees: String
    get() = "%d.%02d".format(this / 100, this % 100)

fun String?.orDash(): String = if (this.isNullOrBlank()) "-" else this

fun <T> List<T>.secondOrNull(): T? = if (size >= 2) this[1] else null

println("ada@example.com".isEmail())   // true
println(12345.paiseToRupees)           // 123.45
val missing: String? = null
println(missing.orDash())              // -
```

- Pitfall: an extension on a superclass is not overridden by an extension on a subclass when the static type is the superclass.
- Pitfall: scattering hundreds of extensions on `String` or `Any` pollutes autocomplete; scope them to files or modules that need them.

### Scope functions: let, run, with, apply, also
<!-- level: intermediate; ref: https://kotlinlang.org/docs/scope-functions.html -->
The five scope functions run a block in the context of an object. They differ in two ways: how the object is referenced (`it` as a lambda argument, or `this` as the receiver) and what they return (the lambda result or the object itself).

- `let`: `it`, returns the lambda result. Use for null checks (`x?.let { }`) and transforming a value.
- `run`: `this`, returns the result. Use to compute a value from an object's members.
- `with(obj) { }`: `this`, returns the result; not an extension. Use to group calls on an object.
- `apply`: `this`, returns the object. Use for configuring an object after creation.
- `also`: `it`, returns the object. Use for side effects such as logging or validation in a chain.

`takeIf` and `takeUnless` complement them by returning the object or null based on a predicate. All are inline, so they cost nothing at runtime.

```kotlin
val client = OkHttpClient.Builder().apply {
    connectTimeout(Duration.ofSeconds(3))
    readTimeout(Duration.ofSeconds(10))
}.build()

val user = repo.save(newUser).also { log.info("created user ${it.id}") }

val length = name?.let { it.trim().length } ?: 0

val summary = with(order) { "Order $id: ${items.size} items, total $total" }

val port = System.getenv("PORT")?.toIntOrNull()?.takeIf { it in 1..65535 } ?: 8080
```

- Pitfall: nesting scope functions makes `it` and `this` ambiguous; name the lambda parameter or use a plain local variable.
- Interview tip: be ready to pick the right one for "configure an object" (`apply`) versus "log and pass through" (`also`).

### Collections and transformations
<!-- level: basic; ref: https://kotlinlang.org/docs/collections-overview.html -->
Kotlin separates read-only collection interfaces (`List`, `Set`, `Map`) from mutable ones (`MutableList`, `MutableSet`, `MutableMap`). Create them with `listOf`, `setOf`, `mapOf("k" to v)` and the `mutable...Of` variants, or builders such as `buildList { }`. On the JVM these map to Java collections, so read-only is a compile-time view, not a guarantee of deep immutability: a `List` might be backed by an `ArrayList` someone else mutates.

The standard library has a rich, eager transformation API: `map`, `filter`, `flatMap`, `associateBy`, `groupBy`, `partition`, `zip`, `chunked`, `windowed`, `fold`, `reduce`, `sumOf`, `maxByOrNull`, `distinctBy`, `sortedWith(compareBy(...))`, `any`, `all`, `none`, `count`, and `first`/`firstOrNull`. Each operation returns a new collection.

```kotlin
data class Order(val id: Int, val customer: String, val amount: Long, val status: String)

val paid = orders.filter { it.status == "PAID" }
val revenueByCustomer: Map<String, Long> = paid
    .groupBy { it.customer }
    .mapValues { (_, list) -> list.sumOf { it.amount } }

val (big, small) = orders.partition { it.amount > 10_000 }
val byId = orders.associateBy { it.id }
val top3 = orders.sortedWith(compareByDescending<Order> { it.amount }.thenBy { it.id }).take(3)

val counts = mutableMapOf<String, Int>()
words.forEach { counts[it] = counts.getOrDefault(it, 0) + 1 }
val sameCounts = words.groupingBy { it }.eachCount()
```

- Pitfall: casting a `List` to `MutableList` to modify it can mutate shared data or throw on truly immutable lists.
- Pitfall: chains of eager operations on huge lists create intermediate copies; consider sequences.

### Sequences
<!-- level: intermediate; ref: https://kotlinlang.org/docs/sequences.html -->
A `Sequence<T>` is a lazily evaluated collection pipeline, similar to Java streams. Collection operations are eager: `list.filter { }.map { }.first()` filters the whole list, then maps the whole result, creating intermediate lists, then takes one element. With `asSequence()`, elements flow one at a time through the chain and evaluation stops as soon as the terminal operation (`first`, `toList`, `sum`) is satisfied.

Use sequences when the collection is large and the chain has several steps, when you short-circuit early, or for infinite or generated data (`generateSequence`, the `sequence { yield() }` builder). For small collections, eager operations are often faster because they avoid per-element overhead.

Sequences are single-threaded and can usually be iterated multiple times, though some (from an iterator) cannot.

```kotlin
val firstBigPaid = orders.asSequence()
    .filter { it.status == "PAID" }
    .map { it.amount }
    .first { it > 10_000 }                 // stops at the first match

val fibonacci = sequence {
    var a = 0L; var b = 1L
    while (true) { yield(a); val t = a + b; a = b; b = t }
}
println(fibonacci.take(10).toList())       // [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]

val pages = generateSequence(1) { it + 1 }
    .map { api.fetchPage(it) }
    .takeWhile { it.items.isNotEmpty() }
    .flatMap { it.items }

File("big.log").useLines { lines -> lines.count { "ERROR" in it } }   // lazy file reading
```

- Pitfall: forgetting the terminal operation means nothing executes.
- Pitfall: `sorted()` on a sequence must buffer everything, removing the laziness benefit.

## 6. Generics

### Generic classes and functions
<!-- level: intermediate; ref: https://kotlinlang.org/docs/generics.html -->
Kotlin generics work like Java's: classes and functions take type parameters (`class Box<T>(val value: T)`, `fun <T> List<T>.second(): T`), and type arguments are usually inferred. Like Java, generics are erased on the JVM, so `List<String>` and `List<Int>` are the same class at runtime, except in inline functions with `reified` type parameters.

Upper bounds restrict type parameters: `<T : Comparable<T>>`. Multiple bounds use a `where` clause. The default upper bound is `Any?`, so a plain `T` may be nullable; use `T : Any` to forbid nulls. Kotlin 1.7 added definitely non-nullable types written `T & Any`, mainly useful when overriding Java generic methods.

Kotlin has no raw types; every generic type must have arguments, and star projection `List<*>` covers "some unknown type".

```kotlin
class Cache<K : Any, V : Any>(private val loader: (K) -> V) {
    private val map = HashMap<K, V>()
    fun get(key: K): V = map.getOrPut(key) { loader(key) }
}

fun <T : Comparable<T>> maxOf(items: List<T>): T? = items.maxOrNull()

fun <T> copyWhen(src: List<T>, dest: MutableList<T>, predicate: (T) -> Boolean)
        where T : CharSequence, T : Comparable<T> {
    src.filterTo(dest, predicate)
}

val userCache = Cache<Long, User> { id -> repo.load(id) }
fun describe(list: List<*>) = "list with ${list.size} elements"
```

- Pitfall: `fun <T> f(x: T)` accepts null because `T` defaults to `Any?`; add a `T : Any` bound when null is not allowed.

### Variance: in, out and star projection
<!-- level: advanced; ref: https://kotlinlang.org/docs/generics.html#variance -->
Variance describes how subtyping of type arguments relates to subtyping of generic types. Kotlin supports declaration-site variance, so the class author declares it once instead of every caller writing wildcards as in Java.

- `out T` (covariant): the class only produces T (returns it), never consumes it. Then `Producer<String>` is a subtype of `Producer<Any>`. Kotlin's read-only `List<out E>` is covariant, so a `List<Int>` can be passed where `List<Number>` is expected, which Java forbids.
- `in T` (contravariant): the class only consumes T. Then `Comparator<Any>` can be used where `Comparator<String>` is expected.
- No modifier: invariant. `MutableList<T>` must be invariant because it both reads and writes.

Use-site variance (type projections) is still available for invariant types: `fun copy(from: Array<out Any>, to: Array<in Any>)`. Star projection `Foo<*>` means "some specific but unknown type": you can read values as `Any?` but cannot write.

```kotlin
interface Source<out T> { fun next(): T }
interface Sink<in T> { fun put(item: T) }

fun drain(source: Source<Number>) { println(source.next()) }
val ints: Source<Int> = object : Source<Int> { override fun next() = 42 }
drain(ints)                                   // OK thanks to out

val anySink: Sink<Any> = object : Sink<Any> { override fun put(item: Any) = println(item) }
val stringSink: Sink<String> = anySink        // OK thanks to in

fun sumAll(numbers: List<Number>) = numbers.sumOf { it.toDouble() }
sumAll(listOf(1, 2, 3))                        // List<Int> accepted: List is covariant
```

- Interview tip: relate `out`/`in` to Java's `? extends` / `? super` and the PECS rule.
- `@UnsafeVariance` overrides the check, as `List.contains(element: @UnsafeVariance E)` does; use rarely.

### Reified types and type erasure workarounds
<!-- level: advanced; ref: https://kotlinlang.org/docs/inline-functions.html#reified-type-parameters -->
On the JVM, generic type arguments are erased, so a normal generic function cannot ask "is this value a `T`?" or get `T::class`. Java code works around this by passing `Class<T>` tokens explicitly.

Kotlin's `inline` functions with `reified` type parameters solve this ergonomically. Because the function body is inlined at each call site, the compiler substitutes the concrete type argument there, so `T::class`, `is T`, `as T` and `typeOf<T>()` work. Libraries use this to give clean APIs: `inject<Repo>()` in Koin, `retrofit.create<Api>()`, `Json.decodeFromString<User>(text)`, `jacksonObjectMapper().readValue<List<User>>(json)`.

`typeOf<T>()` returns a full `KType` including nested generic arguments, so even `List<User>` survives, unlike `T::class`, which gives only `List`.

Limitations: reified functions must be inline, so they cannot be called from Java and cannot be virtual; a type parameter of a class cannot be reified.

```kotlin
inline fun <reified T> List<Any>.filterIsType(): List<T> = filter { it is T }.map { it as T }

inline fun <reified T : Any> loadConfig(path: String): T =
    Json.decodeFromString(serializer<T>(), File(path).readText())

inline fun <reified T : Activity> Context.startActivity() =
    startActivity(Intent(this, T::class.java))

val mixed: List<Any> = listOf(1, "two", 3.0, "four")
val strings = mixed.filterIsType<String>()      // [two, four]
val settings = loadConfig<AppSettings>("settings.json")
```

- The standard library already provides `filterIsInstance<T>()`.
- Pitfall: reified types still cannot distinguish `List<String>` from `List<Int>` at runtime with `is`; elements are not checked.

## 7. Delegation and DSLs

### Class delegation with by
<!-- level: intermediate; ref: https://kotlinlang.org/docs/delegation.html -->
Kotlin supports the delegation pattern natively. Writing `class LoggingList<T>(private val inner: MutableList<T>) : MutableList<T> by inner` makes the compiler generate every `MutableList` method, forwarding it to `inner`. You then override only the methods whose behaviour you want to change.

This makes "composition over inheritance" as cheap to write as inheritance. You avoid the fragile base class problem: the wrapper does not depend on how the delegate implements `addAll` in terms of `add`, because each call is forwarded independently. The decorated type can even be final.

Delegation works only through interfaces. Note one subtlety: inside the delegate, calls to its own methods do not go through your overrides, because the delegate does not know about the wrapper.

```kotlin
class CountingSet<T>(
    private val inner: MutableSet<T> = HashSet(),
) : MutableSet<T> by inner {
    var addAttempts = 0
        private set

    override fun add(element: T): Boolean {
        addAttempts++
        return inner.add(element)
    }

    override fun addAll(elements: Collection<T>): Boolean {
        addAttempts += elements.size
        return inner.addAll(elements)
    }
}

interface Repository { fun find(id: Long): User? }
class CachedRepository(private val db: Repository) : Repository by db {
    private val cache = mutableMapOf<Long, User?>()
    override fun find(id: Long) = cache.getOrPut(id) { db.find(id) }
}
```

- Interview tip: compare with Java's `HashSet` subclass double-counting example; Kotlin delegation avoids it.
- Pitfall: generated forwarding methods use the delegate captured at construction time; reassigning a `var` delegate later does not change forwarding.

### Delegated properties
<!-- level: intermediate; ref: https://kotlinlang.org/docs/delegated-properties.html -->
A delegated property hands its getter (and setter) to another object: `val x by delegate`. Any object with `getValue` (and `setValue` for `var`) operator functions can serve as a delegate. The compiler generates a hidden field holding the delegate and forwards accesses, passing the owner and a `KProperty` describing the property.

Standard delegates:
- `lazy { }`: computed on first access, cached.
- `Delegates.observable(initial) { prop, old, new -> }`: callback after each change.
- `Delegates.vetoable(initial) { prop, old, new -> Boolean }`: can reject a change.
- Map delegation: `val name: String by map` reads from a map by property name; handy for parsed JSON or configuration.
- Delegating to another property: `var oldName by this::newName` for renames.

Android uses the pattern heavily (`by viewModels()`, Compose's `by remember { mutableStateOf(...) }`).

```kotlin
class Settings(private val props: Map<String, Any?>) {
    val theme: String by props
    val fontSize: Int by props
}

class Form {
    var email: String by Delegates.observable("") { _, old, new ->
        println("email changed from '$old' to '$new'")
    }
    var age: Int by Delegates.vetoable(0) { _, _, new -> new in 0..150 }
}

class Trimmed {
    private var value = ""
    operator fun getValue(thisRef: Any?, property: KProperty<*>) = value
    operator fun setValue(thisRef: Any?, property: KProperty<*>, newValue: String) { value = newValue.trim() }
}
class Profile { var displayName by Trimmed() }
```

- Pitfall: a map-delegated property throws `NoSuchElementException` if the key is missing.

### Lambdas with receivers and type-safe builders
<!-- level: advanced; ref: https://kotlinlang.org/docs/type-safe-builders.html -->
A function type with a receiver, `T.() -> Unit`, describes a lambda that runs as if it were an extension of `T`: inside it, `this` is a `T`, so you can call T's members without qualification. `apply` is defined this way, and it is the foundation of Kotlin DSLs: Gradle Kotlin DSL, Ktor routing, kotlinx.html, Jetpack Compose's scopes and `buildString`.

A type-safe builder combines functions taking lambdas with receivers to build hierarchical structures that read declaratively yet are fully type-checked and autocompleted.

In nested builders, inner lambdas can still see outer receivers implicitly, so you might accidentally call an outer function. Annotating the DSL marker classes with an annotation that is itself marked `@DslMarker` restricts implicit receivers to the nearest one.

```kotlin
@DslMarker annotation class HtmlDsl

@HtmlDsl class Ul { val items = mutableListOf<String>(); fun li(text: String) { items += text } }
@HtmlDsl class Body {
    val parts = mutableListOf<String>()
    fun h1(text: String) { parts += "<h1>$text</h1>" }
    fun ul(block: Ul.() -> Unit) {
        val ul = Ul().apply(block)
        parts += ul.items.joinToString("", "<ul>", "</ul>") { "<li>$it</li>" }
    }
}

fun html(block: Body.() -> Unit): String = Body().apply(block).parts.joinToString("\n")

val page = html {
    h1("Releases")
    ul {
        li("2.2: guard conditions")
        li("2.0: K2 compiler")
        // h1("oops")   // compile error thanks to @DslMarker
    }
}
```

- Good DSLs hide construction details; do not build a DSL where a plain data class and constructor would do.

### Context parameters (Kotlin 2.2 preview)
<!-- level: advanced; ref: https://kotlinlang.org/docs/context-parameters.html -->
Context parameters let a function declare dependencies that are supplied implicitly from the caller's context, rather than passed as explicit arguments at every call. A function declared with `context(logger: Logger)` can be called only where a `Logger` is available in context, for example inside a `with(logger) { }` block or another function with the same context. Inside, the parameter is used by name.

They solve the "pass the same thing through ten layers" problem for cross-cutting values such as a transaction, a logger, a tenant, or a coroutine-like scope, without global state or dependency-injection frameworks. They also allow extension-like APIs that need two receivers.

Version note: context parameters are a preview feature in Kotlin 2.2 and require the `-Xcontext-parameters` compiler flag. They replace the older experimental context receivers (`-Xcontext-receivers`), which are deprecated. Syntax and rules may still change before stabilisation.

```kotlin
interface Logger { fun info(msg: String) }
interface Transaction { fun execute(sql: String) }

context(logger: Logger, tx: Transaction)
fun transfer(from: String, to: String, amount: Long) {
    logger.info("transfer $amount from $from to $to")
    tx.execute("UPDATE acc SET bal = bal - $amount WHERE id = '$from'")
    tx.execute("UPDATE acc SET bal = bal + $amount WHERE id = '$to'")
}

fun main() {
    val logger = object : Logger { override fun info(msg: String) = println(msg) }
    val tx = object : Transaction { override fun execute(sql: String) = println(sql) }
    with(logger) {                             // receivers in scope satisfy the context
        with(tx) { transfer("A", "B", 100) }
    }
}
```

- The SQL here is illustrative; real code must use parameterised queries.
- Pitfall: overusing implicit context makes data flow hard to follow; reserve it for genuinely ambient values.

## 8. Coroutines

### Coroutines and suspend functions
<!-- level: intermediate; ref: https://kotlinlang.org/docs/coroutines-basics.html -->
A coroutine is a suspendable computation: it can pause at specific points without blocking a thread and resume later, possibly on another thread. Thousands or millions of coroutines can share a small thread pool, which makes concurrent I/O cheap while the code stays sequential and readable, with no callbacks.

A `suspend` function is one that may suspend. It can only be called from another suspend function or a coroutine. Under the hood the compiler applies a continuation-passing-style transformation: every suspend function gets a hidden `Continuation` parameter, and its body becomes a state machine whose states are the code between suspension points. Local variables that live across suspension points are saved in that state object on the heap. When the awaited operation completes, the continuation's `resumeWith` is called and execution continues from the saved state.

The language provides only `suspend` and low-level primitives; the `kotlinx.coroutines` library provides builders, dispatchers, `Flow`, channels and testing tools.

```kotlin
suspend fun fetchUser(id: Long): User = withContext(Dispatchers.IO) {
    httpClient.get("https://api.example.com/users/$id").body()
}

suspend fun loadDashboard(id: Long): Dashboard {
    val user = fetchUser(id)                  // suspends, does not block the thread
    val orders = orderApi.recent(user.id)     // runs after user is loaded
    return Dashboard(user, orders)
}

fun main() = runBlocking {                    // bridge from blocking main into coroutines
    println(loadDashboard(7))
}
```

- Interview tip: "suspend" does not mean "runs in the background"; a suspend function runs on whatever dispatcher calls it unless it switches context.
- Pitfall: calling blocking APIs (JDBC, `Thread.sleep`) inside a suspend function blocks the underlying thread; wrap them in `withContext(Dispatchers.IO)`.

### Coroutine builders: launch, async and runBlocking
<!-- level: intermediate; ref: https://kotlinlang.org/docs/composing-suspending-functions.html -->
Coroutines are started by builders, which are extension functions on `CoroutineScope`:
- `launch` starts a fire-and-forget coroutine and returns a `Job` you can `join` or `cancel`. Uncaught exceptions propagate to the parent.
- `async` starts a coroutine that computes a value and returns a `Deferred<T>`; call `await()` to get the result or the exception. Use it for concurrent decomposition: start several `async` calls, then await them all.
- `runBlocking` blocks the current thread until its coroutines finish. It exists to bridge blocking code (a `main` function or a legacy test) into coroutines; never use it inside coroutines or on Android's main thread.
- `coroutineScope { }` is a suspend function that creates a child scope and waits for all children; use it inside suspend functions to run things in parallel.

By default `async` starts immediately; `CoroutineStart.LAZY` delays it until `await` or `start`.

```kotlin
suspend fun loadProductPage(id: String): ProductPage = coroutineScope {
    val product = async { catalog.product(id) }        // starts now
    val reviews = async { reviewsApi.top(id) }         // runs concurrently
    val stock = async { inventory.stock(id) }
    ProductPage(product.await(), reviews.await(), stock.await())
}

fun CoroutineScope.startHeartbeat(): Job = launch {
    while (isActive) {
        sendHeartbeat()
        delay(5_000)
    }
}
```

- Pitfall: `async { }.await()` immediately after creating it is just sequential code with extra overhead.
- Pitfall: `GlobalScope.launch` creates coroutines tied to nothing; they leak and their failures are lost.

### Structured concurrency and scopes
<!-- level: advanced; ref: https://kotlinlang.org/docs/coroutines-basics.html#structured-concurrency -->
Structured concurrency is the rule that every coroutine is started in a `CoroutineScope` and becomes a child of that scope's `Job`. This builds a tree with three guarantees:
- A parent does not complete until all its children complete, so no work leaks.
- Cancelling a parent cancels all its children.
- A failing child (with a regular `Job`) cancels its parent and therefore its siblings, and the exception propagates up, so errors are not lost.

Scopes are tied to lifecycles. On Android, `viewModelScope` is cancelled when the ViewModel is cleared and `lifecycleScope` when the lifecycle is destroyed. On the server, frameworks provide request-scoped coroutines, and `coroutineScope { }` creates a local scope inside a suspend function. For a component with its own lifecycle, create `CoroutineScope(SupervisorJob() + Dispatchers.Default)` and cancel it on shutdown.

```kotlin
class SyncService(private val api: Api, private val db: Db) : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun start() = scope.launch {
        while (isActive) {
            syncOnce()
            delay(60_000)
        }
    }

    private suspend fun syncOnce() = coroutineScope {      // waits for both children
        launch { db.saveUsers(api.users()) }
        launch { db.saveOrders(api.orders()) }
    }

    override fun close() = scope.cancel()                   // cancels everything started here
}
```

- Interview tip: compare with Java's structured concurrency (`StructuredTaskScope`); Kotlin has had the same idea since coroutines 1.0.
- Pitfall: creating a new `CoroutineScope(...)` inside a function and launching in it escapes structure; nobody will cancel it.

### Dispatchers and withContext
<!-- level: intermediate; ref: https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html -->
A coroutine's `CoroutineContext` is a set of elements: its `Job`, a `CoroutineDispatcher`, an optional `CoroutineName` and a `CoroutineExceptionHandler`. The dispatcher decides which thread or threads run the coroutine:
- `Dispatchers.Default`: a pool sized to the number of CPU cores (at least two), for CPU-intensive work such as parsing, sorting or image processing.
- `Dispatchers.IO`: for blocking I/O. It shares threads with Default but allows many more to block at once (64 by default, or more if there are more cores). `Dispatchers.IO.limitedParallelism(n)` creates a view with its own limit, for example per database.
- `Dispatchers.Main`: the UI thread on Android and desktop. `Main.immediate` avoids re-dispatching if already on the main thread.
- `Dispatchers.Unconfined`: runs in the caller's thread until the first suspension; rarely needed.

`withContext(dispatcher) { }` switches context for a block and returns its result, suspending the caller meanwhile. Well-written suspend functions are main-safe: they switch to the right dispatcher internally, so callers never need to know.

```kotlin
class ImageRepository(private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO) {
    suspend fun loadThumbnail(path: String): Bitmap {
        val bytes = withContext(ioDispatcher) { File(path).readBytes() }       // blocking I/O
        return withContext(Dispatchers.Default) { decodeAndScale(bytes) }      // CPU work
    }
}

private val dbDispatcher = Dispatchers.IO.limitedParallelism(10)   // match connection pool size
```

- Inject dispatchers rather than hard-coding them, so tests can substitute a `StandardTestDispatcher`.
- Pitfall: CPU-heavy loops on `Dispatchers.Main` freeze the UI; blocking calls on `Default` starve other CPU work.

### Cancellation and timeouts
<!-- level: advanced; ref: https://kotlinlang.org/docs/cancellation-and-timeouts.html -->
Coroutine cancellation is cooperative. Calling `job.cancel()` marks the job as cancelling; the coroutine actually stops only when it reaches a suspension point that checks for cancellation (all `kotlinx.coroutines` suspending functions such as `delay`, `yield`, `withContext`, `await` do) and throws `CancellationException`. That exception unwinds the coroutine normally, running `finally` blocks.

CPU-bound loops that never suspend will ignore cancellation unless they check `isActive`, call `ensureActive()` or call `yield()`. Blocking Java calls are not interrupted unless wrapped with `runInterruptible`.

Timeouts are built on cancellation: `withTimeout(ms) { }` throws `TimeoutCancellationException`; `withTimeoutOrNull` returns null instead.

In `finally` blocks of a cancelled coroutine, calling a suspend function immediately throws again; wrap cleanup that must suspend in `withContext(NonCancellable)`.

```kotlin
suspend fun processFiles(files: List<File>) = withContext(Dispatchers.Default) {
    for (file in files) {
        ensureActive()                         // cooperate with cancellation
        heavyParse(file)
    }
}

suspend fun fetchWithDeadline(): Quote? = withTimeoutOrNull(2_000) { pricingApi.quote() }

suspend fun upload(file: File) {
    val session = storage.openSession()
    try {
        session.write(file)
    } finally {
        withContext(NonCancellable) { session.close() }   // suspend cleanup still runs
    }
}
```

- Pitfall: `catch (e: Exception)` around suspend calls swallows `CancellationException`, so the coroutine keeps running after cancellation. Rethrow it, or catch narrower exception types.
- Pitfall: `withTimeout` throwing inside a `launch` silently cancels just that coroutine because `TimeoutCancellationException` is a `CancellationException`.

### Exception handling and SupervisorJob
<!-- level: advanced; ref: https://kotlinlang.org/docs/exception-handling.html -->
How a coroutine failure propagates depends on the builder and the job type.

With a regular `Job`, an uncaught exception in any child cancels the parent, which cancels all siblings, and the exception propagates up the hierarchy. This is right when the children are parts of one task: if loading reviews fails, the whole product page fails.

With a `SupervisorJob` (or the `supervisorScope { }` function), a child's failure does not affect the parent or its siblings. Use it when children are independent, such as separate UI sections or separate jobs in a background service. `viewModelScope` uses a SupervisorJob.

Where the exception surfaces:
- `launch`: it is uncaught; it goes to the parent, and at the root to a `CoroutineExceptionHandler` in the context, or the thread's default handler (which crashes Android apps).
- `async`: it is stored in the `Deferred` and rethrown by `await()`. But in a regular scope, the failure also cancels the parent immediately, even before `await`.

`CoroutineExceptionHandler` only works on root coroutines (or direct children of a supervisor); it is a last-resort logger, not a recovery mechanism.

```kotlin
val handler = CoroutineExceptionHandler { _, e -> log.error("unhandled", e) }
val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + handler)

scope.launch { syncContacts() }          // if this fails...
scope.launch { syncCalendar() }          // ...this keeps running

suspend fun loadWidgets(): List<Widget?> = supervisorScope {
    listOf(async { weather() }, async { news() }).map { d ->
        try { d.await() } catch (e: IOException) { null }   // degrade per widget
    }
}
```

- Pitfall: wrapping `launch { }` itself in try/catch catches nothing; exceptions occur inside the coroutine later.

### Channels
<!-- level: advanced; ref: https://kotlinlang.org/docs/channels.html -->
A `Channel<T>` is a coroutine-friendly queue for communicating between coroutines, similar to a `BlockingQueue` but with suspending `send` and `receive` instead of blocking. Channels are hot: they exist independently of consumers, and each element is delivered to exactly one receiver. That makes them suitable for work distribution (fan-out to several workers) and for one-off events.

Capacity options control back-pressure: `RENDEZVOUS` (default, zero buffer: `send` suspends until a receiver takes the element), a fixed number (buffered), `UNLIMITED`, and `CONFLATED` (keep only the latest). `BufferOverflow.DROP_OLDEST` or `DROP_LATEST` change the overflow behaviour.

A channel must be closed (`close()`) to signal completion; `for (x in channel)` ends when it is closed and drained. The `produce { }` builder creates a channel owned by a coroutine and closes it automatically. `select { }` waits on several channels at once.

For streams of values with operators and no explicit lifecycle, prefer `Flow`; channels are lower-level plumbing.

```kotlin
fun CoroutineScope.produceJobs(ids: List<Long>): ReceiveChannel<Long> = produce(capacity = 100) {
    for (id in ids) send(id)                       // suspends when the buffer is full
}

suspend fun processAll(ids: List<Long>) = coroutineScope {
    val jobs = produceJobs(ids)
    repeat(8) { worker ->                           // fan-out to 8 workers
        launch(Dispatchers.IO) {
            for (id in jobs) handle(id, worker)     // each id goes to exactly one worker
        }
    }
}
```

- Pitfall: an unconsumed channel with suspended senders keeps their coroutines alive forever; close channels and cancel producers.

### Shared mutable state: Mutex and atomics
<!-- level: advanced; ref: https://kotlinlang.org/docs/shared-mutable-state-and-concurrency.html -->
Coroutines on multi-threaded dispatchers (`Default`, `IO`) can run truly in parallel, so shared mutable state has the same data-race problems as threads. `counter++` from a thousand coroutines on `Dispatchers.Default` loses updates.

Options, from simplest:
- Avoid sharing: return results from `async` and combine them, or confine state to one coroutine or a single-threaded context (`Dispatchers.Default.limitedParallelism(1)`).
- Atomics: `AtomicInteger`/`AtomicReference` on the JVM, or `kotlinx.atomicfu` for multiplatform, for single variables.
- `Mutex`: a suspending lock. `mutex.withLock { }` suspends instead of blocking a thread while waiting. It is not reentrant, so locking it again in the same coroutine deadlocks.
- Actor-style confinement: one coroutine owns the state and receives commands through a channel.
- For UI state, `MutableStateFlow.update { }` performs an atomic compare-and-set update.

Never use `synchronized` around code that suspends: the lock is held across the suspension and may be released on a different thread, and blocking threads defeats coroutines.

```kotlin
class InventoryCache(private val api: InventoryApi) {
    private val mutex = Mutex()
    private val cache = mutableMapOf<String, Int>()

    suspend fun stock(sku: String): Int = mutex.withLock {
        cache.getOrPut(sku) { api.fetchStock(sku) }    // suspending call inside the lock
    }
}

val state = MutableStateFlow(Cart())
fun addItem(item: Item) = state.update { it.copy(items = it.items + item) }   // atomic
```

- Pitfall: holding a `Mutex` across a slow network call serialises all callers; keep critical sections short.
