### An S3 bucket containing customer files was found to be publicly readable. How do you respond?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html -->
Observe: establish what is exposed and for how long. Check the bucket policy, ACLs and Block Public Access settings, then S3 server access logs or CloudTrail data events for who read objects, and from which IPs.

Hypothesise: a bucket policy with `"Principal": "*"`, a public ACL, or Block Public Access turned off for the bucket or account (often to make a website or a quick test work).

Verify:

```bash
aws s3api get-public-access-block --bucket my-bucket
aws s3api get-bucket-policy-status --bucket my-bucket
aws s3api get-bucket-policy --bucket my-bucket
aws s3api get-bucket-acl --bucket my-bucket
```

Fix, immediately: enable Block Public Access at account and bucket level, remove the offending policy statements and ACLs, and set Object Ownership to "bucket owner enforced" to disable ACLs. Then assess impact: examine logs, rotate any secrets stored in objects, and follow disclosure obligations if personal data was accessed.

Prevent: account-level Block Public Access, an SCP denying its removal, AWS Config rules (`s3-bucket-public-read-prohibited`), IAM Access Analyzer alerts, and serving public content through CloudFront with Origin Access Control while the bucket stays private.

Common wrong answers
- Deleting the bucket without preserving logs or evidence.
- Fixing only the ACL while a policy remains.
- Making objects private one by one.

### An EC2 instance's application gets AccessDenied on S3 although the bucket policy allows it. Where do you look?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html -->
Observe: the exact error and API call (`GetObject`, `PutObject`, `ListBucket`), the bucket, the key, and which identity is calling (`aws sts get-caller-identity` on the instance).

Hypothesise: access needs an allow with no explicit deny across several layers. Candidates: the instance role lacks an identity-policy allow (a bucket policy alone suffices only for same-account principals in some cases but not when something else denies), `ListBucket` is granted on the object ARN instead of the bucket ARN, a permissions boundary or SCP blocks it, a VPC endpoint policy restricts it, a bucket policy condition (source VPC, MFA, encryption) is not met, or the objects are encrypted with a KMS key whose policy does not allow the role.

Verify:

```bash
aws sts get-caller-identity
aws iam simulate-principal-policy --policy-source-arn <role-arn> \
  --action-names s3:GetObject --resource-arns arn:aws:s3:::my-bucket/data/x.csv
```

Check CloudTrail for the denied event, which includes the evaluation context, and the KMS key policy.

Fix the specific layer: use the correct resource ARNs (`arn:aws:s3:::bucket` for list, `.../*` for objects), add `kms:Decrypt`, adjust the endpoint policy or condition.

Prevent: least-privilege templates, IAM Access Analyzer policy validation.

Common wrong answers
- Granting `s3:*` on `*`.
- Hard-coding access keys on the instance.
- Ignoring explicit denies from SCPs.

### A Lambda function inside a VPC times out when calling a public API and also cannot reach DynamoDB. Why?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html -->
Observe: invocations hit the timeout, logs stop after "calling API", and the function worked before it was attached to the VPC.

Hypothesise: a VPC-attached function gets only a private ENI. It has no internet route unless a NAT gateway exists in a public subnet and the Lambda's subnets route `0.0.0.0/0` to it. Placing Lambda in a public subnet does not give it a public IP. AWS service calls need either NAT or VPC endpoints.

Verify: inspect the route tables of the function's subnets, the security group's outbound rules, and the NAT gateway state. Test connectivity from a temporary instance in the same subnet.

Fix:
1. Put the function in private subnets with a route to a NAT gateway.
2. For DynamoDB and S3, add gateway endpoints (free, no NAT traffic); for other services use interface endpoints.
3. Allow outbound traffic in the security group.
4. Only attach to a VPC if it must reach private resources, because otherwise it is unnecessary.

```bash
aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=subnet-123
```

Prevent: infrastructure as code for VPC patterns, and monitoring NAT data processing costs.

Common wrong answers
- Increasing the function timeout.
- Giving the function an Elastic IP.
- Using a public subnet and assuming internet access.

### You cannot SSH into an EC2 instance. How do you troubleshoot?
<!-- level: basic; kind: scenario; ref: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/TroubleshootingInstancesConnecting.html -->
Observe: the error: timeout versus "Permission denied (publickey)" versus "connection refused". They point to different layers.

