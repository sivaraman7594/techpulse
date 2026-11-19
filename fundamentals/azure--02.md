## 4. Compute

### Choosing an Azure compute service
<!-- level: basic; ref: https://learn.microsoft.com/azure/architecture/guide/technology-choices/compute-decision-tree -->
Azure offers a spectrum of compute, from full control to fully managed. Choosing well is one of the most common design questions.

- Virtual Machines: full OS control. Use for lift-and-shift, special software, custom agents or licensing constraints.
- Virtual Machine Scale Sets: many identical VMs with autoscale.
- App Service: managed hosting for web apps and APIs (.NET, Java, Node, Python, containers). Deployment slots, autoscale, built-in auth.
- Azure Functions: event-driven code that runs per trigger; pay per execution on consumption-style plans.
- Azure Container Apps: serverless containers with scale-to-zero, KEDA event scaling and Dapr; no Kubernetes to operate.
- Azure Kubernetes Service (AKS): managed Kubernetes for teams that need the full Kubernetes API and ecosystem.
- Azure Batch and HPC options: large parallel compute jobs.

A useful decision flow: Do you need full OS control? VM. Is it an HTTP app with no container requirement? App Service. Is it event-driven and short-lived? Functions. Is it a set of containerised microservices? Container Apps, and graduate to AKS only if you need Kubernetes-specific features (custom operators, service mesh control, node-level tuning).

```text
ASP.NET Core web API, small team           -> App Service or Container Apps
Nightly CSV import triggered by blob upload -> Functions (Blob/Event Grid trigger)
20 microservices, platform team, Helm      -> AKS
Legacy app needing a Windows COM component -> VM
```

- Interview tip: operational burden is a cost; justify any step toward more control.

### Azure Virtual Machines
<!-- level: basic; ref: https://learn.microsoft.com/azure/virtual-machines/overview -->
An Azure VM is IaaS: you pick an image (Windows Server, Ubuntu, or a custom image from an Azure Compute Gallery), a size, disks and a network interface, and you manage everything from the OS up.

Sizes are grouped into families: B (burstable, cheap for spiky low load), D (general purpose), E (memory optimised), F (compute optimised), L (storage optimised), N (GPU). The suffix letters encode features, for example "s" supports premium SSD and "a" means AMD processors.

Availability options:

- Availability zones: spread VMs across zones for the highest VM SLA.
- Availability sets: spread VMs across fault and update domains within one datacenter (older approach).
- Single VM with premium SSD: has its own lower SLA.

```bash
az vm create -g rg-legacy -n vm-report-01 \
  --image Ubuntu2204 --size Standard_D2s_v5 --zone 1 \
  --admin-username azureuser --generate-ssh-keys \
  --public-ip-address ""   # no public IP; reach it via Bastion
az vm auto-shutdown -g rg-legacy -n vm-report-01 --time 1900
```

- Operations you own: patching (Azure Update Manager helps), backups (Azure Backup), monitoring agents (Azure Monitor Agent), hardening and antivirus.
- Pitfall: stopping a VM from inside the OS keeps it allocated and billed for compute; deallocate it from Azure.
- Pitfall: exposing RDP/SSH to the internet; use Azure Bastion or just-in-time access.

### Virtual Machine Scale Sets
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/virtual-machine-scale-sets/overview -->
A Virtual Machine Scale Set (VMSS) manages a group of VMs as one resource, adding and removing instances automatically and spreading them across availability zones and fault domains.

Two orchestration modes exist. Flexible orchestration is the recommended default: instances are regular VMs you can manage individually, you can mix sizes (including Spot and regular VMs) and it gives high availability at scale. Uniform orchestration uses identical instances defined by one model and is the older approach (still used under some services).

Why use it: stateless tiers that need to scale horizontally on VMs, such as legacy web farms, game servers, or build agents. Autoscale rules react to metrics (CPU, queue length) or schedules, and the scale set integrates with Azure Load Balancer or Application Gateway.

