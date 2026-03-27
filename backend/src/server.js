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
const GOOGLE_AUTH_START_PATH = '/auth/google';
const GOOGLE_AUTH_CALLBACK_PATH = '/auth/google/callback';

const allowedOrigins =
  FRONTEND_ORIGIN === '*'
    ? '*'
    : FRONTEND_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (allowedOrigins === '*') return callback(null, true);
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  })
);

app.use(
  express.json({
    limit: '2mb',
    verify(req, _res, buffer) {
      req.rawBody = buffer.toString('utf8');
    }
  })
);

if (frontendAvailable) {
  app.use(express.static(frontendDist));
}

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre'
];

function buildApiConfig() {
  const settings = getSettings();
  return {
    salonName: settings.salonName,
    ownerDisplayName: settings.ownerDisplayName,
    ownerWhatsAppNumber: settings.ownerWhatsAppNumber,
    bookingMode: settings.bookingMode,
    bookingLink: settings.bookingLink,
    ownerLink: settings.ownerWhatsAppNumber
      ? `https://wa.me/${String(settings.ownerWhatsAppNumber).replace(/\D/g, '')}`
      : '',
    instanceName: getInstanceName(),
    webhookUrl: APP_BASE_URL ? `${APP_BASE_URL}${EVOLUTION_WEBHOOK_PATH}` : '',
    googleRedirectUri: getGoogleRedirectUri(),
    evolutionConfigured: Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY),
    googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  };
}

function formatBusinessHours(hours) {
  const labels = {
    monday: 'Lunes',
    tuesday: 'Martes',
    wednesday: 'Miércoles',
    thursday: 'Jueves',
    friday: 'Viernes',
    saturday: 'Sábado',
    sunday: 'Domingo'
  };

  return Object.entries(hours)
    .map(([key, value]) => {
      if (!value?.enabled) return `${labels[key]}: cerrado`;
      const ranges = (value.ranges || []).map((range) => `${range.from} a ${range.to}`).join(' / ');
      return `${labels[key]}: ${ranges || 'cerrado'}`;
    })
    .join('\n');
}

function buildWelcomeMessage() {
  const settings = getSettings();
  const intro = `Hola, soy el asistente de ${settings.salonName}.`;
  const hours = formatBusinessHours(settings.businessHours);
  const booking = settings.bookingMode === 'booking_link' && settings.bookingLink
    ? `Podés reservar directo acá: ${settings.bookingLink}`
    : 'Si querés agendar o mover un turno, respondé a este mensaje y Emme te contesta manualmente.';

  return `${intro}\n\nHorarios:\n${hours}\n\n${booking}`;
}

function randomDelayMs(settings) {
  const min = Number(settings.minDelaySeconds || 0) * 1000;
  const max = Number(settings.maxDelaySeconds || 0) * 1000;
  if (max <= min) return Math.max(0, min);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
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
    const pieces = summary.split('-').map((item) => item.trim()).filter(Boolean);
    contactName = pieces.length > 1 ? pieces[pieces.length - 1] : pieces[0] || '';
  }

  return {
    contactName,
    contactPhone,
    notes: description || null
  };
}

function getEventDates(event) {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const startAt = event.start?.dateTime || `${event.start?.date}T09:00:00`;
  const endAt = event.end?.dateTime || `${event.end?.date}T10:00:00`;
  return {
    allDay,
    startAt,
    endAt,
    timezone: event.start?.timeZone || event.end?.timeZone || null
  };
}

async function getValidGoogleAccessToken() {
  const google = getGoogleState();
  if (!google.refreshToken) {
    throw new Error('Google Calendar no está conectado todavía.');
  }

  const expired = !google.expiryDate || new Date(google.expiryDate).getTime() <= Date.now() + 30_000;
  if (!google.accessToken || expired) {
    const refreshed = await refreshGoogleAccessToken(google.refreshToken);
    const normalized = normalizeGoogleTokens(refreshed, google.refreshToken);
    updateGoogleState({
      ...normalized,
      connected: true,
      connectedAt: google.connectedAt || new Date().toISOString(),
      lastError: null
    });
    return normalized.accessToken;
  }

  return google.accessToken;
}

