## 9. Messaging and integration

### Azure Service Bus: queues and topics
<!-- level: basic; ref: https://learn.microsoft.com/azure/service-bus-messaging/service-bus-messaging-overview -->
Service Bus is Azure's enterprise message broker. It decouples producers from consumers so that spikes, slow consumers or downstream outages do not break the sender.

- Queues: point-to-point. Each message is processed by one competing consumer. Use for commands such as "generate invoice for order 42".
- Topics and subscriptions: publish/subscribe. A message sent to a topic is copied to every subscription, each with optional SQL or correlation filters. Use when several services react to the same business event.

Reliability features: peek-lock delivery (the message is locked while you process it and deleted only when you complete it), dead-letter queues, duplicate detection, scheduled messages, message deferral, transactions across entities, and sessions for ordered processing of related messages.

Tiers: Standard (shared, pay per operation) and Premium (dedicated messaging units, predictable latency, private endpoints, larger messages, availability zones, geo-replication).

```bash
az servicebus namespace create -g rg-orders -n sb-orders-prod --sku Premium --capacity 1
az servicebus queue create -g rg-orders --namespace-name sb-orders-prod -n invoices \
  --max-delivery-count 10 --lock-duration PT1M --enable-dead-lettering-on-message-expiration true
az servicebus topic create -g rg-orders --namespace-name sb-orders-prod -n order-events
az servicebus topic subscription create -g rg-orders --namespace-name sb-orders-prod \
  --topic-name order-events -n shipping
```

- Pitfall: at-least-once delivery means handlers must be idempotent.
- Interview tip: queues for commands, topics for events.

### Service Bus in .NET: processors, sessions and dead-lettering
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/service-bus-messaging/service-bus-dead-letter-queues -->
The Azure.Messaging.ServiceBus package provides ServiceBusSender for sending and ServiceBusProcessor for receiving with built-in concurrency, lock renewal and error handling. ServiceBusClient owns the AMQP connection and should be a singleton.

Message flow under peek-lock: you receive a message, process it, then complete it. If processing throws, the message is abandoned and redelivered; after MaxDeliveryCount attempts it moves to the dead-letter queue (DLQ) automatically. You can also dead-letter explicitly for messages you know will never succeed (poison or invalid data). Sessions guarantee FIFO for messages sharing a SessionId, such as all events of one order.

```csharp
await using var client = new ServiceBusClient("sb-orders-prod.servicebus.windows.net", new DefaultAzureCredential());

await client.CreateSender("invoices").SendMessageAsync(new ServiceBusMessage(BinaryData.FromObjectAsJson(cmd))
{ MessageId = cmd.OrderId, ContentType = "application/json" });   // MessageId enables duplicate detection

var processor = client.CreateProcessor("invoices", new ServiceBusProcessorOptions
{ MaxConcurrentCalls = 8, AutoCompleteMessages = false, MaxAutoLockRenewalDuration = TimeSpan.FromMinutes(10) });

processor.ProcessMessageAsync += async args =>
{
    var cmd = args.Message.Body.ToObjectFromJson<InvoiceCommand>();
    if (cmd is null) { await args.DeadLetterMessageAsync(args.Message, "InvalidPayload", "Body could not be parsed"); return; }
    await invoices.CreateAsync(cmd, args.CancellationToken);
    await args.CompleteMessageAsync(args.Message);
};
processor.ProcessErrorAsync += e => { logger.LogError(e.Exception, "SB error {Source}", e.ErrorSource); return Task.CompletedTask; };
await processor.StartProcessingAsync();
```

- Pitfall: nobody monitors the DLQ; alert on dead-lettered message count and build a replay tool.

### Azure Event Grid
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/event-grid/overview -->
Event Grid is a fully managed event routing service. Publishers emit lightweight events ("something happened") and Event Grid pushes them to subscribers with filtering, retries and dead-lettering. It is designed for reactive, event-driven architectures with high fan-out.

Sources:

- System topics: Azure services publish events automatically, for example Blob created, resource group changes, Key Vault secret near expiry, ACR image pushed.
- Custom topics and domains: your applications publish their own events, in CloudEvents 1.0 or the Event Grid schema.
- Namespaces: a newer model that adds pull delivery and an MQTT broker for IoT scenarios.

Handlers include Azure Functions, webhooks, Service Bus queues and topics, Event Hubs, and Storage queues. Delivery is at-least-once with exponential retry for up to 24 hours by default, then dead-lettering to a blob container if configured.

```bash
az eventgrid event-subscription create -n on-invoice-upload \
  --source-resource-id $(az storage account show -n stinvoices -g rg-orders --query id -o tsv) \
  --endpoint-type azurefunction \
  --endpoint /subscriptions/<sub>/resourceGroups/rg-orders/providers/Microsoft.Web/sites/func-orders/functions/OnInvoiceUploaded \
  --included-event-types Microsoft.Storage.BlobCreated \
  --subject-begins-with /blobServices/default/containers/invoices/
```

- Pitfall: events are notifications, not commands with guaranteed single processing; handlers must be idempotent and should fetch the latest state.
- Interview tip: Event Grid pushes discrete events; Event Hubs stores a stream you pull.

### Azure Event Hubs
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/event-hubs/event-hubs-about -->
Event Hubs is a big-data streaming platform that ingests millions of events per second, such as telemetry, clickstreams and logs. Unlike a queue, events are not deleted when read; they are retained for a configured period (and indefinitely via Capture to storage), and each consumer tracks its own position.

Core concepts:

- Partitions: ordered sequences of events. Events with the same partition key land in the same partition, preserving their order. Partition count bounds parallel consumers.
- Consumer groups: independent views of the stream, so analytics and alerting can read the same data at their own pace.
- Checkpointing: consumers store offsets (for example in Blob storage) so they resume after restarts.
- Throughput: throughput units (Standard), processing units (Premium) or dedicated clusters.
- Kafka compatibility: Kafka clients can talk to Event Hubs without code changes.

```csharp
var producer = new EventHubProducerClient("eh-telemetry.servicebus.windows.net", "devices", new DefaultAzureCredential());
using EventDataBatch batch = await producer.CreateBatchAsync(new CreateBatchOptions { PartitionKey = deviceId });
batch.TryAdd(new EventData(BinaryData.FromObjectAsJson(reading)));
await producer.SendAsync(batch);

// consumer: EventProcessorClient with BlobContainerClient for checkpoints
processor.ProcessEventAsync += async args =>
{
    Handle(args.Data);
    await args.UpdateCheckpointAsync();   // checkpoint in batches in real code
};
```

- Pitfall: choosing too few partitions caps throughput; in Standard tier the count cannot be changed later.
- Pitfall: checkpointing after every event is expensive; checkpoint every N events or seconds.

### Choosing between Storage queues, Service Bus, Event Grid and Event Hubs
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/service-bus-messaging/service-bus-azure-and-service-bus-queues-compared-contrasted -->
Messaging choices come up in almost every Azure design review. Ask what the message represents and what guarantees are needed.

- Storage queues: very simple, cheap, huge backlog (up to the storage account capacity), 64 KB messages. No topics, sessions or dead-letter queue built in. Good for simple background work.
- Service Bus: rich broker semantics for business messages. FIFO with sessions, duplicate detection, transactions, DLQ, pub/sub with filters. Good for commands and workflows where losing or reordering a message matters.
- Event Grid: push-based routing of discrete events, especially from Azure resources. Good for "react when X happens" with fan-out to many handlers.
- Event Hubs: streaming ingestion with partitions and replay. Good for telemetry and analytics pipelines.

```text
"Charge the customer for order 42"               -> Service Bus queue
"Order 42 was placed" to 5 interested services   -> Service Bus topic or Event Grid
"Blob uploaded" -> thumbnail function             -> Event Grid system topic
50,000 IoT readings per second -> analytics       -> Event Hubs
Simple fire-and-forget background job, low budget -> Storage queue
```

