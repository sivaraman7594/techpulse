## 7. Networking

### Amazon VPC and subnets
<!-- level: basic; ref: https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html -->
A Virtual Private Cloud (VPC) is your logically isolated network in a Region, defined by an IPv4 CIDR block (for example 10.30.0.0/16) and optionally IPv6. Every account has a default VPC per Region for quick experiments, but production workloads use custom VPCs.

Subnets live in exactly one Availability Zone and carve up the VPC range. The usual pattern is three tiers across at least two (ideally three) AZs:

- Public subnets: route to an internet gateway. Only load balancers, NAT gateways and bastion-like edge components belong here.
- Private application subnets: no direct inbound internet; outbound through NAT gateways or VPC endpoints.
- Private data subnets: databases and caches, reachable only from the app tier.

AWS reserves five IP addresses in every subnet. Plan CIDR ranges up front across all accounts and on-premises networks to avoid overlaps that later block peering, Transit Gateway or VPN connectivity. IP Address Manager (IPAM) helps allocate ranges centrally.

```bash
aws ec2 create-vpc --cidr-block 10.30.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=orders-prod}]'
aws ec2 create-subnet --vpc-id vpc-0abc --cidr-block 10.30.0.0/20 \
  --availability-zone-id aps1-az1 --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=app-a}]'
```

- Pitfall: subnets that are too small, especially for EKS where each pod consumes an IP address.
- Tip: VPC Flow Logs capture accepted and rejected traffic metadata for troubleshooting and security analysis.

### Route tables, internet gateways and NAT gateways
<!-- level: basic; ref: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html -->
Traffic in a VPC follows route tables attached to subnets. Every route table has a local route for the VPC CIDR; you add routes for everything else.

- Internet gateway (IGW): attached to the VPC; a subnet becomes "public" when its route table sends 0.0.0.0/0 to the IGW. Instances also need a public IPv4 or Elastic IP to be reachable.
- NAT gateway: lets instances in private subnets start outbound connections to the internet (package updates, third-party APIs) without accepting inbound connections. It lives in a public subnet; private subnets route 0.0.0.0/0 to it.
- Egress-only internet gateway: the IPv6 equivalent of NAT for outbound-only traffic.

For resilience, deploy one NAT gateway per AZ and route each private subnet to the NAT in its own AZ. Otherwise an AZ failure breaks egress for the others, and you pay cross-AZ data charges.

```bash
aws ec2 create-nat-gateway --subnet-id subnet-public-a --allocation-id eipalloc-0abc
aws ec2 create-route --route-table-id rtb-private-a \
  --destination-cidr-block 0.0.0.0/0 --nat-gateway-id nat-0aaa
aws ec2 create-route --route-table-id rtb-public \
  --destination-cidr-block 0.0.0.0/0 --gateway-id igw-0abc
```

- Cost note: NAT gateways bill per hour and per GB processed. Heavy traffic to S3, DynamoDB or ECR through NAT is a classic cost leak; use VPC endpoints.
- Cost note: public IPv4 addresses are billed hourly, which encourages IPv6 and fewer public IPs.

### Security groups and network ACLs
<!-- level: basic; ref: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html -->
AWS gives you two layers of network filtering.

Security groups act on elastic network interfaces (instances, load balancers, RDS, Lambda in a VPC, ECS tasks):

- Stateful: return traffic is allowed automatically.
- Allow rules only; anything not allowed is denied.
- Rules can reference other security groups, which is the cleanest way to express "the app tier may reach the database on 5432".

Network ACLs act on subnets:

- Stateless: you must allow both directions, including ephemeral ports for responses.
- Numbered rules with allow and deny, evaluated in order.
- Useful as a coarse guardrail, for example blocking a known bad CIDR across a subnet.

Most designs rely on security groups and leave NACLs at their default allow-all, adding NACL rules only for specific needs.

```bash
aws ec2 authorize-security-group-ingress --group-id sg-db \
  --ip-permissions 'IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=sg-app}]'
aws ec2 authorize-security-group-ingress --group-id sg-alb \
  --protocol tcp --port 443 --cidr 0.0.0.0/0
```

