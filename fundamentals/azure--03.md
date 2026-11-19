## 6. Databases and caching

### Azure SQL Database
<!-- level: basic; ref: https://learn.microsoft.com/azure/azure-sql/database/sql-database-paas-overview -->
Azure SQL Database is a fully managed SQL Server engine as a service. Microsoft handles patching, backups, high availability and version upgrades; you manage schema, queries, indexes and access.

The Azure SQL family:

- Azure SQL Database: a single database or elastic pool. Best default for new cloud apps.
- Azure SQL Managed Instance: near-complete SQL Server instance compatibility (SQL Agent, cross-database queries, CLR). Best for migrating existing SQL Server estates.
- SQL Server on Azure VMs: full control, for anything else.

Purchasing models: vCore (choose General Purpose, Business Critical or Hyperscale tiers, cores and storage) or DTU (bundled, simpler, older). Serverless compute in General Purpose and Hyperscale autoscales cores and can auto-pause idle databases, which suits dev/test and intermittent workloads. Elastic pools share resources across many databases, ideal for SaaS with a database per tenant.

```bash
az sql server create -g rg-orders -n sql-orders-prod -l centralindia \
  --enable-ad-only-auth --external-admin-principal-type Group \
  --external-admin-name sql-admins --external-admin-sid <group-object-id>
az sql db create -g rg-orders -s sql-orders-prod -n ordersdb \
  --edition GeneralPurpose --compute-model Serverless --family Gen5 \
  --capacity 4 --auto-pause-delay 60 --zone-redundant true
```

- Automatic backups support point-in-time restore (default 7 days, configurable up to 35) plus long-term retention.
- Pitfall: auto-pause adds a resume delay on the first connection; not suitable for latency-sensitive production APIs.

### Azure SQL high availability and failover groups
<!-- level: advanced; ref: https://learn.microsoft.com/azure/azure-sql/database/auto-failover-group-sql-db -->
Azure SQL builds in high availability within a region. Business Critical keeps synchronous replicas (and a free readable secondary), and zone-redundant configuration spreads replicas across availability zones, so a zone failure causes a short automatic failover with no data loss.

For regional disaster recovery you use geo-replication:

- Active geo-replication: up to four readable secondaries in other regions, per database, with manual failover.
- Failover groups: a group of databases replicated to a secondary server with listener endpoints that do not change after failover. The read-write listener (failover-group-name.database.windows.net) always points at the current primary; the read-only listener points at a secondary.

Replication across regions is asynchronous, so a forced failover can lose recent transactions. With a customer-managed failover policy you decide when to fail over; Microsoft-managed failover only triggers in large regional outages and may take time.

```bash
az sql failover-group create -g rg-orders -s sql-orders-prod-cin \
  --partner-server sql-orders-prod-sin -n fg-orders \
  --add-db ordersdb --failover-policy Manual
# applications connect to: fg-orders.database.windows.net
az sql failover-group set-primary -g rg-orders -s sql-orders-prod-sin -n fg-orders
```

- Pitfall: apps must use the listener endpoint, not the server name, or they will keep writing to the old region.
- Interview tip: route reporting queries to the read-only listener (ApplicationIntent=ReadOnly) to offload the primary.

### EF Core and connecting to Azure SQL from .NET
<!-- level: intermediate; ref: https://learn.microsoft.com/ef/core/miscellaneous/connection-resiliency -->
Two things make .NET apps robust against Azure SQL: passwordless authentication and transient fault handling.

Passwordless: Microsoft.Data.SqlClient supports Entra authentication modes. With Authentication=Active Directory Default, the driver uses the same credential chain as DefaultAzureCredential, so your app connects with its managed identity and no password is stored. Create a contained database user for the identity and grant only the roles it needs.

Transient faults: cloud databases occasionally drop connections during failovers, reconfigurations and throttling. EF Core's SQL Server provider has an execution strategy that retries known transient error codes with exponential backoff.

