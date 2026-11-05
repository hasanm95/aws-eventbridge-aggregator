const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const isSamLocal = process.env.AWS_SAM_LOCAL === "true";
const isLocalstackEnv = process.env.LOCALSTACK_HOSTNAME;

let endpointUrl = undefined;

if (isSamLocal) {
    endpointUrl = "http://host.docker.internal:4566";
} else if (isLocalstackEnv) {
    endpointUrl = `http://${process.env.LOCALSTACK_HOSTNAME}:4566`;
}

const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    endpoint: endpointUrl,
    credentials: (isSamLocal || isLocalstackEnv) ? { accessKeyId: "test", secretAccessKey: "test" } : undefined
});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({})

const SOURCE_TABLE_NAME = process.env.SOURCE_TABLE_NAME;
const DEST_BUCKET_NAME = process.env.DEST_BUCKET_NAME

exports.handler = async (event) => {
    const now = new Date();
    console.log(`Triggered by EventBridge at: ${now.toISOString()}`);
    
    try {
        // Scan the table to fetch rows
        const scanCommand = new ScanCommand({
            TableName: SOURCE_TABLE_NAME
        })
        const response = await docClient.send(scanCommand)
        const items = response.Items || [];
        const totalSubmissions = items.length;

        // Generate the summary report payload
        const reportData = {
            report_date: now.toISOString().split('T')[0],
            generated_at: now.toISOString(),
            total_submission_count: totalSubmissions,
            status: "SUCCESS"
        };

        // Create file key
        const timestamp = now.toISOString()
            .replace(/[-T:]/g, '')
            .split('.')[0];
        const fileKey = `reports/submission_summary_${timestamp}.json`;

        // Upload file to S3 bucket
        const putS3Command = new PutObjectCommand({
            Bucket: DEST_BUCKET_NAME,
            Key: fileKey,
            Body: JSON.stringify(reportData, null, 4),
            ContentType: "application/json"
        })

        await s3Client.send(putS3Command)
        console.log(`Successfully generated report and saved to s3://${DEST_BUCKET}/${fileKey}`);
        
        return {
            statusCode: 200,
            body: JSON.stringify(`Report successfully saved: ${fileKey}`)
        };
    } catch (error) {
        console.log("Error occurred: ", error)
        return {
            statusCode: 500,
            body: `Failed to generate report: ${error}`
        }
    }
}