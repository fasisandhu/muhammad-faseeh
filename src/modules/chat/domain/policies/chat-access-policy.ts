import type { Actor } from '../../../../shared/domain/actor.js';
import type { ChatMessage } from '../entities/chat-message.js';

/** Domain-level authorisation for chat (the second of the two enforcement layers, spec §9.5). */
export const ChatAccessPolicy = {
  canAsk: (actor: Actor): boolean => actor.hasAnyRole(['user', 'admin']),
  canRead: (actor: Actor, message: ChatMessage): boolean =>
    message.userId === actor.userId || actor.isAdmin(),
  canListAll: (actor: Actor): boolean => actor.isAdmin(),
} as const;
