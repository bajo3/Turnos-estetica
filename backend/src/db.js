import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : path.resolve(__dirname, '../data');
const dbPath = path.join(dataDir, 'db.json');

fs.mkdirSync(dataDir, { recursive: true });

function ensureDb() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(
      dbPath,
      JSON.stringify({ counters: { interaction: 0, webhookEvent: 0 }, interactions: [], webhookEvents: [] }, null, 2)
    );
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function writeDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

export function insertWebhookEvent(eventType, payload) {
  const db = readDb();
  db.counters.webhookEvent += 1;
  db.webhookEvents.unshift({
    id: db.counters.webhookEvent,
    event_type: eventType,
    payload: JSON.stringify(payload, null, 2),
    created_at: new Date().toISOString()
  });
  db.webhookEvents = db.webhookEvents.slice(0, 500);
  writeDb(db);
}

export function insertInteraction(data) {
  const db = readDb();
  db.counters.interaction += 1;
  const row = {
    id: db.counters.interaction,
    customer_wa_id: data.customerWaId ?? null,
    customer_name: data.customerName ?? null,
    message_type: data.messageType,
    selected_option: data.selectedOption ?? null,
    owner_link: data.ownerLink ?? null,
    message_preview: data.messagePreview ?? null,
    wamid: data.wamid ?? null,
    direction: data.direction,
    status: data.status ?? 'received',
    created_at: new Date().toISOString()
  };
  db.interactions.unshift(row);
  db.interactions = db.interactions.slice(0, 1000);
  writeDb(db);
  return row.id;
}

export function listInteractions(limit = 100) {
  const db = readDb();
  return db.interactions.slice(0, limit);
}

export function listWebhookEvents(limit = 50) {
  const db = readDb();
  return db.webhookEvents.slice(0, limit);
}

export function getDbPath() {
  return dbPath;
}