```sql
CREATE USER [app-orders-api] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [app-orders-api];
ALTER ROLE db_datawriter ADD MEMBER [app-orders-api];
```

```csharp
builder.Services.AddDbContext<OrdersDb>(o => o.UseSqlServer(
    "Server=tcp:fg-orders.database.windows.net;Database=ordersdb;" +
    "Authentication=Active Directory Default;Encrypt=True;",
    sql => sql.EnableRetryOnFailure(maxRetryCount: 5,
                                    maxRetryDelay: TimeSpan.FromSeconds(10),
                                    errorNumbersToAdd: null)));
```

- Pitfall: with a retrying strategy, user-initiated transactions must run inside strategy.ExecuteAsync so the whole unit is retried, not just the failed statement.
- Pitfall: retries on non-idempotent operations can double-write; design with idempotency keys.
- Tip: connection pooling is per connection string; keep it constant.

### Azure Cosmos DB fundamentals
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/cosmos-db/request-units -->
Azure Cosmos DB is a globally distributed, multi-model NoSQL database with single-digit-millisecond reads and writes, automatic indexing and turnkey multi-region replication. The core API is Azure Cosmos DB for NoSQL (JSON documents queried with a SQL-like language); other APIs include MongoDB (RU and vCore), Apache Cassandra, Gremlin and Table, plus Azure Cosmos DB for PostgreSQL for distributed relational workloads.

Everything is measured in Request Units (RU): a normalised cost of CPU, memory and IO. A point read of a 1 KB item by id and partition key costs about 1 RU; queries and writes cost more, and indexing policy affects write cost. Capacity modes:

- Provisioned throughput: reserve RU/s, manually or with autoscale (scales between 10 percent and 100 percent of a maximum).
- Serverless: pay per RU consumed, for spiky or low-traffic apps.

When you exceed capacity, requests get HTTP 429 with a retry-after hint; the SDK retries automatically a few times.

```csharp
var client = new CosmosClient(endpoint, new DefaultAzureCredential(),
    new CosmosClientOptions { ApplicationPreferredRegions = ["Central India", "South India"] });
Container orders = client.GetContainer("shop", "orders");

ItemResponse<Order> r = await orders.ReadItemAsync<Order>("o-123", new PartitionKey("cust-42"));
Console.WriteLine($"Cost: {r.RequestCharge} RU");
```

- Pitfall: CosmosClient must be a singleton; creating one per request exhausts connections.
- Pitfall: excluding unused paths from indexing can cut write RU significantly.

### Cosmos DB partitioning and consistency in practice
<!-- level: advanced; ref: https://learn.microsoft.com/azure/cosmos-db/consistency-levels -->
Cosmos DB scales by spreading data across physical partitions based on the partition key you choose per container. Each logical partition (all items with the same key value) is limited to 20 GB, and each physical partition serves a bounded share of throughput. Therefore the key decides both scalability and cost.

A good partition key has high cardinality, distributes writes evenly, and appears in most query filters. For multi-tenant SaaS, hierarchical partition keys (for example /tenantId then /userId) avoid the 20 GB ceiling for big tenants while keeping tenant queries efficient. Queries without the partition key fan out to every partition and cost more RU.

Consistency levels, strongest to weakest: Strong, Bounded staleness, Session (default), Consistent prefix, Eventual. Session gives each client read-your-own-writes, which suits most apps. Strong across multiple regions adds write latency; it is unavailable with multi-region writes.

```csharp
// targeted query: includes the partition key, so it hits one partition
var q = orders.GetItemQueryIterator<Order>(
    new QueryDefinition("SELECT * FROM c WHERE c.status = @s").WithParameter("@s", "Open"),
    requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey("cust-42") });
```

- Pitfall: keys like /status or /country create hot partitions; dates create write hot spots on "today".
- Interview tip: model data around access patterns and embed related data you read together; joins across containers do not exist.

