## 3. Compose, builds and container security

### Docker architecture: client, daemon, containerd and runc
<!-- level: intermediate; ref: https://docs.docker.com/get-started/docker-overview/ -->
The `docker` CLI is only a client that talks over a socket to the Docker daemon (`dockerd`), which manages images, networks and volumes. For running containers, the daemon delegates to `containerd`, a lifecycle manager, which uses `runc` (an OCI runtime) to set up namespaces and cgroups and start the process. The OCI image and runtime specs mean images built with Docker run under other engines like Podman or Kubernetes' containerd.

This matters because Kubernetes dropped the Docker-specific shim (dockershim) in v1.24; clusters now talk to containerd or CRI-O directly. Images still work unchanged, but `docker` commands are not available on nodes.

```bash
docker version        # client and server sections
docker info | grep -i "runtime"
```

Pitfalls
- Mounting `/var/run/docker.sock` into a container grants root-equivalent control of the host.
- Debugging a node with `docker ps` fails on containerd nodes; use `crictl`.

Interview tip: explain dockershim removal as a runtime-interface change, not an image-format change.

### Docker Compose for multi-container apps
<!-- level: basic; ref: https://docs.docker.com/compose/ -->
Compose describes a set of services, networks and volumes in one YAML file, and `docker compose up` creates them all. It is the standard tool for local development and simple single-host deployments: an API, a database and a cache start together on a shared network where services find each other by service name.

```yaml
services:
  api:
    build: .
    ports: ["8080:8080"]
    environment:
      DB_HOST: db
    depends_on:
      db: { condition: service_healthy }
  db:
    image: postgres:16
    volumes: [pgdata:/var/lib/postgresql/data]
volumes:
  pgdata:
```

Useful commands: `docker compose up -d --build`, `logs -f api`, `exec api sh`, `down`. Override files and profiles tailor the setup per environment.

Pitfalls
- Compose is not a cluster scheduler; it has no self-healing across hosts.
- Using the legacy `docker-compose` v1 syntax with `version:` keys; the current Compose Specification does not need it.

Interview tip: say Compose for dev and test, Kubernetes for production scale.

### Healthchecks and startup order
<!-- level: intermediate; ref: https://docs.docker.com/compose/how-tos/startup-order/ -->
`depends_on` by default waits only for the dependency container to start, not to be ready, so an app can crash because Postgres is still initialising. A `HEALTHCHECK` defines a command Docker runs periodically to mark the container healthy or unhealthy, and `depends_on` with `condition: service_healthy` waits for it.

```dockerfile
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8080/health || exit 1
```

```yaml
db:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 5s
    retries: 10
```

Plain Docker only labels the state; it does not restart on unhealthy (Swarm does). Kubernetes ignores Dockerfile `HEALTHCHECK` and uses its own probes.

Pitfalls
- The check tool (curl) must exist in the image.
- A healthcheck that depends on downstream services causes cascading unhealthy states.
- Applications should still retry connections on their own.

Interview tip: say readiness must be handled in the app too, not only by orchestration order.

### BuildKit, cache and mounts
<!-- level: advanced; ref: https://docs.docker.com/build/cache/ -->
BuildKit is Docker's modern builder (the default in current releases). It builds independent stages in parallel, skips unused stages, and supports advanced features: cache mounts, secret mounts, SSH forwarding and exporting caches to registries for CI.

A cache mount keeps a directory such as the package manager cache between builds without putting it in a layer.

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-slim
WORKDIR /app
COPY package*.json .
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
```

```bash
docker buildx build --cache-to type=registry,ref=reg/app:cache,mode=max \
  --cache-from type=registry,ref=reg/app:cache -t reg/app:1.0 --push .
