/* =========================================================================
   ArtForge v4.0 — API Server (Phase 2: PostgreSQL backend)
   Built on Node's http + node:crypto + the "pg" package for PostgreSQL.
   Run:  node server.js
   Env:  PORT (default 4000), ARTFORGE_SECRET (JWT signing secret),
         DATABASE_URL (Postgres connection string)
   ========================================================================= */
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const db = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth');

const PORT = process.env.PORT || 4000;

// ---- Mirrors the service/status catalog already used in the frontend
//      (js/modules/store.js) so backend and frontend stay in sync. ----
const SERVICES = ['poster', 'motion', 'reels', 'video', 'brand', 'other'];
const STATUS_KEYS = ['pending', 'in-progress', 'revision', 'completed', 'delivered', 'closed'];
const ROLES = ['client', 'designer', 'admin'];

// ---- Simple in-memory rate limiter (per IP) ----
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 100;
const rateBuckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  const fresh = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  fresh.push(now);
  rateBuckets.set(ip, fresh);
  return fresh.length > RATE_LIMIT_MAX;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}
function nowISO() {
  return new Date().toISOString();
}
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // ---- Security headers ----
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const MAX = 1024 * 1024; // 1MB cap against payload-flood
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

async function getAuthUser(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const row = await db.get('SELECT id, name, email, role FROM users WHERE id = $1 AND deleted_at IS NULL', [payload.sub]);
  return row || null;
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---- Basic input validation helpers ----
function validateRegisterInput({ name, email, password }) {
  const errors = [];
  if (!name || typeof name !== 'string' || name.trim().length < 2) errors.push('نام معتبر نیست');
  if (!isValidEmail(email)) errors.push('ایمیل معتبر نیست');
  if (!password || typeof password !== 'string' || password.length < 8) errors.push('رمز عبور باید حداقل ۸ کاراکتر باشد');
  return errors;
}

// =====================================================================
// Route handlers
// =====================================================================

async function handleRegister(req, res) {
  const body = await readBody(req);
  const errors = validateRegisterInput(body);
  if (errors.length) return sendJSON(res, 400, { error: 'validation_error', details: errors });

  const existing = await db.get('SELECT id FROM users WHERE email = $1', [body.email.toLowerCase()]);
  if (existing) return sendJSON(res, 409, { error: 'email_taken' });

  const { hash, salt } = hashPassword(body.password);
  const id = uid('usr');
  // Public self-registration is always a client account — staff accounts
  // (designer/admin) are created directly in the database, never through
  // this open endpoint, so a caller can never grant themselves elevated
  // access by passing a "role" field in the request body.
  const finalRole = 'client';
  await db.run(
    'INSERT INTO users (id, name, email, password_hash, password_salt, role, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, body.name.trim(), body.email.toLowerCase(), hash, salt, finalRole, nowISO()]
  );

  const token = signToken({ sub: id, role: finalRole });
  sendJSON(res, 201, { token, user: { id, name: body.name.trim(), email: body.email.toLowerCase(), role: finalRole } });
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  if (!isValidEmail(body.email) || !body.password) {
    return sendJSON(res, 400, { error: 'validation_error', details: ['ایمیل یا رمز عبور نامعتبر است'] });
  }
  const user = await db.get('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [body.email.toLowerCase()]);
  // Same generic error whether email or password is wrong — avoids user enumeration.
  if (!user || !verifyPassword(body.password, user.password_hash, user.password_salt)) {
    return sendJSON(res, 401, { error: 'invalid_credentials' });
  }
  const token = signToken({ sub: user.id, role: user.role });
  sendJSON(res, 200, { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}

function handleMe(req, res, user) {
  sendJSON(res, 200, { user });
}

async function handleListOrders(req, res, user, query) {
  let sql = 'SELECT * FROM orders WHERE deleted_at IS NULL';
  const params = [];
  if (user.role === 'client') {
    params.push(user.id);
    sql += ` AND user_id = $${params.length}`;
  }
  if (query.status && STATUS_KEYS.includes(query.status)) {
    params.push(query.status);
    sql += ` AND status = $${params.length}`;
  }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const rows = await db.all(sql, params);
  sendJSON(res, 200, { orders: rows });
}

async function handleCreateOrder(req, res, user) {
  const body = await readBody(req);
  const errors = [];
  if (!body.title || String(body.title).trim().length < 3) errors.push('عنوان سفارش نامعتبر است');
  if (!SERVICES.includes(body.service)) errors.push('نوع خدمت نامعتبر است');
  if (errors.length) return sendJSON(res, 400, { error: 'validation_error', details: errors });

  const id = uid('ord');
  const ts = nowISO();
  await db.run(
    `INSERT INTO orders (id,user_id,title,service,budget,deadline,priority,status,progress,description,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, user.id, String(body.title).trim(), body.service, body.budget || null, body.deadline || null,
     body.priority || null, 'pending', 0, body.description || null, ts, ts]
  );

  await db.run('INSERT INTO activity_log (id,user_id,order_id,action,meta,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [uid('log'), user.id, id, 'order_created', null, ts]);

  const order = await db.get('SELECT * FROM orders WHERE id = $1', [id]);
  sendJSON(res, 201, { order });
}

async function handleGetOrder(req, res, user, orderId) {
  const order = await db.get('SELECT * FROM orders WHERE id = $1 AND deleted_at IS NULL', [orderId]);
  if (!order) return sendJSON(res, 404, { error: 'not_found' });
  if (user.role === 'client' && order.user_id !== user.id) return sendJSON(res, 403, { error: 'forbidden' });
  sendJSON(res, 200, { order });
}

async function handleUpdateOrderStatus(req, res, user, orderId) {
  if (user.role === 'client') return sendJSON(res, 403, { error: 'forbidden' }); // only designer/admin change status
  const order = await db.get('SELECT * FROM orders WHERE id = $1 AND deleted_at IS NULL', [orderId]);
  if (!order) return sendJSON(res, 404, { error: 'not_found' });

  const body = await readBody(req);
  if (body.status && !STATUS_KEYS.includes(body.status)) {
    return sendJSON(res, 400, { error: 'validation_error', details: ['وضعیت نامعتبر است'] });
  }
  const status = body.status || order.status;
  const progress = Number.isFinite(body.progress) ? Math.max(0, Math.min(100, body.progress)) : order.progress;

  await db.run('UPDATE orders SET status = $1, progress = $2, updated_at = $3 WHERE id = $4',
    [status, progress, nowISO(), orderId]);

  await db.run('INSERT INTO notifications (id,user_id,title,body,read,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [uid('ntf'), order.user_id, 'به‌روزرسانی سفارش', `وضعیت سفارش «${order.title}» تغییر کرد.`, 0, nowISO()]);

  await db.run('INSERT INTO activity_log (id,user_id,order_id,action,meta,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [uid('log'), user.id, orderId, 'order_status_changed', JSON.stringify({ status, progress }), nowISO()]);

  const updated = await db.get('SELECT * FROM orders WHERE id = $1', [orderId]);
  sendJSON(res, 200, { order: updated });
}

function isStaff(user) {
  return user.role === 'admin' || user.role === 'designer';
}

async function handleListMessages(req, res, user, orderId) {
  const order = await db.get('SELECT * FROM orders WHERE id = $1 AND deleted_at IS NULL', [orderId]);
  if (!order) return sendJSON(res, 404, { error: 'not_found' });
  if (!isStaff(user) && order.user_id !== user.id) return sendJSON(res, 403, { error: 'forbidden' });
  const rows = await db.all('SELECT * FROM messages WHERE order_id = $1 ORDER BY created_at ASC LIMIT 500', [orderId]);
  sendJSON(res, 200, { messages: rows });
}

async function handleCreateMessage(req, res, user, orderId) {
  const order = await db.get('SELECT * FROM orders WHERE id = $1 AND deleted_at IS NULL', [orderId]);
  if (!order) return sendJSON(res, 404, { error: 'not_found' });
  if (!isStaff(user) && order.user_id !== user.id) return sendJSON(res, 403, { error: 'forbidden' });

  const body = await readBody(req);
  const text = (body.text || '').toString().trim();
  const attachment = body.attachment && body.attachment.name ? body.attachment : null;
  if (!text && !attachment) return sendJSON(res, 400, { error: 'validation_error', details: ['پیام خالی است'] });
  if (text.length > 4000) return sendJSON(res, 400, { error: 'validation_error', details: ['پیام خیلی طولانی است'] });

  if (attachment) {
    const attachmentSize = Number(attachment.size);
    if (!Number.isFinite(attachmentSize) || attachmentSize < 0 || attachmentSize > 25 * 1024 * 1024) {
      return sendJSON(res, 400, { error: 'validation_error', details: ['حجم فایل نامعتبر است یا بیشتر از ۲۵ مگابایت است'] });
    }
  }

  const id = uid('msg');
  const ts = nowISO();
  const senderRole = isStaff(user) ? 'designer' : 'client';
  await db.run(
    `INSERT INTO messages (id, order_id, sender_id, sender_role, text, attachment_name, attachment_type, attachment_size, reply_to, seen_by_client, seen_by_staff, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, orderId, user.id, senderRole, text || null,
     attachment ? String(attachment.name).slice(0, 255) : null,
     attachment ? String(attachment.type || '').slice(0, 100) : null,
     attachment ? (Number(attachment.size) || null) : null,
     body.replyTo || null,
     senderRole === 'client' ? 1 : 0, senderRole === 'designer' ? 1 : 0, ts]
  );

  // Real notifications:
  // - staff replies -> notify the client
  // - client sends -> notify every admin/designer account
  if (senderRole === 'designer') {
    await db.run(
      'INSERT INTO notifications (id,user_id,order_id,title,body,read,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        uid('ntf'),
        order.user_id,
        orderId,
        'پیام جدید از طراح',
        text ? text.slice(0, 120) : 'یک پیوست ارسال شد',
        0,
        ts
      ]
    );
  } else {
    const staffUsers = await db.all(
      "SELECT id FROM users WHERE role IN ('admin','designer') AND deleted_at IS NULL"
    );

    for (const staff of staffUsers) {
      await db.run(
        'INSERT INTO notifications (id,user_id,order_id,title,body,read,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          uid('ntf'),
          staff.id,
          orderId,
          'پیام جدید مشتری',
          text ? text.slice(0, 120) : 'مشتری یک پیوست ارسال کرد',
          0,
          ts
        ]
      );
    }
  }
  await db.run('INSERT INTO activity_log (id,user_id,order_id,action,meta,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [uid('log'), user.id, orderId, 'message_sent', null, ts]);

  const row = await db.get('SELECT * FROM messages WHERE id = $1', [id]);
  sendJSON(res, 201, { message: row });
}

async function handleMarkMessagesSeen(req, res, user, orderId) {
  const order = await db.get('SELECT * FROM orders WHERE id = $1 AND deleted_at IS NULL', [orderId]);
  if (!order) return sendJSON(res, 404, { error: 'not_found' });
  if (!isStaff(user) && order.user_id !== user.id) return sendJSON(res, 403, { error: 'forbidden' });
  const col = isStaff(user) ? 'seen_by_staff' : 'seen_by_client';
  await db.run(`UPDATE messages SET ${col} = 1 WHERE order_id = $1`, [orderId]);
  sendJSON(res, 200, { ok: true });
}

async function handleListNotifications(req, res, user) {
  const rows = await db.all('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [user.id]);
  sendJSON(res, 200, { notifications: rows });
}

function handleHealth(req, res) {
  sendJSON(res, 200, { status: 'ok', time: nowISO() });
}

// =====================================================================
// Router
// =====================================================================

const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return sendJSON(res, 429, { error: 'rate_limited' });

  // ---- CORS (allow the static frontend to call this API) ----
  res.setHeader('Access-Control-Allow-Origin', process.env.ARTFORGE_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const query = Object.fromEntries(url.searchParams.entries());

  try {
    if (path === '/api/health' && req.method === 'GET') return handleHealth(req, res);
    if (path === '/api/auth/register' && req.method === 'POST') return await handleRegister(req, res);
    if (path === '/api/auth/login' && req.method === 'POST') return await handleLogin(req, res);

    // ---- everything below requires a valid token ----
    const user = await getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'unauthorized' });

    if (path === '/api/auth/me' && req.method === 'GET') return handleMe(req, res, user);
    if (path === '/api/orders' && req.method === 'GET') return await handleListOrders(req, res, user, query);
    if (path === '/api/orders' && req.method === 'POST') return await handleCreateOrder(req, res, user);
    if (path === '/api/notifications' && req.method === 'GET') return await handleListNotifications(req, res, user);

    const msgListMatch = path.match(/^\/api\/orders\/([\w-]+)\/messages$/);
    if (msgListMatch && req.method === 'GET') return await handleListMessages(req, res, user, msgListMatch[1]);
    if (msgListMatch && req.method === 'POST') return await handleCreateMessage(req, res, user, msgListMatch[1]);

    const msgSeenMatch = path.match(/^\/api\/orders\/([\w-]+)\/messages\/seen$/);
    if (msgSeenMatch && req.method === 'PATCH') return await handleMarkMessagesSeen(req, res, user, msgSeenMatch[1]);

    const orderMatch = path.match(/^\/api\/orders\/([\w-]+)$/);
    if (orderMatch && req.method === 'GET') return await handleGetOrder(req, res, user, orderMatch[1]);
    if (orderMatch && req.method === 'PATCH') return await handleUpdateOrderStatus(req, res, user, orderMatch[1]);

    sendJSON(res, 404, { error: 'route_not_found' });
  } catch (err) {
    if (err.message === 'invalid_json') return sendJSON(res, 400, { error: 'invalid_json' });
    if (err.message === 'payload_too_large') return sendJSON(res, 413, { error: 'payload_too_large' });
    console.error(err); // eslint-disable-line no-console
    sendJSON(res, 500, { error: 'internal_error' });
  }
});

db.init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`ArtForge API listening on http://localhost:${PORT}`); // eslint-disable-line no-console
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err); // eslint-disable-line no-console
    process.exit(1);
  });

module.exports = server;
