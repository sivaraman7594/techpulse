## 10. Concurrency

### Threads and Runnable
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/essential/concurrency/threads.html -->
A thread is an independent path of execution with its own stack, sharing the heap with other threads in the process. Traditional Java threads ("platform threads") are thin wrappers over OS threads: each costs about a megabyte of reserved stack and a kernel scheduling entity, so thousands are fine but millions are not.

You give a thread work as a `Runnable` (no result) or, via executors, a `Callable` (returns a value, may throw). `start()` creates the OS thread and calls `run()` on it; calling `run()` directly just executes it on the current thread. `join()` waits for completion; `interrupt()` sets a flag and wakes blocking calls such as `sleep` or `wait`, which throw `InterruptedException`. Interruption is cooperative: code must check for it and stop.

Since Java 19/21 the `Thread.Builder` API creates both platform and virtual threads.

```java
Thread worker = Thread.ofPlatform().name("report-worker").start(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        try {
            processNextBatch();
            Thread.sleep(1_000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();   // restore the flag and exit
            return;
        }
    }
});
worker.interrupt();
worker.join();
```

- Pitfall: swallowing `InterruptedException` (empty catch) makes threads impossible to stop and breaks executor shutdown.
- Pitfall: `Thread.stop()` is unsafe and now throws `UnsupportedOperationException`; always use interruption.
- In application code, prefer executors over creating threads by hand.

### synchronized, locks and deadlock
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/essential/concurrency/sync.html -->
When threads share mutable state, you need mutual exclusion. Every object has an intrinsic lock (monitor). A `synchronized` method or block acquires it on entry and releases it on exit, even on exceptions. Only one thread can hold a given monitor at a time, and unlock/lock pairs establish happens-before, so changes are visible to the next holder. Intrinsic locks are reentrant.

`java.util.concurrent.locks` offers more control: `ReentrantLock` supports `tryLock` with timeouts, interruptible locking and fairness; `ReadWriteLock` allows many readers or one writer; `StampedLock` adds optimistic reads. `Condition` objects replace `wait`/`notify`.

Deadlock happens when threads hold locks while waiting for each other's locks in a cycle. Prevention: always acquire locks in a consistent global order, hold locks briefly, never call unknown code (callbacks, I/O) while holding a lock, or use `tryLock` with timeout.

```java
public void transfer(Account from, Account to, long amount) {
    Account first = from.id() < to.id() ? from : to;     // consistent ordering prevents deadlock
    Account second = first == from ? to : from;
    synchronized (first) {
        synchronized (second) {
            from.withdraw(amount);
            to.deposit(amount);
        }
    }
}

private final ReentrantLock lock = new ReentrantLock();
if (lock.tryLock(500, TimeUnit.MILLISECONDS)) {
    try { updateCache(); } finally { lock.unlock(); }
}
```

- Diagnose deadlocks with `jcmd <pid> Thread.print` or `jstack`, which report "Found one Java-level deadlock".
- Pitfall: synchronizing on a boxed value or a String literal shares the lock with unrelated code.

### volatile and atomic variables
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/package-summary.html -->
`volatile` guarantees visibility and ordering for a single variable: every read sees the latest write, and writes before a volatile write are visible to threads that later read it. It does not make compound actions atomic, so `count++` on a volatile is still a race (read, add, write).

Atomic classes (`AtomicInteger`, `AtomicLong`, `AtomicReference`, `AtomicBoolean`) provide lock-free atomic operations built on CPU compare-and-swap (CAS) instructions: `incrementAndGet`, `compareAndSet`, `updateAndGet`, `accumulateAndGet`. Under heavy contention many threads retrying CAS on one memory location get slow; `LongAdder` spreads updates across cells and sums on read, which is much faster for hot counters such as metrics.

`VarHandle` (Java 9) exposes the same atomic and memory-ordering operations on arbitrary fields and array elements, used by library authors.

```java
class RequestStats {
    private final LongAdder total = new LongAdder();          // hot counter
    private final AtomicLong maxLatency = new AtomicLong();
    private volatile boolean acceptingTraffic = true;          // simple flag

    void record(long latencyMs) {
        total.increment();
        maxLatency.accumulateAndGet(latencyMs, Math::max);     // atomic max
    }
}

AtomicReference<Config> config = new AtomicReference<>(Config.defaults());
config.updateAndGet(c -> c.withTimeout(Duration.ofSeconds(5)));  // function may run more than once
```

- Pitfall: functions passed to `updateAndGet` must be side-effect free because CAS retries can call them repeatedly.
- Interview tip: volatile = visibility; atomic = visibility plus atomic read-modify-write; lock = both for multiple variables.

