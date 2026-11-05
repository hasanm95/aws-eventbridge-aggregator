# Project 5 — Scheduled Aggregator (EventBridge)

**Pattern:** EventBridge schedule → Lambda → read DynamoDB → write summary to S3
**Idea:** Some work has no request behind it — it just needs to run on a clock. A cron
job, but serverless: no server sits idle waiting. Every few minutes EventBridge wakes a
Lambda, the Lambda counts the rows in a table, writes a small summary file to S3, and
goes back to sleep. This is the shape of nightly reports, cleanups, and billing rollups.

Runs on LocalStack with `lstk sam build / deploy`.

---

## Architecture

```
   ┌──────────────────────┐   every 2 min    ┌─────────────────────┐
   │  EventBridge rule     │ ───────────────▶ │  AggregatorFunction │
   │  rate(2 minutes)      │   (no request,   │      (Lambda)       │
   └──────────────────────┘    just a clock) └──────────┬──────────┘
                                                   read  │   write
                                        ┌────────────────┴────────────────┐
                                        ▼                                  ▼
                            ┌───────────────────────┐        ┌─────────────────────────┐
                            │  SourceDynamoDBTable   │        │      ReportBucket (S3)   │
                            │  (submissions)         │        │  reports/..._<ts>.json   │
                            └───────────────────────┘        └─────────────────────────┘
```

| Resource | Role |
|---|---|
| EventBridge rule (`rate(2 minutes)`) | the clock — triggers the Lambda, no caller needed |
| `AggregatorFunction` | wakes on schedule, counts rows, writes the report |
| `SourceDynamoDBTable` | the raw data being summarized (key: `submission_id`) |
| `ReportBucket` | where each timestamped summary file lands |
| IAM (`DynamoDBReadPolicy` + `S3WritePolicy`) | read the table, write the bucket — nothing more |

---

## Deploy

```bash
lstk sam build
lstk sam deploy
```

The bucket name is `aggregator-reports-<accountId>-<region>`. On LocalStack that is
`aggregator-reports-000000000000-us-east-1`.

---

## Test — the schedule runs itself

### 1. Put some rows in the source table

Right after deploy the table is empty, so the first report would say `count: 0`. Add a
few submissions first. Get the table name from the stack, then:

```bash
lstk aws dynamodb put-item --table-name <SourceTable> \
  --item '{"submission_id":{"S":"s1"}}'
lstk aws dynamodb put-item --table-name <SourceTable> \
  --item '{"submission_id":{"S":"s2"}}'
```

### 2. Wait, then confirm the Lambda woke on its own

Nobody calls it — EventBridge does, every 2 minutes. Watch the log:

```bash
lstk aws logs tail /aws/lambda/ScheduledAggregator --follow
```
**Success:** you see `Triggered by EventBridge at: ...` with no request from you.

### 3. Check the report in S3

```bash
lstk aws s3 ls s3://aggregator-reports-000000000000-us-east-1/reports/
```
**Success:** a `submission_summary_<timestamp>.json` file exists. Read it:

```bash
lstk aws s3 cp s3://aggregator-reports-000000000000-us-east-1/reports/<file>.json -
```
Inside: the correct `total_submission_count` (2, for the rows above).

### 4. Prove it keeps running

Wait a few more minutes → a **new** file with a new timestamp appears. The clock is
still ticking.

### 5. Stop it

Disable the rule (or `lstk sam delete` the stack) → no new files appear.

---

## LocalStack gotchas worth remembering

- **S3 needs path-style on LocalStack.** The AWS SDK talks to S3 in virtual-host style
  by default (`bucket-name.host:4566`), and that bucket subdomain does not resolve
  against LocalStack. So the S3 client sets `forcePathStyle: true` when local, which
  puts the bucket in the path (`host:4566/bucket-name/key`) instead. DynamoDB does not
  need this — it is not addressed by bucket name.
- **Scan is paginated.** One `Scan` returns at most 1MB of data. The handler loops on
  `LastEvaluatedKey` so the count covers the whole table, not just the first page. (Full
  scans are expensive on big tables — fine for this toy aggregator, not for production
  hot paths.)

---

## One-line takeaway

No request, no idle server — a schedule wakes the function, it reads, summarizes, writes,
and sleeps. That is a cron job without a machine to keep running.