Hypothesise for a timeout: security group lacks inbound port 22 from your IP, a network ACL blocks, no public IP or no route to an internet gateway, or the instance failed status checks. For permission denied: wrong key pair, wrong user (`ec2-user`, `ubuntu`, `admin`), or wrong key permissions. For refused: sshd is not running.

Verify:

```bash
aws ec2 describe-instance-status --instance-ids i-0abc --include-all-instances
aws ec2 describe-security-groups --group-ids sg-123
aws ec2 get-console-output --instance-id i-0abc
chmod 400 key.pem && ssh -v -i key.pem ec2-user@<ip>
```

Fix according to cause. Preferably avoid SSH entirely: use SSM Session Manager (needs the SSM agent, an instance role with `AmazonSSMManagedInstanceCore`, and endpoint or NAT access), so no inbound port or key is needed.

If the instance is unreachable, use EC2 Serial Console or stop it, attach its volume to a rescue instance and repair `authorized_keys` or `sshd_config`.

Prevent: Session Manager, restrict port 22 to known ranges, and bake correct users and keys into AMIs.

Common wrong answers
- Opening port 22 to `0.0.0.0/0`.
- Rebooting repeatedly.
- Recreating the instance without investigating.

### Your AWS bill doubled this month. How do you find out why and stop it?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html -->
Observe: open Cost Explorer, group by service, then by linked account, region, usage type and tag, and compare against last month by day to see when the rise began.

Hypothesise: common culprits are NAT gateway data processing and cross-AZ transfer, forgotten resources (unattached EBS volumes, idle load balancers, old snapshots), a scaling loop, S3 request or storage growth, CloudWatch Logs ingestion, data transfer out, or a compromised account mining crypto in other regions.

Verify: use usage-type grouping (for example `NatGateway-Bytes`, `DataTransfer-Out-Bytes`), check CloudTrail for unexpected `RunInstances` in unusual regions, and review Trusted Advisor and Cost Anomaly Detection findings.

Fix: stop the biggest driver first: delete unused resources, add S3 and DynamoDB gateway endpoints to avoid NAT charges, set log retention, use lifecycle policies, right-size instances, and consider Savings Plans for steady load. If compromise is suspected, treat it as a security incident (rotate keys, review IAM).

Prevent: AWS Budgets with alerts, Cost Anomaly Detection, mandatory cost-allocation tags, and regular reviews.

Common wrong answers
- Buying Savings Plans before understanding the spike.
- Looking only at EC2.
- Ignoring data transfer.

### An RDS database sits at 100% CPU and the application reports connection errors. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PerfInsights.html -->
Observe: CloudWatch metrics (CPUUtilization, DatabaseConnections, ReadIOPS, FreeableMemory) and when the pattern began, whether tied to a deploy or traffic.

Hypothesise: an expensive query or missing index, a surge of connections from many app instances or Lambdas exhausting `max_connections`, lock contention, or an undersized instance.

Verify: enable Performance Insights to see top SQL and wait events, check slow query logs, and run `SHOW PROCESSLIST` (MySQL) or `pg_stat_activity` (PostgreSQL).

```sql
SELECT pid, state, wait_event, query_start, left(query,80)
FROM pg_stat_activity ORDER BY query_start LIMIT 20;
```

Fix: stop immediate damage by killing runaway queries and throttling callers. Then add the missing index or rewrite the query, introduce a connection pooler (RDS Proxy, PgBouncer) especially for Lambda, send reads to read replicas, add caching, and resize the instance as the last step.

Prevent: alarms on CPU, connections and replica lag; query reviews with `EXPLAIN` before release; load tests.

Common wrong answers
- Scaling up the instance without checking queries.
- Raising `max_connections` without memory headroom.
- Rebooting repeatedly.

### A DynamoDB table throttles writes even though provisioned capacity looks sufficient. Why?
<!-- level: advanced; kind: scenario; ref: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html -->
Observe: `WriteThrottleEvents` and `ThrottledRequests` increase, but consumed capacity at table level is under the provisioned total.

