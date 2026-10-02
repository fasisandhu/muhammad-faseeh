import { pino, type DestinationStream, type Logger } from 'pino';
import { currentRequestContext } from './request-context.js';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.dpop',
  'req.headers.cookie',
  'req.headers["x-health-token"]',
  'res.headers["set-cookie"]',
];

export interface LoggerOptions {
  level: string;
  pretty: boolean;
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      base: { service: 'ggi-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      mixin() {
        const context = currentRequestContext();
        if (!context) return {};
        return context.userId
          ? { requestId: context.requestId, userId: context.userId }
          : { requestId: context.requestId };
      },
      ...(options.pretty && !options.destination ? { transport: { target: 'pino-pretty' } } : {}),
    },
    options.destination,
  );
}
