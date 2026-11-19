## 3. Compute

### Amazon EC2 fundamentals
<!-- level: basic; ref: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html -->
Amazon Elastic Compute Cloud (EC2) provides virtual servers called instances. You choose:

- An AMI (Amazon Machine Image): the OS and preinstalled software, such as Amazon Linux 2023, Ubuntu, Windows Server, or your own golden image.
- An instance type: family, generation and size. General purpose (M, T burstable), compute optimised (C), memory optimised (R, X), storage optimised (I), accelerated (P, G, Inf, Trn). A "g" in the name (m8g, c7g) means AWS Graviton (Arm) processors, which often give better price-performance.
- Networking: VPC subnet (which fixes the AZ), security groups, optional public IP or Elastic IP.
- Storage: EBS volumes and possibly instance store.
- An IAM instance profile (role) for AWS API access.
- User data: a script that runs at first boot to configure the instance.

The Nitro System underpins modern instances, offloading networking, storage and security to dedicated hardware for near bare-metal performance.

```bash
aws ec2 run-instances --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --instance-type m8g.large --subnet-id subnet-0abc --security-group-ids sg-0web \
  --iam-instance-profile Name=app-instance-profile \
  --metadata-options HttpTokens=required \
  --user-data file://bootstrap.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=app,Value=orders}]'
```

- Use Systems Manager Session Manager instead of SSH with open port 22: no bastion, no keys, every session audited.
- Require IMDSv2 (HttpTokens=required) to block SSRF attacks against the metadata service.
- Pitfall: treating instances as pets. Bake images or use automation so any instance can be replaced.

### EC2 purchasing options
<!-- level: intermediate; ref: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-purchasing-options.html -->
The same instance can cost very different amounts depending on how you buy it.

- On-Demand: pay per second (Linux) with no commitment. Flexible but the most expensive.
- Savings Plans: commit to a dollar amount of compute usage per hour for one or three years. Compute Savings Plans apply across EC2 families, Regions, Fargate and Lambda; EC2 Instance Savings Plans give deeper discounts for a family in a Region.
- Reserved Instances: older commitment model tied to instance attributes; Savings Plans are usually simpler for new purchases.
- Spot Instances: spare capacity at up to around 90 percent discount, but AWS can reclaim it with a two-minute warning. Good for stateless, fault-tolerant work: batch, CI, big data, containers.
- Dedicated Hosts and Dedicated Instances: physical isolation for compliance or per-socket licensing.
- Capacity Reservations: guarantee capacity in an AZ (no discount by themselves), useful for critical events or DR.

A typical blended strategy: baseline covered by Savings Plans, peaks on On-Demand, interruptible work on Spot.

```bash
# Auto Scaling group mixing On-Demand base and diversified Spot
aws autoscaling create-auto-scaling-group --auto-scaling-group-name workers \
  --min-size 2 --max-size 30 --vpc-zone-identifier "subnet-a,subnet-b,subnet-c" \
  --mixed-instances-policy '{
    "LaunchTemplate": { "LaunchTemplateSpecification": { "LaunchTemplateName": "worker-lt" },
      "Overrides": [ {"InstanceType":"m7g.large"}, {"InstanceType":"m8g.large"}, {"InstanceType":"c7g.xlarge"} ] },
    "InstancesDistribution": { "OnDemandBaseCapacity": 2, "OnDemandPercentageAboveBaseCapacity": 0,
      "SpotAllocationStrategy": "price-capacity-optimized" } }'
```

- Pitfall: Spot with a single instance type in one AZ gets interrupted often; diversify types and AZs.

### EBS volumes and instance store
<!-- level: basic; ref: https://docs.aws.amazon.com/ebs/latest/userguide/what-is-ebs.html -->
Amazon Elastic Block Store (EBS) provides network-attached block volumes for EC2. A volume lives in one AZ and attaches to instances in that AZ; it persists independently of the instance's life.

Volume types:

- gp3: general-purpose SSD, the default choice. Baseline 3,000 IOPS and 125 MB/s regardless of size, with IOPS and throughput provisioned independently.
- io2 Block Express: provisioned IOPS SSD for critical databases needing high IOPS, low latency and higher durability.
- st1 and sc1: throughput-optimised and cold HDD for large sequential workloads and archives.

