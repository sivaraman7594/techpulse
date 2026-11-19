## 12. Cost management

### How Azure pricing works
<!-- level: basic; ref: https://learn.microsoft.com/azure/cost-management-billing/costs/overview-cost-management -->
Azure charges per resource based on meters, and understanding the main meters prevents most bill surprises.

Common cost drivers:

- Compute time: VMs, App Service plans and AKS nodes bill per second or hour while allocated, whether busy or idle.
- Provisioned capacity: SQL vCores, Cosmos DB RU/s, Premium Service Bus messaging units, Redis cache size. You pay for what you reserve.
- Consumption: Functions executions, serverless Cosmos DB RUs, storage transactions, Log Analytics ingestion (per GB).
- Storage: GB-month by tier and redundancy (GZRS costs more than LRS).
- Networking: outbound data transfer to the internet, inter-region and cross-zone traffic in some cases, NAT gateway and firewall processing, public IPv4 addresses.
- Licences: Windows and SQL Server licences baked into VM and database prices.

Use the Azure pricing calculator for estimates during design, and Cost Management for actuals. Prices vary by region, so check that a cheaper region still meets latency and data residency needs.

```bash
# quick look at month-to-date cost grouped by resource group
az costmanagement query --type ActualCost --timeframe MonthToDate \
  --scope /subscriptions/<sub> \
  --dataset-grouping name=ResourceGroup type=Dimension
```

- Pitfall: resources that keep billing after the app is gone: unattached managed disks, public IPs, old snapshots, idle App Service plans, Log Analytics workspaces still ingesting.
- Interview tip: always tie cost to a unit (cost per order, per tenant) so growth and efficiency can be judged.

### Cost Management, budgets and tagging for showback
<!-- level: basic; ref: https://learn.microsoft.com/azure/cost-management-billing/costs/cost-mgt-best-practices -->
Microsoft Cost Management is the built-in FinOps tool for Azure. It answers where money goes and alerts before it goes too far.

Capabilities:

- Cost analysis: explore actual and amortised costs by subscription, resource group, service, meter, location or tag, with forecasts.
- Budgets: set a monthly or quarterly amount at any scope, with alerts at thresholds (for example 50, 80 and 100 percent of actual, and 100 percent of forecast). Budgets can trigger action groups to run automation, such as stopping dev VMs.
- Cost anomaly alerts: detect unusual daily spend automatically.
- Exports: scheduled exports of cost data (including FOCUS format) to storage for Power BI or your own reporting.
- Advisor cost recommendations: right-sizing, idle resources, reservation suggestions.

Tags are what make showback and chargeback possible: with consistent owner, app, env and costCenter tags (enforced by Azure Policy), each team sees its own spend.

```bash
az consumption budget create --budget-name orders-dev-monthly \
  --amount 500 --category cost --time-grain monthly \
  --start-date 2026-12-01 --end-date 2027-12-01 \
  --resource-group rg-orders-dev
```

- Pitfall: budgets alert but never stop spending on their own; add automation if a hard cap is required.
- Pitfall: amortised versus actual cost confuses people when reservations are bought; pick one view for reporting.

### Reservations, savings plans, Spot and Hybrid Benefit
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/cost-management-billing/reservations/save-compute-costs-reservations -->
Once a workload is right-sized, commitment discounts deliver the biggest savings.

- Azure Reservations: commit to a specific resource type, region and size family (VMs, SQL vCores, Cosmos DB RU/s, App Service, Redis, storage capacity) for one or three years, for discounts up to roughly 70 percent compared with pay-as-you-go. Best for stable, predictable usage.
- Azure savings plan for compute: commit to an hourly spend on compute for one or three years. The discount applies flexibly across VM sizes, regions, App Service Premium, Functions Premium, Container Apps and more. Smaller discount than reservations, but more flexible.
- Spot VMs: unused capacity at deep discounts; Azure can evict with 30 seconds notice. Good for batch jobs, CI agents, rendering and stateless workers in scale sets or AKS spot node pools.
- Azure Hybrid Benefit: reuse existing Windows Server and SQL Server licences with Software Assurance to pay only for base compute.
- Dev/Test pricing: discounted rates for non-production subscriptions under eligible agreements.

```bash
az vm create -g rg-batch -n vm-render-01 --image Ubuntu2204 --size Standard_D8s_v5 \
  --priority Spot --eviction-policy Deallocate --max-price -1 --generate-ssh-keys
```

- Strategy: cover the stable baseline with reservations or savings plans, burst with pay-as-you-go, and run interruptible work on Spot.
- Pitfall: buying commitments before right-sizing locks in waste.

### Right-sizing, autoscale and scheduling
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/azure-monitor/autoscale/autoscale-overview -->
Paying only for capacity you use is the core cost lever in the cloud. Three practices make it happen.

Right-sizing: compare provisioned capacity with actual utilisation. Advisor flags underused VMs and databases; Azure SQL and Cosmos DB metrics show DTU/vCore and RU consumption. Downsize, change family (for example to B-series for low-utilisation workloads), or move to serverless tiers.