async function syncGoogleCalendar({ reason = 'manual' } = {}) {
  const google = getGoogleState();
  if (!google.refreshToken) {
    throw new Error('Google Calendar no está conectado.');
  }

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
    const reminderSentAt = current?.reminder_sent_at || null;
    const reminderStatus = event.status === 'cancelled' ? 'cancelled' : current?.reminder_status || 'pending';
    const syncStatus = contact.contactPhone ? 'synced' : 'missing_phone';

    const row = upsertAppointment({
      googleEventId: event.id,
      summary: event.summary || '(Sin título)',
      description: event.description || '',
      status: event.status || 'confirmed',
      startAt,
      endAt,
      timezone,
      allDay,
      contactName: contact.contactName,
      contactPhone: contact.contactPhone,
      notes: contact.notes,
      htmlLink: event.htmlLink || null,
      rawEvent: event,
      syncStatus,
      syncError: contact.contactPhone ? null : 'No se encontró teléfono en título o descripción.'
    });

    if (current && (current.reminder_sent_at || current.reminder_status)) {
      markAppointmentReminder(row.id, {
        reminder_sent_at: reminderSentAt,
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

function formatReminderWhen(startAt) {
  const date = new Date(startAt);
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]} a las ${date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

async function processDueReminders({ reason = 'manual' } = {}) {
  const settings = getSettings();
  if (!settings.botEnabled) {
    return { processed: 0, skipped: 0, reason: 'bot_disabled' };
  }

  const appointments = listAppointments(500);
  const now = Date.now();
  let processed = 0;
  let skipped = 0;
  const dueMs = Number(settings.reminderHoursBefore || 24) * 60 * 60 * 1000;
  const today = new Date().toISOString().slice(0, 10);
  let sentToday = countOutboundRemindersForDate(today);

  for (const appointment of appointments) {
    if (appointment.status === 'cancelled') {
      markAppointmentReminder(appointment.id, { reminder_status: 'cancelled' });
      skipped += 1;
      continue;
    }

    if (appointment.reminder_sent_at) {
      skipped += 1;
      continue;
    }

    if (!appointment.contact_phone) {
      markAppointmentReminder(appointment.id, { reminder_status: 'missing_phone' });
      skipped += 1;
      continue;
    }

    if (settings.onlyExistingContacts && !findContactByWaId(appointment.contact_phone)) {
      markAppointmentReminder(appointment.id, { reminder_status: 'not_existing_contact' });
      skipped += 1;
      continue;
    }

    const startTime = new Date(appointment.start_at).getTime();
    if (Number.isNaN(startTime)) {
      markAppointmentReminder(appointment.id, { reminder_status: 'invalid_date' });
      skipped += 1;
      continue;
    }

    const targetTime = startTime - dueMs;
    if (now < targetTime || now > startTime) {
      skipped += 1;
      continue;
    }

    if (sentToday >= Number(settings.dailyReminderLimit || 0)) {
      markAppointmentReminder(appointment.id, { reminder_status: 'daily_limit_reached' });
      skipped += 1;
      continue;
    }

    const text = settings.reminderTemplate
      .replaceAll('{name}', appointment.contact_name || 'hola')
      .replaceAll('{salon}', settings.salonName)
      .replaceAll('{when}', formatReminderWhen(appointment.start_at));

    const delayMs = randomDelayMs(settings);
    const response = await sendTextMessage({
      number: appointment.contact_phone,
      text,
      delayMs
    });

    insertInteraction({
      customerWaId: appointment.contact_phone,
      customerName: appointment.contact_name,
      messageType: 'reminder',
      messagePreview: text,
      wamid: response?.key?.id || null,
      direction: 'outbound',
      status: response?.status || 'PENDING',
      appointmentId: appointment.id,
      rawPayload: response
    });

    upsertContact({
      waId: appointment.contact_phone,
      name: appointment.contact_name,
      lastMessageAt: new Date().toISOString(),
      lastMessagePreview: text,
      lastDirection: 'outbound'
    });

    markAppointmentReminder(appointment.id, {
      reminder_sent_at: new Date().toISOString(),
      reminder_status: 'sent'
    });

    sentToday += 1;
    processed += 1;
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
    console.error('Sync/process error:', error);
    insertWebhookEvent('google_sync_error', { reason, message: error.message });
  }
}

app.get('/', (_req, res) => {
  if (frontendAvailable) return res.sendFile(frontendIndex);
  return res.json({ ok: true, app: 'emme-estetica-backend', status: 'running', mode: 'evolution-qr-google-calendar' });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'emme-estetica-backend',
    frontendServed: frontendAvailable,
    evolutionConfigured: Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY),
    googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    instanceName: getInstanceName(),
    googleConnected: Boolean(getGoogleState().refreshToken),
    uptimeSeconds: Math.round(process.uptime())
  });
});

app.get('/api/config', (_req, res) => {
  res.json(buildApiConfig());
});

app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  const next = updateSettings(req.body || {});
  res.json({ ok: true, settings: next });
});

app.get('/api/interactions', (_req, res) => {
  res.json({ items: listInteractions(300) });
});