Snapshots are incremental, point-in-time backups stored in S3 (managed by AWS). You can copy them across Regions and accounts, create volumes from them in any AZ, and automate them with Data Lifecycle Manager or AWS Backup. Encryption with KMS can be enabled by default per Region.

Instance store is physically attached NVMe disk on some instance types: very fast, but data is lost when the instance stops, terminates or the host fails. Use it for caches, scratch space and replicated data.

```bash
aws ec2 enable-ebs-encryption-by-default --region ap-south-1
aws ec2 create-volume --availability-zone ap-south-1a --volume-type gp3 \
  --size 200 --iops 6000 --throughput 250 --encrypted
aws ec2 create-snapshot --volume-id vol-0abc --description "pre-upgrade"
```

- Pitfall: gp2 volumes tie IOPS to size; migrating to gp3 is usually cheaper and faster.
- Pitfall: the instance type also caps EBS bandwidth.

### EC2 Auto Scaling
<!-- level: intermediate; ref: https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html -->
An Auto Scaling group (ASG) keeps a fleet of EC2 instances at the right size and health. You define minimum, maximum and desired capacity, a launch template (AMI, type, user data, role) and the subnets across AZs.

What it does:

- Self-healing: replaces instances that fail EC2 or load balancer health checks.
- AZ balancing: spreads instances across AZs and rebalances.
- Scaling policies:
  - Target tracking: keep a metric near a target, for example average CPU 50 percent or ALB requests per target 1,000. The simplest and usually best choice.
  - Step scaling: add or remove capacity in steps based on alarm breach size.
  - Scheduled scaling: known patterns such as business hours.
  - Predictive scaling: forecasts daily or weekly patterns and scales ahead.
- Instance refresh: rolling replacement when the launch template changes, with minimum healthy percentage and optional checkpoints.
- Lifecycle hooks: run custom actions on launch or termination (drain connections, ship logs).
- Warm pools: pre-initialised stopped instances for faster scale-out of slow-booting apps.

```bash
aws autoscaling put-scaling-policy --auto-scaling-group-name web-asg \
  --policy-name cpu50 --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "PredefinedMetricSpecification": { "PredefinedMetricType": "ASGAverageCPUUtilization" },
    "TargetValue": 50.0 }'
aws autoscaling start-instance-refresh --auto-scaling-group-name web-asg \
  --preferences '{"MinHealthyPercentage": 90, "InstanceWarmup": 120}'
```

- Pitfall: using only EC2 status checks; enable ELB health checks so the ASG replaces instances whose app is broken.

### Elastic Load Balancing: ALB, NLB and GWLB
<!-- level: intermediate; ref: https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html -->
Elastic Load Balancing distributes traffic across targets (EC2 instances, IP addresses, containers, Lambda functions) in multiple AZs and stops sending traffic to unhealthy targets.

- Application Load Balancer (ALB): layer 7 for HTTP, HTTPS, HTTP/2, gRPC and WebSockets. Listener rules route by host, path, headers, query string or source IP to target groups. Supports TLS termination with ACM certificates, OIDC/Cognito authentication, weighted target groups for blue-green and canary, and AWS WAF.
- Network Load Balancer (NLB): layer 4 for TCP, UDP and TLS. Millions of requests per second, ultra-low latency, static IP per AZ (or Elastic IPs), preserves client source IPs, and backs PrivateLink endpoint services.
- Gateway Load Balancer (GWLB): transparently inserts third-party virtual appliances (firewalls, IDS) into traffic flows using GENEVE.

Key concepts: listeners, rules, target groups, health checks (path, interval, thresholds), deregistration delay (connection draining), cross-zone load balancing, and stickiness.

```bash
aws elbv2 create-target-group --name orders-api-tg --protocol HTTP --port 8080 \
  --vpc-id vpc-0abc --target-type ip --health-check-path /healthz \
  --health-check-interval-seconds 10 --healthy-threshold-count 2
aws elbv2 create-rule --listener-arn $HTTPS_LISTENER --priority 10 \
  --conditions Field=path-pattern,Values='/api/orders/*' \
  --actions Type=forward,TargetGroupArn=$ORDERS_TG
```

- Pitfall: a slow or deep health check (calling the database) can mark every target unhealthy during a database blip and take the whole site down.

