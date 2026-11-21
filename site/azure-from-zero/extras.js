/* Glossary: [term, plain definition, chapter slug] */
window.GLOSS = [
['IaaS','Infrastructure as a Service. You rent virtual machines, disks and networks and manage the OS and everything above it.','cloud'],
['PaaS','Platform as a Service. You bring code and data; the provider runs the OS, runtime and scaling. App Service, Functions, Azure SQL.','cloud'],
['SaaS','Software as a Service. Finished software you just use, such as Microsoft 365.','cloud'],
['Serverless','You run code or workflows without choosing or managing servers, and pay per execution. Functions, Logic Apps.','cloud'],
['CapEx','Capital expenditure: buying assets up front, such as servers.','cloud'],
['OpEx','Operational expenditure: paying as you go for services, such as a cloud bill.','cloud'],
['Scale out','Adding more instances to handle load (horizontal scaling). Scale up = a bigger instance.','cloud'],
['Shared responsibility','The split of security duties between Microsoft and you. Data, identities and access are always yours.','cloud'],
['Region','A set of datacenters in one geographic area, such as Central India.','global'],
['Availability zone','A physically separate group of datacenters within a region with independent power, cooling and network.','global'],
['Region pair','Two regions in the same geography linked for sequential updates, prioritised recovery and geo-replication.','global'],
['Geography','A market (India, Europe) that usually defines data-residency boundaries.','global'],
['Latency','The delay for data to travel from one point to another, usually measured in milliseconds.','global'],
['Tenant','Your organisation’s Microsoft Entra directory: the top identity boundary.','hierarchy'],
['Management group','A container for subscriptions so policy and access can be applied to many at once.','hierarchy'],
['Subscription','A billing, access and quota boundary that holds resource groups.','hierarchy'],
['Resource group','A logical folder for resources that share a lifecycle. Deleting it deletes its contents.','hierarchy'],
['Azure Resource Manager','ARM: the management service every Azure request goes through (management.azure.com).','hierarchy'],
['Resource provider','The Azure service behind a resource type, such as Microsoft.Web or Microsoft.Sql.','hierarchy'],
['Control plane','Operations that manage resources: create, configure, delete. Goes through ARM.','hierarchy'],
['Data plane','Operations on a resource’s contents: reading a blob, querying a database, receiving a message.','hierarchy'],
['Tag','A key/value label on a resource for cost tracking and organisation.','hierarchy'],
['Resource lock','CanNotDelete or ReadOnly protection on a resource, RG or subscription, even against Owners.','hierarchy'],
['Microsoft Entra ID','Microsoft’s cloud identity service (formerly Azure Active Directory).','identity'],
['MFA','Multi-factor authentication: proving identity with two or more factors.','identity'],
['Conditional Access','Entra policies that decide access based on signals like user, device, location and risk.','identity'],
['PIM','Privileged Identity Management: time-limited, approved activation of admin roles.','identity'],
['Service principal','The identity of an application inside a tenant, used by software to sign in.','identity'],
['Managed identity','An Entra identity automatically managed by Azure for a resource. No secrets to handle.','identity'],
['RBAC','Role-based access control: access granted by assigning roles to principals at a scope.','identity'],
['Role assignment','A principal + a role definition + a scope.','identity'],
['Least privilege','Give only the access needed, at the smallest scope, for the shortest time.','identity'],
['Key Vault','Azure service for storing secrets, keys and certificates securely.','identity'],
['Key Vault reference','An app setting value like @Microsoft.KeyVault(...) that the platform resolves to the secret at runtime.','identity'],
['Virtual machine','A software computer running on Azure hardware, with its own OS.','compute'],
['VM Scale Set','A group of identical VMs that autoscale together.','compute'],
['Spot VM','Discounted spare-capacity VM that Azure can evict.','compute'],
['App Service plan','The compute (VM size and count) that App Service apps run on.','compute'],
['Deployment slot','A live staging copy of an App Service app that can be swapped into production.','compute'],
['Kudu','The SCM site (<app>.scm.azurewebsites.net) for inspecting files, logs, environment and deployments.','compute'],
['Azure Functions','Serverless, event-triggered code hosting.','compute'],
['Trigger','The event that starts a function or Logic App: HTTP, timer, message, file.','compute'],
['Binding','A declarative connection from a function to another service for input or output.','compute'],
['Flex Consumption','The current serverless Functions plan: fast scale, VNet support, optional always-ready instances.','compute'],
['Cold start','Extra delay when a serverless app starts a new instance after being idle.','compute'],
['Durable Functions','Extension for writing stateful workflows and orchestrations in code.','compute'],
['Container','A packaged app plus its dependencies that runs the same anywhere.','compute'],
['Container Apps','Azure’s serverless container platform with autoscale and revisions.','compute'],
['AKS','Azure Kubernetes Service: managed Kubernetes.','compute'],
['Storage account','The Azure resource that provides Blob, Files, Queue and Table storage.','storage'],
['Blob','Binary large object: any file stored in Blob Storage.','storage'],
['Access tier','Hot, Cool, Cold or Archive: trade-off between storage price and access price.','storage'],
['LRS','Locally redundant storage: 3 copies in one datacenter.','storage'],
['ZRS','Zone-redundant storage: 3 copies across 3 availability zones.','storage'],
['GRS','Geo-redundant storage: LRS locally plus an async LRS copy in the paired region.','storage'],
['SAS token','Shared access signature: a URL token granting limited, time-boxed storage access.','storage'],
['Lifecycle management','Rules that move blobs between tiers or delete them by age.','storage'],
['Data Lake Storage Gen2','Blob Storage with a hierarchical namespace for analytics.','storage'],
['Relational database','Data in tables with fixed columns and relationships, queried with SQL.','databases'],
['NoSQL','Non-relational databases: documents, key-value, graph, column-family.','databases'],
['DTU','Database Transaction Unit: a bundled measure of CPU, memory and IO for Azure SQL.','databases'],
['vCore','Purchasing model where you choose cores and memory separately.','databases'],
['Serverless (database)','Azure SQL compute that scales automatically and can pause when idle.','databases'],
['Point-in-time restore','Restoring a database to any moment within its backup retention period.','databases'],
['Failover group','Azure SQL feature for geo-replicating databases and failing over with a stable connection name.','databases'],
['Cosmos DB','Azure’s globally distributed multi-model NoSQL database.','databases'],
['Request Unit','RU: the currency of Cosmos DB throughput. A 1 KB point read = 1 RU.','databases'],
['Partition key','The property Cosmos DB uses to spread data across partitions.','databases'],
['Consistency level','How fresh reads are vs speed in Cosmos DB: Strong to Eventual (default Session).','databases'],
['VNet','Virtual network: your private network in an Azure region.','networking'],
['Subnet','A range of IP addresses inside a VNet.','networking'],
['CIDR','Notation like 10.0.0.0/24 describing an IP range by its prefix length.','networking'],
['NSG','Network Security Group: prioritised allow/deny rules for subnets or NICs.','networking'],
['Service tag','A named set of Microsoft IP ranges (e.g. Storage, AzureCloud) for use in rules.','networking'],
['UDR','User-defined route: a custom route in a route table that overrides system routing.','networking'],
['VNet peering','Private connection between two VNets over the Microsoft backbone. Not transitive.','networking'],
['VPN Gateway','Encrypted IPsec tunnel between Azure and on-prem or clients.','networking'],
['ExpressRoute','Private dedicated circuit from your network to Azure.','networking'],
['Private endpoint','A network interface with a private IP that connects you to a PaaS resource.','networking'],
['Service endpoint','Lets a subnet reach a PaaS service over the backbone; the service keeps its public IP.','networking'],
['Private DNS zone','DNS zone resolvable only inside linked VNets, e.g. privatelink.database.windows.net.','networking'],
['VNet integration','Lets App Service / Functions make outbound calls into a VNet.','networking'],
['Route All','App setting (vnetRouteAllEnabled) that sends all outbound app traffic, including internet traffic, through the VNet.','networking'],
['NAT Gateway','Gives a subnet static public IP(s) for outbound internet traffic.','networking'],
['SNAT','Source network address translation: rewriting private source IPs to a public IP for outbound calls. Limited ports can be exhausted.','networking'],
['Application Gateway','Regional layer-7 load balancer with optional WAF.','networking'],
['Front Door','Global layer-7 entry point with CDN, WAF and failover.','networking'],
['Azure Firewall','Managed, stateful network firewall service.','networking'],
['Hub and spoke','Network design with a shared hub VNet peered to workload spoke VNets.','networking'],
['Service Bus','Azure’s enterprise message broker.','integration'],
['Queue','Point-to-point message store: each message is processed by one receiver.','integration'],
['Topic','Publish-subscribe entity: each subscription gets a copy of each message.','integration'],
['Subscription (Service Bus)','A named copy-stream of a topic’s messages, optionally filtered.','integration'],
['Peek-lock','Receive mode where the message is locked, then completed, abandoned or dead-lettered.','integration'],
['Lock duration','How long a received message stays locked to one receiver (default 1 min, max 5).','integration'],
['MaxDeliveryCount','Number of delivery attempts before a message is dead-lettered (default 10).','integration'],
['Dead-letter queue','Sub-queue holding messages that could not be processed, with a reason.','integration'],
['Poison message','A message that fails every time it is processed.','integration'],
['Session','Service Bus feature for ordered, grouped processing of related messages.','integration'],
['Event Grid','Push-based event routing service.','integration'],
['Event Hubs','High-throughput event streaming service with partitions and retention.','integration'],
['Logic Apps','Low-code workflow automation service.','integration'],
['Connector','A pre-built integration in Logic Apps or Power Automate (SAP, SQL, Outlook…).','integration'],
['Run history','Logic Apps record of each run with every action’s inputs and outputs.','integration'],
['API Management','Gateway and portal for publishing, securing and monitoring APIs.','integration'],
['APIM policy','XML rule in inbound/backend/outbound/on-error that transforms or controls API calls.','integration'],
['Named value','Reusable APIM setting or secret (can be Key Vault-backed), used as {{name}} in policies.','integration'],
['Zero Trust','Security model: verify explicitly, least privilege, assume breach.','security'],
['Defence in depth','Multiple layers of security so one failure doesn’t expose everything.','security'],
['Defender for Cloud','Microsoft’s cloud security posture and workload protection service.','security'],
['Secure Score','Defender for Cloud’s measure of your security posture.','security'],
['Microsoft Sentinel','Cloud SIEM and SOAR service.','security'],
['SIEM','Security information and event management: collect and correlate security logs.','security'],
['Azure Policy','Service that audits or enforces rules on resource properties.','security'],
['Initiative','A group of Azure Policy definitions assigned together.','security'],
['WAF','Web application firewall: blocks common web attacks.','security'],
['DDoS Protection','Defence against distributed denial-of-service attacks.','security'],
['Secret rotation','Replacing a secret with a new value so the old one stops working.','security'],
['Azure Monitor','Azure’s platform for metrics, logs, alerts and visualisations.','monitoring'],
['Metric','A numeric value sampled over time, such as CPU % or queue length.','monitoring'],
['Log Analytics workspace','The store for logs, queried with KQL.','monitoring'],
['KQL','Kusto Query Language, used in Log Analytics, App Insights, Resource Graph and Data Explorer.','monitoring'],
['Activity Log','Record of control-plane operations: who did what, when.','monitoring'],
['Diagnostic setting','Configuration that sends a resource’s logs and metrics to a workspace, storage or Event Hub.','monitoring'],
['Application Insights','Application performance monitoring for your code.','monitoring'],
['operation_Id','The ID that correlates all telemetry from one logical operation.','monitoring'],
['Sampling','Keeping only a share of telemetry to reduce volume and cost.','monitoring'],
['Alert','A rule that fires when a metric or log condition is met.','monitoring'],
['Action group','The set of notifications and actions an alert triggers.','monitoring'],
['Service Health','Personalised view of Azure incidents and maintenance affecting your resources.','monitoring'],
['Azure CLI','Cross-platform command-line tool (az) for managing Azure.','devops'],
['Cloud Shell','Browser-based shell with Azure tools pre-installed and signed in.','devops'],
['Azure Resource Graph','Service for querying resources across subscriptions with KQL.','devops'],
['Infrastructure as Code','Defining infrastructure in files that can be versioned, reviewed and redeployed.','devops'],
['ARM template','JSON file describing Azure resources for deployment.','devops'],
['Bicep','Azure’s concise IaC language that compiles to ARM templates.','devops'],
['Terraform','HashiCorp’s multi-cloud IaC tool that tracks resources in a state file.','devops'],
['what-if','Preview of the changes a deployment would make, without making them.','devops'],
['CI/CD','Continuous integration / continuous delivery: automated build, test and deploy.','devops'],
['GitHub Actions','GitHub’s workflow automation used for CI/CD.','devops'],
['Run from package','Running an App Service or Function App directly from a read-only zip package.','devops'],
['App settings','Environment variables for App Service and Function Apps, set per app or slot.','devops'],
['Feature flag','A switch to turn functionality on or off without redeploying.','devops'],
['Pay-as-you-go','Paying list price for actual usage with no commitment.','cost'],
['Reservation','1- or 3-year commitment to a resource type for a discount.','cost'],
['Savings plan','1- or 3-year hourly compute spend commitment for a discount across services.','cost'],
['Azure Hybrid Benefit','Using existing Windows Server or SQL Server licences in Azure to reduce cost.','cost'],
['Pricing calculator','Microsoft’s web tool for estimating Azure costs.','cost'],
['Cost Management','Azure’s tools for cost analysis, budgets and alerts.','cost'],
['Budget','A spending limit with alerts at thresholds.','cost'],
['Azure Advisor','Free personalised recommendations for cost, security, reliability and performance.','cost'],
['Egress','Data leaving Azure (to the internet or another region); usually charged.','cost'],
['SLA','Service level agreement: Microsoft’s uptime commitment for a service.','reliability'],
['Composite SLA','The combined SLA of dependent services: multiply them.','reliability'],
['RTO','Recovery time objective: maximum acceptable downtime.','reliability'],
['RPO','Recovery point objective: maximum acceptable data loss, measured in time.','reliability'],
['High availability','Staying up through small failures automatically.','reliability'],
['Disaster recovery','Recovering from major events like a region outage or data loss.','reliability'],
['Transient fault','A temporary error that will likely succeed on retry.','reliability'],
['Exponential backoff','Retrying with increasing waits (1 s, 2 s, 4 s…).','reliability'],
['Jitter','Random variation added to retry delays to avoid synchronised retries.','reliability'],
['Circuit breaker','Pattern that stops calling a failing dependency for a cool-down period.','reliability'],
['Idempotency','Processing the same request more than once gives the same result as once.','reliability'],
['Outbox pattern','Saving outgoing messages in the same DB transaction as the business change, then publishing.','reliability'],
['ETL','Extract, transform, load: clean data before loading it.','data-ai'],
['ELT','Extract, load, transform: load raw data, transform it in the platform.','data-ai'],
['Data Factory','Azure’s data pipeline and orchestration service.','data-ai'],
['Data lake','Cheap, scalable storage for raw and processed data of any format.','data-ai'],
['Microsoft Fabric','Unified SaaS analytics platform with OneLake and Power BI.','data-ai'],
['Databricks','Apache Spark-based analytics and ML platform.','data-ai'],
['Purview','Microsoft’s data governance, catalogue and compliance service.','data-ai'],
['Power BI','Microsoft’s business intelligence and dashboard tool.','data-ai'],
['Microsoft Foundry','Azure platform for building AI apps and agents (formerly Azure AI Foundry).','data-ai'],
['Azure OpenAI','OpenAI models offered through Azure with enterprise controls.','data-ai'],
['RAG','Retrieval-augmented generation: find relevant documents, then have the model answer from them.','data-ai'],
['Embedding','A vector of numbers representing the meaning of text, used for similarity search.','data-ai'],
['Token','A chunk of text that language models read and are billed by.','data-ai'],
['Document Intelligence','Azure AI service that extracts text and fields from documents.','data-ai'],
['Well-Architected Framework','Azure’s five-pillar guide to good workload design.','architecture'],
['Cloud Adoption Framework','Microsoft’s methodology for adopting the cloud across an organisation.','architecture'],
['Landing zone','A pre-configured, governed Azure environment ready for workloads.','architecture'],
['Rehost','Lift and shift: move as-is to IaaS.','architecture'],
['Refactor','Restructure code for the cloud while keeping behaviour.','architecture'],
['Azure Migrate','Hub for discovering, assessing and migrating workloads to Azure.','architecture'],
['Strangler fig','Replacing a legacy system piece by piece behind a stable façade.','architecture'],
['Event-driven architecture','Systems that communicate by publishing and reacting to events.','architecture'],
['Competing consumers','Multiple receivers processing messages from the same queue in parallel.','architecture']
];

