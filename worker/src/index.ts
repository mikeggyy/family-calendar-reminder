import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { parseNaturalTime } from './lib/timeParser';

export interface Env {
  DB: D1Database;
  DEFAULT_TIMEZONE?: string;
  FRONTEND_BASE_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_CALENDAR_ID?: string;
}

type ReminderRow = {
  id: string;
  event_id: string;
  user_id: string;
  remind_at: string;
  channel: string;
  status: string;
  sent_at: string | null;
  title: string;
  starts_at: string;
};

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true, runtime: 'cloudflare-worker' }));

app.post('/api/reminders', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { userId, title, text, timezone } = body as Record<string, string>;

  if (!userId || !title || !text) {
    return c.json({ error: 'userId, title, text are required' }, 400);
  }

  const tz = timezone || c.env.DEFAULT_TIMEZONE || 'Asia/Taipei';
  if (!isValidTimeZone(tz)) return c.json({ error: 'invalid_timezone' }, 400);

  const parsed = await parseNaturalTime(text, tz);
  if (!parsed) {
    return c.json({ error: 'time_parse_failed', message: 'Unable to parse time expression.' }, 422);
  }

  await c.env.DB.prepare('INSERT OR IGNORE INTO users (id, timezone) VALUES (?, ?)').bind(userId, tz).run();

  const eventId = createId('evt');
  await c.env.DB.prepare(
    `INSERT INTO events (id, user_id, title, source_text, starts_at, timezone, parse_method)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(eventId, userId, title, text, parsed.startsAt, tz, parsed.method)
    .run();

  const eventTime = new Date(parsed.startsAt).getTime();
  const now = Date.now() - 60_000;
  const schedule = [new Date(eventTime - 24 * 60 * 60 * 1000), new Date(eventTime)];

  for (const at of schedule) {
    if (at.getTime() > now) {
      await c.env.DB.prepare(
        `INSERT INTO reminders (id, event_id, user_id, remind_at, channel, status)
         VALUES (?, ?, ?, ?, 'in_app', 'pending')`
      )
        .bind(createId('rmd'), eventId, userId, at.toISOString())
        .run();
    }
  }

  const event = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first();
  const reminders = await c.env.DB.prepare('SELECT * FROM reminders WHERE event_id = ? ORDER BY remind_at ASC').bind(eventId).all();

  const sync = await tryAutoSyncEvent(c.env, userId, eventId);
  return c.json({ event, reminders: reminders.results || [], sync }, 201);
});

app.get('/api/reminders', async (c) => {
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId is required' }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT r.id AS reminder_id, r.remind_at, r.status, e.id AS event_id, e.title, e.starts_at
     FROM reminders r JOIN events e ON e.id = r.event_id
     WHERE r.user_id = ? ORDER BY r.remind_at ASC`
  )
    .bind(userId)
    .all();

  return c.json({ items: rows.results || [] });
});

app.delete('/api/reminders/:eventId', async (c) => {
  const eventId = c.req.param('eventId');
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId is required' }, 400);

  const event = await c.env.DB.prepare('SELECT id FROM events WHERE id = ? AND user_id = ?').bind(eventId, userId).first();
  if (!event) return c.json({ error: 'event not found' }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM reminders WHERE event_id = ?').bind(eventId),
    c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId)
  ]);

  return c.body(null, 204);
});

