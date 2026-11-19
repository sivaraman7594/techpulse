# Azure scenario questions

### Your App Service API suddenly returns HTTP 503 for all users right after a deployment. How do you respond?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/app-service/troubleshoot-http-502-http-503 -->
Treat it as an incident: restore service first, find the cause second.

1. Observe: check the timeline. Did errors start exactly at the deployment? Look at Application Insights failures, the App Service "Diagnose and solve problems" blade, and log stream. A 503 often means no healthy instance is available: the app crashed at startup, the health check is failing on every instance, or the plan is overloaded.
2. Mitigate: if you deployed via slots, swap back immediately; the previous version is still warm in the staging slot. Without slots, redeploy the last known good artifact.
3. Hypothesise and verify the cause:
- Startup crash: missing app setting, Key Vault reference that failed to resolve (shown in the Environment variables blade), wrong runtime stack, or a migration that failed. Check the container or application event log.
- Health check path returning non-200 because it depends on a database that is unreachable, so the platform marks all instances unhealthy.
- Port mismatch for a custom container (WEBSITES_PORT or the app listening on the wrong port).
- Resource exhaustion: CPU or memory at 100 percent on the plan, perhaps from a new memory leak.

```bash
az webapp deployment slot swap -g rg-orders -n app-orders-api --slot staging --target-slot production
az webapp log tail -g rg-orders -n app-orders-api
```

4. Fix forward in staging, verify with swap with preview, then swap.
5. Prevent: always deploy to a slot with warm-up and automated smoke tests before swapping; keep health checks shallow (process alive, critical dependency checks behind a separate readiness endpoint); alert on 5xx rate per slot.

Common wrong answer: restarting the app repeatedly. It hides the evidence and does not fix a configuration error.

### Your Azure bill jumped 40 percent this month with no new features shipped. How do you investigate?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/cost-management-billing/understand/analyze-unexpected-charges -->
Approach it like a debugging exercise: find which meter changed, then why.

1. Observe in Cost analysis: compare this month with last, grouped by service name, then resource group, then resource, then meter. Use daily granularity to find the day the jump started. Check cost anomaly alerts.
2. Hypothesise from the usual suspects:
- Log Analytics ingestion: someone enabled verbose logging, a new diagnostic setting with allLogs, or a noisy container. Query the Usage table to see GB per table.
- Autoscale stuck high: an App Service plan or VMSS scaled out and never scaled in because of a bad rule.
- Cosmos DB autoscale max raised, or a new query doing cross-partition scans.
- Data transfer: a new integration pulling data across regions or to the internet.
- Forgotten resources: a load test environment, GPU VMs, a Premium SKU created "temporarily".
- Reservation expired, so usage reverted to pay-as-you-go prices.

```kusto
Usage
| where TimeGenerated > ago(30d) and IsBillable == true
| summarize GB = sum(Quantity) / 1000 by DataType, bin(TimeGenerated, 1d)
| render columnchart
```

3. Verify with the resource's own metrics and the Activity Log (who changed the SKU and when).
4. Fix: roll back the change, adjust retention or tiers, add DCR transformations to drop noise, renew reservations, delete orphans.
5. Prevent: budgets with forecast alerts per team, anomaly alerts, mandatory tags, Azure Policy limiting allowed SKUs, and a monthly cost review.

Wrong answer: "buy reservations". That does not explain the change and may lock in waste.

### Users report the app is slow, and Application Insights shows SQL dependency calls taking seconds. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/azure-sql/database/monitor-tune-overview -->
Separate database capacity problems from query problems.

1. Observe: in Azure SQL metrics, check CPU, data IO, log IO and worker percentage. If any is pinned near 100 percent, you are resource bound. In Query Performance Insight and Query Store, find the top queries by duration and CPU, and check whether a plan changed recently.
2. Hypothesise:
- A new query or missing index causing scans (common after a feature release with a new filter).
- A plan regression from parameter sniffing.
- Blocking: a long transaction holding locks.
- Too many connections because DbContext or SqlConnection was not disposed, or pool exhaustion.
- The serverless database auto-paused or scaled down.
- The database is just undersized for grown traffic.
3. Verify with DMVs and Query Store.

```sql
SELECT TOP 10 qs.total_worker_time / qs.execution_count AS avg_cpu, st.text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY avg_cpu DESC;

SELECT blocking_session_id, wait_type, wait_time, session_id
FROM sys.dm_exec_requests WHERE blocking_session_id <> 0;
```

4. Fix: add the index (Azure SQL automatic tuning can recommend or create indexes and force last good plan), rewrite N+1 EF Core queries with projections and Include, shorten transactions, scale up temporarily to buy time.
5. Prevent: enable automatic tuning, alert on DTU/vCore percentage, load test new features, and review EF Core generated SQL in code review.

Trade-off: scaling up fixes symptoms fast but costs money every month; fix the query too.

### A developer accidentally committed a storage account key to a public GitHub repository. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/storage/common/storage-account-keys-manage -->
Assume the key is already compromised; bots scan GitHub within minutes.

1. Contain immediately: rotate (regenerate) the exposed key. If apps use key1, switch them to key2 first if possible, then regenerate key1; if not, accept the brief outage, because a leaked key gives full data access. Also revoke any account SAS tokens signed with it, which become invalid when the key rotates.
2. Assess impact: enable or check storage diagnostic logs (StorageBlobLogs) for requests authenticated with the key from unknown IPs, and look for listing, downloads or deletions since the commit time. Check Defender for Storage alerts.
3. Clean the repository: remove the secret and rewrite history if required, but remember rewriting does not un-leak it; rotation is the real fix. Enable GitHub secret scanning and push protection.
4. Recover data if anything was deleted or modified, using soft delete and versioning.
5. Prevent recurrence:
- Disable shared key authorisation on the account (allowSharedKeyAccess false) so keys are useless.
- Use managed identities and RBAC roles for applications.
- Use user delegation SAS when temporary access is needed.
- Add pre-commit secret scanning and Azure Policy auditing accounts that allow shared key.

```bash
az storage account keys renew -g rg-app -n stappdata --key primary
az storage account update -g rg-app -n stappdata --allow-shared-key-access false
```

Interview point: the root cause is architectural (keys existed at all), not the developer's mistake.

### You must migrate a 2 TB on-premises SQL Server database to Azure with less than 30 minutes of downtime. How do you plan it?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/azure/azure-sql/migration-guides/managed-instance/sql-server-to-managed-instance-guide -->
Start by choosing the target, then a migration method that supports online cutover.

