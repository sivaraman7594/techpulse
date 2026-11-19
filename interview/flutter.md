# Flutter interview questions

### What is the difference between StatelessWidget and StatefulWidget?
<!-- level: basic; kind: concept; ref: https://docs.flutter.dev/ui/widgets-intro -->
A `StatelessWidget` is an immutable description whose output depends only on its constructor arguments and inherited data. A `StatefulWidget` is also immutable, but it creates a separate `State` object that lives as long as the element stays in the tree and holds mutable data. Calling `setState` marks that State dirty so `build` runs again.

Use stateless widgets by default. Reach for stateful ones for local, ephemeral state such as an animation controller, a text controller, or a selected tab. State must be disposed of in `dispose`.

A strong answer adds that widgets are cheap configuration objects recreated often, while the State persists. Mention that moving state lower in the tree limits the rebuilt subtree.

### Explain the Flutter widget lifecycle for a StatefulWidget.
<!-- level: basic; kind: concept; ref: https://api.flutter.dev/flutter/widgets/State-class.html -->
The order is `createState`, `initState` (once, for setup), `didChangeDependencies` (after inherited widgets are available and whenever a dependency changes), `build`, then `didUpdateWidget` when the parent rebuilds with new configuration, `setState` rebuilds, `deactivate` when removed from the tree, and `dispose` when permanently gone.

Put subscriptions, controllers and listeners in `initState` and release them in `dispose`. Compare old and new widget values in `didUpdateWidget` to restart work. Do not call `setState` after dispose; check `mounted` after any `await`.

Interviewers often follow with "why can't I use `Theme.of(context)` in `initState`?" because the dependency-registration is not yet allowed there; use `didChangeDependencies`.

### What are the Widget, Element and RenderObject trees?
<!-- level: advanced; kind: concept; ref: https://docs.flutter.dev/resources/architectural-overview -->
Widgets are immutable configuration. Elements are the instances mounted in the tree; each holds a reference to its widget and its position, and decides whether to update or replace itself when a new widget arrives, comparing `runtimeType` and `key`. RenderObjects perform layout, painting, and hit testing.

Rebuilding widgets is cheap because the framework diffs them against elements and only updates RenderObjects whose properties changed. State lives in State objects attached to elements, which is why changing a widget's type or key at a position resets its state.

A good answer links keys, state preservation and performance together.

### What are keys for and when do you need them?
<!-- level: intermediate; kind: concept; ref: https://api.flutter.dev/flutter/foundation/Key-class.html -->
Keys let Flutter match widgets to existing elements when siblings of the same type are added, removed or reordered. Without keys, matching is by position, so a stateful child (for example a checkbox or text field) keeps its state while the data moves, producing visibly wrong results in reorderable lists.

Use `ValueKey(item.id)` for list items, `ObjectKey` when identity is an object, `UniqueKey` to force a reset, and `GlobalKey` sparingly to reach a State or move a subtree between parents.

Pitfall: generating a `UniqueKey` inside `build` destroys state on every rebuild. State that you do not care about preserving does not need keys; stateless siblings usually do not.

### How does Flutter layout work? What does "constraints go down, sizes go up" mean?
<!-- level: intermediate; kind: concept; ref: https://docs.flutter.dev/ui/layout/constraints -->
A parent gives each child constraints (minimum and maximum width and height). The child chooses a size that satisfies them and reports it up. The parent then decides the child's position. Children never decide their own position.

Consequences: a `Container(width: 500)` inside a parent that forces 300 will be 300 wide; a `ListView` in a `Column` fails because the column provides unbounded height; `Expanded` only works under a flex parent. `Align`, `Center` and `UnconstrainedBox` loosen constraints, while `SizedBox` and `ConstrainedBox` tighten or bound them.

When debugging an overflow, ask what constraints the widget receives. Flutter DevTools' layout explorer displays them.

### Compare setState, InheritedWidget, Provider, Riverpod and Bloc.
<!-- level: intermediate; kind: concept; ref: https://docs.flutter.dev/data-and-backend/state-mgmt/options -->
`setState` handles local state. `InheritedWidget` publishes data down the tree with dependency tracking, and is the foundation for most packages. Provider wraps it with convenient creation and `read`/`watch`/`select`. Riverpod moves providers out of the widget tree for compile-time safety, easy overrides in tests and built-in async state. Bloc and Cubit model state as a stream with explicit events or methods and immutable states, which gives traceability and strict structure.

Choose by team size, testability needs, and async complexity rather than popularity. Whatever you pick, keep business logic out of widgets, keep state immutable where practical, and keep one approach per app.