Services are often combined: Event Grid delivers a blob event into a Service Bus queue for reliable, throttled processing.

- Interview tip: name the key differentiators (ordering, replay, push vs pull, delivery guarantees) rather than reciting features.

### Azure API Management
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/api-management/api-management-key-concepts -->
API Management (APIM) is a gateway and management layer in front of your APIs. It gives consumers one consistent entry point while backends can be App Service, Functions, Container Apps, AKS or on-premises services.

Components:

- Gateway: receives calls, applies policies, forwards to backends.
- Management plane: define APIs (import from OpenAPI), products, subscriptions and versions.
- Developer portal: documentation and self-service subscription keys for API consumers.

Policies are XML pipelines executed per request (inbound, backend, outbound, on-error): JWT validation, rate limiting and quotas, caching, request/response transformation, IP filtering, mocking, and retries. APIM also has AI gateway policies to manage token limits and load balancing for model endpoints.

Tiers range from Consumption (serverless) through Developer, Basic, Standard and Premium, plus the v2 tiers which add faster provisioning and VNet integration. Self-hosted gateways run the gateway in your own Kubernetes clusters.

```xml
<inbound>
  <base />
  <validate-jwt header-name="Authorization" failed-validation-httpcode="401">
    <openid-config url="https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration" />
    <audiences><audience>api://orders-api</audience></audiences>
  </validate-jwt>
  <rate-limit-by-key calls="100" renewal-period="60" counter-key="@(context.Subscription.Id)" />
  <set-backend-service base-url="https://app-orders-api.azurewebsites.net" />
</inbound>
```

- Pitfall: subscription keys identify callers but are not strong authentication; combine with OAuth.

### Azure Logic Apps
<!-- level: basic; ref: https://learn.microsoft.com/azure/logic-apps/logic-apps-overview -->
Logic Apps is a low-code workflow service for integration: connect SaaS apps, on-premises systems and Azure services using a visual designer and hundreds of prebuilt connectors (Office 365, SAP, Salesforce, SQL, Service Bus, SFTP, and many more).

Two hosting models:

- Consumption: multi-tenant, pay per action execution, one workflow per resource. Good for low-volume or occasional automations.
- Standard: single-tenant runtime (built on the Azure Functions host), multiple workflows per app, VNet integration, local development in VS Code, stateful and stateless workflows, and predictable pricing.

Typical use cases: B2B integration (EDI, AS2, X12 with integration accounts), approval workflows, file transfers, syncing data between SaaS systems, and orchestrating business processes that change often and are owned by integration teams rather than developers.

```json
{
  "triggers": {
    "When_a_blob_is_added": { "type": "ApiConnection", "recurrence": { "frequency": "Minute", "interval": 5 } }
  },
  "actions": {
    "Parse_CSV": { "type": "Compose", "inputs": "@body('Get_blob_content')" },
    "Send_to_ServiceBus": { "type": "ServiceBus", "runAfter": { "Parse_CSV": ["Succeeded"] } }
  }
}
```

- Logic Apps or Functions? Logic Apps for connector-heavy orchestration with minimal code; Functions (or Durable Functions) for code-heavy logic, complex algorithms and unit-testable workflows.
- Pitfall: Consumption pricing per action can surprise you with high-volume loops; move hot paths to Standard or code.

## 10. Monitoring and observability

### Azure Monitor: metrics and logs
<!-- level: basic; ref: https://learn.microsoft.com/azure/azure-monitor/overview -->
Azure Monitor is the umbrella platform for observability on Azure. It collects two main kinds of data:

- Metrics: numeric time series (CPU percentage, request count, queue length) stored in a time-series database. Cheap, near real time, kept for 93 days, ideal for dashboards and fast alerts.
- Logs: structured records stored in Log Analytics workspaces and queried with Kusto Query Language (KQL). Rich and flexible; used for investigation and complex alerting.

Other data types include traces (distributed request flows via Application Insights), changes (Change Analysis) and the Activity Log (control-plane events per subscription).

