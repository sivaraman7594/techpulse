# Go scenario questions

### A Go service's memory grows steadily for hours until Kubernetes OOM-kills it. How do you investigate?
<!-- level: advanced; kind: scenario; ref: https://go.dev/doc/gc-guide -->
Observe:
1. Graph container RSS next to Go metrics: live heap (`/gc/heap/live:bytes` from `runtime/metrics`), goroutine count, and GC frequency. This separates three causes: a growing live heap (a real leak), many goroutines (a goroutine leak holding memory), or RSS far above the heap (non-heap memory such as cgo, mmap, or memory not yet returned to the OS).

Hypothesise and verify:
2. Take two heap profiles some time apart from `/debug/pprof/heap` and diff them: `go tool pprof -diff_base=h1.pb.gz h2.pb.gz` with `-sample_index=inuse_space`. The growing allocation sites point at the leak.
3. Check `/debug/pprof/goroutine?debug=1`. Thousands of identical stacks mean leaked goroutines; their stacks and captured data are the memory.
4. Typical culprits: an unbounded map used as a cache with no eviction, a slice that only ever grows, sub-slices pinning large buffers, per-request tickers never stopped, or a global registry of listeners never removed.

Fix:
```go
// before: grows forever
var seen = map[string]time.Time{}

// after: bounded with expiry (or use an LRU library)
type expiring struct {
    mu sync.Mutex
    m  map[string]time.Time
}

func (e *expiring) sweep(maxAge time.Duration) {
    e.mu.Lock()
    defer e.mu.Unlock()
    cutoff := time.Now().Add(-maxAge)
    maps.DeleteFunc(e.m, func(_ string, t time.Time) bool { return t.Before(cutoff) })
}
```
Remember maps never shrink: after mass deletion, rebuild the map to release buckets.

Prevent:
5. Set `GOMEMLIMIT` at ~90% of the container limit so the GC works harder before the OOM killer acts (this does not fix leaks, but it removes false alarms from lazy collection).
6. Alert on live heap and goroutine count trends; add load tests that run long enough to show growth.

Common wrong answers: "call runtime.GC() periodically" or "raise the memory limit". Both hide the problem. Also, a heap profile's `alloc_space` shows allocation volume, not leaks; use `inuse_space` for leaks.

### The goroutine count climbs from 200 to 50,000 over a day. Diagnose and fix it.
<!-- level: advanced; kind: scenario; ref: https://pkg.go.dev/net/http/pprof -->
Observe: confirm with the `runtime.NumGoroutine()` metric (or `go_goroutines` from the Prometheus client). Correlate growth with traffic: if it rises per request, something per request is leaking.

Hypothesise: grab `curl localhost:6060/debug/pprof/goroutine?debug=1`. This groups goroutines by identical stack with a count, so the leak is usually the top entry, for example `49,812 @ ... chan send ... orders.(*Client).fetchWithTimeout`.

Typical causes:
- A goroutine sends its result on an unbuffered channel, but the caller already returned on timeout, so nobody receives.
- A receiver waits on a channel that is never closed.
- An HTTP call without a timeout to a hung upstream.
- A `for { select { ... } }` loop started per request with no `ctx.Done()` case.

Verify by reading the leaking stack and reproducing in a test.

Fix the typical timeout leak:
```go
func (c *Client) fetchWithTimeout(ctx context.Context, id string) (Item, error) {
    ctx, cancel := context.WithTimeout(ctx, time.Second)
    defer cancel()

    type res struct { it Item; err error }
    ch := make(chan res, 1) // buffered: sender can always complete
    go func() {
        it, err := c.fetch(ctx, id) // ctx stops the work itself
        ch <- res{it, err}
    }()
    select {
    case r := <-ch:
        return r.it, r.err
    case <-ctx.Done():
        return Item{}, ctx.Err()
    }
}
```
Better still, if `fetch` honours ctx, call it directly without a goroutine.

Prevent:
- Every goroutine has an owner and an exit condition: context cancellation, closed input channel, or bounded work.
- Use `go.uber.org/goleak` in tests (`goleak.VerifyNone(t)`) and alert on goroutine count trends.
- Go 1.25's `testing/synctest` reports goroutines left durably blocked in the bubble.

Wrong answer: "increase memory". Each leaked goroutine also holds whatever it references, so leaks grow both memory and scheduler overhead.

### A Go pod with a 2-CPU limit shows p99 latency spikes of ~100 ms while average CPU looks low. What is going on?
<!-- level: advanced; kind: scenario; ref: https://go.dev/doc/go1.25 -->
Observe: look at the container metrics `container_cpu_cfs_throttled_periods_total` and `throttled_seconds`. Check what `runtime.GOMAXPROCS(0)` reports at startup and which Go version built the binary.

Hypothesis: CFS CPU throttling. Linux enforces a CPU limit as a quota per 100 ms period (2 CPUs = 200 ms of CPU time per 100 ms). On Go 1.24 and earlier, GOMAXPROCS defaults to the node's CPU count, say 32. During a burst (GC mark phase, a fan-out request), 32 threads run in parallel, burn the 200 ms quota in ~6 ms, and then every thread is frozen until the next period. Requests in flight see up to ~94 ms of added latency, while averaged CPU usage still looks modest.

Verify: throttled periods correlate with latency spikes; GOMAXPROCS is far above the limit; GC traces (`GODEBUG=gctrace=1`) show GC using many Ps.

Fix:
- Upgrade to Go 1.25+ with `go 1.25` in go.mod: the runtime then sets GOMAXPROCS from the cgroup CPU limit automatically and updates it if the limit changes.
- On older versions, import `go.uber.org/automaxprocs` or set `GOMAXPROCS=2` via the Deployment env (`valueFrom: resourceFieldRef: limits.cpu`).
- Consider whether a CPU limit is needed at all; many teams set requests only for latency-sensitive services.

```go
import _ "go.uber.org/automaxprocs" // pre-1.25 only

func main() {
    slog.Info("startup", "gomaxprocs", runtime.GOMAXPROCS(0))
}
```

Prevent: log GOMAXPROCS at startup, dashboard throttling, and keep GOMEMLIMIT and CPU settings in the deployment template.

Wrong answers: "add more replicas" (each still throttles) or "the GC is slow" (GC is the trigger, throttling is the cause).

### The race detector reports a data race on a configuration struct that is hot-reloaded. How do you fix it without slowing every request?
<!-- level: intermediate; kind: scenario; ref: https://pkg.go.dev/sync/atomic -->
Observe: the report shows a write in `reloadConfig` (triggered by SIGHUP or a file watcher) and reads in request handlers accessing `cfg.RateLimit` and `cfg.Features`. Even if "it works", a race is undefined behaviour: readers can see a half-updated struct or a map being written concurrently, which can crash with `concurrent map read and map write`.

Options:
1. RWMutex around the config: correct, but every request takes a read lock, and readers must not hold references after unlocking.
2. Copy-on-write with `atomic.Pointer[Config]` (Go 1.19+): build a brand new immutable Config, then atomically swap the pointer. Readers do a single atomic load and get a consistent snapshot, with no locks.

```go
type Config struct {
    RateLimit int
    Features  map[string]bool // never mutated after publish
}

var cfg atomic.Pointer[Config]

func reload(path string) error {
    next, err := parse(path) // fully built before publishing
    if err != nil {
        return err           // keep old config on error
    }
    cfg.Store(next)
    return nil
}

func handler(w http.ResponseWriter, r *http.Request) {
    c := cfg.Load() // one snapshot for the whole request
    if !c.Features["new-checkout"] { /* ... */ }
}
```

Verify: rerun the tests with `-race` and a stress test that reloads continuously while serving.

Trade-offs: copy-on-write costs an allocation per reload (cheap, reloads are rare) and requires discipline that nobody mutates a published config; enforce this by keeping fields unexported with getters, or by cloning maps when building.

