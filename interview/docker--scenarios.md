### Your Docker image is 1.5 GB and deploys are slow. How would you shrink it?
<!-- level: intermediate; kind: scenario; ref: https://docs.docker.com/build/building/best-practices/ -->
Observe: list what takes the space with `docker history --no-trunc app:1.0` and a layer explorer such as dive. Note the base image, build tools left in, package caches, copied source and test data.

Hypothesise: a full OS or SDK base image, build dependencies shipped to production, caches (apt lists, pip or npm caches), and an unscoped `COPY . .` that brings in `.git` and `node_modules`.

Verify: check each large layer, and run `docker run --rm app:1.0 du -sh /*` for a rough picture inside.

Fix:
1. Multi-stage build: compile in an SDK image, copy only the output into a slim, distroless or alpine runtime image.
2. Clean up in the same layer: `apt-get install --no-install-recommends ... && rm -rf /var/lib/apt/lists/*`.
3. Add `.dockerignore`.
4. Install only production dependencies (`npm ci --omit=dev`, `pip install --no-cache-dir`).

```dockerfile
FROM node:20 AS build
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run build
FROM node:20-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package*.json .
RUN npm ci --omit=dev
CMD ["node", "dist/server.js"]
```

Prevent: set an image size budget in CI.

Common wrong answers
- Deleting files in a later layer, which does not reduce size.
- Switching to Alpine blindly and hitting musl incompatibilities.
- Squashing layers while ignoring the bloated base.

### A container starts and exits immediately with code 0. What is going on?
<!-- level: basic; kind: scenario; ref: https://docs.docker.com/reference/dockerfile/#cmd -->
Observe: `docker ps -a` shows `Exited (0)` seconds after start, and `docker logs` is empty or short.

Hypothesise: a container lives only as long as its main process (PID 1). Exit code 0 means that process finished normally: the command was a one-shot (like `echo` or `bash` with no TTY), the app daemonised into the background (`nginx` without `daemon off;`, `service x start`), or a wrapper script ended.

Verify:

```bash
docker inspect app --format '{{.Config.Entrypoint}} {{.Config.Cmd}}'
docker run --rm -it --entrypoint sh app    # explore interactively
```

Fix: run the application in the foreground as PID 1 (`CMD ["nginx", "-g", "daemon off;"]`), end start scripts with `exec "$@"`, and keep one main process per container. For interactive shells, use `-it`.

Prevent: test the image with `docker run` before pushing, and document the expected foreground command.

Common wrong answers
- Adding `tail -f /dev/null` to keep it alive, which hides the real problem.
- Using `-d` and assuming that keeps it running.
- Using `service` managers inside containers.

### Docker builds take 12 minutes in CI even for tiny code changes. How do you speed them up?
<!-- level: intermediate; kind: scenario; ref: https://docs.docker.com/build/cache/ -->
Observe: build logs show every step re-running, no `CACHED` markers, and dependency installs repeating each time.

Hypothesise: instruction order invalidates the cache (copying all source before installing dependencies), the CI runner starts with an empty cache each run, or the build context is huge and sent every time.

Verify: compare two consecutive local builds (the second should be nearly instant), check the context size ("transferring context") and whether CI persists a cache.

Fix:
1. Order Dockerfile steps from least to most frequently changing: copy lockfiles, install, then copy source.
2. Add `.dockerignore`.
3. Use BuildKit cache mounts for package managers.
4. Export and import a remote cache in CI.

```bash
docker buildx build \
  --cache-from type=registry,ref=reg.example.com/app:buildcache \
  --cache-to   type=registry,ref=reg.example.com/app:buildcache,mode=max \
  -t reg.example.com/app:$GIT_SHA --push .
```

Prevent: track build duration and cache-hit rate, and keep base images pinned to avoid surprise invalidations.

Common wrong answers
- Using `--no-cache` for safety every time.
- Throwing larger runners at it.
- Combining everything into one layer.

### An app in a container cannot connect to the database running on the host or in another container. How do you debug?
<!-- level: basic; kind: scenario; ref: https://docs.docker.com/engine/network/ -->
Observe: "connection refused" or timeouts. Identify where the database runs: on the host, in another container, or remote.

