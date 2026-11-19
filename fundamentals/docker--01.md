## 1. Containers and images

### What a container is
<!-- level: basic; ref: https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/ -->
A container is an ordinary process (or group of processes) on the host that the kernel isolates and limits, so it sees its own filesystem, process tree and network. It is not a tiny machine: containers share the host kernel, which is why they start in milliseconds and use little memory. An image supplies the filesystem; the container adds a thin writable layer and a running process.

Why it matters: the same artifact runs identically on a laptop, in CI and in production, eliminating "works on my machine" drift in libraries and runtimes.

```bash
docker run --rm -it alpine:3.20 sh -c "ps; hostname"
```

Inside, `ps` shows the shell as PID 1 and the hostname is the container id, though on the host it is just another process.

Pitfalls
- Assuming containers give VM-grade isolation; a kernel exploit affects the host.
- Treating a container as a place to store state; its writable layer disappears with it.

Interview tip: define it as "isolated process using namespaces and cgroups" rather than "lightweight VM".

### Namespaces and cgroups
<!-- level: intermediate; ref: https://docs.docker.com/engine/security/ -->
Two Linux kernel features create containers. Namespaces limit what a process can see: PID (own process tree), NET (own interfaces and ports), MNT (own mounts), UTS (hostname), IPC and USER. Control groups (cgroups) limit what it can use: CPU shares and quotas, memory, I/O and process count.

Docker, containerd and runc simply configure these primitives. When memory exceeds the cgroup limit the kernel's OOM killer terminates the process, which is why a container can die with exit code 137 while the host looks healthy.

```bash
docker run -d --name web --memory 256m --cpus 0.5 nginx
docker inspect web --format '{{.HostConfig.Memory}}'
cat /sys/fs/cgroup/memory.max   # inside the container (cgroup v2)
```

Pitfalls
- Runtimes that ignore cgroup limits size heaps from host memory; use container-aware runtimes or set limits explicitly.
- Running with `--privileged` removes most of the isolation.

Interview tip: map each isolation feature to what it restricts, namespaces for visibility, cgroups for resources.

### Image layers and the union filesystem
<!-- level: basic; ref: https://docs.docker.com/get-started/docker-concepts/building-images/understanding-image-layers/ -->
An image is a stack of read-only layers, each produced by a Dockerfile instruction that changes the filesystem. Layers are content-addressed and shared: ten images built on the same base store that base once, and pulls download only layers you lack. A container adds a writable layer on top using copy-on-write, so modifying a file copies it up first.

Layers also drive build caching: Docker reuses a layer if the instruction and its inputs are unchanged, but once one layer changes every later layer is rebuilt.

```bash
docker history myapp:1.0
docker image inspect myapp:1.0 --format '{{json .RootFS.Layers}}'
```

Pitfalls
- Deleting a file in a later layer does not shrink the image; the data stays in the earlier layer. Remove files in the same `RUN` that created them.
- Putting frequently changing instructions early invalidates cache for everything below.

Interview tip: explain why `COPY package.json` then install then `COPY .` is faster.

### Dockerfile core instructions
<!-- level: basic; ref: https://docs.docker.com/reference/dockerfile/ -->
A Dockerfile is a recipe for building an image. `FROM` picks the base; `WORKDIR` sets the directory; `COPY` brings files in (prefer it to `ADD`, which also fetches URLs and unpacks archives); `RUN` executes commands at build time; `ENV` sets environment variables; `EXPOSE` documents a port (it does not publish it); `USER` drops privileges; `CMD`/`ENTRYPOINT` define what runs at start.

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
USER 1000
CMD ["python", "main.py"]
```

Pitfalls
- Chaining `apt-get update` and `install` in separate `RUN` lines caches a stale package index.
- `ARG` values and `ENV` secrets stay visible in image history.
- Shell-form commands run through `/bin/sh -c`, which swallows signals.

Interview tip: be able to say which instructions create layers and which only add metadata (`ENV`, `EXPOSE`, `CMD` are metadata-only).

### CMD versus ENTRYPOINT
<!-- level: intermediate; ref: https://docs.docker.com/reference/dockerfile/#understand-how-cmd-and-entrypoint-interact -->
`ENTRYPOINT` defines the executable that always runs; `CMD` supplies default arguments, or a default command if there is no entrypoint. Arguments given to `docker run image ...` replace `CMD` but are appended to `ENTRYPOINT`; replacing the entrypoint requires `--entrypoint`.

Use the exec form (JSON array) so the process becomes PID 1 and receives `SIGTERM` directly. The shell form wraps it in `sh -c`, so the app never sees the signal and Docker waits 10 seconds before killing it.

```dockerfile
ENTRYPOINT ["curl", "-s"]
CMD ["https://example.com"]
# docker run img            -> curl -s https://example.com
# docker run img https://x  -> curl -s https://x
```

Pitfalls
- Wrapper scripts that do not `exec "$@"` leave the app as a child that never receives signals.
- PID 1 does not reap zombie processes by default; use `--init` for process-spawning apps.

Interview tip: remember "ENTRYPOINT is the program, CMD is its default arguments".

### Multi-stage builds
<!-- level: intermediate; ref: https://docs.docker.com/build/building/multi-stage/ -->
A multi-stage Dockerfile uses several `FROM` statements. Early stages hold compilers, SDKs and test tooling; the final stage copies only the built artifacts. The result is a much smaller, safer image because build tools never ship to production.

```dockerfile
FROM golang:1.22 AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /out/app ./cmd/app

