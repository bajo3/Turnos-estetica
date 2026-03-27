import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getSettings,
  insertInteraction,
  insertWebhookEvent,
  listInteractions,
  listWebhookEvents,
  updateSettings
} from './db.js';
import {
  buildOwnerLink,
  sendBookingLink,
  sendListMenu,
  sendOwnerRedirect,
  sendText
} from './meta.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const frontendIndex = path.join(frontendDist, 'index.html');
const frontendAvailable =
  fs.existsSync(frontendIndex) && process.env.SERVE_FRONTEND !== 'false';

const app = express();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const VERIFY_TOKEN =
  process.env.WEBHOOK_VERIFY_TOKEN || 'change_me_verify_token';

app.set('trust proxy', 1);

const allowedOrigins =
  FRONTEND_ORIGIN === '*'
    ? '*'
    : FRONTEND_ORIGIN.split(',')
        .map((value) => value.trim())
        .filter(Boolean);

function bookingEnabled(settings) {
  return (
    settings?.booking?.mode === 'booking_link' &&
    Boolean(settings?.booking?.bookingPageUrl)
  );
}

function formatScheduleSummary(settings) {
  const schedule = settings?.schedule || [];
  const enabledDays = schedule.filter((day) => day.enabled);

  if (!enabledDays.length) {
    return 'Horarios no configurados todavía.';
  }

  return enabledDays
    .map((day) => `${day.label}: ${day.start} a ${day.end}`)
    .join(' · ');
}

function formatScheduleMessage(settings) {
  const summary = formatScheduleSummary(settings);
  const timezone = settings?.timezone ? ` (${settings.timezone})` : '';
  return `Horarios de atención${timezone}:\n${summary}`;
}

function buildConfigResponse() {
  const settings = getSettings();
  return {
    salonName: process.env.SALON_NAME || 'Emme Estetica',
    ownerDisplayName: process.env.OWNER_DISPLAY_NAME || 'Emme',
    ownerWhatsAppNumber: process.env.OWNER_WHATSAPP_NUMBER || '',
    ownerLink: buildOwnerLink('Hablar con Emme'),
    settings,
    scheduleSummary: formatScheduleSummary(settings),
    bookingEnabled: bookingEnabled(settings),
    bookingMode: settings.booking.mode,
    bookingPageUrl: settings.booking.bookingPageUrl || ''
  };
}

async function storeBotMessage({ to, customerName, selectedOption = null, ownerLink = null, result }) {
  if (!result) {
    return;
  }

  insertInteraction({
    customerWaId: to,
    customerName,
    messageType: result.messageType || 'text',
    selectedOption,
    ownerLink: ownerLink || result.ownerLink || null,
    messagePreview: result.preview || null,
    messageBody: result.bodyText || result.preview || null,
    wamid: result?.response?.messages?.[0]?.id || null,
    direction: 'outbound_bot',
    status: 'sent',
    meta: result.response || null
  });
}

async function sendAndStore({ to, customerName, selectedOption, ownerLink, action }) {
  const result = await action();
  await storeBotMessage({ to, customerName, selectedOption, ownerLink, result });
  return result;
}

app.use(
  cors({
    origin(origin, callback) {
      if (allowedOrigins === '*') {
        return callback(null, true);
      }

      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

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

app.get('/', (_req, res) => {
  if (frontendAvailable) {
    return res.sendFile(frontendIndex);
  }

  return res.json({
    ok: true,
    app: 'emme-estetica-backend',
    status: 'running',
    frontendServed: false,
    message:
      'Backend activo. El frontend está desplegado por separado o todavía no fue buildeado.'
  });
});

app.get('/health', (_req, res) => {
  const settings = getSettings();
  const missingEnv = ['WEBHOOK_VERIFY_TOKEN', 'OWNER_WHATSAPP_NUMBER'].filter(
    (key) => !process.env[key]
  );

  res.json({
    ok: true,
    app: 'emme-estetica-backend',
    frontendServed: frontendAvailable,
    missingEnv,
    bookingEnabled: bookingEnabled(settings),
    bookingMode: settings.booking.mode,
    uptimeSeconds: Math.round(process.uptime())
  });
});

app.get('/api/config', (_req, res) => {
  res.json(buildConfigResponse());
});

app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  try {
    const next = updateSettings(req.body || {});
    insertWebhookEvent('settings_updated', {
      source: 'dashboard',
      bookingMode: next.booking.mode,
      bookingPageConfigured: Boolean(next.booking.bookingPageUrl)
    });
    return res.json({ ok: true, settings: next, scheduleSummary: formatScheduleSummary(next) });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error.message || 'No se pudieron guardar los ajustes.'
    });
  }
});

app.get('/api/interactions', (req, res) => {
  const limit = Math.min(Number(req.query.limit || 400), 1000);
  res.json({ items: listInteractions(limit) });
});

