### A list screen janks while scrolling on mid-range Android phones. How would you investigate and fix it?
<!-- level: intermediate; kind: scenario; ref: https://docs.flutter.dev/perf/ui-performance -->
**Observe.** Users report stutter; it is smooth on your flagship phone and in debug-mode emulators prove nothing.

**Hypothesise.** Either the UI thread (expensive `build`, layout, image work) or the raster thread (offscreen layers, shadows, clips) misses the frame deadline.

**Verify.** Run `flutter run --profile` on the actual mid-range device, open DevTools Performance, and read the frame chart: which thread is red? Enable "Track widget builds" and the CPU profiler.

**Fix.** Typical causes and fixes:
- `ListView(children: ...)` building everything: switch to `ListView.builder` and set `itemExtent`.
- Full-size images: `Image.network(url, cacheWidth: 300)`.
- Per-item `Opacity`, `ClipRRect`, big `BoxShadow`: simplify or use `RepaintBoundary` on animating parts.
- JSON parsing or sorting in `build`: precompute, or move to `Isolate.run`.

**Prevent.** Add a performance test with `traceAction` in integration tests and watch frame times in CI.

**Common wrong answers.** Optimising in debug mode, wrapping everything in `RepaintBoundary`, or blaming the framework without a profile.

### You get "RenderFlex overflowed by 42 pixels" only on small devices and with large font settings. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://docs.flutter.dev/ui/layout/constraints -->
**Observe.** Yellow-black stripes appear in a `Row` with an icon, a title and a trailing price.

**Hypothesise.** The title has unbounded width inside a `Row`, so the sum of children exceeds the available width when the text is long or scaled.

**Verify.** Open the layout explorer in DevTools, and run the screen at text scale 2.0 and a 320 px width in a widget test.

**Fix.** Give flexible children a share of the space.

```dart
Row(children: [
  const Icon(Icons.shopping_bag),
  const SizedBox(width: 8),
  Expanded(child: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis)),
  const SizedBox(width: 8),
  Text(price),
]);
```

Use `Wrap` when items can flow onto a new line, or `FittedBox` for short labels. Do not clip content that users must read.

**Prevent.** Widget tests that pump with `textScaler` and narrow sizes.

**Common wrong answers.** Hard-coding smaller font sizes, or disabling text scaling, which harms accessibility.

### Your app crashes with "setState() called after dispose()" after users navigate away quickly. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://api.flutter.dev/flutter/widgets/State/mounted.html -->
**Observe.** Crash reports show the error after a network call completes.

**Hypothesise.** An async callback or timer outlives the State: the user pops the screen, then the future completes and calls `setState`.

**Verify.** Reproduce with a throttled network, open and quickly leave the screen. Search for `await` followed by `setState`, and for timers or stream listeners that are never cancelled.

**Fix.**

```dart
Future<void> _load() async {
  final data = await repo.fetch();
  if (!mounted) return;
  setState(() => items = data);
}

@override
void dispose() {
  _timer?.cancel();
  _sub?.cancel();
  super.dispose();
}
```

Better, move the state into a notifier, bloc, or Riverpod provider so the UI simply observes and the request lifecycle is independent.

**Prevent.** Enable lints (`use_build_context_synchronously`, `cancel_subscriptions`).

**Common wrong answers.** Wrapping `setState` in try/catch or keeping everything alive with global singletons.

### Typing in a TextField loses its text when the list around it reorders. What is wrong?
<!-- level: intermediate; kind: scenario; ref: https://api.flutter.dev/flutter/foundation/Key-class.html -->
**Observe.** After sorting, the text entered in row A appears in a different row.

**Hypothesise.** Rows are matched to State by position and type, because the items have no keys. The `TextField`'s State sticks to the slot, not the data.

**Verify.** Add a debug print of the item id in `initState`; it does not re-run when items reorder, proving the State is reused.

