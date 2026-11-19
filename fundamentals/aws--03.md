## 5. Storage

### Amazon S3 fundamentals
<!-- level: basic; ref: https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html -->
Amazon Simple Storage Service (S3) is object storage with practically unlimited capacity and 11 nines of designed durability. Data is stored as objects (up to 5 TB each) identified by a key inside a bucket. Bucket names are globally unique; buckets live in one Region.

Important properties:

- Flat namespace: "folders" are just key prefixes such as invoices/2026/11/inv-42.pdf. Design prefixes for how you list and process data.
- Strong read-after-write consistency for all operations, including overwrites and deletes.
- Versioning keeps every version of an object, protecting against overwrites and deletes. Object Lock adds write-once-read-many retention for compliance.
- Multipart upload for large objects (recommended above about 100 MB, required above 5 GB), with parallel parts and retries.
- Conditional writes (If-None-Match, If-Match) to avoid overwriting concurrent changes.
- Event notifications to Lambda, SQS, SNS or EventBridge when objects are created or deleted.
- Replication (same-Region and cross-Region) for compliance, latency and DR.

```bash
aws s3api create-bucket --bucket orders-invoices-prod-aps1 --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1
aws s3api put-bucket-versioning --bucket orders-invoices-prod-aps1 \
  --versioning-configuration Status=Enabled
aws s3 cp ./inv-42.pdf s3://orders-invoices-prod-aps1/invoices/2026/11/inv-42.pdf
aws s3 sync ./exports s3://orders-invoices-prod-aps1/exports/ --delete
```

- Pitfall: S3 is not a file system; renaming a "folder" means copying every object, and appends are not supported on standard buckets.
- Specialised options: S3 Express One Zone directory buckets for single-digit millisecond access, S3 Tables for Apache Iceberg analytics, S3 Vectors for embeddings.

### S3 storage classes and lifecycle policies
<!-- level: basic; ref: https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html -->
S3 storage classes trade storage price against retrieval cost, latency and resilience:

- S3 Standard: frequently accessed data, multi-AZ.
- S3 Intelligent-Tiering: automatically moves objects between access tiers based on usage, for a small monitoring fee per object. Excellent default when access patterns are unknown.
- S3 Standard-IA and S3 One Zone-IA: infrequent access with a per-GB retrieval fee and 30-day minimum; One Zone stores data in a single AZ.
- S3 Glacier Instant Retrieval: archive data that still needs millisecond access, accessed about once per quarter.
- S3 Glacier Flexible Retrieval: minutes to hours to retrieve.
- S3 Glacier Deep Archive: the cheapest, retrieval within 12 to 48 hours, for long-term compliance archives.

Lifecycle rules automate transitions and expiration based on object age, prefix or tags, and clean up incomplete multipart uploads and old noncurrent versions.

```json
{
  "Rules": [{
    "ID": "invoices-tiering",
    "Filter": { "Prefix": "invoices/" },
    "Status": "Enabled",
    "Transitions": [
      { "Days": 30,  "StorageClass": "STANDARD_IA" },
      { "Days": 180, "StorageClass": "GLACIER_IR" },
      { "Days": 730, "StorageClass": "DEEP_ARCHIVE" } ],
    "NoncurrentVersionExpiration": { "NoncurrentDays": 90 },
    "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
  }]
}
```

- Pitfall: small objects (under 128 KB) are not cost-effective to transition and are not auto-tiered by Intelligent-Tiering.
- Pitfall: versioning without a noncurrent-version expiration rule silently grows storage costs.

### S3 security: Block Public Access, bucket policies and encryption
<!-- level: intermediate; ref: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html -->
Most S3 data leaks come from configuration, so know the controls.

