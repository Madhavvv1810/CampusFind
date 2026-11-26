#!/usr/bin/env node
// Creates a CampusFind admin (any email, e.g. Gmail) or promotes an existing account.
// Cognito emails a temporary password; the admin sets their own at first sign-in.
//   AWS_REGION=ap-southeast-2 node scripts/create-admin.mjs you@gmail.com "Your Name"
import { createRequire } from 'node:module';
import { stackOutputs } from './lib/tools.mjs';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminAddUserToGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');
const [email, name = 'CampusFind Admin'] = process.argv.slice(2);
if (!email?.includes('@')) { console.error('Usage: node scripts/create-admin.mjs <email> "<name>"'); process.exit(1); }

const { UserPoolId } = await stackOutputs();
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
try {
  await cognito.send(new AdminCreateUserCommand({
    UserPoolId, Username: email, DesiredDeliveryMediums: ['EMAIL'],
    UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }, { Name: 'name', Value: name }],
  }));
  console.log(`Created ${email}. A temporary password has been emailed to it.`);
} catch (error) {
  if (error.name !== 'UsernameExistsException') throw error;
  console.log(`${email} already has an account; promoting it.`);
}
await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: email, GroupName: 'admins' }));
console.log(`${email} is now an admin. Sign in on the website (sign out first if already signed in).`);