### What is the difference between Future and Stream, and how do you show them in the UI?
<!-- level: basic; kind: concept; ref: https://dart.dev/libraries/async/using-streams -->
A `Future<T>` produces one value or error later. A `Stream<T>` produces zero or more events over time and can be single-subscription or broadcast. In the UI use `FutureBuilder` and `StreamBuilder`, which expose an `AsyncSnapshot` with `connectionState`, `data` and `error`.

Always handle waiting and error states. Do not create the Future inside `build`, or each rebuild restarts it; create it in `initState` or in a state-management layer. Cancel stream subscriptions and close controllers in `dispose`.

Mention that `await for` and `async*` generate streams cleanly.

### How does Dart's event loop work, and what is an isolate?
<!-- level: advanced; kind: concept; ref: https://dart.dev/language/concurrency -->
Each isolate has its own heap and a single-threaded event loop with a microtask queue and an event queue. Microtasks drain completely before the next event. `await` yields back to the loop, so I/O does not block the UI. CPU-heavy synchronous code does block, causing jank, since layout, painting and gestures share the UI isolate.

Isolates share no memory and communicate by messages, which removes data races. Use `Isolate.run` (Dart 2.19 and later) or `compute` for one-off heavy work such as parsing large JSON. The cost of spawning and copying data means it is not worthwhile for small tasks.

### Explain sound null safety in Dart.
<!-- level: basic; kind: concept; ref: https://dart.dev/null-safety -->
Types are non-nullable by default: `String` cannot hold null, `String?` can. The compiler tracks this statically, using flow analysis to promote nullable locals after a null check. Because it is sound, the guarantee also holds at runtime, and the compiler can optimise based on it.

Key tools: `?.`, `??`, `??=`, `!`, `late`, and `required` named parameters. The bang operator is an assertion that can throw, so prefer promotion or default values. `late` defers initialisation but moves the check to runtime.

Common pitfall: fields and getters are not promoted, so copy to a local variable before checking.

### What is the difference between const and final in Dart, and why does it matter for Flutter?
<!-- level: basic; kind: concept; ref: https://dart.dev/language/variables -->
`final` is assigned once at runtime. `const` is a compile-time constant, and identical `const` instances are canonicalised into one object. A `const` constructor requires all fields to be final.

In Flutter, a `const` widget instance is identical across rebuilds, so the framework can skip rebuilding its subtree. Making stable leaf widgets `const` is a cheap performance win. The analyzer lint `prefer_const_constructors` helps.

Note that `final` collections are not deeply immutable; use `const` literals or unmodifiable wrappers when you need that.

### How do you navigate between screens, and what are the limits of Navigator.push?
<!-- level: intermediate; kind: concept; ref: https://docs.flutter.dev/ui/navigation -->
`Navigator.push` and `pop` manipulate an imperative stack and can return results. Named routes help a bit, but they are weak at path parameters, nested navigation, web URLs, and deep links. The Router API (and `go_router` built on it) is declarative: the app state or URL determines the page stack.

For production apps with deep links, auth redirects, and web support, use `go_router` or similar. Pass identifiers in the URL and load data in the destination, because objects passed through `extra` are lost on web refresh.

Remember to check `context.mounted` after awaiting a navigation result.

### How do you make network calls and parse JSON in Flutter?
<!-- level: basic; kind: concept; ref: https://docs.flutter.dev/data-and-backend/serialization/json -->
Use `http` or `dio` to call the API. Check the status code (the `http` package does not throw for 4xx/5xx), set timeouts, and parse the body with `jsonDecode`. Convert to typed models with `fromJson` factories, written by hand for small apps or generated by `json_serializable` or `freezed` for larger ones. Reflection is unavailable because of tree shaking.

Wrap calls in a repository class so UI code does not depend on the HTTP library. Parse large payloads in an isolate. Handle errors explicitly as a typed result or exceptions, and show loading, error and empty states.

### How do you store data locally, and how do you choose the storage?
<!-- level: intermediate; kind: concept; ref: https://docs.flutter.dev/cookbook/persistence/key-value -->
Choose by data type. Settings and flags: `shared_preferences`. Secrets such as refresh tokens: `flutter_secure_storage` (Keychain and Keystore-backed). Relational or large data with queries: SQLite via `sqflite` or `drift`, or an object database such as Isar or ObjectBox (check maintenance status). Files and cache: `path_provider` plus the file system.

Never store secrets in shared preferences. Plan schema migrations from day one, because upgrades with an old database are a common crash source. Treat local data as a cache with a clear source of truth, and encrypt where the threat model demands it.