**Fix.** Give each row a stable key from the data.

```dart
ListView(children: [
  for (final t in tasks) TaskRow(key: ValueKey(t.id), task: t),
]);
```

Also keep text in a controller owned by the item's State, or in the model.

**Prevent.** Review rule: any dynamic list of stateful items uses `ValueKey(id)`.

**Common wrong answers.** `UniqueKey()` (resets state every rebuild), index-based keys on a reorderable list, or using `GlobalKey` for every row.

### An API call fires again on every rebuild of a FutureBuilder. How do you stop that?
<!-- level: basic; kind: scenario; ref: https://api.flutter.dev/flutter/widgets/FutureBuilder-class.html -->
**Observe.** The spinner flashes whenever the parent rebuilds, and the server logs repeated calls.

**Hypothesise.** The future is created inside `build`: `FutureBuilder(future: api.load(), ...)`. Each rebuild creates a new future, which the builder treats as a new task.

**Verify.** Add a print in `api.load` and trigger rebuilds, for example by rotating the device.

**Fix.** Create the future once.

```dart
late final Future<List<Item>> _future = api.load();

Widget build(BuildContext context) => FutureBuilder(
  future: _future,
  builder: (_, snap) {
    if (snap.hasError) return Text('${snap.error}');
    if (!snap.hasData) return const CircularProgressIndicator();
    return ItemList(items: snap.data!);
  },
);
```

For refresh, reassign `_future` inside `setState`. In larger apps use Riverpod `AsyncValue` or a bloc.

**Prevent.** Lint review for futures created in `build`.

**Common wrong answers.** Adding `setState` guards or memoising with a global map that never expires.

### You must parse a 5 MB JSON response without freezing the UI. What are your options?
<!-- level: intermediate; kind: scenario; ref: https://docs.flutter.dev/cookbook/networking/background-parsing -->
**Observe.** The screen freezes for 300 to 500 ms after the response arrives; DevTools shows a long UI-thread task in `jsonDecode`.

**Hypothesise.** Parsing and mapping are synchronous on the UI isolate, so frames cannot render.

**Verify.** Profile the CPU and confirm time inside `jsonDecode` and `fromJson`.

**Fix.** Do the work in another isolate.

```dart
Future<List<Product>> loadProducts(String body) =>
    Isolate.run(() => (jsonDecode(body) as List)
        .map((e) => Product.fromJson(e as Map<String, dynamic>))
        .toList());
```

(`Isolate.run` needs Dart 2.19+; `compute` is the older equivalent.) Also ask the backend for pagination or field filtering, and consider streaming parsers for very large inputs.

**Prevent.** Set a budget: any synchronous task above about 8 ms on the UI isolate is moved off.

**Common wrong answers.** Using `async`/`await` alone (it does not move CPU work to another thread) or `Future.delayed` to "spread" the work.

### Users on iOS get rejected or crash when opening the camera. How do you troubleshoot permission problems?
<!-- level: intermediate; kind: scenario; ref: https://docs.flutter.dev/deployment/ios -->
**Observe.** The app terminates immediately on iOS when the camera plugin opens, and App Review mentions missing purpose strings.

**Hypothesise.** `Info.plist` lacks `NSCameraUsageDescription`; iOS kills apps that access protected resources without it. On Android, the permission may be missing from `AndroidManifest.xml` or not requested at runtime.

**Verify.** Check Xcode's console log (it names the missing key) and the plugin's setup documentation.

**Fix.** Add precise usage strings in `ios/Runner/Info.plist`, add `<uses-permission android:name="android.permission.CAMERA"/>`, and request runtime permission before opening the camera, handling "denied" and "permanently denied" by offering a path to settings.

```dart
final status = await Permission.camera.request();
if (status.isPermanentlyDenied) await openAppSettings();
```

**Prevent.** A release checklist covering every plugin's platform setup, and tests of the denied path.

