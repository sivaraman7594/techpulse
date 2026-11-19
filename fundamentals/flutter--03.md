## 1. Navigation

### Navigator and routes
<!-- level: basic; ref: https://docs.flutter.dev/ui/navigation -->
`Navigator` manages a stack of routes. `Navigator.push` adds a route and `pop` removes the top one, optionally returning a result. Named routes map strings to builders, but they are limited for deep linking and web URLs, so the official guidance now favours a router package for non-trivial apps.

```dart
final saved = await Navigator.of(context).push<bool>(
  MaterialPageRoute(builder: (_) => const EditPage()),
);
if (saved == true && context.mounted) {
  ScaffoldMessenger.of(context)
      .showSnackBar(const SnackBar(content: Text('Saved')));
}
```

Pitfalls:
- Using `context` after `await` without a `mounted` check.
- `pushReplacement` and `pushAndRemoveUntil` drop history; use them deliberately for login flows.

Interview tip: explain what the push result returns when the user taps back (null).

### Declarative routing with go_router
<!-- level: intermediate; ref: https://docs.flutter.dev/ui/navigation/deep-linking -->
`go_router` (a package maintained by the Flutter team) builds on the Router API. You declare a list of `GoRoute` entries with paths and parameters, and the URL is the source of truth. It supports nested routes, shell routes (persistent bottom navigation), redirects for auth, and deep links.

```dart
final router = GoRouter(
  redirect: (context, state) =>
      auth.loggedIn || state.matchedLocation == '/login' ? null : '/login',
  routes: [
    GoRoute(path: '/', builder: (_, __) => const Home(), routes: [
      GoRoute(
        path: 'item/:id',
        builder: (_, s) => ItemPage(id: s.pathParameters['id']!),
      ),
    ]),
    GoRoute(path: '/login', builder: (_, __) => const Login()),
  ],
);
// context.go('/item/42');  context.push('/item/42');
```

Pitfalls:
- `go` replaces the stack while `push` adds to it; mixing them surprises users on back.
- Redirect loops if the redirect target also redirects.

Interview tip: know `refreshListenable` for reacting to auth changes.

### Passing data and deep links
<!-- level: intermediate; ref: https://docs.flutter.dev/ui/navigation/deep-linking -->
Pass small identifiers (path or query parameters) rather than whole objects, and load the data in the destination. That makes the screen work when opened from a link, after a process restart, or on the web. Objects passed through `extra` or constructor arguments are lost on web refresh or app restart.

```dart
// good: id travels in the URL
context.go('/orders/123');

// destination loads its own data
final order = ref.watch(orderProvider(id));
```

Deep links on Android require intent filters and verified App Links, and on iOS require Universal Links with an associated-domains entitlement and an `apple-app-site-association` file.

Pitfalls:
- Relying on `extra` for required data.
- Not handling unknown routes with an error page.

Interview tip: explain why URL-addressable screens are more robust.

## 2. Networking and JSON

### HTTP requests with the http package
<!-- level: basic; ref: https://docs.flutter.dev/cookbook/networking/fetch-data -->
The `http` package provides `get`, `post`, and friends that return `Future<Response>`. Always set timeouts, check `statusCode`, and decode off the happy path carefully. The package does not throw for 4xx and 5xx responses; it only throws for transport failures.

```dart
Future<Album> fetchAlbum(http.Client client) async {
  final res = await client
      .get(Uri.https('api.example.com', '/albums/1'))
      .timeout(const Duration(seconds: 10));
  if (res.statusCode != 200) {
    throw HttpException('Status ${res.statusCode}');
  }
  return Album.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
}
```

Pitfalls:
- Using `http://` on Android 9+ or iOS fails by default due to cleartext restrictions.
- Creating a new `Client` per call prevents connection reuse.

Interview tip: inject the client so tests can use `MockClient`.

### JSON serialization
<!-- level: basic; ref: https://docs.flutter.dev/data-and-backend/serialization/json -->
For small models, write `fromJson` and `toJson` by hand. For larger ones, generate code with `json_serializable` and `build_runner`, or use `freezed` for immutable data classes and unions. Reflection-based serialization (`dart:mirrors`) is not available in Flutter because tree shaking requires static code.

