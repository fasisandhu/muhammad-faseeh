import type { DbContext } from '../../../shared/infrastructure/db/context.js';
import { users } from '../../../shared/infrastructure/db/users-table.js';
import type { UserRepository } from '../domain/ports.js';

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly ctx: DbContext) {}

  async upsert(identity: {
    issuer: string;
    subject: string;
    email: string | null;
    displayName: string | null;
    seenAt: Date;
  }): Promise<string> {
    const [row] = await this.ctx
      .executor()
      .insert(users)
      .values({
        idpIssuer: identity.issuer,
        idpSubject: identity.subject,
        email: identity.email,
        displayName: identity.displayName,
        lastSeenAt: identity.seenAt,
      })
      .onConflictDoUpdate({
        target: [users.idpIssuer, users.idpSubject],
        set: { email: identity.email, displayName: identity.displayName, lastSeenAt: identity.seenAt },
      })
      .returning({ id: users.id });
    if (!row) throw new Error('user upsert returned no row');
    return row.id;
  }
}
