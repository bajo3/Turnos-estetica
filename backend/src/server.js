import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countOutboundRemindersForDate,
  disconnectGoogle,
  findAppointmentByEventId,
  findContactByWaId,
  getConnection,
  getGoogleState,
  getSettings,
  insertInteraction,
  insertWebhookEvent,
  listAppointments,
  listContacts,
  listInteractions,
  listWebhookEvents,
  markAppointmentReminder,
  updateConnection,
  updateGoogleState,
  updateSettings,
  upsertAppointment,
  upsertContact
} from './db.js';
import { ensureInstance, fetchQrCode, getInstanceName, sendTextMessage } from './evolution.js';
import {
  exchangeCodeForTokens,
  getGoogleAuthUrl,
  getGoogleCalendarId,
  getGoogleRedirectUri,
  listCalendarEvents,
  normalizeGoogleTokens,
  refreshGoogleAccessToken
} from './googleCalendar.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const frontendIndex = path.join(frontendDist, 'index.html');
const frontendAvailable = fs.existsSync(frontendIndex) && process.env.SERVE_FRONTEND !== 'false';

const app = express();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
const EVOLUTION_WEBHOOK_PATH = '/webhook/evolution';

const allowedOrigins =
  FRONTEND_ORIGIN === '*'
    ? '*'
    : FRONTEND_ORIGIN.split(',').map((v) => v.trim()).filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (allowedOrigins === '*') return cb(null, true);
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS not allowed'));
  }
}));
app.use(express.json({ limit: '2mb' }));