```dart
@JsonSerializable()
class User {
  User({required this.id, required this.name});
  final int id;
  @JsonKey(name: 'full_name')
  final String name;

  factory User.fromJson(Map<String, dynamic> j) => _$UserFromJson(j);
  Map<String, dynamic> toJson() => _$UserToJson(this);
}
// dart run build_runner build
```

Pitfalls:
- Casting without checking turns server changes into runtime crashes; use defaults and nullable fields for optional data.
- Parsing very large payloads on the UI isolate janks; use `Isolate.run`.

Interview tip: explain why Flutter uses code generation rather than reflection.

### Dio, interceptors and retries
<!-- level: intermediate; ref: https://docs.flutter.dev/cookbook/networking/authenticated-requests -->
`dio` (a popular package, not part of the SDK) adds interceptors, cancellation tokens, form data, and timeouts per request. Interceptors centralise cross-cutting concerns such as attaching an auth token, logging, and refreshing on a 401.

```dart
final dio = Dio(BaseOptions(
  baseUrl: 'https://api.example.com',
  connectTimeout: const Duration(seconds: 5),
));
dio.interceptors.add(InterceptorsWrapper(
  onRequest: (o, h) {
    o.headers['Authorization'] = 'Bearer ${tokens.access}';
    h.next(o);
  },
  onError: (e, h) async {
    if (e.response?.statusCode == 401 && await tokens.refresh()) {
      return h.resolve(await dio.fetch(e.requestOptions));
    }
    h.next(e);
  },
));
```

Pitfalls:
- Concurrent 401s each trigger a refresh; serialise with a lock.
- Retrying non-idempotent POSTs can duplicate side effects.

Interview tip: describe a single-flight token refresh.

## 3. Persistence

### shared_preferences and simple key-value storage
<!-- level: basic; ref: https://docs.flutter.dev/cookbook/persistence/key-value -->
`shared_preferences` stores small primitive values (bool, int, double, String, List of String) in platform storage (`SharedPreferences` on Android, `NSUserDefaults` on iOS). It suits settings and flags, not large or sensitive data. Writes are asynchronous.

```dart
final prefs = await SharedPreferences.getInstance();
await prefs.setBool('onboarded', true);
final onboarded = prefs.getBool('onboarded') ?? false;
```

Newer versions of the package also offer `SharedPreferencesAsync` and `SharedPreferencesWithCache`; check the current docs for your version.

Pitfalls:
- Storing tokens or personal data here is insecure; it is not encrypted.
- Large blobs slow startup on some platforms.

Interview tip: say what you would use instead for secrets (secure storage) and for relational data (a database).

### SQLite with sqflite or drift
<!-- level: intermediate; ref: https://docs.flutter.dev/cookbook/persistence/sqlite -->
For structured, queryable data use SQLite. `sqflite` offers raw SQL access. `drift` (formerly moor) adds type-safe queries, migrations, and reactive streams that re-emit when tables change. Both need explicit schema versions and migrations.

```dart
final db = await openDatabase(
  join(await getDatabasesPath(), 'app.db'),
  version: 2,
  onCreate: (d, v) => d.execute(
      'CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)'),
  onUpgrade: (d, from, to) async {
    if (from < 2) await d.execute('ALTER TABLE notes ADD COLUMN pinned INTEGER DEFAULT 0');
  },
);
await db.insert('notes', {'body': 'hello'});
```

Pitfalls:
- Missing migrations crash upgraded installs.
- String-concatenated SQL invites injection; use `?` placeholders.

Interview tip: mention batching writes in a transaction for speed.

### Secure storage for secrets
<!-- level: intermediate; ref: https://docs.flutter.dev/security -->
`flutter_secure_storage` (a package) stores small secrets in the iOS Keychain and in Android's encrypted storage backed by the Keystore. Use it for refresh tokens and keys. Do not embed API secrets in the app; anything shipped in the binary can be extracted.