### How do platform channels work?
<!-- level: intermediate; kind: concept; ref: https://docs.flutter.dev/platform-integration/platform-channels -->
Dart and the host platform exchange asynchronous messages through a named channel. `MethodChannel` handles request and response, `EventChannel` handles native-to-Dart streams. Arguments use the standard message codec (primitives, lists, maps, typed data). On Android you register a handler in Kotlin or Java; on iOS in Swift or Objective-C.

Handle `PlatformException` and `MissingPluginException`. Prefer `pigeon` for type-safe generated bindings, and package the code as a plugin to share it. For direct C library calls use `dart:ffi`.

### How would you write tests at different levels in Flutter?
<!-- level: intermediate; kind: concept; ref: https://docs.flutter.dev/testing/overview -->
Unit tests check pure logic and classes with fakes for dependencies. Widget tests (`testWidgets`) build widgets headlessly and drive them with `tap`, `enterText`, `pump`. Integration tests run the full app on a device using the `integration_test` package. Golden tests compare rendered output to stored images.

Aim for many unit tests, a reasonable number of widget tests, and a few critical-flow integration tests. Inject dependencies so network and storage can be faked. Use keys or semantic labels for finders, and avoid `pumpAndSettle` with endless animations.

### What causes jank in a Flutter app, and how do you diagnose it?
<!-- level: advanced; kind: concept; ref: https://docs.flutter.dev/perf/ui-performance -->
Jank means frames that miss their deadline (about 16 ms at 60 Hz). Causes: heavy work in `build` or on the UI isolate, rebuilding huge subtrees, offscreen layers from `Opacity`, clips and shadows, unbounded lists without `builder`, full-size image decoding, and shader compilation on first use.

Diagnose in profile mode on a real device with DevTools: check whether the UI thread or the raster thread is slow, track widget rebuilds, and inspect the CPU profile. Fix by scoping rebuilds, using `const`, moving CPU work to isolates, sizing images (`cacheWidth`), and using `RepaintBoundary` carefully. Never judge performance in debug mode.

### What is the difference between hot reload, hot restart and a full restart?
<!-- level: basic; kind: concept; ref: https://docs.flutter.dev/tools/hot-reload -->
Hot reload injects updated source code into the running Dart VM and rebuilds the widget tree while preserving State. It does not re-run `main` or `initState`, so changes to initial state or static initialisers may not show. Hot restart reloads all code and resets app state, while a full restart (stop and run) is required for native changes, plugin additions, and some changes like enum-to-class conversions.

Hot reload works in debug mode with the JIT, not in release builds, which are AOT-compiled.

### How do you handle app architecture and separation of concerns in a larger Flutter app?
<!-- level: advanced; kind: concept; ref: https://docs.flutter.dev/app-architecture -->
The official architecture guidance recommends layers: a UI layer (views and view models), a data layer (repositories and services), and optionally a domain layer for complex logic. Views render state and forward events. View models hold UI state and call repositories. Repositories are the single source of truth, combining remote and local services.

Use dependency injection so each layer can be tested in isolation, and keep data models immutable. Organise by feature, with shared code in a core package, and consider multi-package monorepos when teams grow. Keep widgets free of network and storage code.

### How do you support different screen sizes and accessibility?
<!-- level: intermediate; kind: concept; ref: https://docs.flutter.dev/ui/accessibility-and-internationalization/accessibility -->
For size, use `LayoutBuilder` and `MediaQuery.sizeOf` with breakpoints, flexible widgets (`Expanded`, `Wrap`), and adaptive components such as navigation bar versus rail. For accessibility, add `Semantics` labels, ensure minimum tap targets (about 48 by 48 logical pixels), maintain sufficient colour contrast, support dynamic text scaling without overflow, and test with TalkBack and VoiceOver.

Internationalise with `flutter_localizations` and ARB files via `flutter gen-l10n`, and use directional widgets (`EdgeInsetsDirectional`) for right-to-left languages.

### How do Flutter apps get built and released for Android and iOS, and what are common pitfalls?
<!-- level: intermediate; kind: concept; ref: https://docs.flutter.dev/deployment -->
Release builds are AOT-compiled: `flutter build appbundle` for Google Play and `flutter build ipa` for the App Store. Configure signing (a keystore on Android; certificates and provisioning profiles on iOS), versioning in `pubspec.yaml`, app icons, and permissions in `AndroidManifest.xml` and `Info.plist`.

Pitfalls: forgetting usage-description strings on iOS (rejection), leaking the keystore, testing only in debug mode where performance differs, not enabling obfuscation and symbol upload for crash reports (`--obfuscate --split-debug-info`), and missing flavours for dev and prod environments. Automate with CI.
