import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StoredKeyPair } from './oidc.js';

export interface StoredSession {
  apiBaseUrl: string;
  keys: StoredKeyPair;
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: number;
}

const DIRECTORY = path.resolve(process.env.GGI_CLI_HOME ?? '.ggi-cli');
const FILE = path.join(DIRECTORY, 'session.json');

export async function loadSession(): Promise<StoredSession | null> {
  try {
    return JSON.parse(await readFile(FILE, 'utf8')) as StoredSession;
  } catch {
    return null;
  }
}

/** The private DPoP key lives only here, readable by the current user (0600). */
export async function saveSession(session: StoredSession): Promise<void> {
  await mkdir(DIRECTORY, { recursive: true });
  await writeFile(FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
  await chmod(FILE, 0o600).catch(() => undefined);
}

export async function clearSession(): Promise<void> {
  await rm(FILE, { force: true });
}