```bash
az vmss create -g rg-web -n vmss-web \
  --image Ubuntu2204 --vm-sku Standard_D2s_v5 \
  --orchestration-mode Flexible --zones 1 2 3 \
  --instance-count 2 --admin-username azureuser --generate-ssh-keys

az monitor autoscale create -g rg-web --resource vmss-web \
  --resource-type Microsoft.Compute/virtualMachineScaleSets \
  --name web-autoscale --min-count 2 --max-count 10 --count 2
az monitor autoscale rule create -g rg-web --autoscale-name web-autoscale \
  --condition "Percentage CPU > 70 avg 5m" --scale out 2
```

- Pitfall: instances must be stateless; anything written to local disk disappears on scale-in.
- Tip: use application health monitoring and automatic instance repairs to replace unhealthy VMs.

### App Service and App Service plans
<!-- level: basic; ref: https://learn.microsoft.com/azure/app-service/overview -->
App Service is Azure's managed platform for web apps and APIs. You deploy code (or a container) and the platform handles OS and runtime patching, load balancing, TLS, scaling and health checks.

The App Service plan is the compute you pay for: a set of VM instances of a given tier (Free, Basic, Standard, Premium v3/v4, Isolated v2). All apps in a plan share those instances, so packing several small apps into one plan saves money, but a noisy app affects its neighbours.

Key features:

- Scale up (bigger tier) or out (more instances), manually or with autoscale rules.
- Deployment slots (Standard and above) for zero-downtime swaps.
- Built-in authentication ("Easy Auth") with Entra ID and other providers.
- VNet integration for outbound traffic into private networks; private endpoints for private inbound.
- Health check path that removes unhealthy instances from rotation.

```bash
az appservice plan create -g rg-orders -n plan-orders --sku P1v3 --is-linux --zone-redundant
az webapp create -g rg-orders -p plan-orders -n app-orders-api --runtime "DOTNETCORE:9.0"
az webapp deploy -g rg-orders -n app-orders-api --src-path ./publish.zip --type zip
```

- Pitfall: the Free and Shared tiers have no SLA and sleep; never use them for production.
- Pitfall: in-memory session state breaks when you scale out; use Redis or stateless tokens.

### Deployment slots and zero-downtime releases
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/app-service/deploy-staging-slots -->
A deployment slot is a separate live app (with its own hostname, such as app-orders-api-staging.azurewebsites.net) running on the same App Service plan. The standard release flow is: deploy to staging, let it warm up, run smoke tests, then swap staging with production.

During a swap, App Service applies production settings to the staging instances, warms them up by hitting the site (and your custom warm-up path if configured), and only then switches routing. Users see no cold start. If the release is bad, swap back; the previous version is still running in the staging slot.

Settings and connection strings can be marked as slot settings ("sticky"), so they stay with the slot rather than moving during the swap. Typical sticky settings: environment name, feature flags for testing, and diagnostics settings.

```bash
az webapp deployment slot create -g rg-orders -n app-orders-api --slot staging
az webapp deploy -g rg-orders -n app-orders-api --slot staging --src-path ./publish.zip --type zip
az webapp deployment slot swap -g rg-orders -n app-orders-api --slot staging --target-slot production
```

- Swap with preview lets you validate staging with production settings before completing.
- Pitfall: slots share the plan's CPU and memory; a heavy staging load test slows production.
- Pitfall: database schema changes are not rolled back by a swap; make migrations backward compatible.

### Hosting ASP.NET Core on App Service
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/app-service/configure-common -->
Running a .NET app on App Service mostly works out of the box, but a few platform behaviours matter.

Configuration: app settings in App Service appear to your app as environment variables, so they override appsettings.json through the normal ASP.NET Core configuration chain. Use a double underscore for hierarchy (ConnectionStrings__Orders or Storage__Uri). Prefer Key Vault references for secrets, written as @Microsoft.KeyVault(SecretUri=...), which App Service resolves with the app's managed identity.

