// Shared helpers for operator scripts (seed data, live smoke test). They run with the operator's
// AWS credentials: users are created with Cognito admin APIs and signed in through the
// stack's "tools" app client, which only accepts ADMIN_USER_PASSWORD_AUTH (IAM-signed).
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

// The AWS SDK is installed in backend/; resolve it from there.
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const {
  CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand, AdminDeleteUserCommand, ListUsersCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
export const dynamo = {
  ...require('@aws-sdk/client-dynamodb'),
  ...require('@aws-sdk/lib-dynamodb'),
};

export const region = process.env.AWS_REGION ?? 'us-east-1';
const cognito = new CognitoIdentityProviderClient({ region });

export async function stackOutputs(stackName = process.env.STACK_NAME ?? 'campusfind') {
  const { Stacks } = await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: stackName }));
  return Object.fromEntries((Stacks[0].Outputs ?? []).map(output => [output.OutputKey, output.OutputValue]));
}

/** Creates (or reuses) a verified user and returns an API client signed in as them. */
export async function signInAs(outputs, { email, name }) {
  const password = `Cf-${crypto.randomBytes(12).toString('base64url')}9a`;
  try {
    await cognito.send(new AdminCreateUserCommand({
      UserPoolId: outputs.UserPoolId, Username: email, MessageAction: 'SUPPRESS',
      UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }, { Name: 'name', Value: name }],
    }));
  } catch (error) {
    if (error.name !== 'UsernameExistsException') throw error;
  }
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: outputs.UserPoolId, Username: email, Password: password, Permanent: true }));
  const auth = await cognito.send(new AdminInitiateAuthCommand({
    UserPoolId: outputs.UserPoolId, ClientId: outputs.ToolsClientId, AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email, PASSWORD: password },
  }));
  return apiClient(outputs.ApiUrl, auth.AuthenticationResult.IdToken);
}

export async function deleteUsers(outputs, emailPrefix) {
  const { Users = [] } = await cognito.send(new ListUsersCommand({ UserPoolId: outputs.UserPoolId, Filter: `email ^= "${emailPrefix}"` }));
  for (const user of Users) await cognito.send(new AdminDeleteUserCommand({ UserPoolId: outputs.UserPoolId, Username: user.Username }));
  return Users.length;
}

export function apiClient(apiUrl, token) {
  async function call(method, path, body) {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }
  const ok = async (method, path, body) => {
    const result = await call(method, path, body);
    if (result.status >= 400) throw new Error(`${method} ${path} -> ${result.status} ${result.data.message ?? ''}`);
    return result.data;
  };
  return { call, ok };
}

/** Creates a post through the real API, uploading the photo to S3 when one is given. */
export async function createPost(api, fields, photo) {
  const body = { ...fields, ...(photo ? { file: { contentType: 'image/jpeg', size: photo.length } } : {}) };
  const { item, uploadUrl } = await api.ok('POST', '/items', body);
  if (photo) {
    const upload = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: photo });
    if (!upload.ok) throw new Error(`photo upload failed: ${upload.status}`);
    await api.ok('POST', `/items/${item.itemId}/complete`, {});
  }
  return item;
}

export async function waitFor(check, { tries = 20, delayMs = 1500 } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw new Error('timed out waiting');
}
