/* =========================================================================
   ArtForge v4.0 — Database Layer (Phase 2: PostgreSQL)
   Uses PostgreSQL instead of node:sqlite so data survives restarts/redeploys
   on free hosting (e.g. Render's free web services have no persistent disk).
   Requires a DATABASE_URL environment variable (a Postgres connection string).
   ========================================================================= */
'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL is not set. Set it to your Postgres connection string.'); // eslint-disable-line no-console
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Most managed Postgres providers (Render, Railway, Supabase, etc.) require
  // SSL but present a certificate that Node won't validate by default.
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'client',
      created_at    TEXT NOT NULL,
      deleted_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      title        TEXT NOT NULL,
      service      TEXT NOT NULL,
      budget       TEXT,
      deadline     TEXT,
      priority     TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      progress     INTEGER NOT NULL DEFAULT 0,
      description  TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      deleted_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      order_id   TEXT REFERENCES orders(id),
      title      TEXT NOT NULL,
      body       TEXT,
      read       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id         TEXT PRIMARY KEY,
      user_id    TEXT,
      order_id   TEXT,
      action     TEXT NOT NULL,
      meta       TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id               TEXT PRIMARY KEY,
      order_id         TEXT NOT NULL REFERENCES orders(id),
      sender_id        TEXT NOT NULL REFERENCES users(id),
      sender_role      TEXT NOT NULL,
      text             TEXT,
      attachment_name  TEXT,
      attachment_type  TEXT,
      attachment_size  INTEGER,
      reply_to         TEXT,
      seen_by_client   INTEGER NOT NULL DEFAULT 0,
      seen_by_staff    INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_notif_user     ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id, created_at);

    ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES orders(id);
  `);
}

// Small helpers so server.js reads similarly to the old synchronous API.
async function get(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}
async function all(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}
async function run(sql, params = []) {
  await pool.query(sql, params);
}

module.exports = { pool, init, get, all, run };