```dart
const storage = FlutterSecureStorage();
await storage.write(key: 'refresh_token', value: token);
final t = await storage.read(key: 'refresh_token');
await storage.delete(key: 'refresh_token');
```

Pitfalls:
- Keychain items on iOS can survive an app reinstall; clear them on first launch if needed.
- Android backup and device-migration behaviour varies; test sign-out and restore flows.

Interview tip: be clear that secure storage protects data at rest, not secrets that ship inside the app.

## 4. Platform integration

### Platform channels
<!-- level: intermediate; ref: https://docs.flutter.dev/platform-integration/platform-channels -->
Platform channels let Dart call native code through asynchronous message passing. A `MethodChannel` has a name shared by both sides, and arguments are encoded with the standard message codec (numbers, strings, lists, maps, byte arrays).

```dart
const channel = MethodChannel('com.example.app/battery');

Future<int> batteryLevel() async {
  try {
    return await channel.invokeMethod<int>('getLevel') ?? -1;
  } on PlatformException catch (e) {
    throw StateError('Battery failed: ${e.message}');
  } on MissingPluginException {
    return -1; // not implemented on this platform
  }
}
```

On Android, register a handler in `MainActivity` (Kotlin), and on iOS in `AppDelegate` (Swift).

Pitfalls:
- Channel name mismatch gives `MissingPluginException`.
- Native handlers must reply on the platform main thread unless using background task queues.

Interview tip: use `EventChannel` for streams of native events.

### Pigeon and FFI
<!-- level: advanced; ref: https://docs.flutter.dev/platform-integration/platform-channels#pigeon -->
Hand-written channels use string method names and untyped maps, which are easy to break. `pigeon` generates type-safe Dart, Kotlin, Swift and other bindings from a Dart interface definition. For calling C APIs directly without message passing, use `dart:ffi` with `package:ffi`, optionally with `ffigen` to generate bindings. FFI calls are synchronous and fast but run on the calling isolate, so move blocking native calls to a background isolate.

```dart
@HostApi()
abstract class BatteryApi {
  int getLevel();
}
// run pigeon -> generated BatteryApi class usable from Dart
```

Pitfalls:
- FFI memory you allocate (`calloc`) must be freed by you.
- Plugin federation: a plugin needs separate implementations for each platform.

Interview tip: say when you choose Pigeon (typed API) versus FFI (existing C/C++ library).

## 5. Testing

### Unit tests
<!-- level: basic; ref: https://docs.flutter.dev/testing/overview -->
Unit tests verify functions, classes, and business logic with no UI. Put them under `test/` and run `flutter test`. Design code with dependency injection so you can replace network and storage with fakes or mocks.

```dart
void main() {
  test('totals cart with discount', () {
    final cart = Cart(discount: 0.1)..add(Item(price: 100));
    expect(cart.total, closeTo(90, 0.001));
  });

  test('fetch maps 500 to failure', () async {
    final repo = Repo(MockClient((_) async => http.Response('', 500)));
    expect(repo.load(), throwsA(isA<HttpException>()));
  });
}
```

Pitfalls:
- Tests that hit the real network are slow and flaky.
- Testing implementation details rather than behaviour makes refactors painful.

Interview tip: mention `mocktail` or `mockito` and how you structure code for testability.

### Widget tests
<!-- level: intermediate; ref: https://docs.flutter.dev/testing/overview#widget-tests -->
Widget tests build a widget in a test environment without a device, letting you find widgets, tap, enter text, and verify output. `pumpWidget` builds, `pump` advances one frame, and `pumpAndSettle` runs until animations finish (it can hang with infinite animations).

```dart
testWidgets('counter increments', (tester) async {
  await tester.pumpWidget(const MaterialApp(home: CounterPage()));
  expect(find.text('0'), findsOneWidget);

  await tester.tap(find.byIcon(Icons.add));
  await tester.pump();

  expect(find.text('1'), findsOneWidget);
});
```

Wrap the widget with the same providers, theme, and localisation it needs in the app.

