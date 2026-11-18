# Docker & Kubernetes interview questions

### What is the difference between an image and a container?
<!-- level: basic; kind: concept; ref: https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-an-image/ -->
An **image** is a read-only template made of layers (base OS files, runtime, your app). A **container** is a running instance of an image with its own writable layer, process space and network.

You can run many containers from one image. Data written inside a container is lost when it's removed unless you use **volumes**.

### How does Docker differ from a virtual machine?
<!-- level: basic; kind: concept; ref: https://docs.docker.com/get-started/docker-overview/ -->
- A **VM** virtualises hardware and runs a full guest operating system — strong isolation, but heavier and slower to start.
- A **container** shares the host's kernel and isolates processes with namespaces and cgroups — lightweight, starts in seconds or less, and packs densely.

Containers are ideal for packaging apps consistently; VMs remain useful for stronger isolation or different operating systems.

### What is a multi-stage build, and why use it?
<!-- level: intermediate; kind: concept; ref: https://docs.docker.com/build/building/multi-stage/ -->
A Dockerfile with several `FROM` stages: build in a stage that has the SDK and tools, then copy only the output into a small runtime image. The final image is smaller and has a smaller attack surface.

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "MyApi.dll"]
```

Order instructions so rarely-changing steps (restoring packages) come before frequently-changing ones (copying source) to benefit from layer caching.

### Explain Pod, Deployment, Service and Ingress in Kubernetes.
<!-- level: intermediate; kind: concept; ref: https://kubernetes.io/docs/concepts/ -->
- **Pod**: the smallest unit — one or more containers sharing network and storage.
- **Deployment**: declares how many replicas of a Pod to run and handles rolling updates and rollbacks.
- **Service**: a stable virtual IP/DNS name that load-balances to matching Pods (whose IPs change).
- **Ingress** (or the newer Gateway API): routes external HTTP(S) traffic to Services by host/path, often with TLS.
- Also: **ConfigMap/Secret** for configuration, and liveness/readiness **probes** for health.

### A pod is in `CrashLoopBackOff`. How do you troubleshoot?
<!-- level: intermediate; kind: scenario; ref: https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/ -->
1. `kubectl describe pod <name>` — check events, exit code, and the reason (e.g. `OOMKilled`, failing probes, image pull errors).
2. `kubectl logs <pod> --previous` — logs from the crashed container.
3. Common causes:
   - App error at startup: missing config/secret/env var, can't reach the database.
   - **OOMKilled**: memory limit too low or a leak → raise limits or fix the leak.
   - Liveness probe too aggressive → the app is killed before it finishes starting; add a startup probe or longer delays.
   - Wrong command/entrypoint or file permissions.
4. Reproduce locally with the same image and environment variables.