Hypothesise: a hot partition. Throughput is divided across partitions, and each partition supports about 1,000 write units and 3,000 read units per second. A poorly chosen partition key (a date, a status, a single popular customer) sends most traffic to one partition. Adaptive capacity helps but is not unlimited.

Verify: enable CloudWatch Contributor Insights for DynamoDB to see the most accessed keys, and review key design and access patterns.

Fix: choose a high-cardinality partition key, or shard a hot key by adding a suffix (`customer#17#shard3`) and scatter-gather on read, spread writes in time, batch with exponential backoff and jitter (the SDK retries automatically), and use on-demand capacity for unpredictable spikes. Consider SQS buffering for bursts.

```json
{ "PK": "ORDER#2026-11-19#7", "SK": "ID#9f2c" }
```

Prevent: model access patterns before choosing keys, and load-test with realistic key distributions.

Common wrong answers
- Raising provisioned capacity endlessly.
- Assuming throttling means the table is undersized overall.
- Using a timestamp as the partition key.

### Users in Asia complain that your site hosted in us-east-1 is slow. How do you improve it?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html -->
Observe: measure from the affected regions: DNS, TCP and TLS handshake time, time to first byte, and asset sizes, using synthetic monitoring or browser real-user metrics. Separate static asset delivery from dynamic API latency.

Hypothesise: physical distance and many round trips: uncached static files served from the origin, no compression, no HTTP/2 or HTTP/3, uncacheable API calls.

Verify: `curl -w "%{time_connect} %{time_starttransfer}\n" -o /dev/null -s https://site` from several locations, and check response cache headers.

Fix:
1. Put CloudFront in front, with long cache TTLs for versioned static assets, compression, and Origin Access Control for S3 origins.
2. Cache API responses where possible (short TTLs, cache keys by needed headers only).
3. Even for uncached dynamic traffic, CloudFront improves connection setup by using the AWS backbone (and Global Accelerator can help non-HTTP).
4. If data locality or latency still matters, deploy a regional stack (for example ap-southeast-1) with Route 53 latency-based routing, and replicate data with DynamoDB global tables or Aurora Global Database.

Prevent: performance budgets and RUM monitoring.

Common wrong answers
- Vertically scaling the origin servers.
- Moving the entire app to Asia without considering other users.
- Caching authenticated pages without varying by user.

### Design a highly available web application on AWS that survives an Availability Zone failure.
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html -->
Observe: clarify requirements: availability target, RTO and RPO, traffic pattern, state, compliance, budget.

Hypothesise a design with no single AZ dependency in any layer.

Verify each layer:
1. Edge: Route 53 and CloudFront, with health checks.
2. Compute: an Application Load Balancer across at least two AZs, with instances or containers in an Auto Scaling group (or ECS/EKS tasks, or Lambda) spread across AZs, capacity to lose one AZ and still serve peak.
3. State: keep servers stateless; sessions in ElastiCache or DynamoDB; files in S3 or EFS.
4. Data: RDS or Aurora Multi-AZ (automatic failover), or DynamoDB (multi-AZ by design).
5. Network: subnets per AZ, one NAT gateway per AZ to avoid cross-AZ dependence.
6. Operations: health checks on application behavior, alarms, infrastructure as code, tested failover.

Fix gaps found by game days: fail an AZ using AWS Fault Injection Service and watch behavior.

Prevent: capacity planning with N+1 AZs, deployment automation, and runbooks.

Common wrong answers
- Multi-AZ for the database but a single NAT gateway or single AZ for compute.
- Confusing Multi-AZ (availability) with read replicas (scaling).
- Assuming Auto Scaling replaces tested failover.

### The business needs a disaster recovery plan for a region-wide outage. How do you choose a strategy?
<!-- level: advanced; kind: scenario; ref: https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html -->
Observe: ask for RTO (how long can we be down) and RPO (how much data can we lose) per workload, plus cost tolerance. Not every system deserves the same tier.

Hypothesise using the four standard strategies, in rising cost and falling recovery time:
1. Backup and restore: copy backups cross-region (RPO hours, RTO hours).
2. Pilot light: data replicated, minimal core running, scale up on disaster.
3. Warm standby: a scaled-down full copy always running.
4. Multi-site active/active: full capacity in two regions (near-zero RTO and RPO, highest cost and complexity).