### Azure Database for PostgreSQL and MySQL
<!-- level: basic; ref: https://learn.microsoft.com/azure/postgresql/flexible-server/overview -->
For open-source relational engines, Azure offers Azure Database for PostgreSQL flexible server and Azure Database for MySQL flexible server. They are managed services: automated patching within maintenance windows you choose, automated backups with point-in-time restore, and built-in high availability.

Flexible server highlights:

- Compute tiers: Burstable (dev/test), General Purpose and Memory Optimized.
- Zone-redundant HA: a synchronous standby in another zone with automatic failover.
- Read replicas, including cross-region, for scale-out reads and DR.
- Networking: public access with firewall rules, private access via VNet integration, or private endpoints.
- Entra ID authentication, so apps can connect with managed identities.
- Stop/start for non-production servers to save cost.
- PostgreSQL extensions such as pgvector for embeddings, PostGIS and pg_stat_statements.

```bash
az postgres flexible-server create -g rg-catalog -n psql-catalog-prod \
  --tier GeneralPurpose --sku-name Standard_D4ds_v5 --version 16 \
  --high-availability ZoneRedundant --storage-size 256 \
  --microsoft-entra-auth Enabled --password-auth Disabled
```

```csharp
// Npgsql with an Entra token as the password
var token = await new DefaultAzureCredential().GetTokenAsync(
    new(["https://ossrdbms-aad.database.windows.net/.default"]));
```

- Pitfall: Entra tokens expire about hourly; use Npgsql's periodic password provider so pooled connections refresh.
- Tip: choose PostgreSQL over Cosmos DB when you need relational integrity and ad-hoc SQL.

### Caching with Azure Managed Redis
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/azure-cache-for-redis/cache-overview -->
An in-memory cache in front of a database cuts latency and load. Azure's managed Redis offerings are Azure Cache for Redis and its successor Azure Managed Redis, built on Redis Enterprise, which Microsoft recommends for new deployments (the older Azure Cache for Redis tiers have announced retirement dates, so plan migrations).

Common uses:

- Cache-aside for read-heavy data (product catalogue, configuration).
- Distributed session state and output caching for scaled-out web apps.
- Rate limiting counters, leaderboards (sorted sets), distributed locks and pub/sub.

In .NET, use StackExchange.Redis directly, or the abstractions: IDistributedCache, output caching with a Redis store, or HybridCache (in .NET 9 and later), which combines a local in-memory tier with a distributed tier and protects against cache stampedes.

```csharp
builder.Services.AddStackExchangeRedisCache(o =>
    o.Configuration = builder.Configuration["Redis:ConnectionString"]);
builder.Services.AddHybridCache();

public class CatalogService(HybridCache cache, CatalogDb db)
{
    public Task<Product?> GetAsync(string sku, CancellationToken ct) =>
        cache.GetOrCreateAsync($"product:{sku}",
            async token => await db.Products.FindAsync([sku], token),
            new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(10) },
            cancellationToken: ct).AsTask();
}
```

- Pitfall: create one ConnectionMultiplexer per app and reuse it; reconnecting per request exhausts sockets.
- Pitfall: a cache is not a database; design for eviction and cold starts, and set TTLs to bound staleness.

## 7. Networking

### Virtual networks and subnets
<!-- level: basic; ref: https://learn.microsoft.com/azure/virtual-network/virtual-networks-overview -->
An Azure Virtual Network (VNet) is your private network in a region, defined by one or more address spaces (for example 10.20.0.0/16) and divided into subnets. Resources in a VNet communicate privately; by default they can reach each other across subnets and reach the internet outbound.

Key points:

- Plan address space up front to avoid overlaps with on-premises and other VNets, otherwise peering and VPN become impossible.
- Azure reserves five IP addresses in every subnet.
- Some services need a dedicated or delegated subnet: Azure Bastion (AzureBastionSubnet), VPN gateway (GatewaySubnet), Azure Firewall, App Service VNet integration, Container Apps environments.
- User-defined routes (route tables) override system routes, for example forcing traffic through a firewall.
- Default outbound internet access for new VMs is being retired; use a NAT gateway, load balancer outbound rules or a firewall for explicit outbound connectivity.

```bash
az network vnet create -g rg-net -n vnet-orders-prod --address-prefixes 10.20.0.0/16 \
  --subnet-name snet-app --subnet-prefixes 10.20.1.0/24
az network vnet subnet create -g rg-net --vnet-name vnet-orders-prod -n snet-pe \
  --address-prefixes 10.20.2.0/24
az network vnet subnet create -g rg-net --vnet-name vnet-orders-prod -n snet-appsvc \
  --address-prefixes 10.20.3.0/26 --delegations Microsoft.Web/serverFarms
```

- Pitfall: subnets that are too small block scaling (AKS with VNet-routed pod IPs is a classic case).

### Network security groups
<!-- level: basic; ref: https://learn.microsoft.com/azure/virtual-network/network-security-groups-overview -->
A network security group (NSG) is a stateful layer-4 firewall: a list of allow/deny rules evaluated by priority (lowest number first) on source, destination, port and protocol. You attach NSGs to subnets, network interfaces, or both. Because rules are stateful, return traffic for an allowed flow is automatically allowed.

Default rules allow traffic within the VNet and from the Azure load balancer, allow outbound internet, and deny other inbound traffic. Your rules go between priorities 100 and 4096.

Make rules readable with:

- Service tags: Microsoft-maintained groups of IP ranges, such as Internet, VirtualNetwork, AzureLoadBalancer, Storage.CentralIndia, AzureFrontDoor.Backend.
- Application security groups (ASGs): label NICs (for example asg-web, asg-db) and write rules between labels instead of IPs.

```bash
az network nsg rule create -g rg-net --nsg-name nsg-db -n allow-sql-from-web \
  --priority 200 --direction Inbound --access Allow --protocol Tcp \
  --source-asgs asg-web --destination-asgs asg-db --destination-port-ranges 1433
```

- Troubleshoot with Network Watcher: IP flow verify answers "would this packet be allowed?" and effective security rules show the combined result of subnet and NIC NSGs.
- Pitfall: when NSGs exist on both subnet and NIC, traffic must be allowed by both.
- Pitfall: NSGs do not inspect URLs or payloads; use Azure Firewall or a WAF for that.

### VNet peering and hub-and-spoke
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/virtual-network/virtual-network-peering-overview -->
VNet peering connects two VNets over the Microsoft backbone with low latency, as if they were one network. Peering works within a region and across regions (global peering), and across subscriptions and tenants. Address spaces must not overlap.

Peering is not transitive: if A peers with B and B with C, A cannot reach C through B. That is why most enterprises use a hub-and-spoke topology:

- The hub VNet hosts shared services: Azure Firewall or a network virtual appliance, VPN/ExpressRoute gateways, Bastion, DNS resolvers.
- Spoke VNets host workloads and peer only with the hub.
- Route tables in spokes send traffic to the firewall in the hub, which inspects and forwards spoke-to-spoke and internet traffic.
- Gateway transit lets spokes use the hub's VPN/ExpressRoute gateway to reach on-premises.

Azure Virtual WAN is a Microsoft-managed alternative hub for large, multi-region networks with many branches. Azure Virtual Network Manager can create and maintain hub-and-spoke or mesh connectivity at scale.

```bash
az network vnet peering create -g rg-net -n spoke-to-hub \
  --vnet-name vnet-orders-prod --remote-vnet vnet-hub \
  --allow-vnet-access --allow-forwarded-traffic --use-remote-gateways
```

- Pitfall: peering must be created in both directions before traffic flows.

