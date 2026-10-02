export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

/** The authenticated caller as the domain sees it: a local user id plus application roles. */
export class Actor {
  readonly roles: ReadonlySet<Role>;

  constructor(
    readonly userId: string,
    readonly subject: string,
    roles: Iterable<Role>,
  ) {
    this.roles = new Set(roles);
  }

  isAdmin(): boolean {
    return this.roles.has('admin');
  }

  hasRole(role: Role): boolean {
    return this.roles.has(role);
  }

  hasAnyRole(roles: readonly Role[]): boolean {
    return roles.some((role) => this.roles.has(role));
  }
}
