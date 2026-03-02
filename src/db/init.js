import 'dotenv/config';
import { db } from './client.js';

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_text TEXT,
      starts_at TEXT NOT NULL,
      timezone TEXT NOT NULL,
      parse_method TEXT NOT NULL,
      google_event_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'in_app',
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(event_id) REFERENCES events(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      expires_at TEXT,
      scope TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, provider),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_user_start ON events(user_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, remind_at);
  `);

  const columns = db.prepare(`PRAGMA table_info(integrations)`).all();
  const hasScope = columns.some((c) => c.name === 'scope');
  if (!hasScope) {
    db.exec(`ALTER TABLE integrations ADD COLUMN scope TEXT;`);
  }
}

initSchema();
console.log('Database schema initialized.');
