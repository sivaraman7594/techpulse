## 1. Widgets and the rendering model

### Everything is a widget: StatelessWidget
<!-- level: basic; ref: https://docs.flutter.dev/ui/widgets-intro -->
A widget is an immutable description of part of the UI. A `StatelessWidget` has no mutable state; its `build` method returns a subtree based only on its constructor arguments and inherited data. Flutter creates widgets cheaply and throws them away often, so they should be light and `const` where possible.

```dart
class Greeting extends StatelessWidget {
  const Greeting({super.key, required this.name});
  final String name;

  @override
  Widget build(BuildContext context) => Text('Hello, $name');
}
```

Composition beats inheritance: build screens from small widgets, not by subclassing `Text` or `Container`.

Pitfalls:
- Doing heavy work in `build` hurts frame time because `build` can run every frame during animation.
- Mutable fields in a stateless widget are lost on rebuild.

Interview tip: explain that widgets are configuration, and the long-lived objects are Elements and RenderObjects.

### StatefulWidget and State lifecycle
<!-- level: basic; ref: https://api.flutter.dev/flutter/widgets/State-class.html -->
A `StatefulWidget` pairs an immutable widget with a long-lived `State` object. Lifecycle order: `createState`, `initState`, `didChangeDependencies`, `build`, then `didUpdateWidget` when the parent supplies a new configuration, `setState` to trigger rebuilds, `deactivate`, and `dispose`.

```dart
class _TimerState extends State<TimerView> {
  late final Timer _t;
  int secs = 0;

  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 1),
        (_) => setState(() => secs++));
  }

  @override
  void dispose() { _t.cancel(); super.dispose(); }

  @override
  Widget build(BuildContext context) => Text('$secs');
}
```

Pitfalls:
- Forgetting to dispose controllers, timers, and subscriptions leaks memory.
- Calling `setState` after `dispose` throws; check `mounted` after async gaps.

Interview tip: know that `initState` runs once and cannot use inherited widgets via `of(context)` reliably; use `didChangeDependencies`.

### BuildContext
<!-- level: intermediate; ref: https://api.flutter.dev/flutter/widgets/BuildContext-class.html -->
`BuildContext` is a handle to a widget's location in the tree (technically its Element). Methods such as `Theme.of(context)` walk upward from that location to find the nearest ancestor of a type. That is why a `Scaffold.of(context)` call fails when `context` belongs to the widget that creates the `Scaffold`, because the lookup begins below it.

```dart
Builder(
  builder: (innerContext) => ElevatedButton(
    onPressed: () => ScaffoldMessenger.of(innerContext)
        .showSnackBar(const SnackBar(content: Text('Hi'))),
    child: const Text('Show'),
  ),
)
```

Pitfalls:
- Using a stale context after `await` can target an unmounted element; guard with `context.mounted`.
- Storing `BuildContext` in long-lived objects leaks the tree.

Interview tip: say "context is the position in the tree; `of` lookups go up from that position".

### Keys
<!-- level: intermediate; ref: https://api.flutter.dev/flutter/foundation/Key-class.html -->
Keys help Flutter decide whether an Element can be reused when widgets of the same type move around. Without keys, Flutter matches children by position and type. This matters for stateful children in reorderable lists: without a key, state (like text input) stays with the position, not with the item.

```dart
ListView(
  children: [
    for (final t in todos)
      TodoTile(key: ValueKey(t.id), todo: t),
  ],
)
```

Types: `ValueKey` (data identity), `ObjectKey`, `UniqueKey` (always new, forces state reset), and `GlobalKey` (unique across the app, allows access to state but is costly).

Pitfalls:
- `UniqueKey()` created inside `build` resets state on every rebuild.
- Overusing `GlobalKey` hurts performance and complicates ownership.

Interview tip: use the swapping-two-coloured-tiles example to explain why state sticks to position.

