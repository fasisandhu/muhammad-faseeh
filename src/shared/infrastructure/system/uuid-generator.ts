import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../domain/ids.js';

export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
