import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : path.resolve(__dirname, '../data');
const dbPath = path.join(dataDir, 'db.json');

const DEFAULT_SETTINGS = {
  salonName: process.env.SALON_NAME || 'Emme Estetica',
  ownerDisplayName: process.env.OWNER_DISPLAY_NAME || 'Emme',
  ownerWhatsAppNumber: process.env.OWNER_WHATSAPP_NUMBER || '',
  botEnabled: false,
  reminderOnlyMode: true,
  allowAutoReply: false,
  onlyExistingContacts: true,
  dailyReminderLimit: 10,
  minDelaySeconds: 20,
  maxDelaySeconds: 60,
  reminderHoursBefore: 24,
  syncEveryMinutes: 10,
  reminderTemplate:
    'Hola {name}, te escribimos de {salon}. Te recordamos tu turno para {when}. Si necesitás cambiarlo, respondé a este mensaje.',
  bookingMode: 'owner_whatsapp',
  bookingLink: '',
  businessHours: {
    monday: { enabled: true, ranges: [{ from: '09:00', to: '18:00' }] },
    tuesday: { enabled: true, ranges: [{ from: '09:00', to: '18:00' }] },
    wednesday: { enabled: true, ranges: [{ from: '09:00', to: '18:00' }] },
    thursday: { enabled: true, ranges: [{ from: '09:00', to: '18:00' }] },
    friday: { enabled: true, ranges: [{ from: '09:00', to: '18:00' }] },
    saturday: { enabled: true, ranges: [{ from: '09:00', to: '13:00' }] },
    sunday: { enabled: false, ranges: [] }
  }
};

function getDefaultDb() {
  return {
    counters: { interaction: 0, webhookEvent: 0, contact: 0, appointment: 0 },
    interactions: [],
    webhookEvents: [],
    contacts: [],
    appointments: [],
    settings: DEFAULT_SETTINGS,
    connection: {
      status: 'disconnected',
      qrCode: null,
      pairingCode: null,
      updatedAt: null,
      instanceName: process.env.EVOLUTION_INSTANCE || 'emme-estetica',
      lastError: null
    },
    google: {
      connected: false,
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      accessToken: '',
      refreshToken: '',
      expiryDate: null,
      scope: '',
      tokenType: 'Bearer',
      syncToken: '',
      lastSyncAt: null,
      lastSyncStatus: 'never',
      lastError: null,
      connectedAt: null
    }
  };
}

fs.mkdirSync(dataDir, { recursive: true });

function ensureDb() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(getDefaultDb(), null, 2));
  }
}

function readDb() {
  ensureDb();
  const current = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  return {
    ...getDefaultDb(),
    ...current,
    counters: {
      ...getDefaultDb().counters,
      ...(current.counters || {})
    },
    settings: {
      ...DEFAULT_SETTINGS,
      ...(current.settings || {}),
      businessHours: {
        ...DEFAULT_SETTINGS.businessHours,
        ...(current.settings?.businessHours || {})
      }
    },
    connection: {
      ...getDefaultDb().connection,
      ...(current.connection || {})
    },
    google: {
      ...getDefaultDb().google,
      ...(current.google || {})
    }
  };
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
  db.webhookEvents = db.webhookEvents.slice(0, 700);
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
    appointment_id: data.appointmentId ?? null,
    raw_payload: data.rawPayload ? JSON.stringify(data.rawPayload, null, 2) : null,
    created_at: new Date().toISOString()
  };
  db.interactions.unshift(row);
  db.interactions = db.interactions.slice(0, 4000);
  writeDb(db);
  return row;
}

export function listInteractions(limit = 200) {
  return readDb().interactions.slice(0, limit);
}