```

Pitfalls
- CI runners start empty, so without remote cache every build is cold.
- Copying the whole source before dependency install busts the dependency layer each commit.

Interview tip: name the three levers, instruction ordering, cache mounts and remote cache.

### Handling secrets at build time
<!-- level: advanced; ref: https://docs.docker.com/build/building/secrets/ -->
Anything passed through `ARG`, `ENV` or copied into a layer persists in image history, even if deleted later. When a build needs a credential (a private package feed token, an SSH key) use BuildKit secret mounts, which expose the secret as a temporary file only during one `RUN` step and never write it to a layer.

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
```

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc -t app .
```

For runtime secrets, inject them when the container starts (Compose or Kubernetes secrets, or a vault agent) rather than baking them into the image. Multi-stage builds help too: secrets used in a build stage never reach the final stage if you do not copy them.

Pitfalls
- `docker history` and registry scanners reveal secrets left in any layer.
- Revoking and rotating is the only fix once a secret has been pushed.

Interview tip: if a key was committed to an image, answer "rotate first, then rebuild".

### Container hardening
<!-- level: intermediate; ref: https://docs.docker.com/engine/security/ -->
A compromised container should have as little power as possible. Core measures: run as a non-root user (`USER`), make the root filesystem read-only, drop Linux capabilities and add back only what is needed, forbid privilege escalation, apply seccomp and AppArmor profiles (Docker's default seccomp profile is on), and never use `--privileged` or mount the Docker socket.

```bash
docker run -d --user 10001:10001 --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges myapp
```

Rootless Docker and user namespace remapping go further: root inside the container maps to an unprivileged user on the host. Minimal images shrink the attack surface by removing shells and package managers.

Pitfalls
- Binding ports below 1024 as non-root needs a capability or a high port.
- Read-only filesystems break apps that write temp files unless tmpfs is mounted.

Interview tip: list at least four hardening controls and the attack each blocks.

### Image scanning and supply-chain security
<!-- level: intermediate; ref: https://docs.docker.com/scout/ -->
Images bundle many third-party packages, so vulnerabilities arrive through the base image and dependencies. Scanners (Docker Scout, Trivy, Grype, registry-integrated scanners) compare the package list against vulnerability databases. Run them in CI and fail builds on severity thresholds that you have agreed on, and rescan stored images because new CVEs appear after build.

Beyond scanning: generate an SBOM (software bill of materials), sign images (Sigstore Cosign), pin base image digests, and enforce at admission time that only signed images from trusted registries may run.

```bash
docker scout cves myapp:1.4.2
trivy image --severity HIGH,CRITICAL --exit-code 1 myapp:1.4.2
```

Pitfalls
- Counting CVEs without checking reachability produces alert fatigue.
- A clean scan today is not clean forever; schedule rebuilds.

Interview tip: describe shift-left scanning plus runtime admission control.

## 4. Kubernetes architecture and workloads

### Kubernetes architecture
<!-- level: basic; ref: https://kubernetes.io/docs/concepts/overview/components/ -->
Kubernetes is a declarative orchestrator: you state the desired state, and controllers continually reconcile reality to match it. The control plane consists of the API server (the only entry point, backed by etcd for storage), the scheduler (assigns pods to nodes), the controller manager (runs reconciliation loops) and optionally a cloud controller. Each worker node runs the kubelet (starts and monitors pods through the container runtime), kube-proxy (implements Services) and a container runtime.

Everything flows through the API server: `kubectl apply` writes an object, controllers notice it and act.

```bash
kubectl get nodes -o wide
kubectl get pods -n kube-system
kubectl api-resources | head
```

Pitfalls
- etcd holds all cluster state; losing it without backups loses the cluster.
- Believing the scheduler starts containers; the kubelet does.

Interview tip: walk a `kubectl apply` of a Deployment through API server, etcd, controller, scheduler and kubelet.

### Pods
<!-- level: basic; ref: https://kubernetes.io/docs/concepts/workloads/pods/ -->
A Pod is the smallest deployable unit: one or more containers that share a network namespace (same IP and ports, talk via localhost) and can share volumes. Most pods hold one app container; sidecar containers (log shippers, proxies) and init containers (run to completion before the app starts) are the common additions.

Pods are ephemeral. They get replaced, not repaired, and each replacement gets a new IP, so you rarely create bare pods; you let a controller manage them.

```yaml
apiVersion: v1
kind: Pod
metadata: { name: web }
spec:
  initContainers:
    - { name: wait-db, image: busybox, command: ["sh","-c","until nc -z db 5432; do sleep 2; done"] }
  containers:
    - { name: app, image: myapp:1.4.2, ports: [{ containerPort: 8080 }] }
