# Kotlin interview questions

### What is the difference between val and var, and const val?
<!-- level: basic; kind: concept; ref: https://kotlinlang.org/docs/basic-syntax.html#variables -->
`val` declares a read-only reference that can be assigned once; `var` is mutable. Read-only is not the same as immutable: a `val list: MutableList<Int>` can still change contents. A `val` property can have a custom getter and so be computed on each access.

`const val` is a compile-time constant: it must be a primitive or `String`, declared at top level or in an `object` or companion, and is inlined at use sites. Use it for fixed values such as annotation arguments or keys. `val` is evaluated at runtime and can hold any object.

Prefer `val` by default and `var` only when mutation is genuinely needed.

### How does Kotlin's null safety work?
<!-- level: basic; kind: concept; ref: https://kotlinlang.org/docs/null-safety.html -->
Nullability is part of the type system: `String` cannot hold null, `String?` can. The compiler forbids member access on a nullable type unless you handle it: safe call `?.`, Elvis `?:` for defaults, smart casts after a null check, `let` for scoped use, or `!!` to assert non-null and throw `NullPointerException` if wrong.

```kotlin
val len = name?.length ?: 0
name?.let { println(it.uppercase()) }
```

Platform types from Java bypass the checks, so annotate or declare explicit types at the boundary. Avoid `!!`; prefer `requireNotNull` or `checkNotNull` with a message, or redesign so null cannot occur. `lateinit` is for non-null properties initialised later, and throws if read too early.

### What are data classes and what do they generate?
<!-- level: basic; kind: concept; ref: https://kotlinlang.org/docs/data-classes.html -->
A `data class` is for holding data. From the primary constructor properties the compiler generates `equals`, `hashCode`, `toString`, `copy` and `componentN` functions for destructuring. It needs at least one constructor parameter, and properties declared in the body are ignored by the generated functions.

`copy` makes a shallow modified clone, which suits immutable state updates. Pitfalls: mutable properties in a hash key break hash collections; `copy` does not deep-copy nested mutable objects; data classes cannot be open, abstract or sealed (they can implement interfaces and extend sealed classes). Adding a property changes `equals`, so be careful with persisted or serialised identity.

### Explain sealed classes and sealed interfaces and why they are useful with when.
<!-- level: intermediate; kind: concept; ref: https://kotlinlang.org/docs/sealed-classes.html -->
A sealed class or interface restricts its direct subtypes to those declared in the same package and module. Because the compiler knows all subtypes, a `when` expression over the sealed type can be exhaustive without an `else`, and adding a new subtype turns every incomplete `when` into a compile error.

```kotlin
sealed interface Result<out T> {
    data class Ok<T>(val value: T) : Result<T>
    data class Err(val error: Throwable) : Result<Nothing>
    data object Loading : Result<Nothing>
}
```

They model closed hierarchies such as UI state, API results and commands. Sealed interfaces (Kotlin 1.5) allow a class to implement several. Compare with enums: enum entries are single instances; sealed subtypes can carry different data.

### What is the difference between an extension function and a member function?
<!-- level: basic; kind: concept; ref: https://kotlinlang.org/docs/extensions.html -->
An extension function adds a function to a type without modifying or inheriting it; it compiles to a static method taking the receiver as first parameter. It is resolved statically by the declared type, not dynamically, so extensions are not virtual and cannot override members. If a member and an extension have the same signature, the member wins.

Extensions cannot access private members of the receiver. They are great for utility APIs and DSLs, and scoping them (inside a class or file with narrow visibility) avoids polluting the namespace.

```kotlin
fun String.isEmail() = "@" in this && "." in substringAfter("@")
```

### How do scope functions let, run, with, apply and also differ?
<!-- level: intermediate; kind: concept; ref: https://kotlinlang.org/docs/scope-functions.html -->
They execute a block with an object in scope. Two axes: how you refer to the object (`this` for `run`, `with`, `apply`; `it` for `let`, `also`) and what they return (the lambda result for `let`, `run`, `with`; the object itself for `apply`, `also`).

- `let`: null-safe scoped use and transformations: `x?.let { ... }`.
- `apply`: configure an object and return it: builders.
- `also`: side effects such as logging in a chain.
- `run`/`with`: compute a result using the object's members.

Do not nest many of them; `this` and `it` confusion hurts readability. Choose by intent rather than preference.