Health and lifecycle: set a health check path (for example /healthz mapped with MapHealthChecks) so the platform replaces unhealthy instances. Enable Always On for apps with background work or to avoid idle unload on dedicated tiers.

Logging: use ILogger with the OpenTelemetry/Azure Monitor exporter for Application Insights. Linux containers' stdout is captured in log stream.

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks().AddCheck("self", () => HealthCheckResult.Healthy());
builder.Services.AddOpenTelemetry().UseAzureMonitor();   // Azure.Monitor.OpenTelemetry.AspNetCore
var app = builder.Build();
app.MapHealthChecks("/healthz");
app.Run();
```

```bash
az webapp config appsettings set -g rg-orders -n app-orders-api --settings \
  "Storage__Uri=https://stordersprod.blob.core.windows.net" \
  "Db__Password=@Microsoft.KeyVault(SecretUri=https://kv-orders.vault.azure.net/secrets/DbPassword)"
```

- Pitfall: ARR affinity (sticky sessions) is on by default; turn it off for stateless APIs to spread load evenly.

### Azure Functions
<!-- level: basic; ref: https://learn.microsoft.com/azure/azure-functions/functions-overview -->
Azure Functions runs small pieces of code in response to events: HTTP requests, timers, queue or Service Bus messages, Event Grid events, Event Hubs streams, blob changes and Cosmos DB change feed. Each function has exactly one trigger and can use input and output bindings to read and write other services declaratively.

Hosting plans determine scaling and cost:

- Flex Consumption: the recommended serverless plan for new apps; scales to zero, fast per-function scaling, VNet integration, and optional always-ready instances to cut cold starts.
- Consumption (legacy serverless plan): scale to zero and pay per execution; being superseded by Flex Consumption, especially on Linux.
- Premium (Elastic Premium): pre-warmed instances, no cold start, VNet, longer runs.
- Dedicated: run on an App Service plan you already pay for.
- Container Apps hosting: run Functions as containers in a Container Apps environment.

```csharp
public class ResizeImage(ILogger<ResizeImage> log)
{
    [Function(nameof(ResizeImage))]
    [BlobOutput("thumbnails/{name}")]
    public byte[] Run([BlobTrigger("uploads/{name}")] byte[] input, string name)
    {
        log.LogInformation("Resizing {Name}", name);
        return ImageHelper.Resize(input, 200);
    }
}
```

- Pitfall: functions should be idempotent; triggers can deliver the same event more than once.
- Pitfall: long-running work in an HTTP function hits timeouts; hand off to a queue or Durable Functions.

### Functions in .NET: the isolated worker model
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide -->
.NET functions now run in the isolated worker model: your code runs in its own process, separate from the Functions host, and talks to it over gRPC. The older in-process model (code loaded into the host) reaches end of support in November 2026, so new and migrated apps should use isolated.

Benefits of isolated: you choose the .NET version independently of the host, you get a normal Program.cs with dependency injection, middleware and configuration, and there are no assembly version conflicts with the host. With ASP.NET Core integration, HTTP triggers can use HttpRequest and IActionResult types.

```csharp
// Program.cs
var builder = FunctionsApplication.CreateBuilder(args);
builder.ConfigureFunctionsWebApplication();
builder.Services.AddApplicationInsightsTelemetryWorkerService()
                .ConfigureFunctionsApplicationInsights();
builder.Services.AddSingleton<IOrderService, OrderService>();
builder.Build().Run();

