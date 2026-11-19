## 8. Modern Java Language Features

### Records
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/language/records.html -->
Records (final in Java 16) are concise, transparent carriers for immutable data. Declaring `record Point(int x, int y) {}` gives you private final fields, a canonical constructor, accessor methods `x()` and `y()`, and correct `equals`, `hashCode` and `toString`, all based on the components.

Records are implicitly final and extend `java.lang.Record`, so they cannot extend other classes, but they can implement interfaces, declare static fields and methods, add instance methods, and nest. A compact canonical constructor (no parameter list) is the idiomatic place to validate or normalise input; assignments to fields happen automatically after it runs.

Records are "shallowly immutable": a component of type `List` can still be mutated unless you copy it. They also deserialise through their canonical constructor, so validation cannot be bypassed via serialization, which fixes a long-standing class of vulnerabilities.

```java
public record Money(BigDecimal amount, String currency) {
    public Money {                                   // compact constructor
        Objects.requireNonNull(amount);
        if (amount.signum() < 0) throw new IllegalArgumentException("negative amount");
        currency = currency.toUpperCase();           // normalise before field assignment
    }

    public Money plus(Money other) {
        if (!currency.equals(other.currency)) throw new IllegalArgumentException("currency mismatch");
        return new Money(amount.add(other.amount), currency);
    }

    public static Money inr(String value) { return new Money(new BigDecimal(value), "INR"); }
}

record Cart(String id, List<String> items) {
    Cart { items = List.copyOf(items); }             // defensive copy for deep immutability
}
```

- Great for DTOs, API responses, map keys, multiple return values and local records inside a method.
- Pitfall: JPA entities need mutability and no-arg constructors, so records do not fit them; use records for projections.

### Sealed classes and interfaces
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/language/sealed-classes-and-interfaces.html -->
Sealed types (final in Java 17) let a class or interface restrict which classes may extend or implement it, using `sealed ... permits A, B, C`. Each permitted subclass must be `final`, `sealed` or `non-sealed` (explicitly reopened). Permitted subclasses must be in the same module, or the same package for unnamed modules; if they are in the same file the `permits` clause can be omitted.

Why it matters: sealed hierarchies model "one of a fixed set of alternatives", known as algebraic data types or sum types. Combined with records and pattern matching, the compiler knows every case, so a switch over a sealed type can be exhaustive without `default`. Adding a new subtype then produces compile errors at every switch that must handle it, rather than silent fall-through to a default branch at runtime.

```java
public sealed interface PaymentResult permits Approved, Declined, NeedsVerification {}

public record Approved(String transactionId) implements PaymentResult {}
public record Declined(String reason, boolean retryable) implements PaymentResult {}
public record NeedsVerification(URI challengeUrl) implements PaymentResult {}

static String describe(PaymentResult r) {
    return switch (r) {                          // exhaustive, no default
        case Approved a          -> "OK " + a.transactionId();
        case Declined d          -> "Declined: " + d.reason();
        case NeedsVerification v -> "Redirect to " + v.challengeUrl();
    };
}
```

- Sealing is about domain modelling, not security; reflection-based frameworks still work.
- Interview tip: contrast sealed types (closed set of types, open data) with enums (closed set of instances).

### Pattern matching for instanceof and switch
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/language/pattern-matching.html -->
Pattern matching lets you test a value's shape and extract from it in one step. Type patterns in `instanceof` (Java 16) remove the classic test-then-cast duplication: `if (obj instanceof String s)` binds `s` only where the test is known to be true, including in `&&` conditions and after early returns (flow scoping).

Java 21 (JEP 441) extended patterns to switch: `case` labels can be type patterns, can have guards with `when`, and can include `case null`. The compiler checks dominance (a broader pattern cannot precede a narrower one) and exhaustiveness for sealed hierarchies. Switch patterns are implemented with an `invokedynamic` bootstrap (`SwitchBootstraps.typeSwitch`), so they are efficient.