1. Assess: run Azure Migrate or the SQL migration assessment to find compatibility blockers (SQL Agent jobs, cross-database queries, CLR, linked servers, Service Broker). If they are used heavily, target Azure SQL Managed Instance; otherwise Azure SQL Database (possibly Hyperscale for size and growth). Get SKU recommendations from performance data.
2. Choose an online method:
- Managed Instance link (distributed availability group) replicates continuously from SQL Server to Managed Instance; cutover is a short failover.
- Azure Database Migration Service in online mode via the Azure SQL migration extension, using log shipping of backups.
- For Azure SQL Database, transactional replication or DMS with a cutover window.
3. Prepare networking: ExpressRoute or VPN for bandwidth (2 TB over a slow link takes days), private endpoint, DNS plan.
4. Rehearse: full dry run including application testing against the replica, measuring cutover time.
5. Cutover: stop writes in the app, wait for the replica to catch up, complete the cutover, switch connection strings (ideally a DNS alias), run smoke tests.
6. Rollback plan: keep the source untouched and, if possible, reverse replication, with a clear go/no-go decision point.

```text
T-14d  seed replica, start continuous sync
T-7d   dress rehearsal, perf test on target
T-0    freeze writes 10:00, lag = 0 at 10:04, cutover 10:06, app live 10:15
```

Common wrong answer: backup and restore with BACPAC. For 2 TB that means hours of downtime.

### A Function app processing Service Bus messages is falling behind and the queue has 2 million messages. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/azure-functions/functions-bindings-service-bus -->
1. Observe: the queue's active message count trend, incoming versus completed message rates, function execution duration, failure rate, and dead-letter count. Is the backlog growing because of a traffic spike, slower processing, or failures causing retries?
2. Hypothesise:
- Processing got slower because a downstream dependency (database, API) is slow or throttling. Scaling out would make it worse.
- Many messages fail and are retried up to MaxDeliveryCount, multiplying the work.
- Scaling is capped: maximum instance count on the plan, low maxConcurrentCalls in host.json, or sessions limiting parallelism.
- A traffic spike from an upstream batch job.
3. Verify with Application Insights dependency durations and exception counts.
4. Fix:
- If the dependency is healthy and capacity-bound, raise scale: Flex Consumption or Premium maximum instances, maxConcurrentCalls, and prefetch.
- If the dependency is the bottleneck, do not scale out blindly; it can become a self-inflicted DDoS. Increase its capacity or cap concurrency to its limit.
- Fix poison messages so they dead-letter quickly instead of retrying.
- Use batch receiving and batch writes to reduce per-message overhead.

```json
{
  "version": "2.0",
  "extensions": {
    "serviceBus": { "maxConcurrentCalls": 32, "prefetchCount": 100, "maxAutoLockRenewalDuration": "00:05:00" }
  }
}
```

5. Prevent: alert on queue age (oldest message time) not just length, load test with realistic volumes, and set capacity limits deliberately.

Trade-off: higher concurrency increases throughput but also the chance of ordering issues and throttling.

### A Container App's first request after idle takes 15 seconds. Product wants it under one second. What are your options?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/container-apps/scale-app -->
The cause is almost certainly scale to zero followed by a cold start: pulling the image, starting the container, and the .NET app's own startup.

1. Verify: check replica count over time in metrics and the system logs; if replicas drop to zero after idle and the slow request coincides with a new replica, it is a cold start.
2. Options, cheapest effect first:
- Set min replicas to 1 (or more for zone resilience). Removes cold starts for the common path at the cost of always-on compute.
- Reduce image size (chiseled or Alpine-based .NET runtime images, multi-stage builds) so pulls are faster.
- Speed up app startup: avoid synchronous work in Program.cs (warming caches, migrations), lazy-load heavy dependencies, consider ReadyToRun or Native AOT for small APIs.
- Use startup and readiness probes so traffic only arrives when the app is ready, instead of the first user paying the price.
- For Functions on Flex Consumption, configure always-ready instances.
3. Measure after the change with synthetic availability tests that run from several locations every few minutes.

```bash
az containerapp update -n orders-api -g rg-orders --min-replicas 1 --max-replicas 10
```

Trade-off to communicate: one always-on replica on the consumption profile costs a modest monthly amount; compare that to the business value of fast first responses. A common wrong answer is a "keep-alive ping" every few minutes: it is a hack that wastes requests and still fails during scale-out events.

### Design secure connectivity so an App Service app reaches Azure SQL and Key Vault without any public endpoints.
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/azure/app-service/overview-vnet-integration -->
The goal: data services have public network access disabled, and the app reaches them privately.

1. Network layout: a VNet with a delegated subnet for App Service VNet integration (outbound) and a separate subnet for private endpoints.
2. Outbound from the app: enable regional VNet integration. Route all outbound traffic through the VNet (vnetRouteAllEnabled) so calls to SQL and Key Vault use the private path.
3. Private endpoints for Azure SQL (groupId sqlServer) and Key Vault (vault) in the endpoint subnet. Disable public network access on both services.
4. DNS: create privatelink.database.windows.net and privatelink.vaultcore.azure.net private DNS zones, link them to the VNet, and let the private endpoints register A records. The app keeps using normal hostnames.
5. Identity: system-assigned managed identity on the app, a contained SQL user for it, and the Key Vault Secrets User role. No passwords anywhere.
6. Inbound: if the app itself must be private, add a private endpoint for the app and put Application Gateway or Front Door Premium (Private Link origin) in front.

```bash
az webapp vnet-integration add -g rg-orders -n app-orders-api --vnet vnet-orders-prod --subnet snet-appsvc
az resource update -g rg-orders -n app-orders-api --resource-type Microsoft.Web/sites \
  --set properties.vnetRouteAllEnabled=true
az sql server update -g rg-orders -n sql-orders-prod --enable-public-network false
```

Verification: from the Kudu console, run nslookup sql-orders-prod.database.windows.net and confirm a 10.x address. Common mistake: forgetting the DNS zone link, so the app resolves the public IP and gets denied.

### A Cosmos DB container is returning many HTTP 429 errors during peak hours. How do you fix it?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/azure/cosmos-db/request-units -->
A 429 means requests exceeded the provisioned RU/s for some partition. The fix depends on whether the problem is total capacity or a hot partition.

