## 1. Getting Started with Kotlin

### What Kotlin is and where it runs
<!-- level: basic; ref: https://kotlinlang.org/docs/getting-started.html -->
Kotlin is a statically typed, multi-paradigm language created by JetBrains. It is concise, null-safe by design, and fully interoperable with Java. Google made it the preferred language for Android in 2019, and it is widely used on the server with Spring and Ktor.

One language, several targets:
- Kotlin/JVM compiles to JVM bytecode, running anywhere Java runs and using any Java library.
- Kotlin/Native compiles through LLVM to native binaries for iOS, macOS, Linux and Windows, with no JVM.
- Kotlin/JS and Kotlin/Wasm target browsers and JavaScript runtimes.
- Kotlin Multiplatform shares code across these targets.

Kotlin 2.0 (May 2024) made the K2 compiler the default: a rewritten frontend that compiles up to about twice as fast and uses one unified architecture for all targets, with smarter type inference and smart casts. Kotlin ships new language releases roughly twice a year (2.1, 2.2, ...), with a standard library (`kotlin-stdlib`) and official libraries such as `kotlinx.coroutines` and `kotlinx.serialization`.

```kotlin
// Hello.kt: no class needed, top-level main
fun main(args: Array<String>) {
    val name = args.firstOrNull() ?: "Kotlin"
    println("Hello, $name!")
}
```

```bash
kotlinc Hello.kt -include-runtime -d hello.jar
java -jar hello.jar Ada
```

- Interview tip: Kotlin on the JVM produces normal class files; a top-level function in `Hello.kt` becomes a static method in a class named `HelloKt`.
- In practice projects are built with Gradle (Kotlin DSL) or Maven, and IntelliJ IDEA or Android Studio.