- Block Public Access: account- and bucket-level settings that override any policy or ACL that would make data public. On by default for new buckets; enable it at the account level and keep it on unless a bucket truly must be public (and then prefer CloudFront with origin access control instead).
- Object Ownership: "bucket owner enforced" (the default) disables ACLs, so access is controlled only by policies.
- Bucket policies: resource-based rules, such as requiring TLS, restricting access to a VPC endpoint or to your organisation.
- Encryption: every new object is encrypted at rest by default with SSE-S3. Use SSE-KMS (with S3 Bucket Keys to reduce KMS request costs) when you need key-level access control and audit, or DSSE-KMS for dual-layer requirements.
- Access points: named endpoints with their own policies for different applications sharing a bucket.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "DenyInsecureTransport", "Effect": "Deny", "Principal": "*", "Action": "s3:*",
      "Resource": ["arn:aws:s3:::orders-data", "arn:aws:s3:::orders-data/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } } },
    { "Sid": "OnlyViaVpce", "Effect": "Deny", "Principal": "*", "Action": "s3:*",
      "Resource": ["arn:aws:s3:::orders-data", "arn:aws:s3:::orders-data/*"],
      "Condition": { "StringNotEquals": { "aws:SourceVpce": "vpce-0abc123" } } }
  ]
}
```

- Pitfall: a broad Deny like OnlyViaVpce also blocks console access and CI pipelines; add exceptions for admin roles deliberately.

### Presigned URLs and S3 performance
<!-- level: intermediate; ref: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html -->
A presigned URL grants temporary access to a single object operation (GET or PUT) using the credentials of whoever generated it. Your backend authenticates the user, generates a URL valid for a few minutes, and the client uploads or downloads directly to S3, so large files never pass through your servers.

The URL can never grant more than the signer's own permissions, and it stops working when the signer's temporary credentials expire, even if the URL's expiry is later. For browser uploads with constraints (maximum size, content type), presigned POST policies are useful.

Performance basics:

- S3 scales automatically to at least 3,500 writes and 5,500 reads per second per prefix; spread hot workloads across prefixes.
- Use multipart upload and byte-range GETs to parallelise large transfers.
- S3 Transfer Acceleration uses edge locations for faster long-distance uploads.
- CloudFront caches frequently read objects close to users.

```python
import boto3
s3 = boto3.client("s3", region_name="ap-south-1")

upload_url = s3.generate_presigned_url(
    "put_object",
    Params={"Bucket": "orders-uploads", "Key": f"incoming/{user_id}/{file_id}.jpg",
            "ContentType": "image/jpeg"},
    ExpiresIn=300)

download_url = s3.generate_presigned_url(
    "get_object", Params={"Bucket": "orders-invoices", "Key": "invoices/inv-42.pdf"},
    ExpiresIn=600)
```

- Pitfall: CORS must be configured on the bucket for browser uploads, or requests fail before reaching S3 logic.
- Pitfall: treat presigned URLs as bearer tokens; anyone with the URL can use it until expiry.

### Amazon EFS and Amazon FSx
<!-- level: intermediate; ref: https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html -->
When applications need a shared file system rather than object storage, AWS offers managed options.

Amazon Elastic File System (EFS) is a serverless, elastic NFS file system for Linux. It grows and shrinks automatically, can be mounted concurrently by thousands of EC2 instances, ECS tasks, EKS pods and Lambda functions across AZs, and stores data redundantly across AZs (or in one zone for lower cost). Throughput modes include Elastic (recommended for spiky workloads), Provisioned and Bursting. Lifecycle management moves cold files to Infrequent Access and Archive classes.

Amazon FSx provides fully managed third-party file systems:

- FSx for Windows File Server: SMB shares integrated with Active Directory for Windows workloads.
- FSx for NetApp ONTAP: NFS, SMB and iSCSI with snapshots, cloning and replication; popular for enterprise migrations.
- FSx for Lustre: high-performance parallel file system for HPC and machine learning, often linked to S3.
- FSx for OpenZFS: low-latency NFS with ZFS features.

```bash
aws efs create-file-system --performance-mode generalPurpose --throughput-mode elastic \
  --encrypted --tags Key=Name,Value=cms-content
