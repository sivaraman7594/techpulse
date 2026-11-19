## 1. Getting Started with Java

### JDK, JVM and bytecode
<!-- level: basic; ref: https://dev.java/learn/ -->
Java source code is not compiled straight to machine code. The `javac` compiler turns `.java` files into `.class` files containing bytecode, a compact instruction set for an abstract stack machine. The Java Virtual Machine (JVM) loads that bytecode, verifies it, interprets it, and compiles hot paths to native code with its just-in-time (JIT) compiler. This is why the same JAR runs on Linux, macOS and Windows.

You install a JDK (Java Development Kit), which bundles the JVM, the standard library and tools such as `javac`, `java`, `jar`, `jshell`, `jlink`, `jcmd` and `jfr`. Several vendors build the OpenJDK sources (Oracle, Eclipse Temurin, Amazon Corretto, Azul, Microsoft); they are functionally equivalent. Long-term-support (LTS) releases are 17, 21 and 25 (September 2025); a new feature release ships every six months.

```bash
javac -d out src/com/acme/App.java   # compile to bytecode
java -cp out com.acme.App            # run on the JVM
java src/com/acme/App.java           # source-file mode: compile in memory and run
```

- Pitfall: compiling with a newer JDK than the runtime gives `UnsupportedClassVersionError`. Use `--release 21` to target an older platform safely.
- Interview tip: "write once, run anywhere" comes from bytecode plus a JVM per platform, not from the language itself.

### Your first program and the main method
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/getStarted/application/index.html -->
A classic Java program is a public class with a `public static void main(String[] args)` method. The JVM looks for that method in the class you name on the command line and calls it on the main thread. `args` holds command-line arguments.

Since Java 25 (JEP 512, final) beginners can write a compact source file: top-level methods and fields with no explicit class, and an instance `main` with no parameters. The compiler wraps it in an implicit class, auto-imports the `java.base` module, and the new `java.lang.IO` class offers `IO.println` and `IO.readln`.

```java
// Classic form (every Java version)
package com.acme;

public class App {
    public static void main(String[] args) {
        System.out.println("Hello, " + (args.length > 0 ? args[0] : "world"));
    }
}
```

```java
// Java 25 compact source file: Hello.java
void main() {
    String name = IO.readln("Name? ");
    IO.println("Hello, " + name);
}
```

- Pitfall: the file name must match the public class name (`App.java` for `public class App`).
- Compact source files are meant for scripts and learning; production code still uses named classes in packages.

### Packages, imports and the classpath
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/package/index.html -->
A package is a namespace that groups related types and controls visibility. The package name mirrors the directory layout: `com.acme.billing.Invoice` lives in `com/acme/billing/Invoice.java`. By convention packages use a reversed domain name so names never collide across libraries.

`import` statements are only a compile-time shortcut for naming types; they do not load or include code. Everything in `java.lang` (String, Math, Integer) is imported automatically. `import static` brings in static members, and Java 25 adds `import module java.sql;` (JEP 511) to import every exported package of a module at once.

At runtime the JVM finds classes via the classpath (directories and JARs passed with `-cp`) or the module path (`-p`) for modular code.

```java
package com.acme.billing;

import java.time.LocalDate;
import java.util.List;
import static java.util.Objects.requireNonNull;

public class InvoiceService {
    public List<LocalDate> dueDates(List<Invoice> invoices) {
        requireNonNull(invoices);
        return invoices.stream().map(Invoice::dueDate).toList();
    }
}
```

- Pitfall: wildcard imports (`java.util.*`) can cause ambiguity, e.g. `java.util.List` vs `java.awt.List`.
- `ClassNotFoundException` / `NoClassDefFoundError` at runtime usually mean a missing JAR on the classpath, not a code bug.

### JShell and quick experiments
<!-- level: basic; ref: https://docs.oracle.com/en/java/javase/21/jshell/introduction-jshell.html -->
JShell (since Java 9) is Java's REPL: a read-eval-print loop where you type expressions, statements and declarations and see results immediately without writing a class or `main`. It is ideal for checking API behaviour, learning syntax, or reproducing a bug in isolation.