```

Pitfalls
- Putting unrelated apps in one pod prevents independent scaling.
- Relying on a pod IP or on local disk surviving.

Interview tip: define a pod as "the unit of scheduling and shared network", not just a container wrapper.

### ReplicaSets and Deployments
<!-- level: basic; ref: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ -->
A ReplicaSet keeps a specified number of identical pods running. A Deployment manages ReplicaSets for you and adds declarative updates, rollout history and rollback. Changing the pod template creates a new ReplicaSet, and the Deployment shifts replicas from the old to the new.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: api }
spec:
  replicas: 3
  selector: { matchLabels: { app: api } }
  template:
    metadata: { labels: { app: api } }
    spec:
      containers:
        - { name: api, image: myapp:1.4.2 }
```

Use Deployments for stateless services. The selector must match the template labels and is effectively immutable.

Pitfalls
- Editing pods directly; the controller reverts or replaces them.
- Mismatched selector and labels make the Deployment manage nothing.
- Using `latest` means pod restarts may silently pick up a different image.

Interview tip: say Deployment owns ReplicaSet owns Pods, and show it with `kubectl get rs`.

### Rolling updates and rollbacks
<!-- level: intermediate; ref: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-back-a-deployment -->
The default Deployment strategy is `RollingUpdate`: new pods start while old ones are terminated gradually, controlled by `maxSurge` (extra pods allowed) and `maxUnavailable`. Readiness probes gate the rollout: the Deployment only counts a new pod as available once it is ready, so a broken version stalls instead of taking down the service.

```bash
kubectl set image deploy/api api=myapp:1.5.0
kubectl rollout status deploy/api
kubectl rollout history deploy/api
kubectl rollout undo deploy/api --to-revision=2
```

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate: { maxSurge: 25%, maxUnavailable: 0 }
```

`Recreate` strategy stops all old pods first, accepting downtime, for apps that cannot run two versions together.

Pitfalls
- Without a readiness probe, traffic reaches pods that are not ready.
- Database schema changes need backward-compatible migrations, because two versions run side by side.
- `progressDeadlineSeconds` marks a stuck rollout as failed but does not roll back automatically.

Interview tip: explain how readiness probes and `maxUnavailable: 0` give zero-downtime updates.

### StatefulSets
<!-- level: intermediate; ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/ -->
A StatefulSet manages pods that need stable identity: ordinal names (`db-0`, `db-1`), stable network names through a headless Service, and persistent storage that follows each pod via `volumeClaimTemplates`. Pods are created and updated in order and deleted in reverse by default. This suits databases, queues and clustered systems that need peers to find each other.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: db }
spec:
  serviceName: db-headless
  replicas: 3
  selector: { matchLabels: { app: db } }
  template: { metadata: { labels: { app: db } }, spec: { containers: [{ name: db, image: postgres:16 }] } }
  volumeClaimTemplates:
    - metadata: { name: data }
      spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: 20Gi } } }
```

Pitfalls
- Deleting a StatefulSet does not delete its PVCs, which is safe but leaks storage.
- Running production databases on Kubernetes needs operators for backup, failover and upgrades.

Interview tip: contrast with a Deployment on identity, storage and ordering.

### DaemonSets
<!-- level: intermediate; ref: https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/ -->
A DaemonSet ensures one pod runs on every node (or on a selected subset), including nodes added later. Typical uses are log collectors, metrics agents, CNI network plugins, storage drivers and security agents, anything that must act per node.

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata: { name: log-agent }
spec:
  selector: { matchLabels: { app: log-agent } }
  template:
    metadata: { labels: { app: log-agent } }
    spec:
      tolerations: [{ operator: Exists }]
      containers:
        - { name: agent, image: fluent/fluent-bit:3.0,
            volumeMounts: [{ name: varlog, mountPath: /var/log }] }
      volumes: [{ name: varlog, hostPath: { path: /var/log } }]