### Private endpoints, service endpoints and private DNS
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/private-link/private-endpoint-overview -->
PaaS services (Storage, SQL, Key Vault, Cosmos DB, Service Bus) have public endpoints by default. Two features restrict access to your network.

Service endpoints extend your subnet's identity to the service: traffic still goes to the public IP of the service, but over the Azure backbone, and the service firewall can allow that subnet. Simple and free, but the service remains reachable on a public IP and it does not help on-premises clients.

Private endpoints (Azure Private Link) give a service a private IP inside your subnet. You can then disable public network access completely. On-premises and peered networks reach it privately, which is why private endpoints are the enterprise default.

The catch is DNS. Clients must resolve the normal name (kv-orders.vault.azure.net) to the private IP. Azure handles this with a CNAME to a privatelink zone (privatelink.vaultcore.azure.net), which you host as an Azure Private DNS zone linked to your VNets. On-premises DNS forwards to Azure DNS Private Resolver.

```bash
az network private-endpoint create -g rg-orders -n pe-kv-orders \
  --vnet-name vnet-orders-prod --subnet snet-pe \
  --private-connection-resource-id $(az keyvault show -n kv-orders --query id -o tsv) \
  --group-id vault --connection-name kv-orders-conn
az network private-dns zone create -g rg-net -n privatelink.vaultcore.azure.net
```

- Pitfall: most "private endpoint does not work" incidents are DNS resolving to the public IP. Check with nslookup from inside the VNet.

### Load balancing: Load Balancer, Application Gateway, Front Door, Traffic Manager
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/architecture/guide/technology-choices/load-balancing-overview -->
Azure has four load-balancing services, distinguished by scope (regional or global) and layer (4 or 7).

- Azure Load Balancer: regional, layer 4 (TCP/UDP). Very high throughput, low latency. Use in front of VMs or scale sets for any TCP protocol. Standard SKU is zone-redundant.
- Application Gateway: regional, layer 7 (HTTP/HTTPS). Path- and host-based routing, TLS termination, autoscaling, and optional Web Application Firewall. Also used as an AKS ingress (Application Gateway for Containers).
- Azure Front Door: global, layer 7, at Microsoft's edge. Anycast entry points, TLS termination near users, caching (CDN), WAF, and health-probe-based failover between regions.
- Traffic Manager: global, DNS-based. Returns the endpoint to use based on priority, weight, performance or geography; works for any protocol but clients cache DNS, so failover is slower.

```text
Internet-facing multi-region web app:
  Front Door (WAF, caching) -> App Service / Container Apps in 2 regions

Internal TCP service on VMs:
  Internal Standard Load Balancer -> VM scale set

Single-region web app needing WAF and path routing:
  Application Gateway (WAF v2) -> backends in VNet
```

- Pitfall: when using Front Door, lock backends so they only accept traffic from it (service tag AzureFrontDoor.Backend plus the X-Azure-FDID header check, or Private Link origins).
- Interview tip: global versus regional and layer 4 versus layer 7 is the whole decision tree.

### Hybrid connectivity: VPN Gateway and ExpressRoute
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-about-vpngateways -->
Most enterprises connect Azure to their on-premises networks. Two services do this.

VPN Gateway creates encrypted IPsec/IKE tunnels over the public internet:

- Site-to-site: your office or datacenter firewall to Azure.
- Point-to-site: individual laptops to Azure, with Entra ID, certificate or RADIUS authentication.
- VNet-to-VNet tunnels.

It is quick to set up and inexpensive, but bandwidth and latency depend on the internet. Use active-active gateways and zone-redundant SKUs for resilience.

ExpressRoute is a private circuit through a connectivity provider into Microsoft's network: it does not traverse the public internet, offers predictable latency and higher bandwidth, and comes with an SLA. Private peering connects to your VNets; Microsoft peering reaches Microsoft 365 and public PaaS endpoints. For resilience, use two circuits in different peering locations, or a site-to-site VPN as a backup path. ExpressRoute traffic is not encrypted by default; add MACsec or IPsec over it if required.

