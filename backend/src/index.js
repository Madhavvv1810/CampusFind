// Lambda entry point for the REST API: wires the app to real AWS services.
import { createApp } from './app.js';
import { createDynamoStore } from './aws/store.js';
import { createS3Files } from './aws/files.js';
import { createLambdaAnalyzer } from './aws/analyzer.js';

const env = name => process.env[name] ?? '';

export const handler = createApp({
  campusId: env('CAMPUS_ID') || 'default-campus',
  store: createDynamoStore({ itemsTable: env('ITEMS_TABLE'), claimsTable: env('CLAIMS_TABLE') }),
  files: createS3Files({ bucket: env('PHOTO_BUCKET') }),
  analyzer: createLambdaAnalyzer({ functionName: env('IMAGE_WORKER_NAME') }),
});
