## 1. Cloud and Azure foundations

### Cloud service models: IaaS, PaaS, SaaS
<!-- level: basic; ref: https://learn.microsoft.com/azure/cloud-adoption-framework/ready/considerations/fundamental-concepts -->
Cloud computing means renting compute, storage and managed services on demand instead of buying and running hardware. You pay for what you use, provision in minutes, and hand undifferentiated work (power, cooling, patching, failover) to the provider.

The service models describe how much the provider manages for you:

- IaaS (Infrastructure as a Service): you get virtual machines, disks and networks. You still patch the OS, install runtimes and harden the box. Example: Azure Virtual Machines.
- PaaS (Platform as a Service): you bring code or a container; the platform runs, patches and scales it. Example: App Service, Azure SQL Database, Azure Functions.
- SaaS (Software as a Service): a finished application you configure and use. Example: Microsoft 365.

Moving from IaaS to SaaS you give up control and gain speed and lower operational effort. Serverless (Functions, Container Apps with scale-to-zero) is a flavour of PaaS where you do not even think about instances and pay per execution or per active second.

```text
Lift-and-shift a legacy Windows service  -> IaaS (VM)
New ASP.NET Core API                     -> PaaS (App Service / Container Apps)
Email and documents                      -> SaaS (Microsoft 365)
```

- Interview tip: say "pick the most managed option that still meets the requirement" and give a reason you would drop down a level (custom OS agents, licensing, kernel tuning).
- Pitfall: lifting VMs as-is rarely saves money; savings come from modernising to PaaS and right-sizing.

### Regions, availability zones and region pairs
<!-- level: basic; ref: https://learn.microsoft.com/azure/reliability/availability-zones-overview -->
Azure is built from regions: sets of datacenters in a geography (for example West Europe, Central India, East US 2). You choose a region for every resource, which determines latency to users, data residency and which services and VM sizes are available.

Many regions contain availability zones: physically separate groups of datacenters with independent power, cooling and networking, connected by low-latency links. Deploying across zones protects you from a single datacenter failure.

- Zonal resources are pinned to one zone you choose (for example a VM in zone 2).
- Zone-redundant resources are spread across zones by the platform (for example ZRS storage, zone-redundant App Service plans, zone-redundant Azure SQL).

Many regions also have a paired region in the same geography. Microsoft uses pairs for sequential platform updates and for geo-redundant storage replication. Newer regions may have no pair, and you are free to choose any secondary region for your own disaster recovery design.

```bash
# list regions and check zone support for a VM size
az account list-locations -o table
az vm list-skus --location centralindia --size Standard_D4s_v5 --query "[].locationInfo[].zones"
```

- Pitfall: putting two VMs in the same zone does not give zone resilience; spread them.
- Interview tip: zones protect against datacenter failure; multiple regions protect against regional outages. Each costs more and adds complexity, so tie it to the RTO/RPO.

### Tenants, management groups, subscriptions and resource groups
<!-- level: basic; ref: https://learn.microsoft.com/azure/governance/management-groups/overview -->
Azure organises everything in a hierarchy, and permissions and policies inherit downward:

1. Microsoft Entra tenant: the identity directory for your organisation (users, groups, apps).
2. Management groups: folders of subscriptions, used to apply policy and RBAC at scale (for example "Production", "Sandbox").
3. Subscriptions: a billing and quota boundary, and a common unit of isolation between teams or environments.
4. Resource groups: logical containers for resources that share a lifecycle, such as all the parts of one application environment.
5. Resources: the individual VMs, databases, storage accounts and so on.

Design guidance: separate production and non-production into different subscriptions, group resources that are deployed and deleted together into one resource group, and apply guardrails (policies, budgets) at the management group level.

```bash
az group create --name rg-orders-prod-cin --location centralindia --tags app=orders env=prod
az resource list --resource-group rg-orders-prod-cin -o table
az group delete --name rg-orders-dev-cin --yes   # deletes everything inside
```

- Pitfall: a resource group has a location (where its metadata lives) but can hold resources from any region.
- Pitfall: deleting a resource group deletes every resource in it; protect production groups with locks.

