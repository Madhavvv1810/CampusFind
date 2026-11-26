# CampusFind demonstration outline

The slide deck `CampusFind-UCS531.pptx` should follow this sequence. The architecture and security slides need manual updates to match the final design (see notes).

1. **CampusFind** — Project title, course and student details.
2. **Problem** — Lost and found items are scattered across chats and desks.
3. **Architecture** — S3 static website, API Gateway, API Lambda, DynamoDB, private S3 photo bucket, image-worker Lambda, Rekognition and CloudWatch. Note that the worker is invoked asynchronously.
4. **Photo matching** — Browser fingerprint, S3 upload, Rekognition labels, ranked suggestions. Explain the limits: generic labels and a heuristic score.
5. **Live walkthrough** — Post a found item with a photo, post a lost item without one, compare suggestions side by side, on the other person's post press **This is mine**, chat back and forth (show the unread badge in **Messages**), then confirm the handoff from the chat. Use two browser windows (one normal, one private) as the two students.
6. **Security and limits** — Private S3 bucket, presigned URLs, scoped Lambda roles. State clearly that sign-in uses a guest ID and is a demo shortcut; Cognito is the production path.
7. **AWS evidence** — Screenshots from the deployed stack: S3, Lambda, DynamoDB, CloudWatch and Rekognition.

**Deck update needed:** slide 3 and slide 6 still show Cognito, CloudFront and SQS. Replace them with the design above before presenting.