1. Observe in Insights: total RU consumption versus provisioned, normalized RU consumption per partition key range, and the 429 rate. If one partition is at 100 percent while others idle, it is a hot partition.
2. Hypothesise:
- Overall throughput too low for the peak.
- Hot partition key (for example /status or a single large tenant).
- An expensive query (cross-partition, no index, SELECT * with large documents) consuming most RUs.
- A bulk import job running during business hours.
3. Verify: log request charge per operation from the SDK, and use diagnostic logs (CDBDataPlaneRequests and query runtime stats) to find the costliest operations.

```kusto
CDBDataPlaneRequests
| where TimeGenerated > ago(1h) and StatusCode == 429
| summarize count(), sum(RequestCharge) by OperationName, PartitionId
```

4. Fix:
- Capacity: enable autoscale with a higher maximum, or increase RU/s.
- Hot partition: change the partition key (requires migrating to a new container, for example with the container copy feature) or use hierarchical partition keys.
- Queries: add composite indexes, filter on the partition key, project only needed fields.
- Bulk jobs: use the bulk executor with throughput control, or schedule them off-peak.
5. Prevent: model partition keys with load tests, alert on normalized RU above 90 percent.

Note: a small rate of 429s that the SDK retries successfully is normal and cost-efficient; aim to remove sustained throttling, not every 429.

### Your company is moving from on-premises AD-joined servers to Azure. How do you design identity for apps and admins?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/entra/identity/hybrid/whatis-hybrid-identity -->
1. Users: synchronise on-premises AD to Microsoft Entra ID with Entra Connect Sync or Cloud Sync. Prefer password hash sync (simplest and most resilient, also enables leaked credential detection) over pass-through or federation, unless policy forbids it.
2. Admin access to Azure:
- Assign roles to Entra groups, not individuals.
- Use PIM for just-in-time Owner and Contributor roles.
- Conditional Access requiring phishing-resistant MFA for Azure management.
- Separate cloud-only admin accounts, not synced from on-premises, so an AD compromise does not reach Azure.
- Two break-glass accounts, monitored.
3. Workload identities:
- Apps running in Azure use managed identities.
- Pipelines use workload identity federation with GitHub or Azure DevOps.
- Legacy apps needing Kerberos or LDAP: Microsoft Entra Domain Services or domain controllers on Azure VMs.
4. Applications' user sign-in: modernise to OpenID Connect with Entra ID; for legacy header-based or Kerberos apps, Entra application proxy can publish them.
5. Governance: access reviews for privileged groups, lifecycle workflows for joiners and leavers, and sign-in logs streamed to Log Analytics or Sentinel.

```text
Group: grp-azure-orders-prod-contributors  -> eligible Contributor on rg-orders-prod (PIM, 4h max)
Group: grp-azure-readers                    -> Reader on management group "landingzones"
Identity: app-orders-api (system MI)        -> Key Vault Secrets User, SQL contained user
```

Common wrong answer: creating service principals with secrets for every app, which reintroduces credential management problems.

### A regional outage takes down your primary Azure region. Walk through the failover of a web app with Azure SQL.
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/azure/azure-sql/database/disaster-recovery-guidance -->
Assume an active-passive design: Front Door, App Service in two regions, and a SQL failover group.

1. Confirm: Azure Service Health and your own monitoring agree the primary region is impaired. Avoid failing over for a five-minute blip, because failover itself has cost (possible data loss, failback work). Your runbook should define the trigger, for example "primary unavailable for 15 minutes or Microsoft confirms a regional incident".
2. Data first: initiate failover of the SQL failover group to the secondary. If the primary is unreachable, this is a forced failover with possible loss of the last few seconds of transactions (asynchronous replication). Record the RPO impact.
3. Compute: scale out the secondary App Service plan to production capacity (or use pre-provisioned capacity if RTO is tight, because capacity in a busy secondary region during a regional incident is not guaranteed).
4. Traffic: Front Door health probes should already be routing to the secondary; verify and disable the primary origin to avoid flapping.
5. Dependencies: confirm Key Vault, storage (initiate customer-managed storage failover if needed), Service Bus and identity work from the secondary.
6. Communicate status and data-loss implications.
7. Failback later in a planned window, reversing replication first.

```bash
az sql failover-group set-primary -g rg-orders -s sql-orders-prod-sin -n fg-orders --allow-data-loss
az appservice plan update -g rg-orders-sin -n plan-orders-sin --number-of-workers 6
```

Interview point: the most common real failure is an untested runbook or a forgotten single-region dependency.

### Two microservices on AKS need to call Azure Storage and Service Bus. How do you give them credentials securely?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/aks/workload-identity-overview -->
Use Microsoft Entra Workload ID, not secrets in Kubernetes Secrets.

1. Enable the OIDC issuer and workload identity on the cluster.
2. Create a user-assigned managed identity per service (least privilege per workload, not one shared identity).
3. Grant RBAC: Storage Blob Data Contributor on the specific container or account for service A; Azure Service Bus Data Sender on the specific queue for service B.
4. Create a federated identity credential on each managed identity that trusts the cluster's OIDC issuer and the specific Kubernetes service account (subject system:serviceaccount:namespace:name).
5. Annotate the Kubernetes service account with the identity's client ID and label the pods to use workload identity. The mutating webhook injects the token file and environment variables.
6. In code, DefaultAzureCredential (or WorkloadIdentityCredential) picks it up automatically.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-sa
  namespace: orders
  annotations:
    azure.workload.identity/client-id: 1b2c3d4e-0000-0000-0000-000000000000
---
# in the Deployment pod template
metadata:
  labels:
    azure.workload.identity/use: "true"
spec:
  serviceAccountName: orders-sa
```

```bash
az identity federated-credential create -g rg-platform --identity-name id-orders \
  --name aks-orders --issuer $(az aks show -g rg-platform -n aks-prod --query oidcIssuerProfile.issuerUrl -o tsv) \
  --subject system:serviceaccount:orders:orders-sa --audience api://AzureADTokenExchange
