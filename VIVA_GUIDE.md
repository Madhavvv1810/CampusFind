# CampusFind — Viva Guide

**What I built, what I used, and why** · UCS531 Cloud Computing · Madhav Singla (1024170356)

## 1. The project in one minute

**CampusFind** is a lost-and-found website for our campus. A student who loses something posts it; a student who finds something posts a photo of it. The website compares the posts and suggests likely matches. The two students then talk in a **private chat** (no phone numbers on public display), and when the item is handed back, the owner marks it **Returned**.

**Name:** *Campus* + *Find*: it helps the campus find lost things.

**Live link:** https://d12eqour2qu335.cloudfront.net

The whole thing runs on **Amazon Web Services (AWS)** as a **serverless** application: there is no computer of mine running all the time. AWS runs my code only when someone uses the site.

## 2. Why is the link "d12eqour2qu335.cloudfront.net"?

- My website is delivered by **Amazon CloudFront**, AWS's content delivery network (CDN).
- When you create a CloudFront distribution, AWS gives it a **free, automatically generated address**: a random ID (`d12eqour2qu335`) followed by `.cloudfront.net`. I did not choose those letters; they only make the address unique.
- It comes with **HTTPS (the padlock) for free**.
- To get a name like `campusfind.in`, I would have to **buy a domain** (about ₹500–1000 a year), add a certificate and point the domain to CloudFront. I skipped this because it costs money and is not needed to show the cloud features. It is easy to add later; the app does not change.

## 3. The pages of the website

| Page | What it does |
|---|---|
| Home | Introduction, live campus numbers (items returned, return rate), how it works, recently found items |
| Everything / Lost / Found / Returned | The campus board with search and category filter |
| Report | Form to report a lost or found item, with photo and a live preview of the post |
| Item page | Full details of one item, "This is mine" button, share, report; the owner also sees suggested matches |
| Messages | Private chats between finder and owner |
| Profile | My posts, my numbers, my recent chats |
| Admin | For moderators: charts of campus activity and the list of reported posts |
| About | What the site is, privacy, common questions, tips |

## 4. What I used and why

| Service | What it is | Why I used it |
|---|---|---|
| **Amazon CloudFront** | Content delivery network | Delivers the website fast from servers near the user, gives HTTPS for free, and keeps copies (cache) so the site loads quickly |
| **Amazon S3** (2 buckets) | File storage | One bucket holds the website files. The other holds item **photos**, kept **private** and encrypted |
| **Amazon Cognito** | Sign-up and login service | Handles accounts, passwords and email verification for me, so I never store passwords. A small rule allows **only @thapar.edu emails** |
| **Amazon API Gateway** | The "front door" for the app's requests | Receives every request (post an item, send a message…), checks the student is logged in, and passes it to my code |
| **AWS Lambda** (3 functions) | Runs my code on demand | 1) the main app logic, 2) a photo-processing worker, 3) the email-domain check at sign-up. No server to manage; I pay only when it runs |
| **Amazon DynamoDB** (2 tables) | NoSQL database | Stores posts and chats. Fast, scales automatically, no database server to maintain, and deletes old posts after **90 days** by itself |
| **Amazon Rekognition** | Image recognition (AI) | Reads a photo and returns labels like "Bottle" to help matching. (Blocked in my lab account, so the app still works without it.) |
| **Amazon CloudWatch** | Monitoring | Logs, a dashboard (traffic, errors, speed) and alarms if something breaks |
| **AWS CloudFormation / SAM** | Infrastructure as code | The whole setup is written in one file (`template.yaml`). One command creates or deletes everything, the same way every time |
| **IAM** | Permissions | Controls what each part is allowed to do |

**Other tools:** JavaScript (front end and back end), Node.js 22 (runs the Lambda code), GitHub Actions (runs my tests automatically), and the AWS CLI / SAM CLI to deploy.

## 5. How it works, step by step (found item with a photo)

