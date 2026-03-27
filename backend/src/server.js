import 'dotenv/config';
import express from 'express';
import cors from 'cors';
<<<<<<< HEAD
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
=======
>>>>>>> dd010e9 (fix server.js)
import {
  insertInteraction,
  insertWebhookEvent,
  listInteractions,
  listWebhookEvents
} from './db.js';
import { sendListMenu, sendOwnerRedirect, sendText, buildOwnerLink } from './meta.js';

<<<<<<< HEAD
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const frontendIndex = path.join(frontendDist, 'index.html');
const frontendAvailable = fs.existsSync(frontendIndex) && process.env.SERVE_FRONTEND !== 'false';

=======
>>>>>>> dd010e9 (fix server.js)
const app = express();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'change_me_verify_token';

app.set('trust proxy', 1);

<<<<<<< HEAD
const allowedOrigins = FRONTEND_ORIGIN === '*'
  ? '*'
  : FRONTEND_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (allowedOrigins === '*') {
      return callback(null, true);
    }

    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  }
}));

app.use(express.json({
  limit: '2mb',
  verify(req, _res, buffer) {
    req.rawBody = buffer.toString('utf8');
  }
}));

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
    message: 'Backend activo. El frontend está desplegado por separado o todavía no fue buildeado.'
=======
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    app: 'emme-estetica-backend',
    status: 'running'
>>>>>>> dd010e9 (fix server.js)
  });
});

app.get('/health', (_req, res) => {
  const missingEnv = ['WEBHOOK_VERIFY_TOKEN', 'OWNER_WHATSAPP_NUMBER'].filter((key) => !process.env[key]);

  res.json({
    ok: true,
    app: 'emme-estetica-backend',
    frontendServed: frontendAvailable,
    missingEnv,
    uptimeSeconds: Math.round(process.uptime())
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    salonName: process.env.SALON_NAME || 'Emme Estetica',
    ownerDisplayName: process.env.OWNER_DISPLAY_NAME || 'Emme',
    ownerWhatsAppNumber: process.env.OWNER_WHATSAPP_NUMBER || '',
    ownerLink: buildOwnerLink('Hablar con Emme')
  });
});

app.get('/api/interactions', (_req, res) => {
  res.json({ items: listInteractions(200) });
});

app.get('/api/webhook-events', (_req, res) => {
  res.json({ items: listWebhookEvents(100) });
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

<<<<<<< HEAD
  insertWebhookEvent('webhook_verification_rejected', {
    mode,
    tokenReceived: token ? '[present]' : '[missing]',
    challenge: challenge ? '[present]' : '[missing]'
  });

=======
>>>>>>> dd010e9 (fix server.js)
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  insertWebhookEvent('raw_webhook', body);

  try {
    const changes = body?.entry?.flatMap((entry) => entry.changes || []) || [];

    for (const change of changes) {
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
          status: status.status || 'unknown'
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
            hablar_emme: 'Hablar con Emme'
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
            status: 'received'
          });

          await sendOwnerRedirect(from, selectedOption);
          continue;
        }

        const normalized = (textBody || '').toLowerCase();
        const asksForMenu =
          !normalized ||
          ['hola', 'buenas', 'menu', 'menú', 'info', 'turno', 'turnos', 'opciones'].includes(normalized);

        insertInteraction({
          customerWaId: from,
          customerName,
          messageType: message.type || 'text',
          selectedOption: null,
          ownerLink: null,
          messagePreview: textBody || `[${message.type || 'unknown'}]`,
          wamid,
          direction: 'inbound',
          status: 'received'
        });

        if (asksForMenu) {
          await sendListMenu(from);
        } else {
          await sendText(
            from,
            'Gracias por escribir a Emme Estetica. Tocá el menú que te mandamos para agendar, cambiar, cancelar o hablar con Emme.'
          );
          await sendListMenu(from);
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

<<<<<<< HEAD
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
  if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path === '/health') {
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
=======
app.listen(PORT, () => {
  console.log(`Emme Estetica backend listening on port ${PORT}`);
});
>>>>>>> dd010e9 (fix server.js)