Hypothesise: `localhost` inside a container refers to the container itself; containers on the default bridge cannot resolve names; the database listens only on `127.0.0.1`; firewall or wrong port.

Verify from inside the container:

```bash
docker exec -it app sh
getent hosts db            # name resolution
nc -zv db 5432             # port reachability
docker network inspect appnet
```

Fix: for container-to-container, put both on a user-defined network and use the service name as host (`db:5432`). For a host database use `host.docker.internal` (Docker Desktop, or `--add-host=host.docker.internal:host-gateway` on Linux) and make the database listen on a reachable interface. Do not publish the database port to the world just to connect.

Prevent: configure hosts via environment variables and use Compose so networking is declared.

Common wrong answers
- Using `localhost` in the connection string.
- Using `--net=host` as the default answer.
- Using container IPs, which change.

### After a container restart, all user data is gone. How do you fix it?
<!-- level: basic; kind: scenario; ref: https://docs.docker.com/engine/storage/volumes/ -->
Observe: the database or uploads folder is empty after `docker rm` and recreate, or after an image upgrade.

Hypothesise: the data lived in the container's writable layer, which is removed with the container. A restart keeps the layer, but recreating the container (every upgrade) does not.

Verify: `docker inspect app --format '{{json .Mounts}}'` shows no mounts for the data path.

Fix: store state in a named volume or external service and mount it at the data directory the app writes to.

```bash
docker volume create pgdata
docker run -d --name db -v pgdata:/var/lib/postgresql/data postgres:16
docker volume inspect pgdata
```

Recovery: if the old container still exists (stopped), copy data out with `docker cp` or commit and mount. Otherwise restore from backup.

Prevent: back up volumes (`docker run --rm -v pgdata:/d -v $PWD:/b alpine tar czf /b/pg.tgz /d`), never run `docker compose down -v` casually, and keep databases in managed services where possible.

Common wrong answers
- Using `docker commit` to save data into an image.
- Bind mounting without handling permissions.
- Assuming restart policies preserve state.

### The Docker host's disk is 100% full. How do you find and safely reclaim space?
<!-- level: intermediate; kind: scenario; ref: https://docs.docker.com/reference/cli/docker/system/prune/ -->
Observe: builds and containers fail with "no space left on device". Check `df -h` for the Docker root (`/var/lib/docker`).

Hypothesise: accumulated unused images, stopped containers, dangling build cache, orphaned volumes, or unrotated container logs growing without bound.

Verify:

```bash
docker system df -v
du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail
```

Fix, from safest to most destructive:
1. Truncate or rotate the oversized log, and configure rotation.
2. `docker builder prune` for build cache.
3. `docker image prune -a --filter "until=168h"` for old images.
4. `docker container prune` for stopped containers.
5. Review volumes before `docker volume prune`, because volumes may hold real data.

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

(That goes in `/etc/docker/daemon.json`, then restart the daemon, which applies to new containers.)

Prevent: scheduled prune jobs, log rotation, disk alerts at 80%, and a separate partition for Docker data.

Common wrong answers
- `docker system prune -a --volumes` on a production host without checking.
- Deleting files under `/var/lib/docker` by hand.
- Only raising the disk size.

### `docker stop` takes 10 seconds and the app drops requests when containers are replaced. Why?
<!-- level: intermediate; kind: scenario; ref: https://docs.docker.com/reference/cli/docker/container/stop/ -->
Observe: stopping always takes exactly the default timeout, and the logs show no graceful shutdown messages.

Hypothesise: the process never receives `SIGTERM`, so Docker waits then sends `SIGKILL`. Causes: shell-form `CMD` (so `sh -c` is PID 1 and does not forward signals), a wrapper script without `exec`, or an app that does not handle the signal.

Verify:

```bash
docker top app            # who is PID 1?
docker exec app ps -o pid,args
docker kill --signal=SIGTERM app ; docker logs app
```

Fix: use exec-form entrypoints (`CMD ["node","server.js"]`), end scripts with `exec "$@"`, handle `SIGTERM` in the app (stop accepting new connections, finish in-flight work, close pools, exit), and use `docker run --init` or tini if the app spawns children. Set `--stop-timeout` to cover real drain time.

