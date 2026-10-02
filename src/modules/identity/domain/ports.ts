import type { VerifiedAccessToken } from './verified-token.js';

export interface AccessTokenVerifier {
  verify(token: string, now: Date): Promise<VerifiedAccessToken>;
}

export interface ProofInput {
  proof: string;
  method: string;
  /** Absolute URL the client called, built from PUBLIC_BASE_URL + path (never from the Host header). */
  url: string;
  accessToken: string;
  expectedJkt: string;
  now: Date;
}

export interface ProofVerifier {
  verify(input: ProofInput): Promise<{ jkt: string; jti: string }>;
}

export interface ReplayCache {
  /** Atomically records the key; false if it was already present. */
  markIfUnseen(key: string, ttlMs: number): Promise<boolean>;
}

export interface SessionRevocations {
  revoke(id: string, ttlMs: number): Promise<void>;
  isRevoked(id: string): Promise<boolean>;
}

export interface UserRepository {
  /** Inserts or refreshes the local user for an IdP identity; returns the local user id. */
  upsert(identity: {
    issuer: string;
    subject: string;
    email: string | null;
    displayName: string | null;
    seenAt: Date;
  }): Promise<string>;
}
