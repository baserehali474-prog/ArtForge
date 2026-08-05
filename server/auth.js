/* =========================================================================
   ArtForge v4.0 — Auth Utilities (Phase 1)
   Password hashing (scrypt) and signed session tokens (HMAC-SHA256),
   built entirely on Node's built-in crypto module — no external deps.
   ========================================================================= */
'use strict';

const crypto = require('node:crypto');

// In production this MUST come from an environment variable, never hardcoded.
const SECRET = process.env.ARTFORGE_SECRET || 'dev-only-secret-change-me';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  // constant-time comparison to avoid timing attacks
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  if (payload.exp && Date.now() > payload.exp) return null; // expired
  return payload;
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