### Variables: val, var and type inference
<!-- level: basic; ref: https://kotlinlang.org/docs/basic-syntax.html -->
Kotlin declares variables with `val` (read-only reference, assigned once, like Java's `final`) or `var` (mutable). The type is inferred from the initializer, and can be written explicitly after a colon. Kotlin style strongly prefers `val`; immutable references make code easier to reason about and safer to share between threads.

Note that `val` makes the reference read-only, not the object. A `val list = mutableListOf(1)` can still be modified. Top-level and object-level `const val` declares compile-time constants (primitives and strings only), which are inlined at use sites.

Statements do not need semicolons. Type inference is local and static, so the compiler always knows the exact type; Kotlin is not dynamically typed.

```kotlin
const val MAX_RETRIES = 3                 // compile-time constant

fun main() {
    val city = "Pune"                     // inferred String, cannot be reassigned
    var attempts = 0                      // inferred Int, mutable
    attempts += 1

    val price: Double = 499.0             // explicit type
    val tags = mutableListOf("new")       // reference is val, content is mutable
    tags += "sale"

    val total: Long                       // definite assignment: assign exactly once later
    total = if (attempts > 0) 10L else 0L
    println("$city $attempts $price $tags $total")
}
```

- Pitfall: declaring everything as `var` "just in case"; IntelliJ warns when a `var` could be a `val`.
- Interview tip: `val` is not deep immutability; use read-only collection types and immutable data classes for that.

### Basic types and numbers
<!-- level: basic; ref: https://kotlinlang.org/docs/numbers.html -->
In Kotlin everything is an object from the language's point of view: you can call methods on an `Int`. The compiler still represents non-null `Int`, `Long`, `Double`, `Boolean` and `Char` as JVM primitives where possible, and boxes them only when nullable (`Int?`) or used as a generic type argument. So you get object syntax with primitive performance.

Numeric types are `Byte`, `Short`, `Int`, `Long`, `Float` and `Double`, plus unsigned `UByte`, `UShort`, `UInt` and `ULong`. Unlike Java, there are no implicit widening conversions: an `Int` cannot be assigned to a `Long` variable without `toLong()`. This avoids subtle precision bugs. Literals support underscores and suffixes (`L`, `f`, `u`).

Integer division truncates, and arithmetic overflows silently as on the JVM. `Char` is not a number; convert with `code` and `Char(int)`.

```kotlin
val small: Int = 42
val big: Long = small.toLong()            // explicit conversion required
// val wrong: Long = small                // compile error
val million = 1_000_000
val ratio = 7 / 2                         // 3
val precise = 7 / 2.0                     // 3.5
val flags: UInt = 0xFFu
val code = 'A'.code                       // 65
val letter = Char(66)                     // 'B'

val a: Int? = 1000
val b: Int? = 1000
println(a == b)                           // true: structural equality
println(a === b)                          // may be false: boxed identity
```

- Pitfall: comparing boxed numbers with `===` (identity) instead of `==` (equals).
- Use `BigDecimal` for money, and `Math.addExact`-style checks or `Long` when overflow is a risk.

## 2. Control Flow, Functions and Strings

### if and when as expressions
<!-- level: basic; ref: https://kotlinlang.org/docs/control-flow.html -->
In Kotlin `if` is an expression that returns a value, so there is no ternary operator; `val max = if (a > b) a else b`. The last expression in each branch block is its value.

`when` replaces `switch` and is far more powerful. Branches can match constants, several values separated by commas, ranges (`in 1..9`), types (`is String`, with smart cast), or arbitrary boolean conditions when no subject is given. Used as an expression, `when` must be exhaustive: for enums, sealed classes and Booleans the compiler checks that every case is covered, so `else` is unnecessary. There is no fall-through.

Kotlin 2.2 made guard conditions stable: a branch can add `if` after its primary condition, such as `is Card if amount > limit ->`.

```kotlin
sealed interface Payment
data class Card(val amount: Long, val country: String) : Payment
data class Upi(val amount: Long) : Payment
data object Cash : Payment

fun fee(p: Payment): Long = when (p) {
    is Card if p.country != "IN" -> p.amount * 3 / 100   // guard condition (2.2+)
    is Card -> p.amount * 2 / 100                        // smart cast to Card
    is Upi -> 0
    Cash -> 0
}

fun grade(score: Int) = when (score) {
    in 90..100 -> "A"
    in 75..<90 -> "B"
    else -> "C"
}

fun describe(x: Any) = when {
    x is String && x.isEmpty() -> "empty string"
    x is Int -> "int $x"
    else -> "something else"
}
```

- Pitfall: a `when` used as a statement does not need to be exhaustive, so missing cases can slip through; prefer the expression form for sealed types.

### Loops and ranges
<!-- level: basic; ref: https://kotlinlang.org/docs/ranges.html -->
Kotlin has `for`, `while` and `do-while`, but the `for` loop always iterates over something iterable; there is no C-style `for (i = 0; i < n; i++)`. Instead you use ranges and progressions:
- `1..10` is inclusive; `0..<n` (or `0 until n`) excludes the end, perfect for indices.
- `10 downTo 1` counts down; `step 2` skips.
- `for ((index, value) in list.withIndex())` gives both; `list.indices` gives valid indices.

The compiler optimises loops over integer ranges into plain counter loops, so there is no allocation overhead.

Labels with `@` allow `break` and `continue` to target an outer loop. Since Kotlin 2.2, `break` and `continue` also work inside lambdas passed to inline functions such as `forEach` (non-local break and continue).

```kotlin
for (i in 0..<5) print(i)                 // 01234
for (i in 10 downTo 0 step 5) print(i)    // 1050

val names = listOf("Asha", "Ben", "Chen")
for ((i, name) in names.withIndex()) println("$i: $name")

outer@ for (row in grid) {
    for (cell in row) {
        if (cell == target) break@outer
    }
}

repeat(3) { attempt -> println("try $attempt") }

if (port in 1024..65535) println("user port")
val letters = ('a'..'e').joinToString("")  // "abcde"
```

- Prefer collection operations (`map`, `filter`, `sumOf`) over manual loops when you are transforming data.
- Pitfall: `0..list.size` includes `size` and goes out of bounds; use `list.indices` or `0..<list.size`.

### Functions, default and named arguments
<!-- level: basic; ref: https://kotlinlang.org/docs/functions.html -->
Functions are declared with `fun`, parameters are `name: Type`, and the return type follows the parameter list. A function with an expression body can drop braces and the return type: `fun square(x: Int) = x * x`. Functions returning nothing useful return `Unit` (Kotlin's `void`, but a real singleton type).

Default parameter values and named arguments remove most of Java's overloads and builders: callers pass only what differs from defaults and name arguments for clarity, in any order. Functions can be declared at top level (no class needed), as members, as local functions inside other functions, or as extensions.

Other features: `vararg` parameters (spread an array with `*`), `infix` functions callable without dots (`1 to "one"`), and `tailrec` for compiler-optimised tail recursion.

```kotlin
fun connect(
    host: String,
    port: Int = 443,
    timeoutMs: Long = 5_000,
    useTls: Boolean = true,
): Connection = Connection(host, port, timeoutMs, useTls)

val c1 = connect("api.example.com")
val c2 = connect("localhost", port = 8080, useTls = false)

fun log(vararg messages: String) = messages.forEach(::println)
val arr = arrayOf("a", "b")
log("start", *arr)

infix fun Int.percentOf(total: Int) = total * this / 100
val tax = 18 percentOf 1000          // 180

tailrec fun gcd(a: Int, b: Int): Int = if (b == 0) a else gcd(b, a % b)
```

- Interview tip: Java callers do not see default arguments unless you add `@JvmOverloads`.
- Pitfall: a block body with `=` (`fun f() = { ... }`) returns a lambda, not the value.

### Operator overloading and conventions
<!-- level: intermediate; ref: https://kotlinlang.org/docs/operator-overloading.html -->
Kotlin lets you implement a fixed set of operators for your own types by defining functions with specific names marked `operator`. The compiler translates operator syntax into calls: `a + b` becomes `a.plus(b)`, `a[i]` becomes `a.get(i)`, `a in b` becomes `b.contains(a)`, `a()` becomes `a.invoke()`, `a += b` becomes `plusAssign` (or `a = a.plus(b)` for a `var`), and `a < b` becomes `a.compareTo(b) < 0`. Destructuring uses `component1()`, `component2()`, and ranges use `rangeTo`/`rangeUntil`.

Because the set of operators is fixed and each maps to a named function, the feature stays predictable compared with C++-style overloading. You can also add operators to existing types through extension functions.

Equality `==` always maps to `equals` (null-safe), and `===` checks identity; neither is overridable separately.

```kotlin
data class Money(val paise: Long) : Comparable<Money> {
    operator fun plus(other: Money) = Money(paise + other.paise)
    operator fun times(factor: Int) = Money(paise * factor)
    operator fun unaryMinus() = Money(-paise)
    override fun compareTo(other: Money) = paise.compareTo(other.paise)
}

class Matrix(private val data: Array<DoubleArray>) {
    operator fun get(r: Int, c: Int) = data[r][c]
    operator fun set(r: Int, c: Int, v: Double) { data[r][c] = v }
}

val total = Money(500) + Money(250) * 2      // Money(paise=1000)
val isMore = total > Money(900)              // compareTo
val m = Matrix(Array(2) { DoubleArray(2) })
m[0, 1] = 3.5
```

- Pitfall: defining both `plus` and `plusAssign` makes `a += b` ambiguous for a `var`.
- Only overload operators whose meaning is obvious; `+` on a `User` type confuses readers.

### Strings and string templates
<!-- level: basic; ref: https://kotlinlang.org/docs/strings.html -->
Kotlin strings are immutable `java.lang.String` objects on the JVM. String templates embed values directly: `"$name"` for a simple name and `"${user.name.uppercase()}"` for any expression. The compiler turns templates into efficient `StringBuilder` code.

Raw strings use triple quotes, may span lines, and do not process escapes, which is ideal for regexes, JSON and SQL. `trimIndent()` removes common leading indentation and `trimMargin()` strips up to a margin character.

Since a dollar sign starts a template, raw strings that need literal `$` used to require the awkward `${'$'}`. Kotlin 2.2 stabilised multi-dollar interpolation: prefixing a string with `$$` means templates need two dollars, so a single `$` is literal.

The standard library adds many helpers: `buildString`, `padStart`, `substringBefore`, `toIntOrNull`, `lines`, `split`, `ifBlank`, and `chunked`.

```kotlin
val user = User("Ada", 36)
println("Hello ${user.name}, next year you'll be ${user.age + 1}")

val query = """
    SELECT id, name
    FROM users
    WHERE active = true
""".trimIndent()

val schema = $$"""
    { "$schema": "https://json-schema.org/draft/2020-12/schema", "title": "$${user.name}" }
"""                                                 // Kotlin 2.2+ multi-dollar interpolation

val report = buildString {
    appendLine("Report")
    repeat(3) { append(it).append(',') }
}
val port = "8080".toIntOrNull() ?: 80              // no exception on bad input
```

- Pitfall: `String.toInt()` throws `NumberFormatException`; prefer `toIntOrNull()` for user input.
- Pitfall: `==` compares content in Kotlin (it calls `equals`), so the Java `==` string bug disappears.

### Exceptions and the Nothing type
<!-- level: intermediate; ref: https://kotlinlang.org/docs/exceptions.html -->
Kotlin has no checked exceptions: the compiler never forces you to catch or declare anything. The designers concluded that checked exceptions in large Java codebases mostly produced empty catch blocks and boilerplate. All exceptions behave like Java's unchecked ones.

`try` is an expression, so it can produce a value. `throw` is also an expression, of type `Nothing`, a type with no values that is a subtype of every type. This is why `val name = input ?: throw IllegalArgumentException()` type-checks, and why functions like `TODO()` and `error()` can be used anywhere. The compiler also knows that code after a `Nothing` call is unreachable.

Precondition helpers express intent: `require` (argument checks, throws `IllegalArgumentException`), `check` (state checks, `IllegalStateException`), `requireNotNull`, and `error("message")`. `runCatching` wraps a block into a `Result`.

```kotlin
fun parsePort(raw: String): Int {
    val port = raw.toIntOrNull() ?: throw IllegalArgumentException("not a number: $raw")
    require(port in 1..65535) { "port out of range: $port" }
    return port
}

val config = try {
    loadConfig(path)
} catch (e: IOException) {
    Config.DEFAULT
}

fun fail(msg: String): Nothing = throw IllegalStateException(msg)

val result: Result<Int> = runCatching { parsePort("80a") }
result.onFailure { println("bad port: ${it.message}") }
```

- Pitfall: `runCatching` also catches `CancellationException`, which breaks coroutine cancellation; rethrow it in coroutine code.
- When calling Kotlin from Java, add `@Throws(IOException::class)` so Java callers can catch checked exceptions.

## 3. Null Safety

### Nullable and non-nullable types
<!-- level: basic; ref: https://kotlinlang.org/docs/null-safety.html -->
Kotlin's type system distinguishes references that can hold null from those that cannot. `String` can never be null; `String?` can. Assigning null to a non-nullable type, or calling a method directly on a nullable value, is a compile error. This moves the billion-dollar mistake, the `NullPointerException`, from runtime to compile time for Kotlin code.

There is no runtime cost: on the JVM both are ordinary references. The compiler enforces the rules, emits `@Nullable`/`@NotNull` annotations for Java tools, and inserts cheap null checks (`Intrinsics.checkNotNullParameter`) on public function parameters so Java callers passing null fail fast with a clear message.

`String` is a subtype of `String?`, so a non-null value can always be used where a nullable one is expected, but not the reverse. Generic type parameters are nullable by default (`T` has an upper bound of `Any?`); use `T : Any` to require non-null.

```kotlin
var name: String = "Ada"
// name = null                          // compile error

var nickname: String? = null            // allowed
// println(nickname.length)             // compile error: possibly null

fun greet(user: User?) {
    if (user == null) {
        println("Hello, guest")
        return
    }
    println("Hello, ${user.name}")      // smart cast: user is User here
}

fun <T : Any> requireValue(value: T?): T = value ?: error("missing value")
```

- Design tip: make types non-nullable by default and use null only when absence is a meaningful state.
- Interview tip: Kotlin can still throw NPEs: via `!!`, Java interop (platform types), uninitialised `lateinit`, or leaking `this` from constructors.

### Safe calls, the Elvis operator and let
<!-- level: basic; ref: https://kotlinlang.org/docs/null-safety.html -->
Kotlin provides compact operators for working with nullable values:
- Safe call `?.`: `user?.address?.city` evaluates to null if any link is null, instead of throwing.
- Elvis `?:`: supplies a fallback when the left side is null, `name ?: "Unknown"`. Because `return` and `throw` are expressions, the right side can also exit early: `val id = request.id ?: return badRequest()`.
- Safe call with `let`: `email?.let { send(it) }` runs a block only when the value is non-null.
- Safe cast `as?`: returns null instead of throwing `ClassCastException`.
- Collection helpers: `filterNotNull()`, `mapNotNull { }`, `firstOrNull()`, `orEmpty()`.

Chaining these replaces nested null checks and Java's `Optional`, without allocations.

```kotlin
data class Address(val city: String?)
data class Customer(val name: String, val address: Address?)

fun shippingCity(c: Customer?): String =
    c?.address?.city?.takeIf { it.isNotBlank() } ?: "Unknown"

fun handle(request: Request): Response {
    val userId = request.header("X-User")?.toLongOrNull() ?: return Response.badRequest()
    val user = repo.find(userId) ?: throw NotFoundException("user $userId")
    user.email?.let { mailer.sendWelcome(it) }
    return Response.ok(user)
}

val ids: List<Long> = rawIds.mapNotNull { it.toLongOrNull() }
val text = (value as? String).orEmpty()
```

- Pitfall: long `?.let { } ?: run { }` chains are hard to read; an `if (x != null)` is often clearer.
- Pitfall: `a?.let { f(it) } ?: g()` also runs `g()` when `f(it)` returns null, which may not be what you meant.

### The not-null assertion and platform types
<!-- level: intermediate; ref: https://kotlinlang.org/docs/java-interop.html#null-safety-and-platform-types -->
The not-null assertion operator `!!` converts a nullable value to non-null, throwing `NullPointerException` if it is null. It tells the compiler "trust me". Each `!!` is a potential crash, so treat it as a code smell: acceptable in tests or when an invariant truly guarantees non-null, but better replaced with `requireNotNull(x) { "why" }`, which gives a meaningful error, or with proper null handling.

Platform types appear when Kotlin calls Java code that has no nullability annotations. The compiler cannot know whether `String getName()` may return null, so it gives the type `String!` (shown only in IDE hints). You may treat it as nullable or non-null; if you choose non-null and Java returns null, you get an NPE at the point of use. Kotlin respects nullability annotations from JSpecify, JetBrains, AndroidX, JSR-305 and others, turning them into real `String` or `String?`.

```kotlin
// Java: public String getManagerName() { ... }   // no annotation
val manager = employee.managerName          // platform type String!
val len = manager.length                    // compiles; NPE at runtime if Java returned null

val safeManager: String? = employee.managerName   // explicitly treat as nullable
println(safeManager?.length ?: 0)

val token = requireNotNull(System.getenv("API_TOKEN")) { "API_TOKEN must be set" }

// Avoid
val config = loadConfigOrNull()!!           // crash without context
```

- Interview tip: the boundary with Java is where most NPEs in Kotlin apps come from; annotate Java code (JSpecify) or declare explicit nullable types at the boundary.
- Pitfall: `!!` chains like `a!!.b!!.c` make it impossible to tell which link was null from the stack trace.

### Smart casts
<!-- level: intermediate; ref: https://kotlinlang.org/docs/typecasts.html -->
After a type check (`is`) or a null check, the Kotlin compiler automatically treats the variable as the narrower type in the code paths where the check is known to hold. No explicit cast is needed. This works in `if`, `when`, `&&`/`||` chains, after early returns, and with `while` loops.

Smart casts require the compiler to prove the value cannot change between the check and the use. They work for local `val`s, local `var`s not captured in a lambda that modifies them, and `val` properties without custom getters declared in the same module. They do not work for `var` properties or `open` properties, because another thread or an override could change the value. The K2 compiler (Kotlin 2.0) extended smart casts to more cases, such as local variables used after `||` checks and inside inline lambdas.

```kotlin
fun area(shape: Any): Double {
    if (shape !is Shape) return 0.0
    return shape.area()                       // smart cast to Shape
}

fun lengthOf(x: Any?): Int = when (x) {
    null -> 0
    is String -> x.length                     // String
    is Collection<*> -> x.size                // Collection
    else -> -1
}

class Session { var user: User? = null }

fun greet(session: Session) {
    // if (session.user != null) println(session.user.name)  // error: mutable property
    val user = session.user                   // copy to a local val
    if (user != null) println(user.name)      // smart cast works
    session.user?.let { println(it.name) }    // or use let
}
```

- Pitfall: the "smart cast is impossible" error on `var` properties is the compiler protecting you from a race; copy to a local.
- `as` performs an unchecked cast that throws on failure; `as?` returns null.

### lateinit and lazy initialization
<!-- level: intermediate; ref: https://kotlinlang.org/docs/properties.html#late-initialized-properties-and-variables -->
Non-null properties must normally be initialised in the constructor. Two mechanisms handle values that become available later.

`lateinit var` declares a non-null mutable property that you promise to set before reading. It suits dependency injection, test setup (`@BeforeEach`) and Android lifecycle callbacks. It works only with non-primitive, non-nullable `var` types. Reading it before assignment throws `UninitializedPropertyAccessException` with the property name; `::prop.isInitialized` checks state.

`by lazy { }` declares a read-only `val` computed on first access and cached. By default it is thread-safe (`LazyThreadSafetyMode.SYNCHRONIZED`), using double-checked locking so the initializer runs once. Use `PUBLICATION` (may run more than once, first result wins) or `NONE` (single-threaded, e.g. UI code) to avoid locking overhead.

```kotlin
class ReportServiceTest {
    private lateinit var service: ReportService

    @BeforeEach
    fun setUp() { service = ReportService(FakeRepo()) }

    @Test
    fun generates() { assertEquals(3, service.generate().size) }
}

class GeoService(private val path: Path) {
    private val database: GeoDatabase by lazy {      // loaded on first lookup only
        GeoDatabase.open(path)
    }
    fun country(ip: String) = database.lookup(ip)
}

val formatter by lazy(LazyThreadSafetyMode.NONE) { DecimalFormat("#,##0.00") }
```

- Pitfall: `lateinit` hides initialisation bugs until runtime; prefer constructor injection where possible.
- Pitfall: a `lazy` block that captures a large object or an Android `Context` keeps it alive as long as the delegate exists.

## 4. Classes and Objects

### Classes, constructors and init blocks
<!-- level: basic; ref: https://kotlinlang.org/docs/classes.html -->
A Kotlin class can declare its primary constructor in the header. Prefixing parameters with `val` or `var` declares and initialises properties in one step, removing Java's field, constructor and getter boilerplate. Code that must run at construction goes in `init` blocks, which execute in order with property initialisers. Secondary constructors (`constructor(...)`) must delegate to the primary one with `this(...)`.

Classes are created without `new`: `val user = User("Ada")`. Combined with default arguments, a single primary constructor usually replaces several Java overloads and builders.

Classes are `public` and `final` by default. Kotlin also has no `static` keyword; class-level members live in a `companion object`, and utilities are usually top-level functions.

```kotlin
class Account(
    val id: String,
    owner: String,                          // plain parameter, not a property
    private var balance: Long = 0,
) {
    val ownerName = owner.trim()            // property initialised from a parameter

    init {
        require(id.startsWith("ACC-")) { "invalid id $id" }
        require(balance >= 0)
    }

    constructor(id: String) : this(id, owner = "unknown")   // secondary constructor

    fun deposit(amount: Long) {
        require(amount > 0)
        balance += amount
    }

    fun balance() = balance
}

val acc = Account("ACC-1", "  Ada ")
acc.deposit(500)
```

- Pitfall: init blocks and property initialisers run top to bottom; reading a property declared further down returns its default (null or 0).
- Pitfall: calling open members from an init block can observe uninitialised subclass state.

### Properties, getters, setters and backing fields
<!-- level: intermediate; ref: https://kotlinlang.org/docs/properties.html -->
Kotlin properties replace Java's field-plus-accessors pattern. A `val` property gets a getter, a `var` gets a getter and setter, and callers use plain property syntax: `user.name`, `user.name = "x"`. On the JVM these compile to `getName()`/`setName()` methods with a private field, so Java sees normal accessors.

You can customise accessors. Inside a setter or getter, `field` refers to the backing field, which the compiler creates only if an accessor uses `field` or the default accessor is used. A property with only a custom getter and no `field` is computed on every access and stores nothing. Setters can have restricted visibility (`private set`), which is the idiomatic way to expose read-only state that the class can still change.

```kotlin
class Thermostat {
    var targetCelsius: Double = 21.0
        set(value) {
            require(value in 5.0..30.0) { "out of range: $value" }
            field = value                       // write the backing field
        }

    var readings: Int = 0
        private set                             // public read, private write

    val isHeating: Boolean
        get() = currentCelsius() < targetCelsius   // computed, no backing field

    fun record() { readings++ }
    private fun currentCelsius() = 19.5
}
```

- Pitfall: writing `targetCelsius = value` inside its own setter recurses forever; use `field`.
- Pitfall: a computed `val` property that does expensive work surprises callers; use a function when the work is not cheap.
- Interview tip: Kotlin has no fields in the language model, only properties; `@JvmField` exposes a raw field for Java.

### Inheritance, open and override
<!-- level: intermediate; ref: https://kotlinlang.org/docs/inheritance.html -->
Kotlin classes and members are final by default. To allow subclassing, mark the class `open`; to allow overriding, mark the member `open`; in the subclass, `override` is mandatory. This applies Effective Java's advice, "design for inheritance or prohibit it", at the language level, preventing the fragile base class problem by accident.

Overriding members are themselves open unless marked `final override`. Abstract classes and members (`abstract`) are open implicitly. A subclass calls its superclass constructor in the header (`class B : A(...)`) and calls super implementations with `super.method()`; when several supertypes provide the same member, disambiguate with `super<Interface>.method()`.

Frameworks that need subclassing for proxies (Spring, JPA) use the `kotlin-spring`/`all-open` compiler plugin to open annotated classes automatically.

```kotlin
open class Notifier(protected val sender: String) {
    open fun format(msg: String) = "[$sender] $msg"
    fun send(to: String, msg: String) = transport(to, format(msg))   // final: cannot override
    protected open fun transport(to: String, text: String) = println("$to <- $text")
}

class SmsNotifier(sender: String) : Notifier(sender) {
    override fun format(msg: String) = super.format(msg).take(160)
    final override fun transport(to: String, text: String) = smsGateway.send(to, text)
}

abstract class Shape {
    abstract val area: Double
    override fun toString() = "${this::class.simpleName}(area=$area)"
}
```

- Pitfall: Spring `@Transactional` silently does nothing on final Kotlin classes without the `kotlin-spring` plugin, because proxies cannot subclass them.
- Prefer interfaces, sealed hierarchies and composition (with `by` delegation) over deep open hierarchies.

### Interfaces
<!-- level: basic; ref: https://kotlinlang.org/docs/interfaces.html -->
Kotlin interfaces can declare abstract members, members with default implementations, and properties. Interface properties cannot have backing fields: they are either abstract (implementers provide them) or have a custom getter. A class can implement many interfaces; if two provide the same default method, the class must override it and choose explicitly with `super<A>.method()`.

On the JVM, since Kotlin 2.2 interface methods with bodies compile to real Java default methods by default; older versions generated a hidden `DefaultImpls` helper class unless you set the `-Xjvm-default` compiler option. This matters when Java classes implement Kotlin interfaces.

A `fun interface` declares a functional (single abstract method) interface, enabling SAM conversion so callers can pass a lambda.

```kotlin
interface Identifiable {
    val id: String                                   // abstract property
}

interface Auditable {
    val createdBy: String
    val label: String get() = "created by $createdBy"   // property with default getter
    fun audit() = println(label)
}

data class Invoice(override val id: String, override val createdBy: String) : Identifiable, Auditable

fun interface Validator<T> {
    fun validate(value: T): Boolean
}

val notBlank = Validator<String> { it.isNotBlank() }   // SAM conversion
println(notBlank.validate("  "))                       // false
```

- Use interfaces to define capabilities and keep implementations swappable for testing.
- Pitfall: interfaces cannot hold state, so a "default" that needs storage must move to an abstract class or delegation.

### Visibility modifiers
<!-- level: basic; ref: https://kotlinlang.org/docs/visibility-modifiers.html -->
Kotlin has four visibility levels, with `public` as the default (unlike Java's package-private default):
- `public`: visible everywhere.
- `internal`: visible everywhere in the same module, meaning one compilation unit such as a Gradle source set or Maven module. It is the tool for hiding implementation details of a library while sharing them across its packages.
- `protected`: visible in the class and its subclasses (not the whole package as in Java).
- `private`: inside a class, visible only in that class; at top level, visible only in that file.

Kotlin has no package-private visibility. Top-level private declarations act as file-private helpers. Library authors can enable explicit API mode (`kotlin { explicitApi() }`), which forces every public declaration to state its visibility and return type, preventing accidental API exposure.

On the JVM, `internal` members become public in bytecode with mangled names, so Java code in other modules can technically reach them, though awkwardly.

```kotlin
// File: PaymentClient.kt in module :payments
public class PaymentClient internal constructor(   // only this module can construct it
    private val http: HttpClient,
) {
    public fun charge(amount: Long): Receipt = Receipt(signRequest(amount))
    internal fun debugDump(): String = "client state"
}

private fun signRequest(amount: Long): String = "sig-$amount"   // file-private helper

public fun paymentClient(): PaymentClient = PaymentClient(defaultHttp())
```

- Interview tip: `internal` plus explicit API mode is how Kotlin libraries keep a small, stable public surface.

### Data classes
<!-- level: basic; ref: https://kotlinlang.org/docs/data-classes.html -->
A `data class` is a class whose main purpose is holding data. From the properties declared in the primary constructor, the compiler generates `equals`, `hashCode`, `toString`, `componentN` functions (for destructuring) and `copy`. `copy` creates a modified copy, which makes working with immutable objects pleasant.

Requirements: the primary constructor needs at least one parameter, all marked `val` or `var`; data classes cannot be abstract, open, sealed or inner. Properties declared in the class body are excluded from the generated methods.

Prefer `val` properties and immutable collection types to get true value semantics. `data object` (Kotlin 1.9) is the singleton variant with a readable `toString`, handy in sealed hierarchies.

```kotlin
data class Customer(
    val id: Long,
    val name: String,
    val email: String,
    val tags: List<String> = emptyList(),
) {
    var lastSeen: Long = 0          // not part of equals/hashCode/toString
}

val c1 = Customer(1, "Ada", "ada@example.com")
val c2 = c1.copy(email = "ada@new.com")        // shallow copy with one change
println(c1 == c1.copy())                         // true: structural equality
val (id, name) = c1                               // destructuring by position
println(c2)                                       // Customer(id=1, name=Ada, email=ada@new.com, tags=[])
```

- Pitfall: `copy` is shallow; a mutable list inside is shared between copies.
- Pitfall: destructuring is positional, so reordering constructor parameters silently changes meaning; use it sparingly for public types.
- Pitfall: data classes as JPA entities break because entity identity and mutability do not match value semantics.

### Object declarations and companion objects
<!-- level: intermediate; ref: https://kotlinlang.org/docs/object-declarations.html -->
`object` declares a class and its single instance at once, a language-level singleton. It is initialised lazily and thread-safely on first access (on the JVM it compiles to a class with a static `INSTANCE` field set in a static initialiser).

A `companion object` is an object tied to a class; its members are accessed through the class name (`User.create()`), filling the role of Java's static members. Companions can implement interfaces and have extension functions. For Java callers, `@JvmStatic` generates real static methods and `@JvmField` or `const` exposes static fields.

Object expressions (`object : Listener { ... }`) create anonymous objects, replacing Java's anonymous inner classes.

```kotlin
object Metrics {
    private val counters = java.util.concurrent.ConcurrentHashMap<String, Long>()
    fun increment(name: String) { counters.merge(name, 1L, Long::plus) }
}

class User private constructor(val email: String) {
    companion object {
        const val MAX_EMAIL = 254
        fun create(raw: String): User {               // factory instead of public constructor
            require(raw.length <= MAX_EMAIL && "@" in raw)
            return User(raw.lowercase())
        }
    }
}

val user = User.create("Ada@Example.com")
Metrics.increment("signup")

val listener = object : ClickListener {
    var clicks = 0
    override fun onClick() { clicks++ }
}
```

- Pitfall: singletons with mutable state are global variables; they make tests interfere with each other.
- Pitfall: an `object` holding an Android `Context` or Activity leaks it for the life of the process.

### Enum classes
<!-- level: basic; ref: https://kotlinlang.org/docs/enum-classes.html -->
Enum classes define a fixed set of named constants. Each constant is a singleton object, and enums can have constructor properties, methods, abstract members overridden per constant, and can implement interfaces. They are exhaustive in `when` expressions.

Useful members: `name`, `ordinal`, `entries` (Kotlin 1.9, a pre-allocated immutable list that replaces `values()`, which allocated a new array on each call), `valueOf(name)`, and the generic `enumValueOf<T>()`/`enumEntries<T>()`.

Use enums when the alternatives are simple constants that share the same shape. When alternatives carry different data, use a sealed class or interface instead.

```kotlin
enum class OrderStatus(val code: String, val terminal: Boolean) {
    PENDING("P", false),
    SHIPPED("S", false),
    DELIVERED("D", true),
    CANCELLED("C", true);

    fun canTransitionTo(next: OrderStatus) = !terminal && next.ordinal > ordinal

    companion object {
        private val byCode = entries.associateBy { it.code }
        fun fromCode(code: String) = byCode[code] ?: error("unknown status $code")
    }
}

fun label(s: OrderStatus) = when (s) {               // exhaustive, no else
    OrderStatus.PENDING -> "Awaiting shipment"
    OrderStatus.SHIPPED -> "On the way"
    OrderStatus.DELIVERED -> "Delivered"
    OrderStatus.CANCELLED -> "Cancelled"
}
```

- Pitfall: persisting `ordinal` breaks when constants are reordered; persist a stable code or the name.
- Pitfall: `valueOf` throws for unknown names; use `entries.firstOrNull { it.name == raw }` for untrusted input.

### Sealed classes and interfaces
<!-- level: intermediate; ref: https://kotlinlang.org/docs/sealed-classes.html -->
A sealed class or interface restricts its direct subtypes to those declared in the same module and package, all known at compile time. Each subtype can be a data class, a data object, a regular class, or another sealed type, and each can carry different data. This models algebraic data types: a value is exactly one of a fixed set of shapes.

The compiler uses this knowledge to make `when` expressions over a sealed type exhaustive without `else`. Adding a new subtype breaks the build at every `when` that does not handle it, which is exactly what you want for domain states such as UI state, API results and commands.

Sealed interfaces (Kotlin 1.5) let a class belong to several sealed hierarchies and let enums implement them.

```kotlin
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Success<T>(val data: T) : UiState<T>
    data class Error(val message: String, val retryable: Boolean) : UiState<Nothing>
}

fun render(state: UiState<List<Order>>) = when (state) {
    UiState.Loading -> showSpinner()
    is UiState.Success -> showOrders(state.data)          // smart cast
    is UiState.Error -> showError(state.message, state.retryable)
}

sealed class NetworkResult {
    data class Ok(val body: String) : NetworkResult()
    data class HttpError(val code: Int) : NetworkResult()
    data class Failure(val cause: Throwable) : NetworkResult()
}
```

- Using `out T` with `Nothing` lets `Loading` and `Error` be shared by every `UiState<T>`.
- Pitfall: an `else` branch on a sealed `when` defeats the compile-time safety; avoid it.

### Nested and inner classes
<!-- level: intermediate; ref: https://kotlinlang.org/docs/nested-classes.html -->
In Kotlin a class declared inside another class is nested by default, which is equivalent to Java's static nested class: it has no reference to an outer instance. To access the outer instance you must mark it `inner`, and refer to the outer object with a qualified `this@Outer`.

This is the opposite default from Java, where inner (non-static) is the default, and it removes a whole class of memory leaks: in Java, anonymous and inner classes silently retain their enclosing object, a classic source of Android Activity leaks. In Kotlin you opt in explicitly.

Lambdas and object expressions capture `this` only if their body uses members of the enclosing class.

```kotlin
class Playlist(private val name: String) {
    private val songs = mutableListOf<String>()

    class Builder {                         // nested: no access to Playlist instance
        private val items = mutableListOf<String>()
        fun add(song: String) = apply { items += song }
        fun build(name: String) = Playlist(name).also { it.songs += items }
    }

    inner class Cursor {                    // inner: holds a reference to this Playlist
        private var index = 0
        fun next(): String? = songs.getOrNull(index++)
        fun describe() = "Cursor on ${this@Playlist.name}"
    }

    fun cursor() = Cursor()
}

val playlist = Playlist.Builder().add("Song A").add("Song B").build("Road trip")
val cursor = playlist.cursor()
```

- Pitfall: an `inner class` instance passed to a long-lived callback keeps the whole outer object alive.
- Interview tip: name the Java vs Kotlin defaults precisely: Java "static nested" equals Kotlin "nested"; Java "inner" equals Kotlin "inner".

### Value classes
<!-- level: advanced; ref: https://kotlinlang.org/docs/inline-classes.html -->
A value class wraps a single value to give it a distinct type without the runtime cost of an extra object. Declared as `@JvmInline value class UserId(val value: Long)`, it is a separate type at compile time, so you cannot accidentally pass an `OrderId` where a `UserId` is expected, yet in most places the compiler represents it as the underlying `Long` at runtime.

Value classes can have `init` validation, methods and properties without backing fields, and implement interfaces. They have no identity: `===` is forbidden.

Boxing still happens in some situations: when used as a nullable type, as a generic type argument, as an interface type, or when stored in collections. To keep Java interop and overload resolution sound, functions taking value classes get mangled JVM names (like `charge-abc123`), which makes them hard to call from Java unless you add `@JvmName`.

```kotlin
@JvmInline
value class Email(val value: String) {
    init { require("@" in value) { "invalid email" } }
    val domain get() = value.substringAfter('@')
}

@JvmInline value class UserId(val raw: Long)
@JvmInline value class OrderId(val raw: Long)

fun cancel(user: UserId, order: OrderId) { /* ... */ }

cancel(UserId(7), OrderId(42))
// cancel(OrderId(42), UserId(7))     // compile error: types do not match
val domain = Email("ada@example.com").domain
```

- Great for ids, units (Meters, Paise) and validated strings in domain models.
- Pitfall: libraries such as Jackson or JPA may need extra configuration to (de)serialise value classes; kotlinx.serialization supports them natively.