### AWS Lambda
<!-- level: basic; ref: https://docs.aws.amazon.com/lambda/latest/dg/welcome.html -->
AWS Lambda runs your code in response to events without servers to manage. You upload a function (zip package or container image), choose a runtime (Node.js, Python, Java, .NET, Ruby, custom runtimes via provided.al2023), memory size (128 MB to 10,240 MB; CPU scales proportionally) and timeout (up to 15 minutes). You pay per request and per GB-second of execution.

Invocation models:

- Synchronous: API Gateway, ALB, function URLs, SDK Invoke. The caller waits for the result.
- Asynchronous: S3 events, SNS, EventBridge. Lambda queues the event, retries twice on error, and can send failures to a destination or DLQ.
- Event source mappings (polling): Lambda reads from SQS, Kinesis, DynamoDB Streams, Kafka and Amazon MQ in batches, with partial batch failure reporting.

```python
import json, os, boto3
table = boto3.resource("dynamodb").Table(os.environ["TABLE"])   # created once per execution environment

def handler(event, context):
    failures = []
    for record in event["Records"]:                              # SQS batch
        try:
            order = json.loads(record["body"])
            table.put_item(Item=order, ConditionExpression="attribute_not_exists(pk)")
        except Exception:
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
```

- Initialise SDK clients and connections outside the handler so they are reused across invocations.
- Pitfall: Lambda is not ideal for long-running, steady high-throughput workloads; containers on Fargate or EC2 can be cheaper.
- Pitfall: handlers must be idempotent because asynchronous and polling sources can deliver duplicates.

### Lambda concurrency, scaling and cold starts
<!-- level: advanced; ref: https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html -->
Concurrency is the number of requests a function is handling at the same moment. Each concurrent request uses its own execution environment. Roughly, concurrency equals requests per second multiplied by average duration in seconds.

Limits and controls:

- Account concurrency quota per Region (default 1,000, raisable) shared by all functions.
- Scaling rate: each function can add up to 1,000 concurrent executions every 10 seconds.
- Reserved concurrency: guarantees capacity for a function and also caps it, protecting downstream systems such as a database with limited connections. Setting it to 0 effectively disables the function.
- Provisioned concurrency: pre-initialised environments that eliminate cold starts, billed while configured; can be scheduled with Application Auto Scaling.

Cold starts happen when Lambda creates a new environment: downloading code, starting the runtime and running your initialisation code. They matter most for Java and .NET and for large packages. Mitigations:

- SnapStart (Java, Python, .NET): snapshots the initialised environment and resumes from it.
- Smaller packages, fewer dependencies, lazy initialisation, Graviton (arm64).
- Provisioned concurrency for latency-critical paths.

```bash
aws lambda put-function-concurrency --function-name charge-payment \
  --reserved-concurrent-executions 50
aws lambda put-provisioned-concurrency-config --function-name checkout-api \
  --qualifier live --provisioned-concurrent-executions 20
```

- Pitfall: throttles (429 TooManyRequestsException) on synchronous calls go back to the caller; asynchronous events are retried for up to six hours.
- Interview tip: reserved concurrency is the simplest way to stop Lambda from overwhelming a relational database.

## 4. Containers

### Amazon ECS and AWS Fargate
<!-- level: intermediate; ref: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html -->
Amazon Elastic Container Service (ECS) is AWS's own container orchestrator. It is simpler than Kubernetes and deeply integrated with AWS services.

Concepts:

- Cluster: a logical grouping of capacity.
- Task definition: a versioned JSON blueprint (images, CPU and memory, ports, environment, secrets, log configuration, task role and execution role).
- Task: a running instance of a task definition.
- Service: keeps a desired number of tasks running, integrates with load balancers, performs rolling or blue-green deployments, and autoscales.
- Capacity: AWS Fargate (serverless, you never see hosts) or EC2 instances managed via capacity providers and ASGs. ECS Managed Instances is an additional option where AWS manages the EC2 fleet.

Two IAM roles matter: the task execution role (used by ECS to pull images from ECR and fetch secrets) and the task role (used by your application code).

