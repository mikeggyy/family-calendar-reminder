const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

export function getGoogleConfig() {
  return {
    clientId: requiredEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    redirectUri: requiredEnv('GOOGLE_REDIRECT_URI'),
    calendarId: process.env.GOOGLE_CALENDAR_ID?.trim() || 'primary'
  };
}

export function buildGoogleOAuthUrl({ state }) {
  const { clientId, redirectUri } = getGoogleConfig();
  const scope = 'openid email profile https://www.googleapis.com/auth/calendar.events';
  const url = new URL(GOOGLE_AUTH_BASE);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return url.toString();
}

async function postForm(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error_description || data?.error || `HTTP ${response.status}`;
    throw new Error(`google_token_failed:${msg}`);
  }

  return data;
}

export async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();
  const data = await postForm(GOOGLE_TOKEN_URL, {
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
    tokenType: data.token_type || null,
    expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null,
    idToken: data.id_token || null
  };
}

export async function refreshGoogleAccessToken(refreshToken) {
  const { clientId, clientSecret } = getGoogleConfig();
  const data = await postForm(GOOGLE_TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token'
  });

  return {
    accessToken: data.access_token,
    scope: data.scope || null,
    tokenType: data.token_type || null,
    expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null
  };
}

function toGoogleEvent(event) {
  return {
    summary: event.title,
    description: event.source_text || '',
    start: {
      dateTime: event.starts_at,
      timeZone: event.timezone || 'Asia/Taipei'
    },
    end: {
      dateTime: new Date(new Date(event.starts_at).getTime() + 60 * 60 * 1000).toISOString(),
      timeZone: event.timezone || 'Asia/Taipei'
    }
  };
}

export async function upsertGoogleCalendarEvent({ accessToken, event }) {
  const { calendarId } = getGoogleConfig();
  const encodedCalendar = encodeURIComponent(calendarId);
  const hasGoogleEventId = !!event.google_event_id;

  const url = hasGoogleEventId
    ? `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodedCalendar}/events/${encodeURIComponent(event.google_event_id)}`
    : `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodedCalendar}/events`;

  const response = await fetch(url, {
    method: hasGoogleEventId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(toGoogleEvent(event))
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(`google_calendar_api_failed:${msg}`);
  }

  return data;
}
