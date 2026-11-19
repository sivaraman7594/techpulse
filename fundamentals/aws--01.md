## 1. AWS foundations

### AWS global infrastructure: Regions, Availability Zones and edge locations
<!-- level: basic; ref: https://docs.aws.amazon.com/whitepapers/latest/aws-overview/global-infrastructure.html -->
AWS runs its services from a worldwide footprint, and understanding its building blocks is the first step in any design.

- Region: a geographic area (for example ap-south-1 Mumbai, eu-west-1 Ireland, us-east-1 N. Virginia) that is fully independent of other Regions. Most services are regional; data stays in the Region you choose unless you copy it out.
- Availability Zone (AZ): one or more discrete datacenters within a Region, with independent power, cooling and networking, connected to the other AZs by low-latency links. Most Regions have three or more AZs. Spreading resources across AZs is the foundation of high availability.
- Local Zones and Wavelength Zones: extensions of a Region closer to large cities or 5G networks for single-digit millisecond latency.
- Edge locations: hundreds of points of presence used by CloudFront, Route 53, Global Accelerator and AWS WAF to serve users close to where they are.

A few services are global (IAM, Route 53, CloudFront, Organizations) and some features of them are anchored in us-east-1, for example ACM certificates for CloudFront must be created there.

```bash
aws ec2 describe-regions --query "Regions[].RegionName" --output text
aws ec2 describe-availability-zones --region ap-south-1 \
  --query "AvailabilityZones[].{name:ZoneName,id:ZoneId}" --output table
```

- Pitfall: AZ names like ap-south-1a are mapped differently per account; use AZ IDs (aps1-az1) when coordinating across accounts.
- Interview tip: Multi-AZ protects against datacenter failures; multi-Region protects against Regional failures and is significantly more complex.

### The AWS shared responsibility model
<!-- level: basic; ref: https://aws.amazon.com/compliance/shared-responsibility-model/ -->
Security and compliance are shared between AWS and the customer. AWS is responsible for security of the cloud: physical facilities, hardware, the global network and the virtualisation layer. You are responsible for security in the cloud: what you build and configure.

The exact split depends on the service:

- Infrastructure services (EC2): you own the guest operating system patches, security groups, IAM, application code and data encryption choices.
- Container services (ECS on Fargate): AWS also manages the host OS; you own task definitions, images, IAM roles and network rules.
- Abstracted services (S3, DynamoDB, Lambda): AWS runs almost everything; you own data, access policies, encryption settings and code.

Whatever the service, these are always yours: identities and permissions, data classification, network exposure, and how you configure logging and encryption.

```text
Incident: an S3 bucket with customer data was public.
Who is responsible? The customer. AWS provided Block Public Access and
default-private buckets; the configuration choice was made in the account.
```

- Interview tip: give examples on both sides. For RDS, AWS patches the database engine when you allow maintenance windows, but you choose public accessibility, parameter groups, encryption and backups retention.
- Pitfall: assuming a managed service is secure by default in every dimension. Defaults have improved (S3 Block Public Access, default encryption), but review each service's configuration.

### AWS accounts and AWS Organizations
<!-- level: intermediate; ref: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_introduction.html -->
An AWS account is the fundamental isolation boundary: resources, IAM identities, quotas and billing are scoped to an account. Mature organisations use many accounts, for example one per workload per environment, rather than one big shared account. This limits the blast radius of mistakes and breaches and makes cost attribution simple.

AWS Organizations manages these accounts centrally:

- Organizational units (OUs): folders of accounts such as Security, Infrastructure, Workloads/Prod, Workloads/NonProd, Sandbox.
- Consolidated billing: one bill, with volume discounts and Savings Plans shared across accounts.
- Service control policies (SCPs): guardrails that set the maximum permissions for principals in member accounts. They do not grant anything; they only limit.
- Resource control policies (RCPs): guardrails on what can be done to resources in your accounts, such as preventing access from outside the organisation.
- Delegated administration for security services such as GuardDuty, Security Hub and IAM Identity Center.

