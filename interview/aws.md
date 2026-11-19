# AWS interview questions

### What is the AWS shared responsibility model?
<!-- level: basic; kind: concept; ref: https://aws.amazon.com/compliance/shared-responsibility-model/ -->
AWS is responsible for security "of" the cloud: the physical data centres, hardware, networking, and the virtualisation and managed-service software layers. The customer is responsible for security "in" the cloud: data, identity and access management, operating system and application patching on services such as EC2, network configuration (security groups, routes), encryption choices, and client-side protection.

The split shifts with the service. On EC2 you patch the guest OS. On managed services like RDS, AWS patches the engine and OS but you still manage users, parameters, network exposure and backups policy. On Lambda, you own only code, permissions and data.

Strong answers give a concrete example: a public S3 bucket leaking data is the customer's misconfiguration, not an AWS failure.

Interview tip: say responsibility moves toward AWS as you use higher-level services, but identity and data are always yours.

### What is the difference between IAM users, groups, roles and policies?
<!-- level: basic; kind: concept; ref: https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html -->
A user is a long-lived identity with credentials (password, access keys) for a person or program. A group is a collection of users to attach permissions to collectively; groups cannot be nested and are not identities themselves. A role is an identity with no permanent credentials that is assumed to get temporary credentials from STS; it is used by AWS services (EC2 instance profiles, Lambda execution roles), cross-account access and federated users. A policy is a JSON document that defines allowed or denied actions on resources, attached to identities or resources.

Best practice is to avoid long-lived access keys: use IAM Identity Center for humans and roles for workloads, with least privilege and MFA.

```json
{ "Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::reports/*" }
```

Interview tip: explain that roles issue short-lived credentials, which is why they are safer than keys.

### How does IAM evaluate a request, and what wins between Allow and Deny?
<!-- level: intermediate; kind: concept; ref: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html -->
All requests are denied by default. AWS gathers every applicable policy and evaluates them: an explicit Deny in any policy always wins; otherwise, an explicit Allow is needed from the relevant policies, and guardrails must also allow it. Guardrails include Service Control Policies at the organisation level, permissions boundaries on the identity, and session policies. For same-account access, an identity policy or a resource policy allow can be enough; for cross-account access, both the caller's identity policy and the resource policy must allow.

So the effective permission is the intersection of guardrails, combined with the union of identity and resource allows, minus any explicit deny.

Debugging tools include the IAM policy simulator, Access Analyzer and CloudTrail error details.

Interview tip: recite "default deny, explicit deny overrides allow, SCPs and boundaries only limit and never grant".

### What EC2 purchasing options exist and when would you use each?
<!-- level: basic; kind: concept; ref: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-purchasing-options.html -->
On-Demand charges per second with no commitment, good for spiky or unpredictable work and for testing. Savings Plans and Reserved Instances give discounts (up to roughly 70 percent or more) in exchange for a one- or three-year commitment, suited to steady baseline load; Compute Savings Plans are flexible across instance families, regions and even Lambda and Fargate. Spot Instances use spare capacity at deep discounts but can be reclaimed with a two-minute warning, so they suit fault-tolerant, stateless or batch workloads such as CI, big data and containers with retries. Dedicated Hosts and Dedicated Instances provide isolation or per-socket licensing compliance. Capacity Reservations guarantee capacity in an AZ.

A typical mix: Savings Plan for the baseline, On-Demand for normal growth, Spot for flexible capacity.

Interview tip: mention diversifying Spot across instance types and AZs to reduce interruption risk.

### How do S3 storage classes and lifecycle rules reduce cost, and what is S3's consistency model?
<!-- level: intermediate; kind: concept; ref: https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html -->
S3 Standard serves frequently accessed data. Standard-IA and One Zone-IA lower storage cost for infrequent access with retrieval fees and a minimum duration (One Zone-IA keeps data in one AZ only). Intelligent-Tiering moves objects automatically between tiers based on access, ideal when patterns are unknown. Glacier Instant Retrieval, Flexible Retrieval and Deep Archive are archive tiers with progressively cheaper storage and slower, costlier retrieval.

Lifecycle rules transition objects between classes or expire them after set days, and can clean up old versions and incomplete multipart uploads.

Since December 2020, S3 provides strong read-after-write consistency for all operations, including overwrites and deletes, and for listings, so older eventual-consistency workarounds are unnecessary.

```json
{ "Rules": [{ "ID": "archive", "Status": "Enabled", "Filter": {},
  "Transitions": [{ "Days": 30, "StorageClass": "STANDARD_IA" }],
  "Expiration": { "Days": 365 } }] }
```

Interview tip: note that eleven nines is durability, not availability.

