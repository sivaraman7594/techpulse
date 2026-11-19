## 4. Interfaces and Generics

### Interfaces, default and static methods
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/java/IandI/createinterface.html -->
An interface defines a contract: a set of methods a class promises to provide. A class can implement any number of interfaces, which gives Java multiple inheritance of type without the ambiguity of multiple inheritance of state.

Since Java 8 interfaces can contain default methods (with bodies, inherited by implementers) and static methods; Java 9 added private methods for sharing code between defaults. Default methods were introduced so APIs like `Collection` could evolve (adding `stream()`, `forEach`, `removeIf`) without breaking every existing implementation. Interfaces still cannot hold instance state; any fields are implicitly `public static final` constants.

If a class inherits the same default method from two interfaces, it must override it and can pick one with `InterfaceName.super.method()`. Class methods always win over interface defaults.

```java
public interface PriceCalculator {
    long basePrice(String sku);

    default long priceWithTax(String sku) {
        return applyTax(basePrice(sku));
    }

    private long applyTax(long cents) { return Math.round(cents * 1.18); }

    static PriceCalculator flat(long cents) { return sku -> cents; }
}

PriceCalculator calc = PriceCalculator.flat(1000);
System.out.println(calc.priceWithTax("SKU-1")); // 1180
```

- Program to interfaces (`List`, `Map`, `PriceCalculator`) in method signatures; it keeps implementations swappable and code testable.
- Pitfall: piling business logic into default methods turns interfaces into hidden abstract classes; keep defaults small and derivable from abstract methods.

### Functional interfaces
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/function/package-summary.html -->
A functional interface has exactly one abstract method, so it can be the target type of a lambda or method reference. `@FunctionalInterface` is optional but makes the compiler enforce the single-method rule.

The `java.util.function` package provides the standard shapes so you rarely need to define your own:
- `Supplier<T>`: no input, returns T.
- `Consumer<T>` / `BiConsumer<T,U>`: takes input, returns nothing.
- `Function<T,R>` / `BiFunction<T,U,R>`: transforms input to output.
- `Predicate<T>`: returns boolean.
- `UnaryOperator<T>`, `BinaryOperator<T>`: same type in and out.
- Primitive specialisations such as `IntPredicate`, `ToLongFunction`, `IntBinaryOperator` avoid boxing.

Many have composition defaults: `andThen`, `compose`, `and`, `or`, `negate`.

```java
Predicate<String> notBlank = s -> !s.isBlank();
Predicate<String> shortWord = s -> s.length() < 6;
Function<String, String> trim = String::strip;
Function<String, Integer> length = trim.andThen(String::length);

List<String> words = List.of(" apple ", "", "banana split");
words.stream()
     .filter(notBlank.and(shortWord.negate()))
     .map(length)
     .forEach(System.out::println);   // 12

@FunctionalInterface
interface RetryPolicy { boolean shouldRetry(int attempt, Throwable error); }
```

- Define your own interface when a domain name (`RetryPolicy`) communicates more than `BiPredicate<Integer, Throwable>`.
- Pitfall: standard functional interfaces cannot throw checked exceptions, which is why lambdas around I/O get awkward.

### Generics basics
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/java/generics/index.html -->
Generics let you parameterise classes, interfaces and methods by type, so the compiler can check types that would otherwise need casts. `List<String>` guarantees at compile time that only strings go in, and reading needs no cast.

A generic class declares type parameters after its name (`class Box<T>`); a generic method declares them before the return type (`static <T> T first(List<T> list)`). The diamond operator (`new ArrayList<>()`) lets the compiler infer type arguments. Type parameters can be bounded: `<T extends Comparable<T>>` means T must be comparable to itself, so the method can call `compareTo`.

```java
public final class Result<T> {
    private final T value;
    private final String error;
    private Result(T value, String error) { this.value = value; this.error = error; }

    public static <T> Result<T> ok(T value) { return new Result<>(value, null); }
    public static <T> Result<T> fail(String error) { return new Result<>(null, error); }

    public <R> Result<R> map(Function<? super T, ? extends R> f) {
        return error == null ? ok(f.apply(value)) : fail(error);
    }
}

static <T extends Comparable<? super T>> T max(Collection<? extends T> items) {
    Iterator<? extends T> it = items.iterator();
    T best = it.next();
    while (it.hasNext()) { T x = it.next(); if (x.compareTo(best) > 0) best = x; }
    return best;
}
```