export function listWebhookEvents(limit = 100) {
  return readDb().webhookEvents.slice(0, limit);
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

export function upsertContact(contact) {
  const db = readDb();
  const waId = normalizePhone(contact.waId || contact.remoteJid || contact.number);
  if (!waId) return null;

  const existing = db.contacts.find((item) => item.wa_id === waId);
  const now = new Date().toISOString();

  if (existing) {
    existing.name = contact.name || existing.name || null;
    existing.remote_jid = contact.remoteJid || existing.remote_jid || null;
    existing.last_message_at = contact.lastMessageAt || now;
    existing.last_message_preview = contact.lastMessagePreview || existing.last_message_preview || null;
    existing.last_direction = contact.lastDirection || existing.last_direction || null;
    existing.existing_contact = true;
    writeDb(db);
    return existing;
  }

  db.counters.contact += 1;
  const row = {
    id: db.counters.contact,
    wa_id: waId,
    remote_jid: contact.remoteJid || `${waId}@s.whatsapp.net`,
    name: contact.name || null,
    existing_contact: true,
    last_message_at: contact.lastMessageAt || now,
    last_message_preview: contact.lastMessagePreview || null,
    last_direction: contact.lastDirection || null,
    created_at: now
  };
  db.contacts.unshift(row);
  db.contacts = db.contacts.slice(0, 1000);
  writeDb(db);
  return row;
}

export function listContacts(limit = 200) {
  const db = readDb();
  return db.contacts
    .slice()
    .sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')))
    .slice(0, limit);
}

export function findContactByWaId(waId) {
  const normalized = normalizePhone(waId);
  return readDb().contacts.find((item) => item.wa_id === normalized) || null;
}

export function getSettings() {
  return readDb().settings;
}

export function updateSettings(patch) {
  const db = readDb();
  db.settings = {
    ...db.settings,
    ...patch,
    businessHours: {
      ...db.settings.businessHours,
      ...(patch.businessHours || {})
    }
  };
  writeDb(db);
  return db.settings;
}

export function getConnection() {
  return readDb().connection;
}

export function updateConnection(patch) {
  const db = readDb();
  db.connection = {
    ...db.connection,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  writeDb(db);
  return db.connection;
}

export function countOutboundRemindersForDate(isoDate) {
  return readDb().interactions.filter(
    (item) =>
      item.direction === 'outbound' &&
      item.message_type === 'reminder' &&
      String(item.created_at || '').startsWith(isoDate)
  ).length;
}

export function getGoogleState() {
  return readDb().google;
}

export function updateGoogleState(patch) {
  const db = readDb();
  db.google = {
    ...db.google,
    ...patch
  };
  writeDb(db);
  return db.google;
}

export function disconnectGoogle() {
  const db = readDb();
  db.google = {
    ...getDefaultDb().google,
    calendarId: db.google.calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary'
  };
  writeDb(db);
  return db.google;
}

export function listAppointments(limit = 200) {
  return readDb().appointments
    .slice()
    .sort((a, b) => String(a.start_at || '').localeCompare(String(b.start_at || '')))
    .slice(0, limit);
}

export function findAppointmentByEventId(eventId) {
  return readDb().appointments.find((item) => item.google_event_id === eventId) || null;
}

export function upsertAppointment(data) {
  const db = readDb();
  const existing = db.appointments.find((item) => item.google_event_id === data.googleEventId);
  const now = new Date().toISOString();

  if (existing) {
    Object.assign(existing, {
      summary: data.summary,
      description: data.description,
      status: data.status,
      start_at: data.startAt,
      end_at: data.endAt,
      timezone: data.timezone || existing.timezone || null,
      all_day: Boolean(data.allDay),
      source: data.source || 'google_calendar',
      contact_name: data.contactName || existing.contact_name || null,
      contact_phone: data.contactPhone || existing.contact_phone || null,
      notes: data.notes || existing.notes || null,
      html_link: data.htmlLink || existing.html_link || null,
      updated_at: now,
      raw_event: data.rawEvent ? JSON.stringify(data.rawEvent, null, 2) : existing.raw_event,
      sync_status: data.syncStatus || 'synced',
      sync_error: data.syncError || null
    });
    writeDb(db);
    return existing;
  }

  db.counters.appointment += 1;
  const row = {
    id: db.counters.appointment,
    google_event_id: data.googleEventId,
    source: data.source || 'google_calendar',
    summary: data.summary,
    description: data.description,
    status: data.status,
    start_at: data.startAt,
    end_at: data.endAt,
    timezone: data.timezone || null,
    all_day: Boolean(data.allDay),
    contact_name: data.contactName || null,
    contact_phone: data.contactPhone || null,
    notes: data.notes || null,
    html_link: data.htmlLink || null,
    reminder_sent_at: null,
    reminder_status: 'pending',
    sync_status: data.syncStatus || 'synced',
    sync_error: data.syncError || null,
    raw_event: data.rawEvent ? JSON.stringify(data.rawEvent, null, 2) : null,
    created_at: now,
    updated_at: now
  };
  db.appointments.push(row);
  writeDb(db);
  return row;
}

export function markAppointmentReminder(appointmentId, patch) {
  const db = readDb();
  const found = db.appointments.find((item) => item.id === appointmentId);
  if (!found) return null;
  Object.assign(found, patch, { updated_at: new Date().toISOString() });
  writeDb(db);
  return found;
}

export function getDbPath() {
  return dbPath;
}
