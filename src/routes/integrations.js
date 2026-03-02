import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { createId } from '../lib/id.js';
import {
  buildGoogleOAuthUrl,
  exchangeCodeForTokens,
  refreshGoogleAccessToken,
  upsertGoogleCalendarEvent
} from '../services/googleCalendar.js';

const OAUTH_STATE_TTL_SECONDS = 10 * 60;

function decodeJwtPayload(jwt) {
  if (!jwt) return null;
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function cleanupExpiredOauthStates() {
  db.prepare(`DELETE FROM oauth_states WHERE expires_at <= datetime('now')`).run();
}

function createOauthState({ userId }) {
  cleanupExpiredOauthStates();

  const state = randomUUID();
  db.prepare(
    `INSERT INTO oauth_states (state, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+' || ? || ' seconds'))`
  ).run(state, userId, OAUTH_STATE_TTL_SECONDS);

  return state;
}

function consumeOauthState(state) {
  cleanupExpiredOauthStates();

  const row = db
    .prepare(`SELECT state, user_id, expires_at FROM oauth_states WHERE state = ?`)
    .get(state);

  if (!row) return null;

  db.prepare(`DELETE FROM oauth_states WHERE state = ?`).run(state);

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return {
    state: row.state,
    userId: row.user_id
  };
}

function buildFrontendOAuthRedirectUrl({ status, message }) {
  const base = (process.env.FRONTEND_BASE_URL || 'http://localhost:5173').trim();
  const url = new URL(base);
  url.searchParams.set('oauth', status);
  if (message) url.searchParams.set('message', message);
  return url.toString();
}

function redirectOAuthResult(reply, { status, message }) {
  return reply.redirect(buildFrontendOAuthRedirectUrl({ status, message }));
}

function getGoogleIntegration(userId) {
  return db.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider = ?').get(userId, 'google');
}

function saveGoogleIntegration({ userId, tokens, accountEmail }) {
  const existing = getGoogleIntegration(userId);
  const metadata = existing?.metadata_json ? JSON.parse(existing.metadata_json) : {};
  if (accountEmail) metadata.accountEmail = accountEmail;

  if (existing) {
    db.prepare(
      `UPDATE integrations
       SET access_token = ?,
           refresh_token = COALESCE(?, refresh_token),
           expires_at = ?,
           scope = ?,
           metadata_json = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      tokens.accessToken || null,
      tokens.refreshToken || null,
      tokens.expiresAt || null,
      tokens.scope || null,
      JSON.stringify(metadata),
      existing.id
    );
    return existing.id;
  }

  const id = createId('itg');
  db.prepare(
    `INSERT INTO integrations (id, user_id, provider, access_token, refresh_token, expires_at, scope, metadata_json)
     VALUES (?, ?, 'google', ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    tokens.accessToken || null,
    tokens.refreshToken || null,
    tokens.expiresAt || null,
    tokens.scope || null,
    JSON.stringify(metadata)
  );

  return id;
}

function toConnectionStatus(integration) {
  const metadata = integration?.metadata_json ? JSON.parse(integration.metadata_json) : {};
  return {
    connected: !!integration,
    provider: 'google',
    accountEmail: metadata.accountEmail || null,
    expiresAt: integration?.expires_at || null,
    scope: integration?.scope || null
  };
}

async function getValidGoogleAccessToken(userId) {
  const integration = getGoogleIntegration(userId);
  if (!integration) {
    const err = new Error('google_not_connected');
    err.code = 'google_not_connected';
    throw err;
  }

  const isExpired = integration.expires_at && new Date(integration.expires_at).getTime() <= Date.now() + 30_000;
  if (!isExpired) return integration.access_token;

  if (!integration.refresh_token) {
    const err = new Error('google_refresh_token_missing');
    err.code = 'google_refresh_token_missing';
    throw err;
  }

  const refreshed = await refreshGoogleAccessToken(integration.refresh_token);
  db.prepare(
    `UPDATE integrations
     SET access_token = ?, expires_at = ?, scope = COALESCE(?, scope), updated_at = datetime('now')
     WHERE id = ?`
  ).run(refreshed.accessToken, refreshed.expiresAt || null, refreshed.scope || null, integration.id);

  return refreshed.accessToken;
}

async function syncSingleEvent({ userId, eventId }) {
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').get(eventId, userId);
  if (!event) {
    const err = new Error('event_not_found');
    err.code = 'event_not_found';
    throw err;
  }

  const accessToken = await getValidGoogleAccessToken(userId);
  const result = await upsertGoogleCalendarEvent({ accessToken, event });

  if (result?.id) {
    db.prepare('UPDATE events SET google_event_id = ? WHERE id = ?').run(result.id, event.id);
  }

  return {
    eventId: event.id,
    googleEventId: result?.id || event.google_event_id || null,
    status: 'synced'
  };
}

export async function tryAutoSyncEvent({ userId, eventId, logger }) {
  try {
    return await syncSingleEvent({ userId, eventId });
  } catch (error) {
    if (logger) {
      logger.info({ userId, eventId, errCode: error.code || 'sync_failed' }, 'Auto sync skipped or failed');
    }
    return null;
  }
}

export default async function integrationRoutes(fastify) {
  fastify.get('/api/integrations/google/oauth/start', async (req, reply) => {
    const { userId } = req.query || {};
    if (!userId) return reply.code(400).send({ error: 'userId is required' });

    const state = createOauthState({ userId });

    try {
      const authUrl = buildGoogleOAuthUrl({ state });
      return { authUrl };
    } catch (e) {
      if (String(e?.message || '').startsWith('missing_env:')) {
        return reply.code(500).send({
          error: 'google_oauth_not_configured',
          message: e.message
        });
      }
      throw e;
    }
  });

  fastify.get('/api/integrations/google/oauth/callback', async (req, reply) => {
    const { code, state, error } = req.query || {};
    if (error) {
      return redirectOAuthResult(reply, {
        status: 'error',
        message: `OAuth failed: ${String(error)}`
      });
    }

    if (!code || !state) {
      return redirectOAuthResult(reply, {
        status: 'error',
        message: 'code and state are required'
      });
    }

    const stateData = consumeOauthState(state);
    if (!stateData) {
      return redirectOAuthResult(reply, {
        status: 'error',
        message: 'invalid or expired oauth state'
      });
    }

    try {
      const tokens = await exchangeCodeForTokens(code);
      const idTokenPayload = decodeJwtPayload(tokens.idToken);
      saveGoogleIntegration({
        userId: stateData.userId,
        tokens,
        accountEmail: idTokenPayload?.email || null
      });

      return redirectOAuthResult(reply, {
        status: 'success',
        message: 'google_connected'
      });
    } catch (e) {
      return redirectOAuthResult(reply, {
        status: 'error',
        message: 'oauth_exchange_failed'
      });
    }
  });

  fastify.get('/api/integrations/google/status', async (req, reply) => {
    const { userId } = req.query || {};
    if (!userId) return reply.code(400).send({ error: 'userId is required' });

    const integration = getGoogleIntegration(userId);
    return toConnectionStatus(integration);
  });

  fastify.post('/api/integrations/google/sync/:eventId', async (req, reply) => {
    const { eventId } = req.params;
    const { userId } = req.body || {};
    if (!userId) return reply.code(400).send({ error: 'userId is required' });

    try {
      const result = await syncSingleEvent({ userId, eventId });
      return { result };
    } catch (e) {
      if (e.code === 'google_not_connected') {
        return reply.code(400).send({ error: 'not_connected', message: '尚未連線 Google Calendar。' });
      }
      if (e.code === 'google_refresh_token_missing') {
        return reply.code(400).send({ error: 'reauthorization_required', message: 'Google 授權已失效，請重新連線。' });
      }
      if (e.code === 'event_not_found') {
        return reply.code(404).send({ error: 'event_not_found', message: '找不到要同步的事件。' });
      }

      req.log.error({ err: e?.message }, 'Google sync failed');
      return reply.code(502).send({ error: 'sync_failed', message: '同步 Google Calendar 失敗，請稍後再試。' });
    }
  });

  fastify.post('/api/integrations/google/sync', async (req, reply) => {
    const { userId } = req.body || {};
    if (!userId) return reply.code(400).send({ error: 'userId is required' });

    const events = db.prepare('SELECT id FROM events WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
    if (!events.length) return { synced: 0, items: [] };

    const items = [];
    for (const row of events) {
      try {
        const result = await syncSingleEvent({ userId, eventId: row.id });
        items.push(result);
      } catch (e) {
        if (e.code === 'google_not_connected') {
          return reply.code(400).send({ error: 'not_connected', message: '尚未連線 Google Calendar。' });
        }
        if (e.code === 'google_refresh_token_missing') {
          return reply.code(400).send({ error: 'reauthorization_required', message: 'Google 授權已失效，請重新連線。' });
        }

        items.push({ eventId: row.id, status: 'failed', message: '同步失敗' });
      }
    }

    return { synced: items.filter((x) => x.status === 'synced').length, items };
  });
}
