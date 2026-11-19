## 1. Dart language basics

### var, final and const
<!-- level: basic; ref: https://dart.dev/language/variables -->
Dart is statically typed with inference: `var x = 3;` fixes the type to `int`. `final` means a variable is assigned once, at runtime. `const` means a compile-time constant, and `const` objects are canonicalised, so two identical `const` values are the same instance. This matters in Flutter because a `const` widget is built once and Flutter can skip rebuilding it when the parent rebuilds.

```dart
final now = DateTime.now();      // runtime, assigned once
const pi2 = 3.14159 * 2;         // compile-time
const padding = EdgeInsets.all(8); // canonical instance
```

`dynamic` turns off static checks; avoid it unless you truly need it.

Pitfalls:
- `final` list contents can still change; use `const []` or `List.unmodifiable` for immutability.
- `const` requires all constructor arguments to be constants too.

Interview tip: explain `final` versus `const` using the widget rebuild example.

### Functions and parameters
<!-- level: basic; ref: https://dart.dev/language/functions -->
Functions are first-class objects. Dart has positional parameters, optional positional `[ ]`, and named parameters `{ }`. Named parameters are optional unless marked `required`, which is why most Flutter widget constructors read like keyword arguments. Arrow syntax `=>` is shorthand for a single returned expression.

```dart
String greet(String name, {String greeting = 'Hello', required int times}) =>
    List.filled(times, '$greeting, $name').join('\n');

greet('Asha', times: 2);
```

Anonymous functions and closures capture surrounding variables by reference, so they see later changes to those variables.

Pitfalls:
- A named parameter with a non-nullable type needs a default or `required`.
- Closures in loops capture the loop variable of `for (var i...)` correctly per iteration in Dart, unlike old JavaScript `var`.

Interview tip: be ready to explain why Flutter prefers named parameters for readability.

### Classes and constructors
<!-- level: basic; ref: https://dart.dev/language/constructors -->
Dart classes have generative constructors, named constructors, `const` constructors, and `factory` constructors that may return a cached or subtype instance. Initializing formals (`this.x`) assign fields directly, and the initializer list runs before the body, which is the only place to set `final` fields from computed values.

```dart
class Point {
  final double x, y;
  const Point(this.x, this.y);
  Point.origin() : this(0, 0);
  factory Point.fromJson(Map<String, dynamic> j) =>
      Point((j['x'] as num).toDouble(), (j['y'] as num).toDouble());
}
```

All classes define an implicit interface, so you can `implements` any class. Dart supports single inheritance only, plus mixins.

Pitfalls:
- A `const` constructor needs every field `final`.
- Overriding `==` without `hashCode` breaks sets and maps.

Interview tip: contrast `extends`, `implements` and `with`.

### Mixins and class modifiers
<!-- level: intermediate; ref: https://dart.dev/language/mixins -->
A mixin packages reusable members that can be applied to several class hierarchies using `with`. `on` restricts which classes can use the mixin. Flutter uses them heavily, for example `SingleTickerProviderStateMixin` gives a `State` a ticker for animations.

```dart
mixin Logger {
  void log(String m) => print('[$runtimeType] $m');
}
class Repo with Logger {
  void load() => log('loading');
}
```

Dart 3 added class modifiers: `sealed`, `final`, `base`, `interface`, and `mixin class`. A `sealed` class lets the compiler check that a `switch` over its subtypes is exhaustive.

Pitfalls:
- Order of mixins matters; the last one wins on conflicts.
- Mixins cannot have constructors with parameters.

Interview tip: say "mixins give code reuse without multiple inheritance, and sealed gives exhaustive matching" (Dart 3 and later).

### Extension methods
<!-- level: intermediate; ref: https://dart.dev/language/extension-methods -->
Extensions add members to an existing type without subclassing or editing it. They are resolved statically, based on the declared type at compile time, not the runtime type. Flutter code often uses them for context shortcuts or formatting helpers.

```dart
extension DurationX on Duration {
  String get mmss {
    final m = inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$m:$s';
  }
}
// Duration(seconds: 75).mmss == '01:15'
```

Extension types (Dart 3.3 and later) are a related zero-cost wrapper for creating a new static type over an existing representation.

Pitfalls:
- Calling an extension on `dynamic` fails, because resolution is static.
- Two extensions with the same member name create ambiguity; hide or prefix the import.

Interview tip: explain that extensions do not override existing members; real members always win.

### Collections and collection control flow
<!-- level: basic; ref: https://dart.dev/language/collections -->
`List`, `Set` and `Map` are the core collections, written as literals. Dart supports `if`, `for` and spread (`...`, `...?`) inside literals, which makes conditional UI children concise.

