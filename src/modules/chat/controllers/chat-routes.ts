import { z } from 'zod';
import { pageBody } from '../../../shared/http/page.js';
import { defineRoute, type Route } from '../../../shared/http/routing.js';
import { sanitizedText } from '../../../shared/http/sanitize.js';
import { paginationQuery, uuidParam } from '../../../shared/http/validation.js';
import type { AskQuestion } from '../application/ask-question.js';
import type { GetMyMessage } from '../application/get-my-message.js';
import type { GetMyUsage } from '../application/get-my-usage.js';
import type { ListMyMessages } from '../application/list-my-messages.js';
import { Question, QUESTION_MAX_LENGTH } from '../domain/value-objects/question.js';
import { messageDto, quotaDto } from './chat-dto.js';

const USERS = { roles: ['user', 'admin'] } as const;
const askBody = z.strictObject({ question: sanitizedText(QUESTION_MAX_LENGTH) });

export interface ChatUseCases {
  ask: AskQuestion;
  list: ListMyMessages;
  get: GetMyMessage;
  usage: GetMyUsage;
}

export function chatRoutes(uc: ChatUseCases): Route[] {
  return [
    defineRoute({
      method: 'post',
      path: '/chat/messages',
      summary: 'Ask a question (mocked OpenAI); charges the free quota first, then the newest bundle',
      access: USERS,
      schemas: { body: askBody },
      handler: async ({ actor, body, requestId, signal }) => {
        const result = await uc.ask.execute({
          actor,
          question: Question.create(body.question),
          requestId,
          signal,
        });
        return {
          status: 201,
          headers: { Location: `/api/v1/chat/messages/${result.message.id}` },
          body: { data: { message: messageDto(result.message), quota: quotaDto(result.quota) } },
        };
      },
    }),
    defineRoute({
      method: 'get',
      path: '/chat/messages',
      summary: "List the caller's messages, newest first",
      access: USERS,
      schemas: { query: paginationQuery },
      handler: async ({ actor, query }) => ({
        status: 200,
        body: pageBody(
          await uc.list.execute({ actor, page: { limit: query.limit, cursor: query.cursor } }),
          messageDto,
          query.limit,
        ),
      }),
    }),
    defineRoute({
      method: 'get',
      path: '/chat/messages/:id',
      summary: 'Read one message (owner or admin)',
      access: USERS,
      schemas: { params: uuidParam },
      handler: async ({ actor, params }) => ({
        status: 200,
        body: { data: messageDto(await uc.get.execute({ actor, id: params.id })) },
      }),
    }),
    defineRoute({
      method: 'get',
      path: '/chat/usage',
      summary: "The caller's quota for the current month",
      access: USERS,
      handler: async ({ actor }) => ({
        status: 200,
        body: { data: quotaDto(await uc.usage.execute(actor)) },
      }),
    }),
  ];
}
