# Java scenario questions

### Kubernetes keeps OOM-killing your Java pod, yet heap graphs show only 60% usage. What is going on?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/troubleshoot/diagnostic-tools.html -->
Answer:

1. Observe: an OOMKill (exit code 137) is the kernel enforcing the container memory limit on the whole process RSS, not a Java `OutOfMemoryError`. The heap is only one part of the JVM's memory.
2. Hypothesise: non-heap memory is pushing RSS over the limit. Candidates are metaspace, thread stacks (hundreds of platform threads at about 1 MB each), the JIT code cache, GC structures, direct buffers (Netty, NIO), and native allocations by libraries (compression, JNI, glibc malloc arenas).
3. Verify: start with `-XX:NativeMemoryTracking=summary` and run `jcmd <pid> VM.native_memory summary`, then take a baseline and a `summary.diff` later to see which category grows. Compare with container RSS. Memory not shown by NMT (for example glibc arenas) shows up as the gap between NMT committed and RSS.
4. Fix: size the heap relative to the limit with `-XX:MaxRAMPercentage=70` (not 100%), cap direct memory with `-XX:MaxDirectMemorySize`, reduce thread counts or switch I/O-bound work to virtual threads, set `MALLOC_ARENA_MAX=2` if arenas explode, and fix any genuine native leak (unclosed `Inflater`/`Deflater`, Netty buffer leaks; enable `-Dio.netty.leakDetection.level=paranoid` in test).
5. Prevent: alert on container RSS as well as heap, and load-test with production-like limits.

```bash
java -XX:MaxRAMPercentage=70 -XX:NativeMemoryTracking=summary -jar app.jar
jcmd 1 VM.native_memory baseline
jcmd 1 VM.native_memory summary.diff
```

Common wrong answer: "increase `-Xmx`". That makes things worse, because it leaves even less room for non-heap memory inside the same limit.

### After every hot redeploy of your app in a shared application server, memory grows until `OutOfMemoryError: Metaspace`. How do you fix it?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/troubleshoot/troubleshooting-memory-leaks.html -->
Answer:

1. Observe: metaspace holds class metadata. Each redeploy creates a new class loader and loads all classes again; the old loader and its classes can be unloaded only if nothing references any of them. The error therefore means old class loaders are being pinned.
2. Hypothesise typical pins: a thread started by the app that keeps running (a scheduler, a JDBC driver cleanup thread), `ThreadLocal` values left in container worker threads, JDBC drivers registered in `DriverManager`, static caches in a parent class loader holding app objects, shutdown hooks, MBeans and logging frameworks.
3. Verify: run `jcmd <pid> VM.classloader_stats` or `jcmd <pid> GC.class_stats`-style tools to see loader counts growing, take a heap dump after two or three redeploys, and in Eclipse MAT find duplicate instances of your web-app class loader and use "Path to GC roots, excluding weak references" to see exactly who holds the old one.
4. Fix: stop executors and threads in a shutdown callback (`@PreDestroy`, `ServletContextListener.contextDestroyed`), call `ThreadLocal.remove()` in `finally` blocks, deregister JDBC drivers you registered, and close resources.
5. Prevent: set `-XX:MaxMetaspaceSize` so leaks fail fast instead of eating host memory, and add a redeploy-loop test in CI.

```java
@PreDestroy
void shutdown() {
    scheduler.shutdownNow();
    DriverManager.drivers().filter(d -> d.getClass().getClassLoader() == getClass().getClassLoader())
                 .forEach(d -> { try { DriverManager.deregisterDriver(d); } catch (SQLException ignored) {} });
}
```

Trade-off: the most robust fix is to avoid in-place hot redeploys entirely and replace the whole JVM (immutable containers), which is why modern deployments rarely see this bug.

### Every few hours your service stops responding: requests time out, CPU is near zero, and the process is alive. How do you investigate?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/specs/man/jcmd.html -->
Answer:

Low CPU plus no progress means threads are waiting, not working: a deadlock, a lock held during slow I/O, pool exhaustion, or calls blocked without timeouts.

1. Observe: capture three thread dumps about ten seconds apart before restarting: `jcmd <pid> Thread.print -l > dump1.txt` (or `jstack -l`). For virtual threads use `jcmd <pid> Thread.dump_to_file -format=json dump.json`.
2. Look for "Found one Java-level deadlock" at the end; the JVM detects monitor and `ReentrantLock` cycles automatically and prints both stacks.
3. If there is no deadlock, group threads by state and stack. Many threads `WAITING` in `HikariPool.getConnection` means pool exhaustion; many in `SocketInputStream.read` means a downstream without read timeouts; many `BLOCKED` on the same monitor means one thread holds a lock while doing something slow. Identical stacks across dumps confirm they are stuck, not just busy.
4. Fix deadlocks by acquiring locks in a consistent order, shrinking critical sections, never calling remote services or callbacks while holding a lock, or using `tryLock` with a timeout. Fix hangs by adding connect and read timeouts to every client and bounding pools.
5. Prevent: monitor thread-pool active and queue metrics, and enable `-XX:+HeapDumpOnOutOfMemoryError` plus periodic JFR recordings so evidence exists next time.

```java
Lock first = a.id() < b.id() ? a.lock() : b.lock();
Lock second = first == a.lock() ? b.lock() : a.lock();
```

Common wrong answer: "restart and add more threads". Without dumps the evidence is lost, and more threads often deepen contention.

### One JVM process is pinned at 100% CPU in production. How do you find which code is burning it?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/specs/man/jfr.html -->
Answer:

1. Observe whether it is application threads or GC. GC logs or `jstat -gcutil <pid> 1000` show whether the collector is running constantly. A heap that is nearly full makes the GC thrash, burning CPU while reclaiming almost nothing; that is a memory problem in disguise.
2. If it is application code, find the hot threads: `top -H -p <pid>` lists OS threads by CPU; convert the thread id to hex and find the matching `nid=0x...` in a `jcmd <pid> Thread.print` dump. Repeat a few times to see a consistent stack.
3. Better, profile with low overhead: start a Java Flight Recorder recording (`jcmd <pid> JFR.start duration=60s filename=cpu.jfr`) and open it in JDK Mission Control for the hot-methods view, or use async-profiler to produce a flame graph.
4. Typical culprits: an infinite loop caused by concurrent modification of a `HashMap` (older JDKs could loop forever on corrupted buckets), catastrophic regex backtracking on user input, a busy-wait polling loop, excessive logging or JSON serialisation, or retry loops without backoff.
5. Fix the root cause, then add a regression test or benchmark. For regex, rewrite the pattern or bound input size.

```bash
top -H -p 4242                         # thread 4317 at 98%
printf '%x\n' 4317                     # 10dd
jcmd 4242 Thread.print | grep -A 20 'nid=0x10dd'
```

Trade-off: thread dumps are free but statistical guesses; JFR or async-profiler give real sampling data with typically under 2% overhead and are safe in production.

### p99 latency spikes to two seconds every few minutes, and GC logs show long pauses. What do you do?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/gctuning/garbage-first-g1-garbage-collector1.html -->
Answer:

1. Observe: correlate latency spikes with GC log events (`-Xlog:gc*`). Identify the pause type: G1 young pauses, mixed collections, or a full GC. A "Pause Full (Allocation Failure)" or "to-space exhausted" in G1 means the collector could not keep up.
2. Hypothesise: the heap is too small for the live set, the allocation rate is huge, humongous objects (objects of half a region or larger) are fragmenting G1, or something calls `System.gc()`.
3. Verify with JFR allocation profiling to see who allocates most, and a heap histogram (`jcmd <pid> GC.class_histogram`) to see the live set. Check for "Humongous" allocations in the logs.
4. Fix, in order of impact:
   - Reduce allocation: reuse buffers, avoid building huge strings or lists, stream large responses.
   - Right-size the heap so the live set uses well under half, and set `-Xms` equal to `-Xmx` to avoid resize pauses.
   - For G1, raise the region size (`-XX:G1HeapRegionSize`) if big arrays are humongous, or tune `MaxGCPauseMillis` modestly.
   - If latency matters more than a few percent of CPU, switch to generational ZGC (`-XX:+UseZGC`, Java 21+), which keeps pauses under a millisecond.
5. Prevent: alert on GC pause time and allocation rate, and load-test with realistic data.

Common wrong answers: adding dozens of copy-pasted GC flags, or calling `System.gc()` during quiet periods. Also check the pauses are really GC: safepoint logs (`-Xlog:safepoint`) can reveal non-GC stop-the-world pauses, and container CPU throttling can masquerade as GC slowness.

### A Spring Boot service takes 70 seconds to start in Kubernetes and pods get killed by the liveness probe. How do you speed it up?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/vm/class-data-sharing.html -->
Answer:

1. Stabilise first: add a `startupProbe` so liveness checks do not kill a pod that is still starting. Use the actuator liveness and readiness groups rather than a deep health check.
2. Measure where time goes: Spring Boot's `ApplicationStartup` (`BufferingApplicationStartup` and the `/actuator/startup` endpoint) shows slow bean initialisations; JFR shows class loading and CPU. Check CPU limits: a pod limited to 0.5 CPU starts the JVM, JIT and GC threads extremely slowly, and throttling is often the main cause.
3. Typical fixes:
   - Remove work from startup: cache warming, remote calls, Flyway migrations on large schemas, eager Hibernate validation. Move them to background tasks or separate jobs.
   - Narrow component scanning and drop unused starters.
   - Use `spring.main.lazy-initialization=true` selectively (it shifts cost to the first request).
   - Give more CPU during startup (higher limit or no CPU limit, keep the request).
4. JVM-level: enable AppCDS (`-XX:SharedArchiveFile`, which Spring Boot 3.3+ can generate) or on Java 24/25 an AOT cache (`-XX:AOTCacheOutput` training run, then `-XX:AOTCache`), often cutting startup by 30 to 50%. Spring AOT plus GraalVM native image gives sub-second start at the cost of build complexity and reflection limits.
5. Prevent: track startup time as a CI metric.

Trade-off: native images start fastest but have slower peak throughput and long builds; CDS and AOT caches are low-risk wins with no code changes.

### You are asked to migrate a large codebase from Java 8 to Java 21 or 25. How do you plan it?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/migrate/getting-started.html -->
Answer:

1. Inventory: list the build tools, plugins, frameworks and libraries with their minimum Java versions. The biggest blockers are usually old Spring (Boot 3 needs Java 17 and Jakarta EE), old Hibernate, bytecode libraries (ByteBuddy, ASM, cglib, Lombok, Mockito), and anything using internal JDK APIs.
2. Scan: run `jdeps --jdk-internals` to find uses of internal APIs such as `sun.misc.BASE64Encoder`. Search for removed modules: Java EE and CORBA modules (`javax.xml.bind`, `javax.activation`, JAX-WS) left the JDK in Java 11 and must be added as dependencies; Nashorn was removed in 15; the Security Manager is disabled in 24.
3. Upgrade in steps: first run the existing bytecode on the new JDK (runtime first), fix `--add-opens` issues caused by strong encapsulation (Java 16/17), then compile with `--release 21`. Upgrading to 11 then 17 then 21 one at a time is often easier than a single jump.
4. Watch behaviour changes: G1 default GC (since 9) with different memory profile, container-aware ergonomics, UTF-8 default charset (18), removal of the `javax` to `jakarta` package names when moving to Spring Boot 3, and stricter TLS defaults.
5. Test: full regression and performance tests with GC logs; canary deploy.
6. Modernise afterwards, not during: records, switch expressions, text blocks, virtual threads.

Common wrong answer: "just change the version in the pom". Library compatibility, not the language, is where migrations fail. Pick an LTS (21 or 25) target, and plan for regular upgrades afterwards so the next jump is small.

### Your team wants to switch a Tomcat-based service to virtual threads. What do you check before and after?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html -->
Answer:

1. Check fit: virtual threads help when requests spend most time blocked on I/O (database, HTTP calls) and the platform thread pool is the bottleneck. They do nothing for CPU-bound work.
2. Prerequisites: Java 21+ (better 24+, where `synchronized` no longer pins carriers), Spring Boot 3.2+ (`spring.threads.virtual.enabled=true`) and up-to-date drivers that do not block inside `synchronized` or native code.
3. Find the real limits: with platform threads, the 200-thread pool silently limited concurrency. With virtual threads, ten thousand requests can now hit the database at once. The connection pool becomes the throttle, so expect waits on `getConnection` and set pool timeouts deliberately. Add `Semaphore`s for rate-limited downstream APIs.
4. Look for pinning and thread-local abuse: on Java 21 to 23 run with JFR and watch `jdk.VirtualThreadPinned` events; replace `synchronized` around I/O with `ReentrantLock`. Audit `ThreadLocal` caches (for example per-thread buffers or `SimpleDateFormat`), which multiply with millions of threads.
5. Do not pool virtual threads, and do not set small executor sizes.
6. Load-test and compare throughput, latency, heap usage (stacks live on the heap now) and downstream load.

```java
private final Semaphore partnerApiPermits = new Semaphore(50);
Quote quote() throws InterruptedException {
    partnerApiPermits.acquire();
    try { return partnerClient.fetchQuote(); } finally { partnerApiPermits.release(); }
}
```

Common wrong answer: "it makes everything faster". It increases concurrency; whether that helps depends on what is downstream.

### Your service calls a slow partner API and now all request threads are busy, so even health checks time out. How do you contain it?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/java/net/http/HttpRequest.Builder.html -->
Answer:

This is cascading failure: one slow dependency consumes a shared resource (request threads) and takes down unrelated features.

1. Observe: thread dumps show most worker threads in socket reads to the partner. Metrics show partner latency rising before your errors.
2. Immediate containment: set aggressive timeouts. Every client needs a connect timeout and a request or read timeout based on the dependency's SLA, plus an overall deadline per request. Without them threads wait indefinitely.
3. Isolate (bulkhead): limit concurrent calls to the partner with a dedicated bounded executor or a `Semaphore`, so at most N threads can be stuck there and other endpoints keep working.
4. Fail fast with a circuit breaker (Resilience4j): after a failure-rate threshold, stop calling the partner for a cool-down and return a fallback (cached data, degraded response, or a 503 with `Retry-After`).
5. Retry carefully: only idempotent calls, few attempts, exponential backoff with jitter, and inside the overall deadline. Naive retries multiply load on an already struggling service.
6. Prevent: separate health endpoints from business threads (management port), and run chaos tests that inject latency.