FROM gcr.io/distroless/static
COPY --from=build /out/app /app
ENTRYPOINT ["/app"]
```

You can target a stage (`docker build --target build .`) to run tests or debug, and stages can be built in parallel by BuildKit when independent.

Pitfalls
- A final stage based on a full OS image defeats most of the benefit.
- Missing runtime libraries (for example glibc on an Alpine/musl target) cause confusing "file not found" errors for a dynamically linked binary.

Interview tip: quote an actual size reduction you have seen, for example from a gigabyte-scale SDK image to under 100 MB.

### .dockerignore and build context
<!-- level: basic; ref: https://docs.docker.com/build/concepts/context/ -->
`docker build .` sends the directory (the build context) to the builder. Everything in it is available to `COPY`, and large contexts make builds slow. A `.dockerignore` file lists paths to exclude, using patterns like `.gitignore`.

Excluding `.git`, `node_modules`, build output, local env files and secrets speeds up builds, avoids cache invalidation caused by irrelevant changes, and keeps credentials out of the image.

```text
.git
node_modules
bin/
obj/
*.env
Dockerfile
```

Pitfalls
- `COPY . .` without an ignore file can copy `.env` or SSH keys into a layer, and they remain recoverable even if later deleted.
- Copying host `node_modules` over a Linux install breaks native modules.

Interview tip: link it to both security and build performance.

### Choosing base images and tags
<!-- level: intermediate; ref: https://docs.docker.com/build/building/best-practices/ -->
The base image determines size, attack surface and compatibility. Options run from full distributions (Debian, Ubuntu) through `-slim` variants and Alpine (small, musl libc) to distroless and `scratch` for static binaries. Smaller images have fewer packages to patch, but Alpine's musl can break some glibc-built software and distroless has no shell for debugging.

Tags are mutable: `node:20` today may differ tomorrow. Pin versions for reproducibility, or pin an immutable digest (`image@sha256:...`) when you need exact bits, and rebuild regularly to receive security patches.

```dockerfile
FROM node:20.17-alpine3.20
# or exact content:
FROM node@sha256:<digest>
```

Pitfalls
- `latest` gives unpredictable deploys and makes rollbacks ambiguous.
- Pinning without ever rebuilding freezes known vulnerabilities.

Interview tip: explain the pin-and-update-through-automation approach (Dependabot or Renovate).

### Tagging and pushing to a registry
<!-- level: basic; ref: https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-registry/ -->
A registry stores and distributes images (Docker Hub, GitHub Container Registry, Amazon ECR, Azure ACR, Harbor). An image name is `registry/namespace/repository:tag`; omitting the registry means Docker Hub. A tag is just a movable label pointing at a manifest digest.

A good scheme tags each build with an immutable identifier, such as the git commit SHA, plus a human-friendly moving tag like a semantic version.

```bash
docker build -t myapp:1.4.2 .
docker tag myapp:1.4.2 registry.example.com/team/myapp:1.4.2
docker tag myapp:1.4.2 registry.example.com/team/myapp:git-3f9c2a1
docker login registry.example.com
docker push registry.example.com/team/myapp:1.4.2
```

Pitfalls
- Overwriting a released tag makes deployments non-reproducible; enable tag immutability where the registry supports it.
- Multi-architecture builds (amd64 and arm64) need `docker buildx build --platform`, otherwise an Apple Silicon build fails on amd64 servers.

Interview tip: say that deployments should reference an immutable tag or digest.

## 2. Running and connecting containers

### The container lifecycle
<!-- level: basic; ref: https://docs.docker.com/engine/containers/run/ -->
A container moves through created, running, paused, stopped (exited) and removed. `docker run` combines create and start. `docker stop` sends `SIGTERM`, waits for a grace period (10 s default), then sends `SIGKILL`; `docker kill` is immediate. Stopped containers keep their writable layer and logs until `docker rm`.

```bash
docker run -d --name api --restart unless-stopped myapp:1.4.2
docker ps -a
docker stop api && docker start api
docker rm -f api
```

Restart policies (`no`, `on-failure`, `always`, `unless-stopped`) let the daemon revive containers after crashes or reboots, but they are not a substitute for an orchestrator's health management.

Pitfalls
- Exit code 137 means killed (often OOM or SIGKILL after timeout); 143 means SIGTERM; 1 usually means an application error.
- Forgotten stopped containers and dangling images fill the disk; use `docker system prune` carefully.

Interview tip: tie the exit code to a diagnosis.

### Volumes, bind mounts and tmpfs
<!-- level: intermediate; ref: https://docs.docker.com/engine/storage/volumes/ -->
Containers' writable layers are ephemeral and slower than native storage, so persistent or heavy-write data goes elsewhere. Named volumes are managed by Docker, survive container removal and are the best choice for databases. Bind mounts map a host path into the container, ideal for source code during development. `tmpfs` mounts keep data in RAM only, suited to secrets or scratch space.

```bash
docker volume create pgdata
docker run -d -v pgdata:/var/lib/postgresql/data postgres:16
docker run -v "$PWD":/app -w /app node:20 npm test      # bind mount
docker run --tmpfs /tmp:rw,size=64m myapp
```

Pitfalls
- A bind mount hides whatever the image had at that path.
- File ownership mismatches between host and container user cause permission errors.
- `docker compose down -v` deletes named volumes and the data in them.

Interview tip: state which data you would put in each kind of mount.

### Container networking
<!-- level: intermediate; ref: https://docs.docker.com/engine/network/ -->
By default containers join a bridge network and get a private IP. On user-defined bridge networks Docker provides DNS, so containers reach each other by name. The default bridge does not offer name resolution. Other drivers: `host` (shares the host network stack, no isolation), `none`, and `overlay` for multi-host swarm setups.

Publishing a port (`-p 8080:80`) maps a host port to a container port using NAT. Containers need no published port to talk to each other on the same network.

```bash
docker network create appnet
docker run -d --network appnet --name db postgres:16
docker run -d --network appnet -p 8080:8080 -e DB_HOST=db myapp
```

Pitfalls
- A server bound to `127.0.0.1` inside the container is unreachable through a published port; bind to `0.0.0.0`.
- Published ports bypass some host firewall rules, since Docker edits iptables directly.
- `localhost` in a container means the container itself, not the host.

Interview tip: contrast `EXPOSE` (documentation) with `-p` (actual publishing).

### Environment variables and configuration
<!-- level: basic; ref: https://docs.docker.com/compose/how-tos/environment-variables/ -->
The twelve-factor approach keeps configuration out of the image so one build serves every environment. Pass values with `-e`, `--env-file`, or the orchestrator's equivalent. Application config like connection strings, feature flags and URLs belongs in environment variables; secrets deserve better handling.

```bash
docker run -d --env-file prod.env -e LOG_LEVEL=info myapp:1.4.2
docker exec api printenv | grep LOG
```

Environment variables are visible through `docker inspect`, to every process in the container, and often in crash dumps, so they are a weak home for long-lived secrets. Prefer mounted secret files, Docker/Compose secrets, or a secrets manager that injects values at runtime.

Pitfalls
- `ENV` or `ARG` in the Dockerfile writes values into the image history.
- Changing an env var requires recreating the container, not just restarting it.

Interview tip: separate configuration from secrets in your answer.

### Resource limits
<!-- level: intermediate; ref: https://docs.docker.com/engine/containers/resource_constraints/ -->
Without limits a container may consume all host memory or CPU and starve neighbours. `--memory` sets a hard cap enforced by the kernel; exceeding it triggers an OOM kill. `--cpus` limits CPU time through CFS quotas, and `--cpu-shares` sets relative weight under contention. `--pids-limit` guards against fork bombs.

```bash
docker run -d --memory 512m --memory-swap 512m --cpus 1.5 --pids-limit 200 myapp
docker stats --no-stream
docker inspect myapp --format '{{.State.OOMKilled}}'
```

Pitfalls
- A memory limit lower than the app's peak working set gives sporadic exit 137 restarts.
- CPU limits cause throttling that looks like latency spikes even when average CPU is low.
- Runtime heaps that do not read cgroup limits will over-allocate.

Interview tip: distinguish a CPU limit (throttling) from a memory limit (kill).

### Logs and debugging a running container
<!-- level: basic; ref: https://docs.docker.com/engine/logging/ -->
Containers should write logs to stdout and stderr; the logging driver captures them. The default `json-file` driver stores them on the host, and `docker logs` reads them. Other drivers forward to syslog, journald, Fluentd or cloud services.

`docker exec` starts an additional process inside a running container, ideal for inspection; `docker inspect` returns full configuration and state; `docker cp` moves files.

```bash
docker logs -f --tail 100 --since 10m api
docker exec -it api sh
docker inspect api --format '{{.State.ExitCode}} {{.State.Error}}'
docker run --rm -it --entrypoint sh myapp:1.4.2   # debug a crashing image
```

Pitfalls
- The default json-file driver has no rotation unless you set `max-size` and `max-file`; logs can fill the disk.
- Minimal and distroless images have no shell, so `exec` fails; use a debug sidecar or `docker debug` where available.
- Writing logs to files inside the container hides them from `docker logs`.

Interview tip: say "log to stdout, rotate at the driver" and mention structured JSON logs.
