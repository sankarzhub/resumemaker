import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';

const passThrough: RequestHandler = (_req, _res, next) => next();

function limiter(enabled: boolean, limit: number, message: string): RequestHandler {
  if (!enabled) return passThrough;
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } });
    },
  });
}

export function createLimiters(enabled: boolean) {
  return {
    auth: limiter(enabled, 30, 'Too many login attempts. Please wait a few minutes.'),
    upload: limiter(enabled, 30, 'Too many uploads. Please wait a few minutes.'),
    ai: limiter(enabled, 30, 'Too many AI requests. Please wait a few minutes.'),
  };
}
