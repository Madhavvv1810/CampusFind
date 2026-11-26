// Image-worker Lambda. Invoked asynchronously by the API with { itemId } after a photo upload.
// Adds Amazon Rekognition labels and publishes the post. Throwing makes Lambda retry (twice).
import { RekognitionClient, DetectLabelsCommand } from '@aws-sdk/client-rekognition';
import { createDynamoStore } from './aws/store.js';
import { createLogger } from './log.js';
import { ConflictError } from './http.js';

export function createAnalyzer({ store, rekognition, bucket, log = createLogger(), clock = () => new Date() }) {
  const publish = (itemId, labels, labelSource) => store.updateItem(
    itemId,
    { status: 'ACTIVE', labels, labelSource, processedAt: clock().toISOString(), processingError: null },
    { status: ['PROCESSING', 'PROCESSING_FAILED', 'AWAITING_UPLOAD'] },
  );

  return async function analyze({ itemId }) {
    const item = await store.getItem(itemId);
    if (!item || !item.imageKey || ['ACTIVE', 'REMOVED', 'RESOLVED', 'HIDDEN'].includes(item.status)) return;
    try {
      const result = await rekognition.send(new DetectLabelsCommand({
        Image: { S3Object: { Bucket: bucket, Name: item.imageKey } }, MaxLabels: 15, MinConfidence: 70,
      }));
      const labels = (result.Labels ?? []).map(label => label.Name).filter(Boolean);
      await publish(itemId, labels, 'rekognition');
      log.info('photo analysed', { itemId, labels: labels.length });
    } catch (error) {
      if (error instanceof ConflictError) return; // removed or changed meanwhile
      // Some accounts (e.g. AWS Academy sandboxes) deny Rekognition. The photo is safely stored,
      // so publish without labels; matching still uses fingerprint, category, wording and place.
      if (error.name === 'AccessDeniedException') {
        log.warn('rekognition not permitted, publishing without labels', { itemId });
        await publish(itemId, [], 'unavailable');
        return;
      }
      log.error('photo analysis failed', { itemId, error: error.name, detail: error.message });
      await store.updateItem(itemId, { status: 'PROCESSING_FAILED', processingError: 'Photo analysis could not be completed.' }, { status: 'PROCESSING' })
        .catch(() => {});
      throw error;
    }
  };
}

export const handler = createAnalyzer({
  store: createDynamoStore({ itemsTable: process.env.ITEMS_TABLE }),
  rekognition: new RekognitionClient({}),
  bucket: process.env.PHOTO_BUCKET,
});