Autoscale: scale out when demand rises and back in when it falls. Azure Monitor autoscale works for VM scale sets, App Service plans and more, using metric rules or schedules. Container Apps and Functions scale automatically, and Cosmos DB autoscale throughput adjusts RU/s.

Scheduling: non-production environments do not need to run nights and weekends. Use VM auto-shutdown, Azure Automation or Functions timers to stop VMs, scale App Service plans down, pause serverless SQL, and stop AKS clusters.

```bash
# scale App Service plan out on CPU, back in when quiet
az monitor autoscale create -g rg-orders --resource plan-orders \
  --resource-type Microsoft.Web/serverfarms --name plan-orders-autoscale \
  --min-count 2 --max-count 8 --count 2
az monitor autoscale rule create -g rg-orders --autoscale-name plan-orders-autoscale \
  --condition "CpuPercentage > 70 avg 10m" --scale out 1
az monitor autoscale rule create -g rg-orders --autoscale-name plan-orders-autoscale \
  --condition "CpuPercentage < 30 avg 15m" --scale in 1
# stop a dev AKS cluster overnight
az aks stop -g rg-dev -n aks-dev
```

- Pitfall: scale-in rules that are too aggressive cause flapping; use longer windows and cool-downs for scale-in.

## 13. Reliability and the Well-Architected Framework

### The Azure Well-Architected Framework
<!-- level: basic; ref: https://learn.microsoft.com/azure/well-architected/ -->
The Azure Well-Architected Framework (WAF) is Microsoft's guidance for designing and reviewing workloads. It is organised around five pillars, and good architecture means making explicit trade-offs between them.

- Reliability: the workload meets availability and recovery targets. Redundancy, failure-mode analysis, health modelling, testing failover.
- Security: protect confidentiality, integrity and availability. Zero trust, identity first, least privilege, encryption, threat detection.
- Cost Optimization: deliver value at the lowest cost. Right-sizing, commitments, cost models per unit, removing waste.
- Operational Excellence: deploy safely and run predictably. IaC, CI/CD, observability, safe deployment practices, incident management.
- Performance Efficiency: meet demand efficiently. Scaling, caching, partitioning, capacity planning and load testing.

Microsoft also publishes service guides (WAF guidance per service, such as App Service or Cosmos DB), workload guidance (AI, SaaS, mission-critical) and the Well-Architected Review assessment.

```text
Trade-off example: adding a second region
  Reliability  +  survives regional outage
  Cost         -  roughly doubles compute, adds data replication cost
  Operations   -  failover runbooks, data consistency handling
  Decision     -> justified only if RTO < 1 hour is a business requirement
```

- Interview tip: frame any architecture answer in terms of pillars and trade-offs, not just a list of services.

### SLAs, SLOs and composite availability
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/well-architected/reliability/metrics -->
Azure services publish SLAs: financially backed availability commitments such as 99.95 or 99.99 percent. Your own targets are SLOs, derived from what the business needs, and they should be measured with real user-facing indicators (SLIs) such as successful request ratio and latency.

Composite availability: if a request depends on several services in series, multiply their availabilities. App Service (99.95%) calling Azure SQL (99.99%) gives about 0.9995 x 0.9999 = 99.94%. Every added hard dependency reduces the ceiling.

Ways to raise it:

- Redundancy in parallel: two independent regions each at 99.94% give 1 - (0.0006 x 0.0006), about 99.9999% in theory (in practice limited by failover mechanics and shared dependencies).
- Remove hard dependencies: cache, queue work asynchronously, degrade gracefully when a non-critical dependency fails.
- Use zone-redundant SKUs, which often carry higher SLAs.

```text
Downtime budget per 30 days:
  99.9%   ~ 43 minutes
  99.95%  ~ 22 minutes
  99.99%  ~ 4.3 minutes
```

Also define recovery targets: RTO (how long recovery may take) and RPO (how much data loss is acceptable). These drive backup frequency, replication mode and whether you need active-active.

- Pitfall: an SLA is a refund policy, not a guarantee. Design for failure anyway.

### Availability zones and zone-redundant design
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/reliability/availability-zones-overview -->
Designing for zone failure is the baseline for production reliability within one region, and it costs far less than multi-region.

For each tier, use the zone-resilient option:

- Entry: Front Door (global) or zone-redundant Application Gateway v2 and Standard Load Balancer.
- Compute: zone-redundant App Service plans (at least two or three instances), Container Apps environments with zone redundancy, AKS node pools across zones, VM scale sets with zones 1, 2 and 3.
- Data: zone-redundant Azure SQL, Cosmos DB with zone redundancy, PostgreSQL flexible server with zone-redundant HA, ZRS or GZRS storage, Premium Service Bus (zone-redundant by default in supported regions).
- Networking: zone-redundant VPN and ExpressRoute gateway SKUs, NAT gateway considerations (a NAT gateway is zonal or regional depending on configuration).

```bicep
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-orders-prod'
  location: location
  sku: { name: 'P1v3', capacity: 3 }
  kind: 'linux'
  properties: { reserved: true, zoneRedundant: true }
}
```