### What makes a subnet public or private in a VPC?
<!-- level: basic; kind: concept; ref: https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html -->
A VPC is your isolated virtual network with a CIDR range. Subnets are slices of that range, each living in one Availability Zone. A subnet is public if its route table has a route for `0.0.0.0/0` to an internet gateway (and instances there have public or Elastic IPs). A subnet is private if it has no such route; instances there reach the internet outbound only through a NAT gateway placed in a public subnet, or reach AWS services through VPC endpoints.

Typical layout: public subnets for load balancers and NAT gateways, private subnets for application servers, and isolated private subnets for databases, repeated across at least two AZs.

Related pieces: route tables, internet gateway, NAT gateway, VPC endpoints (gateway for S3 and DynamoDB, interface via PrivateLink), peering and Transit Gateway for connecting VPCs.

Interview tip: emphasise that "public" is defined by routing, not by a setting on the subnet name.

### What is the difference between security groups and network ACLs?
<!-- level: basic; kind: concept; ref: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html -->
Security groups are stateful firewalls attached to network interfaces (instances, load balancers, databases). They only have allow rules; return traffic is automatically permitted, and rules can reference other security groups, which is how you express "app tier may reach database tier". Network ACLs are stateless firewalls at the subnet boundary with numbered allow and deny rules evaluated in order, so both inbound and outbound (including ephemeral return ports) must be allowed explicitly.

Use security groups as the primary control. Use NACLs for coarse subnet-level blocks, such as denying a hostile IP range, or as an additional compliance layer.

```bash
aws ec2 authorize-security-group-ingress --group-id sg-db \
  --protocol tcp --port 5432 --source-group sg-app
```

Interview tip: stateful versus stateless, and allow-only versus allow and deny, are the two points interviewers want.

### How do an Application Load Balancer and a Network Load Balancer differ?
<!-- level: intermediate; kind: concept; ref: https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html -->
An Application Load Balancer works at layer 7 (HTTP, HTTPS, gRPC, WebSockets). It routes by host, path, header and query string, supports redirects, fixed responses, authentication through OIDC or Cognito, and can target instances, IPs and Lambda. A Network Load Balancer works at layer 4 (TCP, UDP, TLS), delivers very high throughput with low latency, gives static IPs per AZ (and can use Elastic IPs), preserves the client source IP, and supports PrivateLink endpoint services. A Gateway Load Balancer inserts virtual appliances such as firewalls.

Choose ALB for web apps and microservices with content-based routing. Choose NLB for non-HTTP protocols, extreme performance, or fixed IP requirements.

Health checks determine which targets receive traffic, and cross-zone load balancing affects distribution and, for NLB, data transfer cost.

Interview tip: mention using NLB in front of ALB when you need static IPs with layer 7 routing.

### How does EC2 Auto Scaling work, and what scaling policies are available?
<!-- level: intermediate; kind: concept; ref: https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html -->
An Auto Scaling group maintains a number of instances between a minimum and maximum, launched from a launch template across chosen subnets and AZs. It replaces unhealthy instances (using EC2 or ELB health checks) and adjusts capacity with policies. Target tracking keeps a metric near a target value, such as 50 percent CPU or requests per target, and is the simplest and usually best choice. Step scaling adds or removes capacity in steps based on alarm severity. Scheduled scaling handles known patterns, and predictive scaling forecasts load from history.

Instance warm-up avoids counting new instances before they are ready, and cooldowns and scale-in protection prevent thrashing. Mixed instances policies combine On-Demand and Spot across multiple types.

Rolling replacement uses instance refresh when the launch template changes.

Interview tip: say scaling is only as good as the metric; request count per target often beats CPU for web tiers.

### What is the difference between RDS Multi-AZ and read replicas?
<!-- level: intermediate; kind: concept; ref: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html -->
Multi-AZ is for availability and durability. RDS keeps a standby copy in another AZ using synchronous replication (storage-level for the classic setup), and automatically fails over, typically within one to two minutes, by flipping the endpoint's DNS. The standby does not serve reads in the classic Multi-AZ instance deployment (the Multi-AZ DB cluster option has two readable standbys).

Read replicas are for read scaling and, for some engines, cross-region disaster recovery. They use asynchronous replication, so reads can lag; they have their own endpoints, and can be promoted to standalone databases manually.

Aurora differs: storage is replicated six ways across three AZs, and up to 15 low-lag replicas also act as failover targets.

Remember that neither replaces backups; use automated backups, snapshots, and point-in-time recovery.

Interview tip: summarise as "Multi-AZ is for survival, replicas are for scale".

### How should you choose a partition key in DynamoDB?
<!-- level: advanced; kind: concept; ref: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html -->
DynamoDB distributes items across partitions by hashing the partition key, so the key should have high cardinality and spread requests evenly. A low-cardinality or skewed key (status, date, one big tenant) creates hot partitions and throttling even when total capacity looks adequate. The sort key enables range queries and item collections within one partition key.