### The three trees: Widget, Element, RenderObject
<!-- level: advanced; ref: https://docs.flutter.dev/resources/architectural-overview -->
Flutter keeps three parallel trees. Widgets are immutable configuration. Elements are the mounted instances that hold the position, and decide to update or replace based on `runtimeType` and `key`. RenderObjects perform layout, painting and hit-testing. On rebuild, Flutter compares the new widget with the existing element's widget; if `canUpdate` is true, the element updates its render object in place instead of recreating it.

```dart
static bool canUpdate(Widget old, Widget neu) =>
    old.runtimeType == neu.runtimeType && old.key == neu.key;
```

This is why rebuilding widgets is cheap but replacing a subtree of different types is expensive.

Pitfalls:
- Wrapping a child in a different widget type changes the type at that position and resets state.
- Treating `build` as expensive leads to premature optimisation.

Interview tip: explain that only RenderObjects layout and paint, so rebuilding widgets does not necessarily repaint.

### InheritedWidget
<!-- level: intermediate; ref: https://api.flutter.dev/flutter/widgets/InheritedWidget-class.html -->
`InheritedWidget` exposes data to all descendants and rebuilds only those that depend on it. A descendant registers a dependency by calling `dependOnInheritedWidgetOfExactType`, usually wrapped in a static `of` method. When the inherited widget is replaced and `updateShouldNotify` returns true, dependents rebuild. `Theme`, `MediaQuery` and `Directionality` use this mechanism.

```dart
class AppConfig extends InheritedWidget {
  const AppConfig({super.key, required this.apiBase, required super.child});
  final String apiBase;

  static AppConfig of(BuildContext c) =>
      c.dependOnInheritedWidgetOfExactType<AppConfig>()!;

  @override
  bool updateShouldNotify(AppConfig old) => apiBase != old.apiBase;
}
```

Pitfalls:
- It is immutable; to change data, hold a notifier inside it.
- Calling `of` in `initState` fails; do it in `didChangeDependencies` or `build`.

Interview tip: state management packages such as Provider are built on this.

## 2. Layout

### Constraints go down, sizes go up
<!-- level: intermediate; ref: https://docs.flutter.dev/ui/layout/constraints -->
Flutter's layout rule: a parent passes constraints (min and max width and height) to its child, the child picks a size within them, and the parent positions the child. A widget cannot choose its own position, and cannot know its parent's size beyond the constraints. This explains most layout puzzles, for example a `Container` with fixed width inside a tight parent ignores that width.

```dart
ConstrainedBox(
  constraints: const BoxConstraints(maxWidth: 300),
  child: Container(width: 500, color: Colors.red), // becomes 300 wide
)
```

`Center`, `Align` and `UnconstrainedBox` loosen constraints; `SizedBox` tightens them.

Pitfalls:
- Unbounded constraints (a `ListView` inside a `Column`) cause "RenderBox was not laid out" or overflow errors.
- Putting `Expanded` outside a flex parent throws.

Interview tip: recite the rule in one sentence, then apply it to a bug.

### Row, Column and flex layout
<!-- level: basic; ref: https://docs.flutter.dev/ui/layout -->
`Row` and `Column` lay children along a main axis and align them on the cross axis. Non-flex children are measured first with unbounded main-axis constraints; `Expanded` and `Flexible` then share the remaining space by `flex` factor. `Expanded` forces the child to fill; `Flexible` allows it to be smaller.

```dart
Row(
  crossAxisAlignment: CrossAxisAlignment.center,
  children: [
    const Icon(Icons.person),
    const SizedBox(width: 8),
    Expanded(child: Text(longName, overflow: TextOverflow.ellipsis)),
    Text(score),
  ],
)
```

Pitfalls:
- Long text in a `Row` without `Expanded` overflows with the yellow-black stripes.
- A `Column` inside a scroll view needs `mainAxisSize: MainAxisSize.min` or fixed height.

Interview tip: be ready to explain `Expanded` versus `Flexible`.

### Scrolling lists and slivers
<!-- level: intermediate; ref: https://docs.flutter.dev/ui/layout/scrolling/slivers -->
`ListView.builder` creates children lazily, only for visible items plus a small cache extent, so long lists stay cheap. `ListView(children: [...])` builds all children up front. For complex scroll effects, `CustomScrollView` composes slivers such as `SliverAppBar`, `SliverList` and `SliverGrid` into one scrollable.

