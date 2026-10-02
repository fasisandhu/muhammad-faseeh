import type { Actor } from '../../../shared/domain/actor.js';
import type { Page, PageRequest } from '../../../shared/domain/pagination.js';
import type { ChatMessage } from '../domain/entities/chat-message.js';
import type { ChatMessageRepository } from '../domain/ports/chat-message-repository.js';

export class ListMyMessages {
  constructor(private readonly messages: ChatMessageRepository) {}

  execute(input: { actor: Actor; page: PageRequest }): Promise<Page<ChatMessage>> {
    return this.messages.listByUser(input.actor.userId, input.page);
  }
}