Design starts with access patterns, not entities. Use a single-table design when it reduces round trips, composite keys such as `PK = CUSTOMER#123`, `SK = ORDER#2026-11-19#9f2c`, and global secondary indexes for alternative queries (eventually consistent, with their own capacity). Avoid scans on large tables.

Capacity modes: on-demand for unpredictable traffic, provisioned with auto scaling for steady traffic.

Item size is limited to 400 KB, and transactions and conditional writes provide integrity and idempotency.

Interview tip: answer a "hot partition" question with write sharding using suffixes.

### What are Lambda cold starts, and what are Lambda's key limits?
<!-- level: intermediate; kind: concept; ref: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html -->
Lambda runs code in execution environments. When no warm environment exists, Lambda must create one: download the code, start the runtime and run initialisation code outside the handler. That extra latency is a cold start. Warm environments are reused for later invocations, so SDK clients and connections should be created outside the handler.

Mitigations include smaller packages, more memory (which also adds CPU), Provisioned Concurrency, and SnapStart for Java (and some other runtimes in newer releases).

Key limits: maximum timeout 15 minutes, memory 128 MB to 10,240 MB, 10 GB container image or 250 MB unzipped zip package, 6 MB synchronous payload, 512 MB default `/tmp` (configurable up to 10 GB), and an account-level concurrency limit (1,000 by default per region, can be raised). Reserved concurrency caps or guarantees a function's share.

Interview tip: tie cold starts to p99 latency, not average latency.

### When would you use SQS, SNS or EventBridge?
<!-- level: intermediate; kind: concept; ref: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html -->
SQS is a managed queue: producers send messages, consumers poll and delete them. It decouples and buffers load, provides retries, visibility timeouts and dead-letter queues. Standard queues give at-least-once delivery with best-effort ordering; FIFO queues give ordering and deduplication with lower throughput. SNS is publish-subscribe: one message fans out to many subscribers (SQS, Lambda, HTTP, email, SMS), with filtering policies. EventBridge is an event bus with rich rule-based routing on event content, schema registry, SaaS and AWS service events, scheduling, and archive and replay.

Common patterns: SNS fan-out to several SQS queues so each consumer scales independently; EventBridge for routing domain events between services; SQS in front of Lambda to smooth bursts.

Kinesis or MSK are used instead when you need ordered streaming with replay and multiple readers of the same shard.

Interview tip: say "queue for work distribution, topic for broadcast, bus for content-based routing".

### How does CloudFront work and how do you control caching?
<!-- level: intermediate; kind: concept; ref: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html -->
CloudFront is a content delivery network with edge locations worldwide. A viewer request goes to a nearby edge; on a cache hit, content is returned immediately, otherwise CloudFront fetches from the origin (S3, ALB, EC2, or any HTTP server), caches the result according to policy and returns it. It also terminates TLS close to the user, supports HTTP/2 and HTTP/3, compression, WAF and Shield integration, signed URLs and cookies, and edge compute through CloudFront Functions and Lambda@Edge.

Caching is controlled by a cache policy (TTLs and which headers, cookies and query strings form the cache key), an origin request policy (what is forwarded without being part of the key), and origin `Cache-Control` headers. Smaller cache keys give higher hit ratios. Invalidations remove content early, but versioned file names are cheaper and faster.

Use Origin Access Control so an S3 origin accepts requests only from CloudFront.

Interview tip: mention cache-key design as the main lever for hit ratio.

### What routing policies does Route 53 offer?
<!-- level: intermediate; kind: concept; ref: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html -->
Route 53 is a DNS service with health checking. Simple routing returns one record (or several values chosen by the client). Weighted routing splits traffic by percentage, useful for canary releases and migrations. Latency-based routing sends users to the region with the lowest measured latency. Failover routing serves a primary record and switches to a secondary when a health check fails. Geolocation routes by user location (compliance, content localisation) and geoproximity by distance with bias. Multivalue answer returns several healthy records.

Alias records point to AWS resources (CloudFront, ALB, S3 website) at the zone apex, without query charges and with automatic IP tracking, unlike CNAMEs which are not permitted at the apex.

DNS answers are cached according to the TTL, so failover speed depends on TTL and client behaviour, not just health checks.

Interview tip: pair weighted routing with low TTLs for gradual cutovers.

### How do EBS, EFS and S3 differ as storage options?
<!-- level: basic; kind: concept; ref: https://docs.aws.amazon.com/ebs/latest/userguide/what-is-ebs.html -->
EBS provides block storage volumes that attach to one EC2 instance in the same AZ (io2 Block Express supports Multi-Attach in some cases). It offers low latency, suitable for boot volumes and databases, with types such as gp3, io2 and st1, snapshots stored in S3, and encryption. EFS is a managed NFS file system that many instances and containers across AZs mount concurrently, growing automatically, for shared content and home directories (Linux only). S3 is object storage accessed over HTTP APIs, virtually unlimited, highly durable and cheap, but not a POSIX file system and with higher latency per operation.