```dart
ListView.builder(
  itemCount: items.length,
  itemExtent: 64,
  itemBuilder: (context, i) => ListTile(title: Text(items[i].title)),
)
```

Specifying `itemExtent` or `prototypeItem` speeds up layout for uniform rows.

Pitfalls:
- Nesting a `ListView` in a `Column` without `Expanded` gives unbounded height errors.
- `shrinkWrap: true` on large lists defeats laziness.
- Missing keys on reorderable items lose state.

Interview tip: say when you prefer slivers over a nested scroll view.

### Responsive layout: MediaQuery and LayoutBuilder
<!-- level: intermediate; ref: https://docs.flutter.dev/ui/adaptive-responsive -->
`MediaQuery.sizeOf(context)` gives the window size, while `LayoutBuilder` gives the constraints of the parent, which is usually what a reusable widget should react to. Use breakpoints to switch between layouts, for example a navigation bar on narrow screens and a rail on wide ones.

```dart
LayoutBuilder(builder: (context, c) {
  final wide = c.maxWidth >= 840;
  return wide
      ? Row(children: [const NavRail(), Expanded(child: body)])
      : body;
})
```

`MediaQuery.sizeOf` (Flutter 3.10 and later) subscribes only to size changes, which causes fewer rebuilds than `MediaQuery.of(context).size`.

Pitfalls:
- Basing layout on device type rather than available size breaks in split-screen and desktop windows.
- Testing only portrait phones misses overflow in landscape and large text scales.

Interview tip: mention testing at different text scale factors for accessibility.

## 3. State management

### setState and local state
<!-- level: basic; ref: https://docs.flutter.dev/data-and-backend/state-mgmt/ephemeral-vs-app -->
Ephemeral state belongs to one widget (a selected tab, a text field, an animation). `setState` marks the State dirty so Flutter calls `build` again in the next frame. Keep the closure passed to `setState` synchronous and limited to updating fields.

```dart
class _CounterState extends State<Counter> {
  int count = 0;
  @override
  Widget build(BuildContext context) => TextButton(
        onPressed: () => setState(() => count++),
        child: Text('$count'),
      );
}
```

Use app state management when several widgets need the same state, or state must survive navigation.

Pitfalls:
- Calling `setState` high in the tree rebuilds a large subtree; push state down or split widgets.
- `async` inside `setState` is not allowed; await first, then call `setState`.

Interview tip: distinguish ephemeral state from app state, as the official docs do.

### Lifting state up and passing callbacks
<!-- level: basic; ref: https://docs.flutter.dev/data-and-backend/state-mgmt/simple -->
When two sibling widgets need the same data, move the state to their closest common ancestor and pass values down and callbacks up. Data flows down through constructors, events flow up through callbacks. This keeps a single source of truth and makes widgets easy to test.

```dart
class Parent extends StatefulWidget { /* ... */ }
class _ParentState extends State<Parent> {
  bool dark = false;
  @override
  Widget build(BuildContext context) => Column(children: [
        ThemeToggle(value: dark, onChanged: (v) => setState(() => dark = v)),
        Preview(dark: dark),
      ]);
}
```

Pitfalls:
- Passing props through many layers ("prop drilling") is a sign to use an inherited widget or a state solution.

Interview tip: explain that this pattern is what Provider, Riverpod and Bloc automate.

### ValueNotifier and ChangeNotifier
<!-- level: intermediate; ref: https://docs.flutter.dev/data-and-backend/state-mgmt/simple -->
`ChangeNotifier` is a simple observable: call `notifyListeners()` after mutating, and listeners (like `ListenableBuilder` or `AnimatedBuilder`) rebuild. `ValueNotifier<T>` wraps a single value and notifies on assignment when the value changes by `==`.

```dart
class Cart extends ChangeNotifier {
  final _items = <Item>[];
  List<Item> get items => List.unmodifiable(_items);
  void add(Item i) { _items.add(i); notifyListeners(); }
}

ListenableBuilder(
  listenable: cart,
  builder: (_, __) => Text('${cart.items.length}'),
)
```