```

Pitfalls
- Without matching tolerations, DaemonSet pods skip tainted nodes such as control-plane or GPU nodes.
- Agents with no resource limits can starve application pods on every node at once.
- `hostPath` mounts widen the blast radius if the agent is compromised.

Interview tip: give two real DaemonSet examples and explain how node selectors narrow them.

### Jobs and CronJobs
<!-- level: basic; ref: https://kubernetes.io/docs/concepts/workloads/controllers/job/ -->
A Job runs pods until a set number complete successfully, retrying failures up to `backoffLimit`. It models batch work such as migrations or report generation. A CronJob creates Jobs on a cron schedule. Set `restartPolicy` to `OnFailure` or `Never` since `Always` is invalid for Jobs.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata: { name: nightly-report }
spec:
  schedule: "0 2 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 1800
      template:
        spec:
          restartPolicy: OnFailure
          containers: [{ name: r, image: reports:2.1 }]
```

Pitfalls
- Jobs can run more than once (retries, overlapping schedules), so tasks must be idempotent.
- Schedules use the controller's time zone unless `timeZone` is set (stable since v1.27).
- Missed-run handling depends on `startingDeadlineSeconds`.

Interview tip: mention `concurrencyPolicy` and idempotency whenever CronJobs come up.

### Labels, selectors and annotations
<!-- level: basic; ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/ -->
Labels are key-value pairs attached to objects and are the glue of Kubernetes. Selectors query them: a Service finds its pods by label, a Deployment owns pods whose labels match, and you can filter with `kubectl get pods -l app=api,tier=web`. Annotations also store key-value data but are not used for selection; they carry metadata like build info, ingress options or tool configuration.

Adopt a consistent scheme such as the recommended `app.kubernetes.io/name`, `.../instance`, `.../version`.

```bash
kubectl get pods -l 'env in (prod,staging),app=api' --show-labels
kubectl label pod api-123 debug=true
kubectl annotate deploy api owner="payments-team"
```

Pitfalls
- A typo in a Service selector silently produces a Service with no endpoints.
- Changing labels on running pods can orphan them from their controller.

Interview tip: use "Service selector matches no pods" as your favourite label-related failure story.

### Namespaces
<!-- level: basic; ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/ -->
Namespaces partition a cluster into logical groups for teams, environments or applications. Names must be unique within a namespace, not across the cluster. They are the scope for RBAC roles, resource quotas, limit ranges and network policies, so they form the basic multi-tenancy boundary (soft isolation, not a security guarantee on its own).

Services are reachable across namespaces by DNS: `service.namespace.svc.cluster.local`.

```bash
kubectl create namespace payments
kubectl get pods -n payments
kubectl config set-context --current --namespace=payments
kubectl get all --all-namespaces
```

```yaml
apiVersion: v1
kind: ResourceQuota
metadata: { name: team-quota, namespace: payments }
spec: { hard: { requests.cpu: "10", requests.memory: 20Gi, pods: "50" } }
```

Pitfalls
- Forgetting `-n` and looking in `default`, then wrongly concluding resources are missing.
- Nodes, PersistentVolumes and StorageClasses are cluster-scoped, not namespaced.

Interview tip: say namespaces do not isolate network traffic unless NetworkPolicies enforce it.

### Declarative management with kubectl apply
<!-- level: intermediate; ref: https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/ -->
Imperative commands (`kubectl run`, `create`, `scale`) are quick for exploration, but production uses declarative manifests stored in Git: you edit YAML and `kubectl apply -f` reconciles the cluster toward it. Apply computes a three-way merge using the live object, your file, and the last-applied record (server-side apply tracks field ownership instead).

Practices that scale: keep manifests in version control, review via pull request, preview with `kubectl diff`, and let a GitOps tool (Argo CD, Flux) apply them continuously and revert manual drift.

```bash
kubectl diff -f k8s/
kubectl apply -f k8s/
kubectl apply --server-side -f k8s/
kubectl get deploy api -o yaml
```

Pitfalls
- Mixing `kubectl edit` hotfixes and apply creates drift that surprises the next deploy.
- Removing a field from YAML does not always remove it from the cluster with the old client-side apply.

Interview tip: define GitOps as "Git is the source of truth and an agent enforces it".
