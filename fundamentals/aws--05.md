## 9. Messaging, events and serverless integration

### Amazon SQS
<!-- level: basic; ref: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html -->
Amazon Simple Queue Service (SQS) is a fully managed message queue that decouples producers from consumers. Producers send messages; consumers poll, process and delete them. If a consumer crashes, the message becomes visible again after the visibility timeout and another consumer retries it.

Queue types:

- Standard: nearly unlimited throughput, at-least-once delivery, best-effort ordering. Consumers must be idempotent.
- FIFO: exactly-once processing within a deduplication window and strict ordering per message group ID. High-throughput mode supports large volumes when spread across many message groups.

Important settings:

- Visibility timeout: set longer than your processing time (for Lambda, at least six times the function timeout is recommended).
- Long polling (WaitTimeSeconds up to 20) reduces empty receives and cost.
- Dead-letter queue with maxReceiveCount moves poison messages aside; redrive moves them back after a fix.
- Message retention from one minute to 14 days; message size up to 1 MiB (use S3 for larger payloads with a pointer).
- Delay queues and per-message timers.

```bash
aws sqs create-queue --queue-name invoices-dlq
aws sqs create-queue --queue-name invoices --attributes '{
  "VisibilityTimeout": "180", "ReceiveMessageWaitTimeSeconds": "20",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:ap-south-1:111122223333:invoices-dlq\",\"maxReceiveCount\":\"5\"}" }'
aws sqs send-message --queue-url $QUEUE_URL --message-body '{"orderId":"9001"}'
```

- Pitfall: deleting the message before processing finishes loses it on crash; delete only after success.
- Scaling consumers: Lambda event source mappings, or ECS/EKS consumers scaled on ApproximateNumberOfMessagesVisible and age of oldest message.

### Amazon SNS and the fan-out pattern
<!-- level: basic; ref: https://docs.aws.amazon.com/sns/latest/dg/welcome.html -->
Amazon Simple Notification Service (SNS) is a managed publish/subscribe service. Publishers send a message to a topic, and SNS pushes a copy to every subscriber: SQS queues, Lambda functions, HTTP(S) endpoints, Firehose streams, email, SMS and mobile push.

Fan-out with SNS plus SQS is a classic pattern: an OrderPlaced message goes to one topic, and each interested service (billing, shipping, analytics) has its own SQS queue subscribed. Each service processes at its own pace with its own retries and DLQ, and new consumers can be added without touching the publisher.

Features:

- Subscription filter policies on message attributes or body, so subscribers only receive what they need.
- FIFO topics, paired with FIFO queues, for ordered, deduplicated fan-out.
- Message archiving and replay for FIFO topics.
- Delivery retries and dead-letter queues per subscription.
- Raw message delivery to SQS to avoid the SNS JSON envelope.

```bash
aws sns create-topic --name order-events
aws sns subscribe --topic-arn arn:aws:sns:ap-south-1:111122223333:order-events \
  --protocol sqs --notification-endpoint arn:aws:sqs:ap-south-1:111122223333:shipping \
  --attributes '{"RawMessageDelivery":"true","FilterPolicy":"{\"eventType\":[\"OrderPlaced\",\"OrderCancelled\"]}"}'
aws sns publish --topic-arn arn:aws:sns:ap-south-1:111122223333:order-events \
  --message '{"orderId":"9001"}' \
  --message-attributes '{"eventType":{"DataType":"String","StringValue":"OrderPlaced"}}'
```

- Pitfall: the SQS queue policy must allow the SNS topic to send messages, or deliveries fail silently from the publisher's view.

### Amazon EventBridge
<!-- level: intermediate; ref: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html -->
Amazon EventBridge is a serverless event bus for building event-driven architectures. Events are JSON documents with a standard envelope (source, detail-type, detail, time).

Components:

- Event buses: the default bus receives events from AWS services (EC2 state changes, S3 object created when enabled, CodePipeline, GuardDuty findings). Custom buses carry your application events. Partner buses receive SaaS events (for example Zendesk, Datadog).
- Rules: match events with content-based patterns (prefixes, numeric ranges, exists, anything-but) and route them to targets: Lambda, Step Functions, SQS, SNS, Kinesis, API destinations (any HTTP API with auth), other buses including cross-account and cross-Region.
- Input transformers reshape events for targets.
- Archive and replay: store events and replay them after fixing a consumer.
- Schema registry: discover event schemas and generate code bindings.
- EventBridge Pipes: point-to-point integrations from a source (SQS, Kinesis, DynamoDB Streams, Kafka) through optional filtering and enrichment to a target.
- EventBridge Scheduler: one-time and recurring schedules at scale with time zones and retries.

