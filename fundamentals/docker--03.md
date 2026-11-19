## 5. Kubernetes networking, configuration and storage

### Services and service types
<!-- level: basic; ref: https://kubernetes.io/docs/concepts/services-networking/service/ -->
Pods come and go with changing IPs, so a Service gives a stable virtual IP and DNS name in front of a set of pods chosen by label selector. kube-proxy (or the CNI's data plane) load-balances connections across ready pods, tracked in EndpointSlices.

Types: `ClusterIP` (default, internal only), `NodePort` (opens a port on every node), `LoadBalancer` (asks the cloud for an external load balancer), `ExternalName` (DNS alias) and headless (`clusterIP: None`, returns pod IPs directly, used with StatefulSets).

```yaml
apiVersion: v1
kind: Service
metadata: { name: api }
spec:
  selector: { app: api }
  ports: [{ port: 80, targetPort: 8080 }]
  type: ClusterIP
```

Pitfalls
- A selector that matches no ready pods yields empty endpoints and connection failures.
- `port` is the Service port while `targetPort` is the container's; mixing them up is common.
- One cloud `LoadBalancer` per service gets expensive, which is why Ingress exists.

Interview tip: troubleshoot with `kubectl get endpointslices` before blaming the network.

### Ingress and the Gateway API
<!-- level: intermediate; ref: https://kubernetes.io/docs/concepts/services-networking/ingress/ -->
An Ingress defines HTTP and HTTPS routing rules, by host and path, from outside the cluster to Services. It does nothing alone: an Ingress controller (NGINX, Traefik, HAProxy, a cloud load-balancer controller) watches Ingress objects and configures a proxy accordingly. One external load balancer can then serve many services, and TLS can be terminated there with certificates from Secrets, often automated by cert-manager.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: shop }
spec:
  ingressClassName: nginx
  tls: [{ hosts: [shop.example.com], secretName: shop-tls }]
  rules:
    - host: shop.example.com
      http:
        paths:
          - { path: /api, pathType: Prefix, backend: { service: { name: api, port: { number: 80 } } } }
```

The Gateway API (GA since v1.0 for core resources) is the more expressive successor, separating infrastructure (Gateway) from routes (HTTPRoute).

Pitfalls
- No controller installed, or the wrong `ingressClassName`, means rules are ignored.
- Controller-specific behaviour hides in annotations, harming portability.

Interview tip: distinguish Ingress resource from Ingress controller.

### ConfigMaps and Secrets
<!-- level: basic; ref: https://kubernetes.io/docs/concepts/configuration/configmap/ -->
A ConfigMap holds non-sensitive configuration; a Secret holds sensitive values like passwords and tokens. Either can be injected as environment variables or mounted as files. Mounted files update in running pods after a short delay (unless used via `subPath`), while environment variables are fixed at pod start, so a rollout is needed to change them.

```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: app-config }
data: { LOG_LEVEL: info }
---
# in the pod spec
envFrom: [{ configMapRef: { name: app-config } }]
volumeMounts: [{ name: certs, mountPath: /etc/tls, readOnly: true }]
```

Secret data is only base64-encoded, not encrypted, by default. Enable encryption at rest for etcd, restrict access with RBAC, and consider an external store (External Secrets Operator, Vault, cloud secret managers).

Pitfalls
- Committing Secret manifests to Git exposes them; use sealed or external secrets.
- ConfigMap changes do not restart pods; hash the content into a pod annotation to trigger rollouts.

Interview tip: say "base64 is encoding, not encryption".

### Persistent volumes, claims and storage classes
<!-- level: intermediate; ref: https://kubernetes.io/docs/concepts/storage/persistent-volumes/ -->
Pod storage is ephemeral by default. A PersistentVolume (PV) represents actual storage; a PersistentVolumeClaim (PVC) is a request for storage by a user. A StorageClass defines how to provision volumes dynamically (for example an EBS or Persistent Disk type), so creating a PVC creates the disk automatically.

Access modes matter: `ReadWriteOnce` allows one node, `ReadWriteMany` many nodes (needs a shared filesystem like NFS or EFS), and `ReadWriteOncePod` a single pod. Reclaim policy `Delete` or `Retain` decides what happens to data after the claim is removed.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: data }
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: fast-ssd
  resources: { requests: { storage: 10Gi } }
```

