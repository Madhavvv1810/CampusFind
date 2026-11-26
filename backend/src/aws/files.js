// Photo storage in a private S3 bucket. The browser never gets AWS credentials: it receives
// short-lived presigned URLs to upload (PUT, 5 min) and view (GET, 10 min) one object.
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function createS3Files({ bucket, client = new S3Client({}) }) {
  return {
    uploadUrl: (key, contentType) => getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: 300 }),
    viewUrl: key => getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 600 }),

    /** Object size in bytes, or 0 if it was never uploaded. */
    async size(key) {
      try {
        return (await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).ContentLength ?? 0;
      } catch (error) {
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) return 0;
        throw error;
      }
    },

    remove: key => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
  };
}
