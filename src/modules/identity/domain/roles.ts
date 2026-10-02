import { isRole, type Role } from '../../../shared/domain/actor.js';
import { isRecord } from '../../../shared/domain/guards.js';

export function readClaimPath(claims: Readonly<Record<string, unknown>>, path: string): unknown {
  let current: unknown = claims;
  for (const key of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Keeps only the application roles; IdP-internal roles (offline_access, default-roles-*) are ignored. */
export function extractRoles(raw: unknown): ReadonlySet<Role> {
  return new Set(Array.isArray(raw) ? raw.filter(isRole) : []);
}