- Pitfall: raw types (`List` without type arguments) disable checking and exist only for pre-Java-5 compatibility; never use them in new code.
- Generic type parameters cannot be primitives (until Project Valhalla); `List<int>` is illegal.

### Wildcards, variance and PECS
<!-- level: advanced; ref: https://docs.oracle.com/javase/tutorial/java/generics/wildcards.html -->
Generic types are invariant: `List<Integer>` is not a `List<Number>`, even though `Integer` is a `Number`. If it were, you could add a `Double` into a list of integers. Wildcards restore flexibility at use sites:
- `? extends T` (upper bound, covariant): you can read T out but cannot add (except null). Use for producers.
- `? super T` (lower bound, contravariant): you can add T in but reads only give `Object`. Use for consumers.
- `?` (unbounded): you only need `Object` methods.

The mnemonic is PECS: Producer Extends, Consumer Super. `Collections.copy(List<? super T> dest, List<? extends T> src)` is the textbook example.

```java
static double sum(Collection<? extends Number> numbers) {      // producer
    double total = 0;
    for (Number n : numbers) total += n.doubleValue();
    return total;
}

static void addDefaults(List<? super Integer> sink) {           // consumer
    sink.add(0); sink.add(1);
}

sum(List.of(1, 2, 3));           // List<Integer> OK
sum(List.of(1.5, 2.5));          // List<Double> OK
List<Number> nums = new ArrayList<>();
addDefaults(nums);               // List<Number> accepts Integers
```

- Interview tip: explain why arrays are covariant (and fail at runtime with `ArrayStoreException`) while generics are invariant (and fail at compile time).
- Do not put wildcards in return types; they push complexity onto every caller.

### Type erasure
<!-- level: advanced; ref: https://docs.oracle.com/javase/tutorial/java/generics/erasure.html -->
Java implements generics by erasure: type arguments are checked at compile time and then removed. In bytecode `List<String>` and `List<Integer>` are both just `List`; type parameters are replaced by their bound (`Object` or the declared bound), and the compiler inserts casts at use sites. This kept full binary compatibility with pre-generics code in Java 5.

Consequences you must know:
- No `new T()`, `new T[]`, or `instanceof List<String>` at runtime.
- You cannot overload `void f(List<String>)` and `void f(List<Integer>)`: same erasure.
- Static fields are shared across all parameterisations.
- The compiler generates bridge methods so overriding still works after erasure.
- Heap pollution: mixing raw types or generic varargs can put a wrong type into a collection, failing later with `ClassCastException` far from the cause.

Some type information does survive in class metadata (field, method and superclass signatures), which frameworks such as Jackson and Spring read through reflection, the "super type token" trick.

```java
static <T> T create(Class<T> type) throws ReflectiveOperationException {
    return type.getDeclaredConstructor().newInstance();   // pass a Class token instead of new T()
}

// Super type token: subclass captures the generic type in metadata
var listType = new TypeReference<List<Order>>() {};       // e.g. Jackson
```

- Pitfall: `@SafeVarargs` is only safe if the method does not store into or expose the varargs array.

## 5. Collections Framework

### Collections overview and List
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/collections/index.html -->
The Collections Framework is a set of interfaces (`Collection`, `List`, `Set`, `Queue`, `Deque`, `Map`) with interchangeable implementations and algorithms in `Collections`. Code should depend on the interface and choose the implementation for its performance profile.

`List` is an ordered, index-based sequence that allows duplicates.
- `ArrayList` is backed by a resizable array: O(1) random access and amortised O(1) append; inserting or removing in the middle shifts elements, O(n). It grows by about 50% when full. This is the default choice.
- `LinkedList` is a doubly linked list: O(1) insert/remove at the ends or at an iterator position, but O(n) access by index and poor cache locality. In practice it is rarely faster than `ArrayList`, and `ArrayDeque` is better for queues.
- `CopyOnWriteArrayList` copies on every write; great for read-mostly listener lists.