Verify with tests: restore actual backups, run failover exercises, measure real RTO and RPO.

Fix and build: replicate data (S3 cross-region replication, Aurora Global Database, DynamoDB global tables, cross-region snapshots with AWS Backup), define infrastructure as code deployable in the secondary region, use Route 53 failover records or Application Recovery Controller, replicate secrets and AMIs, and plan DNS TTLs and dependencies such as IAM and third-party services.

Prevent: schedule regular DR drills and keep runbooks current.

Common wrong answers
- Assuming Multi-AZ equals disaster recovery.
- Never testing the restore.
- Choosing active/active for everything regardless of cost.

### Lambda cold starts are hurting latency on a customer-facing API. What options do you have?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html -->
Observe: in CloudWatch Logs, `REPORT` lines show `Init Duration` on cold invocations. Use Lambda Insights or X-Ray to see how frequent cold starts are, since low-traffic functions and traffic bursts have many.

Hypothesise: large deployment packages, heavy initialisation (SDK clients, config fetches, DB connections), runtimes with slow startup (JVM, .NET), VPC networking in older setups (now much reduced), or low memory size meaning less CPU.

Verify: compare init versus handler duration, and test with different memory sizes.

Fix:
1. Reduce package size and initialise work lazily or outside the handler only when needed.
2. Increase memory (more CPU speeds init) using AWS Lambda Power Tuning.
3. Use Provisioned Concurrency for predictable latency (costs money while provisioned), possibly with scheduled scaling.
4. For Java, use SnapStart; for .NET and others consider native AOT or lighter runtimes.
5. Keep dependencies lean and reuse connections across invocations.

```bash
aws lambda put-provisioned-concurrency-config --function-name api \
  --qualifier prod --provisioned-concurrent-executions 10
```

Prevent: track p99 latency including init, and test bursts.

Common wrong answers
- Scheduled pings as the only solution.
- Provisioned concurrency everywhere without checking cost.
- Ignoring package size.

### SQS messages are being processed multiple times and a bad message keeps blocking the queue. How do you fix this?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html -->
Observe: duplicate side effects (double emails), the same message ID appearing in logs, and `ApproximateAgeOfOldestMessage` growing.

Hypothesise: standard queues give at-least-once delivery, so duplicates are normal. Reprocessing also occurs if processing exceeds the visibility timeout (the message becomes visible again while still being handled), or if the consumer crashes before deleting. A poison message that always fails is retried forever.

Verify: compare processing time with `VisibilityTimeout`, check `ApproximateNumberOfMessagesNotVisible`, and review consumer error logs.

Fix:
1. Make consumers idempotent (a deduplication key stored with a conditional write).
2. Set visibility timeout above worst-case processing time (for Lambda, at least six times the function timeout), and extend it for long jobs.
3. Configure a dead-letter queue with `maxReceiveCount` (for example 5) and alarm on its depth.
4. With Lambda, use partial batch responses (`ReportBatchItemFailures`) so one bad message does not retry the whole batch.
5. Use FIFO queues with deduplication IDs if order and exactly-once processing within the window matter.

Prevent: redrive tests and alarms.

Common wrong answers
- Expecting a standard queue never to duplicate.
- Increasing retries without a DLQ.
- Deleting messages before processing.

### An IAM access key was found in a public GitHub repository. What do you do?
<!-- level: basic; kind: scenario; ref: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html -->
Observe: identify the key owner and its permissions, and when it was committed. Check whether AWS has already notified you (the Health Dashboard and a support case) or applied a quarantine policy.

Hypothesise: assume compromise. Attackers scan commits within minutes and typically launch expensive instances or exfiltrate data.

Verify: CloudTrail event history by access key ID for the exposure window (for example `lookup-events --lookup-attributes AttributeKey=AccessKeyId,AttributeValue=AKIA...`), and look for activity in unfamiliar regions, new IAM users or roles, `RunInstances`, `CreateAccessKey`, or S3 listing.