aws efs create-mount-target --file-system-id fs-0abc --subnet-id subnet-a --security-groups sg-efs
# on an instance
sudo mount -t efs -o tls fs-0abc:/ /mnt/content
```

- Pitfall: EFS has higher latency per operation than EBS; it is a poor fit for databases or workloads with many tiny synchronous writes.

### AWS Backup
<!-- level: intermediate; ref: https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html -->
AWS Backup centralises and automates backups across many services: EC2 and EBS, RDS and Aurora, DynamoDB, EFS, FSx, S3, Storage Gateway, DocumentDB, Neptune, EKS and more. Instead of configuring snapshots per service, you define policies once.

Concepts:

- Backup plan: rules with schedule, backup window, lifecycle (transition to cold storage, retention) and copy actions to other Regions or accounts.
- Resource assignment: select resources by tags (for example backup=daily) or ARNs, so new resources are protected automatically.
- Backup vault: encrypted container for recovery points, with access policies.
- Vault Lock: write-once-read-many protection so recovery points cannot be deleted, even by an administrator, until retention ends (compliance mode is irreversible after a grace period).
- Logically air-gapped vaults and cross-account copies to protect against compromised accounts and ransomware.
- Restore testing: scheduled automated restores to prove backups work.
- Organization-wide backup policies via AWS Organizations.

```bash
aws backup create-backup-plan --backup-plan '{
  "BackupPlanName": "prod-daily",
  "Rules": [{ "RuleName": "daily-35d", "TargetBackupVaultName": "prod-vault",
    "ScheduleExpression": "cron(0 20 * * ? *)",
    "Lifecycle": { "DeleteAfterDays": 35 },
    "CopyActions": [{ "DestinationBackupVaultArn": "arn:aws:backup:ap-southeast-1:999988887777:backup-vault:dr-vault",
                      "Lifecycle": { "DeleteAfterDays": 35 } }] }] }'
```

- Pitfall: backups stored in the same account as production can be deleted by the same attacker; copy to a separate, locked-down account.

## 6. Databases

### Amazon RDS
<!-- level: basic; ref: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html -->
Amazon Relational Database Service (RDS) runs managed relational databases: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server and Db2. AWS handles provisioning, patching (in maintenance windows), automated backups and failover; you manage schema, queries, parameters and access.

Key features:

- Multi-AZ deployments: a synchronous standby in another AZ with automatic failover (typically one to two minutes). Multi-AZ DB clusters (MySQL and PostgreSQL) use two readable standbys for faster failover.
- Read replicas: asynchronous copies (same or cross-Region) to scale reads or support DR.
- Automated backups with point-in-time restore (retention up to 35 days) plus manual snapshots.
- Storage: gp3 or io2 with storage autoscaling.
- RDS Proxy: pools and shares connections, which is critical for Lambda and spiky apps, and speeds up failover.
- IAM database authentication and Secrets Manager-managed master passwords with rotation.
- Blue/green deployments for safer major version upgrades and schema changes.

```bash
aws rds create-db-instance --db-instance-identifier orders-pg \
  --engine postgres --engine-version 16.4 --db-instance-class db.m7g.large \
  --allocated-storage 200 --storage-type gp3 --multi-az \
  --master-username orders_admin --manage-master-user-password \
  --db-subnet-group-name private-db --vpc-security-group-ids sg-db \
  --backup-retention-period 14 --storage-encrypted --no-publicly-accessible