Prevent: add a shutdown test to CI that sends `SIGTERM` and asserts a clean exit within the time budget.

Common wrong answers
- Lowering the stop timeout to make it faster.
- Relying on `SIGKILL` always working fine.
- Adding `sleep` calls to the script.

### A container is repeatedly killed with exit code 137 under load. How do you investigate?
<!-- level: intermediate; kind: scenario; ref: https://docs.docker.com/engine/containers/resource_constraints/ -->
Observe: restarts correlate with traffic peaks, and exit code 137 means the process received SIGKILL.

Hypothesise: the container exceeded its memory limit (kernel OOM kill), or Docker killed it after a stop timeout, or the host ran out of memory.

Verify:

```bash
docker inspect app --format '{{.State.OOMKilled}} {{.HostConfig.Memory}}'
docker stats --no-stream
dmesg -T | grep -i "killed process"
```

`OOMKilled=true` confirms a cgroup limit breach. Check whether the runtime sizes its heap from host memory rather than the limit (older JVMs, Node default old-space).

Fix: understand actual need (profile peak usage), then set a sensible `--memory` with headroom; configure the runtime (`-XX:MaxRAMPercentage=75`, `--max-old-space-size`); reduce per-request memory use; fix leaks if usage grows without bound.

Prevent: dashboards for memory versus limit, load tests, and alerts on restart count.

Common wrong answers
- Removing the limit and risking the host.
- Doubling the limit repeatedly.
- Assuming a code crash without checking `OOMKilled`.

### You discover a database password inside a published image. What is your response?
<!-- level: intermediate; kind: scenario; ref: https://docs.docker.com/build/building/secrets/ -->
Observe: the secret appears in `docker history`, an `ENV` instruction, or in a file copied during build, and the image may be in public or shared registries and cached on many hosts.

Hypothesise: treat it as compromised. Deleting a file in a later layer does not remove it from earlier layers, and anyone who pulled the image has it.

Verify: scan layers (`docker history --no-trunc`, `trivy image --scanners secret`, dive), and check registry pull logs to estimate exposure.

Fix, in order:
1. Rotate the credential now and review database access logs.
2. Rebuild without the secret and push a new tag, then delete the vulnerable tags and untag in the registry (and clear caches).
3. Fix the build: use BuildKit secret mounts for build-time needs, and inject runtime secrets via environment from a secret store or mounted files.

```dockerfile
RUN --mount=type=secret,id=token \
    TOKEN=$(cat /run/secrets/token) ./fetch-private-package.sh
```

Prevent: secret scanning in CI, a `.dockerignore` for env files, and short-lived credentials.

Common wrong answers
- Adding a later `RUN rm` and re-pushing.
- Squashing and ignoring rotation.
- Keeping the same secret and relying on a private registry.

### The image runs on your Apple Silicon laptop but fails on the server with "exec format error". Why?
<!-- level: intermediate; kind: scenario; ref: https://docs.docker.com/build/building/multi-platform/ -->
Observe: the container exits at start with `exec format error` or `exec /app: exec format error`.

Hypothesise: a CPU architecture mismatch. The image was built for `linux/arm64` on the laptop but the server is `linux/amd64` (or vice versa), so the binary cannot execute.

Verify:

```bash
docker image inspect app --format '{{.Architecture}}/{{.Os}}'
uname -m                       # on the server
docker buildx imagetools inspect reg/app:1.0
```