// OrdersFunction.cs
public class OrdersFunction(IOrderService orders)
{
    [Function("GetOrder")]
    public async Task<IActionResult> Get(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "orders/{id}")] HttpRequest req, string id)
        => await orders.FindAsync(id) is { } o ? new OkObjectResult(o) : new NotFoundResult();
}
```

- Pitfall: in-process attributes (Microsoft.Azure.WebJobs) differ from isolated ones (Microsoft.Azure.Functions.Worker); migrating means changing packages and attribute namespaces.
- Interview tip: mention the FUNCTIONS_WORKER_RUNTIME setting of dotnet-isolated.

### Durable Functions
<!-- level: advanced; ref: https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-overview -->
Durable Functions adds stateful workflows to Azure Functions. You write orchestrations as ordinary code; the framework checkpoints progress to storage (Azure Storage, or the newer Durable Task Scheduler backend) and replays the orchestrator to rebuild state after each await. That lets workflows run for minutes or months, survive restarts and scale out.

Building blocks:

- Orchestrator functions: coordinate the workflow. Must be deterministic (no DateTime.Now, random numbers or direct I/O; use context APIs).
- Activity functions: do the real work (call APIs, write data).
- Entity functions: small stateful objects addressed by key.
- Client functions: start, query and signal orchestrations.

Common patterns: function chaining, fan-out/fan-in, async HTTP APIs (start returns 202 and a status URL), monitors, and human interaction with timeouts.

```csharp
[Function(nameof(ProcessOrder))]
public static async Task<string> ProcessOrder([OrchestrationTrigger] TaskOrchestrationContext ctx)
{
    var order = ctx.GetInput<Order>()!;
    await ctx.CallActivityAsync("ReserveStock", order);
    var tasks = order.Lines.Select(l => ctx.CallActivityAsync<decimal>("PriceLine", l));
    decimal[] prices = await Task.WhenAll(tasks);           // fan-out / fan-in
    using var cts = new CancellationTokenSource();
    var approval = ctx.WaitForExternalEvent<bool>("Approved");
    var timeout = ctx.CreateTimer(ctx.CurrentUtcDateTime.AddHours(24), cts.Token);
    if (await Task.WhenAny(approval, timeout) == approval) { cts.Cancel(); return "approved"; }
    return "expired";
}
```

- Pitfall: non-deterministic orchestrator code causes replay errors that are hard to debug.

### Azure Container Apps
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/container-apps/overview -->
Azure Container Apps runs containers on a managed, Kubernetes-based platform without exposing Kubernetes. You deploy a container image, and the platform provides HTTPS ingress, revisions, autoscaling (including scale to zero) and service discovery.

Concepts:

- Environment: a secure boundary (and optional VNet) shared by a group of apps, with a common Log Analytics workspace.
- Container app: one service, with one or more containers (plus sidecars and init containers).
- Revisions: immutable snapshots of an app version. In multiple-revision mode you can split traffic, for example 90/10 for a canary.
- Scaling: HTTP concurrency rules or KEDA scalers (Service Bus queue length, Kafka lag, cron, CPU).
- Jobs: run-to-completion containers triggered manually, on a schedule or by events.
- Dapr integration for service invocation, pub/sub and state.
- Workload profiles: consumption (serverless) or dedicated (reserved hardware, including GPU).

```bash
az containerapp up -n orders-api -g rg-orders \
  --environment cae-orders --image crorders.azurecr.io/orders-api:1.4.2 \
  --ingress external --target-port 8080

az containerapp update -n orders-worker -g rg-orders \
  --min-replicas 0 --max-replicas 20 \
  --scale-rule-name sb-queue --scale-rule-type azure-servicebus \
  --scale-rule-metadata queueName=orders messageCount=50 namespace=sb-orders \
  --scale-rule-identity system