```json
{
  "family": "orders-api",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "512", "memory": "1024",
  "runtimePlatform": { "cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX" },
  "executionRoleArn": "arn:aws:iam::111122223333:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::111122223333:role/orders-api-task",
  "containerDefinitions": [{
    "name": "api",
    "image": "111122223333.dkr.ecr.ap-south-1.amazonaws.com/orders-api:1.8.0",
    "portMappings": [{ "containerPort": 8080 }],
    "secrets": [{ "name": "DB_PASSWORD", "valueFrom": "arn:aws:secretsmanager:ap-south-1:111122223333:secret:orders-db" }],
    "logConfiguration": { "logDriver": "awslogs", "options": {
      "awslogs-group": "/ecs/orders-api", "awslogs-region": "ap-south-1", "awslogs-stream-prefix": "api" } }
  }]
}
```

- Pitfall: giving permissions to the execution role that belong on the task role (or the reverse) causes confusing AccessDenied errors.

### Amazon EKS
<!-- level: intermediate; ref: https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html -->
Amazon Elastic Kubernetes Service (EKS) runs a managed, conformant Kubernetes control plane across multiple AZs. You use standard Kubernetes tools and manifests; AWS handles the API servers and etcd.

Compute options for worker nodes:

- Managed node groups: AWS provisions and updates EC2 nodes in ASGs.
- Self-managed nodes: full control, more work.
- Fargate profiles: each pod runs on its own serverless capacity.
- Karpenter: open-source node autoscaler that launches right-sized instances (including Spot) directly from pending pod requirements.
- EKS Auto Mode: AWS manages node provisioning, scaling, OS updates and core add-ons (networking, storage, load balancing) for you.

Integration points:

- Networking: the Amazon VPC CNI gives pods VPC IP addresses; the AWS Load Balancer Controller provisions ALBs and NLBs from Ingress, Gateway API and Service objects.
- Identity: EKS access entries map IAM principals to Kubernetes permissions; EKS Pod Identity or IRSA gives pods IAM roles.
- Add-ons: CoreDNS, kube-proxy, VPC CNI, EBS CSI driver, managed and versioned by EKS.

```bash
eksctl create cluster --name platform-prod --region ap-south-1 --version 1.33 \
  --nodegroup-name general --node-type m7g.large --nodes 3 --nodes-min 3 --nodes-max 10
aws eks create-pod-identity-association --cluster-name platform-prod \
  --namespace orders --service-account orders-api \
  --role-arn arn:aws:iam::111122223333:role/orders-api-pod
```

- Pitfall: VPC CNI consumes VPC IPs per pod; small subnets run out. Plan large subnets or use prefix delegation.
- ECS or EKS? ECS for simplicity on AWS only; EKS for Kubernetes portability, ecosystem and existing skills.

### Amazon ECR
<!-- level: basic; ref: https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html -->
Amazon Elastic Container Registry (ECR) is a managed, private OCI registry for container images and other artifacts such as Helm charts. ECR Public hosts public images, and pull-through cache rules let you cache upstream registries (Docker Hub, ECR Public, Quay, GitHub Container Registry) inside your account to avoid rate limits and external dependencies.

Key features:

- IAM-based access: ECS execution roles, EKS nodes or pods, and CI roles get ecr:BatchGetImage and related permissions; repository policies allow cross-account pulls.
- Image scanning: basic scanning or enhanced scanning with Amazon Inspector for OS and language package vulnerabilities, continuously re-evaluated.
- Tag immutability: prevents overwriting a tag such as 1.8.0.
- Lifecycle policies: expire untagged images or keep only the last N images.
- Replication: cross-Region and cross-account replication for multi-Region deployments and DR.
- Encryption with KMS.

```bash
aws ecr create-repository --repository-name orders-api \
  --image-tag-mutability IMMUTABLE --image-scanning-configuration scanOnPush=true
aws ecr get-login-password --region ap-south-1 | docker login --username AWS \
  --password-stdin 111122223333.dkr.ecr.ap-south-1.amazonaws.com
docker buildx build --platform linux/arm64 \
  -t 111122223333.dkr.ecr.ap-south-1.amazonaws.com/orders-api:1.8.0 --push .
aws ecr put-lifecycle-policy --repository-name orders-api --lifecycle-policy-text '{
  "rules":[{"rulePriority":1,"selection":{"tagStatus":"untagged","countType":"sinceImagePushed","countUnit":"days","countNumber":7},"action":{"type":"expire"}}]}'
```

- Pitfall: pulling images through a NAT gateway is billed per GB; add ECR and S3 VPC endpoints for private subnets.