Fix: build for the target platform, or better, publish a multi-architecture manifest.

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t reg/app:1.0 --push .
```

Make sure base images and dependencies exist for both architectures, and that any pre-built native binaries downloaded in the Dockerfile select the architecture using `TARGETARCH`. As a stop-gap run with `--platform linux/amd64` locally under emulation, accepting slower speed.

Prevent: build in CI on the production architecture or with buildx, and test the exact pushed digest.

Common wrong answers
- Reinstalling Docker on the server.
- Assuming shell script line endings.
- Copying the binary compiled on the laptop.

### With Docker Compose the API crashes at startup because the database is not ready. How do you fix it properly?
<!-- level: basic; kind: scenario; ref: https://docs.docker.com/compose/how-tos/startup-order/ -->
Observe: first `docker compose up` shows connection errors from the API, but a second run or manual restart works.

Hypothesise: `depends_on` only orders container start, and Postgres needs several seconds to initialise and accept connections.

Verify: compare timestamps: the API's first connection attempt versus "database system is ready to accept connections" in the database log.

Fix, layered:
1. Add a healthcheck to the database and use `depends_on` with `condition: service_healthy`.
2. Make the application retry connections with backoff, because dependencies restart in production too.
3. Run migrations as a separate one-shot service.

```yaml
db:
  image: postgres:16
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 3s
    retries: 20
api:
  depends_on:
    db: { condition: service_healthy }
```

Prevent: treat startup ordering as an optimisation only, never a correctness guarantee.

Common wrong answers
- `sleep 30` in the entrypoint.
- Using `restart: always` to loop until it works without fixing resilience.
- Using `wait-for-it` scripts as the only defence.

### A Kubernetes rolling update causes a few seconds of downtime each release. How do you get zero-downtime deployments?
<!-- level: intermediate; kind: scenario; ref: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-update-deployment -->
Observe: 502 or connection-reset errors in the load balancer for a short period during each rollout.

Hypothesise: new pods receive traffic before they are ready (no or weak readiness probe); old pods are terminated while still getting requests, because endpoint removal and SIGTERM race; too many old pods go down at once (`maxUnavailable`); app does not drain connections.

Verify: watch `kubectl get pods -w` and `kubectl get endpointslices -w` during a rollout, review the probes, and inspect the preStop and grace period settings.

Fix:

```yaml
strategy:
  rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
spec:
  terminationGracePeriodSeconds: 45
  containers:
    - name: api
      readinessProbe: { httpGet: { path: /ready, port: 8080 }, periodSeconds: 3 }
      lifecycle: { preStop: { exec: { command: ["sleep", "10"] } } }