```dart
final items = [
  'Home',
  if (isAdmin) 'Admin',
  for (final t in tabs) t.toUpperCase(),
  ...?extraItems,
];
final byId = {for (final u in users) u.id: u};
```

Common methods are `map`, `where`, `fold`, `any`, `every`, and `toList()`. `map` and `where` return lazy iterables, so call `toList()` when you need a snapshot.

Pitfalls:
- Modifying a list while iterating throws `ConcurrentModificationError`.
- `Iterable.map` in `build()` re-runs each time it is iterated.

Interview tip: mention that literals with explicit types (`<int>[]`) avoid accidental `List<dynamic>`.

### Records
<!-- level: intermediate; ref: https://dart.dev/language/records -->
Records (Dart 3.0 and later) are anonymous, immutable, fixed-size aggregates. They allow returning several values without a class. Fields can be positional or named, and records have structural equality.

```dart
(int min, int max) range(List<int> xs) =>
    (xs.reduce(math.min), xs.reduce(math.max));

final (lo, hi) = range([4, 9, 2]);
final user = (name: 'Ria', age: 30);
print(user.name);
```

Two records are equal when their shapes and values match, so they work as map keys. They suit small, local data; use a class when the data has behaviour or a long life.

Pitfalls:
- Positional fields are accessed as `$1`, `$2`, which is unreadable in public APIs.
- Records do not support inheritance or methods.

Interview tip: contrast records with `Map<String, dynamic>` and mention type safety.

### Patterns and switch expressions
<!-- level: intermediate; ref: https://dart.dev/language/patterns -->
Patterns (Dart 3.0 and later) let you test a value's shape and destructure it. They appear in `switch`, `if-case`, variable declarations and `for` loops. A switch expression returns a value and must be exhaustive for sealed types and enums.

```dart
sealed class Result {}
class Ok extends Result { final String data; Ok(this.data); }
class Err extends Result { final Object e; Err(this.e); }

String show(Result r) => switch (r) {
  Ok(:final data) => 'ok $data',
  Err(:final e) => 'error $e',
};

if (json case {'id': int id, 'name': String name}) { /* use id, name */ }
```

Guards use `when`: `case int n when n > 0`.

Pitfalls:
- Forgetting a subtype in a sealed switch becomes a compile error, which is intended.
- Older Dart SDKs (before 3.0) do not parse patterns.

Interview tip: use pattern matching on JSON as an example of safe destructuring.

### Enhanced enums
<!-- level: intermediate; ref: https://dart.dev/language/enums -->
Since Dart 2.17, enums can have fields, constructors, methods, getters and implement interfaces. All instances are constants created in the enum declaration, and you can switch over them exhaustively.

```dart
enum Status {
  idle('Idle', false),
  loading('Loading...', true),
  done('Done', false);

  const Status(this.label, this.busy);
  final String label;
  final bool busy;
}
```

Use `Status.values`, `.name`, and `.index`. `byName('done')` throws if absent, so use `values.asNameMap()[...]` when input is untrusted.

Pitfalls:
- Persisting `index` breaks when you reorder values; persist `name`.
- Enum constructors must be `const`.

Interview tip: say that enums replace many small constant classes and make UI state exhaustive when combined with `switch`.

### Generics
<!-- level: intermediate; ref: https://dart.dev/language/generics -->
Generics parameterise classes and functions by type. Dart generics are reified, meaning the type argument exists at runtime, so `is List<int>` works, unlike in Java. Bounds restrict the allowed types.

```dart
T firstWhereOr<T>(Iterable<T> xs, bool Function(T) test, T orElse) {
  for (final x in xs) { if (test(x)) return x; }
  return orElse;
}

class Box<T extends Comparable<T>> {
  Box(this.value);
  final T value;
  bool lessThan(Box<T> o) => value.compareTo(o.value) < 0;
}
```

Flutter examples include `State<T extends StatefulWidget>`, `Future<T>` and `ValueNotifier<T>`.

Pitfalls:
- Missing type arguments produce `dynamic` and hide errors.
- Collection literal inference can pick a wider type than you intended.

Interview tip: mention reified generics as a difference from Java and TypeScript.

### Dart's type system: sound, with inference
<!-- level: basic; ref: https://dart.dev/language/type-system -->
Dart's type system is sound: if the static type says a value is `String`, it cannot be an `int` at runtime (with checks for some downcasts and covariant generics). Type inference fills in locals, generic arguments and lambda parameters. Soundness lets the compiler optimise and enables sound null safety.

```dart
var names = <String>['a', 'b'];
Object o = 'hi';
// o.length;          // error: Object has no length
if (o is String) print(o.length); // promoted to String
final n = o as String; // throws if not a String
```

