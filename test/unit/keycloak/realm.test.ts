import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface RealmClient {
  clientId: string;
  defaultClientScopes?: string[];
  optionalClientScopes?: string[];
}

const realm = JSON.parse(
  readFileSync(new URL('../../../keycloak/realm-ggi.json', import.meta.url), 'utf8'),
) as { clients: RealmClient[] };

describe('Keycloak realm', () => {
  it('does not let the CLI client request offline tokens, which would outlive logout revocation', () => {
    const cli = realm.clients.find((client) => client.clientId === 'ggi-cli');
    expect(cli).toBeDefined();
    // An explicit empty list, so no optional scope (offline_access included) can be requested.
    expect(cli?.optionalClientScopes).toEqual([]);
    expect(cli?.defaultClientScopes).not.toContain('offline_access');
  });
});
