import type { Request } from 'express';
import { z, type ZodType } from 'zod';
import type { Cursor } from '../domain/pagination.js';
import { HttpError } from './problem.js';

export interface Issue {
  location: 'params' | 'query' | 'body';
  path: string;
  message: string;
}

export interface Schemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

const isEmpty = (value: unknown): boolean =>
  value === undefined || (typeof value === 'object' && value !== null && Object.keys(value).length === 0);

/** Validates params, query and body against the route's strict schemas; undeclared inputs are rejected. */
export function parseInput(
  req: Request,
  schemas: Schemas,
): { params: unknown; query: unknown; body: unknown } {
  const issues: Issue[] = [];
  const parse = (location: Issue['location'], schema: ZodType | undefined, value: unknown): unknown => {
    if (!schema) {
      if (!isEmpty(value))
        issues.push({ location, path: '', message: `${location} is not accepted by this endpoint` });
      return undefined;
    }
    const result = schema.safeParse(value ?? (location === 'body' ? undefined : {}));
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      issues.push({ location, path: issue.path.join('.'), message: issue.message });
    }
    return undefined;
  };
  const params = parse('params', schemas.params, req.params);
  const query = parse('query', schemas.query, req.query);
  const body = parse('body', schemas.body, req.body);
  if (issues.length > 0) throw new HttpError('VALIDATION_FAILED', 'The request is invalid.', { issues });
  return { params, query, body };
}

export const uuidParam = z.strictObject({ id: z.uuid() });

export function encodeCursor(cursor: Cursor | null): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })).toString(
    'base64url',
  );
}

const CursorPayload = z.strictObject({ c: z.iso.datetime(), i: z.uuid() });

export function decodeCursor(value: string | undefined): Cursor | null {
  if (value === undefined) return null;
  const parsed = CursorPayload.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  return { createdAt: new Date(parsed.c), id: parsed.i };
}

export const paginationQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z
    .string()
    .max(200)
    .optional()
    .transform((value, ctx) => {
      try {
        return decodeCursor(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'cursor is malformed' });
        return z.NEVER;
      }
    }),
});