```

Also handle `SIGTERM` in the app to finish in-flight requests, add a PodDisruptionBudget, run at least two replicas, and ensure `minReadySeconds` gives the new version time to prove itself.

Prevent: rehearse deployments under load in staging.

Common wrong answers
- Using `Recreate` strategy.
- Only increasing replicas.
- Assuming readiness passing means the app is warmed up.

### New pods stay in Pending state. How do you find out why and fix it?
<!-- level: intermediate; kind: scenario; ref: https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/ -->
Observe: `kubectl get pods` shows `Pending` with no node assigned.

Hypothesise: the scheduler cannot place the pod. Candidates: insufficient CPU or memory for the requests, untolerated taints, node selector or affinity mismatch, topology spread or anti-affinity rules, an unbound PVC, or a quota in the namespace.

Verify: the scheduler explains itself in events.

```bash
kubectl describe pod web-7c9 | sed -n '/Events/,$p'
# 0/6 nodes are available: 3 Insufficient memory, 3 node(s) had untolerated taint...
kubectl get pvc
kubectl describe resourcequota -n team-a
kubectl describe nodes | grep -A6 "Allocated resources"
```

Fix according to cause: lower requests to realistic values, add nodes (check the cluster autoscaler logs), add tolerations or fix labels, correct the PVC or StorageClass, raise the quota. If the autoscaler should have reacted, verify node group limits and instance availability.

Prevent: right-size requests with metrics, alert on pods Pending for more than a few minutes, and keep capacity headroom.

Common wrong answers
- Deleting and recreating the pod repeatedly.
- Removing resource requests entirely.
- Rebooting nodes.

### A pod fails with ImagePullBackOff from a private registry. What do you check?
<!-- level: basic; kind: scenario; ref: https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/ -->
Observe: status `ErrImagePull` then `ImagePullBackOff`. The event message states the exact error: "unauthorized", "not found", or "i/o timeout".

Hypothesise: wrong image name or tag, missing or expired credentials, pull secret in the wrong namespace, network egress blocked, or a registry rate limit.

Verify:

```bash
kubectl describe pod api-5d | grep -A8 Events
kubectl get pod api-5d -o jsonpath='{.spec.imagePullSecrets}'
kubectl get secret regcred -n prod -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d
# try from a node or debug pod:
crictl pull reg.example.com/team/api:1.4.2
```

Fix: correct the tag, recreate the docker-registry secret in the pod's namespace and reference it (or attach it to the ServiceAccount so all pods inherit it), refresh expired tokens (cloud registries often issue 12-hour tokens, so use the node's IAM role or a credential helper instead), and open egress or use a registry mirror.

Prevent: use workload identity or node roles rather than static tokens, and run image existence checks in the pipeline.

Common wrong answers
- Making the registry public.
- Retrying the rollout without reading the event.
- Putting credentials in the Dockerfile.

### A pod keeps getting OOMKilled in Kubernetes. How do you decide the right memory settings?
<!-- level: intermediate; kind: scenario; ref: https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/ -->
Observe: `kubectl describe pod` shows `Last State: Terminated, Reason: OOMKilled, Exit Code: 137`, with restarts increasing.

Hypothesise: working set exceeds the limit, because the limit is too low, a memory leak, a load spike, or a runtime unaware of the container limit. Memory also counts page cache and tmpfs volumes.

Verify:

```bash
kubectl top pod api-5d --containers
kubectl get --raw /apis/metrics.k8s.io/v1beta1/namespaces/prod/pods/api-5d
# Prometheus: container_memory_working_set_bytes vs kube_pod_container_resource_limits
```

Look at the usage trend: flat plateau near limit suggests under-sizing; steady growth suggests a leak (heap dump or profile).

Fix: set the limit above the observed p99 working set with headroom, set requests close to typical usage, configure the runtime to respect it (`MaxRAMPercentage`, `GOMEMLIMIT`, Node `--max-old-space-size`), cap in-app buffers and caches, and fix leaks found by profiling. Memory-backed `emptyDir` counts toward the limit.

Prevent: VPA in recommendation mode, load tests, alerts when memory is above 85% of limit.

Common wrong answers
- Removing the limit.
- Raising it again and again.
- Confusing node-level eviction with container OOM.

### A Service is up but requests to it time out. How do you trace the problem?
<!-- level: intermediate; kind: scenario; ref: https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/ -->
Observe: pods are Running, but `curl http://api` from another pod hangs or is refused.

Hypothesise: one of the stages fails: DNS resolution, Service selecting no endpoints, wrong `targetPort`, pods not Ready, app bound to localhost, NetworkPolicy blocking, or kube-proxy and CNI issues.

Verify step by step:

```bash
kubectl get svc api -o wide
kubectl get endpointslices -l kubernetes.io/service-name=api
kubectl get pods -l app=api -o wide
kubectl run t --rm -it --image=nicolaka/netshoot -- bash
  nslookup api ; curl -v api:80 ; curl -v <podIP>:8080
kubectl get networkpolicy -A
```

If direct pod IP works but the Service fails, the issue is the selector, ports or readiness. If neither works, look at the app binding (`0.0.0.0`) and NetworkPolicies. If DNS fails, inspect CoreDNS pods and logs.

Fix the matching element and re-test from the same client namespace.

Prevent: standard labels and port naming, Service smoke tests in the deployment pipeline.

Common wrong answers
- Restarting pods at random.
- Testing from your laptop only.
- Assuming the Ingress is at fault before checking the Service.

### The HPA does not scale up even though the service is overloaded. Why?
<!-- level: intermediate; kind: scenario; ref: https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/ -->
Observe: latency is high, but replica count stays flat. `kubectl get hpa` shows `<unknown>/70%` or a low utilisation figure.

Hypothesise: no metrics (Metrics Server missing or failing), pods lack CPU requests so utilisation cannot be computed, the app is bottlenecked on something other than CPU (database, locks, I/O), max replicas reached, or scale-up is blocked by pending pods with no node capacity.

Verify:

```bash
kubectl describe hpa api        # conditions: AbleToScale, ScalingActive, ScalingLimited
kubectl top pods
kubectl get apiservices | grep metrics
kubectl get pods | grep Pending
```