AWS Control Tower builds a governed landing zone on top of Organizations: account factory, log archive and audit accounts, and preventive and detective controls.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyOutsideApprovedRegions",
    "Effect": "Deny",
    "NotAction": ["iam:*", "organizations:*", "sts:*", "support:*", "cloudfront:*", "route53:*"],
    "Resource": "*",
    "Condition": { "StringNotEquals": { "aws:RequestedRegion": ["ap-south-1", "ap-southeast-1"] } }
  }]
}
```

- Pitfall: SCPs do not affect the management account; keep workloads out of it.

### Working with AWS: console, CLI, SDKs and credentials
<!-- level: basic; ref: https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-welcome.html -->
You interact with AWS through APIs, and every tool is a client of those APIs:

- AWS Management Console for exploration and visual troubleshooting.
- AWS CLI v2 for scripting and automation.
- AWS CloudShell: a browser shell with the CLI preinstalled and credentials of your console session.
- SDKs (Python boto3, JavaScript v3, Java v2, .NET, Go v2 and others) for application code.
- Infrastructure as code (CloudFormation, CDK, Terraform) for repeatable environments.

All SDKs and the CLI find credentials through the same default provider chain: environment variables, shared config and credentials files (profiles), SSO sessions from IAM Identity Center, web identity tokens (EKS, CI), container credentials (ECS tasks) and the EC2 instance metadata service. This lets the same code run locally with your SSO profile and in AWS with a role.

```bash
aws configure sso                 # one-time: creates a profile using IAM Identity Center
aws sso login --profile dev-admin
aws sts get-caller-identity --profile dev-admin
aws s3 ls --profile dev-admin --region ap-south-1
```

```python
import boto3
session = boto3.Session()        # uses the default chain: role in AWS, profile locally
s3 = session.client("s3", region_name="ap-south-1")
print([b["Name"] for b in s3.list_buckets()["Buckets"]])
```

- Pitfall: long-lived access keys in ~/.aws/credentials or in code are the most common source of AWS breaches; prefer SSO and roles.
- Tip: aws sts get-caller-identity is the first command to run when permissions look wrong.

## 2. Identity and access management

### IAM fundamentals: users, groups, roles and policies
<!-- level: basic; ref: https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html -->
AWS Identity and Access Management (IAM) controls who can call which AWS APIs on which resources. Every API request is authenticated (who are you?) and authorised (are you allowed?).

Principals:

- Root user: the account's owner identity with unrestricted access. Protect it with MFA, do not create access keys for it, and use it only for the few tasks that require it.
- IAM users: long-term identities with passwords and access keys. Modern practice avoids them for humans (use IAM Identity Center) and for workloads (use roles).
- IAM groups: collections of users for attaching policies.
- IAM roles: identities with permissions but no long-term credentials. Anyone or anything trusted by the role (an EC2 instance, a Lambda function, a user from another account, a federated identity) can assume it and receive temporary credentials.

Policies are JSON documents of statements with Effect, Action, Resource and optional Condition. Identity-based policies attach to principals; resource-based policies attach to resources (S3 bucket policies, SQS queue policies, KMS key policies).

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "arn:aws:s3:::orders-invoices-prod/*",
    "Condition": { "Bool": { "aws:SecureTransport": "true" } }
  }]
}
```

- Prefer AWS managed policies to start, then tighten with customer managed policies scoped to specific resources.
- Pitfall: "Action": "*" with "Resource": "*" on application roles. It is the cloud equivalent of running as root.

### How IAM evaluates a request
<!-- level: intermediate; ref: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html -->
Knowing the evaluation logic is essential for debugging AccessDenied errors and for interviews.

Within a single account, the decision works like this:

1. By default everything is implicitly denied.
2. An explicit Deny in any applicable policy wins, always.
3. Organizations SCPs and RCPs, permission boundaries and session policies act as filters: the action must be allowed by each of them if they are present. They never grant on their own.
4. Then an explicit Allow is needed from an identity-based policy or a resource-based policy.

For cross-account access, both sides must agree: the caller's identity policy must allow the action, and the resource's policy in the other account must allow the caller (or the caller must assume a role in that account).

```text
Request: role "orders-api" calls s3:GetObject on bucket in same account
  SCP allows s3:*?                     yes
  Permission boundary allows it?       none attached
  Identity policy allows it?           yes  -> ALLOW
  Bucket policy has explicit Deny for non-VPC-endpoint traffic and request
  came from the internet?              yes  -> DENY (explicit deny wins)
```

Tools for debugging:

- The error message often includes the policy type that denied the request (for example "with an explicit deny in a service control policy").
- IAM policy simulator to test policies.
- CloudTrail to see the exact principal, action and error code.

```bash
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::111122223333:role/orders-api \
  --action-names s3:GetObject \
  --resource-arns arn:aws:s3:::orders-invoices-prod/2026/11/inv-1.pdf
```

- Pitfall: KMS-encrypted objects need kms:Decrypt on the key as well, and the key policy must allow it.

### IAM roles and temporary credentials with STS
<!-- level: intermediate; ref: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html -->
A role has two policies: a trust policy (who may assume it) and permissions policies (what it can do once assumed). AWS Security Token Service (STS) issues temporary credentials (access key, secret key, session token) that expire, typically after one hour, which removes the risk of long-lived secrets.

Where roles show up:

- EC2 instance profiles: the instance metadata service (use IMDSv2) delivers role credentials to code on the instance.
- Lambda execution roles and ECS task roles: each function or task gets its own role.
- EKS: IAM roles for service accounts (IRSA) or EKS Pod Identity give pods individual roles.
- Cross-account access: a role in account B trusts account A; users in A assume it.
- Federation: SAML or OIDC identities (corporate IdP, GitHub Actions) assume roles via AssumeRoleWithSAML or AssumeRoleWithWebIdentity.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::111122223333:role/ci-deployer" },
    "Action": "sts:AssumeRole",
    "Condition": { "StringEquals": { "sts:ExternalId": "orders-ci-7f3a" } }
  }]
}
```

```bash
aws sts assume-role --role-arn arn:aws:iam::444455556666:role/deploy-orders \
  --role-session-name ci-run-512 --external-id orders-ci-7f3a