```

- Pitfall: a read replica is not a backup; deletes and corruption replicate too.
- Pitfall: applications must reconnect after failover; keep DNS TTLs low in the client and use retries.

### Amazon Aurora
<!-- level: intermediate; ref: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html -->
Amazon Aurora is AWS's cloud-native relational database, compatible with MySQL and PostgreSQL. It separates compute from a distributed storage layer that keeps six copies of data across three AZs and grows automatically up to 128 TiB (or more in newer configurations).

Why choose Aurora over standard RDS:

- Storage is shared by the writer and up to 15 low-lag Aurora Replicas; failover promotes a replica usually in under a minute.
- Cluster endpoints: a writer endpoint, a reader endpoint that load-balances replicas, and custom endpoints.
- Aurora Serverless v2: capacity scales in fine-grained increments (Aurora capacity units) within seconds, and can scale to zero for idle databases. Mix serverless and provisioned instances in one cluster.
- Aurora Global Database: storage-level replication to secondary Regions with typically under a second of lag, and managed switchover or failover for DR.
- Fast cloning (copy-on-write) for test environments, and backtrack (MySQL) to rewind a database.
- I/O-Optimized configuration for I/O-heavy workloads with predictable pricing.
- Aurora DSQL, a separate serverless distributed SQL database for active-active multi-Region apps.

```bash
aws rds create-db-cluster --db-cluster-identifier catalog --engine aurora-postgresql \
  --engine-version 16.4 --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=16 \
  --master-username catalog_admin --manage-master-user-password \
  --db-subnet-group-name private-db --vpc-security-group-ids sg-db --storage-encrypted
aws rds create-db-instance --db-instance-identifier catalog-1 --db-cluster-identifier catalog \
  --engine aurora-postgresql --db-instance-class db.serverless
```

- Pitfall: Aurora's per-I/O charges on the Standard configuration can surprise heavy-write workloads; compare with I/O-Optimized.

### Amazon DynamoDB fundamentals
<!-- level: basic; ref: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html -->
Amazon DynamoDB is a serverless key-value and document database with consistent single-digit millisecond performance at any scale. There are no servers, versions or patches; you create tables and pay for reads, writes and storage.

Core ideas:

- Items (rows) are identified by a primary key: a partition key alone, or a partition key plus a sort key. The partition key determines which physical partition stores the item.
- Access is by key: GetItem, PutItem, UpdateItem, DeleteItem, Query (all items with one partition key, optionally a sort-key range) and Scan (reads the whole table; avoid in hot paths).
- Capacity modes: on-demand (pay per request, scales instantly, the default for most new tables) or provisioned with auto scaling for steady, predictable traffic.
- Consistency: eventually consistent reads by default; strongly consistent reads available on the base table.
- Features: TTL for automatic expiry, DynamoDB Streams for change data capture, transactions across up to 100 items, point-in-time recovery, global tables for multi-Region active-active replication.

```python
import boto3
from boto3.dynamodb.conditions import Key
orders = boto3.resource("dynamodb").Table("orders")

orders.put_item(Item={"pk": "CUST#42", "sk": "ORDER#2026-11-18#9001", "total": 1499, "status": "PLACED"},
                ConditionExpression="attribute_not_exists(sk)")
recent = orders.query(KeyConditionExpression=Key("pk").eq("CUST#42") & Key("sk").begins_with("ORDER#2026-11"),
                      ScanIndexForward=False, Limit=20)["Items"]