```java
List<String> tasks = new ArrayList<>(1_000);   // pre-size if you know the volume
tasks.add("build");
tasks.add(0, "checkout");                      // shifts elements
tasks.removeIf(t -> t.startsWith("skip"));
tasks.sort(Comparator.naturalOrder());
List<String> firstTwo = tasks.subList(0, 2);   // a view, not a copy

List<Integer> ids = new ArrayList<>(List.of(10, 20, 30));
ids.remove(1);                     // removes index 1 (20)
ids.remove(Integer.valueOf(10));   // removes the value 10
```

- Pitfall: `remove(int)` vs `remove(Object)` on a `List<Integer>` is a classic bug.
- Pitfall: `Arrays.asList` returns a fixed-size list backed by the array; `add` throws `UnsupportedOperationException`.

### Sets and Maps
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/collections/interfaces/map.html -->
A `Set` holds unique elements; a `Map` associates unique keys with values. Uniqueness is defined by `equals`/`hashCode` for hash-based types and by comparison for sorted types.

- `HashSet`/`HashMap`: hash table, average O(1), no ordering guarantee. Capacity is a power of two; buckets turn into red-black trees under heavy collisions.
- `LinkedHashSet`/`LinkedHashMap`: hash table plus a linked list, preserving insertion order (or access order, which makes an easy LRU cache via `removeEldestEntry`).
- `TreeSet`/`TreeMap`: red-black tree, O(log n), sorted, with range queries.
- `EnumMap`/`EnumSet`: array/bitset-backed, fastest for enum keys.

`Map` has powerful default methods: `getOrDefault`, `putIfAbsent`, `computeIfAbsent`, `merge`, `compute`.

```java
Map<String, List<Order>> byCustomer = new HashMap<>();
for (Order o : orders) {
    byCustomer.computeIfAbsent(o.customerId(), k -> new ArrayList<>()).add(o);
}

Map<String, Integer> wordCount = new TreeMap<>();
for (String w : text.split("\\s+")) wordCount.merge(w, 1, Integer::sum);

class LruCache<K, V> extends LinkedHashMap<K, V> {
    private final int max;
    LruCache(int max) { super(16, 0.75f, true); this.max = max; }   // access order
    @Override protected boolean removeEldestEntry(Map.Entry<K, V> e) { return size() > max; }
}
```

- Pitfall: mutable objects as keys; changing a field used in `hashCode` loses the entry.
- Pitfall: `HashMap` iteration order is unspecified and can change between JDK versions; never depend on it.

### Ordering with Comparable and Comparator
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/collections/interfaces/order.html -->
`Comparable<T>` gives a class its natural ordering through `compareTo`, which returns a negative number, zero or positive number. `String`, numbers and `LocalDate` are comparable. `Comparator<T>` is an external ordering you can define separately and compose, which is better when there are several sensible orders.

Since Java 8 comparators are built fluently: `Comparator.comparing(keyExtractor)`, `thenComparing`, `reversed`, `nullsFirst`/`nullsLast`. Sorting uses TimSort for objects, a stable merge-insertion hybrid, so equal elements keep their original relative order, which lets you sort by multiple keys in passes.

`TreeMap`, `TreeSet` and `PriorityQueue` use the comparator to define equality too: two elements comparing as 0 are considered duplicates. Keep `compareTo` consistent with `equals` to avoid surprises.

```java
record Employee(String name, String dept, int salary) {}

List<Employee> staff = new ArrayList<>(loadStaff());
staff.sort(Comparator.comparing(Employee::dept)
                     .thenComparing(Employee::salary, Comparator.reverseOrder())
                     .thenComparing(Employee::name));

record Version(int major, int minor) implements Comparable<Version> {
    public int compareTo(Version o) {
        return Comparator.comparingInt(Version::major)
                         .thenComparingInt(Version::minor)
                         .compare(this, o);
    }
}
```

