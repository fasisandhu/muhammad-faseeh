import { defineRoute, type Route } from '../../../shared/http/routing.js';
import type { Logout } from '../application/logout.js';

export function authRoutes(deps: { logout: Logout }): Route[] {
  return [
    defineRoute({
      method: 'get',
      path: '/auth/me',
      summary: 'The authenticated principal and its token binding',
      access: { roles: ['user', 'admin'] },
      handler: ({ auth }) =>
        Promise.resolve({
          status: 200,
          body: {
            data: {
              userId: auth.actor.userId,
              subject: auth.actor.subject,
              email: auth.email,
              roles: [...auth.actor.roles],
              sessionId: auth.token.sessionId,
              tokenExpiresAt: auth.token.expiresAt.toISOString(),
              keyThumbprint: auth.token.keyThumbprint,
            },
          },
        }),
    }),
    defineRoute({
      method: 'post',
      path: '/auth/logout',
      summary: 'Revoke the current session for every token issued in it',
      access: { roles: ['user', 'admin'] },
      handler: async ({ auth }) => {
        await deps.logout.execute(auth);
        return { status: 204 };
      },
    }),
  ];
}