Pitfalls:
- Mutating a list and forgetting `notifyListeners` leaves the UI stale.
- Not calling `dispose` on notifiers you create leaks listeners.

Interview tip: `ValueListenableBuilder` rebuilds only its subtree, which is a cheap alternative to a full state package.

### Provider
<!-- level: intermediate; ref: https://docs.flutter.dev/data-and-backend/state-mgmt/simple -->
Provider (a package) wraps `InheritedWidget` to supply objects to a subtree and rebuild dependents. `context.read<T>()` gets the object without listening (use in callbacks), `context.watch<T>()` listens and rebuilds, and `context.select` listens to one derived value.

```dart
runApp(ChangeNotifierProvider(
  create: (_) => Cart(),
  child: const App(),
));

// in build
final count = context.select<Cart, int>((c) => c.items.length);
// in onPressed
context.read<Cart>().add(item);
```

Pitfalls:
- Calling `watch` in a callback, or `read` in `build` where you expected updates, are classic mistakes.
- Provider can be hard to use for dependencies that change; this is one reason Riverpod exists.

Interview tip: explain `read` versus `watch` versus `select`.

### Riverpod
<!-- level: intermediate; ref: https://docs.flutter.dev/data-and-backend/state-mgmt/options -->
Riverpod (a package by the author of Provider) declares providers as global, compile-safe values that are independent of the widget tree. It supports async providers with loading/error states, automatic disposal, provider overrides in tests, and fine-grained rebuilds. Code generation with annotations is optional (API details vary by version).

```dart
final todosProvider = FutureProvider<List<Todo>>((ref) async {
  return ref.watch(apiProvider).fetchTodos();
});

class TodoList extends ConsumerWidget {
  const TodoList({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      ref.watch(todosProvider).when(
        data: (d) => ListView(children: [for (final t in d) Text(t.title)]),
        loading: () => const CircularProgressIndicator(),
        error: (e, _) => Text('Error: $e'),
      );
}
```

Pitfalls:
- Using `ref.read` where you need updates misses rebuilds.
- Provider graphs can become hard to follow without naming and folder conventions.

Interview tip: mention testability through overrides.

### Bloc and Cubit
<!-- level: intermediate; ref: https://docs.flutter.dev/data-and-backend/state-mgmt/options -->
The `bloc` and `flutter_bloc` packages implement an event-to-state stream pattern. A `Cubit` exposes methods that call `emit(newState)`. A `Bloc` receives events, maps them to states through handlers, and offers traceable, testable transitions. States are typically immutable (often sealed classes or `Equatable`).

```dart
class CounterCubit extends Cubit<int> {
  CounterCubit() : super(0);
  void inc() => emit(state + 1);
}

BlocBuilder<CounterCubit, int>(
  builder: (_, n) => Text('$n'),
)
```

Pitfalls:
- States without value equality emit duplicates or fail to skip equal states.
- Putting business logic in widgets defeats the point; keep repositories behind the bloc.

Interview tip: say Cubit is the lighter option and Bloc adds event traceability, and that either needs the team to follow one structure.

### Choosing a state management approach
<!-- level: intermediate; ref: https://docs.flutter.dev/data-and-backend/state-mgmt/options -->
There is no single correct package. Start with `setState` and lifting state. Add `ValueNotifier` or `ChangeNotifier` plus `ListenableBuilder` for modest sharing. Move to Provider, Riverpod or Bloc when you need dependency injection, async state, testing seams, and team conventions. Evaluate by testability, boilerplate, learning curve, community support, and how well it handles async loading and error states.

```dart
// Rule of thumb on one screen:
// - toggle visibility        -> setState
// - shared form draft        -> ChangeNotifier / ValueNotifier
// - cached server data       -> Riverpod AsyncValue or Bloc
```

Pitfalls:
- Mixing three solutions in a single app confuses everyone.
- Putting all state in one global object makes every widget depend on everything.

Interview tip: justify your choice with concrete trade-offs rather than "it is popular".