- Pitfall: opening 0.0.0.0/0 on SSH (22) or RDP (3389). Use Systems Manager Session Manager instead.
- Pitfall: a stateless NACL that forgets ephemeral ports (1024-65535) breaks return traffic in confusing ways.
- Tip: VPC Reachability Analyzer explains why a path between two resources is blocked.

### VPC endpoints and AWS PrivateLink
<!-- level: intermediate; ref: https://docs.aws.amazon.com/vpc/latest/privatelink/what-is-privatelink.html -->
By default, calling AWS services (S3, DynamoDB, SQS, Secrets Manager) from a private subnet means going through a NAT gateway to public service endpoints. VPC endpoints keep that traffic on the AWS network.

- Gateway endpoints: for S3 and DynamoDB only. Added as route-table targets, free of charge. Always add them.
- Interface endpoints (powered by AWS PrivateLink): elastic network interfaces with private IPs in your subnets for most other services (ECR, CloudWatch Logs, STS, SQS, KMS, Secrets Manager). Billed per hour per AZ and per GB. With private DNS enabled, the normal service hostname resolves to the private IPs, so SDKs work unchanged.
- Endpoint policies restrict what can be done through the endpoint, for example only your organisation's buckets.

PrivateLink also lets you publish your own service: put it behind a Network Load Balancer, create an endpoint service, and consumers in other VPCs or accounts create interface endpoints to it, with no peering and no overlapping-CIDR problems. Many SaaS vendors offer connectivity this way.

```bash
aws ec2 create-vpc-endpoint --vpc-id vpc-0abc --vpc-endpoint-type Gateway \
  --service-name com.amazonaws.ap-south-1.s3 --route-table-ids rtb-private-a rtb-private-b
aws ec2 create-vpc-endpoint --vpc-id vpc-0abc --vpc-endpoint-type Interface \
  --service-name com.amazonaws.ap-south-1.secretsmanager \
  --subnet-ids subnet-app-a subnet-app-b --security-group-ids sg-endpoints --private-dns-enabled
```

- Pitfall: the endpoint's security group must allow HTTPS from your workloads.

### VPC peering and Transit Gateway
<!-- level: intermediate; ref: https://docs.aws.amazon.com/vpc/latest/tgw/what-is-transit-gateway.html -->
As the number of VPCs and accounts grows, you need a scalable way to connect them.

VPC peering connects two VPCs (same or different accounts and Regions) privately. It is simple and has no per-hour charge, but it is not transitive (A to B and B to C does not give A to C), CIDRs must not overlap, and a full mesh of N VPCs needs N times N minus one divided by two connections.

AWS Transit Gateway (TGW) is a regional hub router. VPCs, VPN connections and Direct Connect gateways attach to it, and TGW route tables control which attachments can talk to which. That enables segmentation such as "prod VPCs can reach shared services but not dev VPCs", and centralised egress or inspection VPCs with firewalls. Inter-Region peering connects Transit Gateways across Regions. TGW charges per attachment-hour and per GB processed.

Other options: AWS Cloud WAN for global networks defined by policy, and VPC Lattice for service-to-service connectivity at the application layer with IAM-based auth.

```bash
aws ec2 create-transit-gateway --description "core-tgw" \
  --options AmazonSideAsn=64512,DefaultRouteTableAssociation=disable,DefaultRouteTablePropagation=disable
aws ec2 create-transit-gateway-vpc-attachment --transit-gateway-id tgw-0abc \
  --vpc-id vpc-orders --subnet-ids subnet-tgw-a subnet-tgw-b
aws ec2 create-route --route-table-id rtb-private-a \
  --destination-cidr-block 10.0.0.0/8 --transit-gateway-id tgw-0abc
```

- Interview tip: peering for a few VPCs, Transit Gateway for hub-and-spoke at scale, PrivateLink for exposing a single service.

### Amazon Route 53
<!-- level: intermediate; ref: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html -->
Amazon Route 53 is a highly available DNS service with domain registration and health checking.

- Hosted zones: public zones answer internet queries; private hosted zones answer only inside associated VPCs (for internal names like db.orders.internal).
- Alias records: Route 53-specific records that point to AWS resources (ALB, CloudFront, S3 website, API Gateway) at the zone apex, follow IP changes automatically, and cost nothing to query.
- Routing policies:
  - Simple: one answer.
  - Weighted: split traffic, for example 90/10 for canary releases or migrations.
  - Latency-based: send users to the Region with the lowest latency.
  - Failover: primary and secondary with health checks for active-passive DR.
  - Geolocation and geoproximity: route by user location for compliance or localisation.
  - Multivalue answer: several healthy IPs.