### Azure Resource Manager (ARM)
<!-- level: basic; ref: https://learn.microsoft.com/azure/azure-resource-manager/management/overview -->
Azure Resource Manager is the control plane behind every management action. Whether you click in the portal, run the CLI, call the REST API, or deploy Bicep or Terraform, the request goes to ARM, which authenticates you with Entra ID, checks RBAC and Azure Policy, and forwards the request to the resource provider (Microsoft.Web, Microsoft.Storage, and so on).

Why this matters:

- Consistency: every tool has the same capabilities and the same permission model.
- Declarative deployments: ARM accepts a desired-state template and works out create/update order from dependencies.
- Auditing: every control-plane write is recorded in the Activity Log.

Distinguish the control plane (management.azure.com: create a storage account, change a SKU) from the data plane (the service endpoint itself: read a blob, query a database). RBAC roles are split along the same line, which is why "Contributor" can create a storage account but cannot read blobs with Entra auth unless it also has a data role such as Storage Blob Data Reader.

```bash
# every resource has a resource ID that ARM uses
az resource show --ids /subscriptions/<sub>/resourceGroups/rg-app/providers/Microsoft.Web/sites/orders-api
# a resource provider must be registered before first use
az provider register --namespace Microsoft.App
```

- Interview tip: control plane vs data plane is a frequent follow-up when discussing permissions.

### Working with Azure: portal, CLI, PowerShell and SDKs
<!-- level: basic; ref: https://learn.microsoft.com/cli/azure/ -->
You can manage Azure several ways, and good engineers use the right one for the job:

- Azure portal: discovery, dashboards and one-off investigation. Avoid using it to build production environments, because clicks are not repeatable.
- Azure CLI (az): cross-platform, scriptable, great for automation and pipelines.
- Azure PowerShell (Az module): natural fit for Windows admins and object-pipeline scripting.
- Cloud Shell: a browser shell with CLI, PowerShell and tools preinstalled.
- SDKs: libraries such as Azure.Storage.Blobs or Azure.Messaging.ServiceBus for .NET, which your application uses to talk to services at runtime.
- Infrastructure as code: Bicep or Terraform for repeatable environments.

```bash
az login
az account set --subscription "Contoso Prod"
az webapp list --query "[].{name:name, state:state}" -o table
```

```csharp
// .NET SDK: modern Azure libraries share one credential model and options pattern
var blobService = new BlobServiceClient(
    new Uri("https://stordersprod.blob.core.windows.net"),
    new DefaultAzureCredential());
```

- Pitfall: scripts that rely on the "current subscription" can hit the wrong environment; set it explicitly.
- Tip: the --query flag uses JMESPath and saves piping to jq.

### The shared responsibility model
<!-- level: basic; ref: https://learn.microsoft.com/azure/security/fundamentals/shared-responsibility -->
Security and operations in the cloud are split between Microsoft and you, and the split moves with the service model.

- Microsoft always owns the physical datacenter, hosts, physical network and hypervisor.
- With IaaS, you own the guest OS (patching, antivirus), network rules, applications, identities and data.
- With PaaS, Microsoft also patches the OS and runtime; you own application code, configuration, identities, network exposure and data.
- With SaaS, you mainly own data, identities, devices and configuration.

Across every model you are always responsible for your data, your accounts and identities, and how access is granted. Most real cloud breaches come from misconfiguration on the customer side: a public storage container, an over-privileged service principal, a leaked connection string.

```text
App Service hosting an ASP.NET Core API
  Microsoft: hardware, OS patching, runtime patching, platform availability
  You:       code vulnerabilities, auth config, TLS settings, secrets, RBAC, data
```

- Interview tip: give a concrete example of something that is still yours on PaaS, such as enforcing HTTPS-only, minimum TLS version and disabling public network access.

## 2. Identity and access

### Microsoft Entra ID
<!-- level: basic; ref: https://learn.microsoft.com/entra/fundamentals/whatis -->
Microsoft Entra ID (formerly Azure Active Directory) is the cloud identity provider that every Azure subscription trusts. It stores users, groups and application identities, issues tokens using OAuth 2.0 and OpenID Connect, and enforces sign-in policies such as MFA.