Primitive types in patterns (`case int i when i > 0`) are still a preview feature as of Java 25.

```java
static String format(Object value) {
    return switch (value) {
        case null -> "null";
        case Integer i when i < 0 -> "negative " + (-i);
        case Integer i -> "int " + i;
        case String s when s.isBlank() -> "blank string";
        case String s -> "\"" + s + "\"";
        case List<?> list -> "list of " + list.size();
        default -> value.getClass().getSimpleName();
    };
}

if (!(shape instanceof Circle c)) return 0;
return Math.PI * c.radius() * c.radius();      // c in scope after the negated early return
```

- Pitfall: putting `case Integer i` before `case Integer i when i < 0` is a dominance compile error.
- Pattern switch is the idiomatic replacement for the visitor pattern on closed hierarchies.

### Record patterns and deconstruction
<!-- level: advanced; ref: https://docs.oracle.com/en/java/javase/21/language/record-patterns.html -->
Record patterns (final in Java 21, JEP 440) let you destructure a record directly in `instanceof` or `switch`, matching its type and binding its components in one go. Patterns can nest, so you can match deep structures declaratively, and you can use `var` for component types.

Under the hood, matching calls the record's accessor methods, so it works only with records (whose components are known), not arbitrary classes. Combined with sealed interfaces, this enables data-oriented programming: data is modelled as plain immutable records, and operations are switches over them, similar to languages like Scala, Kotlin or Haskell.

Java 22 added the unnamed pattern `_` to ignore components you do not need.

```java
sealed interface Expr permits Num, Add, Mul, Neg {}
record Num(int value) implements Expr {}
record Add(Expr left, Expr right) implements Expr {}
record Mul(Expr left, Expr right) implements Expr {}
record Neg(Expr expr) implements Expr {}

static int eval(Expr e) {
    return switch (e) {
        case Num(int v) -> v;
        case Add(Num(var a), Num(var b)) -> a + b;          // nested fast path
        case Add(var l, var r) -> eval(l) + eval(r);
        case Mul(Num(int z), _) when z == 0 -> 0;          // Java 22+ unnamed pattern
        case Mul(var l, var r) -> eval(l) * eval(r);
        case Neg(var inner) -> -eval(inner);
    };
}

if (obj instanceof Point(int x, int y) && x == y) System.out.println("on diagonal");
```

- Pitfall: record patterns do not match null components in nested positions unless the nested pattern is a `var` or type pattern that allows it; keep data null-free.
- Interview tip: be able to explain data-oriented programming as a complement to classic OOP.

### Unnamed variables and patterns
<!-- level: basic; ref: https://docs.oracle.com/en/java/javase/22/language/unnamed-variables-and-patterns.html -->
Java 22 (JEP 456, final) made the underscore `_` a placeholder for variables and patterns you must declare but never use. Before this you had to invent names like `ignored` or `unused`, which linters and readers then had to second-guess.

You can use `_` for local variables, for-loop variables, catch parameters, lambda parameters, try-with-resources variables, and in patterns (`case Point(int x, _)`). Multiple `_` declarations can coexist in the same scope because they are not real names; you cannot read from `_`.

It also allows several patterns in one case label when none of them bind variables: `case Circle _, Square _ ->`.

```java
int count = 0;
for (Order _ : orders) count++;                  // only counting

try {
    Integer.parseInt(input);
} catch (NumberFormatException _) {              // exception object not needed
    return false;
}

map.forEach((_, value) -> process(value));       // key unused

String kind = switch (shape) {
    case Circle _, Ellipse _ -> "round";
    case Square _, Rectangle _ -> "angular";
};

var queue = new ArrayDeque<String>();
var _ = queue.poll();                            // side effect only
```

- Version note: requires Java 22+, so it is usable on the Java 25 LTS but not on Java 21 without preview flags.
- `_` as an identifier has been illegal since Java 9, so old code using it as a name will not compile.