- Health checks monitor endpoints or CloudWatch alarms and drive failover.
- Route 53 Resolver: inbound and outbound endpoints and rules for hybrid DNS between VPCs and on-premises; DNS Firewall blocks malicious domains.

```bash
aws route53 change-resource-record-sets --hosted-zone-id Z0123 --change-batch '{
  "Changes": [{ "Action": "UPSERT", "ResourceRecordSet": {
    "Name": "api.example.com", "Type": "A", "SetIdentifier": "mumbai",
    "Region": "ap-south-1",
    "AliasTarget": { "HostedZoneId": "ZP97RAFLXTNZK", "DNSName": "orders-alb-123.ap-south-1.elb.amazonaws.com",
                     "EvaluateTargetHealth": true } } }] }'
```

- Pitfall: long TTLs slow down failovers and migrations; lower them before planned changes.

### Amazon CloudFront
<!-- level: intermediate; ref: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html -->
Amazon CloudFront is AWS's content delivery network. It serves content from hundreds of edge locations, reducing latency and offloading origins.

Concepts:

- Distribution: the CloudFront configuration with one or more origins (S3, ALB, API Gateway, any HTTP server, or a VPC origin for private ALBs and instances).
- Cache behaviours: path patterns (/static/*, /api/*) mapped to origins with cache policies (what is part of the cache key and the TTL) and origin request policies (which headers, cookies and query strings are forwarded).
- Origin access control (OAC): lets CloudFront read from a private S3 bucket, so the bucket never needs to be public.
- Security: TLS with ACM certificates (created in us-east-1), AWS WAF integration, Shield Standard DDoS protection, geo restriction, signed URLs and signed cookies for private content.
- Edge compute: CloudFront Functions (lightweight JavaScript for header manipulation, redirects, URL rewrites) and Lambda@Edge (heavier logic).
- Invalidation: purge cached paths after deployments, or use versioned file names so invalidation is rarely needed.

```bash
aws cloudfront create-invalidation --distribution-id E1ABCDEF --paths "/index.html" "/config.json"
```

```javascript
// CloudFront Function: add security headers on viewer response
function handler(event) {
  var h = event.response.headers;
  h["strict-transport-security"] = { value: "max-age=63072000; includeSubDomains; preload" };
  h["x-content-type-options"] = { value: "nosniff" };
  return event.response;
}
```

- Pitfall: forwarding all headers and cookies to the origin destroys the cache hit ratio.

### Hybrid connectivity: Site-to-Site VPN and Direct Connect
<!-- level: intermediate; ref: https://docs.aws.amazon.com/directconnect/latest/UserGuide/Welcome.html -->
Enterprises connect on-premises networks to AWS in two main ways.

AWS Site-to-Site VPN creates two IPsec tunnels (in different AZs) between your customer gateway device and a virtual private gateway or Transit Gateway. It runs over the internet, is quick to set up, supports BGP for dynamic routing, and is limited to about 1.25 Gbps per tunnel (more with ECMP on Transit Gateway). Accelerated VPN uses Global Accelerator for better paths. AWS Client VPN serves remote users.

AWS Direct Connect provides dedicated private connections from your datacenter or colocation to AWS at 1, 10, 100 or 400 Gbps (dedicated) or smaller hosted connections through partners. It gives consistent latency and lower data transfer out pricing. Virtual interfaces (VIFs) separate traffic: private VIFs to VPCs via a Direct Connect gateway, transit VIFs to Transit Gateways, and public VIFs to AWS public endpoints. Direct Connect is not encrypted by default; use MACsec on supported connections or run IPsec VPN over it.

Resilience recommendations: two connections at two Direct Connect locations for critical workloads, or Direct Connect primary with VPN backup.

```bash
aws ec2 create-vpn-connection --type ipsec.1 \
  --customer-gateway-id cgw-0abc --transit-gateway-id tgw-0abc \
  --options TunnelInsideIpVersion=ipv4,StaticRoutesOnly=false
```

- Pitfall: a single Direct Connect link without backup is a single point of failure for every hybrid application.

## 8. Security services

### AWS KMS
<!-- level: intermediate; ref: https://docs.aws.amazon.com/kms/latest/developerguide/overview.html -->
AWS Key Management Service (KMS) creates and controls cryptographic keys used by almost every AWS service for encryption at rest. Key material never leaves KMS's FIPS-validated HSMs unencrypted.

Key types by ownership:

- AWS owned keys: used invisibly by services; no control or visibility.
- AWS managed keys (aws/s3, aws/rds): created for you per service; you can see but not manage their policies.
- Customer managed keys: you control the key policy, rotation, enable/disable, deletion and grants. Needed for cross-account sharing, fine-grained access and audit.

Envelope encryption: services do not encrypt large data directly with the KMS key. They request a data key, encrypt the data locally with it, and store the data key encrypted under the KMS key. Decryption calls KMS to decrypt the data key. This scales and limits KMS calls.

Access requires both the key policy and IAM to allow it (the key policy must at least enable IAM policies for the account). Every use is logged in CloudTrail.

```bash
aws kms create-key --description "orders data" --key-usage ENCRYPT_DECRYPT
aws kms enable-key-rotation --key-id 1234abcd-... --rotation-period-in-days 365
aws kms create-alias --alias-name alias/orders-data --target-key-id 1234abcd-...
aws kms encrypt --key-id alias/orders-data --plaintext fileb://secret.txt \
  --query CiphertextBlob --output text
```

- Pitfall: scheduling a key for deletion makes all data encrypted with it unrecoverable after the waiting period; disable first and watch CloudTrail for usage.
- Pitfall: high-volume S3 workloads with SSE-KMS hit KMS request quotas and costs; enable S3 Bucket Keys.

### Secrets Manager and Systems Manager Parameter Store
<!-- level: basic; ref: https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html -->
Applications need configuration and secrets without hard-coding them.

AWS Secrets Manager stores secrets (database credentials, API keys, OAuth client secrets) encrypted with KMS, controls access with IAM and resource policies, and logs access in CloudTrail. Its standout feature is automatic rotation: managed rotation for RDS, Aurora and Redshift credentials, or a Lambda function for custom secrets. Cross-Region replication supports multi-Region apps. Billing is per secret per month plus API calls.

AWS Systems Manager Parameter Store holds configuration values and secrets (SecureString parameters encrypted with KMS) in a hierarchy such as /orders/prod/db/host. Standard parameters are free; advanced parameters add size and policies. It has no built-in rotation.

Rule of thumb: Secrets Manager for credentials that should rotate; Parameter Store for configuration and simple secrets.

Consumption patterns: ECS task definitions and EKS (via the Secrets Store CSI driver or External Secrets Operator) inject secrets; Lambda can use the Parameters and Secrets extension which caches values locally.

```python
import json, boto3
from functools import lru_cache
sm = boto3.client("secretsmanager")

@lru_cache(maxsize=1)
def db_credentials():
    value = sm.get_secret_value(SecretId="prod/orders/db")["SecretString"]
    return json.loads(value)
```

- Pitfall: caching a secret forever breaks after rotation; refresh on authentication failure or after a TTL.
- Pitfall: environment variables in plain text on Lambda or task definitions are visible to anyone who can read the configuration.

### AWS WAF and AWS Shield
<!-- level: intermediate; ref: https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html -->
AWS WAF is a web application firewall that inspects HTTP(S) requests to CloudFront, Application Load Balancer, API Gateway, AppSync, Cognito, App Runner and Verified Access.

You build a web ACL from rules and rule groups:

- AWS Managed Rules: core rule set (OWASP-style protections), known bad inputs, SQL injection, Linux/Windows/PHP specific rules, IP reputation and anonymous IP lists.
- Paid managed groups: Bot Control, Account Takeover Prevention, Account Creation Fraud Prevention.
- Custom rules: match on IPs, geography, headers, body, URI, size; rate-based rules to throttle abusive clients by IP or custom keys.
- Actions: Allow, Block, Count (for testing), CAPTCHA and Challenge.

Logs go to CloudWatch Logs, S3 or Firehose for analysis.

AWS Shield Standard protects every AWS customer automatically against common network and transport-layer DDoS attacks. Shield Advanced (paid) adds enhanced detection, the Shield Response Team, application-layer mitigation with WAF, and cost protection for scaling during attacks.

```json
{
  "Name": "rate-limit-login",
  "Priority": 1,
  "Statement": { "RateBasedStatement": { "Limit": 100, "EvaluationWindowSec": 300, "AggregateKeyType": "IP",
    "ScopeDownStatement": { "ByteMatchStatement": { "SearchString": "/login", "FieldToMatch": { "UriPath": {} },
      "PositionalConstraint": "STARTS_WITH", "TextTransformations": [{ "Priority": 0, "Type": "NONE" }] } } } },
  "Action": { "Block": {} },
  "VisibilityConfig": { "SampledRequestsEnabled": true, "CloudWatchMetricsEnabled": true, "MetricName": "rateLimitLogin" }
}
```

- Pitfall: enabling managed rules in Block mode without a Count phase can block legitimate traffic (large JSON bodies, uploads).

### Threat detection: GuardDuty, Security Hub, Inspector and Macie
<!-- level: intermediate; ref: https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html -->
AWS offers managed detection services that should be enabled organisation-wide from a delegated security account.

- Amazon GuardDuty: continuous threat detection using CloudTrail management and data events, VPC Flow Logs and DNS logs, plus optional protection plans for S3, EKS audit logs and runtime, ECS and EC2 runtime, RDS login activity, Lambda network activity and malware scanning. Example findings: crypto-mining from an instance, credentials used from a Tor exit node, unusual S3 data exfiltration, attack sequences that correlate several signals.
- AWS Security Hub: aggregates findings from GuardDuty, Inspector, Macie, IAM Access Analyzer, Config and partners into one view, runs posture checks against standards (AWS Foundational Security Best Practices, CIS), and supports automation rules.
- Amazon Inspector: vulnerability scanning for EC2, ECR images and Lambda functions, with risk scores and code scanning.
- Amazon Macie: discovers and classifies sensitive data (personal data, credentials) in S3.
- Amazon Detective: graph-based investigation of findings.

```bash
aws guardduty create-detector --enable --finding-publishing-frequency FIFTEEN_MINUTES
aws organizations enable-aws-service-access --service-principal guardduty.amazonaws.com
aws guardduty enable-organization-admin-account --admin-account-id 999900001111
```

Route high-severity findings through EventBridge to your ticketing or paging system, and automate common responses (isolating an instance by swapping its security group, disabling a leaked access key).

- Pitfall: enabling detectors without anyone triaging findings provides little value; assign ownership and SLAs.

### Amazon Cognito
<!-- level: intermediate; ref: https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html -->
Amazon Cognito provides customer identity for web and mobile apps.

User pools are user directories and OpenID Connect providers:

- Sign-up and sign-in with username or email and password, passwordless options (email or SMS one-time codes, passkeys), MFA, account recovery and email verification.
- Federation with social providers (Google, Apple, Facebook) and enterprise IdPs via SAML or OIDC.
- Managed login pages (hosted UI) or your own UI via SDKs.
- Issues ID, access and refresh tokens (JWTs) that your APIs validate. API Gateway and ALB can validate Cognito tokens natively.
- Lambda triggers to customise flows: pre sign-up validation, post confirmation, custom claims in tokens via the pre token generation trigger.
- Feature plans (Lite, Essentials, Plus) determine available features such as threat protection.

Identity pools (federated identities) exchange a user-pool token or external identity for temporary AWS credentials, allowing a mobile app to upload directly to S3 under a scoped IAM role.

```javascript
// verify a Cognito access token in a Node.js API
import { CognitoJwtVerifier } from "aws-jwt-verify";
const verifier = CognitoJwtVerifier.create({
  userPoolId: "ap-south-1_AbCdEf123", tokenUse: "access", clientId: "4abc5defghij6klmn7opq8rst" });

export async function authenticate(req) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  return await verifier.verify(token);   // throws if invalid, expired or wrong client
}
```

- Pitfall: validating only the signature but not token_use, client ID and expiry.
- Pitfall: some user pool settings (such as sign-in attributes) cannot be changed after creation; plan them.