**Common wrong answers.** Generic copy ("needs the camera") that fails review, or assuming the Android manifest is enough for iOS.

### A screen works on mobile but its state is lost on web refresh. How do you design around it?
<!-- level: intermediate; kind: scenario; ref: https://docs.flutter.dev/ui/navigation/url-strategies -->
**Observe.** After pressing refresh on `/orders/123`, the app shows the home page or an empty order screen.

**Hypothesise.** The route relied on in-memory arguments (`extra` or constructor params) and the web server does not rewrite deep URLs to `index.html`.

**Verify.** Open the URL directly in a new tab; check the server returns the app for unknown paths.

**Fix.**
1. Use a router such as `go_router` and make screens addressable: `/orders/:id`.
2. The destination loads its own data using the id.
3. Use path URL strategy (`usePathUrlStrategy()`) and configure the host to rewrite all paths to `index.html`.
4. Persist essential session data (token) in storage that survives refresh.

**Prevent.** Add integration tests that start at deep URLs.

**Common wrong answers.** Serialising whole objects into the URL or keeping state in a global variable.

### The login flow sometimes leaves two copies of the home screen in the back stack. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://docs.flutter.dev/ui/navigation -->
**Observe.** After login, pressing back returns to the login screen or shows home twice.

**Hypothesise.** The code uses `push` where it should replace the stack, and an auth listener also navigates, so two navigations fire.

**Verify.** Log route changes with a `NavigatorObserver`, or print `GoRouter` location changes.

**Fix.** Make navigation a function of auth state in one place. With `go_router`:

```dart
final router = GoRouter(
  refreshListenable: authNotifier,
  redirect: (ctx, state) {
    final loggedIn = authNotifier.loggedIn;
    final atLogin = state.matchedLocation == '/login';
    if (!loggedIn) return atLogin ? null : '/login';
    return atLogin ? '/' : null;
  },
  routes: [...],
);
```

The login button only updates auth state; the router redirects. With plain Navigator use `pushAndRemoveUntil`.

**Prevent.** Test: log in, press back, assert the app leaves rather than showing login.

**Common wrong answers.** Navigating from both the button and a listener, or popping repeatedly until empty.

### Your app's memory climbs as users open and close a chat screen. How do you find the leak?
<!-- level: advanced; kind: scenario; ref: https://docs.flutter.dev/tools/devtools/memory -->
**Observe.** Memory in DevTools grows in steps with each visit and does not drop after a GC.

**Hypothesise.** The screen's State is retained by something alive: a stream subscription, a listener on a global notifier, a Timer, an AnimationController not disposed, or a closure stored in a singleton.

**Verify.** In the DevTools Memory tab take snapshots before and after several visits, diff by class, and check the retaining path for `_ChatScreenState` instances.

**Fix.**

```dart
@override
void dispose() {
  _sub.cancel();
  _controller.dispose();
  _scroll.dispose();
  notifier.removeListener(_onChange);
  super.dispose();
}
```

Do not store `BuildContext` in singletons.