### What is the difference between a coroutine and a thread?
<!-- level: intermediate; kind: concept; ref: https://kotlinlang.org/docs/coroutines-overview.html -->
A thread is an OS-scheduled unit with its own stack; blocking it wastes that resource. A coroutine is a lightweight suspendable computation managed by the library; it runs on top of threads supplied by a dispatcher and, at a suspension point, releases the thread for other work. Thousands of coroutines can run on a few threads.

Coroutines use structured concurrency: children belong to a scope, a parent waits for them, and cancellation and failures propagate through the hierarchy. `suspend` functions compile into state machines with continuations. Choose dispatchers by workload: `Default` for CPU, `IO` for blocking IO, `Main` for UI.

### Explain structured concurrency and what happens when a child fails.
<!-- level: advanced; kind: concept; ref: https://kotlinlang.org/docs/coroutines-basics.html#structured-concurrency -->
Every coroutine is launched in a `CoroutineScope`, forming a parent-child tree. A parent does not complete until its children do; cancelling the parent cancels all children; the scope's lifetime bounds the work, so there are no leaks of orphan tasks.

By default a child's uncaught failure cancels its parent and so its siblings. `supervisorScope` or a `SupervisorJob` changes this so one child failing does not cancel the others, which suits independent tasks. `async` stores the exception until `await`, while `launch` propagates it to the handler immediately. `CancellationException` is special: it signals normal cancellation and should be rethrown if caught.

### What is the difference between launch and async?
<!-- level: basic; kind: concept; ref: https://kotlinlang.org/docs/coroutines-basics.html -->
`launch` starts a coroutine for side effects and returns a `Job`; it is fire-and-forget (but still structured). `async` starts a coroutine that computes a value and returns a `Deferred<T>`; call `await()` to get the result or exception. Use `async` for parallel decomposition.

```kotlin
coroutineScope {
    val a = async { fetchUser() }
    val b = async { fetchOrders() }
    show(a.await(), b.await())
}
```

Wrap them in `coroutineScope` so failures and cancellation propagate. Using `async` and never awaiting it hides exceptions; using sequential `await` immediately defeats parallelism.

### How do Flow, StateFlow and SharedFlow differ?
<!-- level: intermediate; kind: concept; ref: https://kotlinlang.org/docs/flow.html -->
`Flow` is cold: nothing runs until collected, each collector gets its own execution. `StateFlow` is hot and always has a value; new collectors get the latest value immediately, and equal consecutive values are conflated; it models state. `SharedFlow` is hot, supports replay and buffering configuration, and broadcasts to all collectors; it models events.

Convert cold to hot with `stateIn` or `shareIn`, using `SharingStarted.WhileSubscribed` to stop upstream work when nobody is collecting. Update StateFlow atomically with `update { }`.

### What is variance in Kotlin generics: in, out, and star projection?
<!-- level: advanced; kind: concept; ref: https://kotlinlang.org/docs/generics.html#variance -->
Generic types are invariant by default: `List<Dog>` is not assignable to `MutableList<Animal>` for safety. Declaration-site variance marks a type parameter `out` (covariant, producer only: appears in return positions) or `in` (contravariant, consumer only: appears in parameters). `List<out E>` is read-only so `List<Dog>` is a `List<Animal>`; `Comparable<in T>` lets a `Comparable<Animal>` be used for dogs.

Use-site variance (`MutableList<out Animal>`) restricts a particular usage. Star projection `*` means unknown type: safe to read as `Any?`, not to write. Rule of thumb, the producer-extends, consumer-super idea from Java.

### What is a reified type parameter and why does it need inline?
<!-- level: advanced; kind: concept; ref: https://kotlinlang.org/docs/inline-functions.html#reified-type-parameters -->
On the JVM generic type arguments are erased at runtime. An `inline` function has its body copied to each call site, so the compiler can substitute the actual type argument; marking the parameter `reified` lets the body use `T` in `is T`, `T::class` and similar.

```kotlin
inline fun <reified T> List<*>.firstOfType(): T? = firstOrNull { it is T } as T?
val s = listOf(1, "a").firstOfType<String>()
```

Limits: reified functions cannot be called from Java, and inlining large bodies increases bytecode size. They underpin APIs like `Json.decodeFromString<T>()`.

### What does inline do, and what are noinline and crossinline?
<!-- level: advanced; kind: concept; ref: https://kotlinlang.org/docs/inline-functions.html -->
`inline` copies the function and its lambda arguments into the call site, avoiding allocation of function objects and enabling non-local `return` from lambdas. It is beneficial for small higher-order functions such as `map` or `let`. `noinline` keeps one lambda parameter as a real object, needed when you store or pass it elsewhere. `crossinline` forbids non-local returns in a lambda that is executed in another context (a different thread or nested object), where such return would be illegal.