```

Wrong answers: the deprecated pod-managed identity add-on, connection strings in Secrets, or the kubelet identity being granted data access (every pod on the node would inherit it).

### A Log Analytics workspace costs more than the application it monitors. How do you reduce it without losing important visibility?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/azure-monitor/logs/cost-logs -->
1. Measure: query the Usage table to find which tables and which resources ingest most. Typical offenders: ContainerLogV2 from chatty pods, AzureDiagnostics from firewalls or App Gateway, AppTraces with debug-level logging, and Application Insights dependencies at 100 percent sampling.
2. Decide value per data type with the people who use it: what is queried for alerts, what for investigations, what for compliance only.
3. Reduce at the source:
- Raise application log levels to Warning in production for noisy categories; keep Information for business events.
- Enable sampling in Application Insights.
- Exclude namespaces such as kube-system from Container Insights or collect only stderr.
4. Reduce in the pipeline: data collection rule transformations to drop columns or rows before ingestion.
5. Change table plans: Basic or Auxiliary logs for high-volume, rarely queried data (cheaper ingestion, limited query features and pay-per-query).
6. Retention: shorter interactive retention, with long-term retention or export to storage for compliance.
7. Pricing: commitment tiers for predictable volume of 100 GB per day or more.

```kusto
Usage
| where TimeGenerated > ago(7d) and IsBillable
| summarize GBperDay = sum(Quantity) / 1000 / 7 by DataType
| order by GBperDay desc
```

Trade-off: dropping data saves money but can blind you during an incident; keep error-level and request-level data, sample high-volume success traces. Avoid a hard daily cap as the main control, because it silently stops ingestion when you most need it.

### Management wants zero downtime for database schema changes in a .NET app on Azure SQL. How do you design deployments?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/ef/core/managing-schemas/migrations/applying -->
Slot swaps make code deployment zero-downtime, but a schema change that breaks the old code still causes downtime during the overlap when old and new versions run together.

Use the expand and contract pattern:

1. Expand: add new structures in a backward-compatible way: new nullable columns, new tables, new indexes built online. Old code keeps working.
2. Deploy code that writes to both old and new structures and reads from the new one with fallback. Backfill existing rows in batches.
3. Contract: once no running version uses the old column, remove it in a later release.

Example: renaming CustomerName to FullName takes three releases, not one.

Execution:

- Do not run EF Core migrations from application startup in production; multiple instances race and failures crash startup. Generate idempotent SQL scripts or migration bundles in CI, review them, and run them as a pipeline step before the slot swap.
- Use online index operations and avoid long blocking ALTERs on large tables (adding a NOT NULL column with a default is metadata-only in modern SQL, but changing a data type is not).
- Test migrations against a production-sized copy to measure duration and locking.

```bash
dotnet ef migrations bundle --project src/Orders.Data --idempotent -o efbundle
./efbundle --connection "$ORDERS_SQL"   # pipeline step, before swap
```

Rollback: because changes are additive, rolling back code via a swap is safe; avoid down migrations that drop data.

### An Azure Function triggered by a timer runs twice at the same time and creates duplicate invoices. Why, and how do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/azure-functions/functions-bindings-timer -->
1. Observe: Application Insights shows two invocations at the same scheduled time with different invocation IDs, possibly on different instances or different apps.
2. Hypothesise:
- The timer trigger uses a blob lease (singleton lock) in the storage account given by AzureWebJobsStorage, so only one instance runs per schedule. Duplicates happen when two different function apps (for example a staging slot and production, or a copied app) share the same storage account and the same host ID, or when they use separate storage and both run the job.
- A long run overlapped with the next schedule.
- A retry after a crash re-ran work that had partially succeeded.
3. Verify: check which app and slot each invocation ran in; check whether the staging slot has the timer enabled.
4. Fix:
- Disable the timer in non-production slots with a sticky app setting such as AzureWebJobs.GenerateInvoices.Disabled=true.
- Give each app its own storage account or unique host ID.
- Most importantly, make the job idempotent: use a deterministic key per billing period and customer, with a unique constraint in the database, so a second run cannot create a duplicate.

```sql
ALTER TABLE Invoices ADD CONSTRAINT UQ_Invoice_Period UNIQUE (CustomerId, BillingPeriod);
```

5. Prevent: treat every trigger as at-least-once. For long jobs, move to Durable Functions or a queue-based design where each customer is a separate message.

Wrong answer: adding a static boolean flag; it does not work across instances.

### You need to expose internal APIs to partners with rate limits, keys and analytics. Design it.
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/api-management/api-management-howto-protect-backend-with-aad -->
Put Azure API Management in front of the internal APIs.

1. Gateway placement: APIM in internal VNet mode (or a v2 tier with VNet injection), fronted by Application Gateway with WAF or Front Door for the public entry point. Backends (App Service, AKS) remain private.
2. Products: define products such as "Partner Basic" and "Partner Premium". Partners subscribe through the developer portal and receive subscription keys tied to a product.
3. Authentication: subscription key identifies the partner, but also require OAuth 2.0 client credentials from Entra ID (validate-jwt policy), because keys alone are weak. For high-assurance partners, mutual TLS with client certificates.
4. Policies per product: rate-limit-by-key and quota-by-key, IP filtering, request size limits, response caching for read-heavy endpoints, header stripping to avoid leaking internal details.
5. Backend auth: APIM calls backends with its managed identity (authentication-managed-identity policy), so backends only trust APIM.
6. Versioning and revisions to evolve APIs without breaking partners.
7. Analytics: built-in analytics plus Application Insights logging per partner; alerts on error spikes per product.

```xml
<inbound>
  <base />
  <rate-limit-by-key calls="600" renewal-period="60" counter-key="@(context.Subscription.Id)" />
  <quota-by-key calls="1000000" renewal-period="2592000" counter-key="@(context.Subscription.Id)" />
  <authentication-managed-identity resource="api://orders-internal" />