Pitfalls
- Zonal block disks cannot attach to nodes in another zone, so pods can get stuck Pending; use `WaitForFirstConsumer` binding.
- A PVC stuck in Pending usually means no matching StorageClass or provisioner.

Interview tip: describe the PV, PVC and StorageClass relationship in one sentence each.

### Liveness, readiness and startup probes
<!-- level: intermediate; ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/ -->
Probes tell the kubelet about container health. Liveness failing restarts the container; readiness failing removes the pod from Service endpoints without restarting it; startup disables the others until a slow-starting app is up. Each can use an HTTP GET, TCP check, command or gRPC.

```yaml
readinessProbe:
  httpGet: { path: /health/ready, port: 8080 }
  periodSeconds: 5
  failureThreshold: 3
livenessProbe:
  httpGet: { path: /health/live, port: 8080 }
  initialDelaySeconds: 20
startupProbe:
  httpGet: { path: /health/live, port: 8080 }
  failureThreshold: 30
  periodSeconds: 5
```

Pitfalls
- A liveness probe that checks the database restarts every pod during a database outage, which makes it worse.
- Aggressive liveness timing on a slow-starting app causes crash loops; add a startup probe.
- With no readiness probe, traffic arrives before the app can handle it.

Interview tip: summarise as "liveness restarts, readiness routes, startup protects slow boots".

### Resource requests, limits and QoS classes
<!-- level: intermediate; ref: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/ -->
A request is the amount the scheduler reserves for the container when picking a node; a limit is the ceiling enforced at runtime. Exceeding a CPU limit means throttling, and exceeding a memory limit means the container is OOM-killed.

Request and limit settings determine the pod's QoS class: Guaranteed (requests equal limits for all containers), Burstable (some requests set) and BestEffort (none). Under node memory pressure BestEffort pods are evicted first.

```yaml
resources:
  requests: { cpu: 250m, memory: 256Mi }
  limits:   { memory: 512Mi }
```

Many teams set memory limits but omit CPU limits to avoid throttling, relying on requests for fair sharing.

Pitfalls
- Requests far above real usage waste money; far below cause overcommitted nodes.
- No requests means the HPA percentage cannot be calculated.
- Memory units: `Mi` is mebibytes, `M` is megabytes.

Interview tip: say requests drive scheduling and HPA, limits drive throttling and OOM kills.

## 6. Scaling, scheduling and cluster security

### Horizontal Pod Autoscaler
<!-- level: intermediate; ref: https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/ -->
The HPA adjusts a workload's replica count based on metrics. Using the `autoscaling/v2` API it can target CPU or memory utilisation (relative to requests), custom metrics, or external metrics such as queue depth. The core calculation is `desired = ceil(current * currentMetric / targetMetric)`. It needs the Metrics Server for resource metrics.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: api }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: api }
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 65 } }
  behavior:
    scaleDown: { stabilizationWindowSeconds: 300 }
