# Project Proposal

## CampusFind: An Event-Driven Cloud Lost-and-Found Matching System

**Course:** UCS531 — Cloud Computing
**Student:** Madhav Singla — **Roll No.:** 1024170356
**Platform:** Amazon Web Services
**Team:** Individual implementation (confirm with the instructor; the course brief allows teams of up to three).

### Problem statement

Lost-and-found items on campus are announced in scattered chat groups or handled at a physical desk. Reports have inconsistent descriptions, photos are hard to compare, and a person who finds an item may not know where to post it. CampusFind provides one searchable board for lost and found posts and uses cloud image analysis to suggest possible matches.

### Objectives

1. Let campus users create lost reports (name, category and location required; photo optional) and found reports (photo plus a name or category required).
2. Store photos privately in Amazon S3 and item records in Amazon DynamoDB.
3. Analyse uploaded photos asynchronously with AWS Lambda and Amazon Rekognition.
4. Suggest possible matches from category, item wording, detected photo labels and campus location.
5. Let a person send a private message about a matching post; only the post owner reads it.
6. Let the owner confirm a handoff so both linked posts resolve.
7. Demonstrate cloud storage, REST services, serverless computation, NoSQL data, event-driven processing and monitoring.

### Scope

The MVP serves one campus. Found reports require a JPG/PNG photo up to 5 MB. Lost reports can omit a photo. Photos are stored in a private S3 bucket and shown through short-lived links. A small perceptual fingerprint is computed in the browser and used only as an extra ranking signal; it is not object recognition or identity verification.

Sign-in is out of scope for this build. Each browser gets a random guest ID that identifies its posts. This is a demo shortcut: it is not secure authentication, and a production version would use Amazon Cognito. Payments, open chat, maps, face recognition, custom machine-learning models and multi-campus search are also out of scope.

### Cloud architecture

The static interface is hosted on an S3 website bucket. An API Gateway HTTP API exposes REST routes to a Lambda API function. The function writes item metadata to DynamoDB and returns a short-lived S3 upload URL. After the photo is uploaded, the function invokes an image-worker Lambda asynchronously. The worker calls Rekognition to detect labels and writes them back to DynamoDB. CloudWatch stores all function logs.

### Data and matching

Each item stores its type (lost or found), category, name or title, optional location and date, owner ID, S3 object key, perceptual fingerprint, creation time, processing status and detected labels. DynamoDB indexes support recent campus posts, owner posts and opposite-type candidates. Match suggestions combine image resemblance, shared labels, wording, category and location. They are suggestions only; a person verifies the actual item.

### Syllabus mapping

| UCS531 topic | CampusFind use |
|---|---|
| AWS and cloud service offerings | S3, API Gateway, Lambda, DynamoDB, Rekognition, CloudWatch |
| RESTful services and security | REST routes, private S3 bucket, short-lived presigned URLs, scoped IAM policies |
| Cloud data storage and NoSQL | S3 photo objects; DynamoDB item and claim records with indexes |
| Messaging and event-driven computing | Asynchronous Lambda invocation for photo analysis |
| Elasticity and resource allocation | Serverless services scale with requests |
| Cloud monitoring and cost management | CloudWatch logs, budget alerts, stack cleanup |

### Evaluation demonstration

Post a found blue bottle with a photo and a lost blue bottle without one. Show the analysis status, the labels stored in DynamoDB, the match suggestions and the handoff. Use the AWS console to show S3, Lambda, DynamoDB and CloudWatch activity. Screenshots must come from the deployed stack.