Key ideas:

- Every subscription is linked to exactly one tenant, which decides who can sign in to manage it.
- Security principals are things that can be granted access: users, groups, service principals and managed identities.
- Applications sign users in with OpenID Connect and call APIs with OAuth 2.0 access tokens. Your ASP.NET Core API validates those JWTs.
- Entra ID is not the same as on-premises Active Directory Domain Services; there are no OUs or Group Policy. Entra Connect or Cloud Sync synchronises on-prem identities.

```csharp
// ASP.NET Core API protected by Entra ID (Microsoft.Identity.Web)
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));
builder.Services.AddAuthorization();
```

- For customer-facing sign-in, Microsoft now positions Entra External ID as the successor to Azure AD B2C for new projects.
- Pitfall: confusing authentication (who you are, Entra ID) with authorization (what you can do, RBAC or app roles).

### Azure role-based access control (RBAC)
<!-- level: basic; ref: https://learn.microsoft.com/azure/role-based-access-control/overview -->
Azure RBAC decides who can do what on which Azure resources. A role assignment has three parts:

1. Security principal: a user, group, service principal or managed identity.
2. Role definition: a set of allowed actions and data actions, such as Reader, Contributor, Owner, or data roles like Storage Blob Data Contributor and Key Vault Secrets User.
3. Scope: management group, subscription, resource group or single resource. Assignments inherit to child scopes.

RBAC is additive: effective permissions are the union of all assignments, minus any deny assignments (which are created by the platform, for example by deployment stacks). Owner and User Access Administrator can grant access; Contributor cannot.

```bash
az role assignment create \
  --assignee-object-id <managed-identity-principal-id> \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Reader" \
  --scope /subscriptions/<sub>/resourceGroups/rg-app/providers/Microsoft.Storage/storageAccounts/stappdata
```

- Least privilege: assign to groups, not individuals; use the narrowest scope; prefer built-in roles and create custom roles only when needed.
- Pitfall: role assignments can take a few minutes to propagate, which causes confusing 403s right after deployment.
- Interview tip: Contributor at subscription scope for a CI pipeline is a common anti-pattern.

### Managed identities
<!-- level: intermediate; ref: https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/overview -->
A managed identity is an Entra ID identity that Azure creates and manages for a resource, so your code can get tokens without any secret. The platform rotates the underlying credentials; nothing lives in config files.

Two types:

- System-assigned: tied to one resource and deleted with it. Simple, one-to-one.
- User-assigned: a standalone resource you attach to one or more resources. Good when several apps share permissions, or when you need the identity to exist before the app (to pre-create role assignments in IaC).

How it works: the resource exposes a local token endpoint. The Azure SDK calls it, receives an access token for the target service (Key Vault, Storage, SQL, Service Bus), and sends it as a bearer token. The target checks RBAC for that identity.

```bicep
resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: 'orders-api'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: { serverFarmId: plan.id }
}

resource kvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, app.id, 'kv-secrets-user')
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}
```

- Pitfall: with a user-assigned identity, the SDK needs its client ID, otherwise it may pick the wrong identity or none.

### DefaultAzureCredential and Azure SDK authentication in .NET
<!-- level: intermediate; ref: https://learn.microsoft.com/dotnet/azure/sdk/authentication/ -->
The Azure.Identity library provides credential classes that every modern Azure SDK client accepts as a TokenCredential. DefaultAzureCredential tries a chain of sources in order (environment variables, workload identity, managed identity, then developer tools such as Visual Studio, Azure CLI and azd) and uses the first that works. The same code runs locally with your developer login and in Azure with a managed identity.

In production, many teams prefer a specific credential (ManagedIdentityCredential, WorkloadIdentityCredential) or a ChainedTokenCredential, because walking the full chain adds startup latency and can pick an unexpected identity.