- Pitfall: `(a, b) -> a.value - b.value` overflows for large or negative values; use `Integer.compare`.
- Pitfall: a comparator inconsistent with equals makes `TreeSet` silently drop "duplicate" elements.

### Queues, Deques and PriorityQueue
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/collections/interfaces/deque.html -->
A `Queue` processes elements in a defined order, usually FIFO. Each operation comes in two flavours: one that throws (`add`, `remove`, `element`) and one that returns a special value (`offer`, `poll`, `peek`). A `Deque` (double-ended queue) supports insertion and removal at both ends and doubles as a stack (`push`/`pop`).

- `ArrayDeque`: circular array, the fastest general-purpose queue and stack. Prefer it over the legacy synchronized `Stack` class and over `LinkedList`. It rejects nulls.
- `PriorityQueue`: a binary heap where `poll` always returns the smallest element by natural order or comparator. `offer`/`poll` are O(log n), `peek` O(1). Iteration order is not sorted.
- `BlockingQueue` implementations (`ArrayBlockingQueue`, `LinkedBlockingQueue`) add blocking `put`/`take` for producer-consumer designs between threads.

```java
Deque<Character> stack = new ArrayDeque<>();
for (char c : "{[()]}".toCharArray()) {
    if ("([{".indexOf(c) >= 0) stack.push(c);
    else if (stack.isEmpty() || "([{".indexOf(stack.pop()) != ")]}".indexOf(c)) {
        throw new IllegalStateException("unbalanced");
    }
}

record Job(String id, int priority) {}
PriorityQueue<Job> jobs = new PriorityQueue<>(Comparator.comparingInt(Job::priority).reversed());
jobs.offer(new Job("a", 1));
jobs.offer(new Job("b", 5));
System.out.println(jobs.poll().id());   // "b"
```

- Interview tip: "top K" problems use a size-K min-heap: O(n log K).
- Pitfall: changing a field that affects priority while the element is inside the heap corrupts ordering; remove and re-insert.

### Immutable and sequenced collections
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/SequencedCollection.html -->
Java 9 added compact factory methods `List.of`, `Set.of` and `Map.of`, and Java 10 added `List.copyOf` and friends. These return unmodifiable collections: any mutating call throws `UnsupportedOperationException`. They reject null elements, `Set.of`/`Map.of` reject duplicates, and `Set.of`/`Map.of` deliberately randomise iteration order per JVM run so nobody depends on it. `Stream.toList()` (Java 16) also returns an unmodifiable list.

Unmodifiable views (`Collections.unmodifiableList(list)`) are different: they block writes through the view, but changes to the backing list still show through.

Java 21 introduced sequenced collections (JEP 431): new interfaces `SequencedCollection`, `SequencedSet` and `SequencedMap` give every ordered collection uniform `getFirst`, `getLast`, `addFirst`, `addLast`, `removeFirst`, `removeLast` and a `reversed()` view. `List`, `Deque`, `LinkedHashSet`, `SortedSet`, `LinkedHashMap` and `SortedMap` all implement them.

```java
List<String> roles = List.of("admin", "editor");
// roles.add("viewer");      // UnsupportedOperationException

List<String> history = new ArrayList<>(List.of("v1", "v2", "v3"));
String latest = history.getLast();        // "v3" (Java 21), was get(size()-1)
for (String v : history.reversed()) { }   // reverse view, no copy

LinkedHashMap<String, Integer> lru = new LinkedHashMap<>();
lru.putFirst("hot", 1);                    // Java 21
var oldest = lru.lastEntry();
```

- Pitfall: `List.of(...).contains(null)` throws `NullPointerException`.
- Returning `List.copyOf` from getters is a cheap way to keep classes immutable.

### Iteration and ConcurrentModificationException
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ConcurrentModificationException.html -->
Most `java.util` collections have fail-fast iterators. Each collection keeps a `modCount` that increments on structural changes; the iterator records the value when created and throws `ConcurrentModificationException` (CME) on the next call if it changed. Despite the name, this usually happens in single-threaded code: modifying a list while looping over it with for-each.

