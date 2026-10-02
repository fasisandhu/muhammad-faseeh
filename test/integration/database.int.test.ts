import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../../src/shared/infrastructure/db/client.js';
import { DbContext } from '../../src/shared/infrastructure/db/context.js';
import { users } from '../../src/shared/infrastructure/db/users-table.js';
import { truncateAll } from '../support/db.js';

describe('DbContext (real Postgres, app role)', () => {
  let handle: DatabaseHandle;
  let ctx: DbContext;

  beforeAll(() => {
    handle = createDatabase(inject('databaseAppUrl'), 5);
    ctx = new DbContext(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(inject('databaseOwnerUrl'));
  });

  const insertUser = (subject: string) =>
    ctx.executor().insert(users).values({ idpIssuer: 'https://idp.test', idpSubject: subject });
  const countUsers = async (subject: string) =>
    (await handle.db.select().from(users).where(eq(users.idpSubject, subject))).length;

  it('commits work done inside run()', async () => {
    await ctx.run(() => insertUser('committed'));
    expect(await countUsers('committed')).toBe(1);
  });

  it('rolls back everything when the work throws', async () => {
    await expect(
      ctx.run(async () => {
        await insertUser('rolled-back');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await countUsers('rolled-back')).toBe(0);
  });

  it('joins nested run() calls into the outer transaction', async () => {
    await expect(
      ctx.run(async () => {
        await ctx.run(() => insertUser('inner'));
        throw new Error('outer fails');
      }),
    ).rejects.toThrow('outer fails');
    expect(await countUsers('inner')).toBe(0);
  });

  it('exposes the ambient transaction only inside run()', async () => {
    expect(ctx.isInTransaction()).toBe(false);
    await ctx.run(() => {
      expect(ctx.isInTransaction()).toBe(true);
      return Promise.resolve();
    });
    expect(ctx.isInTransaction()).toBe(false);
  });

  it('keeps concurrent transactions isolated', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = ctx.run(async () => {
      await insertUser('slow');
      await gate;
      throw new Error('slow fails');
    });
    await ctx.run(() => insertUser('fast'));
    release();
    await expect(slow).rejects.toThrow('slow fails');
    expect(await countUsers('fast')).toBe(1);
    expect(await countUsers('slow')).toBe(0);
  });

  it('gives the app role no DELETE privilege', async () => {
    await insertUser('kept');
    await expect(handle.pool.query('DELETE FROM users')).rejects.toMatchObject({ code: '42501' });
  });

  it('gives the app role no DDL privilege', async () => {
    await expect(handle.pool.query('CREATE TABLE intruder (id int)')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
