// Hands photo analysis to the image-worker Lambda asynchronously ("Event" invocation):
// the API returns immediately, and Lambda retries the worker twice if it fails.
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

export function createLambdaAnalyzer({ functionName, client = new LambdaClient({}) }) {
  return {
    queue: itemId => client.send(new InvokeCommand({
      FunctionName: functionName, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ itemId })),
    })),
  };
}