- Pitfall: zone redundancy often must be chosen at creation time and cannot be toggled later for some services; decide up front.
- Pitfall: stateful components pinned to one zone (a single VM running a self-hosted database) undo the resilience of everything else.
- Test it: Azure Chaos Studio can simulate zone outages to validate behaviour.

### Backup and disaster recovery: Azure Backup and Site Recovery
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/backup/backup-overview -->
High availability keeps you running through component failures; backup and disaster recovery (DR) recover you from data corruption, ransomware, mistakes and regional disasters.

Azure Backup provides managed backups for VMs, SQL Server and SAP HANA in VMs, Azure Files, Blobs, managed disks, PostgreSQL and AKS. Backups go to Recovery Services or Backup vaults, with policies for frequency and retention. Protect the backups themselves: soft delete, immutable vaults, multi-user authorisation for destructive operations, and cross-region restore.

Azure Site Recovery (ASR) replicates VMs (Azure to Azure, on-premises VMware/Hyper-V/physical to Azure) continuously to a secondary region and orchestrates failover with recovery plans, giving RPOs of seconds to minutes. Test failovers run into an isolated network without impacting production.

PaaS services usually have their own DR features instead: SQL failover groups, Cosmos DB multi-region, storage geo-redundancy, Key Vault and Service Bus geo-replication.

```bash
az backup protection enable-for-vm -g rg-legacy --vault-name rsv-prod-cin \
  --vm vm-report-01 --policy-name DefaultPolicy
az backup vault backup-properties set -g rg-legacy -n rsv-prod-cin \
  --soft-delete-feature-state AlwaysON --cross-region-restore-flag true
```

- Pitfall: a backup that has never been restored is a hope, not a plan; schedule restore drills.
- Pitfall: geo-replicated data still replicates corruption and deletions; you also need point-in-time backups.

### Multi-region architecture patterns
<!-- level: advanced; ref: https://learn.microsoft.com/azure/architecture/web-apps/app-service/architectures/multi-region -->
When the business needs to survive a regional outage, choose a multi-region pattern based on RTO, RPO and budget.

- Backup and restore: infrastructure as code plus geo-redundant backups. Cheapest; RTO of hours.
- Active-passive (warm standby): a scaled-down copy runs in the secondary region with data replicated; on failover it scales up and traffic moves. RTO in minutes.
- Active-active: both regions serve traffic all the time. Lowest RTO and better latency for global users, but you must solve data consistency (Cosmos DB multi-region writes with conflict resolution, or routing each user to a home region).

Building blocks on Azure: Front Door or Traffic Manager for routing and health probes; Azure SQL failover groups or Cosmos DB for data; GZRS or RA-GZRS storage; Service Bus geo-replication; per-region Key Vaults and App Configuration replicas; a pipeline that deploys to every region identically.

```text
Active-passive for an order API:
  Front Door (priority routing: CIN=1, SIN=2, health probe /healthz)
  CIN: Container Apps (3 replicas)  SQL FG primary   Service Bus primary
  SIN: Container Apps (1 replica)   SQL FG secondary Service Bus replica
  Runbook: promote SQL FG -> scale SIN -> confirm Front Door shifted -> communicate
```

- Pitfall: hidden single-region dependencies (one Key Vault, one container registry, an identity provider config) break failover.
- Pitfall: never tested equals never works; run regular failover drills.

### Resilience patterns in .NET applications
<!-- level: advanced; ref: https://learn.microsoft.com/dotnet/core/resilience/ -->
Cloud services fail transiently: throttling (HTTP 429), brief network drops, failovers. Applications must handle this gracefully. The Azure SDKs already include retry policies, but your own HTTP calls and business operations need patterns too.

Key patterns (see the Azure Architecture Center cloud design patterns):

- Retry with exponential backoff and jitter, only for transient and idempotent operations.
- Timeouts on every remote call, so threads are not held forever.
- Circuit breaker: stop calling a failing dependency for a while to let it recover and to fail fast.
- Bulkhead: limit concurrent calls so one slow dependency cannot exhaust all resources.
- Fallback and graceful degradation: serve cached or default data.
- Queue-based load levelling and competing consumers for spikes.

In .NET, Microsoft.Extensions.Http.Resilience (built on Polly v8) adds a standard pipeline to HttpClient with rate limiter, total timeout, retry, circuit breaker and attempt timeout.

```csharp
builder.Services.AddHttpClient<PaymentsClient>(c => c.BaseAddress = new Uri("https://payments.internal"))
    .AddStandardResilienceHandler(o =>
    {
        o.Retry.MaxRetryAttempts = 3;
        o.Retry.UseJitter = true;
        o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(2);
        o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(10);
        o.CircuitBreaker.FailureRatio = 0.5;
    });
```

- Pitfall: retries at every layer multiply (3 x 3 x 3 = 27 calls) and turn a blip into an outage; retry at one layer.
- Pitfall: retrying a non-idempotent payment call without an idempotency key can charge twice.