### Executors and thread pools
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/essential/concurrency/executors.html -->
The `ExecutorService` abstraction separates submitting tasks from running them. You submit `Runnable` or `Callable` tasks and get `Future`s back; the executor manages a pool of reusable threads and a work queue.

`ThreadPoolExecutor` is configured by core size, maximum size, keep-alive time, a queue, a thread factory and a rejection policy. Sizing guidelines: CPU-bound work wants about the number of cores; I/O-bound work wants more, roughly cores multiplied by (1 + wait time / compute time). For I/O-heavy tasks on Java 21+, virtual threads usually beat any pool size.

The `Executors` factory methods are convenient but hide dangers: `newFixedThreadPool` uses an unbounded queue (memory can grow without limit), and `newCachedThreadPool` has an unbounded thread count. In production, build a `ThreadPoolExecutor` explicitly with a bounded queue and a deliberate rejection policy.

```java
ExecutorService pool = new ThreadPoolExecutor(
        8, 16, 60, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(1_000),                        // bounded queue: back-pressure
        Thread.ofPlatform().name("img-", 0).factory(),
        new ThreadPoolExecutor.CallerRunsPolicy());             // slow the producer when full

Future<Thumbnail> f = pool.submit(() -> resize(image));
Thumbnail t = f.get(2, TimeUnit.SECONDS);

pool.shutdown();                                                // stop accepting, finish queued work
if (!pool.awaitTermination(30, TimeUnit.SECONDS)) pool.shutdownNow();
```

- Since Java 19, `ExecutorService` is `AutoCloseable`; `close()` shuts down and waits.
- Pitfall: exceptions inside `submit` tasks are captured in the `Future`; if nobody calls `get`, failures vanish silently.

### CompletableFuture
<!-- level: advanced; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CompletableFuture.html -->
`CompletableFuture` (Java 8) is a promise-style future that you can compose without blocking. You start async work with `supplyAsync`/`runAsync`, transform results with `thenApply`, chain dependent async calls with `thenCompose` (like flatMap), combine independent ones with `thenCombine` or `allOf`/`anyOf`, and handle errors with `exceptionally`, `handle` or `whenComplete`. Java 9 added `orTimeout` and `completeOnTimeout`.

Each stage runs either on the thread that completed the previous stage or, with the `...Async` variants, on an executor. Without an explicit executor, async stages use the common `ForkJoinPool`, which is sized for CPU work, so blocking I/O there starves other tasks. Always pass your own executor for I/O.

```java
ExecutorService io = Executors.newVirtualThreadPerTaskExecutor();

CompletableFuture<User> user = CompletableFuture.supplyAsync(() -> userApi.get(id), io);
CompletableFuture<List<Order>> orders = CompletableFuture.supplyAsync(() -> orderApi.list(id), io);

CompletableFuture<Dashboard> dashboard = user
    .thenCombine(orders, Dashboard::new)
    .orTimeout(2, TimeUnit.SECONDS)
    .exceptionally(ex -> Dashboard.degraded(id, ex));

Dashboard d = dashboard.join();   // join throws unchecked CompletionException
```

- Pitfall: cancelling a `CompletableFuture` does not interrupt the underlying running task.
- Pitfall: exceptions arrive wrapped in `CompletionException`; unwrap `getCause()` before matching.
- With virtual threads, plain blocking code inside a structured scope is often simpler than long `CompletableFuture` chains.

### Concurrent collections
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/package-summary.html -->
`java.util.concurrent` provides thread-safe collections designed for scalability, which outperform wrapping collections in `Collections.synchronizedMap`, where a single lock serialises every access.

- `ConcurrentHashMap`: lock-free reads; writes use CAS on empty bins or lock only a single bin. Atomic compound operations (`computeIfAbsent`, `merge`, `compute`) run atomically per key. Iterators are weakly consistent and never throw `ConcurrentModificationException`. Nulls are not allowed.
- `CopyOnWriteArrayList`/`Set`: every write copies the array; reads are lock-free snapshots. Ideal for rarely changing listener lists.
- `ConcurrentLinkedQueue`/`Deque`: non-blocking queues.
- `BlockingQueue` implementations: `ArrayBlockingQueue` (bounded), `LinkedBlockingQueue`, `SynchronousQueue` (hand-off), `DelayQueue`, `PriorityBlockingQueue`, for producer-consumer pipelines.
- `ConcurrentSkipListMap`: concurrent sorted map.