```java
CircuitBreaker cb = CircuitBreaker.ofDefaults("partner");
Bulkhead bulkhead = Bulkhead.of("partner", BulkheadConfig.custom().maxConcurrentCalls(20).build());
Supplier<Quote> call = Decorators.ofSupplier(partner::quote)
        .withCircuitBreaker(cb).withBulkhead(bulkhead)
        .withFallback(List.of(Exception.class), e -> Quote.cached())
        .decorate();
```

Common wrong answer: increasing the thread pool size, which simply lets more threads pile up behind the same slow dependency.

### Under load the logs fill with "HikariPool-1 - Connection is not available, request timed out after 30000ms". How do you troubleshoot?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/javase/tutorial/jdbc/basics/connecting.html -->
Answer:

1. Observe: the pool had no free connection for 30 seconds. Either connections are held too long, leaked (never returned), or demand truly exceeds supply. Check pool metrics (active, idle, pending), database session counts and slow-query logs.
2. Hypotheses and how to verify:
   - Leak: some code path gets a connection without closing it. Enable `leakDetectionThreshold` (for example 20 s); Hikari logs the stack trace of where the leaked connection was borrowed.
   - Long transactions: `@Transactional` methods that call remote APIs, send emails or process large files while holding the connection. Thread dumps show threads inside HTTP calls with an open transaction.
   - Slow queries: missing index, lock waits. Check the database's active sessions and execution plans.
   - Over-concurrency: virtual threads or a huge thread pool sending more simultaneous queries than the pool size.
3. Fix: close resources with try-with-resources, shrink transactional boundaries so remote calls happen outside them, add indexes, and add timeouts (`spring.jpa.properties.jakarta.persistence.query.timeout`, statement timeouts).
4. Size the pool deliberately. A bigger pool often makes things worse because the database itself saturates; the HikariCP guidance is a small pool, roughly cores times two plus spindles, as a starting point. Also check `spring.jpa.open-in-view`: when true (the default) it keeps a connection for the whole web request, including view rendering.
5. Prevent: alert on pending connection count and connection acquisition time.

Common wrong answer: raising `maximumPoolSize` to 500. That moves the bottleneck to the database and can bring it down for every service sharing it.

### A REST endpoint returning 50 orders takes 3 seconds; SQL logs show hundreds of queries. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/javase/tutorial/jdbc/basics/index.html -->
Answer:

This is the N+1 select problem: one query loads the orders and then lazy loading fires one extra query per order for each association (lines, customer, shipments).

1. Observe: enable SQL logging in a test environment (`spring.jpa.show-sql` or better a datasource proxy that counts queries) and Hibernate statistics. Hundreds of near-identical `select ... where order_id=?` queries confirm it.
2. Identify which associations are accessed, often hidden in the DTO mapping or in Jackson serialising an entity directly.
3. Fix options:
   - A fetch join for the specific use case: `select o from Order o join fetch o.lines where o.customerId = :c`.
   - An `@EntityGraph(attributePaths = {"lines", "customer"})` on the repository method.
   - Batch fetching (`hibernate.default_batch_fetch_size=50`), which turns N queries into N/50 `IN` queries. Good when you cannot change all call sites.
   - Projections or a dedicated query returning DTO records with just the columns needed.
4. Beware the trade-offs: fetch-joining two collections creates a Cartesian product (and Hibernate refuses multiple bag fetches); joins combined with pagination make Hibernate paginate in memory with a warning. In those cases, page the parent ids first, then fetch children with `IN`.
5. Prevent: add tests asserting the query count for critical endpoints, and turn off `open-in-view` so lazy loading outside transactions fails loudly rather than silently issuing queries.

```java
@EntityGraph(attributePaths = {"lines", "customer"})
List<Order> findByCustomerId(String customerId);
```

Common wrong answer: making associations `EAGER`, which fixes this endpoint and loads huge object graphs everywhere else.

### Production logs occasionally show `ConcurrentModificationException` from a class nobody thinks is shared. How do you approach it?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ConcurrentModificationException.html -->
Answer:

1. Read the stack trace: it shows where iteration happened (the `next()` call), not where the modification happened. Find every place that mutates the same collection.
2. Two possible causes:
   - Single-threaded: code modifies the collection while iterating it, for example a listener that unregisters itself during event dispatch, or a for-each loop calling a method that removes elements. This is deterministic for a given input and reproducible in a unit test.
   - Multi-threaded: the collection is shared, typically because it lives in a singleton Spring bean, a static field, or a cached object returned to several requests. Intermittency strongly suggests this.
3. Verify by searching for the field's references and checking the bean's scope. For the threaded case, a stress test with many concurrent calls usually reproduces it.
4. Fix:
   - Single-threaded: use `Iterator.remove`, `removeIf`, or iterate over a copy.
   - Shared state: avoid it (make the bean stateless, create collections per request), or use immutable snapshots (`List.copyOf`), `CopyOnWriteArrayList` for read-mostly listener lists, or `ConcurrentHashMap`.
5. Important: the CME is the lucky outcome. The same race elsewhere can silently corrupt data without any exception, so audit other mutable state in the same class.

```java
private final List<Listener> listeners = new CopyOnWriteArrayList<>();
void fire(Event e) { for (Listener l : listeners) l.on(e); }   // safe even if l unregisters itself
```

Common wrong answer: wrapping the iteration in try/catch for CME and retrying.

### A "views" counter in your service is consistently lower than the number of requests under load. Why, and how do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/javase/tutorial/essential/concurrency/interfere.html -->
Answer:

1. Observe: under concurrency, increments are lost. `count++` is three steps (read, add, write). Two threads can read the same value and both write value plus one, so one update disappears. Marking the field `volatile` does not help because it fixes visibility, not atomicity.
2. Look further: if the counter lives in a `HashMap<String, Integer>` updated with `map.put(k, map.get(k) + 1)`, the check-then-act pattern has the same race, and a plain `HashMap` can also corrupt internally.
3. Fix in memory:
   - A single counter: `AtomicLong.incrementAndGet()`, or `LongAdder` for very hot counters with many writer threads.
   - Per-key counters: `ConcurrentHashMap<String, LongAdder>` with `computeIfAbsent(k, x -> new LongAdder()).increment()`.
   - Compound invariants across several fields need a lock.
4. Fix in the database if the count is persistent and the service has several instances: in-memory atomics only protect one JVM. Use an atomic SQL update (`UPDATE posts SET views = views + 1 WHERE id = ?`) rather than read-modify-write in Java, or optimistic locking with a `@Version` column for complex entity updates, or Redis `INCR`.
5. Prevent: concurrency tests that hammer the code from many threads and assert exact totals.

```java
private final ConcurrentMap<String, LongAdder> views = new ConcurrentHashMap<>();
void recordView(String postId) { views.computeIfAbsent(postId, k -> new LongAdder()).increment(); }
```

Common wrong answers: `synchronized` on a method in a bean that runs on several pods, or declaring the field `volatile`.

