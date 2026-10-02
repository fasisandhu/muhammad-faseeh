import type { Actor } from '../../../shared/domain/actor.js';
import type { ChatMessage } from '../domain/entities/chat-message.js';
import { ChatMessageNotFoundError } from '../domain/errors.js';
import { ChatAccessPolicy } from '../domain/policies/chat-access-policy.js';
import type { ChatMessageRepository } from '../domain/ports/chat-message-repository.js';

export class GetMyMessage {
  constructor(private readonly messages: ChatMessageRepository) {}

  async execute(input: { actor: Actor; id: string }): Promise<ChatMessage> {
    const message = await this.messages.findById(input.id);
    if (!message || !ChatAccessPolicy.canRead(input.actor, message))
      throw new ChatMessageNotFoundError(input.id);
    return message;
  }
}