</inbound>
```

Trade-off: Premium tier gives multi-region and zones but is expensive; Standard v2 often suffices for a single region.

### After enabling a private endpoint on a storage account, the application gets "This request is not authorized" errors. How do you troubleshoot?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/private-link/private-endpoint-overview -->
The error usually comes from the storage firewall rejecting a request that arrived from the public path.

1. Observe: confirm the error code in the storage logs (AuthorizationFailure versus AuthorizationPermissionMismatch). AuthorizationFailure with network rules means the request came from a source the firewall does not allow; PermissionMismatch means RBAC.
2. Hypothesise:
- DNS still resolves stappdata.blob.core.windows.net to the public IP, so traffic goes over the internet and hits the firewall.
- The private endpoint was created for blob but the app also uses queue or file sub-resources, each needing its own endpoint.
- The app runs outside the VNet (App Service without VNet integration, or route-all disabled).
- The private DNS zone is linked to the wrong VNet, or a custom DNS server does not forward to Azure DNS.
3. Verify from the app's network: nslookup stappdata.blob.core.windows.net should return a private 10.x IP through the privatelink CNAME.

```bash
# from App Service Kudu console or a VM in the VNet
nslookup stappdata.blob.core.windows.net
az network private-dns link vnet list -g rg-net -z privatelink.blob.core.windows.net -o table
```

4. Fix: link the privatelink.blob.core.windows.net zone to the VNet the app uses (or the hub with the DNS resolver), add endpoints for every sub-resource, enable VNet integration with route-all.
5. Prevent: deploy private endpoints and DNS zone groups together in IaC, and use Azure Policy to create DNS records automatically.

Wrong answer: re-enabling public access "temporarily", which tends to become permanent.

### Your team wants to run nightly batch jobs that process 500 GB of files. Which Azure services would you choose?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/container-apps/jobs -->
Clarify requirements first: how long the processing takes, whether it parallelises per file, language and dependencies, deadline (must finish by 6 a.m.), and cost sensitivity.

Options:

- Azure Container Apps jobs: run containers to completion on a schedule or event, with parallelism. Good default for containerised batch work with no cluster to manage; pay only while running.
- Azure Batch: large-scale parallel and HPC workloads with pools of VMs, including Spot VMs and task dependencies. Good for compute-heavy processing (rendering, simulations).
- Azure Functions with Durable Functions fan-out: fine for many small units of work, but watch execution time limits and memory per instance.
- Data-oriented processing (Spark): Azure Databricks or Microsoft Fabric when transformations are analytic (joins, aggregations) over large datasets in Parquet or Delta.
- Azure Data Factory or Fabric pipelines to orchestrate copy and transform steps across systems.

A reasonable design for "parse 10,000 files and load into SQL":

1. Files land in Blob storage; a schedule starts a Container Apps job.
2. A coordinator lists files and enqueues one message per file into Service Bus.
3. An event-driven Container Apps job scales out on queue length and processes files in parallel.
4. Results are bulk inserted into SQL; failures dead-letter for replay.

```bash
az containerapp job create -n job-parse -g rg-batch --environment cae-batch \
  --trigger-type Event --replica-timeout 1800 --parallelism 20 \
  --image crbatch.azurecr.io/parser:2.1 --min-executions 0 --max-executions 50 \
  --scale-rule-name sbq --scale-rule-type azure-servicebus \
  --scale-rule-metadata queueName=files messageCount=5 namespace=sb-batch
```

Trade-offs: Spot capacity cuts cost but requires checkpointing; Spark adds power and complexity.

### An AKS cluster upgrade is required because the Kubernetes version is going out of support. How do you do it safely?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/azure/aks/upgrade-aks-cluster -->
1. Prepare:
- Read the Kubernetes and AKS release notes for removed APIs; scan manifests and Helm charts for deprecated API versions (kubectl deprecations tooling, or AKS's upgrade insights that block upgrades when deprecated APIs are in use).
- Ensure workloads tolerate node drains: at least two replicas, PodDisruptionBudgets that allow at least one disruption, readiness probes, and graceful shutdown.
- Check subnet IP capacity for surge nodes.
2. Test: upgrade a staging cluster with the same add-ons and charts first and run regression tests.
3. Upgrade order: control plane first, then node pools one at a time. You can only move one minor version at a time.
4. Use max surge (for example 33 percent) to add new nodes before draining old ones, speeding the upgrade while keeping capacity.
5. Monitor during the upgrade: pod restarts, Pending pods, error rates.
6. Alternatively, blue-green at the node pool level: create a new node pool on the new version, cordon and drain the old pool, then delete it. Or blue-green clusters for the riskiest upgrades.

```bash
az aks get-upgrades -g rg-platform -n aks-prod -o table
az aks upgrade -g rg-platform -n aks-prod --control-plane-only --kubernetes-version 1.33.5
az aks nodepool update -g rg-platform --cluster-name aks-prod -n user1 --max-surge 33%
az aks nodepool upgrade -g rg-platform --cluster-name aks-prod -n user1 --kubernetes-version 1.33.5
```

7. Prevent repeats: configure an auto-upgrade channel (patch or stable) plus node OS auto-upgrade with planned maintenance windows.

Common failure: a PDB with minAvailable equal to replicas blocks drains forever.

### A penetration test finds that your App Service API can be reached directly, bypassing Front Door and its WAF. How do you fix it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/frontdoor/origin-security -->
The finding means the origin accepts traffic from anywhere, so attackers can skip WAF rules, rate limits and geo-filters.

Fix options, strongest first:

1. Private Link origin (Front Door Premium): Front Door connects to the app through a private endpoint, and you disable public network access on the App Service. Nothing on the internet can reach the origin directly.
2. Access restrictions on App Service: allow only the AzureFrontDoor.Backend service tag and additionally require the X-Azure-FDID header to equal your Front Door profile's ID. The header check matters because the service tag covers every Front Door customer, so another tenant's Front Door could still reach you.
3. Also lock down the SCM (Kudu) site, which has its own access restrictions, and disable basic authentication publishing credentials.

```bash
az webapp config access-restriction add -g rg-orders -n app-orders-api --priority 100 \
  --rule-name frontdoor-only --service-tag AzureFrontDoor.Backend \
  --http-header x-azure-fdid=<front-door-id>
az webapp config access-restriction set -g rg-orders -n app-orders-api --use-same-restrictions-for-scm-site false
az resource update -g rg-orders -n scm --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies \
  --parent sites/app-orders-api --set properties.allow=false