### The module system (JPMS)
<!-- level: advanced; ref: https://dev.java/learn/modules/ -->
The Java Platform Module System (Java 9) groups packages into named modules described by `module-info.java`. A module declares what it `requires` (dependencies), which packages it `exports` (public API), which it `opens` for deep reflection, and which services it `uses` or `provides`.

Modules give strong encapsulation: public classes in non-exported packages are inaccessible to other modules, even through reflection (since JDK 16/17 the JDK's own internals are strongly encapsulated, which is why old libraries needed `--add-opens`). Dependencies are verified at startup, eliminating missing-JAR surprises and split packages. The JDK itself is split into about 70 modules, so `jlink` can build a minimal custom runtime image containing only the modules your app uses, which is great for containers.

```java
// src/main/java/module-info.java
module com.acme.orders {
    requires java.net.http;
    requires transitive com.acme.common;     // consumers of orders also see common
    exports com.acme.orders.api;             // only the API package is visible
    opens com.acme.orders.dto to com.fasterxml.jackson.databind; // reflection for Jackson
    provides com.acme.common.Plugin with com.acme.orders.OrdersPlugin;
}
```

```bash
jlink --add-modules com.acme.orders --module-path mods:$JAVA_HOME/jmods \
      --strip-debug --no-header-files --output runtime
```

- Reality check: most Spring Boot apps still run on the classpath (the "unnamed module"); JPMS is most valuable for libraries and for `jlink` images.
- Java 25 adds `import module M;` (JEP 511), which just imports all exported packages and does not require your code to be modular.

### What changed between Java 21 and Java 25
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/25/ -->
Java 25 (September 2025) is the LTS after Java 21. Features finalised in 22 to 25 that you can use on 25:
- Unnamed variables and patterns `_` (22).
- Launching multi-file source programs (22).
- Foreign Function and Memory API (22), the safe replacement for JNI and `sun.misc.Unsafe` memory access.
- Markdown documentation comments with `///` (23).
- Stream gatherers (24), class-file API (24).
- Synchronizing virtual threads without pinning (24): `synchronized` no longer pins a virtual thread to its carrier.
- Ahead-of-time class loading and linking (24) plus AOT command-line ergonomics and method profiling (25), for faster startup.
- Compact source files and instance main methods, module imports, flexible constructor bodies, scoped values (all 25).
- Compact object headers become a product option (25), `-XX:+UseCompactObjectHeaders`.

Still preview or incubating in 25: structured concurrency, primitive types in patterns, the Vector API, stable values. Removed or restricted: the Security Manager is permanently disabled (24), the 32-bit x86 port was removed (25), and `sun.misc.Unsafe` memory methods warn on use.

```java
// Java 25, flexible constructor body plus scoped value
private static final ScopedValue<String> REQUEST_ID = ScopedValue.newInstance();

ScopedValue.where(REQUEST_ID, "req-42").run(() -> handler.handle(request));
```

- Interview tip: preview features need `--enable-preview` at compile and run time and may change; do not ship them in production libraries.

## 9. JVM Internals: Memory, GC and Performance

### Class loading
<!-- level: advanced; ref: https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-5.html -->
The JVM loads classes lazily, the first time they are needed. Loading has three phases: loading (find the bytes and create a `Class` object), linking (verification of bytecode safety, preparation of static fields with default values, and optional resolution of symbolic references), and initialization (running static initialisers, exactly once, under a lock).

Class loaders form a hierarchy: the bootstrap loader (core `java.base` classes), the platform loader (other JDK modules), and the application (system) loader (your classpath). Loaders delegate to their parent first, so application code cannot replace `java.lang.String`. A class's identity is its name plus its defining loader, so the same class loaded by two loaders is two different types, the source of the puzzling "`ClassCastException`: Foo cannot be cast to Foo".

Application servers, plugin systems and hot-reload tools (Spring DevTools) create custom class loaders. A class loader and all its classes can only be garbage-collected when nothing references any of them.

```java
ClassLoader appLoader = MyService.class.getClassLoader();
System.out.println(appLoader);                         // jdk.internal.loader.ClassLoaders$AppClassLoader
System.out.println(String.class.getClassLoader());    // null = bootstrap

try (var loader = new URLClassLoader(new URL[]{pluginJar.toUri().toURL()}, appLoader)) {
    Class<?> plugin = loader.loadClass("com.vendor.Plugin");
    var instance = plugin.getDeclaredConstructor().newInstance();
}
```

- Pitfall: class loader leaks in redeployed web apps (a thread or `ThreadLocal` referencing an app class pins the whole loader) cause `OutOfMemoryError: Metaspace`.
- Diagnostics: `-Xlog:class+load` shows each class as it loads.

### Runtime memory areas: heap, stacks and metaspace
<!-- level: intermediate; ref: https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-2.html -->
The JVM divides memory into several areas:
- Heap: shared by all threads; holds all objects and arrays. Sized with `-Xms`/`-Xmx` or, better in containers, `-XX:MaxRAMPercentage`. Managed by the garbage collector.
- Thread stacks: one per platform thread, containing frames with local variables, operand stacks and return addresses. Sized with `-Xss` (often 1 MB default reserve). Deep recursion overflows it with `StackOverflowError`. Virtual threads keep their stacks on the heap as resizable chunks.
- Metaspace: class metadata (method bytecode, constant pools) in native memory. Grows dynamically; cap it with `-XX:MaxMetaspaceSize`.
- Code cache: JIT-compiled native code.
- Direct (off-heap) memory: `ByteBuffer.allocateDirect` and Netty buffers, limited by `-XX:MaxDirectMemorySize`.
- Also GC data structures, thread-local allocation buffers and native library allocations.

This is why a JVM with `-Xmx2g` can use 3 GB of RSS, and why containers get OOM-killed when the limit equals the heap size.

```bash
java -XX:MaxRAMPercentage=75 -XX:NativeMemoryTracking=summary -jar app.jar
jcmd <pid> VM.native_memory summary     # breakdown of heap, class, thread, code, GC...
jcmd <pid> GC.heap_info
```

- Escape analysis can allocate short-lived objects on the stack conceptually (scalar replacement), so not every `new` hits the heap.
- Interview tip: name the specific `OutOfMemoryError` messages and which area each refers to.

### JIT compilation and tiered compilation
<!-- level: advanced; ref: https://docs.oracle.com/en/java/javase/21/docs/specs/man/java.html -->
HotSpot starts by interpreting bytecode, profiles what actually happens (which branches are taken, which types appear at call sites), then compiles hot methods to native code. Tiered compilation uses two compilers: C1 compiles quickly with light optimisation and inserts profiling; C2 later recompiles the hottest code with aggressive, profile-guided optimisations (inlining, escape analysis, loop unrolling, vectorisation, lock elision).

C2 makes speculative assumptions, for example "this interface call only ever sees `ArrayList`". If a new type shows up, the JVM deoptimises: it discards the compiled code, goes back to the interpreter, and recompiles later. This is why Java performance improves over the first seconds or minutes (warm-up) and why microbenchmarks without warm-up lie.

On-stack replacement (OSR) lets a long-running loop switch to compiled code mid-execution.

```bash
java -XX:+PrintCompilation -jar app.jar | head      # see methods being compiled
java -Xlog:jit+compilation=debug -jar app.jar
# JMH handles warm-up, dead-code elimination and forks correctly
mvn archetype:generate -DarchetypeGroupId=org.openjdk.jmh -DarchetypeArtifactId=jmh-java-benchmark-archetype
```

- Pitfall: benchmarking with `System.nanoTime()` around one call measures the interpreter, and the JIT may eliminate code whose result is unused.
- GraalVM Native Image takes the opposite approach, ahead-of-time compilation with no JIT: instant startup and small memory, but lower peak throughput and closed-world constraints on reflection.

### Garbage collection fundamentals
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/gctuning/introduction-garbage-collection-tuning.html -->
The garbage collector reclaims memory from objects that are no longer reachable. Reachability starts at GC roots: local variables in active stack frames, static fields, JNI references, and active threads. Anything not reachable from a root is garbage, so reference cycles are collected fine (unlike reference counting).

Most collectors are generational, based on the weak generational hypothesis: most objects die young. New objects are allocated cheaply in the young generation (Eden) by bumping a pointer in a thread-local allocation buffer. A minor GC copies surviving objects to survivor spaces; objects surviving several cycles are promoted to the old generation. Because few objects survive, young collections are fast. Old-generation collection is more expensive.

Collectors work with combinations of mark (find live objects), sweep or copy/compact (reclaim and defragment). Stop-the-world pauses halt application threads; concurrent collectors do most work alongside the application, using barriers to track reference changes.

```bash
# Unified GC logging (Java 9+): essential in production
java -Xlog:gc*:file=gc.log:time,uptime,level,tags:filecount=5,filesize=20m -jar app.jar
jstat -gcutil <pid> 1000      # live occupancy and GC counts every second
```

- Pitfall: calling `System.gc()` is only a hint and usually harmful; frameworks sometimes call it, so `-XX:+DisableExplicitGC` exists.
- High allocation rate, not just heap size, drives GC frequency; reducing garbage is often the best tuning.

### Choosing and tuning a garbage collector
<!-- level: advanced; ref: https://docs.oracle.com/en/java/javase/21/gctuning/available-collectors.html -->
HotSpot ships several collectors with different trade-offs between throughput, latency and memory footprint:
- G1 (default since Java 9): region-based, generational, mostly concurrent marking, with a pause-time goal (`-XX:MaxGCPauseMillis`, default 200 ms). A good balance for most services.
- ZGC (production since 15; generational since 21 via JEP 439, the only mode since 24): concurrent compaction using coloured pointers and load barriers; pauses typically under a millisecond regardless of heap size. Costs some CPU and memory headroom. Ideal for latency-sensitive services and large heaps.
- Shenandoah: also concurrent compaction (available in OpenJDK builds; generational mode is a product feature in 25).
- Parallel: maximises throughput with stop-the-world multi-threaded collection; good for batch jobs.
- Serial: single-threaded, smallest footprint; the JVM picks it automatically on tiny containers (under about 2 CPUs or 1792 MB).

Tuning approach: set the heap size properly first, pick the collector for your goal, enable GC logs, then change one flag at a time and measure. Modern collectors need few flags.

```bash
java -XX:+UseZGC -Xmx16g -jar trading-api.jar          # low latency
java -XX:+UseParallelGC -Xmx8g -jar nightly-batch.jar  # throughput
java -XX:+UseG1GC -XX:MaxGCPauseMillis=100 -XX:MaxRAMPercentage=75 -jar service.jar
```

- Pitfall: copying ancient CMS-era flag lists into Java 21 command lines; CMS was removed in Java 14.
- Interview tip: describe GC choice in terms of latency, throughput and footprint, the classic triangle.

### Reference types and memory leaks
<!-- level: advanced; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/ref/package-summary.html -->
Java has no manual `free`, but it can still leak: a leak is an object that is reachable yet no longer needed. Common culprits are static collections that only grow, caches without eviction, listeners or callbacks never deregistered, `ThreadLocal` values in pooled threads, inner classes holding outer instances, and unclosed resources.

`java.lang.ref` offers weaker reference types to cooperate with the GC:
- `SoftReference`: cleared only under memory pressure. Tempting for caches but hard to control; prefer a bounded cache such as Caffeine.
- `WeakReference`: cleared at the next GC once only weakly reachable. `WeakHashMap` uses weak keys to attach metadata to objects without keeping them alive.
- `PhantomReference` with `Cleaner` (Java 9): run cleanup after an object becomes unreachable; the replacement for the deprecated `finalize()`.

```java
public final class NativeBuffer implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();
    private final Cleaner.Cleanable cleanable;

    public NativeBuffer(long address) {
        // The state object must not reference 'this', or the buffer never becomes unreachable
        this.cleanable = CLEANER.register(this, new FreeAction(address));
    }
    private record FreeAction(long address) implements Runnable {
        public void run() { Native.free(address); }
    }
    @Override public void close() { cleanable.clean(); }   // explicit close is primary
}
```

- Diagnose leaks with heap dumps (`jcmd <pid> GC.heap_dump`) and Eclipse MAT's dominator tree, or with JFR's Old Object Sample event.
- Pitfall: `WeakHashMap` values that reference their own keys keep the keys alive forever.

### The Java Memory Model and happens-before
<!-- level: advanced; ref: https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html#jls-17.4 -->
The Java Memory Model (JMM) defines when a write by one thread is guaranteed to be visible to a read by another. Without that guarantee, compilers, the JIT and CPUs are free to reorder instructions and keep values in registers or caches, so a thread can see stale data, or see a reference to an object before its fields are written.

The key concept is the happens-before relation. If action A happens-before B, then A's effects are visible to B. Happens-before edges come from:
- program order within a single thread;
- unlocking a monitor before a later lock of the same monitor;
- a write to a `volatile` field before a later read of it;
- `Thread.start()` before anything in the started thread, and everything in a thread before another thread's successful `join()`;
- concurrency utilities (putting into a `BlockingQueue`, completing a `Future`), as documented;
- the end of a constructor before final fields are read (final-field semantics).

Happens-before is transitive. A program with no data races (every conflicting access ordered by happens-before) behaves as if sequentially consistent.

```java
class Worker implements Runnable {
    private volatile boolean running = true;   // without volatile the loop may never stop
    public void stop() { running = false; }
    public void run() { while (running) { doWork(); } }
}
```

- Classic bug: double-checked locking without `volatile` can publish a partially constructed object.
- Interview tip: say "visibility and ordering" not just "atomicity"; `volatile` gives the first two, not compound atomicity.

### Startup time: CDS, AOT cache and native images
<!-- level: advanced; ref: https://docs.oracle.com/en/java/javase/21/vm/class-data-sharing.html -->
JVM startup involves loading, verifying and linking thousands of classes, then running in the interpreter until the JIT warms up. That is fine for long-lived servers but painful for CLIs, serverless functions and fast-scaling containers.

Options, from least to most invasive:
- Class Data Sharing (CDS): the JDK ships a default archive of core classes. AppCDS archives your application classes too (`-XX:ArchiveClassesAtExit`, then `-XX:SharedArchiveFile`), memory-mapping pre-parsed metadata so it can be shared across processes.
- AOT cache (Java 24 JEP 483, simplified in Java 25 by JEP 514 and enriched with method profiles by JEP 515): a training run records loaded and linked classes and profiling data into a cache; production runs start with classes already loaded and linked and the JIT warmed by profiles. Reported startup improvements are often 40% or more with no code changes.
- CRaC (Coordinated Restore at Checkpoint, in some distributions): snapshot a warmed-up JVM and restore it.
- GraalVM Native Image: compile ahead of time into a standalone binary; tens of milliseconds startup, but requires reachability metadata for reflection and has lower peak performance.
- Framework level: Spring Boot AOT processing, lazy initialisation, fewer classpath scans.

```bash
# Java 25: one-step training run creating an AOT cache
java -XX:AOTCacheOutput=app.aot -jar app.jar --train
java -XX:AOTCache=app.aot -jar app.jar
```

- Pitfall: the cache must be created with the same JDK build and classpath as production.