Fix: install or repair the Metrics Server, add CPU requests, choose a metric matching the bottleneck (requests per second or queue length through custom or external metrics, for example with KEDA), raise `maxReplicas`, and ensure node autoscaling can supply capacity. Tune `behavior` for faster scale-up.

Prevent: test autoscaling under load before launch, and alert when the HPA is at max or `ScalingActive` is false.

Common wrong answers
- Lowering the target to 10% to force scaling.
- Scaling manually forever.
- Ignoring the unknown metric status.

### `kubectl drain` hangs during a node upgrade. What is blocking it?
<!-- level: intermediate; kind: scenario; ref: https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/ -->
Observe: the drain prints "Cannot evict pod as it would violate the pod's disruption budget" repeatedly, or waits on a pod that never terminates.

Hypothesise: a PodDisruptionBudget demands more availability than currently exists (for instance `minAvailable` equals replicas, or a single-replica app), pods use local storage or are unmanaged, finalizers or long grace periods keep a pod terminating, or a DaemonSet needs `--ignore-daemonsets`.

Verify:

```bash
kubectl get pdb -A
kubectl describe pdb api-pdb -n prod       # Allowed disruptions: 0
kubectl get pods -A --field-selector spec.nodeName=node-3
kubectl get pod stuck -o jsonpath='{.metadata.finalizers}'
```

Fix: scale the workload up so the PDB permits a disruption, adjust the PDB to `maxUnavailable: 1`, add replicas for single-instance apps, and run with `--ignore-daemonsets --delete-emptydir-data` where appropriate. Investigate pods stuck terminating (unresponsive process, volume detach) rather than force-deleting stateful ones.

Prevent: design PDBs to always allow at least one disruption, and test upgrades in staging.

Common wrong answers
- Deleting the PDB permanently.
- Force-deleting pods of a StatefulSet.
- Skipping the drain and rebooting the node.

### A rollout is stuck halfway and some users get errors. How do you diagnose and roll back?
<!-- level: intermediate; kind: scenario; ref: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-back-a-deployment -->
Observe: `kubectl rollout status deploy/api` waits; `kubectl get rs` shows the new ReplicaSet with unavailable pods and the old one still serving.

Hypothesise: the new version fails to become ready (bad config, crash, failing probe, missing secret, image issue), or resources are insufficient. The Deployment stops the rollout to protect availability.

Verify:

```bash
kubectl rollout status deploy/api --timeout=60s
kubectl get pods -l app=api
kubectl describe pod <new-pod>
kubectl logs <new-pod> --previous
kubectl rollout history deploy/api
```

Fix: if users are affected or the cause is not quickly fixable, roll back immediately:

```bash
kubectl rollout undo deploy/api
```

Then fix forward in a new build, with the root cause confirmed from logs and events. Check backward compatibility of any database change, since the rollback does not undo it.

Prevent: readiness probes, `progressDeadlineSeconds`, canary releases or progressive delivery (Argo Rollouts, Flagger), and automated rollback in the pipeline.

Common wrong answers
- Deleting the new pods repeatedly.
- Editing live resources without recording them in Git.
- Forgetting database compatibility during rollback.

### Pods intermittently fail to resolve service names. How do you troubleshoot DNS in the cluster?
<!-- level: advanced; kind: scenario; ref: https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/ -->
Observe: occasional "Temporary failure in name resolution" or 5-second delays on outbound calls, more under load.

Hypothesise: CoreDNS overloaded or crashing, too few replicas, node-level conntrack races for UDP, the `ndots:5` search-path default causing many failed queries per lookup, upstream DNS failures, or a NetworkPolicy blocking port 53.