```

Verify: curl the azurewebsites.net hostname directly and expect 403; requests through Front Door succeed.

Prevent: make origin lockdown part of the Bicep module for every Front Door origin, and add an Azure Policy audit for apps with unrestricted public access.

### Your company needs a single place to see and enforce compliance (allowed regions, encryption, tagging) across 60 subscriptions. What do you set up?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/governance/policy/concepts/initiative-definition-structure -->
1. Structure: organise subscriptions under management groups that reflect policy needs (platform, corp, online, sandbox). Assign policies at management group level so new subscriptions inherit them automatically.
2. Policy as code: keep definitions, initiatives and assignments in a Git repo and deploy them with a pipeline (for example the Enterprise Policy as Code tooling or Bicep/Terraform). Changes go through pull requests.
3. Initiatives:
- Microsoft cloud security benchmark (default in Defender for Cloud) for broad security posture.
- Custom initiative for company rules: allowed locations (Deny), required tags (Deny or Modify with inheritance), storage public access disabled (Deny), diagnostic settings (DeployIfNotExists), Defender plans enabled (DeployIfNotExists).
- Regulatory initiatives (ISO 27001, PCI DSS) if relevant.
4. Rollout: start new rules in Audit, review the compliance dashboard, fix or exempt (with expiry dates and justification), then switch to Deny. Use remediation tasks for Modify and DeployIfNotExists.
5. Visibility: Policy compliance dashboard, Defender for Cloud regulatory compliance view, and Azure Resource Graph queries for custom reports.

```kusto
policyresources
| where type == "microsoft.policyinsights/policystates"
| where properties.complianceState == "NonCompliant"
| summarize count() by tostring(properties.policyDefinitionName), subscriptionId
| order by count_ desc
```

Trade-off: strict Deny policies protect production but can frustrate developers; give sandbox subscriptions looser rules with budget caps.

### A memory leak in your ASP.NET Core app on App Service causes restarts every few hours. How do you diagnose it in production?
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/dotnet/core/diagnostics/debug-memory-leak -->
1. Observe: App Service memory working set metric grows steadily per instance until the instance recycles; Application Insights shows performance counters (private bytes, GC heap size) and possibly OutOfMemoryException.
2. Short-term mitigation: scale out or up to buy time, and enable auto-heal rules to recycle an instance gracefully before it hits the limit (for example private bytes over a threshold), so users see fewer errors.
3. Collect evidence:
- Use the "Diagnose and solve problems" memory analysis or collect a memory dump through the Diagnostic Tools blade when memory is high.
- On Linux or containers, use dotnet-counters to watch GC heap size and gen 2 counts, and dotnet-gcdump or dotnet-dump to capture the heap.
4. Analyse the dump in Visual Studio or dotnet-dump analyze: find which types dominate retained memory and their GC roots.
5. Common culprits:
- Static or singleton caches that grow without bounds (dictionaries keyed by user or request).
- Event handlers subscribed on singletons by scoped objects, which keeps them alive.
- HttpClient created per request without disposal, or undisposed streams and DbContexts.
- Large object heap fragmentation from big byte arrays (use ArrayPool or streaming).
- IMemoryCache without size limits or expirations.

```bash
dotnet-counters monitor --process-id 1 --counters System.Runtime
dotnet-gcdump collect --process-id 1 -o /home/dumps/app.gcdump
```

6. Fix, then verify memory is flat under a load test.
7. Prevent: memory-based alerts, load and soak tests in CI before release.

### You must store files uploaded by users, scan them for malware, and serve them via CDN. Design it.
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/defender-for-cloud/defender-for-storage-malware-scan -->
1. Upload path: the API authenticates the user and returns a short-lived user delegation SAS with create permission for a single blob name in an "incoming" container. The browser uploads directly to Blob storage, so large files never pass through your servers.
2. Scanning: enable Defender for Storage malware scanning on upload. It scans each new blob and publishes a result through Event Grid and blob index tags.
3. Processing: an Event Grid subscription on scan results triggers a Function. Clean files are copied to a "clean" container (and maybe resized or transcoded); malicious files are moved to a quarantine container and the security team is alerted.
4. Serving: Azure Front Door with caching in front of the "clean" container. Keep the storage account private and use a Private Link origin, or serve via short-lived SAS URLs if files are private per user.
5. Data: store metadata (owner, status, scan result) in SQL or Cosmos DB. Lifecycle policies move old files to Cool tier.
6. Security: CORS on storage limited to your domain; maximum upload size enforced in the SAS scope and API; content type validated, and files served with Content-Disposition attachment for untrusted types to avoid stored XSS.

```text
Browser --SAS PUT--> stuploads/incoming --Defender scan--> Event Grid
   --> Function: clean? copy to /clean : move to /quarantine + alert
Front Door (cache, WAF) --Private Link--> stuploads/clean
```

Trade-off: until the scan completes, files must not be served; the UI should show "processing".

### A teammate proposes putting all microservices in one huge AKS cluster shared by dev, test and prod. What is your view?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/aks/operator-best-practices-cluster-isolation -->
Answer with the trade-offs rather than a flat no.

Arguments for a shared cluster: lower cost (one control plane, better bin-packing), fewer clusters to upgrade, central platform tooling.

Arguments against mixing production with non-production:

- Blast radius: a bad admission webhook, CRD upgrade, misconfigured network policy or a runaway dev workload exhausting node or API server capacity can take down production.
- Upgrades: you cannot test a Kubernetes version upgrade on non-production first if they are the same cluster.
- Security: developers often need broad access to dev namespaces; namespace isolation is a soft boundary, and container escapes or over-broad RBAC put production at risk.
- Compliance: auditors usually require production isolation.
- Noisy neighbours and different scaling patterns.

Recommended approach:

1. Separate production and non-production clusters (often separate subscriptions too).
2. Inside each cluster, use namespaces per team or service with RBAC, ResourceQuotas, LimitRanges, NetworkPolicies and Pod Security admission.
3. Use separate node pools for system components and for special workloads (GPU, high memory).
4. Manage clusters consistently with GitOps (Flux or Argo CD) and IaC so multiple clusters are cheap to operate.
5. Consider AKS Automatic or Container Apps for teams that do not need full Kubernetes.

```text
aks-nonprod (dev, test namespaces, spot node pool)
aks-prod    (prod namespaces, zone-spread, PDBs, Standard tier SLA)
```

Hard multi-tenancy for untrusted tenants needs separate clusters, or at minimum sandboxed runtimes such as Kata-based pod sandboxing.

### A partner's firewall only allows a fixed IP, but your Container Apps outbound IP keeps changing. How do you solve it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/container-apps/use-azure-firewall -->
By default, outbound traffic from many PaaS services uses shared, changeable addresses, so partners cannot allow-list them.

Solution: give the workload a dedicated egress path with static public IPs.

1. Deploy the Container Apps environment into your own VNet using the workload profiles environment type.
2. Attach a NAT gateway with a static public IP (or prefix) to the environment's subnet. All outbound internet traffic now leaves from that IP.
3. Alternatively, route outbound traffic through Azure Firewall in a hub via a user-defined route; the firewall's public IP becomes the egress address and you also gain FQDN filtering and logs.
4. Give the partner the static IP (or the IP prefix, which leaves room to add addresses later).

```bash
az network public-ip create -g rg-net -n pip-egress --sku Standard --allocation-method Static
az network nat gateway create -g rg-net -n nat-cae --public-ip-addresses pip-egress
az network vnet subnet update -g rg-net --vnet-name vnet-apps -n snet-cae --nat-gateway nat-cae
```

Equivalent patterns: App Service with VNet integration and route-all plus NAT gateway; Functions on Flex Consumption or Premium with VNet integration.

Verify: call an IP echo service from inside the app and confirm the address.

Trade-offs: NAT gateway is simple and cheap; Azure Firewall costs more but gives control. Also consider SNAT port limits: a NAT gateway provides many more ports than default outbound access, which also fixes intermittent connection failures to the partner under load.

### Developers complain that local development needs many Azure secrets copied into appsettings files. How do you improve the developer experience securely?
<!-- level: basic; kind: scenario; ref: https://learn.microsoft.com/dotnet/azure/sdk/authentication/local-development-dev-accounts -->
Goal: no secrets on laptops, and local code paths identical to production.

1. Use identity-based access everywhere: in Azure the app uses a managed identity; locally, DefaultAzureCredential uses the developer's own sign-in (Visual Studio, Azure CLI or azd). Grant a developers Entra group data-plane roles on dev resources (Storage Blob Data Contributor, Service Bus Data Owner, Key Vault Secrets User, a contained SQL user for the group).
2. Remove connection strings with keys; configure only endpoints (account URIs, namespaces, SQL server names) which are not secrets.
3. For third-party secrets (payment API sandbox keys), read them from a dev Key Vault via the configuration provider, or use dotnet user-secrets, which keeps them outside the repo.
4. Use local emulators where they exist: Azurite for Storage, the Cosmos DB emulator, the Service Bus emulator, SQL Server in a container. Aspire can orchestrate these automatically.
5. Add secret scanning in pre-commit hooks and the repo.

```bash
az login
dotnet user-secrets set "Payments:SandboxKey" "sk_test_..." --project src/Orders.Api
```

```json
{ "Storage": { "Uri": "https://stordersdev.blob.core.windows.net" },
  "ServiceBus": { "Namespace": "sb-orders-dev.servicebus.windows.net" } }