Fail-fast detection is best-effort, not a guarantee, so it must never be relied upon for correctness in concurrent code. Concurrent collections (`ConcurrentHashMap`, `CopyOnWriteArrayList`) instead have weakly consistent or snapshot iterators that never throw CME.

```java
List<String> users = new ArrayList<>(List.of("ann", "bob", "cat"));

// Wrong: throws ConcurrentModificationException
// for (String u : users) if (u.startsWith("b")) users.remove(u);

// Right: explicit iterator
for (Iterator<String> it = users.iterator(); it.hasNext(); ) {
    if (it.next().startsWith("b")) it.remove();
}

// Better: bulk operation
users.removeIf(u -> u.startsWith("c"));

// Maps
Map<String, Integer> stock = new HashMap<>(Map.of("a", 0, "b", 3));
stock.entrySet().removeIf(e -> e.getValue() == 0);
stock.replaceAll((k, v) -> v * 2);
```

- Pitfall: sharing a plain `ArrayList` between threads may not throw CME at all; it may silently lose data or corrupt internal state instead.
- Interview tip: removing the second-to-last element in a for-each loop does not throw, because `hasNext()` returns false first; a famous trick question.

## 6. Exceptions

### Exception hierarchy: checked vs unchecked
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/essential/exceptions/index.html -->
Everything throwable extends `Throwable`, which has two branches. `Error` represents serious JVM or environment problems (`OutOfMemoryError`, `StackOverflowError`) that applications should not normally catch. `Exception` represents conditions a program might handle.

Checked exceptions are subclasses of `Exception` that are not `RuntimeException`; the compiler forces callers to catch them or declare them with `throws`. Unchecked exceptions (`RuntimeException` and its subclasses) need no declaration and typically signal programming errors: `NullPointerException`, `IllegalArgumentException`, `IllegalStateException`, `IndexOutOfBoundsException`.

When thrown, an exception captures the stack trace (an expensive step) and unwinds frames until a matching `catch` is found; if none is found, the thread's uncaught exception handler runs and the thread dies.

```java
public Config load(Path file) throws IOException {        // checked: callers must decide
    String text = Files.readString(file);
    if (text.isBlank()) {
        throw new IllegalStateException("config is empty: " + file); // unchecked: a bug or bad state
    }
    return parse(text);
}
```

- Modern style (and frameworks like Spring) leans toward unchecked exceptions for most failures, using checked ones only where the caller can realistically recover.
- Helpful NullPointerExceptions (Java 14+) name exactly which expression was null: "Cannot invoke String.length() because user.name is null".
- Pitfall: catching `Throwable` or `Error` can swallow `OutOfMemoryError` and leave the JVM in a broken state.

### try, catch, finally and multi-catch
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/essential/exceptions/handling.html -->
A `try` block wraps code that may throw. `catch` blocks are checked in order, so more specific types must come first. Multi-catch (`catch (IOException | SQLException e)`) handles several unrelated types with one block. A `finally` block always runs, whether the try completes normally, throws, or returns, which makes it the traditional place for cleanup.

Exception chaining keeps the root cause: wrap a low-level exception in a higher-level one by passing it as the `cause`, so the stack trace shows "Caused by:". Rethrowing a more precise type is allowed when the compiler can prove what the block throws.

```java
public Order fetchOrder(String id) {
    try {
        String json = http.get("/orders/" + id);
        return mapper.readValue(json, Order.class);
    } catch (HttpTimeoutException e) {
        throw new ServiceUnavailableException("order service timed out", e); // keep cause
    } catch (IOException | IllegalArgumentException e) {
        throw new OrderLookupException("could not read order " + id, e);
    } finally {
        metrics.increment("order.fetch");
    }
}
```

- Pitfall: a `return` or `throw` inside `finally` silently discards the original exception. Never do it.
- Pitfall: `catch (Exception e) { }` (swallowing) hides failures; at minimum log with the stack trace or rethrow.
- Pitfall: logging and rethrowing at every layer produces duplicate stack traces; handle or propagate, not both.

### try-with-resources
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html -->
try-with-resources (Java 7) automatically closes anything implementing `AutoCloseable` at the end of the block, in reverse order of declaration, even when exceptions occur. It replaces error-prone nested `finally` blocks.