/* Hands-on labs. safe: 'read' = read-only, OK to run against real subscriptions; 'sandbox' = creates or changes things: use a free/personal subscription. */
window.LABS = [
{t:'Find yourself in Azure',safe:'read',ch:'hierarchy',goal:'Sign in, see which tenant and subscription you are in, and list subscriptions.',steps:['Open PowerShell and sign in to Azure.','Show the current account and subscription.','List all subscriptions you can see as a table.','Switch to another subscription by name.'],hint:'Everything starts with <code>az login</code>. Account commands live under <code>az account</code>.',sol:`az login
az account show -o table
az account list --query "[].{name:name, id:id, default:isDefault}" -o table
az account set --subscription "<subscription name>"`},
{t:'Inventory a resource group',safe:'read',ch:'hierarchy',goal:'List every resource in one RG with its type and region.',steps:['List resource groups.','Pick one and list its resources as a table showing name, type and location.'],hint:'<code>az group list</code>, then <code>az resource list -g</code> with a <code>--query</code> projection.',sol:`az group list --query "[].{name:name, location:location}" -o table
az resource list -g <rg> --query "[].{name:name, type:type, location:location}" -o table`},
{t:'List every Function App you can see',safe:'read',ch:'compute',goal:'Use Resource Graph to list Function Apps across all subscriptions in one query.',steps:['Install the Resource Graph extension if prompted.','Run a KQL query filtering type microsoft.web/sites where kind contains functionapp.'],hint:'The command is <code>az graph query -q "..."</code>.',sol:`az extension add --name resource-graph
az graph query -q "resources | where type == 'microsoft.web/sites' and kind has 'functionapp' | project name, resourceGroup, location, kind | order by name asc" --first 200 -o table`},
{t:'Read a Function App’s settings safely',safe:'read',ch:'compute',goal:'List setting names (not values) and key runtime settings.',steps:['List only the names of app settings.','Show the worker runtime and extension version.'],hint:'<code>az functionapp config appsettings list</code> returns name/value pairs. Use <code>--query</code> to keep only names, so you never print secrets on screen.',sol:`az functionapp config appsettings list -n <app> -g <rg> --query "[].name" -o tsv
az functionapp config appsettings list -n <app> -g <rg> --query "[?name=='FUNCTIONS_WORKER_RUNTIME' || name=='FUNCTIONS_EXTENSION_VERSION']" -o table`},
{t:'Check outbound networking of an app',safe:'read',ch:'networking',goal:'Find whether an app is VNet-integrated, whether Route All is on, and which outbound IPs it can use.',steps:['Show VNet integration for the app.','Show the Route All setting.','Show possible outbound IPs.'],hint:'Look at <code>az functionapp vnet-integration list</code> and the site config properties. The Route All property name differs by API version: older apps show <code>vnetRouteAllEnabled</code>; newer ones show <code>outboundVnetRouting</code>.',sol:`az functionapp vnet-integration list -n <app> -g <rg> -o table
az functionapp show -n <app> -g <rg> --query "{routeAll:siteConfig.vnetRouteAllEnabled, routeAll2:vnetRouteAllEnabled, outboundRouting:outboundVnetRouting}"
az functionapp show -n <app> -g <rg> --query "possibleOutboundIpAddresses" -o tsv`},
{t:'Prove your egress IP from inside the app',safe:'read',ch:'networking',goal:'See the public IP a partner actually receives, from the app itself.',steps:['Open the Kudu console (Windows) or SSH (Linux) for the app.','Call a public “what is my IP” service.','Compare with the NAT Gateway’s public IP.'],hint:'Kudu: <code>https://&lt;app&gt;.scm.azurewebsites.net</code>. Flex Consumption has no Kudu console; log the result from a small test function instead.',sol:`# Kudu / SSH console:
curl -s https://api.ipify.org

# NAT Gateway public IP (from your PC):
az network nat gateway show -n <natgw> -g <rg> --query "publicIpAddresses[].id" -o tsv
az network public-ip show --ids <public-ip-id> --query ipAddress -o tsv`},
{t:'Check Service Bus subscription health',safe:'read',ch:'integration',goal:'See active and dead-letter message counts for a topic subscription.',steps:['List topics in a namespace.','List subscriptions of a topic.','Show the countDetails of one subscription.'],hint:'Commands are under <code>az servicebus topic subscription</code>. The counts are in <code>countDetails</code>.',sol:`az servicebus topic list -g <rg> --namespace-name <ns> --query "[].name" -o tsv
az servicebus topic subscription list -g <rg> --namespace-name <ns> --topic-name <topic> --query "[].name" -o tsv
az servicebus topic subscription show -g <rg> --namespace-name <ns> --topic-name <topic> -n <sub> --query "{active:countDetails.activeMessageCount, deadLetter:countDetails.deadLetterMessageCount, maxDelivery:maxDeliveryCount, lock:lockDuration}" -o table`},
{t:'Query Application Insights from the command line',safe:'read',ch:'monitoring',goal:'Run a KQL query for failed requests in the last hour.',steps:['Install the application-insights extension.','Run a query against your App Insights resource.'],hint:'<code>az monitor app-insights query --app &lt;name&gt; -g &lt;rg&gt; --analytics-query "..."</code>',sol:`az extension add --name application-insights
az monitor app-insights query --app <appinsights> -g <rg> --analytics-query "requests | where timestamp > ago(1h) and success == false | summarize count() by name, resultCode" -o table`},
{t:'Who changed what? Read the Activity Log',safe:'read',ch:'monitoring',goal:'List control-plane operations on a resource group in the last 24 hours.',steps:['Query the Activity Log for an RG with a time window.','Show operation, caller, status and time.'],hint:'<code>az monitor activity-log list</code> with <code>--offset 1d</code>.',sol:`az monitor activity-log list -g <rg> --offset 1d --query "[].{time:eventTimestamp, op:operationName.localizedValue, who:caller, status:status.localizedValue}" -o table`},
{t:'List Key Vault secret names (not values)',safe:'read',ch:'identity',goal:'See what secrets exist and when they were updated, without revealing values.',steps:['List secrets in a vault, showing name and updated date.','Check who has access to the vault.'],hint:'<code>az keyvault secret list</code> only returns metadata. Never use <code>secret show</code> on a shared screen.',sol:`az keyvault secret list --vault-name <kv> --query "[].{name:name, updated:attributes.updated, enabled:attributes.enabled}" -o table
az role assignment list --scope $(az keyvault show -n <kv> --query id -o tsv) --query "[].{who:principalName, role:roleDefinitionName}" -o table`},
{t:'Build a storage account with Bicep',safe:'sandbox',ch:'devops',goal:'Write a Bicep file, preview it with what-if, deploy, then clean up.',steps:['Create a resource group in your sandbox subscription.','Write main.bicep for a StorageV2 account with TLS 1.2 and public blob access disabled.','Run what-if, then create.','Delete the resource group.'],hint:'Copy the shape from chapter 12. Storage names: 3–24 lowercase letters and digits, globally unique.',sol:`az group create -n rg-learning -l centralindia
# write main.bicep (see chapter 12), then:
az deployment group what-if -g rg-learning -f main.bicep -p name=stlearn$(Get-Random -Maximum 99999)
az deployment group create  -g rg-learning -f main.bicep -p name=stlearn12345
az group delete -n rg-learning --yes --no-wait`},
{t:'Create and dead-letter a Service Bus message',safe:'sandbox',ch:'integration',goal:'See peek-lock, delivery count and the DLQ with your own eyes.',steps:['Create a Standard namespace, a queue with max delivery count 3.','Send a message using Service Bus Explorer in the portal.','Receive it in peek-lock mode three times without completing (abandon).','Look in the dead-letter sub-queue and read the DeadLetterReason.'],hint:'Service Bus Explorer lives in the portal on the queue blade. Abandon = release the lock.',sol:`az group create -n rg-sb-lab -l centralindia
az servicebus namespace create -g rg-sb-lab -n sb-lab-$(Get-Random -Maximum 99999) --sku Standard
az servicebus queue create -g rg-sb-lab --namespace-name <ns> -n orders --max-delivery-count 3
# Portal: Queue > Service Bus Explorer > Send, then Receive (peek-lock) > Abandon x3
# Then: Dead-letter tab > look at DeadLetterReason = MaxDeliveryCountExceeded
az group delete -n rg-sb-lab --yes --no-wait`},
{t:'Your first Python Function',safe:'sandbox',ch:'compute',goal:'Create, run locally and deploy an HTTP-triggered Python function.',steps:['Install Azure Functions Core Tools and Python 3.11+.','func init with the python worker, then func new with an HTTP trigger.','Run locally with func start and call it.','Create a Flex Consumption app and publish.'],hint:'Core Tools commands: <code>func init</code>, <code>func new</code>, <code>func start</code>, <code>func azure functionapp publish</code>.',sol:`func init hello-func --worker-runtime python
cd hello-func
func new --name hello --template "HTTP trigger" --authlevel anonymous
func start   # then open http://localhost:7071/api/hello?name=me

az group create -n rg-func-lab -l centralindia
az storage account create -n stfunclab12345 -g rg-func-lab -l centralindia --sku Standard_LRS
az functionapp create -g rg-func-lab -n func-lab-12345 --storage-account stfunclab12345 --flexconsumption-location centralindia --runtime python --runtime-version 3.11
func azure functionapp publish func-lab-12345
az group delete -n rg-func-lab --yes --no-wait`}
];