### Items you put into a `HashSet` sometimes cannot be found or removed later. What is the likely cause?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Set.html -->
Answer:

1. Hypothesis one: the element was mutated after insertion. A `HashSet` stores each element in a bucket chosen from its `hashCode` at insertion time. If a field used in `hashCode` changes later, lookups compute a different bucket and miss; the element is still inside, so `contains` and `remove` fail and the set can even appear to hold duplicates.
2. Hypothesis two: `equals` and `hashCode` are inconsistent, for example `equals` overridden but `hashCode` not, or `equals(MyType other)` written as an overload instead of overriding `equals(Object)`.
3. Hypothesis three: JPA entities with generated ids. An entity's `hashCode` based on `id` changes when it is persisted and receives its id, breaking sets that contained it while new.
4. Verify: write a test that inserts, mutates and looks up; print `hashCode()` before and after. Static analysis (IntelliJ inspections, Error Prone, SpotBugs) flags equals/hashCode mismatches.
5. Fix: use immutable keys, ideally records, which implement both methods correctly from final components. For entities, base equality on a stable natural key or a client-assigned UUID, or use a constant `hashCode` for the class plus id-based equals (the Hibernate-recommended compromise). Always use `@Override`.
6. Prevent: document that keys must not change, and prefer immutable value types throughout.

```java
record SkuKey(String sku, String warehouse) {}   // immutable, correct equals/hashCode
Set<SkuKey> reserved = new HashSet<>();
```

Common wrong answer: switching to `TreeSet`. It has the same problem if the fields used by the comparator change.

### Design an in-process cache for product prices that loads from a slow service, expires entries, and does not stampede the backend.
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html -->
Answer:

1. Requirements: bounded size (no unbounded growth), time-based expiry, thread safety, and single-flight loading so a thousand concurrent misses for the same key cause one backend call, not a thousand (cache stampede).
2. Naive approach and its flaw: `if (!map.containsKey(k)) map.put(k, load(k))` races and loads many times; a plain `HashMap` is not thread-safe; a `ConcurrentHashMap` without eviction leaks memory.
3. Build-it-yourself core: store `CompletableFuture` values in a `ConcurrentHashMap`. `computeIfAbsent` installs one future per key atomically; every caller joins the same future. Remove failed futures so errors are not cached forever. Add an expiry timestamp per entry.
4. Production choice: use Caffeine, which provides size-based eviction with a near-optimal W-TinyLFU policy, `expireAfterWrite`, `refreshAfterWrite` (serve stale data while one thread refreshes in the background), async loading, and statistics. In Spring use it behind `@Cacheable` with `sync = true`.
5. Consider multi-instance consistency: each pod has its own cache, so invalidation needs short TTLs, events (Kafka or Redis pub/sub), or a shared cache like Redis for data that must agree across pods.

```java
private final ConcurrentMap<String, CompletableFuture<Price>> inflight = new ConcurrentHashMap<>();

CompletableFuture<Price> price(String sku) {
    return inflight.computeIfAbsent(sku, k ->
        CompletableFuture.supplyAsync(() -> pricing.fetch(k), ioExecutor)
            .whenComplete((p, ex) -> { if (ex != null) inflight.remove(k); }));
}

LoadingCache<String, Price> cache = Caffeine.newBuilder()
        .maximumSize(50_000).expireAfterWrite(Duration.ofMinutes(5))
        .refreshAfterWrite(Duration.ofMinutes(1)).build(pricing::fetch);
```

Trade-offs: longer TTLs mean fewer backend calls but staler prices; `refreshAfterWrite` hides latency but serves slightly old values.

### A `CompletableFuture` pipeline sometimes never completes and no error is ever logged. How do you debug and harden it?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CompletableFuture.html -->
Answer:

1. Hypothesise the usual causes:
   - An exception in a stage is stored in the future, and nobody calls `join`/`get` or attaches `exceptionally`/`whenComplete`, so it disappears silently.
   - A stage never completes because a manually created future (`new CompletableFuture<>()`) is not completed on every path, for example a callback that only completes on success.
   - Blocking calls inside async stages running on the common `ForkJoinPool` exhaust it, so later stages never get a thread (pool starvation or even deadlock if stages wait on each other).
   - No timeout, so a hung remote call holds the chain forever.
2. Verify: take thread dumps and look at `ForkJoinPool.commonPool-worker` threads; if all are blocked in I/O or `join()`, it is starvation. Log in `whenComplete` at each stage to see where it stops.
3. Fix:
   - Always supply a dedicated executor for blocking work (`supplyAsync(task, ioExecutor)`), or use virtual threads.
   - Add `orTimeout` or `completeOnTimeout` on every externally facing future.
   - Terminate every chain with error handling, and unwrap `CompletionException` to see the real cause.
   - Complete manual futures in `finally`-style code paths, including `completeExceptionally`.
   - Never call `join()` inside a stage running on the same bounded pool.
4. Simplify: on Java 21+, plain blocking code on virtual threads (optionally with structured concurrency) is often clearer than long future chains and gives readable stack traces.

```java
return CompletableFuture.supplyAsync(() -> client.fetch(id), ioExecutor)
        .orTimeout(3, TimeUnit.SECONDS)
        .whenComplete((r, ex) -> { if (ex != null) log.warn("fetch {} failed", id, ex); });
```

### Customers were charged twice when the payment gateway timed out and your service retried. How do you make payments safe?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/javase/tutorial/jdbc/basics/transactions.html -->
Answer:

1. Understand the failure: a timeout does not mean the call failed. The gateway may have processed the charge while the response was lost, so a blind retry charges again. Any operation that is retried, by your code, a load balancer, a message broker or the user's double click, must be idempotent.
2. Fix with idempotency keys: generate a unique key per logical payment (for example the order id plus attempt intent) before the first call, send it to the gateway (most payment APIs accept an `Idempotency-Key` header), and reuse the same key on retries so the gateway returns the original result.
3. Protect your own side: store the payment intent in your database with a unique constraint on the key before calling out, using a state machine such as PENDING, then SUCCEEDED or FAILED. A retry finds the existing row and either returns the stored result or queries the gateway for status instead of charging again.
4. Reconcile: a background job checks PENDING payments older than a threshold against the gateway and resolves them. Gateways also send webhooks; process them idempotently too.
5. For messaging, use the outbox pattern so the DB update and the event publish cannot diverge, and make consumers deduplicate by message id.

```java
@Transactional
public Payment startPayment(String orderId, long amount) {
    return payments.findByIdempotencyKey(orderId)
            .orElseGet(() -> payments.save(Payment.pending(orderId, amount)));  // unique index on key
}
```

Common wrong answers: "disable retries" (you then lose legitimate payments on transient errors) or "use a distributed lock" (does not survive the lost-response case).

### Users in India report that reports for "yesterday" miss some orders, and a scheduled job ran twice during a DST change abroad. How do you fix date and time handling?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/javase/tutorial/datetime/index.html -->
Answer:

1. Observe: the bugs come from mixing time zones. Typical root causes are the server default time zone being UTC while business days are in IST, `java.util.Date` or `LocalDateTime` stored without zone information, and schedules defined in local times that repeat or skip during daylight-saving transitions.
2. Rules to apply:
   - Store instants: persist timestamps as UTC (`Instant`, `TIMESTAMP WITH TIME ZONE` or `timestamptz`).
   - Convert at the edges: compute business periods with the business zone explicitly, for example `ZoneId.of("Asia/Kolkata")`, never the JVM default.
   - Use `LocalDate` for dates without time (birthdays, due dates), `ZonedDateTime` for scheduling in a region, `OffsetDateTime` for API payloads.
   - Inject a `Clock` so tests can control "now".
3. Fix the report: define yesterday as `[startOfDay(yesterday, IST), startOfDay(today, IST))` converted to instants, using a half-open interval to avoid both gaps and double counting at midnight.
4. Fix the scheduler: run cron jobs in UTC, or make the job idempotent per business date, since a 01:30 local schedule happens twice on a DST fall-back night and not at all on spring-forward.
5. Prevent: set `-Duser.timezone=UTC` consistently, ban `new Date()` and `LocalDateTime.now()` without zone via linting.

```java
ZoneId ist = ZoneId.of("Asia/Kolkata");
LocalDate yesterday = LocalDate.now(clock.withZone(ist)).minusDays(1);
Instant from = yesterday.atStartOfDay(ist).toInstant();
Instant to = yesterday.plusDays(1).atStartOfDay(ist).toInstant();
List<Order> orders = repo.findByCreatedAtGreaterThanEqualAndCreatedAtLessThan(from, to);
```

### Invoice totals computed in Java differ by a paisa from the totals in the finance system. How do you find and fix it?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/BigDecimal.html -->
Answer:

1. Observe: collect failing invoices and recompute line by line, logging intermediate values.
2. Hypotheses:
   - `double` arithmetic: binary floating point cannot represent 0.1 exactly, so sums drift.
   - `new BigDecimal(0.1)` built from a double carries the double's error; use `BigDecimal.valueOf` or a String.
   - Different rounding mode or rounding stage: rounding each line then summing gives a different result from summing then rounding. Finance systems often use `HALF_EVEN` (banker's rounding) and tax rules specify whether tax is rounded per line or per invoice.
   - `BigDecimal.equals` comparing scale: `2.0` and `2.00` are not equal by `equals`, only by `compareTo`, so equality checks and `HashSet`s misbehave.
   - Division without a `MathContext` throws `ArithmeticException` for non-terminating results, and someone "fixed" it with an arbitrary scale.
3. Fix: represent money as `BigDecimal` with an explicit scale and agreed rounding mode, or as long minor units (paise); centralise arithmetic in a `Money` value type so rules are applied in one place; match the finance system's rounding order exactly, and document it.
4. Prevent: property-based tests summing many random lines, and golden tests with real invoices from finance.

```java
record Money(BigDecimal amount) {
    Money { amount = amount.setScale(2, RoundingMode.HALF_EVEN); }
    Money plus(Money o) { return new Money(amount.add(o.amount)); }
    Money times(BigDecimal rate) { return new Money(amount.multiply(rate)); }
}
```

Common wrong answer: rounding the final total to hide the difference; the line items then no longer add up on the printed invoice.

### You maintain an internal Java library used by 40 services. How do you design and evolve its API without breaking them?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/javase/specs/jls/se21/html/jls-13.html -->
Answer:

1. Minimise surface: expose interfaces and a few final classes, keep everything else package-private or in non-exported packages (JPMS modules, or at least an `internal` package convention). Anything public will be used by someone.
2. Prefer immutable value types (records), static factories and builders over public constructors with many parameters; factories let you return different implementations later.
3. Understand binary compatibility (JLS chapter 13), not just source compatibility: services may be compiled against version 1.4 and run with 1.5. Adding a method to an interface used to break implementers; add it as a `default` method. Changing a return type, removing a method, adding a checked exception or changing a field to a method all break binary clients with `NoSuchMethodError`/`NoSuchFieldError`.
4. Version with semantic versioning; run a compatibility checker such as japicmp or Revapi in CI against the last release.
5. Evolve by deprecation: add the new API, mark the old one `@Deprecated(since = "2.3", forRemoval = true)` with a pointer to the replacement, and remove only in the next major version.
6. Avoid leaking transitive dependencies in signatures (for example Guava or Jackson types), because that forces your dependency versions on all consumers. Use `implementation` rather than `api` in Gradle.
7. Use sealed interfaces carefully: adding a permitted subtype breaks exhaustive switches in clients, which may be intended but is a breaking change.

```java
public interface RateLimiter {
    boolean tryAcquire();
    default boolean tryAcquire(Duration timeout) { return tryAcquire(); }   // added in 1.5, safe
    static RateLimiter perSecond(int permits) { return new TokenBucket(permits); }
}
```

### After a dependency upgrade the service fails at runtime with `NoSuchMethodError` although everything compiled. How do you resolve it?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/NoSuchMethodError.html -->
Answer:

1. Understand the error: code was compiled against one version of a class where the method existed, but at runtime a different version of that class was loaded. It is a classpath conflict, not a code bug.
2. Identify the class from the message and find which JARs contain it: `mvn dependency:tree -Dverbose -Dincludes=groupId` or `./gradlew dependencyInsight --dependency jackson-databind`. Look for two versions of the same library pulled in transitively, or the same classes in differently named artifacts (for example `javax` vs `jakarta`, or a shaded copy).
3. Understand resolution: Maven picks the nearest declaration in the tree (not the newest); Gradle picks the highest version. Either may choose an incompatible one for some library.
4. Confirm at runtime: start with `-verbose:class` or log `SomeClass.class.getProtectionDomain().getCodeSource()` to see which JAR actually supplied it.
5. Fix: align versions with a BOM (Spring Boot, Jackson, Netty and the AWS SDK all publish BOMs), add explicit `dependencyManagement` or Gradle constraints, exclude the stale transitive dependency, or upgrade the library that needs the old version.
6. Prevent: use the Maven Enforcer plugin's `dependencyConvergence` rule or Gradle's `failOnVersionConflict`, and run integration tests that start the full application after upgrades, since unit tests with mocks often miss this.

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson</groupId>
      <artifactId>jackson-bom</artifactId>
      <version>2.18.2</version>
      <type>pom</type><scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

### You must import a 20 GB CSV file into a database with a JVM limited to 1 GB of heap. How do you design it?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/javase/tutorial/essential/io/file.html -->
Answer:

1. Principle: stream, never load. Memory use must be proportional to a batch, not the file.
2. Reading: use `Files.newBufferedReader` or `Files.lines` inside try-with-resources so lines are read lazily, with an explicit charset. For complex CSV (quoted commas, multi-line fields) use a streaming parser such as Jackson CSV or univocity in iterator mode rather than `String.split`.
3. Writing: batch inserts with a reused `PreparedStatement`, `addBatch` and `executeBatch` every 1,000 to 5,000 rows, commit per batch, and for PostgreSQL enable `reWriteBatchedInserts=true` or use `COPY`, which is far faster. Clear any ORM persistence context per batch (or skip JPA entirely), since Hibernate keeps every saved entity in memory.
4. Robustness: track progress (line number or byte offset) in a checkpoint table so a crash resumes instead of restarting; send bad rows to an error file with the line number rather than aborting; make the load idempotent with upserts or a staging table plus a final swap.
5. Throughput: parse and insert on separate threads with a bounded `BlockingQueue` between them for back-pressure, or split the file by byte ranges for parallel loaders if the database can take it.

```java
try (var lines = Files.lines(path, StandardCharsets.UTF_8);
     var con = ds.getConnection();
     var ps = con.prepareStatement("INSERT INTO trades(id, symbol, qty) VALUES (?,?,?)")) {
    con.setAutoCommit(false);
    var count = new int[1];
    lines.skip(1).map(Trade::parse).forEach(t -> {
        try {
            ps.setLong(1, t.id()); ps.setString(2, t.symbol()); ps.setInt(3, t.qty());
            ps.addBatch();
            if (++count[0] % 2_000 == 0) { ps.executeBatch(); con.commit(); }
        } catch (SQLException e) { throw new UncheckedIOException(new IOException(e)); }
    });
    ps.executeBatch(); con.commit();
}
```

Common wrong answers: `Files.readAllLines`, or saving each row through a JPA repository in one giant transaction.

### An endpoint got slower after a release, but nothing obvious changed. How do you profile it?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/specs/man/jfr.html -->
Answer:

1. Quantify: compare latency percentiles before and after per endpoint, and check whether the regression is everywhere (JVM, infrastructure, GC) or only on this endpoint (code, query).
2. Narrow with tracing: distributed traces (OpenTelemetry, Micrometer Tracing) break the request into spans: database, HTTP calls, serialisation. Often one span explains it, for example a new query without an index or an extra remote call inside a loop.
3. Profile the JVM: record with Java Flight Recorder in production (`jcmd <pid> JFR.start duration=120s filename=slow.jfr settings=profile`), which samples CPU, allocations, lock contention, socket I/O and GC with very low overhead. In JDK Mission Control, check hot methods, "Java Monitor Blocked" events, allocation pressure and long socket reads. async-profiler's wall-clock mode shows where time goes, including waiting.
4. Compare with the previous release: diff dependencies (a library upgrade can change defaults, such as connection pool or HTTP client settings), configuration, and the git diff of the code path. A differential flame graph of old versus new makes the change obvious.
5. Verify the fix with a reproducible load test and a JMH microbenchmark for hot code.
6. Prevent: performance budgets in CI, and canary releases comparing latency automatically.

Common traps: optimising based on intuition, micro-optimising code that accounts for 1% of time, and benchmarking without JIT warm-up. Also check logging: switching a hot path's log statement to string concatenation at INFO level can add measurable allocation.

### Memory steadily grows because a `newFixedThreadPool` keeps accepting tasks faster than it can run them. How do you redesign it?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html -->
Answer:

1. Diagnose: `Executors.newFixedThreadPool` uses an unbounded `LinkedBlockingQueue`. When producers outpace consumers, the queue grows without limit; each queued task holds its payload, so heap grows until `OutOfMemoryError`, and queued work suffers huge latency. A heap dump shows millions of tasks in `LinkedBlockingQueue$Node`.
2. Decide what should happen under overload, since that is the real design question:
   - Back-pressure: slow the producer. A bounded queue plus `CallerRunsPolicy` makes the submitting thread run the task itself, naturally throttling it. Or block on `put` with a `BlockingQueue`.
   - Load shedding: reject with `AbortPolicy` and return 429 or 503 to the client quickly.
   - Buffering durably: if work must not be lost, put it in a message broker (Kafka, SQS) rather than RAM.
3. Implement an explicit `ThreadPoolExecutor` with a bounded `ArrayBlockingQueue`, a named thread factory, a rejection policy, and metrics on queue size and rejections (Micrometer's `ExecutorServiceMetrics`).
4. Size the pool to the real bottleneck: if tasks are I/O-bound, virtual threads with a `Semaphore` on the downstream may remove the queue entirely.
5. Prevent: alert on queue depth; load-test past capacity.

```java
var executor = new ThreadPoolExecutor(16, 16, 0, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(2_000),
        Thread.ofPlatform().name("ingest-", 0).factory(),
        new ThreadPoolExecutor.CallerRunsPolicy());
```

Trade-off: `CallerRunsPolicy` on a request thread increases that request's latency; for HTTP handlers rejecting fast is often kinder.

### Several tests fail randomly in CI but always pass locally. How do you make the suite reliable?
<!-- level: intermediate; kind: scenario; ref: https://junit.org/junit5/docs/current/user-guide/ -->
Answer:

1. Measure: collect failure history per test (CI test reports, rerun-on-failure plugins that flag tests passing on retry), and try reproducing locally with the CI's conditions: parallel execution, random order (`junit.jupiter.testmethod.order.default=org.junit.jupiter.api.MethodOrderer$Random`), limited CPU, a different time zone and locale.
2. Classify the cause, since flakiness is almost always one of:
   - Time: `Thread.sleep` waits, real clocks, midnight or month boundaries. Fix by injecting `Clock` and using Awaitility to poll for async outcomes with a timeout.
   - Order dependence and shared state: static fields, singleton caches, shared database rows, Spring contexts cached across tests with dirty state. Fix with fresh data per test, transactions rolled back, unique ids.
   - Concurrency: races in the code itself; flaky tests sometimes reveal real bugs, so investigate before dismissing.
   - Environment: ports in use, file paths, locale-dependent formatting, external services. Use random ports, `@TempDir`, Testcontainers and WireMock.
   - Unordered collections asserted as ordered (`HashMap` iteration).
3. Quarantine known flaky tests in a separate job so the main pipeline stays trustworthy, with a ticket and owner to fix them, rather than blind retries forever.
4. Prevent: code review for sleeps and shared state; keep unit tests free of I/O.

```java
await().atMost(Duration.ofSeconds(5))
       .untilAsserted(() -> assertThat(outbox.sent()).hasSize(1));   // instead of Thread.sleep(2000)
```

Common wrong answer: increasing sleep durations; it slows the suite and still fails on a busy CI agent.

### During deployments some Kafka messages are processed twice and a few HTTP requests fail with 502. How do you implement graceful shutdown?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Runtime.html#addShutdownHook(java.lang.Thread) -->
Answer:

1. Understand the sequence: Kubernetes sends SIGTERM, waits `terminationGracePeriodSeconds` (30 s default), then SIGKILL. The JVM runs shutdown hooks on SIGTERM; Spring closes the context in a hook. Meanwhile the load balancer may still route traffic to the pod for a few seconds.
2. HTTP 502s: the pod stops accepting before the endpoint is removed from the load balancer. Fix by failing readiness first and adding a short `preStop` sleep (5 to 10 s) so endpoints are deregistered, then enable `server.shutdown=graceful` with `spring.lifecycle.timeout-per-shutdown-phase` so in-flight requests finish.
3. Duplicate messages: the consumer was killed after processing but before committing offsets, so the next instance reprocesses. Fix by stopping polling on shutdown, finishing the current batch, committing offsets synchronously, then closing (Spring Kafka containers do this when stopped gracefully). Even then, at-least-once delivery means duplicates can still happen, so consumers must be idempotent (dedup table keyed by message id, or upserts).
4. Executors and schedulers: call `shutdown()` and `awaitTermination` in a `@PreDestroy` or `SmartLifecycle` stop, bounded by the grace period.
5. Verify by deploying under load and counting errors and duplicates; make sure the JVM is PID 1 or uses an init (for example `exec java ...` in the entrypoint) so it actually receives SIGTERM.

```yaml
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 10"]
terminationGracePeriodSeconds: 45
```

Common wrong answer: a shell script entrypoint without `exec`, where the JVM never gets the signal and is SIGKILLed.

### A legacy module has a 400-line `if/else instanceof` chain handling message types. How would you refactor it with modern Java?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/language/pattern-matching.html -->
Answer:

1. Secure behaviour first: add characterisation tests covering each message type and edge cases, so the refactor is provably behaviour-preserving.
2. Model the closed set: if the set of message types is known and owned by you, make a `sealed interface Message permits ...` with each type as a record. Records give immutable data with equals and toString for free.
3. Replace the chain with a pattern-matching switch (Java 21). Use record deconstruction for fields and `when` guards for conditions. Because the hierarchy is sealed, omit `default`; the compiler enforces exhaustiveness, so adding a new message type later produces compile errors wherever handling is missing, which is the main payoff over the old chain, where a new type silently fell into the final else.
4. Alternative designs: if each type's behaviour belongs with the type and the set of operations is small, use plain polymorphism (an abstract `handle()` method). If the set of types is open (plugins), use a registry `Map<Class<?>, Handler>`. Pattern matching shines when the set of types is fixed but operations vary.
5. Migrate incrementally: introduce the sealed hierarchy alongside, convert one branch at a time behind the tests.

```java
sealed interface Message permits Deposit, Withdrawal, Transfer {}
record Deposit(String account, long amount) implements Message {}
record Withdrawal(String account, long amount) implements Message {}
record Transfer(String from, String to, long amount) implements Message {}

void handle(Message m) {
    switch (m) {
        case Deposit(var acc, var amt) -> ledger.credit(acc, amt);
        case Withdrawal(var acc, var amt) when amt > 100_000 -> review.queue(m);
        case Withdrawal(var acc, var amt) -> ledger.debit(acc, amt);
        case Transfer t -> ledger.transfer(t.from(), t.to(), t.amount());
    }
}
```

### How would you model an order lifecycle (created, paid, shipped, cancelled) so invalid transitions cannot happen?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/language/sealed-classes-and-interfaces.html -->
Answer:

1. Identify the problem with the common approach: a mutable `Order` with a `status` enum and nullable fields (`trackingNumber`, `paidAt`) allows nonsense states, such as SHIPPED without payment, and every caller must remember which fields are valid in which status.
2. Make illegal states unrepresentable: model each state as a record with exactly the data valid in that state, under a sealed interface. Transitions are methods that exist only on the states where they are legal and return the next state.
3. The compiler now enforces the rules: you cannot call `ship()` on a `Created` order because the method does not exist there; switches over `OrderState` must handle every state.
4. Persistence: store a discriminator column plus nullable columns, or JSON, and map to the sealed type in the repository layer. Concurrency: use optimistic locking (`version`) so two concurrent transitions cannot both succeed.
5. Trade-offs: more types and mapping code; for very dynamic workflows a table-driven state machine (Spring State Machine, or an enum transition map validated at runtime) may be more flexible. For core business invariants, compile-time safety usually wins.

```java
sealed interface OrderState permits Created, Paid, Shipped, Cancelled {}
record Created(String id, Money total) implements OrderState {
    Paid pay(String txId, Instant at) { return new Paid(id, total, txId, at); }
    Cancelled cancel(String reason) { return new Cancelled(id, reason); }
}
record Paid(String id, Money total, String txId, Instant paidAt) implements OrderState {
    Shipped ship(String tracking) { return new Shipped(id, txId, tracking); }
}
record Shipped(String id, String txId, String tracking) implements OrderState {}
record Cancelled(String id, String reason) implements OrderState {}
```

Interview tip: mention that this is data-oriented programming, and that it makes tests smaller because invalid inputs need no tests.

### `@Transactional` on a service method seems to be ignored: a failure leaves half the data written. Why?
<!-- level: intermediate; kind: scenario; ref: https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative.html -->
Answer:

1. Remember the mechanism: Spring implements `@Transactional` with a proxy around the bean. The transaction starts only when a call goes through the proxy.
2. Check the usual reasons it does not apply:
   - Self-invocation: `this.saveAll()` from another method in the same class bypasses the proxy, so the annotation is never seen.
   - The method is `private` or `final` (or the class is final): proxies cannot intercept it.
   - The checked exception problem: by default Spring rolls back only on unchecked exceptions and `Error`. A checked exception commits the transaction.
   - The exception is caught and swallowed inside the method, so the proxy never sees a failure.
   - Work runs on another thread (`@Async`, `CompletableFuture`, parallel stream); transactions are bound to the current thread.
   - Multiple data sources and the wrong transaction manager, or a non-transactional storage engine such as MySQL MyISAM.
3. Verify: enable `logging.level.org.springframework.transaction=DEBUG` to see "Creating new transaction" or its absence, and check `TransactionSynchronizationManager.isActualTransactionActive()` in a test.
4. Fix: call the method through another bean (or restructure so the transactional boundary is the public entry point), use `rollbackFor = Exception.class` where checked exceptions are expected, rethrow after logging, and keep all transactional work on one thread.
5. Prevent: integration tests that force a failure midway and assert nothing was persisted.

```java
@Transactional(rollbackFor = Exception.class)
public void importBatch(List<Row> rows) throws IOException {
    rows.forEach(repo::save);
    auditWriter.write(rows);     // IOException now rolls back the saves
}
```

### A JSON parser in your service crashes with `StackOverflowError` on certain payloads. What is happening and how do you handle it?
<!-- level: intermediate; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/StackOverflowError.html -->
Answer:

1. Observe: the stack trace shows the same methods repeated thousands of times. Recursive descent parsers and recursive tree-walking code use one stack frame per nesting level, so a payload like 100,000 nested `[` exhausts the thread stack. This is also a denial-of-service vector.
2. Verify: reproduce with a generated deeply nested document; check the parser version.
3. Fix at the boundary: limit input. Modern Jackson (2.15+) has `StreamReadConstraints` with a default maximum nesting depth of 1000, plus limits on string and number length; upgrade and configure them. Also enforce request body size limits in the web server.
4. Fix your own recursive algorithms: convert deep recursion to iteration with an explicit `ArrayDeque` stack, which lives on the heap and can be bounded. Java has no tail-call optimisation, so tail recursion does not help.
5. Increasing `-Xss` or running in a thread created with a larger stack size is a stopgap for legitimately deep but bounded structures, not a defence against hostile input. Virtual threads have growable stacks but still a maximum.
6. Do not catch `StackOverflowError` as normal control flow; the JVM state is usually fine afterwards, but locks or partial updates may be left inconsistent.

```java
long depth(Node root) {
    Deque<Map.Entry<Node, Integer>> stack = new ArrayDeque<>();
    stack.push(Map.entry(root, 1));
    int max = 0;
    while (!stack.isEmpty()) {
        var e = stack.pop();
        max = Math.max(max, e.getValue());
        for (Node c : e.getKey().children()) stack.push(Map.entry(c, e.getValue() + 1));
    }
    return max;
}
```

### Your service allocates about 2 GB per second and GC runs constantly. How do you reduce allocation pressure?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/gctuning/introduction-garbage-collection-tuning.html -->
Answer:

1. Measure first: JFR's allocation events ("Allocation in new TLAB" and "outside TLAB") or async-profiler in alloc mode produce a flame graph of who allocates. GC logs give the allocation rate. Usually a handful of call sites dominate.
2. Typical offenders and fixes:
   - Logging: building strings for disabled log levels; use parameterised logging (`log.debug("x={}", x)`) and avoid expensive `toString` in hot paths.
   - Boxing: `Map<Long, Long>`, `Stream<Integer>`, varargs; use primitive streams, primitive collections (fastutil, Eclipse Collections) or arrays.
   - Serialisation: converting JSON to `String` then to bytes; stream directly to the output stream, reuse `ObjectMapper`/`ObjectWriter` (they are thread-safe and expensive to create).
   - Intermediate collections in stream chains or repeated `toList()` copies; fuse operations.
   - Large temporary buffers: reuse with a pool or `ThreadLocal` (careful with virtual threads) or allocate once per connection.
   - Regex compilation in loops: precompile `Pattern` as a static constant.
   - Exceptions used for control flow, which capture stack traces.
3. Let the JIT help: small, short-lived objects that do not escape a method may be scalar-replaced by escape analysis; keep hot methods small enough to inline.
4. Verify by comparing allocation rate and GC CPU before and after under the same load test.
5. Trade-off: object pooling of ordinary small objects usually hurts with modern GCs (young-generation allocation is extremely cheap); pool only expensive resources and big buffers.

Common wrong answer: just enlarging the heap; it reduces GC frequency but does not fix CPU spent allocating and copying, and pauses can get longer.

### An external API you call allows only 100 requests per second across all instances of your service. How do you enforce it?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Semaphore.html -->
Answer:

1. Clarify the limit: requests per second, concurrent requests, or both; per API key or per IP; and what happens when exceeded (429 with `Retry-After`, temporary ban).
2. Single instance: a token bucket refilled at 100 tokens per second, for example Resilience4j `RateLimiter` or Bucket4j, guarding the client. A `Semaphore` limits concurrency, which is a different dimension, so you may need both.
3. Multiple instances: local limiters each allow 100, so N pods allow 100 times N. Options:
   - Split the budget statically (100 / pod count) with a margin; simple but wasteful when traffic is uneven and wrong during autoscaling.
   - A shared limiter in Redis (Bucket4j with a Redis backend, or a Lua script implementing a token bucket atomically); accurate, adds a network hop and a dependency.
   - Route all calls through one dedicated gateway service or a queue drained at the allowed rate; best when callers can tolerate asynchrony.
4. Handle 429 anyway: respect `Retry-After`, back off with jitter, and surface metrics; local accounting can drift.
5. Choose behaviour when out of tokens: wait briefly (bounded timeout), queue the work, or fail fast to the caller. Never wait unboundedly on request threads.

```java
RateLimiter limiter = RateLimiter.of("partner", RateLimiterConfig.custom()
        .limitForPeriod(25)                               // 100 rps / 4 pods
        .limitRefreshPeriod(Duration.ofSeconds(1))
        .timeoutDuration(Duration.ofMillis(200))
        .build());
Supplier<Quote> limited = RateLimiter.decorateSupplier(limiter, partner::quote);
```

Trade-off: accuracy versus availability; if Redis is down, decide whether to fail open (risk a ban) or fail closed (lose traffic).

### In an interview you are asked: "Is this lazy singleton thread-safe?" and shown double-checked locking without volatile. How do you answer?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html#jls-17.4.5 -->
Answer:

1. State the verdict: no. Without `volatile`, it is broken under the Java Memory Model.
2. Explain why: `instance = new Config()` is not atomic. It allocates memory, runs the constructor and publishes the reference, and the compiler or CPU may reorder the publication before the constructor's writes are visible. A second thread passing the unsynchronised first check can see a non-null reference to a partially initialised object, because there is no happens-before edge between the writer's constructor and the reader's field reads.
3. Show the fix: declare the field `volatile`. A volatile write publishes everything written before it; the reader's volatile read then sees the fully constructed object. Since Java 5, this makes double-checked locking correct. Reading into a local variable avoids a second volatile read.
4. Offer better alternatives: the initialization-on-demand holder idiom relies on the JVM's guaranteed thread-safe, lazy class initialisation, with no locking on the fast path; an enum singleton is also safe and handles serialisation. In Spring, just let the container manage a singleton bean.
5. Mention the deeper principle: safe publication. Objects shared between threads must be published through a volatile field, a final field, a lock, a concurrent collection or static initialisation. Immutable objects with final fields are safe even when published racily.

```java
private static volatile Config instance;
static Config get() {
    Config c = instance;
    if (c == null) {
        synchronized (Config.class) {
            c = instance;
            if (c == null) instance = c = new Config();
        }
    }
    return c;
}
```

Common wrong answer: "it is fine because of the synchronized block"; the first, unsynchronised read is the problem.

### You need to call five independent downstream services per request and return within 300 ms even if some are slow. How would you implement it on Java 21+?
<!-- level: advanced; kind: scenario; ref: https://docs.oracle.com/en/java/javase/21/core/structured-concurrency.html -->
Answer:

1. Requirements: run calls in parallel, cap total latency, decide per call whether it is mandatory (fail the request) or optional (degrade with a default), and cancel stragglers so they do not waste resources after the deadline.
2. Concurrency vehicle: virtual threads make blocking clients fine; one virtual thread per call.
3. Option A, stable APIs: `CompletableFuture.supplyAsync(..., virtualExecutor)` for each call with `completeOnTimeout(default, ...)` for optional ones and `orTimeout` for mandatory ones, then `allOf(...).join()`. Downside: cancellation does not interrupt running calls, so also set HTTP request timeouts below the deadline.
4. Option B, structured concurrency (preview in 21 to 25, `--enable-preview`): fork each call in a `StructuredTaskScope`, join with a deadline; when the scope closes, unfinished subtasks are interrupted and cannot leak, and failures propagate cleanly. Optional calls can catch their own errors and return defaults inside the subtask.
5. Use the remaining budget: compute a deadline at request start and pass the remaining time down as each client's timeout, so retries never exceed it.
6. Observe: record per-dependency latency and timeout counts so you know which dependency is eating the budget.

```java
var virtual = Executors.newVirtualThreadPerTaskExecutor();
var profile = CompletableFuture.supplyAsync(() -> profiles.get(id), virtual).orTimeout(250, MILLISECONDS);
var recs = CompletableFuture.supplyAsync(() -> recommender.get(id), virtual)
        .completeOnTimeout(List.of(), 250, MILLISECONDS)          // optional: degrade
        .exceptionally(ex -> List.of());
return new Page(profile.join(), recs.join());
```

Common wrong answer: calling the services sequentially with a 300 ms timeout each, which can take 1.5 s.