Common wrong answers: "use `sync.Map` for the config" (does not give a consistent multi-field snapshot), or "it is only a bool, races on bools are fine" (not in Go's memory model).

### Production requests occasionally hang forever until the service is restarted. How do you find a deadlock in a live Go process?
<!-- level: advanced; kind: scenario; ref: https://go.dev/doc/diagnostics -->
Observe: the runtime only reports "all goroutines are asleep - deadlock!" when every goroutine is blocked, which never happens in a server (the HTTP listener is always waiting). So you need a goroutine dump.

Collect evidence before restarting:
1. `curl localhost:6060/debug/pprof/goroutine?debug=2` gives full stacks with wait reasons and durations, e.g. `goroutine 812 [sync.Mutex.Lock, 47 minutes]`.
2. Without pprof, send `SIGQUIT` (`kill -QUIT <pid>`): the runtime dumps all stacks to stderr and exits. Set `GOTRACEBACK=all` to include runtime goroutines.
3. Enable the mutex and block profiles (`runtime.SetMutexProfileFraction(5)`, `runtime.SetBlockProfileRate`) for contention that is slow rather than stuck.

Hypothesise from stacks. Classic patterns:
- Lock-order inversion: goroutine A holds `accounts.mu` and waits for `ledger.mu`; goroutine B holds `ledger.mu` and waits for `accounts.mu`.
- Re-entrant locking: a method holding `mu` calls another method that locks `mu` again (Go mutexes are not re-entrant).
- RWMutex upgrade: holding `RLock` and calling `Lock`.
- Channel cycles: two goroutines each waiting to send to the other on unbuffered channels.

Fix example (re-entrancy):
```go
func (s *Store) Transfer(a, b string, amt int64) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.balanceLocked(a) < amt { // helper assumes lock is held
        return ErrInsufficient
    }
    s.bal[a] -= amt
    s.bal[b] += amt
    return nil
}

func (s *Store) Balance(id string) int64 { // public: locks
    s.mu.Lock(); defer s.mu.Unlock()
    return s.balanceLocked(id)
}
func (s *Store) balanceLocked(id string) int64 { return s.bal[id] }
```
For multi-lock code, impose a global order (e.g. lock accounts by ascending ID).

Prevent: keep critical sections small, never call callbacks or I/O while holding locks, add timeouts via context on all waits, and add a liveness probe that exercises the lock path so Kubernetes restarts a stuck pod while you investigate.

### A service crashed with "fatal error: concurrent map writes". What happened and how do you fix it properly?
<!-- level: intermediate; kind: scenario; ref: https://go.dev/doc/faq#atomic_maps -->
What happened: two goroutines wrote to the same built-in map without synchronisation (or one wrote while another read). The runtime's map implementation sets a "writing" flag and detects concurrent access on a best-effort basis; when detected it throws a fatal error, which is not a panic, so recovery middleware cannot catch it and the whole process dies.

Investigate: the crash output includes stacks of the goroutines involved. Identify the map (often a package-level cache, a struct field shared by handlers, or a map captured by goroutines in a fan-out). Reproduce with `go test -race`, which reliably reports such races even when the runtime check does not fire.

Fix options, in order of preference:
1. Do not share: give each goroutine its own map and merge results afterwards, or send updates over a channel to a single owner goroutine.
2. Guard with `sync.Mutex`/`sync.RWMutex`, encapsulated in a type so callers cannot bypass the lock.
3. `sync.Map` if the access pattern fits (keys written once, read many times, or disjoint key sets per goroutine).
4. Sharded maps for very high contention.

```go
// Fan-out that previously wrote into a shared map
results := make([]Result, len(ids)) // each goroutine owns one index
var wg sync.WaitGroup
for i, id := range ids {
    wg.Go(func() { results[i] = lookup(id) }) // Go 1.25 WaitGroup.Go
}
wg.Wait()
byID := make(map[string]Result, len(ids)) // single goroutine builds the map
for i, id := range ids {
    byID[id] = results[i]
}
```

Prevent: run all tests with `-race` in CI, and review any struct shared across goroutines for unguarded maps.

Wrong answers: "wrap the handler in recover" (cannot catch fatal errors) and "it only happens under load so it is fine" (it is a correctness bug that also corrupts data silently when not detected).

### After a release, CPU usage on a Go API doubled. How do you find the cause?
<!-- level: intermediate; kind: scenario; ref: https://go.dev/blog/pprof -->
Observe: confirm the change correlates with the release, not traffic. Compare requests per second and CPU per request. Check GC metrics: if GC CPU fraction jumped, the cause is more allocation, not more computation.

Collect:
1. CPU profile from a new instance and an old one (or from before and after): `go tool pprof -http=: http://host:6060/debug/pprof/profile?seconds=30`.
2. Diff them: `go tool pprof -diff_base=old.pb.gz new.pb.gz` highlights functions whose cost grew.
3. Heap profile with `-sample_index=alloc_space` to see allocation hot spots if `runtime.mallocgc`/`gcBgMarkWorker` dominate.

Hypotheses commonly confirmed:
- A regex compiled per request (`regexp.MustCompile` inside a handler).
- JSON marshalling moved into a hot loop, or logging at debug level with expensive attributes.
- A new O(n^2) loop, e.g. `slices.Contains` inside a loop over the same data.
- Reflection-based validation on every request.
- String concatenation in loops, or `fmt.Sprintf` replacing `strconv`.

```go
// Before: compiled on every request
func validSKU(s string) bool {
    return regexp.MustCompile(`^[A-Z]{3}-\d{4}$`).MatchString(s)
}

// After: compiled once at package init
var skuRE = regexp.MustCompile(`^[A-Z]{3}-\d{4}$`)

func validSKU(s string) bool { return skuRE.MatchString(s) }
```

Verify the fix with a benchmark (`-benchmem`, `benchstat` against the old version) and then in production metrics.

Prevent: keep benchmarks for hot paths in CI, collect continuous profiles, and consider PGO, which also needs representative profiles.

Wrong answer: scaling out first. That is a fine mitigation, but without a profile you are guessing.

### You must process a 20 GB CSV file with expensive per-row work in parallel, but output order must match input order. How do you design it?
<!-- level: advanced; kind: scenario; ref: https://go.dev/blog/pipelines -->
Constraints: memory must stay bounded (no loading the file), throughput should use all cores, and order is required.

Design a three-stage pipeline:
1. Reader: one goroutine streams with `csv.Reader` (ReuseRecord for fewer allocations) and emits jobs tagged with a sequence number. Batching rows (say 500 per job) amortises channel overhead.
2. Workers: N goroutines (N = GOMAXPROCS for CPU-bound work) process batches.
3. Reorderer/writer: receives results in any order, holds them in a map keyed by sequence, and writes whenever the next expected sequence is present.

Bound memory: the reorder buffer can grow if one batch is slow. Use a semaphore so the reader cannot run more than K batches ahead of the writer.

```go
type batch struct { seq int; rows [][]string }
type result struct { seq int; out []string }

sem := make(chan struct{}, 4*workers) // max batches in flight
jobs, results := make(chan batch), make(chan result)

g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { defer close(jobs); return readBatches(ctx, r, jobs, sem) })

var wg sync.WaitGroup
for range workers {
    wg.Go(func() {
        for b := range jobs {
            results <- result{b.seq, process(b.rows)}
        }
    })
}
go func() { wg.Wait(); close(results) }()

g.Go(func() error {
    pending, next := map[int][]string{}, 0
    for r := range results {
        pending[r.seq] = r.out
        for out, ok := pending[next]; ok; out, ok = pending[next] {
            if err := writeLines(w, out); err != nil { return err }
            delete(pending, next)
            next++
            <-sem // release a slot only when written
        }
    }
    return nil
})
return g.Wait()
```

The reader acquires `sem <- struct{}{}` before sending each batch. In real code, worker sends should also select on `ctx.Done()` so an error in the writer does not leave workers blocked.

Trade-offs: larger batches mean less overhead but more memory and coarser parallelism. If order is not actually needed downstream, drop the reorderer; it is the main complexity.

Wrong answers: one goroutine per row (millions of goroutines, unbounded memory) or reading everything into a slice first.

### A handler must call three downstream services in parallel with a 500 ms overall budget and return partial results if some are slow. How do you implement it?
<!-- level: intermediate; kind: scenario; ref: https://pkg.go.dev/context -->
Requirements: total latency bounded by 500 ms (even if the client's deadline is longer), each call cancelled when the budget expires, and the response built from whatever finished.

Approach: derive a context with timeout, start each call in a goroutine writing to its own result slot or a buffered channel, then collect until all are done or the deadline hits. errgroup is not ideal here because one failure would cancel the others; partial results are wanted.

```go
type part struct {
    name string
    val  any
    err  error
}

func (h *Handler) dashboard(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
    defer cancel()

    calls := map[string]func(context.Context) (any, error){
        "profile": h.profile.Get,
        "orders":  h.orders.Recent,
        "recs":    h.recs.For,
    }
    ch := make(chan part, len(calls)) // buffered: late senders never block
    for name, call := range calls {
        go func() {
            v, err := call(ctx)
            ch <- part{name, v, err}
        }()
    }

    resp := map[string]any{}
    var missing []string
    for range calls {
        select {
        case p := <-ch:
            if p.err != nil {
                missing = append(missing, p.name)
                continue
            }
            resp[p.name] = p.val
        case <-ctx.Done():
            goto done
        }
    }
done:
    // anything not in resp yet is degraded
    for name := range calls {
        if _, ok := resp[name]; !ok && !slices.Contains(missing, name) {
            missing = append(missing, name)
        }
    }
    resp["degraded"] = missing
    json.NewEncoder(w).Encode(resp)
}
```

Key details: the channel buffer equals the number of calls so goroutines that finish after the deadline do not leak; every downstream client uses ctx so cancelled calls actually stop. Mark which sections are degraded so the UI can react and metrics can count it.

Trade-offs: partial responses are only acceptable for non-critical sections; the profile might be mandatory, in which case return an error if it is missing. Consider per-call budgets (e.g. recommendations get 200 ms) and hedged requests for tail latency.

Wrong answer: sequential calls with individual 500 ms timeouts, which can take 1.5 s.

### You call a partner API limited to 50 requests per second. Bursts from your service get you HTTP 429s. How do you design client-side rate limiting?
<!-- level: intermediate; kind: scenario; ref: https://pkg.go.dev/golang.org/x/time/rate -->
Observe: count 429s and when they happen; check whether the limit is per API key (shared by all your replicas) or per IP.

Design:
1. Use a token bucket from `golang.org/x/time/rate`. `rate.NewLimiter(50, 10)` allows 50 events per second with bursts of 10. `limiter.Wait(ctx)` blocks until a token is available or ctx is done, so callers inherit request deadlines naturally.
2. Share one limiter per partner across all goroutines in the process (it is concurrency-safe).
3. Multiple replicas share the partner's quota, so divide the rate by replica count, or use a distributed limiter (Redis) when precision matters.
4. Still handle 429: respect `Retry-After`, back off, and count them.

```go
type PartnerClient struct {
    http    *http.Client
    limiter *rate.Limiter
}

func NewPartnerClient(replicas int) *PartnerClient {
    perPod := rate.Limit(45.0 / float64(replicas)) // 10% headroom
    return &PartnerClient{
        http:    &http.Client{Timeout: 5 * time.Second},
        limiter: rate.NewLimiter(perPod, 5),
    }
}

func (c *PartnerClient) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    if err := c.limiter.Wait(ctx); err != nil {
        return nil, fmt.Errorf("rate limit wait: %w", err) // ctx expired while queued
    }
    resp, err := c.http.Do(req.WithContext(ctx))
    if err == nil && resp.StatusCode == http.StatusTooManyRequests {
        resp.Body.Close()
        return nil, ErrThrottled // caller retries with backoff
    }
    return resp, err
}
```

Trade-offs: `Wait` queues callers, adding latency under load; for user-facing requests, `limiter.Allow()` plus fast failure (or a queue to background processing) may be better than making users wait. A buffered channel with a `time.Ticker` also works for simple cases but lacks bursts and context-aware waiting.

Wrong answers: `time.Sleep(20 * time.Millisecond)` between calls (does not work across goroutines) or relying only on retries after 429 (wastes quota and can trigger partner-side bans).

### Implement retries with exponential backoff and jitter for a flaky dependency. What must you get right?
<!-- level: intermediate; kind: scenario; ref: https://pkg.go.dev/context#Context -->
Requirements of a correct retry loop:
1. Retry only retryable failures: timeouts, connection resets, 429, 502/503/504. Never retry 400s or validation errors.
2. Retry only idempotent operations, or use idempotency keys for writes (a POST that timed out may have succeeded).
3. Exponential backoff with a cap, plus jitter so many clients do not retry in lockstep (thundering herd).
4. Respect context: stop immediately when the caller's deadline or cancellation fires, including during the sleep.
5. Bound attempts and total time; retries multiply load on an already struggling service.

```go
func Retry(ctx context.Context, attempts int, base time.Duration, op func(context.Context) error) error {
    var err error
    for i := range attempts {
        if err = op(ctx); err == nil || !isRetryable(err) {
            return err
        }
        if i == attempts-1 {
            break
        }
        backoff := min(base<<i, 10*time.Second)              // exponential, capped
        sleep := time.Duration(rand.Int64N(int64(backoff)))  // full jitter, math/rand/v2
        t := time.NewTimer(sleep)
        select {
        case <-ctx.Done():
            t.Stop()
            return errors.Join(err, ctx.Err())
        case <-t.C:
        }
    }
    return fmt.Errorf("after %d attempts: %w", attempts, err)
}

func isRetryable(err error) bool {
    var ne net.Error
    return errors.As(err, &ne) && ne.Timeout() || errors.Is(err, ErrThrottled)
}
```

Testing: use `testing/synctest` (Go 1.25) so the backoff sleeps run on a fake clock and tests take microseconds.

Operational concerns: retries at several layers multiply (3 retries in the client x 3 in the gateway = 9 attempts); retry at one layer only. Combine with a retry budget or circuit breaker so retries stop when the dependency is clearly down.

Wrong answers: `time.Sleep` that ignores context, fixed delays without jitter, and retrying every error.

### Your queue consumer loses messages during deployments. How do you implement graceful shutdown correctly?
<!-- level: advanced; kind: scenario; ref: https://pkg.go.dev/os/signal#NotifyContext -->
Observe: messages acknowledged but not processed, or processed twice. Usually the process acks on receipt and then gets SIGKILLed mid-processing, or stops abruptly on SIGTERM.

Design:
1. Ack only after successful processing (at-least-once delivery) and make handlers idempotent, since redelivery will happen.
2. On SIGTERM, stop fetching new messages, let in-flight handlers finish within a grace period shorter than Kubernetes' `terminationGracePeriodSeconds`, then exit.
3. Separate two contexts: one that signals "stop accepting work", and one that bounds processing of in-flight messages. Handlers should not be cancelled the instant SIGTERM arrives.

```go
func main() {
    stopCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
    defer stop()

    workCtx, cancelWork := context.WithCancel(context.Background())
    defer cancelWork()

    var wg sync.WaitGroup
    for range 8 {
        wg.Go(func() {
            for {
                msg, err := q.Receive(stopCtx) // returns when stopCtx is cancelled
                if err != nil {
                    return
                }
                if err := handle(workCtx, msg); err != nil {
                    msg.Nack()
                    continue
                }
                msg.Ack()
            }
        })
    }

    <-stopCtx.Done()
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-time.After(25 * time.Second): // grace period
        cancelWork() // ask stragglers to abort; their messages will be redelivered
        <-done
    }
    q.Close()
}
```

Verify: a test that sends SIGTERM while messages are mid-flight, and a deployment with message-count reconciliation.

Prevent: set terminationGracePeriodSeconds above your grace period, keep handler duration well below the queue's visibility timeout, and add a preStop delay if a load balancer is involved.

Wrong answers: calling `os.Exit` in the signal handler, or cancelling all handlers immediately on SIGTERM.

### A function returns a nil error, yet the caller's err != nil check is true and it logs "<nil>". Explain and fix.
<!-- level: intermediate; kind: scenario; ref: https://go.dev/doc/faq#nil_error -->
Observe: the log line literally prints `<nil>` or the error's message for a nil receiver, and the code path that "returns nil" looks like this:

```go
func (v *Validator) Check(o Order) error {
    var verr *ValidationError // typed nil pointer
    if o.Qty <= 0 {
        verr = &ValidationError{Field: "qty"}
    }
    return verr // returns error interface {type: *ValidationError, value: nil}
}
```

Explanation: an interface value holds a dynamic type and a value. It equals nil only if both are nil. Converting a nil `*ValidationError` to `error` sets the type word, so the interface is non-nil even though the pointer inside is nil. Printing it calls `Error()` on a nil receiver (which may panic or print oddly).

Fix: return the untyped `nil` explicitly on the success path, and keep return types as the `error` interface, not concrete error pointers.

```go
func (v *Validator) Check(o Order) error {
    if o.Qty <= 0 {
        return &ValidationError{Field: "qty"}
    }
    return nil
}
```

The same trap appears with any interface: returning a nil `*bytes.Buffer` as an `io.Writer`, or a nil `*MyHandler` as an `http.Handler`.

Verify: add a unit test asserting `err == nil` for valid input. Static analysis (staticcheck's nilness checks and the `nilness` vet analyzer in gopls) catches some cases.

Prevent: code review rule "functions return `error`, never `*SomeError`", and helper functions that build errors should also return `error`.

Interview angle: be ready to draw the two-word interface layout and explain why Go cannot simply treat "interface containing nil pointer" as nil: methods with pointer receivers can legitimately be called on nil pointers, so the value is meaningful.

### Outbound HTTP calls get slower over time and the host shows thousands of TIME_WAIT sockets and "too many open files". What is wrong?
<!-- level: advanced; kind: scenario; ref: https://pkg.go.dev/net/http#Transport -->
Observe: `ss -s` or `netstat` shows many TIME_WAIT/ESTABLISHED connections to the same upstream; file-descriptor count grows; latency includes TCP and TLS handshakes in traces.

Hypotheses, in order of likelihood:
1. A new `http.Client`/`http.Transport` is created per request, so no connection is ever reused, and old transports keep idle connections open until they time out.
2. Response bodies are not closed, so connections stay checked out (leaked) and the transport opens new ones.
3. Bodies are closed but not drained, so the connection cannot be reused for keep-alive.
4. `MaxIdleConnsPerHost` is at the default of 2: under concurrency, most connections are closed after use instead of being kept idle, causing churn and TIME_WAIT buildup.

Verify by reading the client code and checking `httptrace.ClientTrace`'s `GotConn` (`Reused: true/false`).

Fix:
```go
var upstream = &http.Client{ // one shared client per upstream
    Timeout: 5 * time.Second,
    Transport: &http.Transport{
        MaxIdleConns:        200,
        MaxIdleConnsPerHost: 100,
        MaxConnsPerHost:     200, // optional hard cap
        IdleConnTimeout:     90 * time.Second,
    },
}

func get(ctx context.Context, url string) ([]byte, error) {
    req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    resp, err := upstream.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK {
        io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16)) // drain for reuse
        return nil, fmt.Errorf("status %d", resp.StatusCode)
    }
    return io.ReadAll(io.LimitReader(resp.Body, 10<<20))
}
```

Prevent: lint for unclosed bodies (`bodyclose` linter), construct clients only in wiring code, and expose connection metrics.

Wrong answers: raising `ulimit` (postpones the failure) or tuning kernel TIME_WAIT settings before fixing reuse.

### When a popular cache key expires, hundreds of requests hit the database at once. How do you prevent the stampede in Go?
<!-- level: intermediate; kind: scenario; ref: https://pkg.go.dev/golang.org/x/sync/singleflight -->
Observe: database load and latency spike at regular intervals matching the cache TTL of hot keys; many identical queries in the slow log.

Fix with layered techniques:
1. Request coalescing with `golang.org/x/sync/singleflight`: concurrent callers for the same key share one in-flight load. Only the first caller executes the function; others wait for its result.
2. Jittered TTLs so keys populated together do not expire together.
3. Stale-while-revalidate: serve the expired value while one goroutine refreshes in the background.

```go
type ProductCache struct {
    group singleflight.Group
    cache *ttlcache.Cache[string, Product] // any TTL cache
    db    *ProductRepo
}

func (c *ProductCache) Get(ctx context.Context, id string) (Product, error) {
    if p, ok := c.cache.Get(id); ok {
        return p, nil
    }
    v, err, _ := c.group.Do(id, func() (any, error) {
        // detach from the first caller's cancellation, but keep a deadline
        ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
        defer cancel()
        p, err := c.db.Load(ctx, id)
        if err == nil {
            ttl := 5*time.Minute + time.Duration(rand.IntN(60))*time.Second // jitter
            c.cache.Set(id, p, ttl)
        }
        return p, err
    })
    if err != nil {
        return Product{}, err
    }
    return v.(Product), nil
}
```

Detail worth mentioning: if the shared load uses the first caller's ctx and that client disconnects, every waiter gets `context.Canceled`. `context.WithoutCancel` (Go 1.21) plus an explicit timeout avoids that.

Trade-offs: singleflight works per process; with 50 replicas, you still get up to 50 loads. For cross-process coalescing use a distributed lock or early probabilistic refresh. Errors are shared too: a single failed load fails all waiters, which is usually acceptable.

Wrong answers: a global mutex around all loads (serialises unrelated keys) or simply raising the TTL.

### Your JSON API returns "items": null for empty lists and order IDs above 2^53 come back corrupted in some clients. How do you fix both?
<!-- level: intermediate; kind: scenario; ref: https://pkg.go.dev/encoding/json -->
Problem 1, null vs []: `encoding/json` encodes a nil slice as `null` and an empty non-nil slice as `[]`. Code like `var items []Item` followed by zero appends produces null, and JavaScript clients calling `.length` crash.

Fix: initialise to an empty slice at the API boundary, or normalise in a response constructor. Do not rely on every repository function remembering.

```go
type OrderList struct {
    Items []Order `json:"items"`
    Next  string  `json:"next,omitempty"`
}

func newOrderList(items []Order, next string) OrderList {
    if items == nil {
        items = []Order{}
    }
    return OrderList{Items: items, Next: next}
}
```

Problem 2, large integers: Go encodes `int64` exactly, but JavaScript numbers are IEEE-754 doubles, accurate only up to 2^53. IDs like 9007199254740993 get rounded in browsers. The same issue occurs in Go if you decode into `any` (numbers become `float64`).

Fix: encode IDs as strings. The `,string` tag option does this without changing the Go type:

```go
type Order struct {
    ID    int64  `json:"id,string"`   // "9007199254740993"
    Total int64  `json:"total_cents"` // small enough to stay numeric
}

dec := json.NewDecoder(r.Body)
dec.UseNumber() // when decoding into map[string]any, keep json.Number
```

Migration: changing a field from number to string is a breaking change for clients. Add a new field (`id_str`) or version the endpoint, then deprecate the old one.

Prevent: contract tests that snapshot JSON responses (golden files), and an API style guide: IDs as strings, money as integer minor units, empty collections as [].

Wrong answer: "use float64 for IDs" (makes it worse) or post-processing JSON with string replacement.

### A widely used exported function in your library needs a new parameter. How do you evolve the API without breaking users?
<!-- level: intermediate; kind: scenario; ref: https://go.dev/blog/module-compatibility -->
Constraint: under semantic import versioning, any change that breaks compilation of existing callers requires a new major version (`/v2` module path), which is costly for everyone. So prefer compatible evolution.

Options, from simplest:
1. Add a new function: `Dial(addr)` stays, add `DialContext(ctx, addr)` or `DialWithOptions(addr, opts)`. The standard library does this constantly (`QueryContext`, `NewRequestWithContext`). Implement the old function by calling the new one.
2. Options struct: if the function already takes a config struct, adding a field is compatible (provided callers use keyed literals, which `go vet` encourages). Zero value must mean the old behaviour.
3. Functional options: if the function is variadic in options, add a new `WithX` option.
4. Methods on a client type: new behaviour can be a field on the client set at construction.

```go
// v1.4 (existing)
func Upload(bucket, key string, r io.Reader) error {
    return UploadWithOptions(context.Background(), bucket, key, r, UploadOptions{})
}

// v1.5 (new, compatible)
type UploadOptions struct {
    ContentType string
    Retries     int // zero = library default, preserves old behaviour
}

func UploadWithOptions(ctx context.Context, bucket, key string, r io.Reader, o UploadOptions) error {
    // ...
    return nil
}
```

Mark the old function with a `// Deprecated: Use UploadWithOptions.` comment; tools like staticcheck and gopls surface it to users.

What is not compatible (and people get wrong): adding a method to an exported interface (breaks external implementations), adding a parameter, changing a return type, or changing a struct field's type. Even adding a field to a struct can break users who compare structs with `==` if the new field is not comparable.

When v2 is justified: accumulated breaking cleanups. Then publish `module example.com/lib/v2`, keep v1 maintained for a while, and provide a migration guide.

### Your team must release v2 of a Go module with breaking changes. Walk through how.
<!-- level: advanced; kind: scenario; ref: https://go.dev/blog/v2-go-modules -->
Rules: Go's semantic import versioning requires that major version 2 and above have a different module path ending in `/v2`. Importers write `import "example.com/lib/v2/client"`. This allows v1 and v2 to coexist in one build, which matters for gradual migration in large dependency graphs.

Steps:
1. Decide the strategy: major branch (change the module path on the main branch, keep v1 on a `v1` branch) or major subdirectory (create a `v2/` directory with its own go.mod). The branch approach is more common; the subdirectory approach works with tools unaware of modules.
2. Update go.mod: `module example.com/lib/v2`.
3. Update all internal imports within the module to the `/v2` path (`gofmt -r` or a simple sed; tools like `gomajor` automate it).
4. Make the breaking changes, ideally all at once to avoid v3 next month.
5. Tag `v2.0.0` on the commit. Pre-releases like `v2.0.0-rc.1` let users test.
6. Keep v1 receiving security fixes for an announced period.
7. Optionally make v1 a thin wrapper over v2 (v1 imports v2) so fixes land once, or provide type aliases where types are unchanged.

```go
// go.mod
module example.com/lib/v2

go 1.23

// consumer code
import (
    libv1 "example.com/lib/client"     // old callers keep working
    "example.com/lib/v2/client"         // migrated code
)
```

Also: if you published a broken version, use a `retract` directive in a later release so `go get` stops selecting it.

Common mistakes: tagging `v2.0.0` without changing the module path (the go command then treats it as `+incompatible` or rejects it), forgetting to update internal imports (the v2 module silently imports v1 packages), and making many small breaking releases.

Trade-off: v2 costs every consumer migration effort; exhaust compatible evolution options first.

### A test using goroutines and time.Sleep fails randomly in CI about once in fifty runs. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://pkg.go.dev/testing/synctest -->
Observe: reproduce locally with `go test -run TestX -count=500 -race`, and under CPU pressure (`-cpu=1,4` or running other tests in parallel). Flaky concurrency tests nearly always rely on timing assumptions like "100 ms is enough for the worker to process the message".

Common causes:
- Sleeping instead of synchronising: the assertion runs before the goroutine finished on a slow CI machine.
- Shared state between parallel tests.
- Map iteration order or `select` random choice assumed to be deterministic.
- Real time used for timeouts.

Fix 1: replace sleeps with explicit synchronisation (channels, WaitGroup, or a callback the code under test invokes when done).

Fix 2: for time-based logic, use `testing/synctest` (Go 1.25), which runs the test in a bubble with a fake clock that advances instantly when all goroutines are blocked.

```go
func TestDebouncerFlushesAfterQuietPeriod(t *testing.T) {
    synctest.Test(t, func(t *testing.T) {
        var flushed []string
        d := NewDebouncer(500*time.Millisecond, func(keys []string) { flushed = keys })
        defer d.Close()

        d.Add("a")
        time.Sleep(300 * time.Millisecond) // fake time: instant
        d.Add("b")
        synctest.Wait() // all bubble goroutines blocked
        if flushed != nil {
            t.Fatal("flushed too early")
        }

        time.Sleep(500 * time.Millisecond)
        synctest.Wait()
        if !slices.Equal(flushed, []string{"a", "b"}) {
            t.Fatalf("flushed = %v", flushed)
        }
    })
}
```

Fix 3, older Go: inject a clock interface or pass timer constructors so tests control time.

Prevent: run CI tests with `-race` and `-shuffle=on`; quarantine and fix flaky tests promptly rather than adding retries.

Wrong answers: increasing the sleep to 1 second (slower and still flaky) or marking the test as skipped.

### How would you design a Go service so that business logic can be unit tested without a real database?
<!-- level: intermediate; kind: scenario; ref: https://go.dev/doc/effective_go#interfaces -->
Goal: fast, deterministic unit tests for rules, plus a smaller set of integration tests against a real database for the SQL itself.

Design:
1. Define a small interface in the consuming (domain) package with only the methods the service uses. Go's implicit interfaces mean the Postgres implementation does not need to know about it.
2. The service depends on that interface; `main` wires the concrete implementation.
3. Tests provide a hand-written fake, usually an in-memory map. Fakes are often better than generated mocks because they behave realistically and tests do not over-specify call sequences.

```go
// package order
type Repository interface {
    Get(ctx context.Context, id string) (Order, error)
    Save(ctx context.Context, o Order) error
}

type Service struct {
    repo  Repository
    clock func() time.Time
}

func (s *Service) Cancel(ctx context.Context, id string) error {
    o, err := s.repo.Get(ctx, id)
    if err != nil {
        return err
    }
    if s.clock().Sub(o.CreatedAt) > 24*time.Hour {
        return ErrTooLateToCancel
    }
    o.Status = StatusCancelled
    return s.repo.Save(ctx, o)
}

// order_test.go
type memRepo struct{ m map[string]Order }

func (r *memRepo) Get(_ context.Context, id string) (Order, error) {
    o, ok := r.m[id]
    if !ok { return Order{}, ErrNotFound }
    return o, nil
}
func (r *memRepo) Save(_ context.Context, o Order) error { r.m[o.ID] = o; return nil }
```

Note the injected clock: time is a dependency too.

Integration tests: run the real repository against Postgres in a container (testcontainers-go or a CI service), behind a build tag or `testing.Short()` check, with each test in a transaction that rolls back or its own schema.

Trade-offs: interfaces with dozens of methods make fakes painful, a sign the interface should be split. Mocking `*sql.DB` directly (sqlmock) tests SQL strings, not behaviour, and breaks on harmless query changes.

Wrong answer: creating an interface for every struct up front "for testability"; define them where they are consumed, when needed.

### A micro-benchmark shows your optimisation is 40% faster, but production latency did not change. What went wrong?
<!-- level: advanced; kind: scenario; ref: https://pkg.go.dev/testing#B.Loop -->
Possible explanations to investigate:
1. The function was not on the critical path. A CPU profile from production shows where time actually goes; if the function was 2% of CPU, a 40% gain is under 1% overall (Amdahl's law). Latency may be dominated by I/O, lock waits or GC assists, which a CPU micro-benchmark does not capture.
2. The benchmark was wrong:
   - The compiler eliminated the work (result unused). Before Go 1.24 you needed a package-level sink; `for b.Loop()` (Go 1.24) prevents this automatically.
   - Setup was included or excluded inconsistently (`b.ResetTimer` missing in old-style loops).
   - Inputs were unrealistic: tiny data that fits in L1 cache, or always the same branch.
   - A single run on a noisy laptop; differences within noise. Use `-count=10` and `benchstat` to get confidence intervals.
3. Allocation versus CPU: the new version may be faster per call but allocate more, increasing GC work under real concurrency. Always run with `-benchmem`.
4. Contention: single-goroutine benchmarks hide lock or cache-line contention; `b.RunParallel` exposes it.

```go
func BenchmarkParse(b *testing.B) {
    inputs := loadRealisticSamples(b) // captured from production, varied
    b.ReportAllocs()
    i := 0
    for b.Loop() {
        _, _ = Parse(inputs[i%len(inputs)])
        i++
    }
}

func BenchmarkParseParallel(b *testing.B) {
    inputs := loadRealisticSamples(b)
    b.RunParallel(func(pb *testing.PB) {
        for i := 0; pb.Next(); i++ {
            _, _ = Parse(inputs[i%len(inputs)])
        }
    })
}
```

Process going forward: profile production first, optimise the top items, verify with benchstat, then confirm with production metrics or a canary. Consider PGO for broad, low-effort gains.

Wrong answer: trusting a single `ns/op` number from one run.

### Your service reads 50 MB files, extracts a 100-byte header from each, and keeps headers in a cache. Memory use is enormous. Why?
<!-- level: advanced; kind: scenario; ref: https://go.dev/blog/slices-intro -->
Observe: heap profile `inuse_space` attributes most memory to `os.ReadFile` / `io.ReadAll`, even though the files were "discarded" long ago. The cache holds only 100-byte headers, so why would 50 MB buffers survive?

Explanation: slicing does not copy. `header := data[:100]` produces a slice header pointing into the same 50 MB backing array. As long as the cache holds that slice, the garbage collector must keep the entire array alive. The same happens with strings: `s[:100]` of a huge string shares memory, and so do strings produced by some zero-copy conversions.

Fix: copy the bytes you keep, which detaches them from the large array.

```go
func readHeader(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()
    // Better: read only what you need instead of the whole file
    buf := make([]byte, 100)
    if _, err := io.ReadFull(f, buf); err != nil {
        return nil, err
    }
    return buf, nil
}

// If you already have the big slice:
header := bytes.Clone(data[:100])  // Go 1.20
name := strings.Clone(bigString[:32])
```

Even better, avoid loading the whole file: stream with `io.ReadFull` or `bufio.Reader` and read only the header, which also reduces I/O and GC pressure.

Verify: heap profile after the fix shows memory proportional to the cache size; a test with `runtime.ReadMemStats` before and after a batch.

Prevent: treat any long-lived sub-slice of a large buffer as suspicious in code review; document functions that return slices aliasing their input.

Related trap: `slices.Delete` or re-slicing a slice of pointers (`s = s[1:]` in a queue) keeps removed elements reachable through the backing array until it is reallocated; clear the vacated slots or use a ring buffer.

### Building combinations with append, results mysteriously overwrite each other. Debug this code.
<!-- level: intermediate; kind: scenario; ref: https://go.dev/ref/spec#Appending_and_copying_slices -->
The code:

```go
func subsets(nums []int) [][]int {
    var out [][]int
    var walk func(i int, cur []int)
    walk = func(i int, cur []int) {
        if i == len(nums) {
            out = append(out, cur) // BUG: stores a slice that shares memory
            return
        }
        walk(i+1, cur)
        walk(i+1, append(cur, nums[i]))
    }
    walk(0, nil)
    return out
}
```

With certain inputs, several stored subsets end up with the same last element.

Explanation: `append(cur, x)` writes into `cur`'s backing array when there is spare capacity. Two branches of the recursion that share the same `cur` prefix can therefore both append into the same slot. The second write overwrites the element the first branch already stored in `out`, because `out` holds slice headers pointing to that shared array, not copies.

Fix: copy when storing (the stored value must be independent), and optionally force reallocation when branching with a full slice expression.

```go
walk = func(i int, cur []int) {
    if i == len(nums) {
        out = append(out, slices.Clone(cur)) // snapshot
        return
    }
    walk(i+1, cur)
    walk(i+1, append(cur[:len(cur):len(cur)], nums[i])) // cap == len: forces new array
}
```

Verify: a table test with inputs of length 3, 4 and 5 comparing against expected sets; the bug often only appears with length 4+ because of capacity growth patterns (1, 2, 4, 8).

Prevent: remember the rule "if you keep a slice, own it": clone slices before storing them in long-lived structures, especially in backtracking, pagination buffers and reused scratch buffers (`buf[:0]` reuse).

Interview angle: this exact bug is a favourite in coding interviews done in Go. Explain len/cap and aliasing rather than just patching with a copy.

### You run 1,000 jobs concurrently; the first failure should cancel the rest and the function should return that error. How?
<!-- level: intermediate; kind: scenario; ref: https://pkg.go.dev/golang.org/x/sync/errgroup -->
Requirements: bounded concurrency (1,000 simultaneous database or API calls would overload dependencies), first-error-wins, cancellation of in-flight and not-yet-started jobs, and no goroutine leaks.

Solution: `errgroup.WithContext` plus `SetLimit`.

```go
func ImportAll(ctx context.Context, files []string) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(16) // at most 16 jobs running

    for _, f := range files {
        if ctx.Err() != nil {
            break // stop scheduling after the first failure
        }
        g.Go(func() error {
            if err := importFile(ctx, f); err != nil {
                return fmt.Errorf("import %s: %w", f, err)
            }
            return nil
        })
    }
    return g.Wait() // first non-nil error; ctx is cancelled at that point
}
```

How it works: `Go` blocks when 16 jobs are active, so scheduling is naturally throttled. When any function returns an error, the group cancels the derived ctx; jobs that pass ctx to database and HTTP calls abort quickly; `Wait` returns the first error after all goroutines exit.

Points interviewers look for:
- Cancellation is cooperative: `importFile` must pass ctx down and check it in long loops.
- Loop variable capture is safe in Go 1.22+ (per-iteration `f`); older code needed `f := f`.
- Partial side effects: some files were imported before the failure. Decide whether that is acceptable or whether each import must be transactional and idempotent so a rerun is safe.
- If you need all errors rather than the first, collect them in a mutex-guarded slice and `errors.Join` them, without cancelling.

Wrong answers: a WaitGroup with an error channel of size 1 and no cancellation (others keep running), or unbounded `go` per file.

### A panic in a background goroutine crashed the whole service. How do you make background workers resilient?
<!-- level: intermediate; kind: scenario; ref: https://go.dev/blog/defer-panic-and-recover -->
Background: net/http recovers panics per request, but only in request-handling goroutines. A panic in any goroutine you start yourself, if unrecovered, terminates the entire process, regardless of recovery middleware elsewhere. `recover` only works in a deferred function in the panicking goroutine.

Step 1, find the bug: the crash log has the panic value and stack. Fix the root cause (nil map, nil pointer, index out of range). Recovery is a safety net, not a fix.

Step 2, add a supervised start helper for long-running background goroutines:

```go
func Go(ctx context.Context, name string, fn func(context.Context) error) {
    go func() {
        for {
            err := runSafely(ctx, fn)
            if ctx.Err() != nil {
                return // shutting down
            }
            slog.Error("worker exited, restarting", "worker", name, "err", err)
            select {
            case <-time.After(5 * time.Second): // backoff before restart
            case <-ctx.Done():
                return
            }
        }
    }()
}

func runSafely(ctx context.Context, fn func(context.Context) error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v\n%s", r, debug.Stack())
            panicsTotal.Inc()
        }
    }()
    return fn(ctx)
}
```

Trade-offs:
- Recovering can leave shared state inconsistent (a mutex locked forever, a half-updated struct). Recover at boundaries where state is per-job, and restart the unit of work rather than continuing it.
- Not every crash should be caught: `fatal error`s (concurrent map writes, out of memory) cannot be recovered at all.
- For panics representing broken invariants, crashing and letting the orchestrator restart can be safer than limping on; alert either way.

Prevent: run tests with `-race`, fuzz parsers, and enforce that all goroutines are started through the helper (or errgroup) so none run unsupervised.

### The GC is using 30% of CPU in a high-throughput Go service. How do you reduce it?
<!-- level: advanced; kind: scenario; ref: https://go.dev/doc/gc-guide -->
Observe: confirm with `GODEBUG=gctrace=1`, `runtime/metrics` (`/cpu/classes/gc/total:cpu-seconds`) or a CPU profile showing `gcBgMarkWorker`, `scanobject` and `mallocgc` near the top. Note live heap size and GC frequency.

Understand the levers: GC cost ≈ frequency x work per cycle. Frequency rises with allocation rate and falls with more heap headroom (GOGC/GOMEMLIMIT). Work per cycle rises with live heap size and number of pointers to scan.

Steps:
1. Find allocation hot spots: heap profile with `-sample_index=alloc_space` (bytes) and `alloc_objects` (count). Fix the top few:
   - preallocate slices/maps; reuse buffers (`buf[:0]`, `sync.Pool` for encoders and byte buffers);
   - avoid `fmt.Sprintf` and interface boxing in hot paths; use `strconv.Append*`;
   - stream instead of `io.ReadAll`;
   - avoid per-request `regexp`/`template` compilation.
2. Reduce pointer density of long-lived data: a cache of 10 million `*Item` entries is expensive to mark; storing values in a slice indexed by ID, or pointer-free structs (IDs instead of pointers), drastically cuts scanning.
3. Give the GC more headroom if memory allows: raise `GOGC` (e.g. 200–400), or set `GOMEMLIMIT` near the container limit with a higher GOGC (or `GOGC=off` if the live heap is stable and well below the limit).
4. Upgrade Go: newer releases improved the allocator and GC (Green Tea GC is the default in Go 1.26 and was an experiment in 1.25).

```go
// Before: allocation per call
func key(tenant string, id int64) string { return fmt.Sprintf("%s:%d", tenant, id) }

// After: one allocation, no reflection
func key(tenant string, id int64) string {
    b := make([]byte, 0, len(tenant)+21)
    b = append(b, tenant...)
    b = append(b, ':')
    b = strconv.AppendInt(b, id, 10)
    return string(b)
}
```

Verify with benchstat (`allocs/op`) and production GC CPU metrics.

Wrong answers: calling `runtime.GC()` manually, or setting `GOGC=off` without a memory limit.

### You are upgrading a large codebase from Go 1.21 to Go 1.25. What do you check and what can change behaviour?
<!-- level: advanced; kind: scenario; ref: https://go.dev/doc/godebug -->
Go keeps source compatibility, but some behaviour changes are tied to the `go` line in go.mod and controlled by GODEBUG settings. Plan the upgrade in two steps: build with the new toolchain first (keeping `go 1.21`), then raise the `go` line.

Checklist:
1. Toolchain: update CI images and `toolchain` line; confirm `GOTOOLCHAIN` behaviour in CI (auto-download vs local).
2. Loop variables (Go 1.22): with `go 1.22+`, each iteration has its own variable. This fixes closure-capture bugs but can change behaviour of code that accidentally relied on sharing, and can add allocations in rare hot loops. Use `go vet` and the `bisect` tool (`golang.org/x/tools/cmd/bisect`) with the `loopvar` experiment to find tests whose behaviour changed.
3. `net/http` ServeMux (1.22): pattern syntax changed; paths containing `{` or method-like prefixes may now be interpreted differently. `GODEBUG=httpmuxgo121=1` restores the old behaviour temporarily.
4. Timers (1.23): channels from `time.NewTimer`/`Ticker` became unbuffered and unstopped timers are collectable; code doing `len(t.C)` or relying on stale values after `Reset` may change (`asynctimerchan=1` reverts).
5. GOMAXPROCS (1.25): container CPU limits now set GOMAXPROCS; remove automaxprocs or ensure no conflicting settings; expect different parallelism in pods.
6. Crypto/TLS defaults change across releases (e.g. disabled legacy cipher suites, post-quantum key exchange added); test connections to old partner systems.
7. New vet checks may fail CI (printf with non-constant format strings, waitgroup misuse in 1.25).

```go
// go.mod after upgrade, with a temporary compatibility setting
module example.com/billing

go 1.25

godebug (
    httpmuxgo121=1 // remove after routes are migrated
)
```

Verify: full test suite with `-race`, staging soak test, compare latency/memory profiles before and after. Roll out gradually.

Wrong answers: "Go never breaks anything" (source compatibility holds, but behaviour tied to the go line and GODEBUG does change) or bumping the `go` line and toolchain in the same commit as feature work.

### Design an in-process event bus where publishers must never be blocked by slow subscribers.
<!-- level: advanced; kind: scenario; ref: https://go.dev/tour/concurrency/5 -->
Requirements to clarify: delivery guarantees (best effort vs must not lose), ordering per subscriber, and what happens when a subscriber falls behind.

Design: each subscriber gets its own buffered channel and its own goroutine. Publishing does a non-blocking send to each subscriber's channel. When a buffer is full, the bus applies a policy: drop the event (and count it), drop the oldest, or disconnect the subscriber. Publishers hold a read lock only while iterating subscribers.

```go
type Bus[T any] struct {
    mu   sync.RWMutex
    subs map[int]chan T
    next int
}

func (b *Bus[T]) Subscribe(buf int) (<-chan T, func()) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.subs == nil {
        b.subs = map[int]chan T{}
    }
    id, ch := b.next, make(chan T, buf)
    b.subs[id] = ch
    b.next++
    return ch, func() { // unsubscribe
        b.mu.Lock()
        defer b.mu.Unlock()
        if c, ok := b.subs[id]; ok {
            delete(b.subs, id)
            close(c)
        }
    }
}

func (b *Bus[T]) Publish(ev T) (dropped int) {
    b.mu.RLock()
    defer b.mu.RUnlock()
    for _, ch := range b.subs {
        select {
        case ch <- ev:
        default:
            dropped++ // slow subscriber: drop, never block the publisher
        }
    }
    return dropped
}
```

Correctness details: closing a subscriber channel happens under the write lock, so a publisher (holding the read lock) can never send on a closed channel. Unsubscribe is idempotent.

Trade-offs:
- Dropping is acceptable for metrics, UI updates and cache invalidation hints, not for financial events. For must-not-lose delivery, use a durable queue (Kafka, NATS JetStream) instead of an in-process bus.
- Large buffers absorb bursts but hide sustained slowness and increase memory.
- Expose per-subscriber drop counters so slow consumers are visible.

Wrong answers: one unbuffered channel shared by all subscribers (each event goes to only one subscriber), or blocking sends (one slow subscriber stalls the whole system).

### Events for the same customer must be processed in order, but different customers should be processed in parallel. How do you build it?
<!-- level: advanced; kind: scenario; ref: https://go.dev/blog/pipelines -->
The tension: a plain worker pool processes everything in parallel, so two events for customer 42 can run on different workers and finish out of order (e.g. "address updated" applied before "account created").

Solution: key-based sharding. Create N worker goroutines, each with its own channel. Route each event to `hash(customerID) % N`. All events for one customer go to the same worker, which processes them sequentially, while different customers spread across workers.

```go
type Sharded struct {
    shards []chan Event
}

func NewSharded(ctx context.Context, n int, handle func(context.Context, Event) error) *Sharded {
    s := &Sharded{shards: make([]chan Event, n)}
    for i := range n {
        ch := make(chan Event, 256)
        s.shards[i] = ch
        go func() {
            for ev := range ch {
                if err := handle(ctx, ev); err != nil {
                    slog.Error("event failed", "customer", ev.CustomerID, "err", err)
                    // retry in place or park to a DLQ; skipping breaks ordering
                }
            }
        }()
    }
    return s
}

func (s *Sharded) Submit(ctx context.Context, ev Event) error {
    h := fnv.New32a()
    h.Write([]byte(ev.CustomerID))
    ch := s.shards[h.Sum32()%uint32(len(s.shards))]
    select {
    case ch <- ev:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Trade-offs and details:
- Hot keys: one very active customer can saturate its shard while others idle (head-of-line blocking for customers sharing that shard). More shards than workers' CPU count helps; extreme cases need per-key queues.
- Failure policy: if an event fails, retrying in place preserves order but stalls the shard; sending to a dead-letter queue keeps flow but may break order for that customer. Make this a deliberate decision.
- Changing N re-maps keys; during a resize, ordering is only safe after draining. Consistent hashing reduces movement.
- If events come from Kafka, partitioning by customer key gives the same guarantee across processes; keep per-partition sequential processing.

Wrong answer: a global mutex per event (serialises everything) or sorting by timestamp after processing.

### During rolling deployments clients see a burst of 502 errors. The Go service implements Shutdown. What else is missing?
<!-- level: advanced; kind: scenario; ref: https://pkg.go.dev/net/http#Server.Shutdown -->
Observe: 502s cluster in the seconds after pods receive SIGTERM. Load balancer logs show connections refused or reset by terminating pods.

Root cause: Kubernetes sends SIGTERM and removes the pod from Service endpoints concurrently. Propagation to kube-proxy, ingress controllers and cloud load balancers takes a few seconds. If the process calls `srv.Shutdown` immediately, it closes its listener while traffic is still being routed to it, so new connections fail. Keep-alive connections held by the proxy can also be closed mid-flight.

Fix sequence on SIGTERM:
1. Mark the service not-ready (readiness endpoint returns 503) so it is removed from rotation.
2. Keep serving for a drain delay (5–15 s) while routing catches up. Alternatively, use a `preStop` hook with `sleep`.
3. Call `srv.Shutdown(ctx)` with a timeout so in-flight requests complete; it also closes idle keep-alive connections.
4. Close downstream resources (DB pool, message producers) after the server stops.
5. Ensure `terminationGracePeriodSeconds` exceeds drain delay plus shutdown timeout.

```go
var ready atomic.Bool

mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
    if !ready.Load() {
        http.Error(w, "draining", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
})

ready.Store(true)
<-sigCtx.Done()
ready.Store(false)
time.Sleep(10 * time.Second) // let load balancers notice
ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
defer cancel()
_ = srv.Shutdown(ctx)
db.Close()
```

Also verify: the server sets `IdleTimeout` lower than the load balancer's idle timeout (or vice versa according to the LB's docs) to avoid the race where the server closes an idle connection just as the LB sends a request on it, another classic source of sporadic 502s.

Wrong answers: increasing replica count, or relying on liveness probes (liveness restarts pods; readiness controls traffic).

### Stream a large database export as a CSV HTTP response without buffering it in memory, and stop work if the client disconnects.
<!-- level: intermediate; kind: scenario; ref: https://pkg.go.dev/net/http#ResponseController -->
Requirements: constant memory regardless of row count, timely first byte, cancellation on disconnect, and sane timeouts for a long response.

Design:
1. Use `r.Context()`: net/http cancels it when the client disconnects. Pass it to `QueryContext` so the database query is cancelled too.
2. Iterate rows and write each through `csv.Writer` wrapping the `http.ResponseWriter`; data flows as it is produced.
3. Flush periodically so proxies and clients receive data incrementally.
4. The server's `WriteTimeout` would kill a long export; extend the deadline for this handler with `http.ResponseController` (Go 1.20).

```go
func (h *Handler) export(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    rc := http.NewResponseController(w)
    _ = rc.SetWriteDeadline(time.Now().Add(10 * time.Minute))

    rows, err := h.db.QueryContext(ctx, `SELECT id, email, created_at FROM customers ORDER BY id`)
    if err != nil {
        http.Error(w, "query failed", http.StatusInternalServerError)
        return
    }
    defer rows.Close()

    w.Header().Set("Content-Type", "text/csv")
    w.Header().Set("Content-Disposition", `attachment; filename="customers.csv"`)
    cw := csv.NewWriter(w)
    _ = cw.Write([]string{"id", "email", "created_at"})

    n := 0
    for rows.Next() {
        var id int64
        var email string
        var created time.Time
        if err := rows.Scan(&id, &email, &created); err != nil {
            slog.ErrorContext(ctx, "scan", "err", err)
            return // headers already sent: cannot change status now
        }
        _ = cw.Write([]string{strconv.FormatInt(id, 10), email, created.Format(time.RFC3339)})
        if n++; n%1000 == 0 {
            cw.Flush()
            if err := rc.Flush(); err != nil {
                return // client gone
            }
        }
    }
    cw.Flush()
    if err := rows.Err(); err != nil {
        slog.ErrorContext(ctx, "export aborted", "err", err) // includes context.Canceled
    }
}
```

Trade-offs: once streaming starts, a mid-stream failure cannot become a 500; the client sees a truncated file. Mitigate with a trailer or a final checksum row, or generate exports asynchronously to object storage and return a download link, which is better for very large or business-critical exports. Also run long exports against a read replica.

Wrong answer: `rows` into a slice, then `json.Marshal` everything.

### Interview: what does this program print, and how does the answer differ between Go 1.21 and Go 1.22+?
<!-- level: intermediate; kind: scenario; ref: https://go.dev/blog/loopvar-preview -->
```go
func main() {
    var prints []func()
    for i := 0; i < 3; i++ {
        prints = append(prints, func() { fmt.Print(i, " ") })
    }
    for _, p := range prints {
        p()
    }

    var wg sync.WaitGroup
    for _, name := range []string{"a", "b", "c"} {
        wg.Add(1)
        go func() { defer wg.Done(); fmt.Print(name, " ") }()
    }
    wg.Wait()
}
```

Go 1.21 and earlier (or a module declaring `go 1.21`): the loop declares one variable `i` shared by all iterations. Each closure captures that variable, not its value at the time. After the loop, `i` is 3, so the first part prints `3 3 3`. The goroutines similarly share `name`; they usually print `c c c`, but it is actually a data race, so output is undefined and `-race` reports it.

Go 1.22+ (module `go` line 1.22 or later): each iteration creates a fresh variable, for both 3-clause and range loops. The first part prints `0 1 2`. The goroutines print `a`, `b`, `c` in some nondeterministic order (scheduling is not ordered), for example `c a b`.

Points to make in the interview:
- The semantics are selected per module by the `go` line, not by the toolchain version, so the same source can behave differently in two modules.
- The old workaround `i := i` inside the loop is now redundant but harmless.
- The 1.22 change can add allocations if a per-iteration variable escapes, but the compiler avoids it when the variable does not escape.
- Even in 1.22, goroutine output order is not guaranteed; only per-iteration binding changed.
- `go vet`'s loopclosure check was the old safety net; `bisect` helps find tests affected by the change during upgrades.

Common wrong answer: "Go 1.22 makes goroutines run in loop order."

### A teammate passes the database handle, logger and feature flags through context.WithValue to avoid long parameter lists. Review this design.
<!-- level: intermediate; kind: scenario; ref: https://pkg.go.dev/context#WithValue -->
Assessment: this is a recognised anti-pattern. The context package documentation says to use values only for request-scoped data that transits processes and APIs, not for passing optional parameters to functions.

Problems:
1. Hidden dependencies: a function's signature no longer shows what it needs. `func Charge(ctx, amount)` secretly requires a DB in ctx and fails at runtime (or panics on a failed type assertion) if it is missing.
2. No compile-time checking: values are `any`; typos in keys or wrong types become runtime bugs.
3. Testing is harder: tests must build magic contexts instead of passing fakes.
4. Lookup cost: `ctx.Value` walks the context chain linearly; deep chains with many values add up in hot paths.
5. Lifetimes are confused: a DB pool is application-scoped, not request-scoped.

Better design: dependencies are fields on a struct created at startup; methods use them. Long parameter lists usually mean a missing type.

```go
type PaymentService struct {
    db     *sql.DB
    log    *slog.Logger
    flags  FeatureFlags
    gw     Gateway
}

func NewPaymentService(db *sql.DB, log *slog.Logger, flags FeatureFlags, gw Gateway) *PaymentService {
    return &PaymentService{db: db, log: log, flags: flags, gw: gw}
}

func (s *PaymentService) Charge(ctx context.Context, userID string, amount int64) error {
    if s.flags.Enabled(ctx, "3ds") { /* ... */ }
    // ctx carries only cancellation, deadline and request metadata
    return nil
}
```

What is appropriate in context: request IDs, trace spans (OpenTelemetry stores them there), the authenticated principal, and per-request locale. Even these deserve typed accessor functions with an unexported key type.

Nuance: a request-scoped logger enriched with the request ID is sometimes stored in context; many teams accept that, or prefer a slog handler that pulls the trace ID from ctx via `InfoContext`.

### Your Go service runs in a scratch container and fails with "x509: certificate signed by unknown authority" and DNS oddities. Why, and how do you build images correctly?
<!-- level: intermediate; kind: scenario; ref: https://pkg.go.dev/net#hdr-Name_Resolution -->
Observe: the binary works on the developer machine and in a Debian-based image but fails in `FROM scratch` (or distroless static with a cgo binary it cannot run).

Causes:
1. Missing CA certificates: `crypto/tls` loads system roots from files like `/etc/ssl/certs/ca-certificates.crt`. Scratch images contain nothing, so every TLS connection fails verification.
2. cgo-linked binary: with cgo enabled (the default when a C compiler is present on the build host), `net` and `os/user` may link against libc. On scratch there is no libc, so the binary fails to start ("no such file or directory" for the loader) or behaves differently.
3. DNS: Go has a pure-Go resolver and a cgo resolver. Behaviour differences around `/etc/nsswitch.conf`, search domains and resolver options can surprise you; in scratch there is also no `/etc/nsswitch.conf` or `/etc/hosts`.
4. Missing timezone data: `time.LoadLocation("Europe/Paris")` fails without `/usr/share/zoneinfo`.

Fix with a multi-stage build:

```dockerfile
FROM golang:1.25 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/api /api
USER nonroot:nonroot
ENTRYPOINT ["/api"]
```

Distroless static includes CA certificates, tzdata and a non-root user. If you insist on scratch, copy `/etc/ssl/certs/ca-certificates.crt` from the build stage and embed tzdata with `import _ "time/tzdata"` (adds ~450 KB).

Verify: run the container in CI and hit a TLS endpoint as a smoke test; `go version -m api` shows `CGO_ENABLED=0` in build settings.

Wrong answers: setting `InsecureSkipVerify: true` (disables security) or switching to a full OS image without understanding the cause.

### Interview: implement a goroutine-safe LRU cache with a capacity limit. What design and trade-offs do you discuss?
<!-- level: advanced; kind: scenario; ref: https://pkg.go.dev/container/list -->
Core design: a hash map for O(1) lookup plus a doubly linked list for recency order. On Get, move the element to the front; on Put, insert at the front and evict from the back when over capacity. `container/list` provides the list. A mutex guards both structures because even Get mutates order.

```go
type entry[K comparable, V any] struct {
    key K
    val V
}

type LRU[K comparable, V any] struct {
    mu    sync.Mutex
    cap   int
    ll    *list.List
    items map[K]*list.Element
}

func NewLRU[K comparable, V any](capacity int) *LRU[K, V] {
    return &LRU[K, V]{cap: capacity, ll: list.New(), items: make(map[K]*list.Element, capacity)}
}

func (c *LRU[K, V]) Get(k K) (V, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if el, ok := c.items[k]; ok {
        c.ll.MoveToFront(el)
        return el.Value.(*entry[K, V]).val, true
    }
    var zero V
    return zero, false
}

func (c *LRU[K, V]) Put(k K, v V) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if el, ok := c.items[k]; ok {
        el.Value.(*entry[K, V]).val = v
        c.ll.MoveToFront(el)
        return
    }
    c.items[k] = c.ll.PushFront(&entry[K, V]{k, v})
    if c.ll.Len() > c.cap {
        old := c.ll.Back()
        c.ll.Remove(old)
        delete(c.items, old.Value.(*entry[K, V]).key)
    }
}
```

Discussion points:
- Why not RWMutex: Get mutates recency, so it needs the exclusive lock anyway.
- Contention: one lock serialises all operations; shard into N independent LRUs by key hash for high concurrency, accepting approximate global LRU order.
- Memory: `container/list` allocates per element and stores `any`, adding pointer chasing and GC scanning; a production cache might use a slice-backed list with integer indexes.
- Missing features: TTLs, size-based (bytes) limits, eviction callbacks, and stampede protection (singleflight) on misses.
- Testing: table tests for eviction order, `-race` with concurrent Get/Put, and a benchmark with `RunParallel`.
- Alternatives: libraries like hashicorp/golang-lru or ristretto (admission policy, better hit ratios).

Interviewers mostly look for the map-plus-list structure, correct locking, and awareness of contention.