app.get('/api/integrations/google/oauth/start', async (c) => {
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId is required' }, 400);

  const state = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO oauth_states (state, user_id, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))`)
    .bind(state, userId)
    .run();

  try {
    const authUrl = buildGoogleOAuthUrl(c.env, state);
    return c.json({ authUrl });
  } catch (e) {
    return c.json({ error: 'google_oauth_not_configured', message: String((e as Error).message) }, 500);
  }
});

app.get('/api/integrations/google/oauth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const err = c.req.query('error');

  if (err) return c.redirect(buildFrontendOAuthRedirectUrl(c.env, 'error', `OAuth failed: ${err}`));
  if (!code || !state) return c.redirect(buildFrontendOAuthRedirectUrl(c.env, 'error', 'code and state are required'));

  const stateRow = await c.env.DB.prepare('SELECT state, user_id, expires_at FROM oauth_states WHERE state = ?').bind(state).first<any>();
  await c.env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  if (!stateRow) return c.redirect(buildFrontendOAuthRedirectUrl(c.env, 'error', 'invalid or expired oauth state'));

  try {
    const tokens = await exchangeCodeForTokens(c.env, code);
    const accountEmail = decodeJwtPayload(tokens.idToken)?.email || null;

    await c.env.DB.prepare(
      `INSERT INTO integrations (id, user_id, provider, access_token, refresh_token, expires_at, scope, metadata_json)
       VALUES (?, ?, 'google', ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         access_token=excluded.access_token,
         refresh_token=COALESCE(excluded.refresh_token, integrations.refresh_token),
         expires_at=excluded.expires_at,
         scope=excluded.scope,
         metadata_json=excluded.metadata_json,
         updated_at=datetime('now')`
    )
      .bind(createId('itg'), stateRow.user_id, tokens.accessToken, tokens.refreshToken, tokens.expiresAt, tokens.scope, JSON.stringify({ accountEmail }))
      .run();

    return c.redirect(buildFrontendOAuthRedirectUrl(c.env, 'success', 'google_connected'));
  } catch (e) {
    return c.redirect(buildFrontendOAuthRedirectUrl(c.env, 'error', buildOAuthExchangeErrorMessage(e)));
  }
});

app.get('/api/integrations/google/status', async (c) => {
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId is required' }, 400);

  const row = await c.env.DB.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider = ?').bind(userId, 'google').first<any>();
  const metadata = row?.metadata_json ? JSON.parse(row.metadata_json) : {};
  return c.json({
    connected: !!row,
    provider: 'google',
    accountEmail: metadata.accountEmail || null,
    expiresAt: row?.expires_at || null,
    scope: row?.scope || null
  });
});

app.post('/api/integrations/google/sync/:eventId', async (c) => {
  const userId = (await c.req.json().catch(() => ({})))?.userId;
  if (!userId) return c.json({ error: 'userId is required' }, 400);

  try {
    const result = await syncSingleEvent(c.env, userId, c.req.param('eventId'));
    return c.json({ result });
  } catch (e) {
    return mapGoogleSyncError(c, e);
  }
});

app.post('/api/integrations/google/sync', async (c) => {
  const userId = (await c.req.json().catch(() => ({})))?.userId;
  if (!userId) return c.json({ error: 'userId is required' }, 400);

  const events = await c.env.DB.prepare('SELECT id FROM events WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(userId).all();
  const items: any[] = [];
  for (const row of events.results || []) {
    try {
      items.push(await syncSingleEvent(c.env, userId, (row as any).id));
    } catch (e) {
      if ((e as any).code === 'google_not_connected' || (e as any).code === 'google_refresh_token_missing') {
        return mapGoogleSyncError(c, e);
      }
      items.push({ eventId: (row as any).id, status: 'failed', message: '同步失敗' });
    }
  }

  return c.json({ synced: items.filter((x) => x.status === 'synced').length, items });
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env) {
    const due = await env.DB.prepare(
      `SELECT r.*, e.title, e.starts_at
       FROM reminders r JOIN events e ON e.id = r.event_id
       WHERE r.status = 'pending' AND r.remind_at <= ?
       ORDER BY r.remind_at ASC`
    )
      .bind(new Date().toISOString())
      .all<ReminderRow>();

    for (const row of due.results || []) {
      console.log(`[cron] sending reminder ${row.id} event=${row.event_id} title=${row.title}`);
      await env.DB.prepare(`UPDATE reminders SET status='sent', sent_at=datetime('now') WHERE id = ?`).bind(row.id).run();
    }
  }
};

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function isValidTimeZone(tz: string) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function requiredEnv(env: Env, name: keyof Env) {
  const val = env[name];
  if (!val || !String(val).trim()) throw new Error(`missing_env:${String(name)}`);
  return String(val).trim();
}

function googleConfig(env: Env) {
  return {
    clientId: requiredEnv(env, 'GOOGLE_CLIENT_ID'),
    clientSecret: requiredEnv(env, 'GOOGLE_CLIENT_SECRET'),
    redirectUri: requiredEnv(env, 'GOOGLE_REDIRECT_URI'),
    calendarId: env.GOOGLE_CALENDAR_ID?.trim() || 'primary'
  };
}

function buildGoogleOAuthUrl(env: Env, state: string) {
  const { clientId, redirectUri } = googleConfig(env);
  const scope = 'openid email profile https://www.googleapis.com/auth/calendar.events';
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return url.toString();
}

function buildFrontendOAuthRedirectUrl(env: Env, status: string, message?: string) {
  const base = env.FRONTEND_BASE_URL?.trim() || 'http://localhost:8788';
  const url = new URL(base);
  url.searchParams.set('oauth', status);
  if (message) url.searchParams.set('message', message);
  return url.toString();
}

function buildOAuthExchangeErrorMessage(error: unknown) {
  const raw = String((error as Error)?.message || 'oauth_exchange_failed');
  const parsed = raw.startsWith('google_token_failed:') ? raw.slice('google_token_failed:'.length) : raw;
  const redacted = parsed
    .replace(/client_secret=[^\s&]+/gi, 'client_secret=[redacted]')
    .replace(/refresh_token=[^\s&]+/gi, 'refresh_token=[redacted]')
    .replace(/access_token=[^\s&]+/gi, 'access_token=[redacted]')
    .replace(/id_token=[^\s&]+/gi, 'id_token=[redacted]')
    .replace(/token=[^\s&]+/gi, 'token=[redacted]');
  const safe = redacted.replace(/[^a-zA-Z0-9._\- ]/g, '_').trim().slice(0, 120);
  return safe || 'oauth_exchange_failed';
}

async function postForm(url: string, payload: Record<string, string>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(payload)
  });
  const data = await response.json<any>().catch(() => ({}));
  if (!response.ok) throw new Error(`google_token_failed:${data?.error_description || data?.error || response.status}`);
  return data;
}

async function exchangeCodeForTokens(env: Env, code: string) {
  const { clientId, clientSecret, redirectUri } = googleConfig(env);
  const data = await postForm('https://oauth2.googleapis.com/token', {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    scope: data.scope || null,
    expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null,
    idToken: data.id_token || null
  };
}

async function refreshGoogleAccessToken(env: Env, refreshToken: string) {
  const { clientId, clientSecret } = googleConfig(env);
  const data = await postForm('https://oauth2.googleapis.com/token', {
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token'
  });
  return {
    accessToken: data.access_token,
    scope: data.scope || null,
    expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null
  };
}

function decodeJwtPayload(jwt?: string | null): any {
  if (!jwt) return null;
  try {
    const payload = jwt.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

async function getValidGoogleAccessToken(env: Env, userId: string) {
  const integration = await env.DB.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider = ?').bind(userId, 'google').first<any>();
  if (!integration) {
    const e: any = new Error('google_not_connected');
    e.code = 'google_not_connected';
    throw e;
  }

  const isExpired = integration.expires_at && new Date(integration.expires_at).getTime() <= Date.now() + 30_000;
  if (!isExpired) return integration.access_token;
  if (!integration.refresh_token) {
    const e: any = new Error('google_refresh_token_missing');
    e.code = 'google_refresh_token_missing';
    throw e;
  }

  const refreshed = await refreshGoogleAccessToken(env, integration.refresh_token);
  await env.DB.prepare('UPDATE integrations SET access_token = ?, expires_at = ?, scope = COALESCE(?, scope), updated_at=datetime(\'now\') WHERE id = ?')
    .bind(refreshed.accessToken, refreshed.expiresAt, refreshed.scope, integration.id)
    .run();
  return refreshed.accessToken;
}

function toGoogleEvent(event: any) {
  return {
    summary: event.title,
    description: event.source_text || '',
    start: { dateTime: event.starts_at, timeZone: event.timezone || 'Asia/Taipei' },
    end: { dateTime: new Date(new Date(event.starts_at).getTime() + 60 * 60 * 1000).toISOString(), timeZone: event.timezone || 'Asia/Taipei' }
  };
}

async function upsertGoogleCalendarEvent(env: Env, accessToken: string, event: any) {
  const { calendarId } = googleConfig(env);
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const url = event.google_event_id ? `${base}/${encodeURIComponent(event.google_event_id)}` : base;
  const response = await fetch(url, {
    method: event.google_event_id ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(toGoogleEvent(event))
  });
  const data = await response.json<any>().catch(() => ({}));
  if (!response.ok) throw new Error(`google_calendar_api_failed:${data?.error?.message || response.status}`);
  return data;
}

async function syncSingleEvent(env: Env, userId: string, eventId: string) {
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').bind(eventId, userId).first<any>();
  if (!event) {
    const e: any = new Error('event_not_found');
    e.code = 'event_not_found';
    throw e;
  }

  const accessToken = await getValidGoogleAccessToken(env, userId);
  const result = await upsertGoogleCalendarEvent(env, accessToken, event);
  if (result?.id) {
    await env.DB.prepare('UPDATE events SET google_event_id = ? WHERE id = ?').bind(result.id, event.id).run();
  }
  return { eventId: event.id, googleEventId: result?.id || event.google_event_id || null, status: 'synced' };
}

async function tryAutoSyncEvent(env: Env, userId: string, eventId: string) {
  try {
    return await syncSingleEvent(env, userId, eventId);
  } catch {
    return null;
  }
}

function mapGoogleSyncError(c: any, e: any) {
  if (e?.code === 'google_not_connected') return c.json({ error: 'not_connected', message: '尚未連線 Google Calendar。' }, 400);
  if (e?.code === 'google_refresh_token_missing') return c.json({ error: 'reauthorization_required', message: 'Google 授權已失效，請重新連線。' }, 400);
  if (e?.code === 'event_not_found') return c.json({ error: 'event_not_found', message: '找不到要同步的事件。' }, 404);
  return c.json({ error: 'sync_failed', message: '同步 Google Calendar 失敗，請稍後再試。' }, 502);
}