`is` tests and promotes, `as` casts and may throw.

Pitfalls:
- Some runtime checks still happen (covariant collections), so `List<int>` assigned to `List<num>` can fail on `add(1.5)`.
- Overusing `dynamic` loses all guarantees.

Interview tip: be able to explain "sound null safety" as a consequence of soundness.

## 2. Null safety

### Nullable and non-nullable types
<!-- level: basic; ref: https://dart.dev/null-safety -->
With sound null safety (default since Dart 3.0), `String` can never be null and `String?` can. The compiler prevents calling members on a nullable value until you prove it is non-null. This removes most null dereference crashes at compile time and lets the runtime skip some checks.

```dart
String name = 'Asha';
String? nick;            // null by default
print(name.length);
// print(nick.length);   // compile error
print(nick?.length);     // null if nick is null
```

Fields that are non-nullable must be initialised before the constructor body ends, or be `late`, or have a default value.

Pitfalls:
- JSON values are dynamic; casting `json['x'] as String` throws if the key is missing.
- Making everything nullable to silence errors spreads null checks everywhere.

Interview tip: say that nullability is part of the type, not an annotation or a runtime check.

### Null-aware operators
<!-- level: basic; ref: https://dart.dev/null-safety/understanding-null-safety -->
Dart has `?.` (safe member access), `??` (default if null), `??=` (assign if null), `?[ ]` (safe index), `...?` (null-aware spread), and `!` (assert non-null). Cascade `?..` is the null-aware cascade.

```dart
final len = user?.name?.length ?? 0;
cache ??= await load();
final first = list?[0];
final merged = [...base, ...?extras];
```

These expressions short-circuit: if the receiver is null, the rest of the chain is skipped.

Pitfalls:
- `a?.b.c` short-circuits the whole chain, but `(a?.b).c` does not.
- `??` treats only null as missing, not empty strings or zero.

Interview tip: demonstrate `??=` for lazy initialisation of a cached value.

### late variables
<!-- level: intermediate; ref: https://dart.dev/language/variables#late-variables -->
`late` delays initialisation of a non-nullable variable. Accessing it before assignment throws `LateInitializationError`. A `late final` field can be assigned exactly once. A `late` variable with an initializer is lazy: the initializer runs on first read, which is useful for expensive objects.

```dart
class Screen extends StatefulWidget { /* ... */ }
class _ScreenState extends State<Screen> {
  late final TextEditingController ctrl = TextEditingController();
  late final AnimationController anim;

  @override
  void initState() {
    super.initState();
    anim = AnimationController(vsync: this, duration: const Duration(seconds: 1));
  }
}
```

Pitfalls:
- It trades a compile-time guarantee for a runtime one; do not use it to avoid designing constructors.
- A lazy initializer that throws will rethrow on each read.

Interview tip: explain the lazy-initialisation use and why `late` is common in `State` classes.

### Type promotion and flow analysis
<!-- level: intermediate; ref: https://dart.dev/null-safety/understanding-null-safety#flow-analysis -->
After a null check, Dart promotes a local variable to its non-nullable type within the guarded scope. Flow analysis follows `if`, early returns, `&&`, and `throw`. Promotion works for local variables and parameters but not for fields or getters, because those may change between check and use.

```dart
void show(String? s) {
  if (s == null) return;
  print(s.length);       // s promoted to String
}

class A {
  String? name;
  void f() {
    if (name != null) {
      // name.length;    // error: field is not promoted
      final n = name!;   // or copy to a local first
    }
  }
}
```

Since Dart 3.2, private final fields can be promoted.

Pitfalls:
- Reassigning a variable inside a closure can stop promotion.

Interview tip: the fix is to copy the field into a local variable.

### The bang operator and avoiding it
<!-- level: basic; ref: https://dart.dev/null-safety/understanding-null-safety#null-assertion-operator -->
`x!` tells the compiler a nullable value is not null and throws a runtime error if it is. It is a deliberate escape hatch, but overuse recreates the null crashes that null safety prevents.

```dart
// risky
final city = user!.address!.city;

// safer
final city = user?.address?.city ?? 'Unknown';

// explicit
final u = user;
if (u == null) throw StateError('user required here');
```

Prefer promotion, `??`, early return, or a precise error message. In Flutter code, `Theme.of(context)` and `MediaQuery.of(context)` return non-null, while `ModalRoute.of(context)` is nullable.

Pitfalls:
- `!` on a map lookup (`map['k']!`) crashes when absent.
- Chains of `!` hide which value was null.

Interview tip: say you allow `!` only where an invariant is documented and tested.

## 3. Async programming and isolates

