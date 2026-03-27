const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export function getGoogleRedirectUri() {
  if (env('GOOGLE_REDIRECT_URI')) return env('GOOGLE_REDIRECT_URI');
  const base = env('APP_BASE_URL').replace(/\/$/, '');
  return base ? `${base}/auth/google/callback` : '';
}

export function getGoogleCalendarId() {
  return env('GOOGLE_CALENDAR_ID', 'primary');
}

export function getGoogleAuthUrl(state = '') {
  const clientId = requiredEnv('GOOGLE_CLIENT_ID');
  const redirectUri = getGoogleRedirectUri();
  if (!redirectUri) throw new Error('Missing APP_BASE_URL or GOOGLE_REDIRECT_URI for Google OAuth');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: GOOGLE_SCOPE,
    state
  });

  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error?.message || data?.error || `Google request failed: ${response.status}`);
  }
  return data;
}

export async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    code,
    client_id: requiredEnv('GOOGLE_CLIENT_ID'),
    client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    redirect_uri: getGoogleRedirectUri(),
    grant_type: 'authorization_code'
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  return parseJsonResponse(response);
}

export async function refreshGoogleAccessToken(refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: requiredEnv('GOOGLE_CLIENT_ID'),
    client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    grant_type: 'refresh_token'
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  return parseJsonResponse(response);
}

export async function listCalendarEvents({ accessToken, calendarId, timeMin, timeMax, syncToken }) {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    showDeleted: 'true',
    maxResults: '250'
  });

  if (syncToken) {
    params.set('syncToken', syncToken);
  } else {
    params.set('timeMin', timeMin);
    params.set('timeMax', timeMax);
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  return parseJsonResponse(response);
}

export function normalizeGoogleTokens(tokenResponse, existingRefreshToken = '') {
  const expiresIn = Number(tokenResponse.expires_in || 3600);
  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token || existingRefreshToken || '',
    scope: tokenResponse.scope || GOOGLE_SCOPE,
    tokenType: tokenResponse.token_type || 'Bearer',
    expiryDate: new Date(Date.now() + Math.max(60, expiresIn - 30) * 1000).toISOString()
  };
}