Data sources: platform metrics are automatic; resource logs require diagnostic settings; VMs use the Azure Monitor Agent with data collection rules; applications use OpenTelemetry with the Azure Monitor exporter; containers use Container Insights and managed Prometheus.

```bash
az monitor metrics list --resource $(az webapp show -g rg-orders -n app-orders-api --query id -o tsv) \
  --metric "Http5xx" --interval PT5M --aggregation Total -o table
```

Visualise with Azure Monitor workbooks, Azure dashboards, or Azure Managed Grafana.

- Interview tip: metrics tell you something is wrong; logs and traces tell you why.
- Pitfall: collecting every log category into one workspace is expensive; decide what you actually query.

### Log Analytics and KQL
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/azure-monitor/logs/log-analytics-overview -->
A Log Analytics workspace stores log data in tables (AppRequests, AppExceptions, ContainerLogV2, AzureDiagnostics or resource-specific tables, Heartbeat). You query it with KQL, a read-only, pipe-based language that is fast over huge volumes.

Basic operators to know: where (filter), project (choose columns), summarize (aggregate), extend (computed columns), join, top, order by, render (charts), and bin() for time buckets.

```kusto
// 5xx rate per minute and the top failing operations in the last hour
AppRequests
| where TimeGenerated > ago(1h)
| summarize total = count(), failed = countif(toint(ResultCode) >= 500) by bin(TimeGenerated, 1m)
| extend errorRate = round(100.0 * failed / total, 2)
| render timechart

AppExceptions
| where TimeGenerated > ago(1h)
| summarize count() by ProblemId, OperationName
| top 10 by count_
```

Workspace design: one central workspace per environment or region is common; use table-level retention, Basic and Auxiliary table plans for high-volume, rarely queried logs, and data collection rule transformations to drop noise before ingestion. Access can be controlled per resource (resource-context) or per table.

- Pitfall: cost is driven mainly by ingestion volume (GB per day); verbose debug logging in production is a classic bill shock. Set a daily cap only with alerts, because hitting it silently drops data.

### Application Insights and OpenTelemetry for .NET
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-enable -->
Application Insights is the application performance monitoring feature of Azure Monitor. It shows requests, dependencies (SQL, HTTP, Service Bus), exceptions, distributed traces, live metrics, availability tests and an application map. Data lives in a Log Analytics workspace.

For .NET, the recommended instrumentation is the Azure Monitor OpenTelemetry Distro (Azure.Monitor.OpenTelemetry.AspNetCore). It wires up OpenTelemetry tracing, metrics and logging for ASP.NET Core, HttpClient and SQL client, and exports to Application Insights. Because it is OpenTelemetry, your custom ActivitySource spans and Meter metrics are portable to other backends.

```csharp
builder.Services.AddOpenTelemetry()
    .UseAzureMonitor()   // reads APPLICATIONINSIGHTS_CONNECTION_STRING
    .WithTracing(t => t.AddSource("Orders.Checkout"))
    .WithMetrics(m => m.AddMeter("Orders.Metrics"));

static readonly ActivitySource Source = new("Orders.Checkout");
static readonly Counter<long> OrdersPlaced = new Meter("Orders.Metrics").CreateCounter<long>("orders_placed");

using (var activity = Source.StartActivity("ReserveStock"))
{
    activity?.SetTag("order.id", order.Id);
    await stock.ReserveAsync(order);
}
OrdersPlaced.Add(1, new KeyValuePair<string, object?>("channel", "web"));
```

- Sampling: the distro uses rate or fixed-percentage sampling to control cost; keep it on for high-traffic apps.
- Pitfall: logging full request bodies or personal data into traces creates privacy and cost issues.
- Tip: set the cloud role name (service.name resource attribute) so the application map shows each service clearly.

### Alerts and action groups
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/azure-monitor/alerts/alerts-overview -->
Azure Monitor alerts evaluate a condition and, when it fires, call an action group that notifies people or triggers automation.

Alert rule types:

- Metric alerts: evaluate platform or custom metrics every minute or so, with static or dynamic (machine-learned) thresholds. Fast and cheap.
- Log search alerts: run a KQL query on a schedule and fire on result counts or values. Flexible but slower and charged per rule.
- Activity log alerts: control-plane events such as "someone deleted a resource" or Service Health incidents in your regions.
- Smart detection and Prometheus alert rules for AKS.

Action groups define the responses: email, SMS, push, voice, webhooks, Azure Functions, Logic Apps, ITSM connectors and Automation runbooks. Alert processing rules suppress notifications during maintenance windows or route by severity.

```bash
az monitor action-group create -g rg-ops -n ag-orders-oncall \
  --action email oncall orders-oncall@contoso.com \
  --action webhook pager https://events.pagerduty.com/integration/<key>/enqueue

az monitor metrics alert create -g rg-orders -n api-5xx \
  --scopes $(az webapp show -g rg-orders -n app-orders-api --query id -o tsv) \
  --condition "total Http5xx > 20" --window-size 5m --evaluation-frequency 1m \
  --severity 1 --action ag-orders-oncall
```

- Pitfall: alerting on causes (CPU over 80 percent) instead of symptoms users feel (error rate, latency) creates noisy pages. Alert on SLO burn and keep cause alerts as lower severity.
- Tip: subscribe to Service Health alerts so you learn about platform incidents quickly.

### Diagnostic settings and the Activity Log
<!-- level: basic; ref: https://learn.microsoft.com/azure/azure-monitor/essentials/diagnostic-settings -->
Many teams discover during an incident that the logs they need were never collected. Resource logs (for example Key Vault audit events, SQL query errors, Application Gateway access logs, AKS control-plane logs) are not stored anywhere unless you create a diagnostic setting.

A diagnostic setting routes chosen log categories and metrics from a resource to one or more destinations:

- Log Analytics workspace: query with KQL and alert.
- Storage account: cheap long-term archive for compliance.
- Event Hubs: stream to an external SIEM or third-party tool.
- Partner solutions.

The Activity Log records subscription-level control-plane operations (who changed what and when, policy evaluations, service health). It is kept for 90 days; export it with a subscription diagnostic setting for longer retention.

```bash
az monitor diagnostic-settings create -n to-law \
  --resource $(az keyvault show -n kv-orders --query id -o tsv) \
  --workspace $(az monitor log-analytics workspace show -g rg-ops -n law-prod --query id -o tsv) \
  --logs '[{"category":"AuditEvent","enabled":true}]' \
  --metrics '[{"category":"AllMetrics","enabled":true}]'
```

- Tip: enforce diagnostic settings at scale with built-in Azure Policy DeployIfNotExists initiatives.
- Pitfall: category groups like allLogs on chatty resources can be very expensive; pick categories deliberately.

## 11. Infrastructure as code and DevOps

### ARM templates and Bicep
<!-- level: basic; ref: https://learn.microsoft.com/azure/azure-resource-manager/bicep/overview -->
Infrastructure as code (IaC) defines environments in version-controlled files, so they are reviewable, repeatable and consistent across dev, test and production.

ARM templates are JSON documents that Azure Resource Manager deploys natively. They work but are verbose and hard to read. Bicep is a domain-specific language that compiles to ARM JSON. It has the same capabilities (every new resource type and API version is available immediately), with concise syntax, type safety and IntelliSense in VS Code, automatic dependency detection from references, modules, loops and conditions. There is no state file: Azure itself is the source of truth.

```bicep
param location string = resourceGroup().location
param env string
@allowed(['B1', 'P1v3'])
param sku string = env == 'prod' ? 'P1v3' : 'B1'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-orders-${env}'
  location: location
  sku: { name: sku }
  kind: 'linux'
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: 'app-orders-${env}-${uniqueString(resourceGroup().id)}'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id      // implicit dependency
    httpsOnly: true
    siteConfig: { linuxFxVersion: 'DOTNETCORE|9.0', minTlsVersion: '1.2' }
  }
}
output appHost string = app.properties.defaultHostName
```