```

Common wrong answer: sharing a single service principal secret among the team; it is unattributable and leaks easily.

### A global e-commerce site needs low latency in India, Europe and the US. Design the data layer.
<!-- level: advanced; kind: scenario; ref: https://learn.microsoft.com/azure/cosmos-db/distribute-data-globally -->
Start by splitting data by access pattern, because one approach rarely fits all.

1. Product catalogue (read-heavy, changes rarely): replicate globally. Cosmos DB with regions in all three geographies, reads served from the nearest region, writes in one region, Session consistency. Add HybridCache or Redis per region and Front Door caching for public product pages.
2. User sessions and carts (per-user, latency-sensitive, writes everywhere): Cosmos DB with multi-region writes, partitioned by userId. Conflicts are rare because one user is usually in one region; use last-writer-wins or custom merge.
3. Orders and payments (must be strongly consistent, money involved): either a single write region with geo-replicated reads (Azure SQL with failover group or Cosmos DB single-write region), accepting cross-region latency at checkout, or a home-region model where each customer's orders live in their region (data residency often requires this anyway).
4. Search: Azure AI Search replicas per region, fed from the catalogue change feed.
5. Analytics: change feed into a central analytics store.

```csharp
var client = new CosmosClient(endpoint, credential, new CosmosClientOptions
{
    ApplicationRegion = Environment.GetEnvironmentVariable("REGION"),   // nearest first
    ConsistencyLevel = ConsistencyLevel.Session
});
```

Trade-offs to state: multi-region writes reduce latency but bring conflict handling and higher cost; strong global consistency increases write latency. Data residency laws (for example, payment data rules in India) may override pure latency optimisation.

### A Service Bus dead-letter queue has 50,000 messages after a downstream outage. How do you recover?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/service-bus-messaging/service-bus-dead-letter-queues -->
1. Stop the bleeding: confirm the downstream dependency is healthy again; otherwise replayed messages dead-letter again.
2. Understand why messages dead-lettered: read DeadLetterReason and DeadLetterErrorDescription properties. MaxDeliveryCountExceeded during the outage means they are probably valid and replayable. Reasons like a deserialisation failure mean code or data issues that need fixing first.
3. Check business validity: are some messages now obsolete (an order cancelled since, prices changed)? Can the handler process them safely now (idempotent, checks current state)?
4. Replay in a controlled way: a small tool (or Service Bus Explorer for small numbers) that receives from the DLQ, re-sends to the main queue preserving MessageId and properties, then completes the DLQ message. Throttle replay so you do not overload the recovering dependency.
5. Monitor the main queue and DLQ during replay.

```csharp
var receiver = client.CreateReceiver("invoices", new ServiceBusReceiverOptions { SubQueue = SubQueue.DeadLetter });
var sender = client.CreateSender("invoices");
while (await receiver.ReceiveMessagesAsync(100, TimeSpan.FromSeconds(5)) is { Count: > 0 } batch)
{
    foreach (var m in batch)
    {
        if (m.DeadLetterReason != "MaxDeliveryCountExceeded") continue;   // leave for manual review
        await sender.SendMessageAsync(new ServiceBusMessage(m));          // copies body + properties
        await receiver.CompleteMessageAsync(m);
    }
    await Task.Delay(500);   // pace the replay
}
```

6. Prevent: retry with backoff inside the handler for transient errors, a circuit breaker that pauses the processor during dependency outages, and alerts on DLQ count.

### How would you migrate a classic ASP.NET (.NET Framework) app running on IIS VMs to Azure?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/dotnet/azure/migration/app-service -->
Choose a migration strategy per app; not everything needs a rewrite.

1. Assess: Azure Migrate's web app discovery and the App Service migration assistant check compatibility (GAC dependencies, COM components, registry access, Windows authentication, local file writes, session state, scheduled tasks).
2. Options:
- Rehost to App Service (Windows, .NET Framework 4.8): fastest PaaS move if compatible. Replace local file writes with Blob storage, in-process session with Redis, Windows auth with Entra ID or keep on VMs if Kerberos is essential.
- Containerise with Windows containers on AKS when there are OS-level dependencies; heavier images and fewer services support Windows containers.
- Keep on Azure VMs (lift and shift) for blockers you cannot remove now, ideally with VM scale sets and Azure Backup.
- Modernise to .NET 8 or later (with Visual Studio's upgrade tooling) to run on Linux App Service or Container Apps, which is cheaper and supported longer, typically incrementally (YARP-based strangler fig pattern routing some routes to the new app).
3. Data: migrate SQL Server to Azure SQL or Managed Instance.
4. Cutover: deploy, test with production-like data, lower DNS TTL, switch, keep the old VMs for rollback for a defined period.

```text
Phase 1: App Service (Windows) + Azure SQL MI      -> leave datacenter
Phase 2: strangler fig to ASP.NET Core on Linux    -> reduce cost, modern stack
```

Common mistake: a big-bang rewrite during migration, which multiplies risk.

### Someone deleted a production resource group. What happens now, and how do you prevent it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/azure-resource-manager/management/delete-resource-group -->
1. Assess impact immediately: identify what was in the group using the Activity Log (the delete operation lists resources), IaC definitions and Azure Resource Graph history. Declare an incident.
2. Recover what can be recovered:
- Key Vault: recover from soft delete (if purge protection was on, it cannot have been purged).
- Storage accounts: deleted storage accounts can be recovered within a limited window if the name is not reused (via the portal or support).
- Azure SQL: deleted databases can be restored from automatic backups if the server still exists; if the logical server itself was deleted, involve Microsoft support quickly. Long-term retention and geo-backups may help.
- VMs: restore from Azure Backup (the Recovery Services vault should live in a different resource group, otherwise it is gone too).
- App Service: redeploy from IaC and CI/CD; restore app content from backups if any.
3. Rebuild infrastructure from Bicep or Terraform, restore data, reconnect DNS and secrets.
4. Find the cause in the Activity Log (caller identity, IP, time).

Prevention:

- CanNotDelete locks on production resource groups.
- No standing Owner or Contributor; PIM with approvals.
- Pipelines with scoped permissions, not subscription-wide.
- Backups and vaults in a separate resource group or subscription, immutable and with soft delete.
- Infrastructure as code for everything, so rebuilding is a pipeline run.
- Deployment stacks with deny settings to prevent out-of-band deletes.

```bash
az monitor activity-log list --offset 2d --query "[?operationName.value=='Microsoft.Resources/subscriptions/resourceGroups/delete'].{who:caller,when:eventTimestamp}"
```

### Your API is protected by Entra ID, but a new mobile client gets 401 errors with a valid token. How do you debug it?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/entra/identity-platform/access-tokens -->
A 401 with a "valid" token usually means the token is valid for something else.

1. Observe: enable JwtBearer logging (Microsoft.AspNetCore.Authentication at Debug level) or read the WWW-Authenticate response header; it often says exactly what failed: invalid audience, invalid issuer, signature key not found, or token expired.
2. Decode the token (locally, with jwt.ms or a debugger) and check the claims:
- aud: must match the API's App ID URI or client ID that the API expects. A common bug is the client requesting a token for Microsoft Graph (aud 00000003-...) instead of the API scope.
- iss: v1 tokens (sts.windows.net) versus v2 tokens (login.microsoftonline.com/.../v2.0). Set accessTokenAcceptedVersion to 2 in the API's app manifest or configure valid issuers.
- tid: a token from another tenant when the API is single-tenant.
- scp or roles: present but the API's authorization policy requires a different scope or app role (that would usually be 403, but custom handlers sometimes return 401).
- exp and clock skew on the device.
3. Fix the client: request the correct scope, for example api://orders-api/Orders.Read, and ensure admin or user consent was granted for it.

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("OrdersRead", p => p.RequireScopeOrAppPermission(["Orders.Read"], ["Orders.Read.All"]));
```