Fix:
1. Deactivate the key immediately (`aws iam update-access-key --status Inactive`), then delete it after investigating.
2. Revoke any session tokens derived from it (attach a deny-before-time inline policy).
3. Remove unauthorised resources and credentials created by the attacker.
4. Rotate any secrets that the key could read.
5. Remove the key from Git history, knowing it remains public in forks and caches.

Prevent: do not use long-lived keys; use IAM Identity Center and roles (instance profiles, OIDC for CI), git-secrets or gitleaks pre-commit hooks, and GuardDuty.

Common wrong answers
- Deleting the commit and keeping the key active.
- Rotating without checking CloudTrail.
- Assuming a private repo is safe.

### An Auto Scaling group is not adding instances under load, or keeps scaling in and out repeatedly. What do you check?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html -->
Observe: Auto Scaling activity history, the CloudWatch metric driving the policy, and the group's min, max and desired values.

Hypothesise for no scale-out: max size reached, policy metric not breaching (wrong metric, for example CPU while the bottleneck is memory or connections), alarm in `INSUFFICIENT_DATA`, launch failures (no capacity in the instance type or AZ, quota limits, bad AMI or launch template, missing IAM permission), or cooldown or warm-up preventing action. For flapping: scale-in too aggressive, thresholds too close, instance warm-up too short so new instances' metrics are not yet stable.

Verify:

```bash
aws autoscaling describe-scaling-activities --auto-scaling-group-name web --max-items 10
aws autoscaling describe-policies --auto-scaling-group-name web
aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A
```

Fix: use target tracking on an appropriate metric (ALB `RequestCountPerTarget` is often better than CPU), raise max and quotas, diversify instance types with a mixed instances policy, set a realistic warm-up, and lengthen scale-in cooldown.

Prevent: load-test scaling, alarm on failed activities.

Common wrong answers
- Manually setting desired capacity as the permanent solution.
- Using only CPU for every workload.
- Ignoring launch errors in activity history.

### Clients intermittently get 502 and 504 errors from your Application Load Balancer. How do you diagnose them?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-troubleshooting.html -->
Observe: CloudWatch metrics `HTTPCode_ELB_502_Count`, `HTTPCode_ELB_504_Count`, `HTTPCode_Target_5XX_Count`, `TargetResponseTime`, `UnHealthyHostCount`, and ALB access logs, which show the error reason and which target served the request.

Hypothesise: a 502 means the target sent an invalid response or closed the connection, often because the target's keep-alive timeout is lower than the ALB idle timeout (60 seconds default), or the app crashed during a deploy. A 504 means the target did not respond within the idle timeout (slow request) or a security group or network issue blocks traffic.

Verify: check access log fields (`elb_status_code`, `target_status_code`, `target_processing_time`), health check results, and deploy times against error spikes.

Fix: set the app's keep-alive timeout above the ALB idle timeout, fix slow endpoints or move long tasks to async processing, correct health check path and thresholds, enable deregistration delay for graceful deploys, ensure target security groups allow the ALB.

Prevent: alarms on 5xx and unhealthy hosts, and connection-draining tests during deployments.

Common wrong answers
- Only raising the idle timeout.
- Treating all 5xx as one cause.
- Ignoring access logs.

### You must migrate a 2 TB production database to AWS with minimal downtime. What is your plan?
<!-- level: advanced; kind: scenario; ref: https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html -->
Observe: gather facts: source engine and version, size and change rate, network bandwidth, acceptable downtime, schema features, and target (RDS, Aurora, or self-managed).

Hypothesise: a bulk copy alone would take too long and miss changes, so use full load plus change data capture (CDC).

Verify with assessments: run AWS Schema Conversion Tool and the DMS pre-migration assessment if engines differ, test connectivity (VPN or Direct Connect), size the target, and rehearse on a copy.

Fix and execute:
1. Build the target and network, convert the schema.
2. Start a DMS task with full load and ongoing replication (or use native replication such as logical replication or binlog for homogeneous migrations).
3. Validate data (DMS validation, row counts, checksums) and test the application against the target.
4. Schedule cutover: stop writes on source, wait for lag to reach zero, verify, switch connection strings or DNS (low TTL), and keep reverse replication or the source for rollback.
5. Monitor, tune, then decommission.

Prevent: rehearse at least twice and write a rollback plan.