```json
{
  "source": ["com.example.orders"],
  "detail-type": ["OrderPlaced"],
  "detail": { "total": [{ "numeric": [">", 10000] }], "country": ["IN"] }
}
```

```bash
aws events put-events --entries '[{"Source":"com.example.orders","DetailType":"OrderPlaced",
  "EventBusName":"orders","Detail":"{\"orderId\":\"9001\",\"total\":15000,\"country\":\"IN\"}"}]'
```

- SNS or EventBridge? SNS for high-throughput simple fan-out; EventBridge for rich filtering, many AWS and SaaS sources, schemas and replay.

### Amazon Kinesis Data Streams and Amazon Data Firehose
<!-- level: intermediate; ref: https://docs.aws.amazon.com/streams/latest/dev/introduction.html -->
For continuous high-volume streams (clickstreams, IoT telemetry, application logs), AWS offers streaming services.

Amazon Kinesis Data Streams stores an ordered, replayable stream of records:

- Shards provide capacity (each about 1 MB/s or 1,000 records/s of writes and 2 MB/s of reads). On-demand mode manages shards automatically; provisioned mode lets you control them.
- Records with the same partition key go to the same shard and keep order.
- Retention from 24 hours up to 365 days, and multiple independent consumers; enhanced fan-out gives each consumer dedicated read throughput.
- Consumers: Lambda event source mappings, Kinesis Client Library applications, Amazon Managed Service for Apache Flink for stream processing.

Amazon Data Firehose (formerly Kinesis Data Firehose) is a fully managed delivery service: it buffers, optionally transforms (Lambda, format conversion to Parquet) and delivers streaming data to S3, Redshift, OpenSearch, Apache Iceberg tables, Splunk and HTTP endpoints. No consumers to write, but no replay either.

Amazon MSK (Managed Streaming for Apache Kafka) is the choice when you need the Kafka API and ecosystem.

```python
import json, boto3
kinesis = boto3.client("kinesis")
kinesis.put_record(StreamName="clickstream",
                   Data=json.dumps({"user": "u42", "page": "/cart", "ts": 1763452800}).encode(),
                   PartitionKey="u42")
```

- Pitfall: a skewed partition key (one hot device or user) throttles a single shard while others sit idle.
- Rule of thumb: Data Streams for custom real-time processing and replay; Firehose for "land it in S3 or a warehouse".

### AWS Step Functions
<!-- level: intermediate; ref: https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html -->
AWS Step Functions orchestrates multi-step workflows as state machines defined in Amazon States Language (JSON), with a visual designer. It keeps workflow state, retries, error handling and timeouts out of your application code.

State types: Task (call a service), Choice (branching), Parallel, Map (iterate over items; Distributed Map processes millions of S3 objects in parallel), Wait, Pass, Succeed and Fail. Task states call Lambda or directly integrate with more than 200 AWS services through SDK integrations, so many workflows need no Lambda glue at all. JSONata expressions transform data between states.

Workflow types:

- Standard: up to one year duration, exactly-once execution of steps, full execution history; priced per state transition. For business processes and long-running jobs.
- Express: up to five minutes, at-least-once, high-volume and priced by duration and requests. For event processing and microservice orchestration.

Integration patterns include request-response, run a job and wait (.sync), and wait for a callback with a task token, which enables human approvals.

```json
{
  "StartAt": "ReserveStock",
  "States": {
    "ReserveStock": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
      "Arguments": { "FunctionName": "reserve-stock", "Payload": "{% $states.input %}" },
      "Retry": [{ "ErrorEquals": ["States.TaskFailed"], "MaxAttempts": 3, "BackoffRate": 2, "IntervalSeconds": 2 }],
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "CancelOrder" }],
      "Next": "ChargePayment" },
    "ChargePayment": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
      "Arguments": { "FunctionName": "charge-payment", "Payload": "{% $states.input %}" }, "End": true },
    "CancelOrder": { "Type": "Task", "Resource": "arn:aws:states:::sqs:sendMessage",
      "Arguments": { "QueueUrl": "https://sqs.ap-south-1.amazonaws.com/111122223333/cancellations",
                     "MessageBody": "{% $states.input %}" }, "End": true }
  },
  "QueryLanguage": "JSONata"
}
```

- Use it for sagas: compensating steps when later steps fail.

### Amazon API Gateway
<!-- level: intermediate; ref: https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html -->
Amazon API Gateway is a managed front door for APIs, commonly paired with Lambda but able to front any HTTP backend or AWS service.

API types:

- HTTP APIs: lower cost and latency, JWT authorizers (Cognito or any OIDC provider), Lambda and HTTP proxy integrations, private integrations via VPC links. A good default for most new REST-style APIs.
- REST APIs: richer features: API keys and usage plans, request validation, request/response transformation with mapping templates, caching, AWS WAF integration, private APIs accessible only through VPC endpoints, and direct integrations with services such as DynamoDB or SQS.
- WebSocket APIs: persistent two-way connections for chat, notifications and live dashboards.

