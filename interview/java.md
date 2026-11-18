# Java interview questions

### What is the difference between the JDK, JRE and JVM?
<!-- level: basic; kind: concept; ref: https://docs.oracle.com/en/java/javase/21/ -->
- **JVM**: the virtual machine that runs Java bytecode (with JIT compilation and garbage collection).
- **JRE**: the JVM plus the standard class libraries — what you need to *run* Java programs.
- **JDK**: the JRE plus development tools (`javac`, `jar`, `jshell`, debugging/profiling tools) — what you need to *build* them. Modern distributions ship the JDK; `jlink` can create a trimmed runtime.

### What is the contract between `equals()` and `hashCode()`?
<!-- level: intermediate; kind: concept; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Object.html#hashCode() -->
If two objects are equal according to `equals()`, they **must** return the same `hashCode()`. (Unequal objects may share a hash code.)

Override both together, or hash-based collections break — e.g. a `HashSet` can contain "duplicates" or fail to find an object you just added. Records generate correct `equals`/`hashCode` automatically.

### How does `HashMap` work internally?
<!-- level: intermediate; kind: concept; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/HashMap.html -->
- Keys are hashed to a **bucket** index in an array.
- Collisions in a bucket are stored as a linked list; when a bucket becomes large (8 entries, with a table of at least 64), it turns into a balanced tree, keeping lookups fast.
- When size exceeds capacity × load factor (default 0.75), the table **resizes** (doubles) and entries are redistributed.
- It is not thread-safe — use `ConcurrentHashMap` for concurrent access.
- Average `get`/`put` is O(1).

### What is the difference between checked and unchecked exceptions?
<!-- level: basic; kind: concept; ref: https://docs.oracle.com/javase/tutorial/essential/exceptions/runtime.html -->
- **Checked** exceptions (subclasses of `Exception` but not `RuntimeException`, e.g. `IOException`) must be caught or declared with `throws`. They represent recoverable conditions.
- **Unchecked** exceptions (`RuntimeException` subclasses, e.g. `NullPointerException`, `IllegalArgumentException`) don't need declaring and usually indicate programming errors.
- `Error` (e.g. `OutOfMemoryError`) signals serious problems an app normally shouldn't catch.

### What are virtual threads, and when do they help?
<!-- level: advanced; kind: concept; ref: https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html -->
Virtual threads (final in Java 21) are lightweight threads managed by the JVM rather than the OS. You can create millions of them; when one blocks on I/O, its carrier OS thread is freed for others.

They help **I/O-bound, thread-per-request** servers scale with simple blocking code — no reactive frameworks needed. They do not make CPU-bound work faster, and they shouldn't be pooled.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    urls.forEach(url -> executor.submit(() -> fetch(url)));
}
```

### In Spring, what is the difference between `@Component` and `@Bean`?
<!-- level: basic; kind: concept; ref: https://docs.spring.io/spring-framework/reference/core/beans/java/bean-annotation.html -->
- `@Component` (and `@Service`, `@Repository`, `@Controller`) on a **class** lets component scanning detect it and create a bean automatically.
- `@Bean` on a **method** inside a `@Configuration` class creates a bean explicitly — useful for third-party classes you can't annotate, or when construction needs custom logic.

Prefer constructor injection for dependencies; it makes them explicit and easy to test.

### A Java service crashes with `OutOfMemoryError` in production. What do you do?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/troubleshoot/troubleshooting-memory-leaks.html -->
1. Read the exact message: `Java heap space`, `Metaspace`, `unable to create native thread` and `Direct buffer memory` point to different causes.
2. Make sure the JVM writes a dump: `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=...`; also check GC logs.
3. Analyse the heap dump with **Eclipse MAT** or VisualVM — the dominator tree shows what retains the most memory.
4. Typical causes: unbounded caches or collections, `ThreadLocal` leaks, listeners never removed, loading entire result sets into memory.
5. Fix the leak; only then tune `-Xmx` and container memory limits (the JVM respects container limits — leave headroom for non-heap memory).