app.get('/api/webhook-events', (_req, res) => {
  res.json({ items: listWebhookEvents(150) });
});

app.get('/api/contacts', (_req, res) => {
  res.json({ items: listContacts(300) });
});

app.get('/api/appointments', (_req, res) => {
  res.json({ items: listAppointments(300) });
});

app.get('/api/evolution/status', (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY),
    instanceName: getInstanceName(),
    webhookUrl: APP_BASE_URL ? `${APP_BASE_URL}${EVOLUTION_WEBHOOK_PATH}` : '',
    connection: getConnection()
  });
});

app.post('/api/evolution/ensure-instance', async (_req, res, next) => {
  try {
    const webhookUrl = APP_BASE_URL ? `${APP_BASE_URL}${EVOLUTION_WEBHOOK_PATH}` : '';
    const data = await ensureInstance(webhookUrl);
    insertWebhookEvent('evolution_instance_prepare', data);
    res.json({ ok: true, data, webhookUrl });
  } catch (error) {
    next(error);
  }
});

app.get('/api/evolution/qr', async (_req, res, next) => {
  try {
    const data = await fetchQrCode();
    updateConnection({
      qrCode: data.code || data.base64 || null,
      pairingCode: data.pairingCode || null,
      status: 'awaiting_qr_scan',
      lastError: null
    });
    res.json({ ok: true, ...data, connection: getConnection() });
  } catch (error) {
    updateConnection({ lastError: error.message });
    next(error);
  }
});

app.get('/api/google/status', (_req, res) => {
  const google = getGoogleState();
  res.json({
    ok: true,
    configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    authUrl: `${APP_BASE_URL || ''}${GOOGLE_AUTH_START_PATH}`,
    callbackUrl: getGoogleRedirectUri(),
    state: google
  });
});

app.get(GOOGLE_AUTH_START_PATH, (req, res, next) => {
  try {
    const authUrl = getGoogleAuthUrl(String(req.query.state || 'panel'));
    res.redirect(authUrl);
  } catch (error) {
    next(error);
  }
});

app.get(GOOGLE_AUTH_CALLBACK_PATH, async (req, res, next) => {
  try {
    const code = String(req.query.code || '');
    if (!code) {
      throw new Error('Google no devolvió código de autorización.');
    }

    const tokenResponse = await exchangeCodeForTokens(code);
    const normalized = normalizeGoogleTokens(tokenResponse);
    updateGoogleState({
      ...normalized,
      connected: true,
      connectedAt: new Date().toISOString(),
      calendarId: getGoogleCalendarId(),
      lastError: null,
      lastSyncStatus: 'connected'
    });

    await syncGoogleCalendar({ reason: 'oauth_callback' });

    const target = allowedOrigins === '*' ? '' : allowedOrigins[0] || '';
    if (target) {
      return res.redirect(`${target}?google=connected`);
    }

    return res.send('Google Calendar conectado. Ya podés volver al panel.');
  } catch (error) {
    next(error);
  }
});

app.post('/api/google/sync', async (_req, res, next) => {
  try {
    const items = await syncGoogleCalendar({ reason: 'manual' });
    res.json({ ok: true, count: items.length, items });
  } catch (error) {
    next(error);
  }
});

app.post('/api/google/disconnect', (_req, res) => {
  const state = disconnectGoogle();
  res.json({ ok: true, state });
});