Under the hood JShell wraps each snippet in synthetic classes, compiles it with the normal compiler and runs it in a separate JVM, so behaviour matches real Java. Useful commands include `/vars`, `/methods`, `/imports`, `/edit`, `/save` and `/open`.

```text
$ jshell
jshell> var list = new java.util.ArrayList<>(java.util.List.of(3, 1, 2))
list ==> [3, 1, 2]
jshell> list.sort(null); list
$2 ==> [1, 2, 3]
jshell> "abc".repeat(3)
$3 ==> "abcabcabc"
jshell> /exit
```

For slightly bigger experiments, source-file mode (`java Script.java`) compiles and runs a file in memory; since Java 22 it can even launch programs spread over several source files (JEP 458).

- Interview tip: knowing JShell and source-file mode shows you can test assumptions quickly instead of guessing.

## 2. Language Basics

### Primitive types
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/nutsandbolts/datatypes.html -->
Java has eight primitive types that hold raw values, not object references: `byte` (8-bit), `short` (16), `int` (32), `long` (64), `float` (32-bit IEEE 754), `double` (64-bit), `char` (16-bit UTF-16 code unit) and `boolean`. Their sizes are fixed by the specification on every platform, unlike C.

Local primitives live in the stack frame; primitive fields are stored inline inside their object. They are never null and cost no object header, which is why numeric code uses `int`/`double` rather than `Integer`/`Double`.