```bash
az deployment group create -g rg-orders-dev -f main.bicep -p env=dev
```

- Deployment modes: incremental (default; leaves unknown resources alone) and complete (deletes resources not in the template). Deployment stacks are the safer modern way to manage and clean up resources a template owns.

### Bicep modules, parameters files and what-if
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-what-if -->
Real IaC needs structure and safety checks.

Modules: split templates into reusable units (network, app, database) and compose them in a main file. Modules can come from local files, a private Bicep registry in ACR, or Azure Verified Modules, Microsoft's maintained library of well-architected modules published to the public Bicep registry.

Parameters files: .bicepparam files hold environment values with type checking, and can reference Key Vault secrets with getSecret.

What-if: before applying, what-if shows the exact changes (create, modify, delete, no change) ARM would make. It is the equivalent of terraform plan and belongs in every pipeline for review.

```bicep
// main.bicep
module network 'modules/network.bicep' = {
  name: 'network'
  params: { addressPrefix: '10.20.0.0/16', env: env }
}
module kv 'br/public:avm/res/key-vault/vault:0.11.0' = {
  name: 'kv'
  params: { name: 'kv-orders-${env}', enablePurgeProtection: true }
}
```

```bicep
// prod.bicepparam
using 'main.bicep'
param env = 'prod'
param sqlAdminGroupId = '00000000-0000-0000-0000-000000000000'
```

```bash
az deployment group what-if -g rg-orders-prod -f main.bicep -p prod.bicepparam
az deployment group create -g rg-orders-prod -f main.bicep -p prod.bicepparam
```

- Pitfall: what-if can show noise for properties the service normalises; learn which are harmless rather than ignoring the output.
- Tip: run bicep lint in CI to catch bad practices such as hard-coded locations or secrets in outputs.

### Terraform on Azure
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/developer/terraform/overview -->
Terraform is a popular open-source IaC tool from HashiCorp (also forked as OpenTofu) that many organisations use across multiple clouds. On Azure you mostly use two providers:

- azurerm: hand-written, opinionated resources (azurerm_linux_web_app, azurerm_key_vault).
- azapi: thin layer over the ARM REST API, giving day-zero access to any resource type or property not yet in azurerm.

Terraform tracks what it manages in a state file. On Azure, store state remotely in a Blob storage backend with locking (blob leases), authenticated with Entra ID, and protect it: state can contain secrets.

```hcl
terraform {
  required_providers { azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" } }
  backend "azurerm" {
    resource_group_name  = "rg-tfstate"
    storage_account_name = "sttfstateprod01"
    container_name       = "tfstate"
    key                  = "orders/prod.tfstate"
    use_azuread_auth     = true
  }
}
provider "azurerm" { features {} }

resource "azurerm_service_plan" "plan" {
  name                = "plan-orders-prod"
  resource_group_name = var.rg_name
  location            = var.location
  os_type             = "Linux"
  sku_name            = "P1v3"
}
```

Bicep or Terraform? Bicep is Azure-only, stateless and gets new features immediately; Terraform is multi-cloud with a rich ecosystem and explicit plans, at the cost of managing state.

- Pitfall: changes made in the portal cause drift; run terraform plan regularly and treat drift as an incident.

### CI/CD with GitHub Actions and OpenID Connect
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/developer/github/connect-from-azure -->
The secure way for GitHub Actions to deploy to Azure is workload identity federation with OpenID Connect. GitHub issues a short-lived OIDC token for each workflow run; Entra ID trusts tokens whose subject matches a federated credential (a specific repo, branch or environment) and exchanges it for an Azure access token. No client secrets are stored in GitHub.

Set up: create an app registration or user-assigned managed identity, add a federated credential for the repo, grant it RBAC on the target scope (preferably a resource group, not the subscription), and store only the client ID, tenant ID and subscription ID as variables.