```

- Pitfall: scale to zero means a cold start on the first request; set min replicas to 1 for latency-sensitive APIs.

### Azure Kubernetes Service (AKS)
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/aks/what-is-aks -->
AKS is managed Kubernetes. Azure runs the control plane (API server, etcd, scheduler); you run node pools of VMs (or use AKS Automatic, which also manages nodes, scaling and many best-practice defaults).

What you get on top of upstream Kubernetes:

- Entra ID integration for kubectl authentication and Kubernetes RBAC, or Azure RBAC for Kubernetes authorization.
- Workload identity: pods federate a Kubernetes service account to an Entra managed identity, so they call Azure services without secrets.
- Networking options: Azure CNI Overlay (the common default) or Azure CNI with pod IPs from the VNet, plus Cilium-based dataplane options.
- Cluster autoscaler and node auto-provisioning (Karpenter-based) for nodes; HPA and KEDA add-on for pods.
- Integrations: Azure Container Registry, Azure Monitor managed Prometheus and Container Insights, Key Vault CSI driver, application routing add-on, Azure Policy for Kubernetes.

```bash
az aks create -g rg-platform -n aks-prod --tier standard \
  --node-count 3 --zones 1 2 3 --network-plugin azure --network-plugin-mode overlay \
  --enable-oidc-issuer --enable-workload-identity \
  --attach-acr crplatform --generate-ssh-keys
az aks get-credentials -g rg-platform -n aks-prod
```

- Pitfall: the Free tier has no uptime SLA for the API server; use Standard for production.
- Pitfall: AKS versions go out of support roughly a year after release; plan regular upgrades (or use auto-upgrade channels and planned maintenance windows).

### Azure Container Registry (ACR)
<!-- level: basic; ref: https://learn.microsoft.com/azure/container-registry/container-registry-intro -->
ACR is a private registry for container images, Helm charts and other OCI artifacts. It sits next to your compute in Azure so pulls are fast and stay on the Microsoft network.

Tiers: Basic, Standard and Premium. Premium adds geo-replication (one registry name, replicas in several regions), private endpoints, and higher throughput, which production platforms usually need.

Features:

- Entra authentication: AKS, Container Apps and App Service pull with a managed identity using the AcrPull role. Disable the admin user.
- ACR Tasks: build images in the cloud (az acr build) without a local Docker daemon, and rebuild automatically when a base image updates.
- Retention and purge policies to delete old untagged manifests.
- Integration with Defender for Containers for vulnerability scanning.

```bash
az acr create -g rg-platform -n crplatform --sku Premium
az acr build -r crplatform -t orders-api:{{.Run.ID}} -f src/Orders.Api/Dockerfile .
az role assignment create --assignee <aks-kubelet-identity> --role AcrPull \
  --scope $(az acr show -n crplatform --query id -o tsv)
```

- Pitfall: deploying with the mutable latest tag makes rollbacks and audits impossible; use immutable version tags or digests.
- Pitfall: registry names are global and form DNS names (crplatform.azurecr.io).

## 5. Storage

### Storage accounts and redundancy options
<!-- level: basic; ref: https://learn.microsoft.com/azure/storage/common/storage-redundancy -->
A storage account is a namespace that hosts Blob, File, Queue and Table services. Most new workloads use the StorageV2 (general-purpose v2) kind; premium kinds exist for low-latency block blobs and file shares.

Redundancy controls how many copies exist and where:

- LRS: three copies in one datacenter. Cheapest; lost if that datacenter fails.
- ZRS: three copies across availability zones in the region. Survives a zone outage.
- GRS: LRS in the primary plus asynchronous copy (LRS) to the paired secondary region.
- GZRS: ZRS in the primary plus asynchronous copy to the secondary.
- RA-GRS / RA-GZRS: as above, plus read access to the secondary endpoint at any time.

Geo replication is asynchronous, so a failover can lose the most recent writes (check the Last Sync Time). Customer-managed failover promotes the secondary when needed.

```bash
az storage account create -g rg-orders -n stordersprodcin01 \
  --location centralindia --sku Standard_GZRS --kind StorageV2 \
  --min-tls-version TLS1_2 --allow-blob-public-access false \
  --allow-shared-key-access false