Pitfalls:
- `pumpAndSettle` with a looping spinner times out; use `pump(Duration)`.
- Missing `MaterialApp` or `Directionality` ancestor throws.

Interview tip: mention golden tests with `matchesGoldenFile` for visual regression.

### Integration tests
<!-- level: intermediate; ref: https://docs.flutter.dev/testing/integration-tests -->
Integration tests run the whole app on a device or emulator using the `integration_test` package and drive it with the same `WidgetTester` API. They find real-world problems such as navigation flows, plugins, and platform behaviour, but are slower and need a device or a cloud device farm.

```dart
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('login flow', (tester) async {
    app.main();
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('email')), 'a@b.com');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.text('Welcome'), findsOneWidget);
  });
}
// flutter test integration_test/app_test.dart -d <device>
```

Pitfalls:
- Tests depending on a live backend are flaky; point at a controlled environment.
- Using text finders breaks under localisation; use keys.

Interview tip: describe a pyramid: many unit tests, fewer widget tests, few integration tests.

## 6. Performance

### const widgets and limiting rebuilds
<!-- level: intermediate; ref: https://docs.flutter.dev/perf/best-practices -->
Rebuilds are normal, but wasted rebuilds of large subtrees cost frame time. Mark widgets `const` so Flutter reuses the instance and skips their subtree. Split big `build` methods into small widget classes (not helper methods) so each can rebuild independently. Put `setState` or listeners as low in the tree as possible.

```dart
Column(
  children: [
    const Header(),                 // never rebuilds
    ValueListenableBuilder<int>(
      valueListenable: counter,
      builder: (_, v, child) => Row(children: [Text('$v'), child!]),
      child: const Icon(Icons.star), // built once
    ),
  ],
)
```

Pitfalls:
- Helper methods that return widgets cannot be `const` and always rebuild with their parent.
- Creating objects (controllers, futures) inside `build` repeats work every rebuild.

Interview tip: say "scope rebuilds" and give the `child` parameter of builders as an example.

### Profiling with DevTools and profile mode
<!-- level: intermediate; ref: https://docs.flutter.dev/perf/ui-performance -->
Always measure performance on a real device in profile mode (`flutter run --profile`), not debug mode, which is much slower and includes assertions. Flutter DevTools shows the frame chart (UI thread versus raster thread), the CPU profiler, memory view, and a widget rebuild tracker. A frame must complete within about 16 ms at 60 Hz, or about 8 ms at 120 Hz.

```bash
flutter run --profile -d <device>
# open DevTools -> Performance, enable "Track widget builds"
```

If the UI thread is slow, optimise Dart work (build, layout, parsing). If the raster thread is slow, look at expensive painting such as `saveLayer`, clipping, opacity and large shadows.

Pitfalls:
- Judging performance on the simulator or in debug mode.
- Optimising without evidence.

Interview tip: tell the story of using the frame chart to identify which thread is the bottleneck.

### Jank sources, Impeller and shader compilation
<!-- level: advanced; ref: https://docs.flutter.dev/perf/impeller -->
Jank is dropped frames. Common causes: heavy synchronous work on the UI isolate, rebuilding giant trees, `Opacity` or `ClipRRect` over animated content causing offscreen layers, oversized images decoded at full resolution, and first-run shader compilation. Impeller, Flutter's rendering engine, precompiles shaders to avoid runtime shader jank. It is the default on iOS and, in newer releases, on Android (version-specific; check the release notes for your Flutter version).

```dart
Image.network(
  url,
  cacheWidth: 400,  // decode at display size, not full resolution
  fit: BoxFit.cover,
)
```

Fix jank by moving CPU work to isolates, using `RepaintBoundary` around independently animating content, preferring `AnimatedBuilder` with a prebuilt `child`, and using `ListView.builder`.

Pitfalls:
- Wrapping everything in `RepaintBoundary` adds memory cost.
- `shrinkWrap` lists and `Opacity` animations are frequent culprits.

Interview tip: separate "build cost" from "raster cost" when explaining jank.