/* Troubleshooting drills: scenario + options. ok:true marks the best first move. */
window.DRILLS = [
{t:'Partner sees the wrong IP',ch:'networking',s:'Your Function App is VNet-integrated. Its subnet has a NAT Gateway with a static IP the partner whitelisted. The partner logs show calls coming from a different Azure IP and reject them.',o:[
{t:'Ask the partner to whitelist every IP in possibleOutboundIpAddresses',f:'That works around the design and the list can change. You would lose the point of the NAT Gateway.'},
{t:'Check whether Route All (vnetRouteAllEnabled / outbound internet traffic) is enabled on the app',ok:true,f:'Correct. Without Route All, internet-bound traffic leaves directly from the app’s shared outbound IPs and never reaches the NAT Gateway.'},
{t:'Restart the app',f:'A restart won’t change routing configuration.'},
{t:'Move the app to a bigger plan',f:'Plan size doesn’t affect which IP outbound traffic uses.'}]},
{t:'403 even from the right IP',ch:'networking',s:'Egress is now the whitelisted NAT IP. The partner’s token endpoint works, but every API call returns 403 “Access Denied” as an HTML page, even if you send no token at all.',o:[
{t:'Rewrite the app’s auth code',f:'If a request with no token gets the same 403 as one with a valid token, your token isn’t even being evaluated. Code changes won’t help.'},
{t:'Conclude the block is on the partner side (WAF/whitelist not applied or API access not enabled) and send them evidence: time, source IP, request ID, response',ok:true,f:'Correct. A request with no token getting the same HTML 403 points to a gateway or WAF in front of their API. Give them precise evidence so they can find it in their logs.'},
{t:'Turn off the NAT Gateway',f:'That would bring back the wrong source IP.'},
{t:'Retry 20 times',f:'A 403 is permanent until something changes on their side. Retries add noise.'}]},
{t:'Dead-letter count keeps rising',ch:'integration',s:'A Service Bus topic subscription shows Active = 0 but DeadLetter = 340 and growing. The consumer Function shows as running.',o:[
{t:'Purge the dead-letter queue to clean up',f:'You would destroy the evidence and the business data. Never delete before understanding and recording.'},
{t:'Peek a few dead-lettered messages and read DeadLetterReason and DeadLetterErrorDescription, then match them to the consumer’s exceptions in App Insights',ok:true,f:'Correct. The reason (e.g. MaxDeliveryCountExceeded) plus the consumer’s exception tells you whether it’s bad data (poison) or a downstream failure.'},
{t:'Increase MaxDeliveryCount to 100',f:'That only delays dead-lettering and can block the subscription longer if messages are poison.'},
{t:'Scale out the Function App',f:'More instances failing the same way will dead-letter faster.'}]},
{t:'Function returns 500',ch:'monitoring',s:'An HTTP-triggered function returns 500 Internal Server Error for some requests since this morning’s deployment.',o:[
{t:'Open Application Insights → Failures, pick a failed request and read its exception and operation_Id',ok:true,f:'Correct. That gives the exact exception, stack trace and the dependency calls in the same operation.'},
{t:'Redeploy the same package',f:'Without knowing the cause you may redeploy the bug.'},
{t:'Increase the timeout',f:'A 500 is an unhandled error, not a timeout (that would be different codes or durations).'},
{t:'Check the NSG',f:'A request that reached your code and got a 500 already passed the network.'}]},
{t:'401 through APIM',ch:'integration',s:'SAP calls your API through APIM and gets 401 Unauthorized. Calling the Function directly with its key works.',o:[
{t:'Use APIM’s test console with tracing on and see which inbound policy rejects the call',ok:true,f:'Correct. The trace shows each policy (check-header, validate-jwt, subscription key) and which one returned 401.'},
{t:'Rotate the Function key',f:'The Function works directly, so the problem is in front of it.'},
{t:'Disable APIM',f:'That removes your security layer.'},
{t:'Restart the Function App',f:'The backend isn’t the one returning 401.'}]},
{t:'Random date failures in SQL',ch:'databases',s:'Inserts fail with “Conversion failed when converting date and/or time from character string” (22007), but only for some records, mostly after the 12th of the month.',o:[
{t:'Change the SQL Server language to British',f:'That’s fragile and affects everything else on the server.'},
{t:'Pass the date as a typed parameter (datetime/datetime2) or ISO 8601, instead of building the SQL string',ok:true,f:'Correct. Day > 12 failing is the classic sign of dd/MM text being read as MM/dd.'},
{t:'Retry the insert',f:'The same text fails the same way every time. This is a permanent error.'},
{t:'Increase the DTUs',f:'Performance isn’t the issue.'}]},
{t:'Key Vault reference shows an error',ch:'identity',s:'In the Function App’s Environment variables, the setting that uses @Microsoft.KeyVault(...) shows a red “Key Vault reference error”. The app fails at startup.',o:[
{t:'Paste the secret value directly into the setting',f:'This “fixes” it by bringing back the risk Key Vault removes.'},
{t:'Check that the app has a managed identity, that it has Key Vault Secrets User on the vault, that the vault firewall allows it, and that the secret name matches',ok:true,f:'Correct. Those four cover almost every reference failure. The portal shows the specific error detail when you open the setting.'},
{t:'Recreate the vault',f:'Destructive and unnecessary.'},
{t:'Change the region',f:'Unrelated.'}]},
{t:'New code isn’t running',ch:'devops',s:'The pipeline says deployment succeeded, but the app still behaves like the old version.',o:[
{t:'Check what’s actually deployed: deployment history, the package (Kudu SitePackages or the Flex deployment container) and WEBSITE_RUN_FROM_PACKAGE; confirm you deployed to the right app or slot',ok:true,f:'Correct. Verify the artifact and the target before anything else. Deploying to a staging slot without swapping is a common cause.'},
{t:'Deploy again and again',f:'If the target is wrong, repeating won’t help.'},
{t:'Delete the app',f:'Far too destructive.'},
{t:'Blame caching in the browser',f:'Possible for front ends, but check the server side first.'}]},
{t:'The bill jumped 40%',ch:'cost',s:'This month’s Azure cost is 40% higher than last month’s. Nobody says they changed anything.',o:[
{t:'Open Cost analysis, group by resource and service, compare with last month, and check the Activity Log for new resources or scale changes',ok:true,f:'Correct. Find what grew, then find who or what changed it. Log ingestion and autoscale are frequent culprits.'},
{t:'Delete the biggest resource',f:'You might delete production.'},
{t:'Buy reservations immediately',f:'Understand the change before committing for 1–3 years.'},
{t:'Ignore it until next month',f:'Costs compound. Set a budget alert too.'}]},
{t:'Logic App stuck on one message',ch:'integration',s:'A topic-retry Logic App fails on the same message every run, and other messages queue up behind it.',o:[
{t:'Keep resubmitting the run',f:'A poison message fails forever.'},
{t:'Inspect the run history to see the failing action and input; make the workflow dead-letter (or park and record) permanent failures and continue with the rest',ok:true,f:'Correct. Separate permanent failures from transient ones, record them, and keep the pipeline flowing.'},
{t:'Delete the message silently',f:'You lose a business event with no trace, which leads to wrong conclusions later (“the source never sent it”).'},
{t:'Disable the Logic App',f:'Everything stops.'}]}
];