**Prevent.** Use `leak_tracker` (integrated in Flutter's testing tools in recent versions) to fail tests that leave disposable objects undisposed.

**Common wrong answers.** Calling `gc` manually, or assuming Dart GC will collect objects that a stream still references.

### A background Dart task needs to continue when the app is closed (for example sync every 15 minutes). How do you approach it?
<!-- level: advanced; kind: scenario; ref: https://docs.flutter.dev/packages-and-plugins/background-processes -->
**Observe.** Requirement: periodic sync; users report data is stale on opening.

**Hypothesise.** Dart timers stop when the OS suspends the app; reliable background work needs platform schedulers.

**Verify.** Read constraints: Android WorkManager has a minimum periodic interval of 15 minutes and may batch work; iOS `BGTaskScheduler` runs at the system's discretion and is not guaranteed.

**Fix.** Use a plugin such as `workmanager`, which runs a Dart entry point in a background isolate.

```dart
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, input) async {
    await SyncService().syncOnce();
    return true;
  });
}
```

The background isolate has no UI and does not share memory with the main one, so re-initialise dependencies and use a shared database. Also use push notifications (silent) for server-triggered sync, and sync on app resume.

**Prevent.** Set expectations: background work is best-effort.

**Common wrong answers.** `Timer.periodic` or keeping a foreground service for non-essential work.

### Tokens expire and several parallel requests all try to refresh. How do you prevent a refresh storm?
<!-- level: advanced; kind: scenario; ref: https://docs.flutter.dev/cookbook/networking/authenticated-requests -->
**Observe.** Logs show five refresh calls at once, and some fail because refresh tokens are single-use, logging the user out.

**Hypothesise.** Each request independently sees a 401 and starts its own refresh.

**Verify.** Fire several requests simultaneously with an expired token and watch the order.

**Fix.** Make refresh single-flight: the first caller starts it, everybody else awaits the same Future, then retries once.

```dart
Future<String>? _refreshing;

Future<String> freshToken() =>
    _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
```

In the interceptor, on 401 await `freshToken()`, replay the request once, and on failure log the user out. Avoid replay loops by flagging retried requests. Refresh proactively shortly before expiry when possible.

**Prevent.** Unit test the refresher with concurrent callers using fake async.

**Common wrong answers.** A boolean flag with polling, retrying infinitely, or refreshing on every request.

### Widget tests pass locally but `pumpAndSettle` times out in CI. What is happening?
<!-- level: intermediate; kind: scenario; ref: https://docs.flutter.dev/testing/overview -->
**Observe.** The error says `pumpAndSettle timed out`.

**Hypothesise.** An animation never ends (a looping `CircularProgressIndicator`, a repeating controller), or a periodic timer keeps scheduling frames.

**Verify.** Run the test with a debug print of `tester.binding.hasScheduledFrame`, and check whether the screen shows an infinite spinner because a fake never completes.

**Fix.** Pump explicitly for a known time or until a finder appears.

```dart
await tester.pump();                       // start
await tester.pump(const Duration(milliseconds: 300));
expect(find.text('Loaded'), findsOneWidget);
```

Complete fake futures with a `Completer`, cancel timers in `dispose`, and use `fakeAsync` for timers. Disable infinite animations in test builds if appropriate.

**Prevent.** Prefer deterministic `pump(Duration)` over `pumpAndSettle` for screens with spinners.

**Common wrong answers.** Increasing the timeout or retrying CI.

### Colours and fonts look different from design on dark mode and different devices. How do you build a consistent theme?
<!-- level: basic; kind: scenario; ref: https://docs.flutter.dev/cookbook/design/themes -->
**Observe.** Designers file bugs: hard-coded colours look wrong in dark mode, fonts differ between screens.

**Hypothesise.** Widgets set colours and text styles directly rather than via `Theme`.

**Verify.** Grep for `Color(0x`, `TextStyle(fontSize:` and `Colors.` in feature code.

**Fix.** Centralise in `ThemeData` and read from context.

```dart
MaterialApp(
  theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: brand)),
  darkTheme: ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: brand, brightness: Brightness.dark),
  ),
  themeMode: ThemeMode.system,
);
// usage
Text('Hi', style: Theme.of(context).textTheme.titleMedium);
```

Use `colorScheme.surface`, `onSurface` instead of literal colours. Declare custom fonts in `pubspec.yaml`. `ThemeExtension` carries custom tokens.

**Prevent.** Golden tests in light and dark themes.

**Common wrong answers.** Checking brightness manually in every widget.

### The app takes 6 seconds to show the first frame in release builds. How do you reduce startup time?
<!-- level: advanced; kind: scenario; ref: https://docs.flutter.dev/perf/best-practices -->
**Observe.** The splash lingers, and a trace shows `main()` doing a lot before `runApp`.

**Hypothesise.** Blocking initialisation: awaiting remote config, opening databases, initialising many SDKs, loading large assets.

**Verify.** Timestamp each step in `main`, and use DevTools timeline or `flutter run --profile --trace-startup`.

**Fix.**
- Call `runApp` as early as possible and show a lightweight first screen.
- Initialise only what the first screen needs; defer analytics, ads, and other SDKs until after the first frame (`WidgetsBinding.instance.addPostFrameCallback`).
- Run independent initialisations in parallel with `Future.wait`.
- Avoid heavy synchronous work in the root widget's `build`; lazy load features and large assets.

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance(); // critical only
  runApp(App(prefs: prefs));
}
```

**Prevent.** Track startup time in CI as a metric.

**Common wrong answers.** Hiding the delay with a longer splash screen.

### Two developers disagree on whether to put business logic in widgets, view models or a bloc. How would you settle it?
<!-- level: advanced; kind: scenario; ref: https://docs.flutter.dev/app-architecture -->
**Observe.** Screens contain API calls, validation, and navigation in `onPressed`, and tests need the whole UI.

**Hypothesise.** There is no agreed layering, so logic is untestable and duplicated.

**Verify.** Count how many tests exercise logic without pumping widgets.

**Fix.** Adopt the layered guidance: UI layer (widgets plus a view model or cubit holding UI state), data layer (repositories as source of truth, services for APIs and storage). Rules: widgets only render state and send events; view models never import Flutter widgets; repositories return typed results; inject dependencies via constructors or the chosen DI.

```dart
class LoginViewModel extends ChangeNotifier {
  LoginViewModel(this._auth);
  final AuthRepository _auth;
  Future<void> submit(String e, String p) async { /* validate, call, notify */ }
}
```

Pick one state tool for the app and document it.

**Prevent.** An architecture decision record and lint or import rules.

**Common wrong answers.** "Whatever is fastest" or three different patterns coexisting.

### Your Android release build crashes but debug works. How do you debug it?
<!-- level: advanced; kind: scenario; ref: https://docs.flutter.dev/deployment/android -->
**Observe.** The release APK crashes at launch or when using a feature; debug is fine.

**Hypothesise.** Common causes: missing `INTERNET` permission in the main manifest (it exists only in the debug manifest by default), code shrinking/R8 removing classes used via reflection by a native SDK, a plugin config issue, or a release-only signing mismatch.

**Verify.** Run `flutter run --release` and read `adb logcat`; check `android/app/src/main/AndroidManifest.xml`; try building with `minifyEnabled false` to test the shrinker theory.

**Fix.** Add the permission, add `-keep` rules in `proguard-rules.pro` for the affected library, and keep the rules file referenced from `build.gradle`. For Dart stack traces from obfuscated builds, use `flutter symbolize` with the saved symbols.

**Prevent.** Test a release build in CI and on a device before every submission.

**Common wrong answers.** Disabling shrinking permanently or only testing in debug.

### A plugin lacks the feature you need. How do you decide between a platform channel, FFI, or a different package?
<!-- level: advanced; kind: scenario; ref: https://docs.flutter.dev/platform-integration/platform-channels -->
**Observe.** You need a native SDK feature (a payment terminal SDK, for example) not offered by pub.dev packages.

**Hypothesise.** The SDK is native Kotlin/Swift, so channels fit; if it is a C/C++ library, FFI fits better.

**Verify.** Review the SDK's API surface, threading rules, and callbacks; check pub.dev for maintained forks.

**Fix.**
- Native SDK with a moderate API: write a plugin with `pigeon` for typed channels (one interface, generated Kotlin/Swift/Dart).
- Streams of native events: `EventChannel`.
- C/C++ library: `dart:ffi` with `ffigen`, calling from a background isolate if blocking.
- UI from native: platform views (`AndroidView`, `UiKitView`), accepting performance costs.

Isolate the plugin behind a Dart interface so the app can fake it in tests.

**Prevent.** Document threading and error mapping.

**Common wrong answers.** Rewriting the app natively or using untyped string maps across dozens of methods.

### Strings must be localised into Hindi and Arabic. How would you add it?
<!-- level: intermediate; kind: scenario; ref: https://docs.flutter.dev/ui/accessibility-and-internationalization/internationalization -->
**Observe.** Strings are hard-coded; Arabic requires right-to-left layout.

**Hypothesise.** Literals, `left`/`right` padding, and manual date formatting will break.

**Verify.** Switch the device language and look for untranslated text and mirrored layout bugs.

**Fix.**
1. Add `flutter_localizations` and `intl`, enable `generate: true` in `pubspec.yaml`.
2. Create `lib/l10n/app_en.arb`, `app_hi.arb`, `app_ar.arb` and run `flutter gen-l10n`.
3. Register `AppLocalizations.delegate` and `supportedLocales` on `MaterialApp`.
4. Use `AppLocalizations.of(context).welcome(name)` with ICU plurals in ARB.
5. Use `EdgeInsetsDirectional` and `AlignmentDirectional` so RTL mirrors.

```json
{ "items": "{count, plural, =0{No items} one{1 item} other{{count} items}}" }
```

**Prevent.** Pseudo-locale tests and golden tests in RTL.

**Common wrong answers.** Concatenating translated fragments, or ignoring plurals and gender.

### A deep link opens the app but lands on the home screen instead of the target. How do you debug?
<!-- level: advanced; kind: scenario; ref: https://docs.flutter.dev/ui/navigation/deep-linking -->
**Observe.** Tapping `https://example.com/promo/42` opens the app but not the promo page; the cold start case fails more than warm start.