```java
ConcurrentMap<String, LongAdder> hits = new ConcurrentHashMap<>();
hits.computeIfAbsent(path, k -> new LongAdder()).increment();   // atomic per key

// Wrong: check-then-act race even on a concurrent map
if (!cache.containsKey(key)) cache.put(key, load(key));
// Right
cache.computeIfAbsent(key, this::load);

BlockingQueue<Event> events = new ArrayBlockingQueue<>(10_000);
// producer: events.put(e) blocks when full; consumer: events.take() blocks when empty
```

- Pitfall: `computeIfAbsent` holds the bin lock while the function runs; slow or recursive loaders hurt throughput and recursively modifying the same map can throw `IllegalStateException`.
- `size()` on a concurrent map is only an estimate during updates.

### Virtual threads (Java 21)
<!-- level: advanced; ref: https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html -->
Virtual threads (JEP 444, final in Java 21) are `Thread` instances scheduled by the JVM rather than the OS. Many virtual threads are multiplexed onto a small pool of carrier platform threads (a `ForkJoinPool` sized to the core count). When a virtual thread performs blocking I/O, sleeps or waits on a lock, the JVM unmounts it, saving its stack frames to the heap, and the carrier runs another virtual thread. Creating one costs about as much as a small object, so one per request, or even one per task, is fine.

This revives the simple thread-per-request style at the scale of asynchronous frameworks: straightforward blocking code, readable stack traces, normal debugging, with throughput limited by I/O rather than thread count.

Rules of thumb:
- Do not pool virtual threads; create one per task.
- Limit concurrency to scarce resources (database connections, rate-limited APIs) with a `Semaphore` or the connection pool, not with thread counts.
- They help I/O-bound work, not CPU-bound computation.
- Pinning: in Java 21 to 23, blocking inside `synchronized` pins the carrier; Java 24 (JEP 491) removed this for `synchronized`. Native calls can still pin.
- Avoid big `ThreadLocal` caches; with millions of threads they multiply memory.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Invoice>> results = customerIds.stream()
        .map(id -> executor.submit(() -> billingClient.invoiceFor(id)))   // blocking HTTP call
        .toList();
    for (var f : results) save(f.get());
}

// Spring Boot 3.2+: spring.threads.virtual.enabled=true
```

- Diagnose pinning with `-Djdk.tracePinnedThreads` (21 to 23) or the JFR `jdk.VirtualThreadPinned` event.

### Structured concurrency (preview)
<!-- level: advanced; ref: https://docs.oracle.com/en/java/javase/21/core/structured-concurrency.html -->
Structured concurrency treats a group of related concurrent subtasks as one unit of work with a clear lifetime, just as a code block structures sequential work. With `StructuredTaskScope`, you fork subtasks inside a try-with-resources block, join them, and the scope guarantees that no subtask outlives the block. If one subtask fails, the others are cancelled automatically; if the parent thread is interrupted, cancellation propagates to children. Thread dumps show the parent-child hierarchy.

This fixes the classic problems of `ExecutorService` fan-out: leaked tasks that keep running after the caller gave up, failures that do not cancel siblings, and lost errors.

Version note: still a preview API in Java 21 through 25 and the API has changed. Java 21 used `new StructuredTaskScope.ShutdownOnFailure()` with `join().throwIfFailed()`; Java 25 (JEP 505) uses `StructuredTaskScope.open()` with pluggable `Joiner` policies. Requires `--enable-preview`.

```java
// Java 25 preview API
Response handle(String userId) throws InterruptedException {
    try (var scope = StructuredTaskScope.open()) {      // default: all must succeed
        Subtask<User> user = scope.fork(() -> users.find(userId));
        Subtask<List<Order>> orders = scope.fork(() -> orderService.recent(userId));
        scope.join();                                    // throws FailedException if any failed;
                                                         // the sibling is cancelled
        return new Response(user.get(), orders.get());
    }
}
// Other policies: Joiner.anySuccessfulResultOrThrow() for "first replica to answer wins"
```

- Pairs naturally with virtual threads: each fork runs in a new virtual thread by default.
- Until it is final, production code can approximate it with `ExecutorService` in try-with-resources plus explicit cancellation.

### ThreadLocal and ScopedValue
<!-- level: advanced; ref: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html -->
`ThreadLocal<T>` gives each thread its own copy of a variable. It is widely used for per-request context (security principal, transaction, MDC logging context) and for caching non-thread-safe objects like `SimpleDateFormat`. Each `Thread` holds a map from ThreadLocal to value.

Problems: values are mutable from anywhere, lifetimes are unbounded, and in thread pools a value set for one request leaks into the next unless removed, which is both a correctness bug and a memory leak. `InheritableThreadLocal` copies values into child threads, which is expensive with millions of virtual threads.

`ScopedValue` (final in Java 25, JEP 506; preview in 21 to 24) is the modern alternative for passing context. A value is bound for the dynamic extent of a call with `ScopedValue.where(KEY, value).run(...)`; code inside reads it with `KEY.get()`, it cannot be reassigned, and it disappears automatically when the call returns. Child threads forked in a `StructuredTaskScope` inherit bindings cheaply.

```java
// ThreadLocal: always clean up in pooled threads
private static final ThreadLocal<String> TENANT = new ThreadLocal<>();
try { TENANT.set(tenantId); handle(req); } finally { TENANT.remove(); }

