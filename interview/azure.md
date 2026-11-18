# Azure interview questions

### When would you choose App Service, Azure Functions, Container Apps or AKS?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/azure/architecture/guide/technology-choices/compute-decision-tree -->
- **App Service**: managed hosting for web apps and APIs. Little infrastructure work; deployment slots, autoscale, easy auth.
- **Azure Functions**: event-driven, serverless code (HTTP, queues, timers, events). Pay per execution on consumption-style plans; best for short, bursty tasks.
- **Azure Container Apps**: run containers and microservices without managing Kubernetes; scale to zero, built-in KEDA scaling, Dapr support.
- **AKS (Azure Kubernetes Service)**: full Kubernetes control for complex platforms — more power, more operational responsibility.

Pick the most managed option that meets your requirements.

### What are triggers and bindings in Azure Functions?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/azure/azure-functions/functions-triggers-bindings -->
- A **trigger** starts the function — HTTP request, timer, queue message, Service Bus, Event Grid, Blob change, Cosmos DB change feed… Each function has exactly one trigger.
- **Bindings** connect to other services declaratively for input and output, so you write less SDK code.

Related points: consumption-style plans can have **cold starts**; Premium/Flex plans can keep instances warm. **Durable Functions** add stateful orchestrations (function chaining, fan-out/fan-in, human approval with timers).

### Service Bus vs Event Grid vs Event Hubs — what is the difference?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/azure/service-bus-messaging/compare-messaging-services -->
- **Service Bus**: enterprise **messaging** — queues and topics, guaranteed delivery, sessions (ordering), dead-letter queues, transactions. Use for commands and business workflows (e.g. "process this order").
- **Event Grid**: **event routing** with push delivery — reacting to things that happened ("a blob was created"). Lightweight, high fan-out.
- **Event Hubs**: **big-data streaming** — millions of events per second for telemetry and logs, with partitions and replay; consumers read at their own pace.

### How do managed identities and Key Vault help you avoid secrets in code?
<!-- level: intermediate; kind: concept; ref: https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/overview -->
A **managed identity** gives your Azure resource (App Service, Function, VM, Container App) an identity in Microsoft Entra ID, managed by Azure — no credentials to store or rotate.

Grant that identity access to resources via **Azure RBAC** (e.g. "Key Vault Secrets User", "Storage Blob Data Reader"), then authenticate with `DefaultAzureCredential`, which uses your developer login locally and the managed identity in Azure.

```csharp
var client = new SecretClient(new Uri("https://myvault.vault.azure.net/"), new DefaultAzureCredential());
KeyVaultSecret secret = await client.GetSecretAsync("DbPassword");
```

Where possible, skip secrets entirely and connect to services like Azure SQL or Storage with the identity directly.

### What storage options does an Azure Storage account offer, and what are access tiers?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/azure/storage/common/storage-introduction -->
- **Blob storage**: objects/files (images, backups, data lakes).
- **Queue storage**: simple message queues.
- **Table storage**: NoSQL key-value data.
- **Azure Files**: managed file shares over SMB/NFS.

Blob **access tiers** trade storage cost for access cost: **Hot** (frequent access) → **Cool** → **Cold** → **Archive** (cheapest storage, must be rehydrated before reading, which can take hours). Lifecycle management policies can move blobs between tiers automatically.

### How do you choose a partition key and consistency level in Cosmos DB?
<!-- level: advanced; kind: concept; ref: https://learn.microsoft.com/azure/cosmos-db/partitioning-overview -->
**Partition key**: choose a property with high cardinality that spreads reads and writes evenly and that most queries filter on (e.g. `/customerId`, `/tenantId`). A bad key creates "hot" partitions and expensive cross-partition queries. It cannot be changed in place later.

**Consistency levels**, from strongest to weakest: Strong → Bounded staleness → **Session** (default; a client always reads its own writes) → Consistent prefix → Eventual. Weaker levels give lower latency and higher availability at the cost of possibly stale reads.

### How do deployment slots work in App Service?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/azure/app-service/deploy-staging-slots -->
A deployment slot (e.g. `staging`) is a live copy of your app with its own hostname. You deploy to staging, warm it up and test, then **swap** it with production. The swap is near zero-downtime, and if something goes wrong you swap back.

Settings can be marked as **slot settings** so they stay with the slot (e.g. a staging database connection string).

### Design a highly available web application on Azure.
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/azure/architecture/web-apps/app-service/architectures/multi-region -->
- **Entry**: Azure Front Door (global load balancing, WAF, CDN, health probes) routing to two regions.
- **Compute**: App Service or Container Apps in each region, zone-redundant where available, with autoscale.
- **Data**: Azure SQL with **failover groups** (or Cosmos DB with multi-region writes/reads); geo-redundant storage for blobs.
- **Caching**: Azure Cache for Redis to reduce database load.
- **Messaging**: Service Bus to decouple and absorb spikes.
- **Security**: managed identities, Key Vault, private endpoints.
- **Operations**: Application Insights and Azure Monitor alerts; infrastructure as code (Bicep/Terraform); regularly test failover.

Define the RTO/RPO targets first — they decide whether active-active or active-passive is justified.

### How would you reduce a growing Azure bill?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/cost-management-billing/costs/cost-mgt-best-practices -->
1. **Visibility**: Cost Management + budgets and alerts; tag resources by team/app/environment.
2. **Right-size**: follow Azure Advisor recommendations; downsize under-used VMs, databases and plans.
3. **Commit**: Reservations or Savings Plans for steady workloads; Azure Hybrid Benefit if you have licences.
4. **Scale with demand**: autoscale, serverless/consumption plans, scale to zero for idle apps.
5. **Turn off** dev/test resources at night; delete orphaned disks, IPs and old snapshots.
6. **Storage**: lifecycle policies to move cold data to Cool/Archive tiers.
7. **Data transfer**: keep chatty services in the same region.

### After deployment your app gets "403 Forbidden" reading from Key Vault. How do you troubleshoot?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/key-vault/general/troubleshooting-access-issues -->
Check in this order:
1. **Identity**: is the managed identity enabled on the app, and is the code using it (`DefaultAzureCredential`, correct client ID for a user-assigned identity)?
2. **Permissions**: if the vault uses Azure RBAC, does the identity have a role such as *Key Vault Secrets User* on the vault? If it uses access policies, is there a policy with *Get* for secrets? (Role assignments can take a few minutes to apply.)
3. **Networking**: is the vault firewall or private endpoint blocking the app? Allow the app's subnet/VNet integration or trusted services.
4. **Correct vault URI and secret name**, and that the secret is enabled and not expired.

Key Vault diagnostic logs show the caller identity and the reason for each denied request.

### How do you set up CI/CD for a .NET app to Azure?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/app-service/deploy-github-actions -->
A typical pipeline in GitHub Actions or Azure Pipelines:
1. **Build**: restore, build, run unit tests, `dotnet publish`.
2. **Quality gates**: code analysis, dependency/security scanning.
3. **Deploy to staging** (a deployment slot or separate environment) using **OpenID Connect / workload identity federation** — no long-lived secrets in the pipeline.
4. **Smoke tests** against staging; then approval if needed.
5. **Swap** to production; monitor and roll back by swapping again.

Keep infrastructure in code (Bicep/Terraform) and deploy it through the same pipeline.