```

Pitfalls
- No CPU requests on pods means no utilisation to compute.
- Scaling pods is pointless if nodes are full; pair it with a node autoscaler.
- Do not set `replicas` in the Deployment manifest that Git re-applies, since it fights the HPA.

Interview tip: write the scaling formula and mention the stabilisation window against flapping.

### Cluster autoscaling and VPA
<!-- level: advanced; ref: https://kubernetes.io/docs/concepts/cluster-administration/node-autoscaling/ -->
Node autoscalers add nodes when pods are unschedulable and remove underused ones. The Cluster Autoscaler works with node groups defined by the cloud provider; Karpenter (popular on AWS) provisions right-sized instances directly from pending pod requirements. Scale-down respects PodDisruptionBudgets and skips pods with local storage or restrictive affinity unless annotated.

The Vertical Pod Autoscaler recommends or applies CPU and memory requests based on history. Applying changes usually restarts pods, and it should not drive the same metric as the HPA.

```bash
kubectl get pods --field-selector=status.phase=Pending
kubectl describe pod web-1 | grep -A3 Events
```

Pitfalls
- Pods without resource requests give the autoscaler nothing to size by.
- Scale-up takes minutes (node boot, image pull), so keep headroom for spikes.

Interview tip: describe the chain: load, HPA adds pods, pods Pending, node autoscaler adds nodes.

### Scheduling: affinity, taints and tolerations
<!-- level: advanced; ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/ -->
The scheduler filters nodes by requests and constraints and then scores them. `nodeSelector` and node affinity attract pods to nodes by label. Pod affinity and anti-affinity place pods near or away from other pods, for example spreading replicas across hosts. Taints on a node repel pods unless they carry a matching toleration, which dedicates nodes (GPU, spot) or isolates them. Topology spread constraints distribute pods evenly across zones.

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector: { matchLabels: { app: api } }
tolerations:
  - { key: dedicated, value: gpu, effect: NoSchedule }
```

Pitfalls
- A toleration permits a taint but does not attract the pod; add affinity too.
- Hard (`required`) anti-affinity with more replicas than nodes leaves pods Pending.

Interview tip: contrast taints (nodes repel) with affinity (pods attract).

### PodDisruptionBudgets
<!-- level: intermediate; ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/ -->
Voluntary disruptions such as node drains for upgrades, autoscaler scale-downs and evictions can take several replicas down simultaneously. A PodDisruptionBudget limits that by requiring either `minAvailable` or `maxUnavailable` pods for a selector. `kubectl drain` and the Eviction API respect it, delaying a drain until it is safe.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: api-pdb }
spec:
  minAvailable: 2
  selector: { matchLabels: { app: api } }
```

PDBs do not protect against involuntary failures such as node crashes.

Pitfalls
- `minAvailable` equal to the replica count blocks every drain and stalls cluster upgrades.
- A single-replica app with a PDB cannot be evicted at all.

Interview tip: say PDBs and readiness probes together make node maintenance safe.

### RBAC and service accounts
<!-- level: intermediate; ref: https://kubernetes.io/docs/reference/access-authn-authz/rbac/ -->
Role-based access control decides what authenticated identities can do. A Role (namespaced) or ClusterRole lists verbs on resources; a RoleBinding or ClusterRoleBinding grants it to users, groups or ServiceAccounts. Pods authenticate to the API with a ServiceAccount token, so least privilege per workload matters; disable token auto-mounting for pods that never call the API.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: pod-reader, namespace: dev }
rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get","list","watch"] }]
---
kind: RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
metadata: { name: read-pods, namespace: dev }
subjects: [{ kind: ServiceAccount, name: reporter, namespace: dev }]
roleRef: { kind: Role, name: pod-reader, apiGroup: rbac.authorization.k8s.io }
```

Check with `kubectl auth can-i list pods --as=system:serviceaccount:dev:reporter -n dev`.

Pitfalls
- Binding `cluster-admin` to a workload "to make it work" makes any pod compromise a cluster compromise.
- RBAC is additive; there are no deny rules.

Interview tip: demonstrate `kubectl auth can-i` when debugging "forbidden" errors.

### Network policies
<!-- level: intermediate; ref: https://kubernetes.io/docs/concepts/services-networking/network-policies/ -->
By default every pod can talk to every other pod. A NetworkPolicy restricts ingress and egress for selected pods using label selectors, namespaces and CIDR ranges. Policies are enforced by the CNI plugin (Calico, Cilium and others); on a CNI without support they are accepted but silently do nothing. Once any policy selects a pod for a direction, everything not allowed is denied for it.

