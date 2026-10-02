import type { Request, RequestHandler } from 'express';
import { HttpError } from './problem.js';

function hasBody(req: Request): boolean {
  const length = req.get('content-length');
  return (length !== undefined && length !== '0') || req.get('transfer-encoding') !== undefined;
}

function isJson(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const [mime, ...params] = contentType.split(';').map((part) => part.trim().toLowerCase());
  return mime === 'application/json' && params.every((param) => param === '' || param === 'charset=utf-8');
}

/** URI length (414), strict JSON request bodies (415) and JSON-only responses (406). */
export function contentNegotiation(options: { maxUrlLength: number }): RequestHandler {
  return (req, _res, next) => {
    if (req.originalUrl.length > options.maxUrlLength) {
      next(new HttpError('URI_TOO_LONG', `The request URI exceeds ${options.maxUrlLength} characters.`));
      return;
    }
    if (hasBody(req) && !isJson(req.get('content-type'))) {
      next(new HttpError('UNSUPPORTED_MEDIA_TYPE', 'Request bodies must be application/json (UTF-8).'));
      return;
    }
    if (
      req.get('accept') !== undefined &&
      req.accepts(['application/json', 'application/problem+json']) === false
    ) {
      next(new HttpError('NOT_ACCEPTABLE', 'This API only produces application/json.'));
      return;
    }
    next();
  };
}