/* Your systems, simplified from your session notes. Nodes are clickable. */
window.FLOWS = [
{id:'uc',t:'SAP → Unicommerce (UAT)',intro:'An order or stock update leaves SAP, passes through API Management, is forwarded by a Function App, and leaves Azure through a NAT Gateway so Unicommerce sees one whitelisted IP.',nodes:[
{n:'SAP',s:'On-prem / external',d:'The caller. It sends the business payload over HTTPS to a public APIM URL. It knows nothing about your Function App.',ch:'cloud'},
{n:'API Management',s:'Gateway',d:'Receives the call on a path like <code>v3/integration/sap/unicommerce</code>. An inbound <b>check-header</b> policy rejects calls without the agreed header value. Then it forwards to the backend Function App. Debug with the test console and trace.',ch:'integration'},
{n:'Function App (Flex)',s:'Compute',d:'Python/.NET code that forwards SAP bodies to Uniware. Settings come from app settings, ideally Key Vault references. Runs on Flex Consumption: scales to zero, supports VNet integration, no deployment slots.',ch:'compute'},
{n:'Key Vault',s:'Secrets',d:'Holds the Uniware credentials. The app’s managed identity reads them through Key Vault references. Rotate any value that was ever pasted or logged.',ch:'identity'},
{n:'VNet integration + Route All',s:'Networking',d:'The app is integrated with a UAT subnet. <b>Route All</b> must be on, or internet calls skip the VNet and the NAT Gateway. This was the cause of the wrong source IP.',ch:'networking'},
{n:'NAT Gateway',s:'Networking',d:'Attached to the subnet. Every outbound internet call leaves with its static public IP, which is the IP the partner whitelists.',ch:'networking'},
{n:'Unicommerce (Uniware)',s:'External SaaS',d:'Partner API. Token login works; data APIs returned 403 HTML even without a token, which points to a partner-side WAF or whitelist. Escalate with evidence.',ch:'networking'}
],lessons:['Prove each hop separately: APIM → Function → egress IP → partner.','A 403 with no token = something in front of their API, not your auth.','Route All is the switch that makes NAT Gateway apply to App Service and Functions.']},
{id:'cpd',t:'CPD booking events (simplified)',intro:'A simplified model of the CPD flow built from your notes. Check it against the real design: DMS publishes booking and stock events, middleware processes them into SQL and CPD, and retry components try to recover failures.',nodes:[
{n:'DMS',s:'Source system',d:'Sends booking and stock events (e.g. BookingStockProcessed). DMS status is the source of truth for whether a booking is cancelled or closed.',ch:'integration'},
{n:'Service Bus topic',s:'Messaging',d:'Events are published once to a topic. Each subscription gets its own copy. Messages failing MaxDeliveryCount times move to that subscription’s dead-letter queue.',ch:'integration'},
{n:'Middleware Function',s:'Compute',d:'Consumes events and writes to the database and CPD. A text-formatted date caused SQL 22007 failures, so bookings were lost. Fix with typed parameters, and don’t log secrets in decorators.',ch:'databases'},
{n:'Azure SQL',s:'Database',d:'Stores booking state. Point-in-time restore protects against bad writes. Dates must arrive as typed parameters.',ch:'databases'},
{n:'Dead-letter queue',s:'Messaging',d:'Where failed events wait. Nothing processes it automatically. Alert when it’s above zero.',ch:'integration'},
{n:'topic-retry Logic App',s:'Workflow',d:'Re-processes failed events. A poison message blocked it, and dropped events were deleted, removing evidence. Lesson: park and record permanent failures; never delete silently.',ch:'integration'},
{n:'retry_cpd + CPD bot',s:'Recovery & reporting',d:'Re-pushes failed bookings (fixed 1 s pause, 20 attempts) and classifies stuck bookings. The bot reads only 2 days of Logic App history by default, so older drops looked like “DMS never sent”.',ch:'reliability'}
],lessons:['Every retry path needs idempotency, or duplicates appear.','Monitoring retention windows decide what you can prove later.','Alert on dead-letter counts; don’t discover failures through manual pushes.']},
{id:'py',t:'.NET → Python migration',intro:'Seventeen production Function Apps re-written from .NET to Python with a parity tool. The cloud concepts involved, from extraction to cut-over.',nodes:[
{n:'Live .NET app',s:'Compute',d:'The running app. Its real code is the deployed package: pulled from Kudu or the deployment storage and decompiled (ILSpy) to make sure you convert what is <i>actually</i> running.',ch:'devops'},
{n:'Parity check',s:'Engineering',d:'Every C# behaviour tagged and verified in Python. Secrets found in code are moved to settings and documented, never copied.',ch:'security'},
{n:'Python Function App',s:'Compute',d:'<code>FUNCTIONS_WORKER_RUNTIME=python</code>, runs on Linux, and dependencies come from requirements.txt (remote build). Triggers and bindings are declared in Python decorators (v2 programming model).',ch:'compute'},
{n:'UAT side-by-side',s:'Testing',d:'Run old and new against the same inputs in UAT and compare outputs before cut-over. This was deferred; it is the next real step.',ch:'devops'},
{n:'Cut-over',s:'Release',d:'Switch traffic app by app (strangler fig). Keep the .NET app ready to roll back. Rotate secrets that were found in DLLs.',ch:'architecture'}
],lessons:['Convert what is deployed, not what is in an old repo.','Same triggers, same settings names, same outputs: then prove it in UAT.','Migration is a chance to fix secrets and logging properly.']}
];