```

- Use ExternalId when a third party assumes a role in your account, to prevent the confused deputy problem.
- Pitfall: trusting an entire account ("Principal": {"AWS": "arn:aws:iam::111122223333:root"}) lets any principal there with sts:AssumeRole permission in. Narrow it to specific roles.

### IAM Identity Center for human access
<!-- level: basic; ref: https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html -->
IAM Identity Center (formerly AWS SSO) is the recommended way to give people access to many AWS accounts. Instead of IAM users per account, people sign in once with your identity provider and receive temporary credentials for the accounts and roles they are entitled to.

How it works:

- Identity source: Identity Center's own directory, Active Directory, or an external IdP such as Microsoft Entra ID or Okta (with SCIM provisioning of users and groups).
- Permission sets: templates of policies (for example ReadOnly, Developer, DatabaseAdmin). When you assign a group plus permission set to an account, Identity Center creates a matching IAM role in that account.
- Access portal: users pick an account and role and get console access or CLI credentials.
- CLI integration: aws configure sso and aws sso login fetch short-lived credentials, so no access keys exist on laptops.

```bash
aws sso-admin create-permission-set --instance-arn $INSTANCE_ARN \
  --name DeveloperAccess --session-duration PT4H
aws sso-admin create-account-assignment --instance-arn $INSTANCE_ARN \
  --target-id 444455556666 --target-type AWS_ACCOUNT \
  --permission-set-arn $PS_ARN --principal-type GROUP --principal-id $GROUP_ID
```

- Good practice: group-based assignments managed in the IdP, short session durations for privileged permission sets, and temporary elevated access workflows for production admin rights.
- Pitfall: keeping a few legacy IAM users with console passwords "just in case". Use Identity Center plus documented break-glass procedures instead.

### Resource-based policies and cross-account access
<!-- level: intermediate; ref: https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_identity-vs-resource.html -->
Some services let you attach a policy directly to a resource. The policy names principals (in this or other accounts, or AWS services) and what they may do. Examples: S3 bucket policies, SQS and SNS access policies, KMS key policies, Lambda resource policies, ECR repository policies, Secrets Manager resource policies.

Why they matter:

- Cross-account access without role chaining: a bucket policy can allow a role in another account to read objects directly.
- Service integrations: SNS needs permission to send to an SQS queue; S3 needs permission to invoke a Lambda function.
- Guardrails on the resource itself: deny access unless it comes through a specific VPC endpoint, or from principals in your organisation (aws:PrincipalOrgID).

KMS is special: the key policy is the primary control. If the key policy does not allow the account (or the principal), no IAM policy can grant access.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "AllowAnalyticsAccountRead",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::777788889999:role/analytics-etl" },
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::orders-exports", "arn:aws:s3:::orders-exports/*"] },
    { "Sid": "DenyOutsideOrg",
      "Effect": "Deny", "Principal": "*", "Action": "s3:*",
      "Resource": ["arn:aws:s3:::orders-exports", "arn:aws:s3:::orders-exports/*"],
      "Condition": { "StringNotEquals": { "aws:PrincipalOrgID": "o-abc123xyz" } } }
  ]
}
```

- Pitfall: Principal "*" in an Allow without conditions makes a resource public.
- Tip: IAM Access Analyzer flags resources shared outside your organisation.

### Least privilege: permission boundaries and IAM Access Analyzer
<!-- level: advanced; ref: https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html -->
Least privilege means every identity has only the permissions it needs. In practice it is achieved iteratively with tooling rather than written perfectly up front.

IAM Access Analyzer helps in several ways:

- External access findings: resources (buckets, roles, keys, queues, snapshots) shared with principals outside your account or organisation.
- Unused access findings: roles, access keys and permissions that have not been used for a period, so you can remove them.
- Policy generation: generates a least-privilege policy from the CloudTrail activity of a role.
- Policy validation and custom policy checks: catch errors and block risky policy changes in CI (for example "this policy must not grant iam:PassRole on *").

Permission boundaries let you delegate safely. A boundary is a managed policy that caps the maximum permissions of a role or user. Developers can be allowed to create roles for their Lambda functions only if they attach the boundary, so they cannot create a role more powerful than intended.

```json
{
  "Effect": "Allow",
  "Action": ["iam:CreateRole", "iam:AttachRolePolicy", "iam:PutRolePolicy"],
  "Resource": "arn:aws:iam::111122223333:role/app-*",
  "Condition": { "StringEquals": {
    "iam:PermissionsBoundary": "arn:aws:iam::111122223333:policy/app-boundary" } }
}
```

```bash
aws accessanalyzer validate-policy --policy-type IDENTITY_POLICY \
  --policy-document file://orders-api-policy.json
```

- Pitfall: iam:PassRole with Resource "*" is a privilege-escalation path; scope it to specific role ARNs.