Common wrong answers
- Dump and restore for a busy production system.
- Skipping validation.
- Forgetting sequences, users and extensions.

### Instances in a private subnet cannot reach the internet to download updates. What is missing?
<!-- level: basic; kind: scenario; ref: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html -->
Observe: `yum update` or `curl` hangs, while the instance reaches other VPC resources fine.

Hypothesise: a private subnet is one whose route table has no route to an internet gateway. For outbound-only access, you need a NAT gateway in a public subnet, and the private subnet's route table needs `0.0.0.0/0` to that NAT gateway. The public subnet must route to an internet gateway, and the NAT gateway needs an Elastic IP.

Verify:

```bash
aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=subnet-priv
aws ec2 describe-nat-gateways --filter Name=state,Values=available
```

Also check the network ACL (ephemeral ports return traffic) and security group outbound rules.

Fix: create or repair the NAT gateway and routes. To reduce cost and exposure for AWS-only traffic, use VPC endpoints (gateway endpoints for S3 and DynamoDB, interface endpoints for others, such as SSM and ECR) so traffic never leaves the AWS network.

Prevent: one NAT gateway per AZ for resilience, and monitor NAT data charges.

Common wrong answers
- Assigning a public IP to a private instance without an internet gateway route.
- Pointing the route directly to an internet gateway, making the subnet public.
- Forgetting the NAT gateway lives in a public subnet.

### Another AWS account needs access to your S3 bucket and to assume a role in your account. How do you set it up securely?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/IAM/latest/UserGuide/tutorial_cross-account-with-roles.html -->
Observe: clarify who needs what: read-only data access, a specific operation, or administration, and whether the accounts are in the same AWS Organization.

Hypothesise: prefer roles over sharing users or keys. Cross-account access requires permission on both sides: the resource or trust policy in the owning account and an identity policy in the calling account.

Verify the design: for S3, the bucket policy names the other account's role as principal; for role assumption, the role's trust policy names the other account (and ideally a specific role), and the caller has `sts:AssumeRole` for that ARN.

Fix and implement:

```json
{ "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::222222222222:role/analytics" },
  "Action": ["s3:GetObject"], "Resource": "arn:aws:s3:::shared-data/reports/*" }
```

Add `aws:PrincipalOrgID` conditions when appropriate, require an external ID for third-party access (confused deputy protection), keep session durations short, and restrict with least privilege. If objects are KMS-encrypted, grant `kms:Decrypt` in the key policy too.

Prevent: IAM Access Analyzer to detect external access, and AWS RAM or Organizations to standardise sharing.

Common wrong answers
- Creating an IAM user and sharing keys.
- Granting `Principal: "*"`.
- Forgetting the calling account's own permissions.

### Uploads of very large files from mobile clients to your API are failing and overloading servers. How would you redesign it?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html -->
Observe: servers show high memory and bandwidth during uploads, timeouts occur on flaky mobile networks, and API latency affects other users.

Hypothesise: files stream through the application tier, which becomes the bottleneck and the failure point.

Verify: measure upload sizes and durations, API instance network metrics, and failure rates by size.

Fix: let clients upload directly to S3.
1. The API authenticates the user, validates metadata, and returns a pre-signed URL (or pre-signed POST with size and content-type conditions) with a short expiry.
2. For large files, use multipart upload (the SDK or Transfer Utility handles retry and parallelism per part; parts 5 MB to 5 GB, up to 10,000 parts).
3. S3 emits an event (EventBridge or SQS or Lambda) when the object lands, triggering virus scanning, thumbnails, and database updates.
4. Optionally enable S3 Transfer Acceleration for distant clients.
5. Add a lifecycle rule to abort incomplete multipart uploads.

```python
url = s3.generate_presigned_url("put_object",
    Params={"Bucket": b, "Key": key, "ContentType": "video/mp4"}, ExpiresIn=900)
```

Prevent: encrypt, restrict key prefixes per user, and log access.

Common wrong answers
- Raising server timeouts and memory.
- Long-lived or reusable pre-signed URLs.
- Letting clients choose arbitrary object keys.

### How would you deploy a new version of a containerised service on ECS without downtime and with fast rollback?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-bluegreen.html -->
Observe: decide the risk profile: stateless or stateful, backward-compatible database changes, and the traffic level.

