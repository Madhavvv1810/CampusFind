// Student accounts in the Cognito user pool, for the admin portal.
import {
  CognitoIdentityProviderClient, ListUsersCommand, ListUsersInGroupCommand, AdminDisableUserCommand, AdminEnableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const attribute = (user, name) => user.Attributes?.find(entry => entry.Name === name)?.Value ?? '';

export function createCognitoUsers({ userPoolId, client = new CognitoIdentityProviderClient({}) }) {
  return {
    async list() {
      const users = [];
      let PaginationToken;
      do {
        const page = await client.send(new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60, PaginationToken }));
        users.push(...(page.Users ?? []));
        PaginationToken = page.PaginationToken;
      } while (PaginationToken && users.length < 600);
      const admins = new Set(((await client.send(new ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: 'admins' }))).Users ?? []).map(user => user.Username));
      return users.map(user => ({
        username: user.Username, email: attribute(user, 'email'), name: attribute(user, 'name'), sub: attribute(user, 'sub'),
        status: user.UserStatus, enabled: user.Enabled, createdAt: user.UserCreateDate, isAdmin: admins.has(user.Username),
      }));
    },
    setEnabled: (username, enabled) => client.send(new (enabled ? AdminEnableUserCommand : AdminDisableUserCommand)({ UserPoolId: userPoolId, Username: username })),
  };
}