Also mention instance store (physically attached, very fast, ephemeral) for caches and scratch data, and FSx for Windows, Lustre and other specialised file systems.

Rule of thumb: EBS for one server's disk, EFS for shared files, S3 for objects, backups and data lakes.

Interview tip: mention that EBS volumes are tied to an AZ, so recovery across AZs uses snapshots.

### How does AWS KMS work, and what is envelope encryption?
<!-- level: advanced; kind: concept; ref: https://docs.aws.amazon.com/kms/latest/developerguide/overview.html -->
AWS KMS manages cryptographic keys, with key material protected in FIPS-validated hardware security modules. A KMS key never leaves KMS in plaintext; applications ask KMS to encrypt, decrypt or generate data keys. Key policies (and grants and IAM) control who may use each key, and CloudTrail logs every use, giving auditability. Keys can be AWS-owned, AWS-managed (`aws/s3`) or customer-managed, which allow your own policies, rotation (automatic yearly option) and cross-account sharing.

Envelope encryption encrypts data with a data key that is itself encrypted by a KMS key. `GenerateDataKey` returns a plaintext data key (used locally, then discarded) and the encrypted copy (stored alongside the data). This avoids sending large data to KMS (direct encrypt is limited to 4 KB) and enables fast local encryption. S3, EBS and RDS use this pattern with their server-side encryption.

Pitfall: a role may have S3 permissions but fail with AccessDenied if it lacks `kms:Decrypt` on the key.

Interview tip: explain that KMS controls access to keys, which is how you revoke access to data.

### What is infrastructure as code on AWS, and how does CloudFormation work?
<!-- level: intermediate; kind: concept; ref: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html -->
Infrastructure as code defines resources in versioned files so environments are repeatable, reviewable and auditable. CloudFormation takes a template (YAML or JSON) describing resources, parameters, mappings and outputs, and creates a stack, provisioning resources in dependency order. Updating the template produces a change set you can review before execution, and failures roll back to the previous state. Drift detection reveals manual changes. StackSets deploy across accounts and regions, nested stacks and modules reuse patterns.

The AWS CDK lets you write infrastructure in general-purpose languages that synthesises to CloudFormation. Terraform is a popular multi-cloud alternative with its own state file.

```yaml
Resources:
  Bucket:
    Type: AWS::S3::Bucket
    Properties: { VersioningConfiguration: { Status: Enabled } }
```

Use `DeletionPolicy: Retain` or `Snapshot` for stateful resources to prevent accidental data loss.

Interview tip: mention change sets and drift detection as safety practices.

### What is the difference between CloudWatch, CloudTrail and AWS Config?
<!-- level: basic; kind: concept; ref: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html -->
CloudWatch is for operational monitoring: metrics (CPU, latency, custom), logs (CloudWatch Logs with Insights queries), alarms, dashboards, and events and scheduling through EventBridge. It answers "how is the system performing right now?". CloudTrail records API calls made in your account: who did what, from where and when, which supports security investigations and auditing. Management events are on by default with 90-day history; trails to S3 give long retention and data events (S3 object access, Lambda invocations) are opt-in. AWS Config records resource configuration over time and evaluates it against rules, answering "what did this resource look like, and is it compliant?".

Together: CloudWatch alarms notice a symptom, CloudTrail identifies the change or actor, and Config shows what changed and flags non-compliant configurations.

Add X-Ray or OpenTelemetry for distributed tracing.

Interview tip: use the one-liners: metrics and logs, API audit, configuration history.

### What are the pillars of the AWS Well-Architected Framework?
<!-- level: basic; kind: concept; ref: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html -->
The framework offers best practices for evaluating architectures across six pillars: Operational Excellence (automation, observability, learning from failures), Security (identity, data protection, detection, incident response), Reliability (fault tolerance, recovery, change management), Performance Efficiency (selecting and evolving right resource types), Cost Optimization (paying only for what you need, visibility, right-sizing), and Sustainability (minimising environmental impact of workloads).

Teams use the Well-Architected Tool to review workloads, identify risks and prioritise improvements. Lenses extend it for areas such as serverless, SaaS and machine learning.

The pillars involve trade-offs: more reliability usually costs more, and security controls can add latency. Good architects state the trade-offs and tie decisions to business requirements.

An example: choosing multi-AZ deployments trades cost for reliability, while Graviton instances improve cost, performance and sustainability together.

Interview tip: pick two or three pillars relevant to the scenario and discuss concrete trade-offs rather than reciting all six.
