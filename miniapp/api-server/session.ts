import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';

// Who is calling. The MVP identifies an anonymous browser session; an external
// provider (bank SSO, ЕСИА) can replace the resolver without changing the routers.
// A session never confirms a person's identity or authority over a company.
export type IdentityResolver = (req: Request) => string | null;

export const sessionHeader = 'X-Opora-Session';
// 32 random bytes from the browser, base64url without padding.
const sessionToken = /^[A-Za-z0-9_-]{43}$/;

// Only a digest is stored, so a database copy cannot be replayed as a session.
export const guestSession: IdentityResolver = (req) => {
  const token = req.header(sessionHeader) ?? '';
  return sessionToken.test(token) ? `session:${createHash('sha256').update(token).digest('hex')}` : null;
};

export function requireIdentity(resolve: IdentityResolver = guestSession): RequestHandler {
  return (req, res, next) => {
    const user = resolve(req);
    if (!user) { res.status(401).json({ error: 'Сессия не найдена. Обновите страницу.', code: 'SESSION_REQUIRED' }); return; }
    res.locals.user = user;
    next();
  };
}
