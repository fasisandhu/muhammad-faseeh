import { describe, expect, it } from 'vitest';
import { Actor, isRole } from '../../../../src/shared/domain/actor.js';

describe('Actor', () => {
  it('answers role questions', () => {
    const user = new Actor('u-1', 'sub-1', ['user']);
    const admin = new Actor('u-2', 'sub-2', ['user', 'admin']);
    expect(user.isAdmin()).toBe(false);
    expect(admin.isAdmin()).toBe(true);
    expect(user.hasRole('user')).toBe(true);
    expect(user.hasAnyRole(['admin'])).toBe(false);
    expect(admin.hasAnyRole(['admin', 'user'])).toBe(true);
  });

  it('copies the roles so callers cannot mutate them', () => {
    const roles: ('user' | 'admin')[] = ['user'];
    const actor = new Actor('u-1', 'sub-1', roles);
    roles.push('admin');
    expect(actor.isAdmin()).toBe(false);
  });

  it('recognises only application roles', () => {
    expect(isRole('user')).toBe(true);
    expect(isRole('admin')).toBe(true);
    expect(isRole('offline_access')).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});
