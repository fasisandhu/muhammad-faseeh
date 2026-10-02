import { InvalidStateError } from '../../../../shared/domain/errors.js';
import type { Question } from '../value-objects/question.js';
import type { QuotaCharge } from '../value-objects/quota-charge.js';
import type { TokenUsage } from '../value-objects/token-usage.js';

export type ChatMessageStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface ChatMessageProps {
  id: string;
  userId: string;
  question: Question;
  status: ChatMessageStatus;
  charge: QuotaCharge;
  answer: string | null;
  model: string | null;
  tokenUsage: TokenUsage | null;
  failureCode: string | null;
  requestId: string;
  createdAt: Date;
  completedAt: Date | null;
  latencyMs: number | null;
}

export class ChatMessage {
  private constructor(private readonly props: ChatMessageProps) {}

  static reserve(input: {
    id: string;
    userId: string;
    question: Question;
    charge: QuotaCharge;
    requestId: string;
    createdAt: Date;
  }): ChatMessage {
    return new ChatMessage({
      ...input,
      status: 'PENDING',
      answer: null,
      model: null,
      tokenUsage: null,
      failureCode: null,
      completedAt: null,
      latencyMs: null,
    });
  }

  static rehydrate(props: ChatMessageProps): ChatMessage {
    return new ChatMessage({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get question(): Question {
    return this.props.question;
  }
  get status(): ChatMessageStatus {
    return this.props.status;
  }
  get charge(): QuotaCharge {
    return this.props.charge;
  }
  get answer(): string | null {
    return this.props.answer;
  }
  get model(): string | null {
    return this.props.model;
  }
  get tokenUsage(): TokenUsage | null {
    return this.props.tokenUsage;
  }
  get failureCode(): string | null {
    return this.props.failureCode;
  }
  get requestId(): string {
    return this.props.requestId;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get completedAt(): Date | null {
    return this.props.completedAt;
  }
  get latencyMs(): number | null {
    return this.props.latencyMs;
  }

  complete(input: { answer: string; model: string; tokenUsage: TokenUsage; completedAt: Date }): void {
    this.assertPending('complete');
    this.props.status = 'COMPLETED';
    this.props.answer = input.answer;
    this.props.model = input.model;
    this.props.tokenUsage = input.tokenUsage;
    this.props.completedAt = input.completedAt;
    this.props.latencyMs = Math.max(0, input.completedAt.getTime() - this.props.createdAt.getTime());
  }

  fail(failureCode: string, at: Date): void {
    this.assertPending('fail');
    this.props.status = 'FAILED';
    this.props.failureCode = failureCode;
    this.props.completedAt = at;
    this.props.latencyMs = Math.max(0, at.getTime() - this.props.createdAt.getTime());
  }

  private assertPending(action: string): void {
    if (this.props.status !== 'PENDING')
      throw new InvalidStateError('chat message', this.props.status, action);
  }
}