app.get('/api/webhook-events', (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  res.json({ items: listWebhookEvents(limit) });
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  insertWebhookEvent('webhook_verification_rejected', {
    mode,
    tokenReceived: token ? '[present]' : '[missing]',
    challenge: challenge ? '[present]' : '[missing]'
  });

  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  insertWebhookEvent('raw_webhook', body);

  try {
    const changes = body?.entry?.flatMap((entry) => entry.changes || []) || [];

    for (const change of changes) {
      const settings = getSettings();
      const value = change.value || {};
      const contacts = value.contacts || [];
      const messages = value.messages || [];
      const statuses = value.statuses || [];
      const customerName = contacts[0]?.profile?.name || null;

      for (const status of statuses) {
        insertInteraction({
          customerWaId: status.recipient_id,
          customerName,
          messageType: 'status',
          selectedOption: null,
          ownerLink: null,
          messagePreview: `${status.status || 'unknown'} (${status.id || 'no-id'})`,
          wamid: status.id || null,
          direction: 'outbound_status',
          status: status.status || 'unknown',
          meta: status
        });
      }

      for (const message of messages) {
        const from = message.from;
        const wamid = message.id;
        const interactive = message.interactive;
        const textBody = message.text?.body?.trim();

        if (!from) {
          continue;
        }

        if (interactive?.type === 'list_reply') {
          const optionMap = {
            agendar_turno: 'Agendar turno',
            cambiar_turno: 'Cambiar turno',
            cancelar_turno: 'Cancelar turno',
            hablar_emme: 'Hablar con Emme',
            ver_horarios: 'Ver horarios'
          };

          const selectedOption =
            optionMap[interactive.list_reply?.id] ||
            interactive.list_reply?.title ||
            'Opción';

          const ownerLink = buildOwnerLink(selectedOption);

          insertInteraction({
            customerWaId: from,
            customerName,
            messageType: 'interactive_list_reply',
            selectedOption,
            ownerLink,
            messagePreview: interactive.list_reply?.title || selectedOption,
            wamid,
            direction: 'inbound',
            status: 'received',
            meta: interactive.list_reply || null
          });

          if (interactive.list_reply?.id === 'agendar_turno' && bookingEnabled(settings)) {
            await sendAndStore({
              to: from,
              customerName,
              selectedOption,
              action: () =>
                sendBookingLink(from, {
                  url: settings.booking.bookingPageUrl,
                  label: settings.booking.bookingPageLabel,
                  bodyText: `${settings.booking.bookingMessage}${
                    settings.bot.includeScheduleInReplies
                      ? `\n\n${formatScheduleMessage(settings)}`
                      : ''
                  }`
                })
            });
            continue;
          }

          if (interactive.list_reply?.id === 'ver_horarios') {
            await sendAndStore({
              to: from,
              customerName,
              selectedOption,
              action: () => sendText(from, formatScheduleMessage(settings))
            });
            continue;
          }

          await sendAndStore({
            to: from,
            customerName,
            selectedOption,
            ownerLink,
            action: () => sendOwnerRedirect(from, selectedOption)
          });
          continue;
        }

        const normalized = (textBody || '').toLowerCase();
        const asksForMenu =
          !normalized ||
          [
            'hola',
            'buenas',
            'menu',
            'menú',
            'info',
            'turno',
            'turnos',
            'opciones'
          ].includes(normalized);
        const asksForSchedule = ['horario', 'horarios', 'dias', 'días', 'disponibilidad'].includes(normalized);

        insertInteraction({
          customerWaId: from,
          customerName,
          messageType: message.type || 'text',
          selectedOption: null,
          ownerLink: null,
          messagePreview: textBody || `[${message.type || 'unknown'}]`,
          messageBody: textBody || `[${message.type || 'unknown'}]`,
          wamid,
          direction: 'inbound',
          status: 'received',
          meta: message
        });

        if (asksForSchedule) {
          await sendAndStore({
            to: from,
            customerName,
            action: () => sendText(from, formatScheduleMessage(settings))
          });
          await sendAndStore({
            to: from,
            customerName,
            action: () => sendListMenu(from, settings)
          });
          continue;
        }

        if (asksForMenu) {
          await sendAndStore({
            to: from,
            customerName,
            action: () => sendListMenu(from, settings)
          });
        } else {
          await sendAndStore({
            to: from,
            customerName,
            action: () =>
              sendText(
                from,
                'Gracias por escribir a Emme Estetica. Tocá el menú que te mandamos para agendar, cambiar, cancelar, ver horarios o hablar con Emme.'
              )
          });
          await sendAndStore({
            to: from,
            customerName,
            action: () => sendListMenu(from, settings)
          });
        }
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('Webhook processing error:', error);

    insertWebhookEvent('webhook_error', {
      message: error.message,
      stack: error.stack,
      rawBody: req.rawBody || null
    });

    return res.sendStatus(200);
  }
});

app.use((error, _req, res, next) => {
  if (!error) {
    return next();
  }

  console.error('Request error:', error);
  return res.status(500).json({
    ok: false,
    error: error.message || 'Unexpected server error'
  });
});

app.get('*', (req, res, next) => {
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/webhook') ||
    req.path === '/health'
  ) {
    return next();
  }

  if (frontendAvailable) {
    return res.sendFile(frontendIndex);
  }

  return res.status(404).json({
    ok: false,
    error: 'Route not found',
    path: req.path
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Emme Estetica backend listening on http://${HOST}:${PORT}`);
  console.log(`Frontend bundled in backend: ${frontendAvailable ? 'yes' : 'no'}`);
});