```

- Security defaults worth setting: disallow public blob access, disable shared key (force Entra auth), require TLS 1.2 or later, and use private endpoints for internal data.
- Interview tip: ZRS is usually the sensible production minimum; add geo redundancy when the RPO/RTO needs regional DR.

### Blob storage and access tiers
<!-- level: basic; ref: https://learn.microsoft.com/azure/storage/blobs/access-tiers-overview -->
Blob storage holds unstructured objects in containers. There are three blob types: block blobs (files, images, backups; most common), append blobs (logs that only grow) and page blobs (random-access, used for VM disks).

Access tiers trade storage price against access price:

- Hot: frequently read; highest storage cost, cheapest reads.
- Cool: infrequent access, minimum 30 days.
- Cold: rarer access, minimum 90 days.
- Archive: offline, minimum 180 days; cheapest storage, but must be rehydrated (hours) before reading.

Early deletion fees apply if you delete or move a blob before the minimum period. Lifecycle management policies move or delete blobs automatically based on age or last access time.

```json
{
  "rules": [{
    "name": "age-out-invoices",
    "enabled": true,
    "type": "Lifecycle",
    "definition": {
      "filters": { "blobTypes": ["blockBlob"], "prefixMatch": ["invoices/"] },
      "actions": { "baseBlob": {
        "tierToCool":    { "daysAfterModificationGreaterThan": 30 },
        "tierToArchive": { "daysAfterModificationGreaterThan": 180 },
        "delete":        { "daysAfterModificationGreaterThan": 2555 } } }
    }
  }]
}
```

- Data protection: enable soft delete, versioning and, for compliance, immutability (WORM) policies.
- Pitfall: millions of tiny blobs in Archive can cost more in per-operation fees than they save.

### Using Blob storage from .NET
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/storage/blobs/storage-quickstart-blobs-dotnet -->
The Azure.Storage.Blobs package exposes three client levels: BlobServiceClient (account), BlobContainerClient (container) and BlobClient (one blob). Clients are thread-safe and should be created once and reused, typically through dependency injection.

Good practices:

- Authenticate with DefaultAzureCredential or a managed identity and the Storage Blob Data Contributor role, instead of account keys.
- Stream large files rather than loading them into memory; the SDK parallelises large uploads automatically, and you can tune TransferOptions.
- Set content type and metadata on upload so browsers and CDNs behave correctly.
- Use conditions (ETags) for optimistic concurrency when several writers update the same blob.

```csharp
public class InvoiceStore(BlobServiceClient service)
{
    private readonly BlobContainerClient _container = service.GetBlobContainerClient("invoices");

    public async Task<Uri> SaveAsync(string id, Stream pdf, CancellationToken ct)
    {
        var blob = _container.GetBlobClient($"{DateTime.UtcNow:yyyy/MM}/{id}.pdf");
        await blob.UploadAsync(pdf, new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = "application/pdf" },
            Metadata = new Dictionary<string, string> { ["invoiceId"] = id },
            Conditions = new BlobRequestConditions { IfNoneMatch = ETag.All } // do not overwrite
        }, ct);
        return blob.Uri;
    }
}
```

- Pitfall: listing a huge container to find one blob is slow; design names (prefixes) for your lookups, or use blob index tags.
- Pitfall: a 403 AuthorizationPermissionMismatch means the identity lacks a data role, not that the key is wrong.

### Shared access signatures (SAS)
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/storage/common/storage-sas-overview -->
A shared access signature is a signed URL token that grants limited, time-bound access to storage resources without sharing credentials. A typical use: your API returns a short-lived URL so a browser uploads a file directly to Blob storage, bypassing your servers.

Types of SAS:

- User delegation SAS: signed with a key obtained via Entra ID. Recommended, because it is tied to an identity, can be audited and can be revoked by revoking the delegation key.
- Service SAS and account SAS: signed with the storage account key. Revoking them means rotating the key, which breaks everything using it.

A SAS specifies permissions (read, write, create, list, delete), start and expiry times, optionally allowed IP ranges and HTTPS only.

```csharp
var service = new BlobServiceClient(new Uri(accountUrl), new DefaultAzureCredential());
UserDelegationKey key = await service.GetUserDelegationKeyAsync(
    DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(15));

