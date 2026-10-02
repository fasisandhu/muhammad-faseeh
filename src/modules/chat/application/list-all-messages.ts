import type { Actor } from '../../../shared/domain/actor.js';
import { ForbiddenError } from '../../../shared/domain/errors.js';
import type { Page, PageRequest } from '../../../shared/domain/pagination.js';
import type { ChatMessage } from '../domain/entities/chat-message.js';
import { ChatAccessPolicy } from '../domain/policies/chat-access-policy.js';
import type { ChatMessageRepository } from '../domain/ports/chat-message-repository.js';

export class ListAllMessages {
  constructor(private readonly messages: ChatMessageRepository) {}

  execute(input: { actor: Actor; userId?: string; page: PageRequest }): Promise<Page<ChatMessage>> {
    if (!ChatAccessPolicy.canListAll(input.actor)) throw new ForbiddenError('list all chat messages');
    return this.messages.listAll({ userId: input.userId }, input.page);
  }
}