```csharp
// Program.cs - register Azure clients once, reuse them (they are thread-safe)
builder.Services.AddAzureClients(clients =>
{
    clients.AddBlobServiceClient(new Uri(builder.Configuration["Storage:Uri"]!));
    clients.AddServiceBusClientWithNamespace("sb-orders-prod.servicebus.windows.net");
    clients.UseCredential(builder.Environment.IsDevelopment()
        ? new DefaultAzureCredential()
        : new ManagedIdentityCredential(
            ManagedIdentityId.FromUserAssignedClientId(builder.Configuration["Identity:ClientId"]!)));
});
```

- Pitfall: creating a new client (or credential) per request wastes connections and token fetches; register them as singletons.
- Pitfall: locally, a 403 usually means your own account lacks the data-plane role, not that the code is wrong.
- Interview tip: explain that the token is cached and refreshed automatically by the credential.

### App registrations and service principals
<!-- level: intermediate; ref: https://learn.microsoft.com/entra/identity-platform/app-objects-and-service-principals -->
When an application needs its own identity in Entra ID (outside of a managed identity), you create an app registration. That produces two objects:

- Application object: the global definition in the home tenant (redirect URIs, exposed API scopes, app roles, credentials).
- Service principal (enterprise application): the local instance in each tenant where the app is used. Role assignments and consent attach to the service principal.

Use app registrations for: web apps that sign users in, APIs that expose scopes, daemons running outside Azure, and CI/CD systems. For pipelines, prefer workload identity federation (federated credentials trusting GitHub or Azure DevOps OIDC tokens) over client secrets or certificates, so there is nothing to leak or rotate.

```bash
az ad app create --display-name orders-api
az ad sp create --id <appId>
az ad app federated-credential create --id <appId> --parameters '{
  "name": "gh-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:contoso/orders:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

- Pitfall: client secrets expire (maximum two years) and outages from expired secrets are common; track expiry or eliminate secrets.
- Interview tip: managed identity is for code running in Azure; app registration plus federation is for code running elsewhere.

### Conditional Access and Privileged Identity Management
<!-- level: advanced; ref: https://learn.microsoft.com/entra/id-governance/privileged-identity-management/pim-configure -->
Two Entra features harden human access to Azure.

Conditional Access is a policy engine evaluated at sign-in: "if user X signs in to app Y from condition Z, then require MFA / a compliant device / block". Typical policies: require MFA for all admins, block legacy authentication, require phishing-resistant MFA for the Azure management portal and CLI, and block sign-ins from unexpected countries. Microsoft has also been enforcing mandatory MFA for Azure management sign-ins.

Privileged Identity Management (PIM) provides just-in-time elevation. Instead of permanent Owner assignments, users are eligible for a role and must activate it for a limited time, with justification, MFA and optionally approval. Every activation is audited.

```text
Eligible: alice -> Owner on subscription "Payments-Prod"
Activation: max 2 hours, requires MFA + ticket number + approval by platform lead
Permanent assignments: only break-glass accounts (excluded from CA, monitored)
```

- Pitfall: lock-out risk. Always keep at least two monitored break-glass accounts excluded from Conditional Access.
- Interview tip: standing privileged access is a top audit finding; PIM plus access reviews is the standard remedy.

## 3. Governance and organisation

### Azure Policy
<!-- level: intermediate; ref: https://learn.microsoft.com/azure/governance/policy/overview -->
Azure Policy enforces rules on resource configuration at deployment time and audits existing resources. Where RBAC decides who can act, Policy decides what configurations are allowed regardless of who acts.

Each policy definition has a condition and an effect:

- Deny: block non-compliant creates and updates (for example storage accounts with public blob access).
- Audit: allow but flag as non-compliant.
- Modify / Append: change the request, for example add a required tag.
- DeployIfNotExists: deploy a companion resource, such as diagnostic settings or a backup policy.

Group definitions into initiatives (policy sets), such as the Microsoft cloud security benchmark, and assign them at management group or subscription scope. Remediation tasks fix existing resources for Modify and DeployIfNotExists effects.

```json
{
  "if": {
    "field": "location",
    "notIn": ["centralindia", "southindia"]
  },
  "then": { "effect": "deny" }
}
```

```bash
az policy assignment create --name allowed-locations \
  --policy e56962a6-4747-49cd-b67b-bf8b01975c4c \
  --scope /providers/Microsoft.Management/managementGroups/corp \
  --params '{ "listOfAllowedLocations": { "value": ["centralindia","southindia"] } }'