Verify:

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=50
kubectl exec -it app -- cat /etc/resolv.conf
kubectl run d --rm -it --image=nicolaka/netshoot -- dig +search api.prod.svc.cluster.local
kubectl top pods -n kube-system
```

Check CoreDNS metrics for SERVFAIL and latency, and compare query volume.

Fix: scale CoreDNS (or use the DNS autoscaler), deploy NodeLocal DNSCache, use fully qualified names with trailing dots for external hosts or lower `ndots` in `dnsConfig`, reuse connections to reduce lookups, allow DNS in NetworkPolicies, and fix upstream resolvers.

Prevent: DNS dashboards and alerts, and load-test lookups.

Common wrong answers
- Hard-coding IP addresses.
- Restarting the application each time.
- Blaming the application library without checking CoreDNS.

### You changed a ConfigMap but the application still uses old values. What happened?
<!-- level: basic; kind: scenario; ref: https://kubernetes.io/docs/concepts/configuration/configmap/#mounted-configmaps-are-updated-automatically -->
Observe: `kubectl get cm app-config -o yaml` shows the new value, but the app behaves as before.

Hypothesise: the value was injected as an environment variable (read only at container start), or mounted via `subPath` (never updated), or the application reads the file only once at startup. Mounted ConfigMap volumes update after a delay (kubelet sync period plus cache TTL, often up to a minute or so), and the app must re-read them.

Verify:

```bash
kubectl exec api-5d -- printenv LOG_LEVEL
kubectl exec api-5d -- cat /etc/config/settings.json
kubectl get pod api-5d -o yaml | grep -A5 subPath
```

Fix: restart the workload (`kubectl rollout restart deploy/api`), or design for automatic rollouts by hashing the config into a pod template annotation (Helm: `checksum/config: {{ include ... | sha256sum }}`), or use a reloader controller. Applications that support live reload should watch the file.

Prevent: version ConfigMaps (immutable ConfigMaps with a hash suffix as Kustomize does) so changes always cause a rollout.

Common wrong answers
- Deleting the ConfigMap and recreating it.
- Waiting indefinitely for env vars to refresh.
- Editing the config inside the running pod.

### A database pod on Kubernetes cannot start after a node failure because its volume will not attach. What now?
<!-- level: advanced; kind: scenario; ref: https://kubernetes.io/docs/concepts/storage/persistent-volumes/ -->
Observe: the StatefulSet pod is `Pending` or `ContainerCreating`, with events such as "Multi-Attach error" or "volume node affinity conflict".

Hypothesise: a `ReadWriteOnce` block volume is still attached to the failed node (the control plane waits before force-detaching), or the volume is zonal and the pod was scheduled in another zone, or the storage driver is unhealthy.

Verify:

```bash
kubectl describe pod db-0 | sed -n '/Events/,$p'
kubectl get pv,pvc
kubectl get volumeattachment
kubectl describe pv <pv> | grep -i -A3 "node affinity"
kubectl get nodes
```

Fix: confirm the old node is truly down (not partitioned), and wait for the attach-detach timeout (about 6 minutes) or remove the stale `VolumeAttachment` carefully, with cloud provider detach if needed. Ensure the pod can run in the volume's zone (nodes available there). Avoid force-deleting pods unless you are sure the old instance is dead, as two writers could corrupt data.

Prevent: use `WaitForFirstConsumer` binding, spread across zones with replication at the database level, regular backups and tested restore, and consider operators for failover.

Common wrong answers
- Force-deleting both pod and PVC.
- Treating the database like a stateless Deployment.
- Skipping backup verification.

### Cluster costs are high and nodes look mostly idle. How do you right-size workloads?
<!-- level: advanced; kind: scenario; ref: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/ -->
Observe: compare requested versus actually used CPU and memory per workload, and node utilisation versus allocation. Scheduling is by requests, so inflated requests cause nodes to be "full" while idle.

Hypothesise: copy-pasted high requests, no autoscaling, over-provisioned replicas, unused environments left running, and mismatched node sizes causing fragmentation.

Verify with metrics:

```bash
kubectl top nodes
kubectl top pods -A --sort-by=memory
# Prometheus: sum(container_cpu_usage_seconds_total rate) vs kube_pod_container_resource_requests
```

Use tools like VPA recommendations, Goldilocks or cost tools (OpenCost, Kubecost).

Fix: set requests to approximately p90 to p95 of actual usage, with memory limits above peak; add HPA to scale with load; use the cluster autoscaler or Karpenter with consolidation; choose instance types matching workload shape; use spot nodes for tolerant workloads with PDBs; schedule dev environments off-hours; clean up orphaned volumes and load balancers.

Prevent: ResourceQuotas and LimitRanges per namespace, cost dashboards per team, and periodic reviews.

Common wrong answers
- Removing all requests.
- Cutting requests blindly and causing throttling or OOM.
- Moving to smaller nodes without checking pod size.

### `helm upgrade` fails and the release is stuck in "pending-upgrade". How do you recover?
<!-- level: advanced; kind: scenario; ref: https://helm.sh/docs/helm/helm_rollback/ -->
Observe: `helm list` shows the release status `pending-upgrade` or `failed`, and new upgrades fail with "another operation (install/upgrade/rollback) is in progress".

Hypothesise: a previous upgrade was interrupted (CI job cancelled, timeout) leaving a release Secret in a pending state, or a resource failed validation or a hook failed.

Verify:

```bash
helm history api -n prod
helm status api -n prod
kubectl get secrets -n prod -l owner=helm,name=api
helm get manifest api -n prod | kubectl diff -f -
```

Fix: roll back to the last good revision (`helm rollback api <rev> -n prod`). If rollback also refuses, identify the stuck revision Secret (`sh.helm.release.v1.api.vN`) and fix or delete the stale pending record, then retry. Investigate the actual failure (events, hook job logs), not only the lock.

Prevent: use `--atomic --timeout`, avoid cancelling deploy jobs, run `helm lint` and `helm template | kubeconform` in CI, and consider `helm diff` before apply.

Common wrong answers
- `helm uninstall` on a production release, deleting resources and data.
- Deleting the Secrets without checking.
- Re-running the same upgrade repeatedly.

### A security audit says your containers run as root. How do you harden them without breaking apps?
<!-- level: intermediate; kind: scenario; ref: https://kubernetes.io/docs/concepts/security/pod-security-standards/ -->
Observe: list pods running as UID 0 or privileged, writable root filesystems, extra capabilities, and host mounts.

Hypothesise: images default to root, and manifests have no security context. Fixing everything at once will break apps that bind low ports, write to the image filesystem, or chown files.

Verify: inventory with policy tools (`kubectl get pods -A -o jsonpath` queries, Kyverno or OPA reports, kube-bench, Trivy operator), and run the Pod Security Admission in `audit` or `warn` mode first.

Fix per workload:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: ["ALL"] }
  seccompProfile: { type: RuntimeDefault }
```

