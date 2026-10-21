import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { isProduction } from './config.js';

const SESSION_COOKIE = 'athena.sid';
const SESSION_HOURS = 8;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function cookieValue(header, name) {
  for (const part of (header || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(value.join('=')); } catch { return ''; }
    }
  }
  return '';
}

function setSessionCookie(res, value, maxAge) {
  const flags = [`${SESSION_COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isProduction) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again in 15 minutes.' } })
});

export function loginRoutes(app, database) {
  app.get('/api/auth/demo-mode', (_req, res) => {
    const enabled = !isProduction && process.env.SEED_DEMO_DATA !== 'false';
    return res.json({ enabled, email: enabled ? process.env.DEMO_EMAIL || 'owner@athena.id' : '', password: enabled ? process.env.DEMO_PASSWORD || 'athena-demo-2026' : '' });
  });
  app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 200) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email and password.' } });
      }

      const user = await database.get(
        `SELECT u.id, u.email, u.display_name, u.password_hash, m.organization_id, m.role, o.name AS organization_name
         FROM users u
         JOIN organization_memberships m ON m.user_id = u.id
         JOIN organizations o ON o.id = m.organization_id
         WHERE u.email = ? AND u.is_active = 1
         ORDER BY CASE m.role WHEN 'owner_admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, o.id LIMIT 1`,
        [email]
      );
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
      }

      const token = randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
      await database.run('DELETE FROM sessions WHERE expires_at <= ?', [new Date().toISOString()]);
      await database.run(
        'INSERT INTO sessions (token_hash, user_id, organization_id, expires_at) VALUES (?, ?, ?, ?)',
        [hashToken(token), user.id, user.organization_id, expires]
      );
      setSessionCookie(res, token, SESSION_HOURS * 60 * 60);
      return res.json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    organizationId: user.organization_id,
    organizationName: user.organization_name,
    demoMode: !isProduction && process.env.SEED_DEMO_DATA !== 'false'
  };
}

export function requireAuth(database) {
  return async (req, res, next) => {
    try {
      const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
      if (!token || token.length > 200) {
        return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });
      }
      const row = await database.get(
        `SELECT s.token_hash, s.expires_at, u.id AS user_id, u.email, u.display_name, u.is_active,
                m.organization_id, m.role, o.name AS organization_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN organization_memberships m ON m.user_id = u.id AND m.organization_id = s.organization_id
         JOIN organizations o ON o.id = m.organization_id
         WHERE s.token_hash = ?`,
        [hashToken(token)]
      );
      if (!row || !row.is_active || row.expires_at <= new Date().toISOString()) {
        if (row) await database.run('DELETE FROM sessions WHERE token_hash = ?', [row.token_hash]);
        setSessionCookie(res, '', 0);
        return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Your session has expired. Sign in again.' } });
      }
      req.sessionTokenHash = row.token_hash;
      req.user = {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        role: row.role,
        demoMode: !isProduction && process.env.SEED_DEMO_DATA !== 'false'
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' } });
    }
    return next();
  };
}

export function clearSessionCookie(res) {
  setSessionCookie(res, '', 0);
}
