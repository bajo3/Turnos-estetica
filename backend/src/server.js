import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  insertInteraction,
  insertWebhookEvent,
  listInteractions,
  listWebhookEvents
} from './db.js';
import { sendListMenu, sendOwnerRedirect, sendText, buildOwnerLink } from './meta.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, '../../frontend/dist');

const app = express();
const PORT = process.env.PORT || 8080;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'change_me_verify_token';

app.use(cors({ origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN }));
app.use(express.json({ limit: '2mb' }));

app.use(express.static(frontendDist));

app.get('/health', (_req, res) => {
  res.json({ ok: true, app: 'emme-estetica-backend' });
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

        if (interactive?.type === 'list_reply') {
          const optionMap = {
            agendar_turno: 'Agendar turno',
            cambiar_turno: 'Cambiar turno',
            cancelar_turno: 'Cancelar turno',
            hablar_emme: 'Hablar con Emme'
          };
          const selectedOption = optionMap[interactive.list_reply?.id] || interactive.list_reply?.title || 'Opción';
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
      stack: error.stack
    });
    return res.sendStatus(200);
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path === '/health') {
    return next();
  }
  return res.sendFile(path.join(frontendDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Emme Estetica backend listening on port ${PORT}`);
});