4. Prevent: integration tests that obtain real tokens for each client type, and documented scopes per client.

### How would you implement a blue-green or canary release for a microservice on Azure Container Apps?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/container-apps/revisions -->
Container Apps supports this natively through revisions and traffic splitting.

1. Set the app to multiple revision mode. Each deployment with a changed template creates a new immutable revision with its own suffix and optional revision label.
2. Deploy the new image as a new revision with 0 percent traffic. Labels give it a stable URL (for example orders-api---green.<env-domain>), so you can run smoke and integration tests against it before users see it.
3. Canary: shift 5 percent, then 25, then 50 and 100 percent while watching error rate and latency per revision in Application Insights (the revision name is a dimension).
4. Blue-green: switch 100 percent at once after tests pass; the old revision remains active for instant rollback.
5. Roll back by moving traffic back to the old revision; deactivate old revisions afterwards to save resources.

```bash
az containerapp revision set-mode -n orders-api -g rg-orders --mode multiple
az containerapp update -n orders-api -g rg-orders --image crorders.azurecr.io/orders-api:1.5.0 \
  --revision-suffix v150
az containerapp revision label add -n orders-api -g rg-orders --label green --revision orders-api--v150
az containerapp ingress traffic set -n orders-api -g rg-orders \
  --revision-weight orders-api--v149=90 orders-api--v150=10
```

Considerations: both revisions share databases and queues, so schema and message changes must be backward compatible; queue consumers in both revisions will both process messages. Automate the progression and rollback in the pipeline with health gates rather than manual steps.

### Your team must choose between Azure SQL Database and Cosmos DB for a new multi-tenant SaaS product. How do you decide?
<!-- level: intermediate; kind: scenario; ref: https://learn.microsoft.com/azure/architecture/guide/multitenant/approaches/storage-data -->
Decide from data shape, access patterns, scale, consistency and team skills, not hype.

Choose Azure SQL Database when:

- Data is relational with integrity constraints (invoices, line items, accounts), and you need joins, ad-hoc reporting and transactions across many entities.
- The team knows SQL and EF Core well.
- Scale is moderate, or Hyperscale and elastic pools can cover it. Tenancy options: shared database with TenantId and row-level security, database per tenant in elastic pools, or sharding with the elastic database tools.

Choose Cosmos DB when:

- Access is by key with predictable patterns (get tenant profile, list user events) and must stay at single-digit milliseconds at very high scale.
- You need global distribution or multi-region writes.
- Schema varies per tenant or evolves rapidly.
- Tenancy fits a partition key per tenant (hierarchical keys for large tenants).

Also consider PostgreSQL flexible server (relational plus JSONB and extensions) as a middle ground.

```text
Decision for a B2B invoicing SaaS with reporting:
  Azure SQL, database-per-tenant in elastic pools (isolation, per-tenant restore)
  Cosmos DB for high-volume audit/event data keyed by tenant
```

Trade-offs to mention: Cosmos DB costs are tied to RU usage, so inefficient queries cost money directly; Azure SQL scaling is more vertical. Mixing both (polyglot persistence) is fine when justified, but each store adds operational overhead.
