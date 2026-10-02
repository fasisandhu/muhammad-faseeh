import { describe, expect, it } from 'vitest';
import { extractRoles, readClaimPath } from '../../../../src/modules/identity/domain/roles.js';

describe('role mapping', () => {
  it('reads nested claims by dot path', () => {
    expect(readClaimPath({ realm_access: { roles: ['user'] } }, 'realm_access.roles')).toEqual(['user']);
    expect(readClaimPath({ realm_access: 'oops' }, 'realm_access.roles')).toBeUndefined();
    expect(readClaimPath({}, 'a.b.c')).toBeUndefined();
  });

  it('keeps only application roles', () => {
    expect([...extractRoles(['user', 'offline_access', 'default-roles-ggi', 'admin', 7])]).toEqual([
      'user',
      'admin',
    ]);
    expect(extractRoles('admin').size).toBe(0);
    expect(extractRoles(undefined).size).toBe(0);
  });
});