A common baseline is default-deny, then explicit allows.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: db-from-api, namespace: shop }
spec:
  podSelector: { matchLabels: { app: db } }
  policyTypes: [Ingress]
  ingress:
    - from: [{ podSelector: { matchLabels: { app: api } } }]
      ports: [{ port: 5432 }]
```

Pitfalls
- Default-deny egress breaks DNS unless you allow port 53 to kube-dns.
- Assuming namespaces already isolate traffic.

Interview tip: mention that enforcement depends on the CNI.

## 7. Helm

### Helm charts and releases
<!-- level: basic; ref: https://helm.sh/docs/topics/charts/ -->
Helm is the package manager for Kubernetes. A chart is a directory of templated manifests plus metadata: `Chart.yaml`, default `values.yaml`, a `templates/` folder and optional dependencies. Installing a chart creates a release, a named, versioned instance in a namespace, whose history Helm stores (as Secrets) in the cluster.

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install cache bitnami/redis -n data --create-namespace
helm list -n data
helm create mychart      # scaffold your own chart
```

Charts let you install complex stacks (databases, ingress controllers, monitoring) in one command and share one definition across environments.

Pitfalls
- Third-party charts expose many defaults; read `helm show values` before installing.
- Charts and apps have separate versions (`version` versus `appVersion`).

Interview tip: define chart, release and repository precisely, since candidates often mix them up.

### Templating and values
<!-- level: intermediate; ref: https://helm.sh/docs/chart_template_guide/ -->
Templates use Go templating with sprig functions. Values come from `values.yaml`, overridden by `-f custom.yaml` files and `--set` flags, with later sources winning. Built-in objects include `.Values`, `.Release` and `.Chart`. Helper templates in `_helpers.tpl` keep names and labels consistent.

```yaml
# templates/deployment.yaml
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          {{- with .Values.resources }}
          resources: {{- toYaml . | nindent 12 }}
          {{- end }}
```

```bash
helm template mychart . -f prod.yaml     # render locally
helm lint mychart
```

Pitfalls
- Wrong `nindent` produces invalid YAML that only fails at install; render and lint in CI.
- Putting secrets in values files committed to Git.

Interview tip: explain value precedence and show `helm template` for debugging.

### Upgrades, rollbacks and hooks
<!-- level: intermediate; ref: https://helm.sh/docs/helm/helm_upgrade/ -->
`helm upgrade` renders the chart with new values, diffs it against the stored release and applies the changes, creating a new revision. `--install` makes it idempotent for CI, `--atomic` rolls back automatically if the upgrade fails or times out, and `--wait` blocks until resources are ready. `helm rollback` returns to an earlier revision.

```bash
helm upgrade --install api ./chart -n prod -f prod.yaml --atomic --timeout 5m
helm history api -n prod
helm rollback api 3 -n prod
```

Hooks (annotated resources such as `pre-upgrade` Jobs) run at lifecycle points, typically for database migrations.

Pitfalls
- Helm rollback does not revert database migrations or external state.
- CRDs in a chart's `crds/` folder are installed once and are not upgraded by Helm.
- `--reuse-values` can hide new chart defaults; prefer explicit value files.

Interview tip: pair `--atomic` with readiness probes for safe automated deploys.

## 8. Troubleshooting Kubernetes

### A systematic debugging workflow
<!-- level: intermediate; ref: https://kubernetes.io/docs/tasks/debug/debug-application/ -->
Work from the outside in and let the cluster tell you what is wrong. Start with the pod's status, then its events, then logs, and finally the network path.

```bash
kubectl get pods -o wide
kubectl describe pod <pod>            # events at the bottom
kubectl logs <pod> -c <container> --previous
kubectl get events --sort-by=.lastTimestamp
kubectl exec -it <pod> -- sh
kubectl debug -it <pod> --image=busybox --target=<container>
```