**Hypothesise.** Either the OS does not route the link to the app (verification failure), or the app does not map the path to a route on cold start.

**Verify.** Android: `adb shell am start -a android.intent.action.VIEW -d "https://example.com/promo/42"` and check `assetlinks.json` hosting and intent-filter `autoVerify`. iOS: check the associated domains entitlement and the `apple-app-site-association` file. In Flutter, log the initial location passed to the router.

**Fix.** Use a router that handles the incoming URL as the initial route (`go_router` or `MaterialApp.router`), make sure the path pattern `/promo/:id` exists, and make auth redirects preserve the intended destination (`?from=...`).

**Prevent.** Add a deep-link test matrix: cold, warm, logged-out.

**Common wrong answers.** Handling links only in a stream listener that starts after the first frame.

### Images from the network flicker and reload every time a screen is revisited. How do you cache them?
<!-- level: basic; kind: scenario; ref: https://docs.flutter.dev/cookbook/images/network-image -->
**Observe.** Scrolling back shows blank placeholders and the same URLs download again.

**Hypothesise.** `Image.network` uses only the in-memory image cache, which is limited and cleared under memory pressure, and does not persist to disk.

**Verify.** Check the Network panel in DevTools for repeated requests, and the server's cache headers.

**Fix.** Use a disk-caching package such as `cached_network_image`, and request correctly sized images.

