import type { Page } from '../domain/pagination.js';
import { encodeCursor } from './validation.js';

export function pageBody<T, R>(page: Page<T>, map: (item: T) => R, limit: number) {
  return { data: page.items.map(map), page: { limit, nextCursor: encodeCursor(page.nextCursor) } };
}
