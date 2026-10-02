import type { Actor } from '../../../../shared/domain/actor.js';
import type { ChatMessage } from '../entities/chat-message.js';

/** Domain-level authorisation for chat (the second enforcement layer, after the route's role guard). */
export const ChatAccessPolicy = {
  canAsk: (actor: Actor): boolean => actor.hasAnyRole(['user', 'admin']),
  canRead: (actor: Actor, message: ChatMessage): boolean =>
    message.userId === actor.userId || actor.isAdmin(),
  canListAll: (actor: Actor): boolean => actor.isAdmin(),
} as const;