```

- Pitfall: rolling out Deny directly can break pipelines; start in Audit, review compliance, then switch.

### Tags and naming conventions
<!-- level: basic; ref: https://learn.microsoft.com/azure/azure-resource-manager/management/tag-resources -->
Tags are name/value pairs on resources, resource groups and subscriptions. They are the main way to answer "who owns this, what does it cost, and can I delete it?"

Common tags: app, env, owner, costCenter, dataClassification, expiry (for temporary resources). Cost Management can group and filter spend by tag, and automation can act on tags (for example shut down VMs tagged autoShutdown=true).

Naming conventions matter because many names are global (storage accounts, web apps, Key Vaults form public DNS names) and cannot be changed later. A typical pattern is resource-type prefix, workload, environment, region and instance, such as app-orders-prod-cin-01 or stordersprodcin01 (storage names allow only lowercase letters and numbers, 3 to 24 characters).

```bash
az tag update --resource-id /subscriptions/<sub>/resourceGroups/rg-orders-prod \
  --operation Merge --tags owner=team-orders costCenter=CC-1042
```

- Tags are not inherited from resource groups by default; use Azure Policy (Modify effect, "inherit a tag from the resource group") to enforce it.
- Pitfall: never put secrets or personal data in tags; they are visible to anyone with Reader access and appear in billing exports.

### Resource locks
<!-- level: basic; ref: https://learn.microsoft.com/azure/azure-resource-manager/management/lock-resources -->
A resource lock protects resources from accidental changes, even by users with Owner rights. Locks apply to the control plane at subscription, resource group or resource scope, and inherit downward.

- CanNotDelete: resources can be read and modified but not deleted.
- ReadOnly: no control-plane writes or deletes at all.

Typical use: a CanNotDelete lock on production resource groups, the hub networking group and Key Vaults, so a mistyped az group delete fails instead of destroying production.

```bash
az lock create --name no-delete --lock-type CanNotDelete \
  --resource-group rg-orders-prod-cin \
  --notes "Production - remove only via change request"
```

Pitfalls worth knowing:

- ReadOnly has surprising side effects because some read-like operations are POST calls. For example, listing storage account keys is blocked, which can break the portal's storage browser, and a ReadOnly lock on an App Service blocks scaling and slot swaps.
- Locks do not stop data-plane operations: a CanNotDelete lock on a storage account will not stop someone deleting blobs. Use soft delete and immutability for data.
- Removing a lock requires Microsoft.Authorization/locks/delete, which Owners have, so locks are a safety net against mistakes, not against a malicious admin.

### Landing zones and the Cloud Adoption Framework
<!-- level: advanced; ref: https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/ -->
An Azure landing zone is a pre-built, governed environment that application teams deploy into. It is described by Microsoft's Cloud Adoption Framework and solves the problem of every team reinventing networking, identity, policy and logging.

A typical enterprise landing zone includes:

- A management group hierarchy (Platform: identity, management, connectivity; Landing zones: corp, online; Sandbox; Decommissioned).
- Platform subscriptions for central services: hub network with firewall and DNS, Log Analytics workspace, identity.
- Application landing zone subscriptions per workload or team, vended automatically ("subscription vending") with networking peered to the hub.
- Policy initiatives assigned at management group scope: allowed regions, required diagnostics, deny public IPs in corp, Defender for Cloud enabled.

```text
Tenant Root
 └─ contoso
     ├─ platform  (identity | management | connectivity)
     ├─ landingzones
     │    ├─ corp    (private only, peered to hub)
     │    └─ online  (internet-facing apps behind Front Door/App Gateway)
     └─ sandbox      (loose policy, budget caps)
```

Microsoft provides reference implementations in Bicep and Terraform (Azure Verified Modules) so you do not author this from scratch.

- Interview tip: landing zones separate platform team concerns from app team concerns, enabling autonomy within guardrails.
