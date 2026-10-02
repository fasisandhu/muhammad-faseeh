import { and, eq, lt, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Cursor, Page } from '../../domain/pagination.js';

/** Keyset pagination on (created_at DESC, id DESC): rows strictly after the cursor. */
export function cursorCondition(createdAt: PgColumn, id: PgColumn, cursor: Cursor | null): SQL | undefined {
  if (!cursor) return undefined;
  return or(lt(createdAt, cursor.createdAt), and(eq(createdAt, cursor.createdAt), lt(id, cursor.id)));
}

/** Expects limit + 1 rows; the extra row only signals that another page exists. */
export function toPage<T>(rows: T[], limit: number, cursorOf: (item: T) => Cursor): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last !== undefined ? cursorOf(last) : null };
}