```

- Pitfall: modelling DynamoDB like a relational database (one table per entity, joins in code, Scans with filters) leads to high cost and latency.

### DynamoDB data modelling: keys, indexes and single-table design
<!-- level: advanced; ref: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html -->
In DynamoDB you design the table around access patterns, which you list before writing any schema: "get customer profile", "list a customer's orders newest first", "find orders by status for the ops dashboard".

Techniques:

- Composite sort keys model hierarchies and ranges: ORDER#2026-11-18#9001 enables begins_with and between queries by date.
- Single-table design stores related entities in one table with generic keys (pk, sk) so one Query returns a customer and their orders together, an "item collection".
- Global secondary indexes (GSIs) provide alternate keys with their own partition and sort key, eventually consistent, and their own capacity. Local secondary indexes share the partition key, must be created with the table, and limit item collections to 10 GB.
- Sparse indexes: only items that have the GSI key attribute appear, which is great for "open orders" lists.
- Write sharding: add a random or computed suffix to hot partition keys to spread writes.

```text
pk            sk                         attributes                 GSI1PK         GSI1SK
CUST#42       PROFILE                    name, email
CUST#42       ORDER#2026-11-18#9001      total, status=PLACED       STATUS#PLACED  2026-11-18#9001
CUST#42       ORDER#2026-10-02#8811      total, status=SHIPPED      (absent: not indexed in GSI1)
```

Queries:

- Customer with orders: Query pk = CUST#42.
- Open orders dashboard: Query GSI1 where GSI1PK = STATUS#PLACED.

- Pitfall: a low-cardinality partition key (status, date) concentrates traffic on one partition and causes throttling.
- Pitfall: adding a new access pattern later may need a new GSI and a backfill; spend time on patterns up front.

### Amazon ElastiCache and MemoryDB
<!-- level: intermediate; ref: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html -->
Amazon ElastiCache is a managed in-memory data store compatible with Valkey, Redis OSS and Memcached. Valkey is the open-source fork of Redis that AWS now promotes, with lower prices than Redis OSS on ElastiCache.

Deployment options:

- ElastiCache Serverless: no cluster sizing; it scales automatically and is billed by data stored and compute units used.
- Node-based clusters: choose node types, shards and replicas yourself, with cluster mode to partition data across shards and Multi-AZ automatic failover.

Uses: caching database queries and API responses (cache-aside or write-through), session stores, rate limiters, leaderboards with sorted sets, pub/sub and distributed locks.

Amazon MemoryDB is a different service: a durable, Redis- and Valkey-compatible primary database with a multi-AZ transaction log, for when in-memory speed is needed without losing data on failure. ElastiCache should be treated as a cache that can lose data.

```python
import json, redis
r = redis.Redis(host="orders-cache.xxxxxx.aps1.cache.amazonaws.com", port=6379, ssl=True)

def get_product(sku):
    key = f"product:{sku}"
    if (cached := r.get(key)) is not None:
        return json.loads(cached)
    product = db.fetch_product(sku)                    # cache miss: load from the database
    r.set(key, json.dumps(product), ex=600)           # 10-minute TTL bounds staleness
    return product
```

- Pitfall: cache stampede when a hot key expires and thousands of requests hit the database; use jittered TTLs, request coalescing or early refresh.
- Pitfall: caches in public subnets or without encryption in transit and AUTH/IAM.

### Choosing a purpose-built database
<!-- level: intermediate; ref: https://docs.aws.amazon.com/whitepapers/latest/aws-overview/database.html -->
AWS promotes purpose-built databases: pick the engine that fits each workload's data model and access pattern rather than forcing everything into one.

- Relational (RDS, Aurora): structured data, transactions, joins, reporting. Default for most business systems.
- Key-value (DynamoDB): massive scale with predictable key-based access, serverless operations.
- In-memory (ElastiCache, MemoryDB): microsecond latency for caching, sessions, leaderboards.
- Document (Amazon DocumentDB, MongoDB-compatible): JSON documents with flexible schema and rich queries.
- Wide-column (Amazon Keyspaces, Cassandra-compatible): high-write time-series and IoT patterns using CQL.
- Graph (Amazon Neptune): highly connected data such as fraud rings, recommendations, knowledge graphs.
- Time series (Amazon Timestream): metrics and IoT data with time-based queries.
- Ledger needs: an append-only table with cryptographic hashing in a relational database is often enough.
- Analytics warehouse (Amazon Redshift): columnar storage for large analytical queries; query S3 data lakes with Amazon Athena.
- Search (Amazon OpenSearch Service): full-text search, log analytics and vector search.

```text
E-commerce platform:
  Orders, payments       -> Aurora PostgreSQL
  Shopping cart, session -> DynamoDB (TTL for abandoned carts)
  Product search         -> OpenSearch
  Recommendations        -> Neptune or a vector index
  Sales analytics        -> S3 data lake + Athena / Redshift
```

- Pitfall: every additional database engine adds operational and skills overhead. Polyglot persistence should be justified by real requirements, not novelty.
- Interview tip: start from access patterns, consistency needs and scale; then name the service.