var sas = new BlobSasBuilder
{
    BlobContainerName = "uploads",
    BlobName = $"{userId}/{Guid.NewGuid()}.jpg",
    Resource = "b",
    ExpiresOn = DateTimeOffset.UtcNow.AddMinutes(10)
};
sas.SetPermissions(BlobSasPermissions.Create | BlobSasPermissions.Write);
var uploadUri = new BlobUriBuilder(new Uri($"{accountUrl}/uploads/{sas.BlobName}"))
{ Sas = sas.ToSasQueryParameters(key, service.AccountName) }.ToUri();
```

- Pitfall: long-lived account SAS tokens embedded in mobile apps are effectively passwords that never expire.
- Tip: stored access policies let you revoke service SAS tokens without rotating keys.

### Azure Files and managed disks
<!-- level: basic; ref: https://learn.microsoft.com/azure/storage/files/storage-files-introduction -->
Two storage services cover file shares and block devices.

Azure Files provides fully managed file shares over SMB and NFS. Use it for lift-and-shift apps that expect a shared drive, shared configuration or content for several VMs, and persistent volumes for containers (AKS, Container Apps). Azure File Sync can cache shares on Windows servers on-premises. Identity-based SMB access works with Entra ID or AD DS.

Managed disks are block storage attached to VMs. Types, roughly from cheapest to fastest:

- Standard HDD: backups and rarely accessed data.
- Standard SSD: light web servers and dev/test.
- Premium SSD: production workloads; performance tied to disk size.
- Premium SSD v2: performance (IOPS, throughput) set independently of size.
- Ultra Disk: the lowest latency and highest IOPS for demanding databases.

```bash
az storage share-rm create -g rg-app --storage-account stappfiles01 \
  --name content --quota 100 --enabled-protocols SMB
az disk create -g rg-db -n disk-sql-data --size-gb 512 \
  --sku PremiumV2_LRS --disk-iops-read-write 8000 --disk-mbps-read-write 300 --zone 1
```

- Pitfall: VM size also caps disk IOPS and throughput; a fast disk on a small VM is throttled.
- Pitfall: Azure Files on standard tier has higher latency than a local disk; it is not a database volume.

### Azure Data Lake Storage
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/storage/blobs/data-lake-storage-introduction -->
Azure Data Lake Storage (the generation-2 capability of Blob storage) adds a hierarchical namespace to a storage account. Directories become real objects, so renaming or deleting a folder is a single atomic metadata operation instead of copying every blob, and you can set POSIX-style access control lists on files and folders.

It is the storage foundation for analytics on Azure: Microsoft Fabric (OneLake can shortcut to it), Azure Databricks, Synapse and HDInsight read and write it through the ABFS driver, usually in open formats such as Parquet and Delta Lake.

Typical layout is a medallion design:

```text
abfss://lake@stdatalake01.dfs.core.windows.net/
  bronze/sales/2026/11/18/raw-*.json      # raw, as received
  silver/sales/                           # cleaned, deduplicated (Delta)
  gold/sales_daily_by_region/             # business-ready aggregates
```

```bash
az storage account create -g rg-data -n stdatalake01 --sku Standard_ZRS \
  --kind StorageV2 --enable-hierarchical-namespace true
az storage fs access set --acl "user::rwx,group::r-x,other::---" \
  -p silver -f lake --account-name stdatalake01 --auth-mode login
```

- Pitfall: the hierarchical namespace must be enabled at creation (or via a one-way upgrade) and a few Blob features behave differently with it, so check feature support.
- Pitfall: combine RBAC (coarse) with ACLs (fine-grained) deliberately; RBAC grants are evaluated first.