```dart
CachedNetworkImage(
  imageUrl: url,
  memCacheWidth: 400,
  placeholder: (_, __) => const ColoredBox(color: Colors.black12),
  errorWidget: (_, __, ___) => const Icon(Icons.broken_image),
)
```

Also set `Cache-Control` headers server-side and use stable URLs (or versioned ones). Use `precacheImage` for the next screen.

**Prevent.** Define a max cache size and eviction.

**Common wrong answers.** Increasing `imageCache.maximumSize` indefinitely.

### A form validates on every keystroke and annoys users, but must also stop invalid submission. How would you design it?
<!-- level: basic; kind: scenario; ref: https://docs.flutter.dev/cookbook/forms/validation -->
**Observe.** Error text appears as soon as the user types the first character of an email.

**Hypothesise.** `autovalidateMode: AutovalidateMode.always` is set.

**Verify.** Inspect the `Form` and `TextFormField` configuration.

**Fix.** Validate after the first interaction or on submit.

```dart
Form(
  key: _formKey,
  autovalidateMode: AutovalidateMode.onUserInteraction,
  child: TextFormField(
    validator: (v) =>
        (v != null && v.contains('@')) ? null : 'Enter a valid email',
  ),
);

void submit() {
  if (_formKey.currentState!.validate()) save();
}
```

