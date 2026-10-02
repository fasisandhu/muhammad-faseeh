import { describe, expect, it } from 'vitest';
import { Actor } from '../../../../../src/shared/domain/actor.js';
import { ChatMessage } from '../../../../../src/modules/chat/domain/entities/chat-message.js';
import { ChatAccessPolicy } from '../../../../../src/modules/chat/domain/policies/chat-access-policy.js';
import { Question } from '../../../../../src/modules/chat/domain/value-objects/question.js';
import { freeCharge } from '../../../../../src/modules/chat/domain/value-objects/quota-charge.js';
import { UsagePeriod } from '../../../../../src/modules/chat/domain/value-objects/usage-period.js';

const message = ChatMessage.reserve({
  id: 'm-1',
  userId: 'owner',
  question: Question.create('hi'),
  charge: freeCharge(UsagePeriod.parse('2026-10')),
  requestId: 'req-12345678',
  createdAt: new Date('2026-10-15T12:00:00Z'),
});
const owner = new Actor('owner', 'sub-owner', ['user']);
const stranger = new Actor('stranger', 'sub-stranger', ['user']);
const admin = new Actor('admin', 'sub-admin', ['user', 'admin']);
const roleless = new Actor('nobody', 'sub-nobody', []);

describe('ChatAccessPolicy', () => {
  it('lets users and admins ask, nobody else', () => {
    expect(ChatAccessPolicy.canAsk(owner)).toBe(true);
    expect(ChatAccessPolicy.canAsk(admin)).toBe(true);
    expect(ChatAccessPolicy.canAsk(roleless)).toBe(false);
  });

  it('lets only the owner or an admin read a message', () => {
    expect(ChatAccessPolicy.canRead(owner, message)).toBe(true);
    expect(ChatAccessPolicy.canRead(admin, message)).toBe(true);
    expect(ChatAccessPolicy.canRead(stranger, message)).toBe(false);
  });

  it('restricts system-wide listing to admins', () => {
    expect(ChatAccessPolicy.canListAll(admin)).toBe(true);
    expect(ChatAccessPolicy.canListAll(owner)).toBe(false);
  });
});