Concepts: stages (dev, prod) with stage variables, deployments, custom domain names with ACM certificates, throttling (account-level and per method or per client with usage plans), authorizers (IAM, Cognito, JWT, Lambda), CORS configuration and access logging.

```yaml
# AWS SAM: HTTP API with JWT auth and a Lambda integration
Resources:
  OrdersApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      Auth:
        DefaultAuthorizer: Cognito
        Authorizers:
          Cognito:
            JwtConfiguration:
              issuer: https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_AbCdEf123
              audience: [4abc5defghij6klmn7opq8rst]
            IdentitySource: $request.header.Authorization
  GetOrder:
    Type: AWS::Serverless::Function
    Properties:
      Runtime: python3.13
      Handler: app.get_order
      Events:
        Api: { Type: HttpApi, Properties: { ApiId: !Ref OrdersApi, Path: /orders/{id}, Method: GET } }
```

- Pitfall: integration timeout defaults to 29 seconds; long work should be asynchronous (return 202 and poll or use WebSockets).

## 10. Monitoring and observability

### Amazon CloudWatch metrics and alarms
<!-- level: basic; ref: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html -->
Amazon CloudWatch is the core monitoring service on AWS. Services publish metrics automatically (EC2 CPUUtilization, ALB TargetResponseTime and HTTPCode_Target_5XX_Count, SQS ApproximateAgeOfOldestMessage, Lambda Errors and Duration), organised by namespace and dimensions.

Concepts:

- Resolution: standard metrics at one-minute (or five-minute for basic EC2 monitoring); high-resolution custom metrics down to one second.
- Statistics and percentiles: average hides tail latency; use p95 or p99 for latency.
- Custom metrics: publish via PutMetricData, or more cheaply via the Embedded Metric Format (structured JSON log lines that CloudWatch turns into metrics).
- Alarms: evaluate a metric or metric math expression over periods (for example 3 of 5 datapoints breaching) and trigger SNS notifications, Auto Scaling, EC2 actions or Systems Manager incidents.
- Composite alarms combine alarms to reduce noise.
- Anomaly detection alarms learn normal patterns.
- Dashboards, including cross-account and cross-Region views.
- Application Signals and Synthetics canaries for service-level and user-journey monitoring.

```bash
aws cloudwatch put-metric-alarm --alarm-name orders-api-5xx \
  --namespace AWS/ApplicationELB --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=LoadBalancer,Value=app/orders-alb/50dc6c495c0c9188 \
  --statistic Sum --period 60 --evaluation-periods 5 --datapoints-to-alarm 3 \
  --threshold 25 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching --alarm-actions arn:aws:sns:ap-south-1:111122223333:oncall
```

- Pitfall: treat-missing-data defaults can keep alarms in INSUFFICIENT_DATA or falsely OK; set it deliberately.

### CloudWatch Logs and Logs Insights
<!-- level: intermediate; ref: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AnalyzingLogData.html -->
CloudWatch Logs collects log events into log groups (one per application or function) and log streams (one per instance, container or execution environment). Lambda, ECS (awslogs driver or FireLens), API Gateway, VPC Flow Logs, Route 53 resolver logs and the CloudWatch agent on EC2 all send logs here.

Management settings:

- Retention per log group: the default is never expire, which quietly grows cost. Set retention explicitly.
- Log classes: Standard, and Infrequent Access for lower-cost logs that are rarely queried.
- Metric filters turn log patterns into metrics (for example count of "PaymentDeclined").
- Subscription filters stream logs to Lambda, Kinesis, Firehose or OpenSearch.
- Data protection policies mask sensitive data such as card numbers.
- Live Tail for real-time viewing during debugging.

CloudWatch Logs Insights is a query language for interactive analysis across log groups. Structured JSON logs make it much more powerful because fields are discovered automatically.

```text
fields @timestamp, level, orderId, durationMs, @message
| filter service = "orders-api" and level = "ERROR"
| stats count(*) as errors by bin(5m), errorCode
| sort errors desc
| limit 20
```

```python
import json, logging
log = logging.getLogger()
log.info(json.dumps({"level": "INFO", "service": "orders-api", "orderId": "9001",
                     "event": "order_placed", "durationMs": 87}))
```

- Pitfall: Logs Insights charges per GB scanned; narrow the time range and log groups.
- Pitfall: logging full request payloads with personal data creates compliance problems.