Do not inline large functions or those without lambda parameters; the benefit disappears and code size grows.

### How do you call Kotlin from Java cleanly?
<!-- level: intermediate; kind: concept; ref: https://kotlinlang.org/docs/java-to-kotlin-interop.html -->
Use annotations to shape the bytecode: `@JvmStatic` for static methods on companions, `@JvmField` for fields, `@JvmOverloads` for default arguments, `@JvmName` to rename or avoid clashes, and `@Throws` for checked exceptions. Top-level functions compile into a class named after the file with a `Kt` suffix unless `@file:JvmName` changes it.

Properties appear as getters and setters; a `Boolean` property named `isActive` yields `isActive()`. Suspend functions are awkward from Java, so expose `CompletableFuture` or callback wrappers. Nullability annotations are emitted, helping Java tooling.

### What are lateinit and lazy, and when do you use each?
<!-- level: basic; kind: concept; ref: https://kotlinlang.org/docs/delegated-properties.html#lazy-properties -->
`lateinit var` declares a non-null mutable property initialised after construction (for example by dependency injection or in a test setup). Reading it before assignment throws `UninitializedPropertyAccessException`; check with `::prop.isInitialized`. It cannot be used on primitives or nullable types.

`by lazy { }` is a read-only property computed on first access and cached. By default it is thread-safe (synchronized); modes `PUBLICATION` and `NONE` trade safety for speed. Use `lazy` for expensive derived values, `lateinit` when something outside the class provides the value later.

### What are delegated properties and class delegation?
<!-- level: intermediate; kind: concept; ref: https://kotlinlang.org/docs/delegation.html -->
Class delegation with `by` implements an interface by forwarding to another object, an alternative to inheritance: `class Logged(repo: Repo) : Repo by repo` forwards all members and lets you override a few. Property delegation hands the getter and setter logic to an object with `getValue` and `setValue` operators; standard ones include `lazy`, `observable`, `vetoable` and `map`-backed properties.

Custom delegates centralise repeated logic such as preferences access or validation. Delegation favours composition over inheritance, which Kotlin encourages through final-by-default classes.

### What is the difference between a sequence and a list in Kotlin?
<!-- level: intermediate; kind: concept; ref: https://kotlinlang.org/docs/sequences.html -->
Collection operations are eager and create an intermediate collection per step. Sequences are lazy: stages run per element through the whole chain, only when a terminal operation executes, so they avoid intermediate lists and can stop early or represent infinite data.

Choose sequences for large data, multiple chained operations or early termination, and lists for small inputs and single operations. Operations such as `sorted` or `distinct` need to buffer, limiting laziness.

### How do data class copy, destructuring and componentN work?
<!-- level: basic; kind: concept; ref: https://kotlinlang.org/docs/destructuring-declarations.html -->
For a data class the compiler generates `component1()`, `component2()`... in constructor property order, which power destructuring declarations: `val (id, name) = user`. It also works on `Pair`, `Map.Entry` and any class providing `componentN` operator functions, including in `for` loops over maps and lambda parameters.

Because it is positional, reordering constructor parameters silently changes what destructuring binds, which is a refactoring risk; use it for small, stable types. `copy(name = "x")` creates a modified shallow copy using the same constructor parameters.

### What is the difference between object, companion object and top-level functions?
<!-- level: basic; kind: concept; ref: https://kotlinlang.org/docs/object-declarations.html -->
An `object` declaration is a thread-safe lazily initialised singleton. A `companion object` is the singleton tied to a class, holding what Java would call static members, such as factory functions and constants; it can implement interfaces. Top-level functions and properties live in a file without a class and are often the more idiomatic choice for stateless utilities.

Object expressions (`object : Runnable { }`) create anonymous instances. Singletons hurt testability when they hold state, so prefer dependency injection for services and reserve `object` for stateless or truly global values.

### What is a fun interface and how does it relate to lambdas?
<!-- level: intermediate; kind: concept; ref: https://kotlinlang.org/docs/fun-interfaces.html -->
A `fun interface` is an interface with exactly one abstract method that can be implemented with a lambda (SAM conversion), while still being a named type that can have default methods. Kotlin already converts lambdas for Java single-method interfaces; `fun interface` gives the same ability for Kotlin-defined interfaces.

```kotlin
fun interface Validator { fun validate(s: String): Boolean }
val notEmpty = Validator { it.isNotEmpty() }
```

Use a function type `(String) -> Boolean` for simple callbacks and a fun interface when you want a meaningful name, documentation, or Java-friendly API.