if (frontendAvailable) {
  app.use(express.static(frontendDist));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function randomDelayMs(settings) {
  const min = Number(settings.minDelaySeconds || 0) * 1000;
  const max = Number(settings.maxDelaySeconds || 0) * 1000;
  if (max <= min) return Math.max(0, min);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatReminderWhen(startAt) {
  const date = new Date(startAt);
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]} a las ${date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

function parseContactFromEvent(event) {
  const summary = String(event.summary || '').trim();
  const description = String(event.description || '').trim();
  const sourceText = `${summary}\n${description}`;

  const phoneMatch = sourceText.match(/(?:\+?54\s?9?|\+)?\d[\d\s().-]{7,}\d/g);
  const contactPhone = phoneMatch ? normalizePhone(phoneMatch[0]) : '';

  let contactName = '';
  const explicitName = description.match(/(?:cliente|nombre)\s*[:\-]\s*(.+)/i);
  if (explicitName?.[1]) {
    contactName = explicitName[1].split('\n')[0].trim();
  } else if (summary) {
    const pieces = summary.split('-').map((s) => s.trim()).filter(Boolean);
    contactName = pieces.length > 1 ? pieces[pieces.length - 1] : pieces[0] || '';
  }

  return { contactName, contactPhone, notes: description || null };
}

function getEventDates(event) {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const startAt = event.start?.dateTime || `${event.start?.date}T09:00:00`;
  const endAt = event.end?.dateTime || `${event.end?.date}T10:00:00`;
  return { allDay, startAt, endAt, timezone: event.start?.timeZone || event.end?.timeZone || null };
}

// ─── Google Calendar ──────────────────────────────────────────────────────────

async function getValidGoogleAccessToken() {
  const google = getGoogleState();
  if (!google.refreshToken) throw new Error('Google Calendar no está conectado.');

  const expired = !google.expiryDate || new Date(google.expiryDate).getTime() <= Date.now() + 30_000;
  if (!google.accessToken || expired) {
    const refreshed = await refreshGoogleAccessToken(google.refreshToken);
    const normalized = normalizeGoogleTokens(refreshed, google.refreshToken);
    updateGoogleState({ ...normalized, connected: true, connectedAt: google.connectedAt || new Date().toISOString(), lastError: null });
    return normalized.accessToken;
  }
  return google.accessToken;
}

async function syncGoogleCalendar({ reason = 'manual' } = {}) {
  const google = getGoogleState();
  if (!google.refreshToken) throw new Error('Google Calendar no está conectado.');

  const accessToken = await getValidGoogleAccessToken();
  const now = new Date();
  const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString();

  let eventsPage;
  try {
    eventsPage = await listCalendarEvents({
      accessToken,
      calendarId: google.calendarId || getGoogleCalendarId(),
      timeMin,
      timeMax,
      syncToken: google.syncToken || undefined
    });
  } catch (error) {
    if (String(error.message).includes('410')) {
      eventsPage = await listCalendarEvents({
        accessToken,
        calendarId: google.calendarId || getGoogleCalendarId(),
        timeMin,
        timeMax
      });
      updateGoogleState({ syncToken: '' });
    } else {
      updateGoogleState({ lastSyncStatus: 'error', lastError: error.message, lastSyncAt: new Date().toISOString() });
      throw error;
    }
  }

  const synced = [];
  for (const event of eventsPage.items || []) {
    const { allDay, startAt, endAt, timezone } = getEventDates(event);
    const contact = parseContactFromEvent(event);
    const current = findAppointmentByEventId(event.id);
    const reminderStatus = event.status === 'cancelled' ? 'cancelled' : current?.reminder_status || 'pending';

    const row = upsertAppointment({
      googleEventId: event.id,
      summary: event.summary || '(Sin título)',
      description: event.description || '',
      status: event.status || 'confirmed',
      startAt, endAt, timezone, allDay,
      contactName: contact.contactName,
      contactPhone: contact.contactPhone,
      notes: contact.notes,
      htmlLink: event.htmlLink || null,
      rawEvent: event,
      syncStatus: contact.contactPhone ? 'synced' : 'missing_phone',
      syncError: contact.contactPhone ? null : 'Sin teléfono en título o descripción.'
    });

    if (current?.reminder_sent_at || current?.reminder_status) {
      markAppointmentReminder(row.id, {
        reminder_sent_at: current.reminder_sent_at || null,
        reminder_status: reminderStatus
      });
    } else if (!contact.contactPhone) {
      markAppointmentReminder(row.id, { reminder_status: 'missing_phone' });
    }

    synced.push(row);
  }

  updateGoogleState({
    connected: true,
    lastSyncAt: new Date().toISOString(),
    lastSyncStatus: 'ok',
    lastError: null,
    syncToken: eventsPage.nextSyncToken || google.syncToken || ''
  });
  insertWebhookEvent('google_calendar_sync', { reason, count: synced.length });
  return synced;
}

// ─── Reminders ────────────────────────────────────────────────────────────────

async function processDueReminders({ reason = 'manual' } = {}) {
  const settings = getSettings();
  if (!settings.botEnabled) return { processed: 0, skipped: 0, reason: 'bot_disabled' };

  const appointments = listAppointments(500);
  const now = Date.now();
  const dueMs = Number(settings.reminderHoursBefore || 24) * 60 * 60 * 1000;
  const today = new Date().toISOString().slice(0, 10);
  let sentToday = countOutboundRemindersForDate(today);
  let processed = 0;
  let skipped = 0;

  for (const appt of appointments) {
    if (appt.status === 'cancelled') {
      markAppointmentReminder(appt.id, { reminder_status: 'cancelled' });
      skipped++;
      continue;
    }
    if (appt.reminder_sent_at) { skipped++; continue; }
    if (!appt.contact_phone) {
      markAppointmentReminder(appt.id, { reminder_status: 'missing_phone' });
      skipped++;
      continue;
    }
    if (settings.onlyExistingContacts && !findContactByWaId(appt.contact_phone)) {
      markAppointmentReminder(appt.id, { reminder_status: 'not_existing_contact' });
      skipped++;
      continue;
    }

    const startTime = new Date(appt.start_at).getTime();
    if (Number.isNaN(startTime)) {
      markAppointmentReminder(appt.id, { reminder_status: 'invalid_date' });
      skipped++;
      continue;
    }

    const targetTime = startTime - dueMs;
    if (now < targetTime || now > startTime) { skipped++; continue; }

    if (sentToday >= Number(settings.dailyReminderLimit || 0)) {
      markAppointmentReminder(appt.id, { reminder_status: 'daily_limit_reached' });
      skipped++;
      continue;
    }

    const text = settings.reminderTemplate
      .replaceAll('{name}', appt.contact_name || 'hola')
      .replaceAll('{salon}', settings.salonName)
      .replaceAll('{when}', formatReminderWhen(appt.start_at));

    const delayMs = randomDelayMs(settings);
    const response = await sendTextMessage({ number: appt.contact_phone, text, delayMs });

    insertInteraction({
      customerWaId: appt.contact_phone,
      customerName: appt.contact_name,
      messageType: 'reminder',
      messagePreview: text,
      wamid: response?.key?.id || null,
      direction: 'outbound',
      status: response?.status || 'PENDING',
      appointmentId: appt.id,
      rawPayload: response
    });

    upsertContact({
      waId: appt.contact_phone,
      name: appt.contact_name,
      lastMessageAt: new Date().toISOString(),
      lastMessagePreview: text,
      lastDirection: 'outbound'
    });

    markAppointmentReminder(appt.id, {
      reminder_sent_at: new Date().toISOString(),
      reminder_status: 'sent'
    });

    sentToday++;
    processed++;
  }

  insertWebhookEvent('reminder_run', { reason, processed, skipped });
  return { processed, skipped, reason };
}

async function syncAndProcess(reason) {
  const google = getGoogleState();
  if (!google.refreshToken) return;
  try {
    await syncGoogleCalendar({ reason });
    await processDueReminders({ reason });
  } catch (error) {
    console.error('Sync/process error:', error.message);
    insertWebhookEvent('sync_error', { reason, message: error.message });
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.get('/api/config', (_req, res) => {
  const s = getSettings();
  res.json({
    salonName: s.salonName,
    ownerWhatsAppNumber: s.ownerWhatsAppNumber,
    ownerLink: s.ownerWhatsAppNumber ? `https://wa.me/${normalizePhone(s.ownerWhatsAppNumber)}` : ''
  });
});

app.get('/api/settings', (_req, res) => res.json(getSettings()));
app.put('/api/settings', (req, res) => {
  const updated = updateSettings(req.body);
  res.json({ ok: true, settings: updated });
});

app.get('/api/interactions', (_req, res) => res.json({ items: listInteractions(200) }));
app.get('/api/webhook-events', (_req, res) => res.json({ items: listWebhookEvents(100) }));
app.get('/api/contacts', (_req, res) => res.json({ items: listContacts(200) }));
app.get('/api/appointments', (_req, res) => res.json({ items: listAppointments(200) }));

// Evolution
app.get('/api/evolution/status', (_req, res) => {
  const conn = getConnection();
  res.json({
    instanceName: getInstanceName(),
    connection: conn,
    webhookUrl: APP_BASE_URL ? `${APP_BASE_URL}${EVOLUTION_WEBHOOK_PATH}` : null
  });
});

app.post('/api/evolution/ensure-instance', async (_req, res, next) => {
  try {
    const webhookUrl = APP_BASE_URL ? `${APP_BASE_URL}${EVOLUTION_WEBHOOK_PATH}` : '';
    const result = await ensureInstance(webhookUrl);
    res.json({ ok: true, webhookUrl, result });
  } catch (error) { next(error); }
});

app.get('/api/evolution/qr', async (_req, res, next) => {
  try {
    const data = await fetchQrCode();
    const qrCode = data?.base64 || data?.qrcode?.base64 || null;
    if (qrCode) updateConnection({ qrCode, status: 'awaiting_qr_scan', lastError: null });
    const conn = getConnection();
    res.json({ ok: true, qrCode: conn.qrCode || qrCode, status: conn.status });
  } catch (error) { next(error); }
});

// Google
app.get('/api/google/status', (_req, res) => {
  const state = getGoogleState();
  res.json({ state: { ...state, accessToken: undefined, refreshToken: undefined } });
});

app.get('/auth/google', (req, res, next) => {
  try { res.redirect(getGoogleAuthUrl(req.query.state || '')); }
  catch (error) { next(error); }
});

app.get('/auth/google/callback', async (req, res, next) => {
  try {
    const { code, error: oauthError } = req.query;
    if (oauthError) return res.redirect(`/?google=error&reason=${encodeURIComponent(oauthError)}`);
    if (!code) return res.redirect('/?google=error&reason=no_code');
    const tokenResponse = await exchangeCodeForTokens(String(code));
    const normalized = normalizeGoogleTokens(tokenResponse);
    updateGoogleState({
      ...normalized,
      connected: true,
      connectedAt: new Date().toISOString(),
      calendarId: getGoogleCalendarId(),
      lastSyncStatus: 'never',
      lastError: null,
      syncToken: ''
    });
    setTimeout(() => syncGoogleCalendar({ reason: 'oauth_connect' }).catch(console.error), 1000);
    return res.redirect('/?google=connected');
  } catch (error) { next(error); }
});

app.post('/api/google/sync', async (_req, res, next) => {
  try {
    const synced = await syncGoogleCalendar({ reason: 'manual' });
    res.json({ ok: true, count: synced.length });
  } catch (error) { next(error); }
});

app.post('/api/google/disconnect', (_req, res) => {
  disconnectGoogle();
  res.json({ ok: true });
});

// Reminders
app.post('/api/reminders/run', async (_req, res, next) => {
  try {
    const result = await processDueReminders({ reason: 'manual' });
    res.json({ ok: true, ...result });
  } catch (error) { next(error); }
});

app.post('/api/reminders/send', async (req, res, next) => {
  try {
    const { waId, name, when, text: customText } = req.body;
    if (!waId) return res.status(400).json({ error: 'waId requerido' });
    const settings = getSettings();
    const text = customText?.trim() ||
      settings.reminderTemplate
        .replaceAll('{name}', name || 'hola')
        .replaceAll('{salon}', settings.salonName)
        .replaceAll('{when}', when || 'tu turno');
    const delayMs = randomDelayMs(settings);
    const response = await sendTextMessage({ number: waId, text, delayMs });
    upsertContact({ waId, name, lastMessageAt: new Date().toISOString(), lastMessagePreview: text, lastDirection: 'outbound' });
    insertInteraction({
      customerWaId: waId, customerName: name,
      messageType: 'manual_reminder', messagePreview: text,
      wamid: response?.key?.id || null,
      direction: 'outbound', status: response?.status || 'PENDING',
      rawPayload: response
    });
    res.json({ ok: true, delayMs });
  } catch (error) { next(error); }
});

// ─── Evolution Webhook ────────────────────────────────────────────────────────

app.post(EVOLUTION_WEBHOOK_PATH, async (req, res) => {
  const eventName = String(req.body?.event || req.headers['x-evolution-event'] || 'unknown').toLowerCase();
  insertWebhookEvent(`evolution_${eventName}`, req.body);

  try {
    const payload = req.body?.data || req.body;

    if (eventName.includes('qrcode')) {
      const qrCode = payload?.qrcode?.base64 || payload?.base64 || payload?.code || null;
      updateConnection({ status: 'awaiting_qr_scan', qrCode, pairingCode: payload?.pairingCode || null, lastError: null });
    }

    if (eventName.includes('connection')) {
      const status = payload?.state || payload?.status || 'unknown';
      updateConnection({
        status,
        qrCode: status === 'open' ? null : undefined,
        lastError: null
      });
    }

    if (eventName.includes('messages_upsert') || eventName.includes('messages-upsert')) {
      const message = payload?.messages?.[0] || payload?.message || payload;
      const remoteJid = message?.key?.remoteJid || message?.remoteJid || '';
      const fromMe = Boolean(message?.key?.fromMe || payload?.fromMe);
      const waId = String(remoteJid).split('@')[0].replace(/\D/g, '');
      const text =
        message?.message?.conversation ||
        message?.message?.extendedTextMessage?.text ||
        message?.message?.imageMessage?.caption ||
        '[mensaje sin texto]';
      const customerName = message?.pushName || payload?.pushName || null;

      if (waId) {
        upsertContact({
          waId, remoteJid, name: customerName,
          lastMessageAt: new Date().toISOString(),
          lastMessagePreview: text,
          lastDirection: fromMe ? 'outbound' : 'inbound'
        });
        insertInteraction({
          customerWaId: waId, customerName,
          messageType: fromMe ? 'sent' : 'received',
          messagePreview: text,
          wamid: message?.key?.id || null,
          direction: fromMe ? 'outbound' : 'inbound',
          status: fromMe ? 'PENDING' : 'received',
          rawPayload: req.body
        });
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error.message);
    return res.sendStatus(200);
  }
});

app.use((error, _req, res, _next) => {
  console.error('Error:', error.message);
  res.status(500).json({ ok: false, error: error.message || 'Error inesperado' });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path.startsWith('/auth') || req.path === '/health') {
    return next();
  }
  if (frontendAvailable) return res.sendFile(frontendIndex);
  return res.status(404).json({ ok: false, error: 'Ruta no encontrada' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => {
  console.log(`Servidor en http://${HOST}:${PORT}`);
  setTimeout(() => syncAndProcess('startup'), 2_000);
  setInterval(() => syncAndProcess('interval'), Math.max(1, Number(getSettings().syncEveryMinutes || 10)) * 60 * 1000);
});