Hypothesise: a rolling update (ECS default) suffices for low risk, with `minimumHealthyPercent` 100 and `maximumPercent` 200 so new tasks come up before old ones leave, gated by ALB health checks. Higher risk calls for blue/green or canary.

Verify: confirm health checks reflect real readiness, graceful shutdown handling (`stopTimeout`, SIGTERM), and deregistration delay.

Fix and implement:
1. Rolling: tune the percentages, add the deployment circuit breaker with rollback enabled so failed deployments revert automatically.
2. Blue/green with CodeDeploy: a second target group receives the new task set, test traffic is verified through a test listener, then traffic shifts all at once, in linear steps, or as a canary, with CloudWatch alarms triggering automatic rollback. ECS also provides built-in blue/green deployments in newer releases.
3. Keep the old task set around for a bake time to allow instant rollback.
4. Make database migrations backward compatible (expand and contract).

```json
"deploymentConfiguration": { "deploymentCircuitBreaker": { "enable": true, "rollback": true },
  "minimumHealthyPercent": 100, "maximumPercent": 200 }
```

Prevent: automated smoke tests in the pipeline.

Common wrong answers
- Stopping all tasks then starting new ones.
- Relying on container "running" status as health.
- Irreversible database changes with the deploy.

### Application secrets such as database passwords are stored in environment variables in plain text. How would you improve this on AWS?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html -->
Observe: find where the secrets live: task definitions, Lambda configuration, CloudFormation templates, repositories, CI variables. They are visible to anyone with describe permissions and appear in logs and consoles.

Hypothesise: secrets should live in a dedicated store, be fetched at runtime by the workload's own identity, be encrypted with KMS, and be rotatable without redeploys.

Verify exposure with an inventory: `aws lambda get-function-configuration`, `aws ecs describe-task-definition`, and repository scans.

Fix:
1. Store secrets in AWS Secrets Manager (rotation, including managed RDS rotation) or SSM Parameter Store SecureString (cheaper, simpler).
2. Grant the task or function role `secretsmanager:GetSecretValue` for specific secret ARNs, plus `kms:Decrypt` if using a customer-managed key.
3. For ECS, reference secrets in the task definition's `secrets` section so they are injected at launch; for Lambda, fetch at init and cache (the Parameters and Secrets Lambda extension helps).
4. Prefer IAM database authentication or short-lived credentials so no static password exists.
5. Rotate existing secrets, because earlier exposure counts as compromise.

Prevent: scan for secrets in CI and use service control policies for guardrails.

Common wrong answers
- Encoding secrets in base64.
- Committing encrypted blobs with a shared key.
- Fetching the secret on every request.

### Your Lambda function scales out and overwhelms a downstream database and a rate-limited API. How do you control it?
<!-- level: advanced; kind: scenario; ref: https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html -->
Observe: concurrent executions spike with traffic, the database shows connection exhaustion, third-party API returns 429s, and Lambda retries make it worse.

Hypothesise: Lambda scales quickly (up to account concurrency limits and burst scaling rates), but dependencies do not. Asynchronous invocations and event sources retry on failure, amplifying the load.

Verify: check the `ConcurrentExecutions` metric, throttles, errors, and database connection counts.

Fix:
1. Set reserved concurrency on the function as a ceiling that matches downstream capacity (it also guarantees capacity).
2. Put an SQS queue in front and limit the event source mapping's maximum concurrency, smoothing bursts into steady processing.
3. Use RDS Proxy to pool connections.
4. Add retries with exponential backoff and jitter for the third-party API, honour `Retry-After`, and use a DLQ or on-failure destination.
5. Make handlers idempotent so retries are safe.

```bash
aws lambda put-function-concurrency --function-name worker --reserved-concurrent-executions 20
aws lambda update-event-source-mapping --uuid <id> \
  --scaling-config MaximumConcurrency=20
```

Prevent: load tests with a downstream capacity model.

Common wrong answers
- Asking for a higher account limit.
- Increasing the database size only.
- Letting retries run unbounded.