`kubectl debug` attaches an ephemeral container, useful when the image has no shell. Check the Deployment's rollout, then the Service's endpoints, then the Ingress.

Interpretation shortcuts: Pending means unscheduled, ContainerCreating points to image, volume or CNI, CrashLoopBackOff means the process keeps exiting, and Running but not Ready means a failing readiness probe.

Pitfalls
- `kubectl logs` without `--previous` shows the new, empty container instead of the crashed one.
- Jumping to YAML edits before reading events.

Interview tip: narrate status, events, logs, endpoints in that order.

### Pending pods and image pull errors
<!-- level: intermediate; ref: https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/ -->
A pod stuck `Pending` has not been scheduled. `kubectl describe pod` shows why: "Insufficient cpu/memory" (requests exceed any node), untolerated taints, unsatisfied node selector or affinity, or an unbound PVC. Fix by adjusting requests, adding nodes, correcting selectors or tolerations, or provisioning storage.

`ErrImagePull` and `ImagePullBackOff` mean the kubelet cannot fetch the image: a typo in the name or tag, a private registry without `imagePullSecrets`, expired registry credentials, or a rate limit on a public registry.

```bash
kubectl describe pod web | sed -n '/Events/,$p'
kubectl create secret docker-registry regcred \
  --docker-server=reg.example.com --docker-username=u --docker-password="$TOKEN"
# then in the pod spec: imagePullSecrets: [{ name: regcred }]
```

Pitfalls
- Secrets are namespaced; a pull secret in one namespace does not help another.
- Architecture mismatch (arm64 image on amd64 nodes) shows up as exec format errors, not pull errors.

Interview tip: read the Events section first; it nearly always names the cause.

### OOMKilled and CrashLoopBackOff
<!-- level: intermediate; ref: https://kubernetes.io/docs/tasks/debug/debug-application/determine-reason-pod-failure/ -->
CrashLoopBackOff means a container starts, exits and is restarted with exponentially growing delay (up to five minutes). The cause is in the last termination state: `kubectl describe pod` shows `Last State: Terminated`, the reason and exit code. `OOMKilled` with exit code 137 means it exceeded its memory limit.

```bash
kubectl get pod api-7d9 -o jsonpath='{.status.containerStatuses[0].lastState}'
kubectl logs api-7d9 --previous
kubectl top pod api-7d9 --containers
```

Typical causes: a missing environment variable or config, an unreachable dependency at startup, a bad command or entrypoint, a failing liveness probe, or a memory limit below real usage. Fix by correcting config, adding retries or startup probes, or raising limits after confirming it is not a leak.

Pitfalls
- Raising limits repeatedly hides a memory leak.
- Exit code 0 in a loop means the process finished; use a Job, not a Deployment.

Interview tip: exit code 137 = SIGKILL (often OOM), 143 = SIGTERM, 1 = application error.

### Service with no endpoints
<!-- level: intermediate; ref: https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/ -->
When a Service gives connection refused or timeouts while pods look healthy, check the chain. First that the Service has endpoints, then that the selector matches pod labels, that pods are Ready, and that `targetPort` matches the container's listening port. Then test DNS and connectivity from a temporary pod.

```bash
kubectl get svc api -o wide
kubectl get endpointslices -l kubernetes.io/service-name=api
kubectl get pods --show-labels
kubectl run tmp --rm -it --image=nicolaka/netshoot -- sh
#   nslookup api ; curl -v http://api:80/health
```

Empty endpoints usually mean a label mismatch or failing readiness probes. If endpoints exist but traffic fails, suspect a NetworkPolicy, the app binding to `127.0.0.1` instead of `0.0.0.0`, or a wrong port.

Pitfalls
- Testing with the pod IP bypasses the Service and hides selector problems.
- DNS failures (CoreDNS down, ndots delays) look like application errors.

Interview tip: show you can separate "no endpoints" (selector/readiness) from "endpoints but unreachable" (policy/port/binding).