Integer arithmetic silently overflows (wraps around in two's complement). Floating-point values are approximations, so `0.1 + 0.2` is not exactly `0.3`.

```java
int max = Integer.MAX_VALUE;
System.out.println(max + 1);              // -2147483648 (overflow)
System.out.println(Math.addExact(1, 2));  // throws ArithmeticException on overflow
long big = 3_000_000_000L;                // L suffix needed for long literals
double d = 0.1 + 0.2;                     // 0.30000000000000004
var money = new java.math.BigDecimal("0.10").add(new java.math.BigDecimal("0.20")); // 0.30
char c = 'A'; int code = c;               // widening: 65
```

- Pitfall: never use `double` for money; use `BigDecimal` constructed from a String, or long minor units (cents).
- Pitfall: `char` cannot represent every Unicode character (emoji need two `char`s); use code points.

### Wrapper classes and autoboxing
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/data/autoboxing.html -->
Every primitive has a wrapper class (`Integer`, `Long`, `Double`, `Boolean`, `Character` ...). Generics and collections only work with objects, so the compiler automatically boxes (`int` to `Integer` via `Integer.valueOf`) and unboxes (`intValue()`) where needed.

Boxing has costs: each boxed value is a heap object with a header (around 16 bytes) and adds pointer chasing. `Integer.valueOf` caches values from -128 to 127, which creates a famous trap: `==` compares references, so small boxed numbers appear equal while large ones do not.

```java
Integer a = 127, b = 127;
Integer x = 1000, y = 1000;
System.out.println(a == b);       // true  (cached instances)
System.out.println(x == y);       // false (different objects)
System.out.println(x.equals(y));  // true  (compare values)

Map<String, Integer> counts = new HashMap<>();
int n = counts.get("missing");    // NullPointerException when unboxing null!
int safe = counts.getOrDefault("missing", 0);
```

- Pitfall: unboxing a null wrapper throws `NullPointerException`; this often hides in map lookups and ternaries.
- Pitfall: a `List<Integer>` summing loop allocates on every iteration; prefer `IntStream` or `int[]` in hot code.
- Interview tip: always compare wrappers with `equals` (or unbox explicitly), never `==`.

### Local variable type inference with var
<!-- level: basic; ref: https://docs.oracle.com/en/java/javase/21/language/local-variable-type-inference.html -->
Since Java 10, `var` lets the compiler infer the static type of a local variable from its initializer. It is not dynamic typing: the type is fixed at compile time exactly as if you had written it, and the bytecode is identical.

`var` works for local variables with initializers, enhanced for-loop variables, try-with-resources variables and lambda parameters (Java 11). It does not work for fields, method parameters, return types or variables without an initializer, and `var x = null;` is illegal because there is no type to infer.

```java
var orders = new ArrayList<Order>();          // ArrayList<Order>
var byCustomer = new HashMap<String, List<Order>>();
for (var entry : byCustomer.entrySet()) {
    var customer = entry.getKey();            // String
    var total = entry.getValue().size();      // int
}
try (var reader = Files.newBufferedReader(Path.of("data.csv"))) {
    reader.lines().forEach(System.out::println);
}
```

- Pitfall: `var list = new ArrayList<>();` infers `ArrayList<Object>` because the diamond has nothing to infer from.
- Pitfall: `var` captures the concrete type (`ArrayList`, not `List`), which matters if you later reassign.
- Guideline: use `var` when the type is obvious from the right-hand side; spell out the type when it aids readability, such as the result of a method call.

### Operators, casting and numeric promotion
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/nutsandbolts/operators.html -->
Java has the usual arithmetic, relational, logical (`&&`, `||` short-circuit; `&`, `|` do not), bitwise and shift operators (`<<`, `>>` sign-preserving, `>>>` zero-fill), plus the ternary `?:` and `instanceof`.

Binary numeric promotion governs mixed arithmetic: `byte`, `short` and `char` are promoted to `int` before any operation, and the result widens to the largest operand type. Widening conversions (int to long, long to double) happen implicitly; narrowing requires an explicit cast and may lose data. Compound assignment operators (`+=`) include a hidden cast.

```java
byte b = 10;
// b = b + 1;          // compile error: int result cannot go into byte
b += 1;                // OK: compiles to b = (byte)(b + 1)
int i = 7 / 2;         // 3 (integer division truncates)
double d = 7 / 2;      // 3.0 (division happened in int first!)
double e = 7 / 2.0;    // 3.5
int truncated = (int) 3.99;        // 3
int wrapped = (int) 3_000_000_000L; // -1294967296
long ms = 24 * 60 * 60 * 1000 * 1000; // overflows int before widening
long ok = 24L * 60 * 60 * 1000 * 1000;
```

- Pitfall: `%` keeps the sign of the dividend (`-7 % 3 == -1`); use `Math.floorMod` for a non-negative remainder.
- Interview tip: be ready to explain why `7 / 2` assigned to a double is 3.0.

### Strings, StringBuilder and text blocks
<!-- level: basic; ref: https://docs.oracle.com/en/java/javase/21/text-blocks/index.html -->
`String` is an immutable sequence of UTF-16 characters. Immutability makes strings safe to share across threads, to use as map keys, and to cache their hash code. Since Java 9, compact strings store Latin-1 text in one byte per character internally, halving memory for most text.

String literals are interned in a pool, so identical literals share one instance; strings built at runtime are separate objects. Always compare content with `equals`. Concatenation with `+` is compiled (since Java 9) into an efficient `invokedynamic` call, but inside a loop each iteration still creates new strings, so use `StringBuilder`.

Text blocks (Java 15) are multi-line literals delimited by three quotes; incidental indentation is stripped automatically.

```java
String a = "hi", b = new String("hi");
System.out.println(a == b);        // false
System.out.println(a.equals(b));   // true

var sb = new StringBuilder();
for (int i = 0; i < 3; i++) sb.append(i).append(',');
String csv = sb.toString();        // "0,1,2,"

String json = """
    {
      "name": "%s",
      "active": true
    }
    """.formatted("Asha");

boolean blank = "  ".isBlank();    // true (Java 11)
List<String> parts = List.of("a,b,,c".split(","));
```

- Pitfall: `split` takes a regex, so `split(".")` returns an empty array; use `split("\\.")`.
- Useful modern methods: `strip`, `lines`, `repeat`, `chars`, `formatted`.

### Control flow and loops
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/nutsandbolts/flow.html -->
Java's statements for branching and looping are `if`/`else`, the classic `for`, the enhanced for-each loop, `while`, `do`/`while`, plus `break`, `continue` and `return`. Conditions must be `boolean`; unlike C, an `int` is never treated as true or false, which eliminates the `if (x = 0)` bug.

The enhanced for loop works on arrays and anything implementing `Iterable`; the compiler turns it into an index loop for arrays and an `Iterator` loop for collections. Labels allow `break` or `continue` to target an outer loop, which is handy for nested searches.

```java
int[][] grid = {{1, 2}, {3, 42}, {5, 6}};
int row = -1, col = -1;
search:
for (int r = 0; r < grid.length; r++) {
    for (int c = 0; c < grid[r].length; c++) {
        if (grid[r][c] == 42) { row = r; col = c; break search; }
    }
}

for (String name : List.of("ana", "bo")) {
    if (name.isEmpty()) continue;
    System.out.println(name.toUpperCase());
}

int attempts = 0;
do { attempts++; } while (!connect() && attempts < 3);
```

- Pitfall: removing elements from a collection inside a for-each loop throws `ConcurrentModificationException`; use `Iterator.remove` or `removeIf`.
- Prefer streams or for-each over index loops when you do not need the index; they communicate intent and avoid off-by-one errors.

### Switch expressions
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/language/switch-expressions-and-statements.html -->
Modern Java (14+) supports switch as an expression that yields a value, using arrow labels (`case X ->`). Arrow cases never fall through, multiple labels can share a case (`case SAT, SUN ->`), and a block can produce its value with `yield`.

A switch expression must be exhaustive: every possible input must be handled. For enums and sealed types the compiler checks this, so a `default` is unnecessary, and adding a new enum constant turns into a compile error everywhere it is not handled. That is a big maintainability win over old fall-through statements.

Under the hood, switches on ints and enums compile to `tableswitch`/`lookupswitch` bytecode; switches on strings switch on `hashCode` and then confirm with `equals`.

```java
enum Day { MON, TUE, WED, THU, FRI, SAT, SUN }

static int workHours(Day day) {
    return switch (day) {
        case SAT, SUN -> 0;
        case FRI -> 6;
        case MON, TUE, WED, THU -> {
            int base = 8;
            yield base;
        }
    };
}
```

- Pitfall: a switch on a null reference throws `NullPointerException` unless you add `case null` (Java 21).
- Pitfall: mixing old colon labels and arrows in one switch is not allowed.
- Since Java 21 switch also supports type patterns; see the pattern-matching chapter.

### Arrays
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/nutsandbolts/arrays.html -->
An array is a fixed-length, zero-indexed container of elements of one type. Arrays are objects on the heap with a `length` field; their elements are default-initialised (0, false, null). Every access is bounds-checked, throwing `ArrayIndexOutOfBoundsException` instead of corrupting memory. Multi-dimensional arrays are really arrays of arrays, so rows can have different lengths.

Arrays are covariant: a `String[]` is an `Object[]`. This allows a runtime `ArrayStoreException` when you store the wrong type, one reason generics with collections are preferred. The `java.util.Arrays` class offers sort, binary search, fill, copy, equality and `toString` helpers.

```java
int[] scores = {72, 95, 88};
int[] copy = Arrays.copyOf(scores, 5);      // [72, 95, 88, 0, 0]
Arrays.sort(scores);                         // dual-pivot quicksort for primitives
System.out.println(Arrays.toString(scores)); // [72, 88, 95]

String[][] seats = new String[3][];
seats[0] = new String[]{"A1", "A2"};

Object[] objs = new String[1];
objs[0] = 42;                                // ArrayStoreException at runtime

int[] a = {1, 2}, b = {1, 2};
System.out.println(a.equals(b));             // false (identity)
System.out.println(Arrays.equals(a, b));     // true
```

- Pitfall: `System.out.println(array)` prints something like `[I@1b6d3586`; use `Arrays.toString`.
- Use arrays for fixed-size, performance-sensitive primitive data; use `List` everywhere else.

### Methods, overloading, varargs and pass-by-value
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/javaOO/methods.html -->
A method has a name, parameter list, return type and optional `throws` clause. Overloading means several methods share a name but differ in parameter types or count; the compiler chooses the most specific match at compile time. Varargs (`String... names`) accept zero or more arguments and arrive as an array.

Java is always pass-by-value. For primitives the value is copied. For objects, the reference is copied: the method can mutate the object the reference points to, but reassigning the parameter has no effect on the caller.

```java
static void reassign(StringBuilder sb) { sb = new StringBuilder("new"); }
static void mutate(StringBuilder sb)   { sb.append("!"); }

var sb = new StringBuilder("hi");
reassign(sb);  // caller still sees "hi"
mutate(sb);    // caller sees "hi!"

static int sum(int... values) {
    int total = 0;
    for (int v : values) total += v;
    return total;
}
sum();          // 0
sum(1, 2, 3);   // 6

static void log(Object o) { System.out.println("object"); }
static void log(long l)   { System.out.println("long"); }
log(5);         // "long": widening beats boxing during overload resolution
```

- Interview tip: "Java passes object references by value" is the precise answer; Java has no pass-by-reference.
- Pitfall: overloads combined with boxing and varargs become confusing; keep overload sets small and distinct.

## 3. Object-Oriented Programming

### Classes and objects
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/javaOO/classes.html -->
A class is a blueprint that defines state (fields) and behaviour (methods). An object is an instance created with `new`, which allocates memory on the heap, zeroes the fields, runs field initialisers and the constructor, and returns a reference. Variables of class type hold references, not the object itself, so assigning one variable to another makes both point to the same object.

Each object carries a header (mark word for locking and hashing, plus a class pointer); on 64-bit JVMs that is typically 12 bytes, reduced to 8 with compact object headers (product feature in Java 25, JEP 519). Objects are reclaimed automatically by the garbage collector once unreachable.

```java
public class BankAccount {
    private final String id;
    private long balanceCents;

    public BankAccount(String id) { this.id = id; }

    public void deposit(long cents) {
        if (cents <= 0) throw new IllegalArgumentException("amount must be positive");
        balanceCents += cents;
    }

    public long balance() { return balanceCents; }
}

var acc = new BankAccount("ACC-1");
var alias = acc;
alias.deposit(500);
System.out.println(acc.balance()); // 500, same object
```

- Model behaviour, not just data: methods should protect invariants (no negative deposits) instead of exposing setters for everything.
- Interview tip: be clear on the difference between a reference variable and the object it refers to.

### Constructors and initialization order
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/javaOO/constructors.html -->
A constructor initialises a new object. If you write none, the compiler adds a no-argument default constructor. Constructors can be overloaded and can delegate with `this(...)`; subclass constructors call a superclass constructor with `super(...)`, implicitly `super()` if omitted.

Initialization order matters: static initialisers run once when the class is initialised; then, for each `new`, the superclass constructor runs first, then the subclass's field initialisers and instance blocks in textual order, then the rest of the constructor body.

Before Java 25, `super(...)` or `this(...)` had to be the first statement. Java 25's flexible constructor bodies (JEP 513) allow statements before it, for example validating arguments, as long as they do not touch `this`.

```java
public class Temperature {
    private final double kelvin;

    public Temperature(double kelvin) {
        if (kelvin < 0) throw new IllegalArgumentException("below absolute zero");
        this.kelvin = kelvin;
    }

    public Temperature() { this(273.15); }   // delegate to the main constructor
}

class PositiveCounter extends Counter {
    PositiveCounter(int start) {
        if (start < 0) throw new IllegalArgumentException(); // legal before super in Java 25
        super(start);
    }
}
```

- Pitfall: calling an overridable method from a constructor lets a subclass run code before its own fields are initialised.
- Prefer static factory methods (`Temperature.ofCelsius(20)`) when names clarify intent.

### Access modifiers and encapsulation
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/javaOO/accesscontrol.html -->
Encapsulation means hiding internal state and exposing only a deliberate API, so you can change the implementation without breaking callers and so objects can enforce their invariants.

Java has four access levels: `public` (everyone), `protected` (same package plus subclasses), package-private (no keyword: same package only) and `private` (the enclosing top-level class only, including nested classes). Since Java 9, modules add a further layer: a public class is only visible outside its module if its package is exported.

```java
public final class Email {
    private final String value;               // hidden state

    private Email(String value) { this.value = value; }

    public static Email of(String raw) {      // the only way in, with validation
        if (raw == null || !raw.contains("@")) {
            throw new IllegalArgumentException("invalid email: " + raw);
        }
        return new Email(raw.strip().toLowerCase());
    }

    public String value() { return value; }
}
```

- Default to the narrowest access that works: private fields, package-private helpers, public only for the real API.
- Pitfall: returning a mutable internal collection (`return items;`) breaks encapsulation; return `List.copyOf(items)` or an unmodifiable view.
- Pitfall: getters and setters for every field are not encapsulation; they just make fields public with extra steps.
- Interview tip: package-private is underused and excellent for test-visible helpers within a package.

### Static members
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/javaOO/classvars.html -->
`static` members belong to the class rather than to any instance. A static field has exactly one copy per class (per class loader), and static methods are called without an object and cannot use `this`. Static nested classes, static imports and static initialiser blocks round out the feature.

Static fields are initialised when the class is first actively used (lazy class initialisation), and the JVM guarantees this happens exactly once and is thread-safe. That guarantee powers the holder-class idiom for lazy singletons.

```java
public final class Ids {
    private static final AtomicLong NEXT = new AtomicLong();   // shared counter
    private Ids() {}                                           // no instances

    public static long next() { return NEXT.incrementAndGet(); }
}

public class Config {
    private Config() {}
    private static class Holder {                   // loaded only on first getInstance()
        static final Config INSTANCE = new Config();
    }
    public static Config getInstance() { return Holder.INSTANCE; }
}
```

- Pitfall: mutable static state is global state; it complicates testing, leaks memory (static collections live as long as the class loader), and causes data races.
- Pitfall: static methods cannot be overridden, only hidden, so they do not participate in polymorphism.
- Use static for pure utility functions, constants (`static final`) and factory methods.

### Inheritance and super
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/IandI/subclasses.html -->
A class can extend exactly one superclass (single inheritance of implementation) and inherits its accessible fields and methods. Every class ultimately extends `java.lang.Object`. `super.method()` calls the parent's implementation and `super(...)` invokes a parent constructor.

Inheritance models an "is-a" relationship and enables polymorphism, but it couples the subclass tightly to the parent's implementation details (the fragile base class problem). The general advice from Effective Java is to favour composition over inheritance and to design classes either for extension, documenting self-use of overridable methods, or to forbid it with `final`.

```java
public class Vehicle {
    protected final String plate;
    public Vehicle(String plate) { this.plate = plate; }
    public double tollRate() { return 2.0; }
}

public class Truck extends Vehicle {
    private final int axles;
    public Truck(String plate, int axles) {
        super(plate);
        this.axles = axles;
    }
    @Override
    public double tollRate() { return super.tollRate() * axles; }
}

// Composition alternative: a Truck *has* a TollPolicy instead of overriding.
```

- Always use `@Override`; the compiler then catches signature typos that would otherwise create an accidental overload.
- Pitfall: a subclass of `HashSet` overriding `add` and `addAll` double-counts because `addAll` calls `add` internally, the classic fragile base class example.

### Polymorphism and dynamic dispatch
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/java/IandI/polymorphism.html -->
Polymorphism lets code written against a supertype work with any subtype. The declared (static) type of a variable decides which methods you may call; the runtime class of the object decides which implementation runs. This is dynamic dispatch.

Under the hood, instance methods are invoked with `invokevirtual` or `invokeinterface`. The JVM resolves the target through a per-class virtual method table. The JIT then optimises aggressively: if only one implementation is loaded it inlines the call directly (class hierarchy analysis), and at call sites that see one or two types it uses inline caches. Megamorphic call sites (many types) remain slower.

Fields and static methods are not polymorphic; they are resolved by the static type.

```java
interface Shape { double area(); }
record Circle(double r) implements Shape { public double area() { return Math.PI * r * r; } }
record Square(double s) implements Shape { public double area() { return s * s; } }

List<Shape> shapes = List.of(new Circle(1), new Square(2));
double total = 0;
for (Shape s : shapes) total += s.area();   // the right area() chosen at runtime
```

- Overloading is resolved at compile time from static types; overriding is resolved at runtime. Mixing them up is a classic interview trap.
- Liskov substitution: a subtype must honour the supertype's contract, or polymorphic code breaks in subtle ways.

### Abstract classes
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/java/IandI/abstract.html -->
An abstract class cannot be instantiated and may declare abstract methods without bodies that concrete subclasses must implement. Unlike interfaces, abstract classes can hold instance state, constructors and non-public members, which makes them a good fit for sharing a skeleton implementation among closely related classes.

The template method pattern is the classic use: the abstract class fixes the algorithm's structure in a final method and lets subclasses fill in steps.

```java
public abstract class ReportGenerator {
    public final String generate() {          // template method: fixed structure
        var sb = new StringBuilder(header());
        for (String row : rows()) sb.append(format(row)).append('\n');
        return sb.toString();
    }
    protected String header() { return "REPORT\n"; } // hook with default
    protected abstract List<String> rows();          // step subclasses must supply
    protected abstract String format(String row);
}

public class CsvReport extends ReportGenerator {
    protected List<String> rows() { return List.of("a", "b"); }
    protected String format(String row) { return row + ","; }
}
```

When to choose which: use an interface to define a capability that unrelated classes can implement (a class can implement many); use an abstract class when subclasses genuinely share state and code, and you control the hierarchy. Since Java 8 interfaces can have default methods, so many former abstract base classes are now interfaces plus small helpers.

- Pitfall: deep abstract hierarchies become hard to follow; keep them shallow.

### equals, hashCode and toString
<!-- level: intermediate; ref: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Object.html -->
Every class inherits `equals`, `hashCode` and `toString` from `Object`. By default `equals` is identity (`==`), `hashCode` is derived from identity, and `toString` prints the class name plus a hex hash.

Value-like classes should override `equals` to compare meaningful state. The contract requires `equals` to be reflexive, symmetric, transitive and consistent, with `x.equals(null)` false. Whenever you override `equals` you must override `hashCode` so equal objects produce equal hashes; hash-based collections rely on it.

```java
public final class Point {
    private final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }

    @Override public boolean equals(Object o) {
        return o instanceof Point p && x == p.x && y == p.y;
    }
    @Override public int hashCode() { return Objects.hash(x, y); }
    @Override public String toString() { return "Point[x=" + x + ", y=" + y + "]"; }
}
// Or simply: record Point(int x, int y) {} generates all three.
```

- Pitfall: using mutable fields in `hashCode` and then mutating an object inside a `HashSet` makes it unfindable.
- Pitfall: `instanceof`-based equals across a class hierarchy can break symmetry; make value classes final or compare `getClass()`.
- Pitfall: writing `equals(Point other)` overloads rather than overrides; `@Override` catches it.

### final and immutability
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/essential/concurrency/immutable.html -->
`final` has three meanings: a final variable can be assigned once, a final method cannot be overridden, and a final class cannot be extended. An immutable object is one whose observable state never changes after construction, such as `String`, `LocalDate` and records with immutable components.

Immutable objects are simpler to reason about, can be shared freely between threads without locks, make safe map keys, and can be cached. The Java Memory Model gives final fields a special guarantee: once the constructor finishes (and `this` did not escape), any thread that sees the object sees the final fields correctly initialised, even without synchronization.

Recipe: make the class final, fields private final, no setters, defensively copy mutable inputs and outputs.

```java
public final class Order {
    private final String id;
    private final List<String> items;

    public Order(String id, List<String> items) {
        this.id = Objects.requireNonNull(id);
        this.items = List.copyOf(items);       // defensive, unmodifiable copy
    }
    public List<String> items() { return items; }   // safe to expose
    public Order withItem(String item) {             // "wither" returns a new object
        var copy = new ArrayList<>(items); copy.add(item);
        return new Order(id, copy);
    }
}
```

- Pitfall: `final List<String> items` stops reassignment, not mutation of the list.
- Interview tip: explain why immutability and thread safety go together.

### Nested, inner and anonymous classes
<!-- level: intermediate; ref: https://docs.oracle.com/javase/tutorial/java/javaOO/nested.html -->
Java allows classes inside classes. A static nested class is just a namespaced top-level class with access to the outer class's private members. An inner (non-static) class has an implicit reference to an instance of the outer class, so it can read outer fields directly. Local classes are declared inside a method, and anonymous classes are declared and instantiated in one expression.

The hidden outer reference is the important detail: every inner class instance keeps its outer object alive. If the inner object outlives the outer one (registered as a listener, stored in a cache, submitted to an executor), it causes a memory leak.

```java
public class LinkedStack<T> {
    private Node<T> head;

    private static final class Node<T> {        // static: no outer reference needed
        final T value; final Node<T> next;
        Node(T value, Node<T> next) { this.value = value; this.next = next; }
    }

    public void push(T v) { head = new Node<>(v, head); }

    public Iterator<T> iterator() {
        return new Iterator<>() {               // anonymous class, captures this stack
            Node<T> cur = head;
            public boolean hasNext() { return cur != null; }
            public T next() { T v = cur.value; cur = cur.next; return v; }
        };
    }
}
```

- Rule of thumb: make nested classes static unless they truly need the outer instance.
- Lambdas replaced most anonymous classes for single-method interfaces; note that `this` in a lambda means the enclosing instance, while in an anonymous class it means the anonymous object.

### Enums
<!-- level: basic; ref: https://docs.oracle.com/javase/tutorial/java/javaOO/enum.html -->
An enum is a class with a fixed set of named instances. Each constant is a singleton created when the enum class initialises, so enums can be compared with `==`, used in switch, and are inherently serialisation-safe. Enums can have fields, constructors (always private), methods, and constant-specific method bodies, and they can implement interfaces.

`EnumSet` and `EnumMap` are specialised collections backed by bit vectors and arrays indexed by ordinal, making them far faster and more compact than `HashSet` or `HashMap` for enum keys.

```java
public enum PaymentStatus {
    PENDING("P") { boolean isFinal() { return false; } },
    SETTLED("S") { boolean isFinal() { return true; } },
    FAILED("F")  { boolean isFinal() { return true; } };

    private final String code;
    PaymentStatus(String code) { this.code = code; }
    public String code() { return code; }
    abstract boolean isFinal();

    public static PaymentStatus fromCode(String c) {
        for (var s : values()) if (s.code.equals(c)) return s;
        throw new IllegalArgumentException("unknown code " + c);
    }
}

Set<PaymentStatus> terminal = EnumSet.of(PaymentStatus.SETTLED, PaymentStatus.FAILED);
```

- Pitfall: persisting `ordinal()` or relying on declaration order breaks when someone inserts a constant; store a stable code or the name.
- A single-element enum is the simplest robust singleton.
- `values()` clones an array on every call; cache it in hot paths.