### A CloudFormation stack update failed and the stack is stuck in UPDATE_ROLLBACK_FAILED. What now?
<!-- level: advanced; kind: scenario; ref: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html -->
Observe: in the stack events, find the first resource with `*_FAILED` status and its reason. Rollback failures usually arise because a resource cannot return to its previous state.

Hypothesise: a resource was changed manually outside CloudFormation (drift), a dependent resource was deleted, an IAM role was removed so the rollback lacks permission, or a limit or conflict (a name already in use) blocks restoration.

Verify:

```bash
aws cloudformation describe-stack-events --stack-name app --query \
 "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]"
aws cloudformation detect-stack-drift --stack-name app
```

Fix: correct the underlying cause (restore the deleted resource or permission), then continue the rollback:

```bash
aws cloudformation continue-update-rollback --stack-name app
```

If a resource cannot be fixed, continue the rollback while skipping it (`--resources-to-skip LogicalId`), which marks it as updated and may leave it out of sync, so reconcile it afterwards through import or manual correction.

Prevent: forbid manual changes via IAM and SCPs, use change sets to preview, enable termination and update protection on critical resources, deletion policies and stack policies, and test templates in lower environments.

Common wrong answers
- Deleting the stack immediately and losing resources.
- Editing resources by hand to "fix" them.
- Ignoring the first failure event.

### A critical resource was deleted in production overnight and nobody knows who did it. How do you investigate?
<!-- level: intermediate; kind: scenario; ref: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference.html -->
Observe: note the resource ID, type, region, and the approximate time it disappeared.

Hypothesise: management events (such as `DeleteBucket`, `TerminateInstances`, `DeleteDBInstance`) are recorded by CloudTrail. The caller could be a person, an automation role, a CloudFormation stack deletion, or compromised credentials.

Verify: CloudTrail Event history covers 90 days of management events in the console; for longer retention or complex queries use the organization trail in S3 with Athena, or CloudTrail Lake.

```bash
aws cloudtrail lookup-events --lookup-attributes \
  AttributeKey=EventName,AttributeValue=TerminateInstances --start-time 2026-11-18T00:00:00Z
```

Read `userIdentity` (type, ARN, session issuer), `sourceIPAddress`, `userAgent`, and `eventTime`. AWS Config shows the resource's configuration history and relationships.

Fix: restore from backup, snapshots, or versioning where possible; then address the root cause, such as overly broad permissions or a faulty pipeline.

Prevent: enable multi-region organization trails with log file validation and a protected S3 bucket, apply termination protection and deletion protection (RDS, DynamoDB), S3 versioning with MFA delete or Object Lock, restrictive IAM and SCPs, and EventBridge alerts on destructive API calls.

Common wrong answers
- Guessing who did it from access lists.
- Looking only at the console without checking the region.
- Having no trail enabled.

### An EBS volume on a production EC2 instance is almost full. How do you expand it without downtime?
<!-- level: basic; kind: scenario; ref: https://docs.aws.amazon.com/ebs/latest/userguide/requesting-ebs-volume-modifications.html -->
Observe: confirm with `df -h` and `lsblk` which filesystem is full and what is consuming space (`du -xh --max-depth=1 /var | sort -h`); logs and temp files are common, and expanding may not be the only answer.

Hypothesise: genuine data growth, or runaway logs and caches. If growth is genuine, EBS supports Elastic Volumes, which can modify size, type and IOPS while attached and in use.

Verify: take a snapshot first as a safety net, and check that the volume is not in a modification cooldown (about six hours between modifications).

Fix:

```bash
aws ec2 create-snapshot --volume-id vol-0abc --description "pre-resize"
aws ec2 modify-volume --volume-id vol-0abc --size 200
aws ec2 describe-volumes-modifications --volume-ids vol-0abc
# on the instance
sudo growpart /dev/nvme0n1 1
sudo resize2fs /dev/nvme0n1p1      # ext4
sudo xfs_growfs -d /               # xfs
```

Volumes can only grow, not shrink. Shrinking requires creating a smaller volume and copying data.

Prevent: CloudWatch agent disk-usage alarms at 80%, log rotation, and shipping logs to CloudWatch Logs or S3.

Common wrong answers
- Stopping and detaching without need.
- Forgetting to extend the partition and filesystem after modifying the volume.
- Resizing without a snapshot.