1. The student opens the site. **CloudFront** delivers the pages from **S3**.
2. They log in through **Cognito**, which gives the browser a secure login token.
3. They fill in the Report form. The photo is **made smaller on their phone** and its location data is removed.
4. The request goes to **API Gateway**, which checks the token, then to the **Lambda** function, which saves the post in **DynamoDB**.
5. Lambda gives the browser a **temporary upload link**, so the photo goes **straight into the private S3 bucket**.
6. A second Lambda (the **worker**) runs in the background, checks the photo (with **Rekognition** where allowed), and makes the post live.
7. When someone presses **"This is mine"**, a private chat is saved in DynamoDB. When the owner confirms, both posts are closed together.

## 6. Why I made these choices

- **Serverless instead of a virtual machine (EC2):** no server to install, patch or keep running; it scales automatically; it costs almost nothing when nobody is using it.
- **DynamoDB instead of MySQL:** simple records (posts, chats), very fast lookups, no database server to manage, and automatic deletion of old data.
- **Cognito instead of writing my own login:** passwords and email verification are security-critical; a managed service is safer than code I write myself.
- **Photos go straight to S3:** big files never pass through my code, so it stays fast and cheap.
- **Background worker for photos:** the student does not wait while the photo is processed.
- **College email only:** only real students can post, which keeps the board trustworthy.
- **Infrastructure as code:** I can rebuild the whole system with one command, which was useful when the lab account changed.

## 7. Security and privacy (in simple words)

- Only students with a verified **@thapar.edu** email can sign up.
- Other students see only a first name and initial (e.g. "Madhav S."), never an email.
- Photos are private; they are shown through links that expire after a few minutes.
- A chat can only be read by the two people in it.
- Every action is checked on the server: only the owner can edit or delete a post.
- Bad posts can be **reported**; after 3 reports a post is hidden until a moderator reviews it.

## 8. Problems I faced and how I solved them

| Problem | Solution |
|---|---|
| My first AWS Academy lab (Cloud Foundations) did not allow creating databases | Moved to the **Cloud Developing course Sandbox** |
| The sandbox only allows the **us-east-1** (N. Virginia) region, not Mumbai | Deployed in us-east-1 |
| The sandbox cannot create new permission roles | Used the lab's existing **LabRole** |
| Rekognition (image AI) is blocked in the sandbox | Found the error in **CloudWatch logs**; changed the worker so posts still go live and matching uses the other clues |

## 9. Testing

- **25 automated tests** check the rules (who can edit, chats, reports, matching).
- A **live test script** signs in two test students and runs the full journey on the real AWS system in about 25 seconds.
- **GitHub Actions** runs the tests automatically every time the code changes.

## 10. Questions the teacher may ask

**Q: What is cloud computing in your project?** Every part runs on AWS-managed services: storage (S3), database (DynamoDB), compute (Lambda), login (Cognito), delivery (CloudFront). I do not own or run any server.

**Q: Which service model is this: IaaS, PaaS or SaaS?** Mainly **FaaS / serverless** (Lambda) on top of **PaaS**-style managed services (DynamoDB, Cognito, API Gateway). The finished website itself is SaaS for the students.

**Q: What is serverless?** Servers still exist, but AWS manages them. I only upload code; AWS runs it when a request arrives and charges per use.

**Q: Why not EC2?** I would have to manage the operating system, updates and scaling, and pay even when no one uses the site.

**Q: Where is the data stored?** Posts and chats in DynamoDB; photos in a private S3 bucket; both in the us-east-1 region.

**Q: How does matching work?** It compares the photo, the words in the description, the category and the place, gives a score, and shows the best matches. The owner always confirms in chat.

**Q: What if many students use it at once?** Lambda, DynamoDB and CloudFront scale automatically; nothing needs to be changed.

**Q: How much does it cost?** Almost nothing. It is pay-per-use and fits in the free tier and the AWS Academy credits.

**Q: How do you deploy?** One command: `bash scripts/deploy.sh campusfind`. It builds the code, creates every AWS resource from `template.yaml`, uploads the website and refreshes CloudFront.

**Q: How would you improve it?** A custom domain name, instant notifications for new messages, email alerts, and a mobile app.