Crucially, it handles the double-failure case correctly: if the body throws and then `close()` also throws, the body's exception propagates and the close failure is attached as a suppressed exception (`getSuppressed()`), so no information is lost. With hand-written finally blocks the close exception often masks the real one.

Since Java 9 you can reference an existing effectively-final variable in the resource list.

```java
public long countActiveUsers(DataSource ds) throws SQLException {
    String sql = "SELECT count(*) FROM users WHERE active = ?";
    try (Connection con = ds.getConnection();
         PreparedStatement ps = con.prepareStatement(sql)) {
        ps.setBoolean(1, true);
        try (ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getLong(1);
        }
    } // ps closed, then con closed: connection returned to the pool
}

final var lock = new ReentrantLockResource();
try (lock) { /* Java 9+: effectively final variable as resource */ }
```

- Make your own resource classes implement `AutoCloseable`, and make `close()` idempotent.
- Pitfall: streams from `Files.lines` or `Files.list` hold file handles; they must be closed with try-with-resources.

### Custom exceptions and error-handling design
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/essential/exceptions/creating.html -->
Create a custom exception when callers need to distinguish a failure type, or when you want to attach domain data (an order id, an error code). Extend `RuntimeException` for most application errors, or `Exception` only if callers must handle it. Always provide a constructor that accepts a cause.

