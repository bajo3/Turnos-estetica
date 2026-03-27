import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : path.resolve(__dirname, '../data');
const dbPath = path.join(dataDir, 'db.json');

const WEEK_SCHEDULE = [
  { key: 'monday', label: 'Lunes', enabled: true, start: '09:00', end: '18:00' },
  { key: 'tuesday', label: 'Martes', enabled: true, start: '09:00', end: '18:00' },
  { key: 'wednesday', label: 'Miércoles', enabled: true, start: '09:00', end: '18:00' },
  { key: 'thursday', label: 'Jueves', enabled: true, start: '09:00', end: '18:00' },
  { key: 'friday', label: 'Viernes', enabled: true, start: '09:00', end: '18:00' },
  { key: 'saturday', label: 'Sábado', enabled: true, start: '09:00', end: '13:00' },
  { key: 'sunday', label: 'Domingo', enabled: false, start: '09:00', end: '13:00' }
];

function defaultSettings() {
  return {
    timezone: 'America/Argentina/Buenos_Aires',
    schedule: WEEK_SCHEDULE,
    booking: {
      mode: 'owner_whatsapp',
      bookingPageUrl: '',
      bookingPageLabel: 'Reservar online',
      bookingMessage:
        'Si te queda cómodo, también podés reservar online desde este enlace.',
      notes: ''
    },
    bot: {
      includeScheduleInReplies: true
    }
  };
}

function defaultDb() {
  return {
    counters: { interaction: 0, webhookEvent: 0 },
    interactions: [],
    webhookEvents: [],
    settings: defaultSettings()
  };
}

fs.mkdirSync(dataDir, { recursive: true });

function normalizeSchedule(schedule) {
  return WEEK_SCHEDULE.map((day) => {
    const candidate = Array.isArray(schedule)
      ? schedule.find((item) => item?.key === day.key)
      : null;

    return {
      ...day,
      ...(candidate || {}),
      enabled: candidate?.enabled ?? day.enabled,
      start: candidate?.start || day.start,
      end: candidate?.end || day.end
    };
  });
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return target;
  }

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      target[key] = value;
      continue;
    }

    if (value && typeof value === 'object') {
      target[key] = deepMerge(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
      continue;
    }

    target[key] = value;
  }

  return target;
}

function sanitizeSettings(input) {
  const base = defaultSettings();
  const merged = deepMerge(structuredClone(base), input || {});
  merged.schedule = normalizeSchedule(merged.schedule);
  merged.booking.mode = ['owner_whatsapp', 'booking_link'].includes(merged.booking?.mode)
    ? merged.booking.mode
    : 'owner_whatsapp';
  merged.booking.bookingPageUrl = String(merged.booking?.bookingPageUrl || '').trim();
  merged.booking.bookingPageLabel = String(merged.booking?.bookingPageLabel || 'Reservar online').trim() || 'Reservar online';
  merged.booking.bookingMessage = String(merged.booking?.bookingMessage || base.booking.bookingMessage).trim() || base.booking.bookingMessage;
  merged.booking.notes = String(merged.booking?.notes || '').trim();
  merged.timezone = String(merged.timezone || base.timezone).trim() || base.timezone;
  merged.bot.includeScheduleInReplies = Boolean(merged.bot?.includeScheduleInReplies);
  return merged;
}

function ensureDb() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(defaultDb(), null, 2));
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch (_error) {
    data = defaultDb();
  }

  const migrated = {
    counters: {
      interaction: Number(data?.counters?.interaction || 0),
      webhookEvent: Number(data?.counters?.webhookEvent || 0)
    },
    interactions: Array.isArray(data?.interactions) ? data.interactions : [],
    webhookEvents: Array.isArray(data?.webhookEvents) ? data.webhookEvents : [],
    settings: sanitizeSettings(data?.settings)
  };

  fs.writeFileSync(dbPath, JSON.stringify(migrated, null, 2));
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
    message_body: data.messageBody ?? data.messagePreview ?? null,
    wamid: data.wamid ?? null,
    direction: data.direction,
    status: data.status ?? 'received',
    meta_json: data.meta ? JSON.stringify(data.meta, null, 2) : null,
    created_at: new Date().toISOString()
  };
  db.interactions.unshift(row);
  db.interactions = db.interactions.slice(0, 1500);
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

export function getSettings() {
  const db = readDb();
  return sanitizeSettings(db.settings);
}

export function updateSettings(patch) {
  const db = readDb();
  const next = sanitizeSettings(deepMerge(structuredClone(db.settings || defaultSettings()), patch || {}));
  db.settings = next;
  writeDb(db);
  return next;
}

export function getDbPath() {
  return dbPath;
}