In the Dockerfile add a `USER`, fix file ownership at build time, listen on ports above 1024, and mount `emptyDir` for writable paths. Enforce progressively with namespace labels for the `baseline` and then `restricted` standards.

Prevent: admission policies in CI and cluster, and base images that are non-root by default.

Common wrong answers
- Setting `privileged: true` to make errors go away.
- Enforcing `restricted` cluster-wide on day one.
- Only changing the manifest while the image needs root-owned files.

### CPU usage is low, but latency spikes in a container with a CPU limit. What could be wrong?
<!-- level: advanced; kind: scenario; ref: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#how-pods-with-resource-limits-are-run -->
Observe: p99 latency shows periodic spikes, and average CPU graphs look comfortably below the limit.

Hypothesise: CFS CPU throttling. The limit is enforced in 100 ms periods; a multi-threaded app can burn its quota in a burst early in the period and then be paused for the remainder, while the average over a minute looks low.

Verify:

```bash
cat /sys/fs/cgroup/cpu.stat          # nr_throttled, throttled_usec (cgroup v2)
# Prometheus:
# rate(container_cpu_cfs_throttled_periods_total[5m]) / rate(container_cpu_cfs_periods_total[5m])
```

A high throttled percentage confirms it. Also check the runtime's thread count: many runtimes size thread pools by node cores, not by the limit.

Fix: raise or remove the CPU limit while keeping a proper request (many teams do this), match runtime parallelism to the allotted CPU (`GOMAXPROCS`, .NET `DOTNET_PROCESSOR_COUNT`, Java container support), and reduce bursty work.

Prevent: dashboards for throttling, and load tests under the production limits.

Common wrong answers
- Looking only at average CPU.
- Adding replicas without checking throttling.
- Increasing memory.