```yaml
name: deploy-orders-api
on: { push: { branches: [main] } }
permissions: { id-token: write, contents: read }
jobs:
  build-deploy:
    runs-on: ubuntu-latest
    environment: production          # approvals + matches federated subject
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with: { dotnet-version: '9.0.x' }
      - run: dotnet test --configuration Release
      - run: dotnet publish src/Orders.Api -c Release -o publish
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
      - uses: azure/webapps-deploy@v3
        with: { app-name: app-orders-api, slot-name: staging, package: publish }
      - run: az webapp deployment slot swap -g rg-orders -n app-orders-api --slot staging
```

- Pitfall: forgetting permissions id-token write causes a confusing login failure.

### Azure Pipelines
<!-- level: basic; ref: https://learn.microsoft.com/azure/devops/pipelines/get-started/what-is-azure-pipelines -->
Azure Pipelines (part of Azure DevOps) is a CI/CD service that builds, tests and deploys any language to any target. Many enterprises use it alongside Azure Boards and Azure Repos.

Concepts:

- YAML pipelines stored in the repo, organised as stages, jobs and steps.
- Agents: Microsoft-hosted (fresh VM per job) or self-hosted; Managed DevOps Pools provide Azure-managed private agent pools inside your VNet.
- Service connections: authenticate to Azure, ideally with workload identity federation instead of secrets.
- Environments: deployment targets with approvals, checks (business hours, required template, Azure Monitor gates) and deployment history.
- Templates: reusable stage, job and step templates to standardise pipelines across teams.
- Artifacts: pipeline artifacts and Azure Artifacts feeds for NuGet, npm and other packages.

```yaml
trigger: [main]
stages:
- stage: Build
  jobs:
  - job: build
    pool: { vmImage: ubuntu-latest }
    steps:
    - task: UseDotNet@2
      inputs: { version: '9.0.x' }
    - script: dotnet publish src/Orders.Api -c Release -o $(Build.ArtifactStagingDirectory)
    - publish: $(Build.ArtifactStagingDirectory)
      artifact: api
- stage: Prod
  dependsOn: Build
  jobs:
  - deployment: deploy
    environment: orders-prod          # approvals configured on the environment
    strategy:
      runOnce:
        deploy:
          steps:
          - task: AzureWebApp@1
            inputs: { azureSubscription: sc-orders-prod, appName: app-orders-api, package: $(Pipeline.Workspace)/api }
```

- Pitfall: classic (UI-defined) release pipelines are hard to review; prefer YAML.

### Azure Developer CLI and Aspire
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/developer/azure-developer-cli/overview -->
Two tools shorten the path from code to a running Azure environment for .NET developers.

The Azure Developer CLI (azd) works with templates that bundle application code, infrastructure (Bicep or Terraform) and an azure.yaml describing services. Commands map to the developer workflow: azd init, azd provision (create infrastructure), azd deploy (push code), azd up (both), azd pipeline config (generate a CI/CD pipeline with federated credentials) and azd down.

Aspire (formerly .NET Aspire) is an opinionated stack for building distributed apps. An AppHost project describes your services and their dependencies in C#, and Aspire runs everything locally with a dashboard showing logs, traces and metrics. Service defaults wire up OpenTelemetry, health checks and resilience. azd understands the Aspire app model and can deploy it to Azure Container Apps, generating the infrastructure for you.

```csharp
// AppHost/Program.cs
var builder = DistributedApplication.CreateBuilder(args);
var cache = builder.AddRedis("cache");
var sql = builder.AddAzureSqlServer("sql").AddDatabase("ordersdb");
var api = builder.AddProject<Projects.Orders_Api>("orders-api")
                 .WithReference(sql).WithReference(cache);
builder.AddProject<Projects.Orders_Web>("web").WithReference(api).WithExternalHttpEndpoints();
builder.Build().Run();
```

```bash
azd init        # detects the AppHost
azd up          # provisions Container Apps, ACR, Log Analytics, and deploys
```

- Pitfall: generated infrastructure is a starting point; review SKUs, networking and identity before production.