Good error-handling design:
- Fail fast: validate inputs at boundaries with `Objects.requireNonNull` and `IllegalArgumentException`.
- Throw at the right abstraction level: a repository should not leak `SQLException` to a controller; translate it.
- Do not use exceptions for normal control flow; creating a stack trace is costly. For expected outcomes return `Optional`, a result type, or a sealed hierarchy.
- Handle centrally: in web apps, map exceptions to HTTP responses in one place (for example Spring's `@RestControllerAdvice`).

```java
public class InsufficientFundsException extends RuntimeException {
    private final String accountId;
    private final long shortfallCents;

    public InsufficientFundsException(String accountId, long shortfallCents) {
        super("Account " + accountId + " short by " + shortfallCents + " cents");
        this.accountId = accountId;
        this.shortfallCents = shortfallCents;
    }
    public String accountId() { return accountId; }
    public long shortfallCents() { return shortfallCents; }
}
```

- Performance tip: for high-frequency, expected exceptions you can override `fillInStackTrace` or use the protected constructor with `writableStackTrace=false`.
- Pitfall: putting sensitive data (passwords, card numbers) in exception messages that end up in logs.

## 7. Lambdas and Streams

### Lambdas and method references
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/java/javaOO/lambdaexpressions.html -->
A lambda is a concise implementation of a functional interface: `(params) -> expression` or `(params) -> { statements }`. Parameter types are usually inferred from the target type. Method references are shorthand for lambdas that just call an existing method, in four forms: static (`Integer::parseInt`), bound instance (`System.out::println`), unbound instance (`String::length`) and constructor (`ArrayList::new`).

Lambdas can capture local variables only if they are effectively final; captured values are copied into the lambda. This rule prevents data races on stack variables and confusing semantics.

Under the hood lambdas are not anonymous classes. The compiler emits an `invokedynamic` instruction and the lambda body as a private method; at first call `LambdaMetafactory` spins up an implementation class. Non-capturing lambdas are cached as singletons, so they cost no allocation per call.

```java
List<String> names = List.of("Zoe", "adam", "Bob");
List<String> sorted = new ArrayList<>(names);
sorted.sort(String::compareToIgnoreCase);

int minLength = 3;                       // effectively final, can be captured
names.stream()
     .filter(n -> n.length() >= minLength)
     .map(String::toUpperCase)
     .forEach(System.out::println);

Supplier<List<String>> factory = ArrayList::new;
Function<String, Integer> parse = Integer::parseInt;
BiFunction<String, Integer, Character> charAt = String::charAt;
```

- Pitfall: `this` inside a lambda refers to the enclosing instance, so a lambda stored long-term can retain its outer object.
- Keep lambdas short; extract a named method when the body exceeds a few lines.

### Stream pipelines
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/package-summary.html -->
A stream is a lazy pipeline of operations over a data source (collection, array, file lines, generator). A pipeline has a source, zero or more intermediate operations (`filter`, `map`, `flatMap`, `sorted`, `distinct`, `limit`) that return new streams, and one terminal operation (`collect`, `toList`, `forEach`, `reduce`, `count`, `anyMatch`, `findFirst`) that triggers execution.

Nothing runs until the terminal operation. Elements then flow one at a time through the whole chain (loop fusion), and short-circuiting operations like `findFirst`, `anyMatch` and `limit` stop early, so infinite streams are possible. Stateful operations like `sorted` must buffer everything. A stream can be consumed only once.

Primitive streams (`IntStream`, `LongStream`, `DoubleStream`) avoid boxing and offer `sum`, `average`, `range` and `summaryStatistics`.

```java
record Order(String customer, String status, double amount, List<String> items) {}

double revenue = orders.stream()
    .filter(o -> o.status().equals("PAID"))
    .mapToDouble(Order::amount)
    .sum();

List<String> topItems = orders.stream()
    .flatMap(o -> o.items().stream())
    .distinct()
    .sorted()
    .limit(10)
    .toList();                               // Java 16, unmodifiable

boolean anyLarge = orders.stream().anyMatch(o -> o.amount() > 10_000);
IntStream.rangeClosed(1, 5).map(i -> i * i).forEach(System.out::println);
```

- Pitfall: side effects in `map`/`filter` (mutating external lists) break under parallelism and obscure logic.
- Pitfall: `peek` is for debugging; it may not run at all if the terminal operation can skip elements (`count()` on a sized stream).
- Streams are not always faster than loops; choose them for clarity.

### Collectors and grouping
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/Collectors.html -->
`collect` performs a mutable reduction using a `Collector`, which defines a supplier (new container), accumulator (add element), combiner (merge partial results for parallel streams) and finisher. The `Collectors` class provides most of what you need:
- `toList()`, `toSet()`, `toMap(keyFn, valueFn, mergeFn)`.
- `joining(", ", "[", "]")` for strings.
- `groupingBy(classifier, downstream)`: a SQL-like GROUP BY that returns a `Map`.
- `partitioningBy(predicate)`: always two keys, true and false.
- Downstream collectors: `counting()`, `summingLong`, `averagingDouble`, `mapping`, `filtering`, `maxBy`, `collectingAndThen`.
- `teeing` (Java 12) combines two collectors into one result.

```java
Map<String, Long> ordersPerCustomer = orders.stream()
    .collect(Collectors.groupingBy(Order::customer, Collectors.counting()));

Map<String, Double> revenueByStatus = orders.stream()
    .collect(Collectors.groupingBy(Order::status, TreeMap::new,
             Collectors.summingDouble(Order::amount)));

Map<Boolean, List<Order>> bigVsSmall = orders.stream()
    .collect(Collectors.partitioningBy(o -> o.amount() > 1000));

Map<String, Order> latestById = orders.stream()
    .collect(Collectors.toMap(Order::id, o -> o,
             (a, b) -> a.createdAt().isAfter(b.createdAt()) ? a : b));

String csv = names.stream().collect(Collectors.joining(","));
```

- Pitfall: `toMap` without a merge function throws `IllegalStateException` on duplicate keys, and it throws `NullPointerException` on null values.
- Pitfall: deeply nested `groupingBy` chains become unreadable; consider a record as a composite key.

### Optional
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Optional.html -->
`Optional<T>` is a container that holds either a value or nothing. It was designed as a return type for methods that may have no result, making absence explicit in the signature so callers cannot forget to handle it, unlike a null return.

Use its functional API instead of `isPresent()` plus `get()`:
- `map`, `flatMap`, `filter` transform the value if present.
- `orElse(value)` always evaluates its argument; `orElseGet(supplier)` evaluates lazily.
- `orElseThrow()` (Java 10) throws `NoSuchElementException`; `orElseThrow(supplier)` throws your own exception.
- `ifPresentOrElse`, `or`, and `stream()` (Java 9).

```java
public Optional<User> findByEmail(String email) {
    return Optional.ofNullable(cache.get(email));
}

String city = userRepo.findByEmail("a@b.com")
    .flatMap(User::address)                 // address() returns Optional<Address>
    .map(Address::city)
    .filter(c -> !c.isBlank())
    .orElse("Unknown");

User user = userRepo.findByEmail(email)
    .orElseThrow(() -> new UserNotFoundException(email));

Config cfg = loadFromFile().orElseGet(this::expensiveDefault); // lazy
```

Guidelines:
- Do not use Optional for fields, method parameters or collections (return an empty list instead).
- Never return null from a method declared to return Optional.
- Avoid it in hot paths; it allocates a wrapper (escape analysis often, but not always, removes it).
- Pitfall: `orElse(createDefault())` runs `createDefault()` even when a value is present.

### Parallel streams
<!-- level: advanced; ref: https://docs.oracle.com/javase/tutorial/collections/streams/parallelism.html -->
Calling `parallelStream()` or `.parallel()` splits the source with a `Spliterator` and processes chunks on the common `ForkJoinPool`, which has roughly one thread per CPU core minus one. Results are combined with the collector's combiner.

Parallelism helps only when all of these hold: lots of data (tens of thousands of elements or more), CPU-heavy per-element work, an easily splittable source (arrays, `ArrayList`, `IntStream.range`; not `LinkedList` or `Stream.iterate`), stateless and non-interfering operations, and an associative reduction. Otherwise the splitting and merging overhead makes it slower.

Big production risk: every parallel stream in the JVM shares the common pool. Blocking I/O inside a parallel stream starves all other parallel work, including `CompletableFuture` tasks that use the default executor.

```java
// Good candidate: CPU-bound, array-backed, associative
long primes = LongStream.rangeClosed(2, 5_000_000).parallel()
                        .filter(Primes::isPrime)
                        .count();

// Bad: shared mutable state, a data race
List<Integer> out = new ArrayList<>();
IntStream.range(0, 1000).parallel().forEach(out::add);   // lost updates or exceptions

// Correct
List<Integer> safe = IntStream.range(0, 1000).parallel().boxed().toList();
```

- `findFirst` and `forEachOrdered` keep encounter order but reduce parallel benefit; use `findAny` and `unordered()` if order does not matter.
- Measure with JMH before and after; never parallelise by default.

### Stream gatherers (Java 24)
<!-- level: advanced; ref: https://docs.oracle.com/en/java/javase/24/docs/api/java.base/java/util/stream/Gatherers.html -->
Before Java 24 you could not add your own intermediate operations to streams; only terminal collectors were extensible. Stream gatherers (JEP 485, final in Java 24, so available in the Java 25 LTS) add `Stream.gather(Gatherer)`, which lets you write custom intermediate operations that can be stateful, one-to-many, many-to-one, and short-circuiting.

A `Gatherer` has an optional initializer (per-stream state), an integrator (called for each element, can push zero or more outputs downstream and can stop early), an optional combiner for parallel use and an optional finisher (flush remaining state). The `Gatherers` class ships ready-made ones:
- `windowFixed(n)`: non-overlapping batches.
- `windowSliding(n)`: overlapping windows, good for moving averages.
- `fold` and `scan`: running accumulation.
- `mapConcurrent(n, fn)`: applies a function concurrently using virtual threads, with at most n in flight, preserving order.

```java
// Batch inserts of 500 rows
rows.stream()
    .gather(Gatherers.windowFixed(500))
    .forEach(batch -> repository.insertAll(batch));

// Moving average over 3 readings
List<Double> avg = readings.stream()
    .gather(Gatherers.windowSliding(3))
    .map(w -> w.stream().mapToDouble(Double::doubleValue).average().orElse(0))
    .toList();

// Call a slow API for each id, at most 20 in flight
List<Price> prices = ids.stream()
    .gather(Gatherers.mapConcurrent(20, pricingClient::fetch))
    .toList();
```

- Version note: requires Java 24+; on Java 21 you need loops or third-party libraries for windowing.