### AWS CloudTrail
<!-- level: basic; ref: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html -->
AWS CloudTrail records API activity in your accounts: who did what, when, from where and whether it succeeded. Every console action, CLI call and SDK request is an API call, so CloudTrail is the audit log of AWS.

Event categories:

- Management events: control-plane operations such as CreateBucket, RunInstances, AttachRolePolicy, ConsoleLogin. Recorded by default and viewable in Event history for 90 days.
- Data events: high-volume data-plane operations such as S3 GetObject and PutObject, Lambda Invoke, DynamoDB item operations. Must be enabled explicitly and cost extra.
- Insights events: detect unusual API call rates or error rates.

For long-term retention and analysis, create an organisation trail that delivers to a central S3 bucket in a log archive account (with log file validation and restricted access), and optionally to CloudWatch Logs for alerting. CloudTrail Lake stores events in a queryable data store with SQL.

```bash
aws cloudtrail create-trail --name org-trail --s3-bucket-name org-cloudtrail-logs-999900001111 \
  --is-organization-trail --is-multi-region-trail --enable-log-file-validation
aws cloudtrail start-logging --name org-trail
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=DeleteBucket \
  --max-results 5
```

- Security uses: investigate incidents, detect root user sign-ins, alert on changes to IAM, security groups or CloudTrail itself.
- Pitfall: an attacker's first move is often StopLogging or DeleteTrail; protect trails with SCPs.

### Distributed tracing with AWS X-Ray and OpenTelemetry
<!-- level: intermediate; ref: https://docs.aws.amazon.com/xray/latest/devguide/aws-xray.html -->
In microservices and serverless systems, one user request crosses API Gateway, Lambda, queues and databases. Distributed tracing follows that request end to end, showing where time is spent and where errors originate.

AWS X-Ray is the tracing backend on AWS:

- A trace is made of segments (one per service) and subsegments (calls to downstream services, SQL queries, HTTP calls).
- Trace context propagates via the X-Amzn-Trace-Id header (and W3C trace context with OpenTelemetry).
- The trace map visualises services and their latency and error rates; traces can be filtered and analysed.
- Sampling rules control how many requests are traced to manage cost.
- CloudWatch Application Signals builds service-level dashboards and SLOs on top of this telemetry.

Instrumentation today should use OpenTelemetry: the AWS Distro for OpenTelemetry (ADOT) and CloudWatch agent collect traces and metrics, and AWS recommends OpenTelemetry over the legacy X-Ray SDKs. Lambda and API Gateway can enable active tracing with a single setting.

```python
# Python service instrumented with OpenTelemetry, exported via an OTLP collector to X-Ray
from opentelemetry import trace
tracer = trace.get_tracer("orders-api")

def place_order(order):
    with tracer.start_as_current_span("place_order") as span:
        span.set_attribute("order.id", order["id"])
        reserve_stock(order)      # auto-instrumented boto3/HTTP calls become child spans
        charge(order)
```

```bash
aws lambda update-function-configuration --function-name checkout --tracing-config Mode=Active
```

- Pitfall: traces break across asynchronous hops (SQS, EventBridge) unless context is propagated in message attributes.

### AWS Config
<!-- level: intermediate; ref: https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html -->
AWS Config continuously records the configuration of your resources and how it changes over time, and evaluates it against rules. Where CloudTrail tells you who called which API, Config tells you what a resource looked like before and after, and whether it is compliant.

Capabilities:

- Configuration recorder: captures configuration items for supported resource types (all types or a chosen subset, with periodic or continuous recording).
- Configuration history and relationships: for example which instances used a security group last Tuesday.
- Config rules: AWS managed rules (s3-bucket-public-read-prohibited, encrypted-volumes, restricted-ssh, iam-user-mfa-enabled) or custom rules with Lambda or Guard policy language. Proactive mode can evaluate resources before deployment.
- Conformance packs: bundles of rules and remediations mapped to frameworks (CIS, PCI DSS, operational best practices).
- Remediation: automatic or manual fixes through Systems Manager Automation documents.
- Aggregators: an organisation-wide compliance view in a central account. Advanced queries use SQL over current configuration.

```bash
aws configservice put-config-rule --config-rule '{
  "ConfigRuleName": "s3-public-read-prohibited",
  "Source": { "Owner": "AWS", "SourceIdentifier": "S3_BUCKET_PUBLIC_READ_PROHIBITED" } }'
aws configservice select-resource-config --expression \
  "SELECT resourceId, configuration.instanceType WHERE resourceType = 'AWS::EC2::Instance' AND configuration.state.name = 'running'"
```

- Pitfall: continuous recording of high-churn resources (for example in busy EKS or autoscaling accounts) can be costly; use periodic recording or exclusions.
- Relationship with Security Hub: Security Hub's controls are largely evaluated using Config rules.