```bash
az network vnet-gateway create -g rg-net -n vgw-hub --vnet vnet-hub \
  --gateway-type Vpn --vpn-type RouteBased --sku VpnGw2AZ \
  --public-ip-addresses pip-vgw-1 pip-vgw-2   # active-active
```

- Pitfall: BGP route advertisement mistakes (overlapping prefixes) are a common cause of hybrid outages.

### Azure Firewall, NAT Gateway and DDoS Protection
<!-- level: advanced; ref: https://learn.microsoft.com/azure/firewall/overview -->
These services control traffic at the network edge of your VNets.

Azure Firewall is a managed, stateful, highly available firewall typically placed in the hub VNet. It filters by network rules (IP, port), application rules (FQDN, for example allow only *.github.com outbound) and DNAT rules for inbound. The Premium SKU adds TLS inspection, IDPS and URL filtering. Policies are managed centrally with Firewall Policy and can be shared across hubs. Route tables send spoke traffic (0.0.0.0/0) to the firewall's private IP.

NAT Gateway gives a subnet predictable outbound internet connectivity through static public IPs, with a large pool of SNAT ports. Use it when a partner needs to allow-list your outbound IP, or when apps exhaust SNAT ports talking to many external endpoints.

Azure DDoS Protection adds adaptive tuning, attack telemetry and cost protection for public IPs beyond the basic always-on platform protection.

```bash
az network nat gateway create -g rg-net -n nat-app --public-ip-addresses pip-nat-1 \
  --idle-timeout 10
az network vnet subnet update -g rg-net --vnet-name vnet-orders-prod -n snet-app \
  --nat-gateway nat-app
```

- Pitfall: asymmetric routing (inbound via a load balancer, return via the firewall) silently drops connections.
- Interview tip: NSGs filter inside the network; Azure Firewall provides central egress control, FQDN filtering and logging.

## 8. Security services

### Azure Key Vault
<!-- level: basic; ref: https://learn.microsoft.com/azure/key-vault/general/overview -->
Key Vault stores and controls access to three kinds of objects: secrets (connection strings, API keys), keys (RSA/EC keys for encryption and signing, optionally HSM-protected) and certificates (with automatic renewal from integrated CAs).

Recommended setup:

- Use the Azure RBAC permission model (not legacy access policies), and grant data roles like Key Vault Secrets User to the specific app identity.
- Keep soft delete and enable purge protection so deleted vaults and secrets can be recovered.
- Use one vault per application per environment to limit blast radius.
- Restrict network access with a private endpoint and disable public access for sensitive vaults.
- Send diagnostic logs (AuditEvent) to Log Analytics to see who read what.

In .NET, the Azure.Extensions.AspNetCore.Configuration.Secrets package loads secrets into IConfiguration at startup, with periodic reload if you set an interval.

```csharp
builder.Configuration.AddAzureKeyVault(
    new Uri($"https://{builder.Configuration["KeyVaultName"]}.vault.azure.net/"),
    new DefaultAzureCredential(),
    new AzureKeyVaultConfigurationOptions { ReloadInterval = TimeSpan.FromMinutes(30) });

// secret named "ConnectionStrings--Orders" becomes configuration key "ConnectionStrings:Orders"
var cs = builder.Configuration.GetConnectionString("Orders");
```

- Pitfall: Key Vault has request throttling limits; do not call it on every HTTP request. Load at startup or cache.
- Tip: the best secret is no secret; use managed identities to reach SQL, Storage and Service Bus directly.

### Azure App Configuration and feature flags
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/azure-app-configuration/overview -->
Azure App Configuration is a central store for application settings and feature flags, separate from secrets. It suits microservices that share settings, or teams that want to change configuration without redeploying.

Features:

- Key-values with labels (often used for environments: label "prod", "staging").
- Key Vault references: App Configuration stores a pointer, and the provider resolves the secret from Key Vault with the app's identity.
- Feature flags with filters: percentage rollout, time windows, targeting specific users or groups.
- Snapshots and point-in-time restore of configuration.
- Dynamic refresh: the app watches a sentinel key and reloads settings when it changes.

```csharp
builder.Configuration.AddAzureAppConfiguration(o =>
{
    o.Connect(new Uri(builder.Configuration["AppConfig:Endpoint"]!), new DefaultAzureCredential())
     .Select("Orders:*", labelFilter: builder.Environment.EnvironmentName)
     .ConfigureKeyVault(kv => kv.SetCredential(new DefaultAzureCredential()))
     .ConfigureRefresh(r => r.Register("Orders:Sentinel", refreshAll: true)
                             .SetRefreshInterval(TimeSpan.FromSeconds(60)))
     .UseFeatureFlags();
});
builder.Services.AddAzureAppConfiguration().AddFeatureManagement();
// app.UseAzureAppConfiguration();  then: if (await featureManager.IsEnabledAsync("NewCheckout")) ...
```

- Pitfall: without the refresh middleware or a refresher call, dynamic settings never update.
- Tip: IOptionsSnapshot or IOptionsMonitor are required to observe refreshed values.

### Microsoft Defender for Cloud
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/defender-for-cloud/defender-for-cloud-introduction -->
Microsoft Defender for Cloud is Azure's cloud-native application protection platform. It has two broad parts.

Cloud security posture management (CSPM) continuously assesses resources against benchmarks such as the Microsoft cloud security benchmark and produces recommendations ("storage account should disable public network access", "VMs should have vulnerability assessment"). The secure score summarises posture. Defender CSPM (paid) adds attack path analysis, the cloud security explorer, and agentless scanning. It also covers AWS and GCP accounts.

Workload protection plans add threat detection for specific resource types: Defender for Servers, Containers (image scanning in ACR, runtime protection in AKS), Storage (malware scanning on upload, suspicious access), SQL, Key Vault, App Service, Resource Manager and APIs. Alerts flow to the portal, to Microsoft Defender XDR and to SIEMs such as Microsoft Sentinel.

```bash
az security pricing create --name StorageAccounts --tier Standard \
  --subplan DefenderForStorageV2
az security assessment list --query "[?status.code=='Unhealthy'].displayName" -o tsv | head
```

- Tip: enable plans through Azure Policy at management group scope so new subscriptions are covered automatically.
- Pitfall: recommendations without owners are ignored; assign them via governance rules with due dates.

### Encryption at rest and in transit
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/security/fundamentals/encryption-overview -->
Azure encrypts data at rest by default in practically every storage and database service, using 256-bit AES with platform-managed keys. You do not need to do anything for baseline encryption.

Further options exist for compliance:

- Customer-managed keys (CMK): the service encrypts data with a key stored in your Key Vault or Managed HSM. You control rotation and can revoke access, which renders data unreadable. Requires a managed identity for the service to access the key, and purge protection on the vault.
- Infrastructure (double) encryption: a second layer with a different key at the infrastructure level.
- Encryption at host / confidential disk encryption for VMs; Always Encrypted in Azure SQL to keep columns encrypted even from database admins.
- Confidential computing: data protected in use inside hardware-based trusted execution environments.

In transit: require TLS 1.2 or higher on services (storage minimum TLS version, App Service minimum TLS, HTTPS only), use private endpoints for internal traffic, and use MACsec or IPsec on ExpressRoute when regulations require encryption on private links.

```bicep
resource st 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stsecure01'
  location: location
  sku: { name: 'Standard_ZRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    encryption: { requireInfrastructureEncryption: true, services: { blob: { enabled: true } }, keySource: 'Microsoft.Storage' }
  }
}
```

- Pitfall: with CMK, deleting or disabling the key is an outage; treat key lifecycle as production change.