For server-side errors (email taken), show them via `errorText` state after the call. For complex forms use a view model holding field state.

**Prevent.** Widget tests: invalid submit shows errors and does not call the repository.

**Common wrong answers.** Disabling the button silently with no explanation.

### The team wants to adopt a state management library mid-project. How do you migrate without a rewrite?
<!-- level: advanced; kind: scenario; ref: https://docs.flutter.dev/data-and-backend/state-mgmt/options -->
**Observe.** The app has `setState` and several ad-hoc singletons; bugs come from duplicated state.

**Hypothesise.** A full rewrite is risky; the new approach can coexist with the old.

**Verify.** Map shared state by feature, and pick the most painful one (for example auth or cart).

**Fix.**
1. Choose one library by team skills and testing needs, and trial it on one new feature.
2. Wrap existing singletons behind providers or repositories so UI reads them through the new layer.
3. Migrate screen by screen, starting with leaf widgets; keep local `setState` for ephemeral state.
4. Delete the old path once nothing uses it.
5. Write a short guide with folder structure, naming, and an example PR.

**Prevent.** Include architecture review in PRs, and add lints or import rules to stop old patterns.

**Common wrong answers.** Freezing features for a rewrite, or adopting two new libraries at once.

### Your app must work offline and sync later. What architecture would you propose?
<!-- level: advanced; kind: scenario; ref: https://docs.flutter.dev/app-architecture/design-patterns/offline-first -->
**Observe.** Field users lose connectivity; edits are lost and screens show errors.

**Hypothesise.** The UI talks directly to the network, and there is no local source of truth.

**Verify.** Check which flows fail in airplane mode.

**Fix.** Offline-first repository pattern:
1. The local database (drift or sqflite) is the single source of truth; the UI observes it via streams.
2. Writes go to the local DB first with a `pendingSync` flag and a client-generated id.
3. A sync service pushes pending changes when connectivity returns (with `connectivity_plus` as a hint, not a guarantee), uses idempotency keys, and pulls remote changes using an `updatedAt` cursor.
4. Define conflict policy (last write wins, or field-level merge, or prompt user).
5. Show sync status in the UI.

**Prevent.** Test with network disabled, flaky networks, and duplicate sync retries.

**Common wrong answers.** Caching GET responses only, or relying on `connectivity_plus` to claim a request will succeed.

### Crash reports show errors you cannot reproduce. How do you set up error monitoring?
<!-- level: intermediate; kind: scenario; ref: https://docs.flutter.dev/testing/errors -->
**Observe.** Users complain of crashes, but there is no data.

**Hypothesise.** Unhandled errors are only printed to the console.

**Verify.** Check whether any handler is installed.

**Fix.** Capture all three error sources and send them to a crash reporter (Firebase Crashlytics, Sentry).

```dart
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  FlutterError.onError = (details) => reporter.recordFlutterError(details);
  PlatformDispatcher.instance.onError = (error, stack) {
    reporter.recordError(error, stack);
    return true;
  };
  runApp(const App());
}
```

Upload debug symbols for obfuscated builds, attach breadcrumbs (route, app version, user id hash), and set up alerts. Show a friendly `ErrorWidget.builder` in release.

**Prevent.** Review the crash-free rate each release.

**Common wrong answers.** Wrapping every function in try/catch or logging personal data into reports.