// ScopedValue (Java 25)
private static final ScopedValue<String> TENANT_ID = ScopedValue.newInstance();

void serve(Request req) {
    ScopedValue.where(TENANT_ID, req.header("X-Tenant")).run(() -> service.process(req));
}
// deep inside: String tenant = TENANT_ID.get();
```

- Pitfall: forgetting `remove()` in a servlet container leaks class loaders on redeploy.

## 11. I/O and Networking

### Byte streams, character streams and buffering
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/essential/io/streams.html -->
Classic `java.io` (not to be confused with `java.util.stream`) models I/O as streams: `InputStream`/`OutputStream` for raw bytes and `Reader`/`Writer` for characters. Classes compose using the decorator pattern: wrap a `FileInputStream` in a `BufferedInputStream`, or an `InputStream` in an `InputStreamReader` to decode bytes into characters with a charset.

Buffering matters because each unbuffered `read()` can be a system call. `BufferedReader` reads large chunks (8 KB by default) and serves characters from memory, and adds `readLine()`.

Character encoding is the classic trap: converting bytes to text needs a charset. Since Java 18 (JEP 400) the default charset is UTF-8 on all platforms, but always specifying it keeps code explicit and portable to older runtimes.

```java
try (var in = new BufferedReader(
        new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
     var out = new PrintWriter(
        new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true)) {
    String line;
    while ((line = in.readLine()) != null) {
        out.println(line.toUpperCase());
    }
}

// Copy a stream efficiently (Java 9+)
try (InputStream src = url.openStream(); OutputStream dst = Files.newOutputStream(target)) {
    src.transferTo(dst);
}
```

- Pitfall: forgetting to flush or close a writer loses buffered data.
- Pitfall: `InputStream.read(byte[])` may read fewer bytes than requested; loop or use `readNBytes`/`readAllBytes`.

### Files and paths with NIO.2
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/essential/io/fileio.html -->
NIO.2 (Java 7) replaced most uses of the old `java.io.File` with `Path` (an immutable file-system path) and the `Files` utility class. It gives clearer exceptions (`NoSuchFileException` instead of a false return value), symbolic link support, file attributes, atomic moves, directory walking and file watching.

Common operations: `Files.readString`/`writeString` (Java 11) for small files, `Files.readAllLines`, `Files.lines` for lazy streaming of large files, `newBufferedReader`/`newBufferedWriter`, `copy`, `move` with `ATOMIC_MOVE`, `createDirectories`, `walk` and `list` for directory trees, and `WatchService` to react to changes.

```java
Path dir = Path.of("data", "reports");
Files.createDirectories(dir);

Path tmp = Files.createTempFile(dir, "report", ".csv");
Files.writeString(tmp, "id,amount\n1,250\n", StandardCharsets.UTF_8);
Files.move(tmp, dir.resolve("daily.csv"),
           StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);

try (Stream<String> lines = Files.lines(dir.resolve("daily.csv"))) {   // must close
    long rows = lines.skip(1).filter(l -> !l.isBlank()).count();
}

try (Stream<Path> files = Files.walk(dir, 2)) {
    files.filter(p -> p.toString().endsWith(".csv")).forEach(System.out::println);
}
```

- Writing to a temp file then atomically moving it is the standard way to avoid readers seeing half-written files.
- Pitfall: `Files.readAllBytes` on a multi-gigabyte file causes `OutOfMemoryError`; stream it.
- Pitfall: resolving user-supplied file names without normalising enables path traversal (`../../etc/passwd`).

### The HTTP Client
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/java/net/http/HttpClient.html -->
`java.net.http.HttpClient` (Java 11) is the built-in modern HTTP client, replacing `HttpURLConnection`. It supports HTTP/1.1 and HTTP/2, synchronous `send` and asynchronous `sendAsync` (returning a `CompletableFuture`), WebSockets, redirects, proxies, authentication and pluggable body handlers.

An `HttpClient` is immutable and thread-safe, holding a connection pool, so create one and reuse it; creating a client per request wastes connections and threads. Since Java 21 it is `AutoCloseable`. Always set a connect timeout on the client and a request timeout on each request; the defaults wait forever.

With virtual threads, the blocking `send` is usually the simplest option.

```java
private static final HttpClient CLIENT = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(3))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();

