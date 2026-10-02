import express, { type RequestHandler } from 'express';

/** Parses JSON objects/arrays only, up to the configured size; errors become 400/413 problems. */
export const jsonBody = (limitBytes: number): RequestHandler =>
  express.json({ limit: limitBytes, strict: true, type: 'application/json' });
