import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { db } from '../db/client.js';
import { createId } from '../lib/id.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export function ensureUser(userId, timezone = 'Asia/Taipei') {
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!existing) {
    db.prepare('INSERT INTO users (id, timezone) VALUES (?, ?)').run(userId, timezone);
  }
}

export function createEventWithReminders({ userId, title, sourceText, startsAt, timezone, parseMethod }) {
  ensureUser(userId, timezone);

  const eventId = createId('evt');
  db.prepare(
    `INSERT INTO events (id, user_id, title, source_text, starts_at, timezone, parse_method)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(eventId, userId, title, sourceText, startsAt, timezone, parseMethod);

  const eventTime = dayjs(startsAt);
  const schedule = [eventTime.subtract(1, 'day'), eventTime.subtract(2, 'hour')];

  const insertReminder = db.prepare(
    `INSERT INTO reminders (id, event_id, user_id, remind_at, channel, status)
     VALUES (?, ?, ?, ?, 'in_app', 'pending')`
  );

  for (const at of schedule) {
    insertReminder.run(createId('rmd'), eventId, userId, at.toISOString());
  }

  return getEventDetail(eventId);
}

export function getEventDetail(eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  const reminders = db.prepare('SELECT * FROM reminders WHERE event_id = ? ORDER BY remind_at ASC').all(eventId);
  return { event, reminders };
}

export function listUserReminders(userId) {
  return db.prepare(
    `SELECT r.id AS reminder_id, r.remind_at, r.status, e.id AS event_id, e.title, e.starts_at
     FROM reminders r
     JOIN events e ON e.id = r.event_id
     WHERE r.user_id = ?
     ORDER BY r.remind_at ASC`
  ).all(userId);
}

export function deleteEventAndReminders(eventId, userId) {
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').get(eventId, userId);
  if (!event) return false;

  db.prepare('DELETE FROM reminders WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
  return true;
}

export function fetchDueReminders(nowIso = new Date().toISOString()) {
  return db.prepare(
    `SELECT r.*, e.title, e.starts_at
     FROM reminders r
     JOIN events e ON e.id = r.event_id
     WHERE r.status = 'pending' AND r.remind_at <= ?
     ORDER BY r.remind_at ASC`
  ).all(nowIso);
}

export function markReminderSent(reminderId) {
  db.prepare(`UPDATE reminders SET status = 'sent', sent_at = datetime('now') WHERE id = ?`).run(reminderId);
}
