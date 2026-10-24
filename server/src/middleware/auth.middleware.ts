import crypto from 'node:crypto';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError.js';

const AUTH_COOKIE = 'rc_token';
const CSRF_COOKIE = 'rc_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthConfig {
  jwtSecret: string;
  secureCookies: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function baseCookie(cfg: AuthConfig): CookieOptions {
  return { sameSite: 'lax', secure: cfg.secureCookies, path: '/' };
}

export function issueSession(res: Response, userId: string, cfg: AuthConfig) {
  const token = jwt.sign({ sub: userId }, cfg.jwtSecret, { expiresIn: '7d', algorithm: 'HS256' });
  res.cookie(AUTH_COOKIE, token, { ...baseCookie(cfg), httpOnly: true, maxAge: SESSION_MS });
  // Double-submit CSRF token: readable by our JS, echoed back in a header on state-changing requests.
  res.cookie(CSRF_COOKIE, crypto.randomBytes(24).toString('hex'), { ...baseCookie(cfg), httpOnly: false, maxAge: SESSION_MS });
}

export function clearSession(res: Response, cfg: AuthConfig) {
  res.clearCookie(AUTH_COOKIE, { ...baseCookie(cfg), httpOnly: true });
  res.clearCookie(CSRF_COOKIE, baseCookie(cfg));
}

export function requireAuth(cfg: AuthConfig): RequestHandler {
  return (req, _res, next) => {
    const token = req.cookies?.[AUTH_COOKIE];
    if (!token) return next(AppError.unauthorized());
    try {
      const payload = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('bad payload');
      req.userId = payload.sub;
      next();
    } catch {
      next(AppError.unauthorized('Your session has expired. Please log in again.'));
    }
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const requireCsrf: RequestHandler = (req: Request, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (
    typeof cookie !== 'string' ||
    typeof header !== 'string' ||
    cookie.length !== header.length ||
    !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))
  ) {
    return next(new AppError(403, 'CSRF_FAILED', 'Security check failed. Please refresh the page and try again.'));
  }
  next();
};

export function getUserId(req: Request): string {
  if (!req.userId) throw AppError.unauthorized();
  return req.userId;
}
