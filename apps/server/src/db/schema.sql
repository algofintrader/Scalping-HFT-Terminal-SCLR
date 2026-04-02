-- SCLR Database Schema
-- SQLite (bun:sqlite)

-- ============================================================
-- Users (для будущей авторизации)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  google_id TEXT UNIQUE,
  email_verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- ============================================================
-- User Settings (настройки авторизованных пользователей)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  instruments TEXT DEFAULT '[]',
  auto_scroll_enabled INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Guest Sessions (гостевые сессии)
-- ============================================================
CREATE TABLE IF NOT EXISTS guest_sessions (
  guest_id TEXT PRIMARY KEY,
  instruments TEXT DEFAULT '[]',
  auto_scroll_enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  migrated_to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_migrated ON guest_sessions(migrated_to_user_id);