### Future, async and await
<!-- level: basic; ref: https://dart.dev/language/async -->
A `Future<T>` represents a value that will be available later, or an error. `async` functions return a Future, and `await` suspends the function without blocking the thread, letting the event loop continue. In Flutter this keeps the UI responsive while you wait on I/O.

```dart
Future<User> loadUser(String id) async {
  try {
    final res = await http.get(Uri.parse('$base/users/$id'));
    return User.fromJson(jsonDecode(res.body));
  } on SocketException {
    rethrow;
  }
}
```

Run independent calls together with `Future.wait([a(), b()])`.

Pitfalls:
- Not awaiting a Future ("fire and forget") silently drops errors; the `unawaited_futures` lint helps.
- Using `BuildContext` after an `await` can reference an unmounted widget; check `if (!context.mounted) return;`.

Interview tip: explain that async is cooperative concurrency on one thread, not parallelism.

### The event loop, microtasks and timers
<!-- level: intermediate; ref: https://dart.dev/language/concurrency -->
Each Dart isolate runs a single-threaded event loop with two queues: microtasks and events. After running current code, Dart drains all microtasks, then takes one event (timer, I/O, tap), then drains microtasks again. A Future's `then` callbacks run as microtasks when the Future is already complete.

```dart
void main() {
  print('1');
  Future(() => print('4 event'));
  scheduleMicrotask(() => print('3 micro'));
  print('2');
}
// 1, 2, 3 micro, 4 event
```

Because everything shares one thread, a long synchronous loop blocks frames and gestures.

Pitfalls:
- A microtask that keeps scheduling microtasks starves the event queue and UI.
- `Future.delayed(Duration.zero)` is an event, not a microtask.

Interview tip: predict output order of a snippet; this question is very common.

### Streams
<!-- level: intermediate; ref: https://dart.dev/libraries/async/using-streams -->
A `Stream<T>` delivers a sequence of asynchronous events. Single-subscription streams allow one listener; broadcast streams allow many but do not buffer for late listeners. Consume with `await for`, `listen`, or in Flutter via `StreamBuilder`. Produce with `async*` and `yield`, or with a `StreamController`.

```dart
Stream<int> countdown(int n) async* {
  for (var i = n; i > 0; i--) {
    await Future.delayed(const Duration(seconds: 1));
    yield i;
  }
}

final sub = countdown(3).listen(print);
// later: await sub.cancel();
```

Pitfalls:
- Not cancelling subscriptions or closing controllers leaks memory; do it in `dispose`.
- Listening twice to a single-subscription stream throws.

Interview tip: contrast Future (one value) with Stream (many) and when to use `StreamBuilder`.

### Isolates and Isolate.run
<!-- level: advanced; ref: https://dart.dev/language/isolates -->
Isolates are Dart's units of concurrency. Each has its own memory heap and event loop, and they communicate by message passing, so there are no shared-memory data races. Use them for CPU-heavy work such as parsing large JSON or image processing, so the UI isolate keeps rendering at 60 or 120 fps.

```dart
Future<List<Item>> parse(String body) =>
    Isolate.run(() {
      final list = jsonDecode(body) as List;
      return list.map((e) => Item.fromJson(e)).toList();
    });
```

`Isolate.run` (Dart 2.19 and later) spawns, runs one function, returns its result, and exits. Flutter's older `compute()` is similar. For long-lived workers use `Isolate.spawn` with `SendPort`/`ReceivePort`.

Pitfalls:
- The closure cannot capture objects that are not sendable (for example open sockets, some native handles).
- Spawning for tiny work costs more than it saves.
- Isolates on the web compile to JS and do not exist as real isolates there; check platform support.

Interview tip: say "isolates share nothing" when asked about thread safety.

### Error handling in async code
<!-- level: intermediate; ref: https://dart.dev/language/error-handling -->
Futures complete with a value or an error. `try/catch` works across `await`. Without `await`, attach `.catchError` or `onError`. Errors from unhandled Futures go to the current `Zone`, and in Flutter you should install `FlutterError.onError` and `PlatformDispatcher.instance.onError` for global reporting.

```dart
void main() {
  FlutterError.onError = (d) => report(d.exception, d.stack);
  PlatformDispatcher.instance.onError = (e, st) {
    report(e, st);
    return true;
  };
  runApp(const MyApp());
}
```

Throw `Exception` subclasses for expected failures and let `Error` types signal programmer bugs; catch with `on SpecificType`.

Pitfalls:
- `catch (e)` with no `on` hides bug types like `StateError`.
- Swallowing errors in `StreamBuilder` leaves a spinner forever; handle `snapshot.hasError`.

Interview tip: describe where you report uncaught errors in a production app.