public String fetchRate(String currency) throws IOException, InterruptedException {
    HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.example.com/rates/" + currency))
            .timeout(Duration.ofSeconds(5))
            .header("Accept", "application/json")
            .GET()
            .build();
    HttpResponse<String> res = CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() != 200) throw new IOException("HTTP " + res.statusCode());
    return res.body();
}

HttpRequest post = HttpRequest.newBuilder(uri)
        .POST(HttpRequest.BodyPublishers.ofString(json))
        .header("Content-Type", "application/json").build();
```

- Pitfall: a non-2xx status is not an exception; check `statusCode()` yourself.
- For JSON you still need a library such as Jackson; the JDK has no JSON API.

## 12. Databases with JDBC

### JDBC basics and PreparedStatement
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/jdbc/basics/index.html -->
JDBC is Java's standard low-level API for relational databases. A vendor driver (PostgreSQL, MySQL, Oracle) implements the interfaces. You obtain a `Connection` (in applications, from a `DataSource` connection pool), create statements, execute them and iterate the `ResultSet`. Higher-level tools such as JPA/Hibernate, Spring's `JdbcClient`, jOOQ and MyBatis are all built on top of JDBC.

Always use `PreparedStatement` with `?` placeholders. Parameters are sent separately from the SQL text, so user input can never change the query structure, which prevents SQL injection. Prepared statements can also be cached and reused by the driver or database. Batching (`addBatch`/`executeBatch`) sends many rows in one round trip.

```java
public List<Customer> findByCity(DataSource ds, String city) throws SQLException {
    String sql = "SELECT id, name, email FROM customers WHERE city = ? ORDER BY name";
    try (Connection con = ds.getConnection();
         PreparedStatement ps = con.prepareStatement(sql)) {
        ps.setString(1, city);                       // safe from SQL injection
        ps.setFetchSize(500);                        // stream large results in chunks
        try (ResultSet rs = ps.executeQuery()) {
            List<Customer> out = new ArrayList<>();
            while (rs.next()) {
                out.add(new Customer(rs.getLong("id"), rs.getString("name"), rs.getString("email")));
            }
            return out;
        }
    }
}
```

- Pitfall: building SQL with string concatenation from input (`"... WHERE name = '" + name + "'"`) is SQL injection.
- Pitfall: `rs.getInt` returns 0 for SQL NULL; check `rs.wasNull()` or use `getObject(col, Integer.class)`.
- Pitfall: forgetting to close connections exhausts the pool and freezes the app.

### Transactions and connection pooling
<!-- level: advanced; ref: https://docs.oracle.com/javase/tutorial/jdbc/basics/transactions.html -->
A transaction groups statements into an atomic unit: all commit or none do. JDBC connections start in auto-commit mode, where each statement is its own transaction. For multi-statement work, call `setAutoCommit(false)`, then `commit()` on success or `rollback()` on failure. Isolation levels (`READ_COMMITTED`, `REPEATABLE_READ`, `SERIALIZABLE`) trade consistency against concurrency; the default depends on the database.

Opening a physical database connection takes TCP setup, TLS and authentication, often tens of milliseconds. A connection pool such as HikariCP (Spring Boot's default) keeps connections open and lends them out; `close()` returns the connection to the pool. Pool size should be small, roughly a few times the database's CPU cores rather than hundreds, because databases slow down with too many concurrent queries. With virtual threads, the pool becomes the natural concurrency limit.

```java
try (Connection con = dataSource.getConnection()) {
    con.setAutoCommit(false);
    try (var debit = con.prepareStatement("UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?");
         var credit = con.prepareStatement("UPDATE accounts SET balance = balance + ? WHERE id = ?")) {
        debit.setLong(1, amount); debit.setLong(2, fromId); debit.setLong(3, amount);
        if (debit.executeUpdate() != 1) throw new InsufficientFundsException(fromId, amount);
        credit.setLong(1, amount); credit.setLong(2, toId);
        credit.executeUpdate();
        con.commit();
    } catch (SQLException | RuntimeException e) {
        con.rollback();
        throw e;
    }
}
```

- Pitfall: long transactions holding locks while calling remote services cause lock contention and pool exhaustion.
- Pitfall: returning a connection to the pool with auto-commit off and an open transaction; good pools reset state, but do not rely on it.
