/* Azure From Zero: chapter content. Parts: A Foundations, B Building blocks, C Running it well, D Bigger picture */
window.CH = [
/* ───────────────────────── 1 ───────────────────────── */
{
slug:'cloud', part:'A', title:'What the cloud actually is', mins:12,
one:'The cloud is renting computers, storage and ready-made software from someone else’s huge datacenter, and paying only for what you use.',
kid:`Think about electricity. You don’t build a power station at home. You plug into the wall and pay a monthly bill for what you used. Azure is the same idea for computers: instead of buying a server, you “plug in” to Microsoft’s datacenters and pay for the minutes you use.`,
body:`
<h3>Life before the cloud</h3>
<p>A company that wanted a new application used to buy servers, wait weeks for delivery, rack them in a server room, install the operating system, and keep someone on call to fix hardware. If traffic doubled during a sale, the servers were too small. The rest of the year, most of that hardware sat idle. Money was spent up front (<b>CapEx</b>, capital expenditure) whether it was used or not.</p>
<h3>What changes with the cloud</h3>
<ul>
<li><b>Pay as you go (OpEx).</b> You pay a running cost for what you use, like a phone bill. No big purchase.</li>
<li><b>Elasticity.</b> Capacity grows and shrinks automatically with demand. A Function App can go from 0 to 100 instances and back.</li>
<li><b>Scalability.</b> <i>Scale up</i> = a bigger machine (more CPU/RAM). <i>Scale out</i> = more machines of the same size. The cloud makes scale-out easy.</li>
<li><b>High availability.</b> Services are built from many machines in many buildings, so one failure doesn’t take you down.</li>
<li><b>Global reach.</b> Deploy close to users in minutes, in any of 60+ Azure regions.</li>
<li><b>Agility.</b> A new database takes minutes, not a purchase order.</li>
</ul>
<h3>The three service models</h3>
<p>The key question is always: <b>who manages which layer?</b> The pizza analogy works well. You can make pizza at home (on-premises), buy a take-and-bake kit (IaaS), get delivery (PaaS) or eat at the restaurant (SaaS).</p>
<div class="tw"><table>
<thead><tr><th>Layer</th><th>On-premises</th><th>IaaS</th><th>PaaS</th><th>SaaS</th></tr></thead>
<tbody>
<tr><td>Your data &amp; users</td><td class="you">You</td><td class="you">You</td><td class="you">You</td><td class="you">You</td></tr>
<tr><td>Application code</td><td class="you">You</td><td class="you">You</td><td class="you">You</td><td class="ms">Microsoft</td></tr>
<tr><td>Runtime (.NET, Python)</td><td class="you">You</td><td class="you">You</td><td class="ms">Microsoft</td><td class="ms">Microsoft</td></tr>
<tr><td>Operating system</td><td class="you">You</td><td class="you">You</td><td class="ms">Microsoft</td><td class="ms">Microsoft</td></tr>
<tr><td>Servers, network, storage</td><td class="you">You</td><td class="ms">Microsoft</td><td class="ms">Microsoft</td><td class="ms">Microsoft</td></tr>
<tr><td>Building, power, cooling</td><td class="you">You</td><td class="ms">Microsoft</td><td class="ms">Microsoft</td><td class="ms">Microsoft</td></tr>
<tr><td>Azure examples</td><td>Your server room</td><td>Virtual Machines, Disks, VNets</td><td>App Service, Functions, Azure SQL</td><td>Microsoft 365, Outlook, Teams</td></tr>
</tbody></table></div>
<p><b>Serverless</b> is a kind of PaaS where you don’t even pick a server size. You upload code, it runs when triggered, and you pay per execution. Azure Functions and Logic Apps are serverless.</p>
<h3>The shared responsibility model</h3>
<p>Security is split between you and Microsoft, and the split moves with the service model. Some things are <b>always yours</b>, no matter what: your <b>data</b>, your <b>identities and accounts</b>, your <b>devices</b>, and who gets access. Some things are <b>always Microsoft’s</b>: the physical datacenter, the physical network and the physical hosts.</p>
<h3>Deployment models</h3>
<ul>
<li><b>Public cloud</b>: shared Microsoft infrastructure, which is what most Azure is.</li>
<li><b>Private cloud</b>: infrastructure used by one organisation only, often in its own datacenter.</li>
<li><b>Hybrid</b>: on-premises plus cloud, connected. For example SAP on-premises talking to Azure Functions. <b>Azure Arc</b> lets you manage on-prem and other-cloud servers from Azure.</li>
<li><b>Multi-cloud</b>: using Azure plus AWS or Google Cloud together.</li>
</ul>`,
work:`Your Function Apps (CPD middleware, retry_cpd, the SAP→Unicommerce forwarder, the 17 apps moving to Python) are <b>serverless PaaS</b>. You never patch Windows or Linux on them. But the <b>code, the app settings and the secrets are 100% your side</b> of shared responsibility. That is why a middleware decorator logging secrets is your team’s problem to fix, not Microsoft’s.`,
terms:['IaaS','PaaS','SaaS','Serverless','CapEx','OpEx','Scale out','Shared responsibility'],
quiz:[
{q:'Azure SQL Database, where Microsoft patches the database engine and OS, is which model?',o:['IaaS','PaaS','SaaS','On-premises'],a:1,e:'You manage data and schema; Microsoft manages engine, OS and hardware. That is Platform as a Service.'},
{q:'In a SaaS app like Microsoft 365, who is responsible for who gets access to your files?',o:['Microsoft','You (the customer)','Nobody','Your internet provider'],a:1,e:'Data, identities and access are always the customer’s responsibility, in every model.'},
{q:'Your API is slow under load, so you add 3 more identical instances. What is that called?',o:['Scale up','Scale out','Failover','Lift and shift'],a:1,e:'More instances = scale out (horizontal). A bigger instance = scale up (vertical).'},
{q:'Moving from buying servers to paying a monthly cloud bill shifts spending from…',o:['OpEx to CapEx','CapEx to OpEx','OpEx to OpEx','It does not change'],a:1,e:'Up-front purchases are capital expenditure; pay-as-you-go is operational expenditure.'}
],
teach:'Explain to a friend who is not in IT why a company would rent servers instead of buying them. Use one example from your own job.'
},
/* ───────────────────────── 2 ───────────────────────── */
{
slug:'global', part:'A', title:'Regions, zones and the world map', mins:10,
one:'Azure is a worldwide network of datacenters grouped into regions; inside many regions are separate “availability zones” so one building failure doesn’t stop you.',
kid:`Imagine a chain of giant warehouses spread across the world. A city with several warehouses is a <b>region</b>. Inside a region, warehouses in separate buildings with their own power, cooling and network are <b>availability zones</b>. If one building floods, the others keep working. Each region also has a “twin” city far away (its <b>pair</b>) for emergencies.`,
body:`
<h3>The building blocks of geography</h3>
<ul>
<li><b>Datacenter</b>: a physical building full of servers. You never pick one directly.</li>
<li><b>Region</b>: a set of datacenters close together, connected by a very fast, low-latency network. You choose a region for every resource, for example <i>Central India</i> (Pune), <i>South India</i> (Chennai), <i>West India</i> (Mumbai). Azure has 60+ regions.</li>
<li><b>Availability Zone (AZ)</b>: one or more datacenters in a region with independent power, cooling and networking. Zone-enabled regions have <b>at least three</b> zones, so a fire in one zone leaves two running.</li>
<li><b>Region pair</b>: many regions are paired with another region in the same geography, usually hundreds of km away. Central India is paired with South India. Microsoft updates paired regions one at a time, prioritises recovering one of each pair in a big outage, and geo-redundant storage copies data to the pair. Some newer regions have no pair and rely on zones instead.</li>
<li><b>Geography</b>: a market such as India or Europe, usually with data-residency rules. Data stays inside the geography unless you move it.</li>
<li><b>Sovereign clouds</b>: physically separate Azure instances for governments, such as Azure Government (US) and Azure operated by 21Vianet (China).</li>
</ul>
<h3>Zonal, zone-redundant and regional services</h3>
<div class="tw"><table>
<thead><tr><th>Kind</th><th>What it means</th><th>Example</th></tr></thead>
<tbody>
<tr><td>Zonal</td><td>You pin the resource to one zone you choose</td><td>A VM in zone 2</td></tr>
<tr><td>Zone-redundant</td><td>Azure spreads it across zones for you automatically</td><td>ZRS storage, zone-redundant SQL Database, Premium Service Bus</td></tr>
<tr><td>Non-regional (global)</td><td>Runs everywhere, no region to pick</td><td>Microsoft Entra ID, Front Door, Azure DNS</td></tr>
</tbody></table></div>
<h3>How to choose a region</h3>
<ol>
<li><b>Latency</b>: close to your users and to the systems you call (SAP, DMS, partners).</li>
<li><b>Compliance</b>: laws may require data to stay in a country, such as India’s DPDP Act.</li>
<li><b>Service availability</b>: not every service or VM size exists in every region.</li>
<li><b>Price</b>: the same VM can cost different amounts in different regions.</li>
<li><b>Zones and pairs</b>: does the region support availability zones, and what is its pair for DR?</li>
</ol>
<div class="note">Edge locations are a separate thing. Services like Front Door and CDN cache content in hundreds of “points of presence” worldwide, much closer to users than regions.</div>`,
work:`Every one of your resources has a <b>Location</b>. To see where your estate lives, run this in PowerShell with the Azure CLI:<pre><code>az resource list --query "[].location" -o tsv | Group-Object | Select-Object Name, Count</code></pre>Region matters for your work: partner IP whitelists (a NAT IP belongs to one region), latency to SAP/DMS, and where a DR copy would live.`,
terms:['Region','Availability zone','Region pair','Geography','Latency'],
quiz:[
{q:'What is an availability zone?',o:['A country where Azure operates','A physically separate datacenter group inside one region with its own power, cooling and network','A backup copy of your data','A discount plan'],a:1,e:'Zones are independent failure domains inside a region.'},
{q:'A zone-enabled region has at least how many availability zones?',o:['1','2','3','10'],a:2,e:'Three, so losing one still leaves a majority running.'},
{q:'Which is a reason region pairs exist?',o:['To make the portal faster','Platform updates roll out to one region of a pair at a time','To give free storage','To block other countries'],a:1,e:'Sequential updates and prioritised recovery reduce the chance both regions fail together.'},
{q:'Which factor matters least when choosing a region?',o:['Distance to users','Data residency law','Whether the service exists there','The name of your resource group'],a:3,e:'Resource group names have nothing to do with region choice.'}
],
teach:'Draw (on paper) one region with three zones and its paired region. Mark where a ZRS copy and a GRS copy of your data would live.'
},
/* ───────────────────────── 3 ───────────────────────── */
{
slug:'hierarchy', part:'A', title:'How Azure is organised', mins:14,
one:'Everything in Azure sits in a tree: tenant → management groups → subscriptions → resource groups → resources, and every action is an API call to Azure Resource Manager.',
kid:`Think of a school. The <b>school</b> is the tenant (your Microsoft Entra directory). <b>Departments</b> are management groups. Each <b>class</b> has its own budget: that is a subscription. Inside a class, students sit at <b>tables</b>: those are resource groups. Each student’s bag and books are <b>resources</b>. Rules made by the principal apply to every department, class and table below.`,
body:`
<h3>The five levels</h3>
<div class="tw"><table>
<thead><tr><th>Level</th><th>What it is for</th><th>Key facts</th></tr></thead>
<tbody>
<tr><td><b>Tenant</b> (Entra ID directory)</td><td>Your organisation’s identity boundary</td><td>Holds users, groups and apps. Has a domain like <code>contoso.onmicrosoft.com</code>.</td></tr>
<tr><td><b>Management group</b></td><td>Group subscriptions to apply policy and access at scale</td><td>Up to 6 levels deep under the root. Example: Root → Prod / Non-prod.</td></tr>
<tr><td><b>Subscription</b></td><td>Billing boundary, access boundary and quota boundary</td><td>Every resource belongs to one subscription. Separate subscriptions are common for prod and non-prod.</td></tr>
<tr><td><b>Resource group (RG)</b></td><td>A folder of resources that share a lifecycle</td><td>A resource lives in exactly one RG. <b>Deleting an RG deletes everything inside it.</b> Resources can be in a different region from their RG.</td></tr>
<tr><td><b>Resource</b></td><td>The actual thing: a Function App, a database, a VNet</td><td>Has a type, a region, tags and a unique resource ID.</td></tr>
</tbody></table></div>
<p><b>Inheritance:</b> access (RBAC) and Azure Policy assigned at a higher level flow down. Give someone Reader on a subscription and they can read every RG inside it.</p>
<h3>Azure Resource Manager (ARM)</h3>
<p>The portal, the <code>az</code> CLI, PowerShell, Terraform and Bicep are all just different front doors. Every one of them sends a REST call to <b>https://management.azure.com</b>. ARM then:</p>
<ol>
<li>checks who you are with Entra ID (authentication),</li>
<li>checks your RBAC role at that scope (authorisation),</li>
<li>checks Azure Policy (is this allowed?),</li>
<li>passes the request to the <b>resource provider</b>, such as <code>Microsoft.Web</code> (App Service and Functions), <code>Microsoft.Sql</code>, <code>Microsoft.ServiceBus</code>, <code>Microsoft.Network</code> or <code>Microsoft.Logic</code>.</li>
</ol>
<p>This is called the <b>control plane</b>: creating, configuring and deleting things. Reading the <i>contents</i> of a database or blob is the <b>data plane</b>, and it often has separate permissions.</p>
<h3>Anatomy of a resource ID</h3>
<pre><code>/subscriptions/1111-2222-3333/resourceGroups/PLATFORM-FAPP-UAT-RG/providers/Microsoft.Web/sites/my-function-app
 └ subscription ┘             └ resource group ┘                 └ provider ┘  └type┘ └ name ┘</code></pre>
<p>Learn to read these. Error messages, Activity Log entries and RBAC assignments all use them.</p>
<h3>Tags, locks and naming</h3>
<ul>
<li><b>Tags</b>: key/value labels such as <code>env=uat</code>, <code>owner=integration</code>, <code>costCenter=1234</code>. Used for cost reports and automation. Resources do not inherit tags from their RG automatically; Azure Policy can enforce that.</li>
<li><b>Locks</b>: <code>CanNotDelete</code> (can change, can’t delete) or <code>ReadOnly</code> (can’t change or delete). Locks apply even to Owners. Put one on production RGs.</li>
<li><b>Naming</b>: Microsoft’s Cloud Adoption Framework suggests <code>&lt;type&gt;-&lt;workload&gt;-&lt;env&gt;-&lt;region&gt;-&lt;nn&gt;</code>, for example <code>func-sap2uc-uat-cin-01</code>. Your org uses its own pattern (<code>re-fapp-…-uat</code>). Consistency matters more than the exact pattern.</li>
<li><b>Quotas and limits</b>: each subscription has limits, such as vCPUs per region. When a deployment fails with “quota exceeded”, you request an increase.</li>
<li><b>Resource providers</b> must be registered on a subscription before use. Most common ones are registered already.</li>
</ul>`,
work:`When you “read live config via ARM”, you are calling the control plane directly. Try reading a Function App’s settings the way the portal does:<pre><code>az functionapp show -n &lt;app&gt; -g &lt;rg&gt; --query "{state:state, kind:kind, location:location, plan:serverFarmId}"</code></pre>The <code>serverFarmId</code> is itself a resource ID. Read it and you can tell which plan the app runs on.`,
terms:['Tenant','Management group','Subscription','Resource group','Azure Resource Manager','Resource provider','Control plane','Data plane','Tag','Resource lock'],
quiz:[
{q:'You delete a resource group that contains 12 resources. What happens?',o:['Only the RG metadata is deleted','All 12 resources are deleted too','Resources move to a default RG','Nothing; RGs cannot be deleted'],a:1,e:'The RG is a lifecycle container. Delete it and everything inside goes too, unless a lock blocks it.'},
{q:'Which level is the billing boundary?',o:['Resource group','Subscription','Tag','Resource'],a:1,e:'Costs are invoiced per subscription (rolled up to a billing account).'},
{q:'Can one resource belong to two resource groups?',o:['Yes','No','Only VMs can','Only in different regions'],a:1,e:'A resource belongs to exactly one RG. You can move it, but not share it.'},
{q:'Which lock lets you change a resource but not delete it?',o:['ReadOnly','CanNotDelete','DeleteOnly','NoChange'],a:1,e:'CanNotDelete allows updates and blocks deletion.'},
{q:'The portal, CLI and Terraform all talk to which endpoint?',o:['portal.azure.com','management.azure.com','login.microsoftonline.com','azure.microsoft.com'],a:1,e:'All management requests go through Azure Resource Manager at management.azure.com. login.microsoftonline.com issues the tokens.'}
],
teach:'Take one real resource ID from your work and label each part out loud: subscription, resource group, provider, type, name.'
},
/* ───────────────────────── 4 ───────────────────────── */
{
slug:'identity', part:'A', title:'Identity, access and secrets', mins:18,
one:'Microsoft Entra ID proves who someone is; Azure RBAC decides what they can do; Key Vault and managed identities keep passwords out of your code.',
kid:`Entra ID is the school’s ID-card office. <b>Authentication</b> is showing your card at the gate: “who are you?”. <b>Authorisation</b> is the list of rooms your card opens: “what may you do?”. A <b>managed identity</b> is an ID card the school gives a robot, so the robot never has to carry a written password that someone could steal.`,
body:`
<h3>Microsoft Entra ID</h3>
<p>Entra ID (renamed from <i>Azure Active Directory</i> in 2023) is Microsoft’s cloud identity service. It signs people into the Azure portal, Microsoft 365 and thousands of other apps. It holds:</p>
<ul>
<li><b>Users</b>: employees. <b>Guests</b> (B2B) are people from other organisations invited in.</li>
<li><b>Groups</b>: give access to a group, not to 40 individual people.</li>
<li><b>App registrations and service principals</b>: identities for software (see below).</li>
<li><b>Devices</b>: laptops joined or registered to the tenant.</li>
</ul>
<p><b>Microsoft Entra External ID</b> handles sign-in for your <i>customers</i> (consumer apps). It succeeds Azure AD B2C.</p>
<h3>Proving who you are</h3>
<ul>
<li><b>MFA</b> (multi-factor authentication): something you know (password) plus something you have (phone app) or are (fingerprint).</li>
<li><b>Passwordless</b>: Authenticator app, FIDO2 keys, Windows Hello.</li>
<li><b>Conditional Access</b>: “if-then” rules. <i>If</i> a user signs in to the Azure portal from outside India <i>then</i> require MFA and a compliant device. Signals in, decision out.</li>
<li><b>PIM</b> (Privileged Identity Management): admins are not admins all the time. They “activate” a role for 2 hours with a reason, and it expires.</li>
</ul>
<h3>Identities for software</h3>
<div class="tw"><table>
<thead><tr><th>Thing</th><th>Plain meaning</th><th>Credential</th></tr></thead>
<tbody>
<tr><td>App registration</td><td>The global definition of an app (its blueprint)</td><td>—</td></tr>
<tr><td>Service principal</td><td>That app’s identity inside your tenant (shown as an “Enterprise application”)</td><td>Client secret, certificate, or federated credential</td></tr>
<tr><td>Managed identity, system-assigned</td><td>An identity created <i>for</i> one resource; deleted when the resource is deleted</td><td>None to manage. Azure rotates it.</td></tr>
<tr><td>Managed identity, user-assigned</td><td>A standalone identity you create and attach to several resources</td><td>None to manage</td></tr>
<tr><td>Workload identity federation</td><td>Lets GitHub Actions or Kubernetes sign in without any stored secret</td><td>Trusted token from the other system</td></tr>
</tbody></table></div>
<p>Rule of thumb: <b>if the code runs in Azure, use a managed identity.</b> No secret to leak, expire or rotate.</p>
<h3>Azure RBAC: who can do what, where</h3>
<p>A <b>role assignment</b> has three parts. Remember <i>who / what / where</i>:</p>
<ul>
<li><b>Security principal</b> (who): a user, group, service principal or managed identity.</li>
<li><b>Role definition</b> (what): a list of allowed actions.</li>
<li><b>Scope</b> (where): management group, subscription, resource group or a single resource.</li>
</ul>
<div class="tw"><table>
<thead><tr><th>Built-in role</th><th>Can do</th></tr></thead>
<tbody>
<tr><td>Owner</td><td>Everything, <b>including granting access</b> to others</td></tr>
<tr><td>Contributor</td><td>Create and manage everything, but cannot grant access</td></tr>
<tr><td>Reader</td><td>View only</td></tr>
<tr><td>User Access Administrator</td><td>Only manage who has access</td></tr>
<tr><td>Key Vault Secrets User</td><td>Read secret values (data plane)</td></tr>
<tr><td>Storage Blob Data Reader / Contributor</td><td>Read / write blob contents (data plane)</td></tr>
<tr><td>Azure Service Bus Data Sender / Receiver</td><td>Send / receive messages</td></tr>
</tbody></table></div>
<div class="note"><b>Two separate role systems.</b> <i>Azure roles</i> (Owner, Contributor…) control Azure resources. <i>Entra roles</i> (Global Administrator, User Administrator…) control the directory itself: users, groups, licences. Being Global Admin does not automatically give you access to subscriptions.</div>
<p><b>Least privilege</b>: give the smallest role, at the smallest scope, for the shortest time.</p>
<h3>Azure Key Vault</h3>
<p>A secure vault for <b>secrets</b> (passwords, connection strings), <b>keys</b> (encryption keys) and <b>certificates</b> (TLS certs). Important features:</p>
<ul>
<li><b>Access</b> through Azure RBAC (recommended) or older “access policies”.</li>
<li><b>Soft delete</b> keeps deleted secrets recoverable for a retention period. <b>Purge protection</b> stops anyone permanently deleting them early.</li>
<li><b>Versions</b>: every update creates a new version, so you can roll back.</li>
<li><b>Key Vault references</b>: an App Service or Function App setting can point at a secret instead of containing it:</li>
</ul>
<pre><code>UNIWARE_PASSWORD = @Microsoft.KeyVault(VaultName=kv-integration-uat;SecretName=uniware-password)</code></pre>
<p>The app’s managed identity needs <b>Key Vault Secrets User</b> on the vault. If the reference shows a red error in the portal, it is almost always a missing role, a firewall on the vault, or a typo in the secret name.</p>`,
work:`Three real lessons from your own work. (1) Secrets found inside compiled .NET DLLs during the Python migration. (2) A middleware decorator that wrote secrets into logs. (3) A partner password pasted into a chat. The fix pattern is the same every time: <b>move the secret to Key Vault → give the app a managed identity with Key Vault Secrets User → use a Key Vault reference → rotate the exposed value.</b> After rotation the old value is useless, even if someone kept a copy.`,
terms:['Microsoft Entra ID','MFA','Conditional Access','PIM','Service principal','Managed identity','RBAC','Role assignment','Least privilege','Key Vault','Key Vault reference'],
quiz:[
{q:'A role assignment is made of which three parts?',o:['User, password, region','Security principal, role definition, scope','Subscription, tag, lock','Tenant, app, secret'],a:1,e:'Who (principal), what (role), where (scope).'},
{q:'When is a system-assigned managed identity deleted?',o:['Never','Every 90 days','When the resource it belongs to is deleted','When the password expires'],a:2,e:'Its lifecycle is tied to the resource. Use a user-assigned identity if you need one that outlives a resource.'},
{q:'Your Function App must read a password from Key Vault. Which role is the right minimum?',o:['Owner','Contributor','Key Vault Secrets User','Global Administrator'],a:2,e:'Secrets User can read secret values and nothing more. Contributor manages the vault but, with RBAC mode, cannot read secrets.'},
{q:'What can an Owner do that a Contributor cannot?',o:['Delete resources','Create VMs','Grant access to other people','Read the Activity Log'],a:2,e:'Contributors manage resources but cannot assign roles.'},
{q:'“Require MFA when signing in from outside the corporate network” is an example of…',o:['Azure Policy','Conditional Access','A resource lock','Network Security Group'],a:1,e:'Conditional Access evaluates sign-in signals and enforces controls such as MFA.'}
],
teach:'In your own words: why is a managed identity safer than a client secret stored in an app setting?'
},
/* ───────────────────────── 5 ───────────────────────── */
{
slug:'compute', part:'B', title:'Compute: where code runs', mins:22,
one:'Compute services run your code. They range from full virtual machines you manage yourself to serverless Functions that appear only when an event arrives.',
kid:`Ways to cook food. A <b>VM</b> is renting an empty kitchen: you bring the stove, the pans, and you clean up. <b>App Service</b> is a restaurant kitchen that is ready; you bring only your recipe. <b>Functions</b> is a cook who appears only when an order arrives, cooks one dish, and leaves, and you pay per dish. <b>Containers</b> are lunchboxes: food packed so it tastes the same in any kitchen. <b>AKS</b> is a manager running hundreds of lunchbox kitchens at once.`,
body:`
<h3>Virtual Machines (IaaS)</h3>
<p>A VM is a full computer (Windows or Linux) that you control. You pick a <b>size</b> and you manage the OS, patches, antivirus and software.</p>
<div class="tw"><table>
<thead><tr><th>Series</th><th>Good for</th></tr></thead>
<tbody>
<tr><td>B (burstable)</td><td>Low, spiky load: dev boxes, small sites. Cheap.</td></tr>
<tr><td>D</td><td>General purpose, balanced CPU and memory</td></tr>
<tr><td>E / M</td><td>Memory heavy: databases, SAP HANA (M = very large)</td></tr>
<tr><td>F</td><td>CPU heavy: batch, gaming servers</td></tr>
<tr><td>L</td><td>Storage heavy: fast local disks</td></tr>
<tr><td>N</td><td>GPU: AI training, graphics</td></tr>
</tbody></table></div>
<ul>
<li><b>Disks</b>: an OS disk, optional data disks, and a temporary disk that is <b>wiped</b> on redeploy. Never keep data on the temp disk.</li>
<li><b>Availability</b>: spread VMs across <b>availability zones</b> (or an older <i>availability set</i>) so one failure doesn’t take all of them down.</li>
<li><b>VM Scale Sets (VMSS)</b>: a group of identical VMs that autoscale by rules (e.g. add a VM when CPU &gt; 70%).</li>
<li><b>Spot VMs</b>: spare capacity at up to 90% discount, but Azure can evict them at short notice. Good for batch jobs only.</li>
<li><b>Azure Bastion</b>: connect to VMs over RDP/SSH from the portal without giving them public IPs.</li>
<li><b>Azure Update Manager</b>: schedule OS patching across VMs.</li>
</ul>
<h3>App Service (PaaS)</h3>
<p>Hosts web apps and APIs (.NET, Java, Node, Python, PHP, or a container). You pick an <b>App Service plan</b>: the set of VMs your apps share, and how big they are.</p>
<ul>
<li><b>Plan tiers</b>: Free/Shared (testing), Basic, Standard, Premium v3 (production, autoscale, slots), Isolated v2 (runs in your own App Service Environment inside a VNet).</li>
<li><b>Deployment slots</b>: a “staging” copy of the app with its own URL. Deploy there, test, then <b>swap</b> into production with no downtime. Settings marked “slot setting” stay with the slot.</li>
<li><b>Kudu / SCM site</b>: <code>https://&lt;app&gt;.scm.azurewebsites.net</code>. Debug console, log stream, environment variables, deployed files (e.g. <code>data/SitePackages</code>).</li>
<li>Custom domains, managed TLS certificates, autoscale, built-in authentication (“Easy Auth”).</li>
</ul>
<h3>Azure Functions (serverless)</h3>
<p>Small pieces of code that run when something happens. Two ideas to learn:</p>
<ul>
<li><b>Trigger</b>: what starts the function. Exactly one per function. HTTP, Timer (CRON with 6 fields: <code>0 */5 * * * *</code> = every 5 minutes), Service Bus queue/topic, Storage queue, Blob, Event Grid, Event Hubs, Cosmos DB change feed.</li>
<li><b>Bindings</b>: declarative input/output connections. An output binding to Service Bus sends a message without you writing client code.</li>
</ul>
<div class="tw"><table>
<thead><tr><th>Hosting plan</th><th>Scale</th><th>Cold start</th><th>VNet</th><th>Timeout</th><th>Pay for</th></tr></thead>
<tbody>
<tr><td><b>Flex Consumption</b> (current default)</td><td>0 → many, fast, per-function</td><td>Optional “always ready” instances</td><td>Yes</td><td>30 min default, can be unbounded</td><td>Executions + memory time, plus always-ready</td></tr>
<tr><td>Consumption (classic)</td><td>0 → 200 (Windows)</td><td>Yes</td><td>No</td><td>5 min default, 10 max</td><td>Executions + GB-seconds</td></tr>
<tr><td>Premium (Elastic Premium)</td><td>Pre-warmed → many</td><td>No</td><td>Yes</td><td>30 min default, unbounded</td><td>Instances, always at least 1</td></tr>
<tr><td>Dedicated (App Service plan)</td><td>Your plan’s VMs</td><td>No if Always On</td><td>Yes</td><td>Unbounded</td><td>The plan</td></tr>
</tbody></table></div>
<ul>
<li><b>HTTP limit</b>: whatever the plan timeout, an HTTP-triggered call must respond within about <b>230 seconds</b> (the front-end load balancer limit). For long work, return 202 and continue asynchronously.</li>
<li><b>Key settings</b>: <code>FUNCTIONS_EXTENSION_VERSION</code> (<code>~4</code>), <code>FUNCTIONS_WORKER_RUNTIME</code> (<code>dotnet-isolated</code>, <code>python</code>, <code>node</code>…), <code>AzureWebJobsStorage</code> (the storage account the host needs).</li>
<li><b>Durable Functions</b>: write stateful workflows in code, such as fan-out/fan-in, chaining and waiting for human approval. The state is checkpointed to storage.</li>
<li>Languages: C#, JavaScript/TypeScript, Python, Java, PowerShell, or anything via custom handlers.</li>
</ul>
<h3>Containers</h3>
<p>A <b>container</b> packages an app with everything it needs, so it runs the same on a laptop and in the cloud. Images are stored in <b>Azure Container Registry (ACR)</b>.</p>
<ul>
<li><b>Azure Container Instances (ACI)</b>: run one container quickly with no servers. Good for short jobs.</li>
<li><b>Azure Container Apps</b>: serverless containers with autoscale (including to zero), revisions, traffic splitting, KEDA-based event scaling and Dapr. It is Kubernetes underneath, but you never touch Kubernetes.</li>
<li><b>Azure Kubernetes Service (AKS)</b>: managed Kubernetes. Azure runs the control plane; you run node pools, upgrades, networking and add-ons. Powerful, and it needs real platform skill.</li>
</ul>
<h3>Other compute</h3>
<ul>
<li><b>Static Web Apps</b>: HTML/JS front ends with global hosting and an optional Functions API.</li>
<li><b>Azure Batch</b>: run thousands of parallel compute jobs.</li>
<li><b>Azure Virtual Desktop</b>: Windows desktops streamed to users.</li>
<li><b>Azure VMware Solution</b>: run VMware workloads on Azure hardware.</li>
</ul>
<div data-widget="chooser"></div>`,
work:`Your .NET→Python migration changes <code>FUNCTIONS_WORKER_RUNTIME</code> from <code>dotnet-isolated</code> (or the older in-process <code>dotnet</code>) to <code>python</code>, plus the Python version. Python Functions run on <b>Linux</b>, so Windows-only habits (Kudu’s CMD console, Windows paths) change too. Your SAP→Unicommerce forwarder is on <b>Flex Consumption</b>: it scales to zero, supports VNet integration, but does <b>not</b> support deployment slots.`,
terms:['Virtual machine','VM Scale Set','Spot VM','App Service plan','Deployment slot','Kudu','Azure Functions','Trigger','Binding','Flex Consumption','Cold start','Durable Functions','Container','Container Apps','AKS'],
quiz:[
{q:'A function must call a slow partner API that takes 6 minutes. It is triggered over HTTP. What is the main risk?',o:['None, Flex allows 30 minutes','The HTTP request will be cut off at about 230 seconds','Functions cannot call APIs','It will run on Windows'],a:1,e:'The load balancer drops HTTP requests after ~230 s regardless of plan timeout. Use an async pattern: queue the work, return 202, or use Durable Functions.'},
{q:'Which compute option gives you full control of the operating system?',o:['Azure Functions','App Service','Virtual Machines','Logic Apps'],a:2,e:'VMs are IaaS. You own the OS.'},
{q:'What is a deployment slot used for?',o:['Storing secrets','Deploying to a staging copy, testing, then swapping into production with no downtime','Choosing a region','Limiting CPU'],a:1,e:'Slots allow warm-up and instant swap (and swap back if something breaks).'},
{q:'You want to run containers that scale to zero without learning Kubernetes. Best fit?',o:['AKS','Azure Container Apps','VM Scale Sets','Azure Batch'],a:1,e:'Container Apps is serverless containers. AKS gives full Kubernetes but requires managing it.'},
{q:'Which data must never be kept on a VM’s temporary disk?',o:['Page file','Cache that can be rebuilt','Anything you cannot afford to lose','Temp files'],a:2,e:'The temp disk can be wiped during maintenance or redeploy.'}
],
teach:'Pick three of your own apps. For each, say which compute service it uses and why that was (or wasn’t) the right choice.'
},
/* ───────────────────────── 6 ───────────────────────── */
{
slug:'storage', part:'B', title:'Storage accounts, blobs and disks', mins:15,
one:'A storage account is a cheap, massively durable place to keep files, messages and simple tables, with tiers and redundancy options you choose.',
kid:`A storage account is a giant locker building. <b>Blob</b> is a big box for anything: photos, PDFs, backups. <b>Files</b> is a shared cupboard everyone opens like a network drive. <b>Queue</b> is a line of sticky notes waiting to be handled. <b>Table</b> is a simple notebook of rows. <b>Disks</b> are the hard drives plugged into VMs.`,
body:`
<h3>The storage account</h3>
<p>One account gives you four services under a <b>globally unique</b> name, each with its own endpoint:</p>
<pre><code>https://&lt;account&gt;.blob.core.windows.net    Blob
https://&lt;account&gt;.file.core.windows.net    Files
https://&lt;account&gt;.queue.core.windows.net   Queue
https://&lt;account&gt;.table.core.windows.net   Table</code></pre>
<p>Use <b>Standard general-purpose v2</b> for almost everything. Premium accounts (block blob, file shares, page blobs) are for low-latency needs.</p>
<h3>Blob storage</h3>
<ul>
<li>Data sits in <b>containers</b> (like top-level folders). Blob types: <b>block</b> (normal files), <b>append</b> (logs), <b>page</b> (VM disks).</li>
<li><b>Data Lake Storage Gen2</b>: enable the hierarchical namespace for real folders and big-data analytics.</li>
<li><b>Lifecycle management</b>: rules like “move to Cool after 30 days, delete after 365”.</li>
<li><b>Protection</b>: soft delete, versioning, point-in-time restore, immutable (WORM) storage for legal holds.</li>
<li><b>Static website</b> hosting straight from a <code>$web</code> container.</li>
</ul>
<div class="tw"><table>
<thead><tr><th>Access tier</th><th>Storage price</th><th>Read price</th><th>Minimum days</th><th>Use for</th></tr></thead>
<tbody>
<tr><td>Hot</td><td>Highest</td><td>Lowest</td><td>—</td><td>Data used often</td></tr>
<tr><td>Cool</td><td>Lower</td><td>Higher</td><td>30</td><td>Infrequent, e.g. last month’s reports</td></tr>
<tr><td>Cold</td><td>Lower still</td><td>Higher</td><td>90</td><td>Rarely read, still online</td></tr>
<tr><td>Archive</td><td>Lowest</td><td>Highest + hours to rehydrate</td><td>180</td><td>Compliance copies, old backups (offline)</td></tr>
</tbody></table></div>
<h3>Redundancy: how many copies, where</h3>
<div class="tw"><table>
<thead><tr><th>Option</th><th>Copies</th><th>Survives</th></tr></thead>
<tbody>
<tr><td><b>LRS</b> Locally redundant</td><td>3 in one datacenter</td><td>A disk or rack failure</td></tr>
<tr><td><b>ZRS</b> Zone redundant</td><td>3 across 3 zones</td><td>A whole zone going down</td></tr>
<tr><td><b>GRS</b> Geo redundant</td><td>LRS here + LRS in the paired region (async)</td><td>A whole region going down</td></tr>
<tr><td><b>GZRS</b> Geo-zone redundant</td><td>ZRS here + LRS in the pair</td><td>Zone and region failures</td></tr>
<tr><td><b>RA-GRS / RA-GZRS</b></td><td>As above, plus you can <i>read</i> the secondary anytime</td><td>Same, with read access during an outage</td></tr>
</tbody></table></div>
<h3>Files, queues, tables, disks</h3>
<ul>
<li><b>Azure Files</b>: SMB/NFS file shares you can mount from Windows, Linux or macOS. <b>Azure File Sync</b> caches them on on-prem servers.</li>
<li><b>Queue storage</b>: simple queue, messages up to 64 KB. Cheaper and simpler than Service Bus, but with no topics, sessions or dead-letter queue of its own.</li>
<li><b>Table storage</b>: NoSQL key-value. Every row has a <code>PartitionKey</code> and <code>RowKey</code>.</li>
<li><b>Managed disks</b> for VMs: Standard HDD, Standard SSD, Premium SSD, Premium SSD v2, Ultra Disk (fastest).</li>
</ul>
<h3>Securing access</h3>
<ul>
<li><b>Account keys</b> give full access to everything. Avoid using them; you can disable them entirely.</li>
<li><b>SAS tokens</b> (shared access signatures): time-limited URLs with specific permissions. A <i>user delegation SAS</i> signed with Entra credentials is the safest kind.</li>
<li><b>Entra ID + RBAC</b>: e.g. a managed identity with Storage Blob Data Reader. Best for apps.</li>
<li><b>Network</b>: storage firewall, private endpoints.</li>
<li><b>Encryption at rest</b> is always on (Microsoft-managed keys, or your own customer-managed keys in Key Vault).</li>
</ul>
<p>Tools: <b>Azure Storage Explorer</b> (desktop app) and <b>AzCopy</b> (fast command-line copy).</p>`,
work:`Every Function App has a partner storage account in its <code>AzureWebJobsStorage</code> setting. The host uses it for keys, timer locks, trigger checkpoints and, on Flex, the deployment package. If that account is deleted, firewalled off, or its key rotated without updating the setting, the <b>whole Function App stops starting</b>, even though your code didn’t change. Check it early when a function host is “down”.`,
terms:['Storage account','Blob','Access tier','LRS','ZRS','GRS','SAS token','Lifecycle management','Data Lake Storage Gen2'],
quiz:[
{q:'You must keep invoices for 7 years and will almost never read them. Cheapest tier?',o:['Hot','Cool','Cold','Archive'],a:3,e:'Archive is cheapest to store. Reads are slow and expensive, which is fine for rare compliance access.'},
{q:'Which redundancy keeps data available if one availability zone fails, without copying to another region?',o:['LRS','ZRS','GRS','RA-GRS'],a:1,e:'ZRS spreads three copies across three zones in one region.'},
{q:'The safest way for a Function App to read blobs is…',o:['Put the account key in code','A managed identity with Storage Blob Data Reader','Make the container public','Email the SAS token'],a:1,e:'No secret to leak, least privilege, auditable.'},
{q:'What is a SAS token?',o:['An encryption algorithm','A time-limited, permission-limited URL for storage access','A type of disk','A storage tier'],a:1,e:'Shared Access Signature: grants scoped access without sharing account keys.'}
],
teach:'Explain LRS vs GRS to a non-IT colleague using a “photo album” analogy.'
},
/* ───────────────────────── 7 ───────────────────────── */
{
slug:'databases', part:'B', title:'Databases', mins:16,
one:'Azure runs databases for you: Azure SQL for relational data, Cosmos DB for globally distributed NoSQL, plus PostgreSQL, MySQL and Redis.',
kid:`A database is a super-organised filing cabinet. A <b>SQL database</b> is a cabinet with strict forms: every row must fill in the same boxes, and the boxes can be linked (a booking links to a customer). <b>Cosmos DB</b> is a flexible cabinet that accepts papers of different shapes and keeps copies in many cities, so everyone nearby can read quickly.`,
body:`
<h3>Relational vs NoSQL</h3>
<p><b>Relational</b> (SQL): tables with fixed columns, relationships through keys, strong consistency, and transactions. Great for bookings, orders and invoices. <b>NoSQL</b>: flexible documents or key-value pairs, designed to scale out massively. Great for catalogues, IoT data, user profiles and chat history.</p>
<h3>The Azure SQL family</h3>
<div class="tw"><table>
<thead><tr><th>Option</th><th>What it is</th><th>Choose when</th></tr></thead>
<tbody>
<tr><td><b>Azure SQL Database</b></td><td>A single managed database (or an <i>elastic pool</i> of databases sharing resources)</td><td>New cloud apps. Least admin work.</td></tr>
<tr><td><b>Azure SQL Managed Instance</b></td><td>A full managed SQL Server instance inside your VNet</td><td>Migrating SQL Server apps that need SQL Agent, cross-database queries, CLR and so on</td></tr>
<tr><td><b>SQL Server on Azure VM</b></td><td>You install and run SQL Server yourself</td><td>You need OS-level control or a feature PaaS doesn’t support</td></tr>
</tbody></table></div>
<p><b>Buying models for SQL Database:</b></p>
<ul>
<li><b>DTU</b>: a simple bundle of CPU, memory and IO (Basic, Standard S0–S12, Premium).</li>
<li><b>vCore</b>: choose cores and memory separately. Tiers: <b>General Purpose</b> (balanced), <b>Business Critical</b> (local SSD, built-in replicas, fastest), <b>Hyperscale</b> (up to 100+ TB, fast scale). <b>Serverless</b> auto-scales and can pause when idle.</li>
</ul>
<p><b>Built-in features:</b> automatic backups with <b>point-in-time restore</b> (1–35 days, default 7), long-term retention up to 10 years, geo-replication and <b>failover groups</b>, Transparent Data Encryption, Entra ID authentication, server firewall rules, private endpoints, automatic tuning, Query Performance Insight.</p>
<h3>Azure Cosmos DB</h3>
<ul>
<li><b>APIs</b>: NoSQL (native), MongoDB, Apache Cassandra, Apache Gremlin (graph), Table, and PostgreSQL (distributed).</li>
<li><b>Request Units (RU/s)</b>: the currency of Cosmos. A 1 KB point read costs 1 RU. Choose <b>provisioned</b>, <b>autoscale</b> or <b>serverless</b> throughput.</li>
<li><b>Partition key</b>: the most important design decision. Pick a property with many distinct values that spreads reads and writes evenly (e.g. <code>/customerId</code>, not <code>/country</code>).</li>
<li><b>Global distribution</b>: add regions with a click; optional multi-region writes.</li>
<li><b>Five consistency levels</b>, strongest to weakest: Strong, Bounded staleness, <b>Session</b> (default: you always read your own writes), Consistent prefix, Eventual.</li>
<li><b>Change feed</b>: a stream of every change, often used to trigger Functions.</li>
</ul>
<h3>Open-source and cache</h3>
<ul>
<li><b>Azure Database for PostgreSQL – Flexible Server</b> and <b>Azure Database for MySQL – Flexible Server</b>: managed community engines.</li>
<li><b>Azure Managed Redis</b> (successor to Azure Cache for Redis): in-memory cache for sessions, hot data and rate counters.</li>
</ul>
<h3>A classic error, explained</h3>
<pre><code>Msg 241 / SQLSTATE 22007
Conversion failed when converting date and/or time from character string.</code></pre>
<p>The code sent a date as <b>text</b> (for example <code>'13/10/2026'</code>) and SQL Server tried to read it as month/day. There is no month 13, so it fails. It works for some dates and not others, which makes it look random. <b>Fix:</b> send dates as typed parameters (<code>DateTime</code> → <code>datetime2</code>), never by string concatenation. If text is unavoidable, use ISO 8601: <code>'2026-10-13T09:30:00'</code>.</p>`,
work:`Your notes record middleware bookings lost with <b>SQL 22007</b>. Now you know the cause class: a date travelling as ambiguous text. When you review the Python versions of these apps, check every SQL call that passes a date. It should be a parameter, never an f-string.`,
terms:['Relational database','NoSQL','DTU','vCore','Serverless (database)','Point-in-time restore','Failover group','Cosmos DB','Request Unit','Partition key','Consistency level'],
quiz:[
{q:'You are migrating an on-prem SQL Server that uses SQL Agent jobs and cross-database queries. Best PaaS target?',o:['Azure SQL Database','Azure SQL Managed Instance','Cosmos DB','Table storage'],a:1,e:'Managed Instance offers near-complete SQL Server compatibility, including SQL Agent.'},
{q:'In Cosmos DB, what is the most important design choice for performance?',o:['The region name','The partition key','The container colour','The API key length'],a:1,e:'A good partition key spreads load evenly; a bad one creates “hot” partitions.'},
{q:'Cosmos DB’s default consistency level is…',o:['Strong','Session','Eventual','Bounded staleness'],a:1,e:'Session: within a session you always read your own writes.'},
{q:'SQL error 22007 when inserting dates usually means…',o:['The server is down','A date was passed as text in a format SQL Server read differently','The table is full','Wrong password'],a:1,e:'Use typed parameters or ISO 8601 strings.'}
],
teach:'Describe a real table from your work (e.g. bookings). Would it fit SQL or Cosmos DB better, and why?'
},
/* ───────────────────────── 8 ───────────────────────── */
{
slug:'networking', part:'B', title:'Networking', mins:28,
one:'A virtual network (VNet) is your private network in Azure. Subnets, security rules, private endpoints and gateways control what can talk to what, and which IP the outside world sees.',
kid:`A <b>VNet</b> is your own private gated colony inside the giant Azure city. <b>Subnets</b> are the streets in the colony. <b>NSGs</b> are security guards at each street gate with a list of who may pass. A <b>NAT Gateway</b> is the colony’s single main gate for going out: every car leaving shows the same gate number, so outside shops can recognise you. A <b>private endpoint</b> is a private door from your colony straight into a shop (like a database), so you never walk on the public road.`,
body:`
<h3>IP addresses in five minutes</h3>
<ul>
<li>An IPv4 address is four numbers 0–255: <code>10.20.4.17</code>.</li>
<li><b>Private ranges</b> (not reachable from the internet): <code>10.0.0.0/8</code>, <code>172.16.0.0/12</code>, <code>192.168.0.0/16</code>. Everything else is public.</li>
<li><b>CIDR</b> notation: <code>/24</code> means the first 24 bits are the network and 8 bits are left for hosts, so 2<sup>8</sup> = 256 addresses. <code>/16</code> = 65,536. Each step smaller (a bigger number) halves the size.</li>
<li>Azure <b>reserves 5 addresses in every subnet</b>: the network address, .1 (default gateway), .2 and .3 (Azure DNS), and the last (broadcast). So a <code>/24</code> gives 251 usable. The smallest subnet is <code>/29</code> (3 usable).</li>
</ul>
<div data-widget="cidr"></div>
<h3>Virtual networks and subnets</h3>
<ul>
<li>A VNet lives in <b>one region</b> and has one or more address spaces (e.g. <code>10.20.0.0/16</code>).</li>
<li>You split it into <b>subnets</b> (e.g. <code>10.20.4.0/24</code> for Function Apps). Plan ranges carefully. Overlapping ranges can never be peered or connected to on-prem later.</li>
<li><b>Subnet delegation</b>: some services need a subnet dedicated to them. App Service/Functions VNet integration delegates to <code>Microsoft.Web/serverFarms</code>; Flex Consumption delegates to <code>Microsoft.App/environments</code>.</li>
</ul>
<h3>Network Security Groups (NSGs)</h3>
<p>Firewall rules attached to a subnet or a network card. Each rule has a <b>priority</b> (100–4096, lower number is checked first), source, destination, port, protocol and Allow/Deny. The first match wins.</p>
<ul>
<li>Default rules allow traffic inside the VNet, allow the Azure load balancer probe, and <b>deny all other inbound</b>. Outbound to the internet is allowed by default.</li>
<li><b>Service tags</b> are named groups of Microsoft IPs, such as <code>Internet</code>, <code>VirtualNetwork</code>, <code>AzureCloud</code>, <code>Storage.CentralIndia</code>, <code>ApiManagement</code>. Use them instead of IP lists.</li>
<li><b>Application Security Groups</b> let you write rules like “web servers may talk to db servers” without IPs.</li>
</ul>
<h3>Routing</h3>
<p>Azure adds <b>system routes</b> automatically (inside the VNet, to peered VNets, to the internet). A <b>route table (UDR)</b> overrides them, for example sending <code>0.0.0.0/0</code> to an Azure Firewall so all outbound traffic is inspected.</p>
<h3>Connecting networks</h3>
<div class="tw"><table>
<thead><tr><th>Option</th><th>Connects</th><th>Notes</th></tr></thead>
<tbody>
<tr><td><b>VNet peering</b></td><td>VNet ↔ VNet (same or different region)</td><td>Uses the Microsoft backbone. <b>Not transitive</b>: A↔B and B↔C does not give A↔C.</td></tr>
<tr><td><b>VPN Gateway</b></td><td>On-prem ↔ Azure over the internet, encrypted (IPsec)</td><td>Site-to-site or point-to-site (laptops).</td></tr>
<tr><td><b>ExpressRoute</b></td><td>On-prem ↔ Azure over a private circuit from a provider</td><td>Doesn’t touch the internet. Predictable bandwidth and latency. Common for SAP.</td></tr>
<tr><td><b>Virtual WAN</b></td><td>Many branches, VNets and VPNs in a managed hub</td><td>For large global networks.</td></tr>
</tbody></table></div>
<p>Most enterprises use <b>hub-and-spoke</b>: a hub VNet holds shared things (firewall, gateway, DNS), and each application gets a spoke VNet peered to the hub.</p>
<h3>Reaching PaaS services privately</h3>
<div class="tw"><table>
<thead><tr><th></th><th>Service endpoint</th><th>Private endpoint</th></tr></thead>
<tbody>
<tr><td>What it does</td><td>Lets a subnet reach a service over the Azure backbone; the service firewall can trust that subnet</td><td>Puts a <b>private IP</b> for the service inside your subnet</td></tr>
<tr><td>Service’s address</td><td>Still a public IP</td><td>Private IP (e.g. 10.20.5.4)</td></tr>
<tr><td>From on-prem / peered VNets</td><td>No</td><td>Yes</td></tr>
<tr><td>DNS</td><td>Nothing to change</td><td>Needs a <b>private DNS zone</b>, e.g. <code>privatelink.database.windows.net</code></td></tr>
<tr><td>Cost</td><td>Free</td><td>Hourly + per GB</td></tr>
</tbody></table></div>
<p>Most private endpoint problems are <b>DNS problems</b>: the name still resolves to the public IP. Test with <code>nslookup &lt;name&gt;</code> from inside the VNet (Kudu console works for apps).</p>
<h3>Inbound and outbound for App Service and Functions</h3>
<ul>
<li><b>VNet integration</b> is <b>outbound only</b>: it lets the app call things inside or through your VNet.</li>
<li><b>Private endpoint on the app</b> is <b>inbound</b>: it lets others call the app privately.</li>
<li><b>Route All</b> (the <code>vnetRouteAllEnabled</code> setting, shown as “Outbound internet traffic” in newer portals): when <b>off</b>, only private-range traffic goes into the VNet and internet traffic leaves directly from the app’s shared outbound IPs. When <b>on</b>, <i>all</i> traffic goes into the VNet, where NAT Gateway, firewall and UDRs apply.</li>
</ul>
<h3>Outbound to the internet</h3>
<ul>
<li><b>NAT Gateway</b>: attach to a subnet. All outbound internet traffic from that subnet uses its <b>static public IP(s)</b>. This is what partners whitelist. It also provides lots of SNAT ports, avoiding “port exhaustion” under heavy load.</li>
<li>Microsoft is retiring “default outbound access” for VMs, so always plan explicit outbound: NAT Gateway, a load balancer outbound rule, or a firewall.</li>
</ul>
<h3>Load balancing and front doors</h3>
<div class="tw"><table>
<thead><tr><th>Service</th><th>Layer</th><th>Scope</th><th>Use for</th></tr></thead>
<tbody>
<tr><td>Azure Load Balancer</td><td>L4 (TCP/UDP)</td><td>Regional</td><td>Spreading traffic across VMs</td></tr>
<tr><td>Application Gateway</td><td>L7 (HTTP)</td><td>Regional</td><td>Path-based routing, TLS offload, <b>WAF</b></td></tr>
<tr><td>Azure Front Door</td><td>L7 (HTTP)</td><td>Global</td><td>Global entry point, CDN caching, WAF, failover between regions</td></tr>
<tr><td>Traffic Manager</td><td>DNS</td><td>Global</td><td>Send users to the nearest or healthy endpoint by DNS answer</td></tr>
</tbody></table></div>
<h3>Security and tools</h3>
<ul>
<li><b>Azure Firewall</b>: a managed, stateful firewall with FQDN filtering (“allow outbound only to *.unicommerce.com”) and threat intelligence. NSGs are simple L3/L4 rules; Firewall is central and smarter.</li>
<li><b>DDoS Protection</b>: basic protection is always on; paid tiers add tuning, alerts and cost protection.</li>
<li><b>Azure DNS</b>: host public zones. <b>Private DNS zones</b>: names inside VNets. <b>DNS Private Resolver</b>: conditional forwarding with on-prem. Azure’s internal DNS answers at <code>168.63.129.16</code>.</li>
<li><b>Network Watcher</b>: IP flow verify (“would an NSG block this?”), connection troubleshoot, next hop, packet capture, VNet flow logs.</li>
</ul>`,
work:`<b>Your SAP→Unicommerce story is a textbook networking case.</b> The app was VNet-integrated and a NAT Gateway was attached to the subnet, yet Uniware saw a different IP. Cause: <b>Route All was off</b>, so internet-bound calls left through the app’s shared outbound IPs and never entered the VNet. Turning it on sent everything through the subnet → NAT Gateway, and the egress IP became the whitelisted static IP. Then a 403 even <i>without</i> a token, from the right IP, proved the block was on the partner’s side. That is the reasoning chain to practise: <b>prove each hop, then move to the next.</b>`,
terms:['VNet','Subnet','CIDR','NSG','Service tag','UDR','VNet peering','VPN Gateway','ExpressRoute','Private endpoint','Service endpoint','Private DNS zone','VNet integration','Route All','NAT Gateway','SNAT','Application Gateway','Front Door','Azure Firewall','Hub and spoke'],
quiz:[
{q:'How many usable IP addresses does an Azure /24 subnet give you?',o:['256','254','251','250'],a:2,e:'256 total minus 5 that Azure reserves = 251.'},
{q:'Your Function App is VNet-integrated and its subnet has a NAT Gateway, but the partner sees a different source IP. First thing to check?',o:['The SQL firewall','Whether Route All (vnetRouteAllEnabled) is on','The App Service plan size','The storage account tier'],a:1,e:'Without Route All, internet traffic bypasses the VNet and the NAT Gateway.'},
{q:'VNet A is peered with B, and B is peered with C. Can A talk to C?',o:['Yes, automatically','No, peering is not transitive','Only on port 443','Only in the same region'],a:1,e:'You need a direct peering, or a hub with a firewall/router that forwards traffic.'},
{q:'You created a private endpoint for SQL, but the app still connects to the public IP. Most likely cause?',o:['Wrong SQL password','DNS still resolves to the public address (private DNS zone missing or not linked)','The NSG is too open','The database is paused'],a:1,e:'Private endpoints depend on private DNS. Check with nslookup from inside the VNet.'},
{q:'Which service is a global HTTP entry point with caching and WAF?',o:['Azure Load Balancer','Azure Front Door','VPN Gateway','NAT Gateway'],a:1,e:'Front Door is global L7. Application Gateway is the regional L7 equivalent.'},
{q:'An NSG has rule 200 Deny port 443 and rule 100 Allow port 443 for the same traffic. Result?',o:['Denied','Allowed','Both apply','Error'],a:1,e:'Lower priority number is evaluated first, and the first match wins.'}
],
teach:'Without looking, draw the path of one HTTP call from your Function App to an external partner: app → subnet → (Route All?) → NAT Gateway → internet → partner. Label where each failure you’ve seen could happen.'
},
/* ───────────────────────── 9 ───────────────────────── */
{
slug:'integration', part:'B', title:'Messaging, workflows and APIs', mins:26,
one:'Service Bus, Event Grid and Event Hubs move messages and events between systems; Logic Apps automates workflows; API Management is the secure front door for APIs.',
kid:`<b>Service Bus</b> is a post office. A <b>queue</b> is one letterbox: each letter is picked up by exactly one worker. A <b>topic</b> is a newsletter: every subscriber gets their own copy. If a letter can’t be delivered after many tries, it goes into the <b>dead-letter box</b> so it doesn’t block the others. <b>Logic Apps</b> is a drag-and-drop robot: “when an order arrives, save it, then message the team.” <b>API Management</b> is the reception desk in front of all your APIs: it checks visitor passes, counts visits, and sends each visitor to the right room.`,
body:`
<h3>Why use messaging at all?</h3>
<ul>
<li><b>Decoupling</b>: DMS can send a booking even if your processor is down. The message waits.</li>
<li><b>Load levelling</b>: 10,000 messages arrive in a burst and the consumer works through them at its own pace.</li>
<li><b>Reliability</b>: messages are stored durably and retried, and failures are parked rather than lost.</li>
</ul>
<h3>Azure Service Bus (enterprise messaging)</h3>
<ul>
<li><b>Namespace</b>: the container (<code>&lt;name&gt;.servicebus.windows.net</code>). Tiers: <b>Basic</b> (queues only), <b>Standard</b> (topics, messages up to 256 KB), <b>Premium</b> (dedicated capacity, private endpoints, zone redundancy, messages up to 100 MB).</li>
<li><b>Queue</b>: point-to-point. Each message is processed by one receiver.</li>
<li><b>Topic + subscriptions</b>: publish once, and each <b>subscription</b> gets its own copy. Filters (SQL or correlation) decide which messages a subscription receives, e.g. <code>eventType = 'StockProcessed'</code>.</li>
</ul>
<p><b>How a message is received (peek-lock):</b></p>
<ol>
<li>The receiver takes the message and it is <b>locked</b> for the lock duration (default 1 minute, maximum 5).</li>
<li>Success → <b>Complete</b>, and the message is removed.</li>
<li>Failure → <b>Abandon</b> (or the lock expires), and the message becomes available again with <code>DeliveryCount + 1</code>.</li>
<li>When <code>DeliveryCount</code> reaches <b>MaxDeliveryCount</b> (default 10), Service Bus moves it to the <b>dead-letter queue (DLQ)</b> with reason <code>MaxDeliveryCountExceeded</code>.</li>
</ol>
<p>Other dead-letter reasons: TTL expired (if dead-lettering on expiry is enabled), filter evaluation errors, or your code calling <code>DeadLetter()</code> explicitly. The DLQ is a sub-queue at <code>&lt;entity&gt;/$DeadLetterQueue</code> (for topics: <code>&lt;topic&gt;/Subscriptions/&lt;sub&gt;/$DeadLetterQueue</code>). <b>Nothing processes the DLQ automatically.</b> Someone has to inspect, fix and resubmit, or deliberately discard and record.</p>
<p>Also know: <b>sessions</b> (ordered FIFO per session ID, e.g. per booking), <b>duplicate detection</b> (drop repeats with the same MessageId inside a window), <b>scheduled messages</b>, <b>deferral</b>, and <b>receive-and-delete</b> mode (faster, but a crash loses the message).</p>
<div class="note"><b>Poison message</b>: a message that will fail every time (bad data, missing field). If your consumer keeps retrying it instead of dead-lettering it, it can block everything behind it. Always decide: transient error → retry; permanent error → dead-letter immediately with a clear reason.</div>
<h3>Event Grid and Event Hubs</h3>
<div class="tw"><table>
<thead><tr><th></th><th>Service Bus</th><th>Event Grid</th><th>Event Hubs</th></tr></thead>
<tbody>
<tr><td>Carries</td><td><b>Messages</b>: commands and business data that must be processed (“create this booking”)</td><td><b>Discrete events</b>: notifications that something happened (“a blob was created”)</td><td><b>Event streams</b>: huge volumes of telemetry (“10,000 GPS points per second”)</td></tr>
<tr><td>Model</td><td>Pull, queues and topics</td><td>Push to handlers (Function, webhook, queue)</td><td>Pull, partitions and consumer groups</td></tr>
<tr><td>Guarantees</td><td>Transactions, ordering (sessions), DLQ, duplicate detection</td><td>Retry with backoff, dead-letter to blob</td><td>Retention (replay the stream), Kafka protocol</td></tr>
<tr><td>Typical use</td><td>Order processing, bookings, integration</td><td>React to Azure resource events, lightweight pub/sub, MQTT</td><td>IoT, clickstream, log pipelines</td></tr>
</tbody></table></div>
<h3>Azure Logic Apps</h3>
<p>Low-code workflows: a <b>trigger</b> (schedule, HTTP request, new Service Bus message, new file in SharePoint) followed by <b>actions</b>, using 1,400+ connectors (SAP, SQL, Outlook, Salesforce, Teams).</p>
<ul>
<li><b>Consumption</b>: multi-tenant, one workflow per resource, pay per action executed.</li>
<li><b>Standard</b>: single-tenant, runs on the Functions runtime, many workflows per app, VNet integration, stateful <i>and</i> stateless workflows, fixed plan cost.</li>
<li><b>Run history</b> shows every run, every action’s inputs and outputs, and timings. This is your first debugging stop. Retention defaults to 90 days.</li>
<li><b>Retry policy</b> per action (default: exponential, 4 retries). <b>Run after</b> settings let an action run only when a previous one failed: that is your try/catch.</li>
<li><b>Integration accounts</b> add B2B features: EDI (X12, EDIFACT), maps and schemas.</li>
</ul>
<h3>Azure API Management (APIM)</h3>
<p>A gateway in front of your APIs (Functions, App Service, on-prem, partners). It gives one place for security, throttling, transformation and documentation.</p>
<ul>
<li><b>Parts</b>: the <b>gateway</b> (handles calls), the management plane (config), and the <b>developer portal</b> (docs, keys for consumers).</li>
<li><b>Products</b> group APIs. <b>Subscriptions</b> give consumers keys, sent as the <code>Ocp-Apim-Subscription-Key</code> header.</li>
<li><b>Policies</b>: XML rules that run in four sections: <code>inbound</code> (before the backend), <code>backend</code>, <code>outbound</code> (on the response), <code>on-error</code>.</li>
<li><b>Named values</b>: reusable settings, which can be secrets linked to Key Vault.</li>
<li><b>Tiers</b>: Consumption (serverless), Developer (no SLA, non-prod), Basic, Standard, Premium (multi-region, VNet), and the v2 tiers (Basic v2, Standard v2, Premium v2).</li>
<li><b>Debugging</b>: the test console with <b>tracing</b> shows every policy step and the exact backend request.</li>
</ul>
<pre><code>&lt;policies&gt;
  &lt;inbound&gt;
    &lt;base /&gt;
    &lt;!-- reject calls without the agreed header value --&gt;
    &lt;check-header name="Authentication" failed-check-httpcode="401"
                  failed-check-error-message="Unauthorized" ignore-case="false"&gt;
      &lt;value&gt;{{sap-shared-secret}}&lt;/value&gt;
    &lt;/check-header&gt;
    &lt;!-- no more than 100 calls per minute per caller IP --&gt;
    &lt;rate-limit-by-key calls="100" renewal-period="60"
                       counter-key="@(context.Request.IpAddress)" /&gt;
    &lt;set-backend-service backend-id="func-sap-to-unicommerce" /&gt;
  &lt;/inbound&gt;
  &lt;backend&gt;&lt;base /&gt;&lt;/backend&gt;
  &lt;outbound&gt;&lt;base /&gt;&lt;/outbound&gt;
  &lt;on-error&gt;&lt;base /&gt;&lt;/on-error&gt;
&lt;/policies&gt;</code></pre>
<p><code>{{sap-shared-secret}}</code> is a named value. Keeping the secret there (ideally Key Vault-backed) is safer than a literal typed into the policy.</p>`,
work:`Your CPD notes describe about <b>280 manual pushes a week</b> caused by retry gaps. Each maps to a lesson from this chapter. (1) A <b>poison message</b> blocked the topic-retry Logic App: permanent failures must be dead-lettered, not retried forever. (2) <b>Dead-lettered events were deleted</b> by the Logic App, so evidence vanished: always record before you discard. (3) The bot read only <b>2 days</b> of run history, so a “DMS never sent it” verdict was wrong: know your retention windows. For the APIM check-header: your notes say it now uses a literal value. Moving it back to a Key Vault-backed named value keeps the secret out of the policy text.`,
terms:['Service Bus','Queue','Topic','Subscription (Service Bus)','Peek-lock','Lock duration','MaxDeliveryCount','Dead-letter queue','Poison message','Session','Event Grid','Event Hubs','Logic Apps','Connector','Run history','API Management','APIM policy','Named value'],
quiz:[
{q:'A Service Bus message fails processing 10 times with default settings. Where does it go?',o:['Deleted','Back to the front of the queue','The dead-letter queue','Event Grid'],a:2,e:'MaxDeliveryCount defaults to 10. Then the message moves to the DLQ with reason MaxDeliveryCountExceeded.'},
{q:'One event must reach three independent systems, each processing its own copy. Use…',o:['A queue','A topic with three subscriptions','Three storage accounts','A NAT Gateway'],a:1,e:'Topics fan out: each subscription gets its own copy.'},
{q:'You need to process 1 million telemetry events per second and replay the last day. Best fit?',o:['Service Bus queue','Event Grid','Event Hubs','Logic Apps'],a:2,e:'Event Hubs is built for high-throughput streaming with retention and replay.'},
{q:'In an APIM policy, where do you validate a caller’s header before the backend is called?',o:['outbound','on-error','inbound','backend'],a:2,e:'inbound runs on the request before it is forwarded.'},
{q:'What happens to messages in a dead-letter queue if nobody acts?',o:['Auto-retried hourly','They stay there until someone reads, resubmits or deletes them','Sent back to the sender','Deleted after 1 minute'],a:1,e:'Nothing processes the DLQ for you. Monitor its count and alert on it.'},
{q:'Where is the first place to debug a failed Logic App?',o:['The Activity Log','The run history for that run','The storage account','The NSG'],a:1,e:'Run history shows each action’s inputs, outputs and errors.'}
],
teach:'Explain to a new joiner, step by step, what happens to a DMS booking message that keeps failing, from first delivery to the dead-letter queue.'
},
/* ───────────────────────── 10 ───────────────────────── */
{
slug:'security', part:'C', title:'Security and governance', mins:16,
one:'Azure security means layers: strong identity, private networks, encrypted data, secret hygiene, and tools like Defender for Cloud, Sentinel and Azure Policy that watch and enforce the rules.',
kid:`Security is like protecting a castle. There is a moat, an outer wall, an inner wall, guards and a locked safe for the treasure. If one wall falls, the next stops the attacker. That is <b>defence in depth</b>. <b>Zero Trust</b> means the guards check everyone’s ID at every door, even people who are already inside.`,
body:`
<h3>Zero Trust: three principles</h3>
<ol>
<li><b>Verify explicitly</b>: authenticate and authorise every request using all signals (user, device, location, risk).</li>
<li><b>Use least-privilege access</b>: just enough, just in time.</li>
<li><b>Assume breach</b>: segment networks, encrypt everything, and monitor as if attackers are already inside.</li>
</ol>
<h3>Defence in depth: the layers</h3>
<div class="tw"><table>
<thead><tr><th>Layer</th><th>Azure tools</th></tr></thead>
<tbody>
<tr><td>Physical</td><td>Microsoft datacenters (Microsoft’s job)</td></tr>
<tr><td>Identity &amp; access</td><td>Entra ID, MFA, Conditional Access, PIM, managed identities</td></tr>
<tr><td>Perimeter</td><td>DDoS Protection, Azure Firewall, WAF on Front Door / App Gateway</td></tr>
<tr><td>Network</td><td>NSGs, private endpoints, no public IPs, segmentation</td></tr>
<tr><td>Compute</td><td>Patching (Update Manager), Defender for Servers, Bastion instead of open RDP</td></tr>
<tr><td>Application</td><td>Secure code, secrets in Key Vault, dependency scanning, APIM policies</td></tr>
<tr><td>Data</td><td>Encryption at rest and in transit (TLS 1.2+), RBAC on data, backups</td></tr>
</tbody></table></div>
<h3>The main security services</h3>
<ul>
<li><b>Microsoft Defender for Cloud</b>: continuously assesses your resources and gives a <b>Secure Score</b> plus recommendations (“storage account allows public access”, “SQL has no auditing”). Paid <b>Defender plans</b> add threat protection for servers, storage, SQL, containers, Key Vault, App Service and APIs.</li>
<li><b>Microsoft Sentinel</b>: a cloud SIEM (collect and correlate security logs) and SOAR (automated response playbooks, which are Logic Apps).</li>
<li><b>Azure Policy</b>: rules evaluated on every resource. Effects: <code>deny</code> (block creation), <code>audit</code> (flag), <code>modify</code> (e.g. add a tag), <code>deployIfNotExists</code> (e.g. add diagnostic settings). Group policies into <b>initiatives</b>. Examples: “Allowed locations = Central India, South India”, “Storage accounts must disable public blob access”, “Require tag env”.</li>
<li><b>Web Application Firewall (WAF)</b>: blocks common web attacks (SQL injection, XSS) using OWASP rule sets.</li>
<li><b>Key Vault and Managed HSM</b>: secrets and keys (see chapter 4).</li>
<li><b>Microsoft Purview</b>: data classification, governance and compliance.</li>
<li><b>Service Trust Portal</b>: Microsoft’s compliance reports (ISO 27001, SOC 2…) for your auditors.</li>
</ul>
<h3>Secret hygiene: rules that prevent incidents</h3>
<ol>
<li>Never put secrets in source code, compiled binaries, config files in git, or chat messages.</li>
<li>Never log secrets. Mask headers like <code>Authorization</code> and fields like <code>password</code> in log decorators and middleware.</li>
<li>Prefer managed identities, so there is no secret at all.</li>
<li>Otherwise, store secrets in Key Vault and reference them.</li>
<li>When a secret is exposed, <b>rotate it</b>. Deleting the log line is not enough.</li>
<li>Turn on secret scanning in your repos (GitHub Advanced Security, or Defender for DevOps).</li>
</ol>`,
work:`Your migration rules already include “secrets out of code and logs” and “reports never print secret values”. That is Zero Trust thinking applied to code. The open item in your notes is <b>rotation</b> of secrets that were exposed (in DLLs, in middleware logs, in chat). Until rotated, assume they are known.`,
terms:['Zero Trust','Defence in depth','Defender for Cloud','Secure Score','Microsoft Sentinel','SIEM','Azure Policy','Initiative','WAF','DDoS Protection','Secret rotation'],
quiz:[
{q:'Which Azure service can block anyone from creating resources outside Central India?',o:['Azure Monitor','Azure Policy with a deny effect','Network Security Group','Key Vault'],a:1,e:'The built-in “Allowed locations” policy denies deployments to other regions.'},
{q:'A password was printed in application logs last month. The best first action is…',o:['Delete the log','Rotate the password','Make the logs private','Nothing, logs are internal'],a:1,e:'Assume it’s compromised. Rotation makes the leaked value useless; then fix the logging.'},
{q:'Which service gives a Secure Score with recommendations?',o:['Microsoft Sentinel','Microsoft Defender for Cloud','Azure Advisor only','Application Insights'],a:1,e:'Defender for Cloud’s posture management calculates the Secure Score.'},
{q:'“Assume breach” is a principle of…',o:['Shared responsibility','Zero Trust','Well-Architected cost pillar','CapEx'],a:1,e:'Zero Trust: verify explicitly, least privilege, assume breach.'}
],
teach:'List five places a secret could leak in a Function App project, and the control that prevents each one.'
},
/* ───────────────────────── 11 ───────────────────────── */
{
slug:'monitoring', part:'C', title:'Monitoring, logs and KQL', mins:22,
one:'Azure Monitor collects metrics and logs from everything; Application Insights watches your app code; KQL is the query language that turns logs into answers.',
kid:`Monitoring is your car’s dashboard. <b>Metrics</b> are the speedometer: numbers changing over time. <b>Logs</b> are the trip diary: what happened, when, with details. <b>Alerts</b> are the warning lights that turn on when fuel is low, so you don’t have to stare at the dashboard all day.`,
body:`
<h3>What Azure Monitor collects</h3>
<div class="tw"><table>
<thead><tr><th>Data</th><th>What it is</th><th>Where to see it</th></tr></thead>
<tbody>
<tr><td><b>Metrics</b></td><td>Numbers over time: CPU %, requests/sec, active messages, DLQ count. Collected automatically, near real time, kept 93 days.</td><td>Metrics explorer, metric alerts</td></tr>
<tr><td><b>Activity Log</b></td><td>Control-plane events: who created, changed, restarted or deleted what, and when. 90 days.</td><td>Activity log blade on any resource</td></tr>
<tr><td><b>Resource logs</b></td><td>Detailed service logs (Logic App runs, APIM gateway logs, SQL audit). <b>Off until you add a Diagnostic setting.</b></td><td>Log Analytics workspace</td></tr>
<tr><td><b>Application telemetry</b></td><td>Requests, dependencies, exceptions, traces from your code</td><td>Application Insights</td></tr>
</tbody></table></div>
<p>A <b>Log Analytics workspace</b> is the central database for logs. You query it with <b>KQL</b>. You pay per GB ingested, so noisy debug logging costs real money.</p>
<h3>Application Insights</h3>
<ul>
<li><b>requests</b>: incoming calls (HTTP, or each function execution), with duration and success.</li>
<li><b>dependencies</b>: outgoing calls (SQL, HTTP to a partner, Service Bus), with duration and result.</li>
<li><b>exceptions</b>: errors with stack traces.</li>
<li><b>traces</b>: your <code>logger.info()</code> lines.</li>
<li><b>Tools</b>: Live Metrics (real-time), Failures, Performance, Application Map (who calls whom), Transaction search, Availability tests (ping your API from around the world).</li>
<li><b>operation_Id</b> ties a request, its dependencies, exceptions and traces together. Find one failing request and you can follow the whole story.</li>
<li><b>Sampling</b> may keep only a percentage of telemetry to save cost. If a log “is missing”, check sampling first.</li>
<li>Modern apps instrument with <b>OpenTelemetry</b> through the Azure Monitor distro.</li>
</ul>
<h3>KQL in ten minutes</h3>
<p>KQL reads top to bottom. Data flows through pipes (<code>|</code>), and each line filters or reshapes it.</p>
<div class="tw"><table>
<thead><tr><th>Operator</th><th>Does</th></tr></thead>
<tbody>
<tr><td><code>where</code></td><td>Filter rows: <code>where success == false</code></td></tr>
<tr><td><code>project</code></td><td>Choose columns</td></tr>
<tr><td><code>extend</code></td><td>Add a calculated column</td></tr>
<tr><td><code>summarize</code></td><td>Group and count: <code>summarize count() by resultCode</code></td></tr>
<tr><td><code>order by</code> / <code>top</code></td><td>Sort / take the top N</td></tr>
<tr><td><code>bin()</code></td><td>Bucket time: <code>bin(timestamp, 5m)</code></td></tr>
<tr><td><code>ago()</code></td><td>Relative time: <code>ago(1h)</code>, <code>ago(7d)</code></td></tr>
<tr><td><code>join</code></td><td>Combine two tables on a key</td></tr>
<tr><td><code>render</code></td><td>Draw a chart: <code>render timechart</code></td></tr>
<tr><td><code>has</code> / <code>contains</code></td><td>Text search (<code>has</code> matches whole terms and is faster)</td></tr>
</tbody></table></div>
<pre><code>// 1. Which operations failed in the last hour, and with what code?
requests
| where timestamp &gt; ago(1h) and success == false
| summarize failures = count() by name, resultCode
| order by failures desc

// 2. Top 10 exception types today
exceptions
| where timestamp &gt; ago(1d)
| summarize count() by type, outerMessage
| top 10 by count_

// 3. Everything logged about one booking
traces
| where timestamp &gt; ago(3d) and message has "BKG000123XY00001"
| project timestamp, severityLevel, message, operation_Id
| order by timestamp asc

// 4. Is the partner API slow? Average and 95th percentile per 5 minutes
dependencies
| where timestamp &gt; ago(6h) and type == "HTTP" and target has "unicommerce"
| summarize avg(duration), percentile(duration, 95), failures = countif(success == false)
    by bin(timestamp, 5m)
| render timechart</code></pre>
<p>In a workspace-based Application Insights resource, opening <b>Logs</b> from the App Insights blade uses the names above. In the Log Analytics workspace itself, the same data is in tables named <code>AppRequests</code>, <code>AppDependencies</code>, <code>AppExceptions</code> and <code>AppTraces</code>.</p>
<h3>Alerts</h3>
<ul>
<li><b>Metric alerts</b>: “DLQ message count &gt; 0 for 5 minutes”.</li>
<li><b>Log search alerts</b>: run a KQL query on a schedule and fire if it returns rows.</li>
<li><b>Activity log alerts</b>: “someone deleted a resource in prod”, or Service Health incidents.</li>
<li><b>Action groups</b>: what happens when an alert fires: email, SMS, Teams/webhook, a Logic App or a Function. <b>Alert processing rules</b> suppress alerts during maintenance windows.</li>
</ul>
<p>Also: <b>Workbooks</b> (interactive reports), <b>Azure Managed Grafana</b>, <b>Service Health</b> (Azure incidents affecting <i>your</i> regions and services) and <b>Resource Health</b> (is <i>this</i> resource healthy?).</p>`,
work:`The CPD bot reads Logic App run history to decide what happened to a booking. A <b>KQL query over Application Insights and Service Bus/Logic App diagnostic logs</b> can answer “what happened to booking X?” in one place, with no 2-day window. A simple alert, <b>“dead-letter count &gt; 0”</b> on each CPD subscription, would have flagged the dropped stock events on the day they happened.`,
terms:['Azure Monitor','Metric','Log Analytics workspace','KQL','Activity Log','Diagnostic setting','Application Insights','operation_Id','Sampling','Alert','Action group','Service Health'],
quiz:[
{q:'Who restarted the production Function App yesterday at 14:02? Where do you look?',o:['Application Insights traces','The Activity Log','Storage metrics','The NSG'],a:1,e:'Control-plane actions (restart, config change, delete) are recorded with the caller in the Activity Log.'},
{q:'Logic App resource logs are not appearing in Log Analytics. Most likely reason?',o:['KQL is broken','No Diagnostic setting sends them to the workspace','The Logic App is serverless','Logs only work in the US'],a:1,e:'Resource logs are only collected when a Diagnostic setting routes them somewhere.'},
{q:'Which KQL line counts failures per result code?',o:['project resultCode','summarize count() by resultCode','where count() > 0','render resultCode'],a:1,e:'summarize ... by groups the rows and aggregates.'},
{q:'What links a request to its exceptions and outgoing calls in Application Insights?',o:['The resource ID','operation_Id','The region','The subscription key'],a:1,e:'All telemetry from one logical operation shares the same operation_Id.'},
{q:'Some trace lines seem to be missing from App Insights, randomly. First suspect?',o:['Sampling','Region pair','RBAC','DNS'],a:0,e:'Adaptive sampling keeps only a share of telemetry under load.'}
],
teach:'Write (from memory) a KQL query that shows failed requests per hour for the last day, as a chart. Then check it against the examples.'
},
/* ───────────────────────── 12 ───────────────────────── */
{
slug:'devops', part:'C', title:'Automation, IaC and deployment', mins:18,
one:'Real teams don’t click in the portal to build production: they use the CLI, write infrastructure as code (Bicep or Terraform), and deploy through CI/CD pipelines.',
kid:`Building by hand in the portal is like cooking without a recipe: tasty once, impossible to repeat exactly. <b>Infrastructure as Code</b> is writing the recipe down, so anyone can cook the identical dish in UAT and in Production, and you can see exactly what changed between two versions of the recipe.`,
body:`
<h3>The ways to talk to Azure</h3>
<ul>
<li><b>Azure portal</b>: great for learning and looking. Risky for repeatable changes.</li>
<li><b>Azure CLI</b> (<code>az</code>): cross-platform commands. <code>--query</code> uses JMESPath to filter output; <code>-o table</code> makes it readable.</li>
<li><b>Azure PowerShell</b> (<code>Az</code> module): <code>Get-AzFunctionApp</code>, <code>Set-AzContext</code>, and so on.</li>
<li><b>Cloud Shell</b>: a browser shell with CLI and PowerShell already logged in.</li>
<li><b>REST API and SDKs</b>: what everything else is built on.</li>
<li><b>Azure Resource Graph</b>: KQL across every resource you can see, across subscriptions, in seconds:</li>
</ul>
<pre><code>resources
| where type == "microsoft.web/sites" and kind has "functionapp"
| project name, resourceGroup, location, kind, properties.state
| order by name asc</code></pre>
<h3>Infrastructure as Code (IaC)</h3>
<div class="tw"><table>
<thead><tr><th>Tool</th><th>Style</th><th>Notes</th></tr></thead>
<tbody>
<tr><td>ARM templates</td><td>JSON</td><td>The native format. Verbose. Every portal resource can export one.</td></tr>
<tr><td><b>Bicep</b></td><td>Clean Azure-only language</td><td>Compiles to ARM JSON. No state file. <code>what-if</code> previews changes. Best for Azure-only shops.</td></tr>
<tr><td><b>Terraform</b></td><td>HCL, multi-cloud</td><td>Keeps a <b>state file</b> (store it in a locked storage account). <code>plan</code> then <code>apply</code>.</td></tr>
</tbody></table></div>
<pre><code>// main.bicep: a storage account
param location string = resourceGroup().location
param name string

resource sa 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

# deploy it: preview first, then apply
az deployment group what-if -g rg-learning -f main.bicep -p name=stlearn0123
az deployment group create  -g rg-learning -f main.bicep -p name=stlearn0123</code></pre>
<p>Deployment modes: <b>Incremental</b> (default: adds and updates, never deletes) and <b>Complete</b> (deletes anything in the RG that isn’t in the template; dangerous).</p>
<h3>CI/CD pipelines</h3>
<p>A pipeline turns “I changed code” into “it is running in production” the same way every time:</p>
<ol>
<li><b>Build</b>: compile, install packages, run unit tests.</li>
<li><b>Package</b>: create a zip or container image (an artifact).</li>
<li><b>Deploy to UAT</b>, run smoke or integration tests.</li>
<li><b>Approval gate</b>: a person approves.</li>
<li><b>Deploy to production</b>, ideally to a staging slot first, then swap.</li>
</ol>
<p>Tools: <b>GitHub Actions</b> and <b>Azure DevOps Pipelines</b>. Sign in to Azure with <b>OIDC federated credentials</b> rather than stored secrets.</p>
<h3>How code gets into an App Service or Function App</h3>
<ul>
<li><b>Zip deploy / run from package</b>: <code>WEBSITE_RUN_FROM_PACKAGE=1</code> mounts the zip read-only. Fast and atomic.</li>
<li><b>Flex Consumption</b> stores the package in a blob container you configure.</li>
<li><b>Remote build</b> for Python: the platform runs <code>pip install</code> from <code>requirements.txt</code> during deployment.</li>
<li><b>Kudu</b> (<code>.scm.azurewebsites.net</code>): see the deployed files, deployment history, log stream and environment. This is how you check what is <i>really</i> running.</li>
<li><b>App settings</b> become environment variables. Keep them per environment; mark slot-specific ones as <i>slot settings</i>.</li>
<li><b>Azure App Configuration</b>: central settings and <b>feature flags</b> shared by many apps.</li>
</ul>
<div class="note">Environment discipline: dev → UAT → production. Every production change should be something that already ran in UAT, deployed by the same pipeline.</div>`,
work:`You already read live config through ARM and pull deployed code from Kudu <code>SitePackages</code>. That is the “what is actually deployed?” skill, and most people never learn it. The next step that would protect the 17 migrated Python apps: describe each Function App’s infrastructure (plan, settings, VNet integration, identity) in <b>Bicep</b>, so UAT and prod can’t drift and a rebuild takes minutes.`,
terms:['Azure CLI','Cloud Shell','Azure Resource Graph','Infrastructure as Code','ARM template','Bicep','Terraform','what-if','CI/CD','GitHub Actions','Run from package','App settings','Feature flag'],
quiz:[
{q:'Which deployment mode deletes resources in the RG that are not in the template?',o:['Incremental','Complete','Validate','What-if'],a:1,e:'Complete mode makes the RG match the template exactly, so it deletes extras. Use it with great care.'},
{q:'Before deploying a Bicep change to prod, which command previews what will change?',o:['az deployment group what-if','az login','az bicep decompile','az group delete'],a:0,e:'what-if shows creates, modifies and deletes without applying.'},
{q:'You need to list every Function App across 20 subscriptions in seconds. Use…',o:['Click through the portal','Azure Resource Graph','Application Insights','Storage Explorer'],a:1,e:'Resource Graph queries all resources you can see with KQL.'},
{q:'What does Terraform keep that Bicep does not?',o:['A state file','A resource group','A region','A tenant'],a:0,e:'Terraform tracks reality in a state file; Bicep asks ARM directly each time.'}
],
teach:'Describe, step by step, how you would deploy one of your Python Function Apps from git to production without touching the portal.'
},
/* ───────────────────────── 13 ───────────────────────── */
{
slug:'cost', part:'C', title:'Cost: how the bill works', mins:12,
one:'You pay for what you provision or use. Know the cost drivers, use the pricing calculator before building, and use budgets, reservations and clean-up to keep the bill sensible.',
kid:`Azure is like a mobile phone plan. Every minute of calling (compute), every MB of data (storage, data going out) costs something. If you forget the hotspot on (a VM left running all weekend), the bill grows. A <b>budget alert</b> is the SMS that warns you when you hit 80%.`,
body:`
<h3>What drives cost</h3>
<ul>
<li><b>Compute</b>: size × hours running (VMs, App Service plans, Premium Functions) or executions × memory time (Consumption/Flex).</li>
<li><b>Storage</b>: GB stored × tier, plus transactions and redundancy (GRS costs more than LRS).</li>
<li><b>Networking</b>: data <b>into</b> Azure is free; data <b>out</b> to the internet and between regions is charged. Also NAT Gateway (hourly + per GB), private endpoints, VPN/ExpressRoute.</li>
<li><b>Fixed-price tiers</b>: APIM, Premium Service Bus, Logic Apps Standard, Firewall: these cost money even when idle.</li>
<li><b>Logs</b>: Log Analytics charges per GB ingested. Verbose logging is a hidden cost.</li>
<li><b>Licences</b>: Windows, SQL Server.</li>
</ul>
<h3>Ways to pay less</h3>
<div class="tw"><table>
<thead><tr><th>Option</th><th>How it works</th><th>Best for</th></tr></thead>
<tbody>
<tr><td>Pay-as-you-go</td><td>List price, per second or hour, no commitment</td><td>Variable or short-lived workloads</td></tr>
<tr><td><b>Reservations</b></td><td>Commit to a specific resource type for 1 or 3 years. Large discounts.</td><td>Steady VMs, SQL, Cosmos DB capacity</td></tr>
<tr><td><b>Savings plan for compute</b></td><td>Commit to a fixed hourly spend for 1 or 3 years, across many compute services and regions</td><td>Steady but changing compute mix</td></tr>
<tr><td><b>Spot</b></td><td>Spare capacity, deep discount, can be evicted</td><td>Batch jobs, testing</td></tr>
<tr><td><b>Azure Hybrid Benefit</b></td><td>Reuse your Windows Server / SQL Server licences</td><td>Organisations with existing licences</td></tr>
<tr><td>Dev/Test pricing</td><td>Lower rates for non-production subscriptions</td><td>UAT and dev environments</td></tr>
</tbody></table></div>
<h3>Tools</h3>
<ul>
<li><b>Pricing calculator</b>: estimate before you build.</li>
<li><b>TCO calculator</b>: compare on-prem cost with Azure.</li>
<li><b>Cost Management</b>: cost analysis by service, resource group and tag; <b>budgets</b> with alerts; scheduled exports; anomaly alerts.</li>
<li><b>Azure Advisor</b>: free recommendations (right-size or shut down idle VMs, buy reservations).</li>
<li><b>Free account</b>: credit for the first 30 days, some services free for 12 months, and an always-free tier. Perfect for practice labs.</li>
</ul>
<h3>Habits that save money</h3>
<ol>
<li>Tag everything (<code>env</code>, <code>owner</code>, <code>app</code>) so you can see who spends what.</li>
<li>Auto-shutdown dev VMs at night; delete test environments when done.</li>
<li>Delete orphans: unattached disks, unused public IPs, old snapshots, empty App Service plans.</li>
<li>Right-size: a plan at 5% CPU is too big.</li>
<li>Lifecycle rules on storage; reasonable log retention and sampling.</li>
<li>Set a budget alert on every subscription.</li>
</ol>`,
work:`In your landscape the always-on costs are likely <b>APIM</b>, <b>NAT Gateways</b>, any <b>Premium</b> Service Bus or Function plans, and <b>Log Analytics ingestion</b>. Moving 17 apps to Python on Flex Consumption could change the bill a lot in either direction (execution-based vs plan-based). Run the numbers in the pricing calculator before cut-over.`,
terms:['Pay-as-you-go','Reservation','Savings plan','Spot VM','Azure Hybrid Benefit','Pricing calculator','Cost Management','Budget','Azure Advisor','Egress'],
quiz:[
{q:'Which data transfer is generally free?',o:['Data out to the internet','Data into Azure (ingress)','Data between regions','Data through a VPN to on-prem'],a:1,e:'Ingress is free; egress and inter-region transfer are charged.'},
{q:'A VM runs 24/7 for the next 3 years at the same size. Biggest saving?',o:['Spot','A 3-year reservation','Pay-as-you-go','Move it to Archive'],a:1,e:'Reservations give the largest discount for steady, predictable usage.'},
{q:'Where do you get an alert when monthly spend reaches 80% of a limit?',o:['Azure Policy','A budget in Cost Management','Defender for Cloud','Service Health'],a:1,e:'Budgets send alerts at thresholds you set.'},
{q:'Which free service recommends shutting down an idle VM?',o:['Azure Advisor','Sentinel','Bastion','Front Door'],a:0,e:'Advisor gives cost, security, reliability and performance recommendations.'}
],
teach:'Pick one of your environments. List its five most expensive resources (from Cost analysis) and say whether each is justified.'
},
/* ───────────────────────── 14 ───────────────────────── */
{
slug:'reliability', part:'C', title:'Reliability, retries and disaster recovery', mins:18,
one:'Everything fails sometimes. Reliable systems retry transient errors sensibly, handle permanent errors explicitly, survive zone and region failures, and are tested.',
kid:`Reliability is planning for things to break. Carry an umbrella in case it rains (<b>retry</b>). Keep a spare house key at a friend’s place in another town (<b>backup in another region</b>). Practise the fire drill (<b>DR test</b>), because the day of the real fire is not the time to read the instructions.`,
body:`
<h3>SLAs: what Microsoft promises</h3>
<p>An <b>SLA</b> (service level agreement) is the uptime Microsoft commits to for a service and tier, with service credits if it misses. It depends on configuration: a single VM, VMs across zones, and Premium vs Standard tiers all have different SLAs.</p>
<div class="tw"><table>
<thead><tr><th>SLA</th><th>Max downtime / month</th><th>Max downtime / year</th></tr></thead>
<tbody>
<tr><td>99%</td><td>7.3 hours</td><td>3.65 days</td></tr>
<tr><td>99.9%</td><td>43.8 minutes</td><td>8.8 hours</td></tr>
<tr><td>99.95%</td><td>21.9 minutes</td><td>4.4 hours</td></tr>
<tr><td>99.99%</td><td>4.4 minutes</td><td>52.6 minutes</td></tr>
</tbody></table></div>
<p><b>Composite SLA:</b> if your app needs A <i>and</i> B to work, multiply: 99.95% × 99.99% = 99.94%. Each dependency lowers the total. Redundancy raises it: two independent regions at 99.9% each give 1 − (0.001 × 0.001) = 99.9999% in theory.</p>
<div data-widget="sla"></div>
<h3>RTO and RPO</h3>
<ul>
<li><b>RTO</b> (Recovery Time Objective): how long you can be down. “Back within 1 hour.”</li>
<li><b>RPO</b> (Recovery Point Objective): how much data you can lose. “At most 5 minutes of bookings.”</li>
</ul>
<p>Smaller RTO and RPO cost more. Agree them with the business first, then design.</p>
<h3>High availability vs disaster recovery</h3>
<ul>
<li><b>HA</b> keeps running through small failures automatically: multiple instances, zone redundancy, health probes.</li>
<li><b>DR</b> recovers from a big event (region outage, ransomware, someone deleting the database): backups, geo-replication, failover to another region.</li>
<li>Patterns: <b>active-passive</b> (standby region, cheaper, slower to switch) and <b>active-active</b> (both regions serve traffic, expensive, fastest).</li>
<li><b>Azure Backup</b> (VMs, SQL in VMs, Files, blobs) uses a Recovery Services or Backup vault. <b>Azure Site Recovery</b> replicates whole VMs to another region for failover.</li>
</ul>
<h3>Transient vs permanent errors</h3>
<div class="tw"><table>
<thead><tr><th>Transient: retry</th><th>Permanent: don’t retry, park it</th></tr></thead>
<tbody>
<tr><td>HTTP 408, 429 (throttled), 500, 502, 503, 504; timeouts; SQL deadlock; connection reset</td><td>HTTP 400 (bad request), 401/403 (auth), 404, 422 validation errors; malformed data; SQL 22007 bad date</td></tr>
</tbody></table></div>
<h3>Resilience patterns</h3>
<ul>
<li><b>Retry with exponential backoff and jitter</b>: wait 1 s, 2 s, 4 s, 8 s… plus a little randomness so a thousand clients don’t retry at the same instant. Respect a <code>Retry-After</code> header if one is sent.</li>
<li><b>Circuit breaker</b>: after N failures, stop calling the broken dependency for a while, then test again. Protects both sides.</li>
<li><b>Idempotency</b>: processing the same message twice gives the same result as once. E.g. “insert booking if this booking ID doesn’t exist yet”. <b>Required</b> whenever there are retries, because retries create duplicates.</li>
<li><b>Timeouts</b>: never wait forever. A stuck call holds a lock, a thread and a message.</li>
<li><b>Queue-based load levelling</b> and <b>dead-lettering</b> for poison messages (chapter 9).</li>
<li><b>Transactional outbox</b>: write the business change and the “message to send” in the same DB transaction, then publish, so you never update the DB but lose the message.</li>
<li><b>Chaos engineering</b>: <b>Azure Chaos Studio</b> deliberately injects failures to prove your design works.</li>
</ul>
<div data-widget="backoff"></div>`,
work:`Your CPD push setup retries a failing booking <b>up to 20 times with a 1-second pause</b>. That is a fixed-interval retry: fast when DMS hiccups briefly, but if DMS is overloaded, 20 quick retries add load. Use the visualiser above to compare it with exponential backoff. The other half is <b>idempotency</b>: if DMS actually accepted attempt 3 but the reply timed out, attempts 4–20 must not create a duplicate.`,
terms:['SLA','Composite SLA','RTO','RPO','High availability','Disaster recovery','Transient fault','Exponential backoff','Jitter','Circuit breaker','Idempotency','Outbox pattern'],
quiz:[
{q:'An app depends on a web tier (99.95%) and a database (99.99%). Composite SLA is about…',o:['99.99%','99.97%','99.94%','100%'],a:2,e:'0.9995 × 0.9999 ≈ 0.9994.'},
{q:'The business says “we can lose at most 15 minutes of data”. That is the…',o:['RTO','RPO','SLA','TTL'],a:1,e:'RPO is about data loss; RTO is about downtime.'},
{q:'Which error should NOT be retried automatically?',o:['503 Service Unavailable','429 Too Many Requests','400 Bad Request','504 Gateway Timeout'],a:2,e:'A 400 means the request itself is wrong. Retrying sends the same wrong request.'},
{q:'Why add jitter to retry delays?',o:['To make logs prettier','So many clients don’t retry at exactly the same moment','To reduce cost','It is required by Azure'],a:1,e:'Synchronised retries create a “thundering herd” that knocks the service over again.'},
{q:'A message is processed, the reply times out, and it is retried. What property prevents a duplicate booking?',o:['Scalability','Idempotency','Elasticity','Latency'],a:1,e:'Idempotent processing gives the same result whether it runs once or many times.'}
],
teach:'For one integration you own, write its RTO and RPO as you believe they are today, and what single change would improve each.'
},
/* ───────────────────────── 15 ───────────────────────── */
{
slug:'data-ai', part:'D', title:'Data, analytics and AI services', mins:16,
one:'Azure moves and transforms data (Data Factory, Fabric, Databricks), stores it in lakes and warehouses, and offers AI from ready-made APIs to large language models in Microsoft Foundry.',
kid:`Data services are like a food factory. <b>Data Factory</b> is the truck that collects raw ingredients from many farms (systems). The <b>data lake</b> is the warehouse. <b>Databricks</b>, <b>Synapse</b> and <b>Fabric</b> are the machines that clean and cook. <b>Power BI</b> is the shop window showing the finished dish. <b>AI services</b> are pre-trained brains you can rent: one reads documents, one listens, one translates, and large language models write and reason.`,
body:`
<h3>Moving and preparing data</h3>
<ul>
<li><b>ETL vs ELT</b>: extract-transform-load (clean before loading) vs extract-load-transform (load raw into the lake, transform there). Cloud platforms favour ELT.</li>
<li><b>Azure Data Factory</b>: pipelines that copy and orchestrate data across 90+ connectors (SAP, SQL, Salesforce, files). A <b>self-hosted integration runtime</b> reaches on-prem systems. Mapping data flows transform without code.</li>
<li><b>Azure Data Lake Storage Gen2</b>: cheap storage for raw and curated data (blob storage with hierarchical namespace).</li>
</ul>
<h3>Analytics platforms</h3>
<div class="tw"><table>
<thead><tr><th>Service</th><th>What it is</th></tr></thead>
<tbody>
<tr><td><b>Microsoft Fabric</b></td><td>An all-in-one SaaS analytics platform: OneLake storage, Data Factory, data engineering (Spark), warehouse, real-time intelligence and Power BI, under one capacity licence. Microsoft’s main analytics direction.</td></tr>
<tr><td><b>Azure Databricks</b></td><td>Apache Spark platform with Delta Lake. Popular for data engineering and ML at scale.</td></tr>
<tr><td><b>Azure Synapse Analytics</b></td><td>Earlier integrated analytics: dedicated SQL pools (data warehouse), serverless SQL, Spark, pipelines. New projects usually choose Fabric.</td></tr>
<tr><td><b>Azure Stream Analytics</b></td><td>SQL-like queries over live streams from Event Hubs / IoT Hub.</td></tr>
<tr><td><b>Azure Data Explorer</b></td><td>Very fast analytics on logs and time series, using KQL (the same engine family as Log Analytics).</td></tr>
<tr><td><b>Microsoft Purview</b></td><td>Data catalogue, lineage (where did this number come from?), classification and governance.</td></tr>
<tr><td><b>Power BI</b></td><td>Dashboards and reports for the business.</td></tr>
</tbody></table></div>
<h3>AI on Azure</h3>
<ul>
<li><b>Microsoft Foundry</b> (formerly Azure AI Foundry / Azure AI Studio): the platform for building AI apps and agents. It hosts <b>Azure OpenAI</b> models and a catalogue of models from other providers, with evaluation, safety filters and monitoring.</li>
<li><b>Azure AI Search</b>: keyword plus <b>vector</b> search over your documents. It is the core of <b>RAG</b> (retrieval-augmented generation): find the relevant pages first, then let the model answer using only those pages.</li>
<li><b>Ready-made AI services</b> (call an API, no training needed):
 <ul>
 <li><b>Document Intelligence</b>: extract fields from invoices, receipts, IDs and forms.</li>
 <li><b>Vision</b>: describe images, OCR. <b>Face</b> (restricted access).</li>
 <li><b>Speech</b>: speech-to-text, text-to-speech, translation.</li>
 <li><b>Language</b>: sentiment, key phrases, entity extraction, PII detection, summarisation.</li>
 <li><b>Translator</b>: text and document translation.</li>
 <li><b>Content Safety</b>: detect harmful text and images.</li>
 </ul></li>
<li><b>Azure Machine Learning</b>: train, track and deploy your own models (MLOps).</li>
<li><b>Azure Bot Service</b>: bots for Teams and web chat.</li>
</ul>
<h3>Key AI ideas in plain words</h3>
<ul>
<li><b>Token</b>: a chunk of text (roughly ¾ of a word). Models are priced and limited by tokens.</li>
<li><b>Prompt</b>: the instructions and context you send. <b>Grounding</b>: giving the model your real data so it doesn’t invent answers.</li>
<li><b>Embedding</b>: a list of numbers representing meaning, so similar texts end up close together. This is what vector search uses.</li>
<li><b>Responsible AI</b>: fairness, reliability, privacy, inclusiveness, transparency, accountability. Microsoft’s six principles.</li>
</ul>`,
work:`Two ideas close to your work. Your <b>invoice-adapter</b> apps move invoice data: <b>Document Intelligence</b> is the Azure service that pulls fields out of invoice PDFs, if a partner ever sends documents instead of JSON. And your CPD bot’s reports could feed a <b>Power BI</b> dashboard (stuck bookings by reason, by day) instead of being read as raw output.`,
terms:['ETL','ELT','Data Factory','Data lake','Microsoft Fabric','Databricks','Purview','Power BI','Microsoft Foundry','Azure OpenAI','RAG','Embedding','Token','Document Intelligence'],
quiz:[
{q:'Which service copies data from on-prem SAP into a data lake on a schedule?',o:['Azure Data Factory','Azure Front Door','Key Vault','Bastion'],a:0,e:'Data Factory pipelines with a self-hosted integration runtime reach on-prem sources.'},
{q:'You want an AI assistant that answers only from your company’s documents. Core pattern?',o:['RAG with Azure AI Search plus a model in Foundry','A bigger VM','Event Hubs','Azure Policy'],a:0,e:'Retrieve the relevant documents, then ground the model’s answer in them.'},
{q:'Which service extracts invoice number, date and total from PDF invoices?',o:['Translator','Document Intelligence','Speech','Stream Analytics'],a:1,e:'Document Intelligence has prebuilt invoice and receipt models.'},
{q:'Microsoft’s all-in-one SaaS analytics platform with OneLake is…',o:['Microsoft Fabric','Azure Batch','Logic Apps','Cosmos DB'],a:0,e:'Fabric unifies data engineering, warehousing, real-time analytics and Power BI.'}
],
teach:'Explain RAG to a school student in four sentences.'
},
/* ───────────────────────── 16 ───────────────────────── */
{
slug:'architecture', part:'D', title:'Designing well: frameworks and patterns', mins:14,
one:'The Well-Architected Framework is Azure’s checklist for good design; the Cloud Adoption Framework is the playbook for moving an organisation to the cloud.',
kid:`Before building a house, builders follow a <b>building code</b> so it doesn’t fall down, catch fire, leak or cost a fortune to heat. The <b>Well-Architected Framework</b> is Azure’s building code. The <b>Cloud Adoption Framework</b> is the moving plan for a whole family moving into the new house.`,
body:`
<h3>Azure Well-Architected Framework: five pillars</h3>
<div class="tw"><table>
<thead><tr><th>Pillar</th><th>Ask yourself</th></tr></thead>
<tbody>
<tr><td><b>Reliability</b></td><td>What happens when each dependency fails? Are retries, timeouts and DLQs designed? Is DR tested?</td></tr>
<tr><td><b>Security</b></td><td>Managed identities? Secrets in Key Vault? Private networking? Least privilege?</td></tr>
<tr><td><b>Cost Optimization</b></td><td>Is every resource needed and right-sized? Are budgets and tags in place?</td></tr>
<tr><td><b>Operational Excellence</b></td><td>Is everything deployed by pipeline from code? Can we see what’s happening (logs, alerts, dashboards)? Are runbooks written?</td></tr>
<tr><td><b>Performance Efficiency</b></td><td>Does it scale out? Where are the bottlenecks? Was it load-tested?</td></tr>
</tbody></table></div>
<p>Pillars trade off: more redundancy improves reliability but costs more. Good architecture is choosing those trade-offs deliberately and writing them down. The <b>Azure Well-Architected Review</b> is a free online assessment.</p>
<h3>Cloud Adoption Framework (CAF)</h3>
<ol>
<li><b>Strategy</b>: why move? Business outcomes.</li>
<li><b>Plan</b>: inventory, skills, prioritisation.</li>
<li><b>Ready</b>: build the <b>landing zone</b>: management groups, subscriptions, networking (hub-spoke), identity, policy, logging, set up before workloads arrive.</li>
<li><b>Adopt</b>: migrate existing workloads, or build new cloud-native ones.</li>
<li><b>Govern</b>, <b>Secure</b>, <b>Manage</b>: ongoing policy, cost control, security and operations.</li>
</ol>
<h3>Migration strategies</h3>
<div class="tw"><table>
<thead><tr><th>Strategy</th><th>Meaning</th><th>Example</th></tr></thead>
<tbody>
<tr><td>Rehost (“lift and shift”)</td><td>Move as-is to VMs</td><td>On-prem Windows server → Azure VM</td></tr>
<tr><td>Replatform</td><td>Small changes to use PaaS</td><td>SQL Server → Azure SQL Managed Instance</td></tr>
<tr><td>Refactor</td><td>Change code structure, keep behaviour</td><td>Your .NET Functions → Python Functions with 100% parity</td></tr>
<tr><td>Rearchitect</td><td>Redesign for the cloud</td><td>Monolith → event-driven microservices</td></tr>
<tr><td>Rebuild / Replace</td><td>Write new, or buy SaaS</td><td>Custom CRM → Dynamics 365</td></tr>
</tbody></table></div>
<p>Tools: <b>Azure Migrate</b> (discover, assess and migrate servers, databases and web apps) and <b>Azure Database Migration Service</b>.</p>
<h3>Patterns worth knowing by name</h3>
<ul>
<li><b>Hub and spoke</b> network topology.</li>
<li><b>Event-driven architecture</b>: producers publish events, consumers react independently (your DMS → Service Bus → Functions flow).</li>
<li><b>Strangler fig</b>: replace a legacy system piece by piece behind a stable front (APIM is often that front). Your .NET→Python migration can roll out app by app this way.</li>
<li><b>Gateway offloading / routing</b>: put shared concerns (auth, throttling) in APIM, not in each app.</li>
<li><b>Competing consumers</b>: many function instances reading the same queue.</li>
<li><b>CQRS</b>: separate the models for writing and for reading.</li>
<li><b>Sidecar</b> and <b>Ambassador</b>: helper containers next to the app (Dapr is an example).</li>
</ul>
<p>The <b>Azure Architecture Center</b> (learn.microsoft.com/azure/architecture) has reference architectures with diagrams for almost every scenario.</p>`,
work:`Run your SAP→Unicommerce integration through the five pillars yourself. <b>Reliability</b>: what happens to SAP’s call when Uniware is down? <b>Security</b>: is the APIM header secret in a named value? Is the Uniware password in Key Vault? <b>Cost</b>: what do the NAT Gateway and APIM tier cost per month? <b>Operations</b>: is there an alert when calls fail? <b>Performance</b>: what is the 95th-percentile latency? If you can answer all five without asking anyone, you understand your system.`,
terms:['Well-Architected Framework','Cloud Adoption Framework','Landing zone','Rehost','Refactor','Azure Migrate','Strangler fig','Event-driven architecture','Competing consumers'],
quiz:[
{q:'Which is NOT a Well-Architected pillar?',o:['Reliability','Security','Marketing','Cost Optimization'],a:2,e:'The five: Reliability, Security, Cost Optimization, Operational Excellence, Performance Efficiency.'},
{q:'Setting up management groups, hub networking, policy and logging before migrating workloads is called building a…',o:['Landing zone','Resource lock','Data lake','Region pair'],a:0,e:'The CAF “Ready” phase builds the landing zone.'},
{q:'Replacing a legacy system gradually, piece by piece, behind a stable façade is the…',o:['Circuit breaker','Strangler fig pattern','CQRS','Sidecar'],a:1,e:'New parts “strangle” the old system until it can be removed.'},
{q:'Moving an on-prem server to an Azure VM without changes is…',o:['Refactor','Rehost','Rebuild','Replace'],a:1,e:'Rehost, also known as lift and shift.'}
],
teach:'Pick one of your systems and write one sentence per Well-Architected pillar about its biggest weakness.'
}
];