app.post('/api/reminders/run', async (_req, res, next) => {
  try {
    const result = await processDueReminders({ reason: 'manual' });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post('/api/reminders/send', async (req, res, next) => {
  try {
    const settings = getSettings();
    if (!settings.botEnabled) {
      return res.status(400).json({ ok: false, error: 'El bot está apagado. Encendelo para enviar recordatorios.' });
    }

    const waId = normalizePhone(req.body?.waId || '');
    const name = String(req.body?.name || '').trim();
    const when = String(req.body?.when || '').trim();
    const customText = String(req.body?.text || '').trim();

    if (!waId) {
      return res.status(400).json({ ok: false, error: 'Falta el WhatsApp del contacto.' });
    }

    const contact = findContactByWaId(waId);
    if (settings.onlyExistingContacts && !contact) {
      return res.status(400).json({ ok: false, error: 'Solo se permiten recordatorios a contactos que ya escribieron antes.' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const sentToday = countOutboundRemindersForDate(today);
    if (sentToday >= Number(settings.dailyReminderLimit || 0)) {
      return res.status(400).json({ ok: false, error: 'Se alcanzó el límite diario de recordatorios.' });
    }

    const text = customText || settings.reminderTemplate
      .replaceAll('{name}', name || contact?.name || 'hola')
      .replaceAll('{salon}', settings.salonName)
      .replaceAll('{when}', when || 'tu próximo turno');

    const delayMs = randomDelayMs(settings);
    const response = await sendTextMessage({ number: waId, text, delayMs });

    insertInteraction({
      customerWaId: waId,
      customerName: name || contact?.name || null,
      messageType: 'reminder',
      messagePreview: text,
      wamid: response?.key?.id || null,
      direction: 'outbound',
      status: response?.status || 'PENDING',
      rawPayload: response
    });

    upsertContact({
      waId,
      name: name || contact?.name || null,
      lastMessageAt: new Date().toISOString(),
      lastMessagePreview: text,
      lastDirection: 'outbound'
    });

    res.json({ ok: true, delayMs, response });
  } catch (error) {
    next(error);
  }
});

app.post(EVOLUTION_WEBHOOK_PATH, async (req, res) => {
  const eventName = String(req.body?.event || req.headers['x-evolution-event'] || 'unknown').toLowerCase();
  insertWebhookEvent(`evolution_${eventName}`, req.body);

  try {
    const payload = req.body?.data || req.body;

    if (eventName.includes('qrcode')) {
      updateConnection({
        status: 'awaiting_qr_scan',
        qrCode: payload?.qrcode?.base64 || payload?.base64 || payload?.code || null,
        pairingCode: payload?.pairingCode || null,
        lastError: null
      });
    }

    if (eventName.includes('connection')) {
      updateConnection({
        status: payload?.state || payload?.status || 'unknown',
        qrCode: null,
        pairingCode: null,
        lastError: null
      });
    }

    if (eventName.includes('messages_upsert') || eventName.includes('messages-upsert')) {
      const message = payload?.messages?.[0] || payload?.message || payload;
      const remoteJid = message?.key?.remoteJid || message?.key?.participant || message?.remoteJid || '';
      const fromMe = Boolean(message?.key?.fromMe || payload?.fromMe);
      const waId = String(remoteJid).split('@')[0].replace(/\D/g, '');
      const text =
        message?.message?.conversation ||
        message?.message?.extendedTextMessage?.text ||
        message?.message?.imageMessage?.caption ||
        message?.pushName ||
        '[mensaje sin texto]';
      const customerName = message?.pushName || payload?.pushName || null;

      if (waId) {
        upsertContact({
          waId,
          remoteJid,
          name: customerName,
          lastMessageAt: new Date().toISOString(),
          lastMessagePreview: text,
          lastDirection: fromMe ? 'outbound' : 'inbound'
        });
      }

      insertInteraction({
        customerWaId: waId,
        customerName,
        messageType: fromMe ? 'sent_text' : 'received_text',
        messagePreview: text,
        wamid: message?.key?.id || null,
        direction: fromMe ? 'outbound' : 'inbound',
        status: fromMe ? 'PENDING' : 'received',
        rawPayload: req.body
      });

      const settings = getSettings();
      const normalizedText = String(text || '').trim().toLowerCase();
      const isGreeting = ['hola', 'buenas', 'horario', 'horarios', 'turno', 'turnos', 'info'].includes(normalizedText);

      if (!fromMe && settings.botEnabled && settings.allowAutoReply && isGreeting && !settings.reminderOnlyMode && waId) {
        const reply = buildWelcomeMessage();
        const response = await sendTextMessage({ number: waId, text: reply, delayMs: randomDelayMs(settings) });
        insertInteraction({
          customerWaId: waId,
          customerName,
          messageType: 'auto_reply',
          messagePreview: reply,
          wamid: response?.key?.id || null,
          direction: 'outbound',
          status: response?.status || 'PENDING',
          rawPayload: response
        });
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('Evolution webhook processing error:', error);
    insertWebhookEvent('evolution_webhook_error', {
      message: error.message,
      stack: error.stack,
      rawBody: req.rawBody || null
    });
    return res.sendStatus(200);
  }
});

app.use((error, _req, res, next) => {
  if (!error) return next();
  console.error('Request error:', error);
  return res.status(500).json({ ok: false, error: error.message || 'Unexpected server error' });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path.startsWith('/auth') || req.path === '/health') {
    return next();
  }

  if (frontendAvailable) return res.sendFile(frontendIndex);
  return res.status(404).json({ ok: false, error: 'Route not found', path: req.path });
});

app.listen(PORT, HOST, () => {
  console.log(`Backend listening on http://${HOST}:${PORT}`);
  setTimeout(() => {
    syncAndProcess('startup');
  }, 2_000);
  setInterval(() => {
    syncAndProcess('interval');
  }, Math.max(1, Number(getSettings().syncEveryMinutes || 10)) * 60 * 1000);
});
