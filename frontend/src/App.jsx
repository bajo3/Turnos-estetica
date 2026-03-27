import { useEffect, useMemo, useState } from 'react';

const DAY_LABELS = {
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
  sunday: 'Domingo'
};

function resolveApiBase() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:8080';
    return origin;
  }
  return '';
}

const API_BASE = resolveApiBase();
const buildApiUrl = (path) => `${API_BASE}${path}`;

async function parseResponse(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text.slice(0, 250) || `Error HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(data?.error || data?.message || `Error HTTP ${response.status}`);
  return data;
}

function SectionCard({ title, subtitle, actions, children }) {
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="card-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Badge({ tone = 'default', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function TimelineItem({ item }) {
  return (
    <article className={`timeline-item ${item.direction || 'neutral'}`}>
      <div className="timeline-head">
        <strong>{item.customer_name || item.customer_wa_id || 'Sin nombre'}</strong>
        <span>{new Date(item.created_at).toLocaleString('es-AR')}</span>
      </div>
      <div className="timeline-meta">
        <Badge tone={item.direction === 'outbound' ? 'accent' : 'default'}>{item.direction}</Badge>
        <Badge tone="muted">{item.message_type}</Badge>
        <Badge tone="muted">{item.status}</Badge>
      </div>
      <p>{item.message_preview || '-'}</p>
    </article>
  );
}

function ContactRow({ contact, onSelect }) {
  return (
    <button className="contact-row" onClick={() => onSelect(contact)}>
      <div>
        <strong>{contact.name || 'Sin nombre'}</strong>
        <span>{contact.wa_id}</span>
      </div>
      <small>{contact.last_message_preview || 'Sin mensajes'}</small>
    </button>
  );
}

function AppointmentRow({ item }) {
  return (
    <tr>
      <td>{new Date(item.start_at).toLocaleString('es-AR')}</td>
      <td>{item.summary}</td>
      <td>{item.contact_name || '-'}</td>
      <td>{item.contact_phone || '-'}</td>
      <td><Badge tone={item.reminder_status === 'sent' ? 'accent' : item.reminder_status === 'missing_phone' ? 'danger' : 'muted'}>{item.reminder_status}</Badge></td>
      <td>{item.reminder_sent_at ? new Date(item.reminder_sent_at).toLocaleString('es-AR') : '-'}</td>
    </tr>
  );
}

function SettingsForm({ settings, onChange, onSave, saving }) {
  if (!settings) return null;

  return (
    <form className="settings-form" onSubmit={onSave}>
      <div className="form-grid">
        <label>
          <span>Nombre del salón</span>
          <input value={settings.salonName} onChange={(e) => onChange('salonName', e.target.value)} />
        </label>
        <label>
          <span>Atiende</span>
          <input value={settings.ownerDisplayName} onChange={(e) => onChange('ownerDisplayName', e.target.value)} />
        </label>
        <label>
          <span>WhatsApp del negocio</span>
          <input value={settings.ownerWhatsAppNumber} onChange={(e) => onChange('ownerWhatsAppNumber', e.target.value)} />
        </label>
        <label>
          <span>Límite diario</span>
          <input type="number" min="1" value={settings.dailyReminderLimit} onChange={(e) => onChange('dailyReminderLimit', Number(e.target.value))} />
        </label>
        <label>
          <span>Pausa mínima (seg)</span>
          <input type="number" min="0" value={settings.minDelaySeconds} onChange={(e) => onChange('minDelaySeconds', Number(e.target.value))} />
        </label>
        <label>
          <span>Pausa máxima (seg)</span>
          <input type="number" min="0" value={settings.maxDelaySeconds} onChange={(e) => onChange('maxDelaySeconds', Number(e.target.value))} />
        </label>
        <label>
          <span>Horas antes del recordatorio</span>
          <input type="number" min="1" max="72" value={settings.reminderHoursBefore} onChange={(e) => onChange('reminderHoursBefore', Number(e.target.value))} />
        </label>
        <label>
          <span>Sincronizar cada (min)</span>
          <input type="number" min="1" max="60" value={settings.syncEveryMinutes} onChange={(e) => onChange('syncEveryMinutes', Number(e.target.value))} />
        </label>
        <label>
          <span>Modo de agenda</span>
          <select value={settings.bookingMode} onChange={(e) => onChange('bookingMode', e.target.value)}>
            <option value="owner_whatsapp">Derivar al WhatsApp</option>
            <option value="booking_link">Mandar link externo</option>
          </select>
        </label>
        <label>
          <span>Link de agenda</span>
          <input value={settings.bookingLink || ''} onChange={(e) => onChange('bookingLink', e.target.value)} placeholder="https://calendar.google.com/..." />
        </label>
      </div>

      <div className="toggle-grid">
        <label><input type="checkbox" checked={settings.botEnabled} onChange={(e) => onChange('botEnabled', e.target.checked)} /> Bot encendido</label>
        <label><input type="checkbox" checked={settings.reminderOnlyMode} onChange={(e) => onChange('reminderOnlyMode', e.target.checked)} /> Solo recordatorios</label>
        <label><input type="checkbox" checked={settings.onlyExistingContacts} onChange={(e) => onChange('onlyExistingContacts', e.target.checked)} /> Solo contactos existentes</label>
        <label><input type="checkbox" checked={settings.allowAutoReply} onChange={(e) => onChange('allowAutoReply', e.target.checked)} /> Permitir auto respuesta simple</label>
      </div>

      <label className="full-width">
        <span>Plantilla de recordatorio</span>
        <textarea rows="4" value={settings.reminderTemplate} onChange={(e) => onChange('reminderTemplate', e.target.value)} />
      </label>

      <div className="hours-grid">
        {Object.entries(settings.businessHours || {}).map(([key, value]) => (
          <div key={key} className="hours-card">
            <label><input type="checkbox" checked={Boolean(value.enabled)} onChange={(e) => onChange(`businessHours.${key}.enabled`, e.target.checked)} /> {DAY_LABELS[key]}</label>
            {(value.ranges || [{ from: '', to: '' }]).map((range, index) => (
              <div key={index} className="hours-range">
                <input type="time" value={range.from} onChange={(e) => onChange(`businessHours.${key}.ranges.${index}.from`, e.target.value)} />
                <input type="time" value={range.to} onChange={(e) => onChange(`businessHours.${key}.ranges.${index}.to`, e.target.value)} />
              </div>
            ))}
          </div>
        ))}
      </div>

      <button className="primary-button" disabled={saving}>{saving ? 'Guardando...' : 'Guardar configuración'}</button>
    </form>
  );
}

function updateNested(obj, path, value) {
  const parts = path.split('.');
  const clone = structuredClone(obj);
  let current = clone;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    current = current[part];
  }
  const last = /^\d+$/.test(parts[parts.length - 1]) ? Number(parts[parts.length - 1]) : parts[parts.length - 1];
  current[last] = value;
  return clone;
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [settings, setSettings] = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [events, setEvents] = useState([]);
  const [evolutionStatus, setEvolutionStatus] = useState(null);
  const [googleStatus, setGoogleStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [selectedContact, setSelectedContact] = useState(null);
  const [reminderWhen, setReminderWhen] = useState('mañana');
  const [customText, setCustomText] = useState('');

  async function loadAll() {
    const [configJson, settingsJson, interactionsJson, contactsJson, eventsJson, statusJson, googleJson, appointmentsJson] = await Promise.all([
      fetch(buildApiUrl('/api/config')).then(parseResponse),
      fetch(buildApiUrl('/api/settings')).then(parseResponse),
      fetch(buildApiUrl('/api/interactions')).then(parseResponse),
      fetch(buildApiUrl('/api/contacts')).then(parseResponse),
      fetch(buildApiUrl('/api/webhook-events')).then(parseResponse),
      fetch(buildApiUrl('/api/evolution/status')).then(parseResponse),
      fetch(buildApiUrl('/api/google/status')).then(parseResponse),
      fetch(buildApiUrl('/api/appointments')).then(parseResponse)
    ]);

    setConfig(configJson);
    setSettings(settingsJson);
    setInteractions(interactionsJson.items || []);
    setContacts(contactsJson.items || []);
    setEvents(eventsJson.items || []);
    setEvolutionStatus(statusJson);
    setGoogleStatus(googleJson);
    setAppointments(appointmentsJson.items || []);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        await loadAll();
        if (!active) return;
        setError('');
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          if (params.get('google') === 'connected') {
            setActionMessage('Google Calendar conectado.');
            window.history.replaceState({}, '', window.location.pathname);
          }
        }
      } catch (err) {
        if (active) setError(err.message || 'No se pudo cargar el panel');
      } finally {
        if (active) setLoading(false);
      }
    })();
    const timer = setInterval(() => active && loadAll().catch(() => {}), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const totals = useMemo(() => ({
    inbound: interactions.filter((item) => item.direction === 'inbound').length,
    outbound: interactions.filter((item) => item.direction === 'outbound').length,
    contacts: contacts.length,
    upcoming: appointments.filter((item) => new Date(item.start_at).getTime() > Date.now()).length
  }), [appointments, contacts.length, interactions]);

  async function saveSettings(event) {
    event.preventDefault();
    try {
      setSaving(true);
      const json = await fetch(buildApiUrl('/api/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      }).then(parseResponse);
      setSettings(json.settings);
      setActionMessage('Configuración guardada.');
    } catch (err) {
      setError(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function postAndReload(path, successMessage) {
    try {
      const json = await fetch(buildApiUrl(path), { method: 'POST' }).then(parseResponse);
      setActionMessage(successMessage || 'Acción ejecutada.');
      await loadAll();
      return json;
    } catch (err) {
      setError(err.message || 'No se pudo ejecutar la acción');
      throw err;
    }
  }

  async function prepareInstance() {
    const json = await postAndReload('/api/evolution/ensure-instance', 'Instancia preparada.');
    setActionMessage(`Instancia preparada. Webhook: ${json.webhookUrl || 'revisar APP_BASE_URL'}`);
  }

  async function loadQr() {
    await postAndReload('/api/evolution/qr', 'QR actualizado.');
  }

  async function runSync() {
    const json = await postAndReload('/api/google/sync', 'Agenda sincronizada.');
    setActionMessage(`Agenda sincronizada. Eventos actualizados: ${json.count}`);
  }

  async function runReminders() {
    const json = await postAndReload('/api/reminders/run', 'Cola de recordatorios procesada.');
    setActionMessage(`Recordatorios enviados: ${json.processed}. Saltados: ${json.skipped}.`);
  }

  async function disconnectGoogle() {
    await postAndReload('/api/google/disconnect', 'Google Calendar desconectado.');
  }

  async function sendManualReminder(event) {
    event.preventDefault();
    if (!selectedContact) return;
    try {
      const json = await fetch(buildApiUrl('/api/reminders/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waId: selectedContact.wa_id,
          name: selectedContact.name,
          when: reminderWhen,
          text: customText
        })
      }).then(parseResponse);

      setActionMessage(`Recordatorio enviado con delay de ${Math.round((json.delayMs || 0) / 1000)} segundos.`);
      setCustomText('');
      await loadAll();
    } catch (err) {
      setError(err.message || 'No se pudo enviar el recordatorio');
    }
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <span className="eyebrow">Evolution QR + Google Calendar</span>
          <h1>{config?.salonName || 'Emme Estetica'}</h1>
          <p>
            Panel para conectar QR, sincronizar Google Calendar y mandar recordatorios
            solo a clientas existentes con pausas y límites diarios.
          </p>
        </div>
        <a className="primary-link" href={config?.ownerLink || '#'} target="_blank" rel="noreferrer">
          Abrir WhatsApp
        </a>
      </header>

      <section className="stats-grid">
        <article className="stat-card"><span>Entrantes</span><strong>{totals.inbound}</strong></article>
        <article className="stat-card"><span>Salientes</span><strong>{totals.outbound}</strong></article>
        <article className="stat-card"><span>Contactos</span><strong>{totals.contacts}</strong></article>
        <article className="stat-card"><span>Próximos turnos</span><strong>{totals.upcoming}</strong></article>
      </section>

      {loading ? <p className="info">Cargando panel...</p> : null}
      {actionMessage ? <p className="info">{actionMessage}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <SectionCard
        title="Conexiones"
        subtitle="Estado del QR y del calendario"
        actions={
          <div className="inline-actions">
            <button className="secondary-button" onClick={prepareInstance}>Preparar instancia</button>
            <button className="secondary-button" onClick={loadQr}>Obtener QR</button>
          </div>
        }
      >
        <div className="two-col-grid">
          <div className="status-box">
            <h3>Evolution QR</h3>
            <p><strong>Instancia:</strong> {evolutionStatus?.instanceName || '-'}</p>
            <p><strong>Estado:</strong> {evolutionStatus?.connection?.status || '-'}</p>
            <p><strong>Webhook:</strong> {evolutionStatus?.webhookUrl || '-'}</p>
            {evolutionStatus?.connection?.qrCode ? <p className="small-note">QR disponible en backend. Pedilo desde el endpoint /api/evolution/qr si necesitás inspección cruda.</p> : null}
          </div>
          <div className="status-box">
            <h3>Google Calendar</h3>
            <p><strong>Conectado:</strong> {googleStatus?.state?.connected ? 'Sí' : 'No'}</p>
            <p><strong>Calendario:</strong> {googleStatus?.state?.calendarId || '-'}</p>
            <p><strong>Última sync:</strong> {googleStatus?.state?.lastSyncAt ? new Date(googleStatus.state.lastSyncAt).toLocaleString('es-AR') : '-'}</p>
            <div className="inline-actions">
              <a className="secondary-button link-button" href={buildApiUrl('/auth/google')}>Conectar Google</a>
              <button className="secondary-button" onClick={runSync}>Sincronizar agenda</button>
              <button className="secondary-button" onClick={disconnectGoogle}>Desconectar</button>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Turnos del calendario"
        subtitle="Se leen desde Google Calendar. Para enviar recordatorio automático, agregá un teléfono en el título o la descripción del evento."
        actions={<button className="secondary-button" onClick={runReminders}>Procesar recordatorios ahora</button>}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Turno</th>
                <th>Cliente</th>
                <th>WhatsApp</th>
                <th>Recordatorio</th>
                <th>Enviado</th>
              </tr>
            </thead>
            <tbody>
              {appointments.length ? appointments.map((item) => <AppointmentRow key={item.id} item={item} />) : (
                <tr><td colSpan="6">Todavía no hay turnos sincronizados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Recordatorio manual" subtitle="Usa solo contactos que ya escribieron." >
        <div className="contacts-layout">
          <div className="contacts-list">
            {contacts.length ? contacts.map((contact) => (
              <ContactRow key={contact.id} contact={contact} onSelect={setSelectedContact} />
            )) : <p className="info">Todavía no hay contactos.</p>}
          </div>
          <form className="reminder-panel" onSubmit={sendManualReminder}>
            <h3>{selectedContact ? `Enviar a ${selectedContact.name || selectedContact.wa_id}` : 'Elegí un contacto'}</h3>
            <label>
              <span>Cuándo</span>
              <input value={reminderWhen} onChange={(e) => setReminderWhen(e.target.value)} placeholder="mañana a las 15:00" />
            </label>
            <label>
              <span>Texto personalizado</span>
              <textarea rows="5" value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="Opcional. Si lo dejás vacío, usa la plantilla del sistema." />
            </label>
            <button className="primary-button" disabled={!selectedContact}>Enviar recordatorio</button>
          </form>
        </div>
      </SectionCard>

      <SectionCard title="Configuración" subtitle="Horarios, reglas y plantilla de recordatorio">
        <SettingsForm
          settings={settings}
          onChange={(path, value) => setSettings((current) => updateNested(current, path, value))}
          onSave={saveSettings}
          saving={saving}
        />
      </SectionCard>

      <SectionCard title="Últimos mensajes" subtitle="Entrantes, salientes y estados del bot">
        <div className="timeline-grid">
          {interactions.length ? interactions.slice(0, 24).map((item) => <TimelineItem key={item.id} item={item} />) : <p className="info">Todavía no hay actividad.</p>}
        </div>
      </SectionCard>

      <SectionCard title="Eventos crudos" subtitle="Debug de webhooks y sincronizaciones">
        <div className="events-list">
          {events.length ? events.map((event) => (
            <details key={event.id} className="event-item">
              <summary>
                <span>{new Date(event.created_at).toLocaleString('es-AR')}</span>
                <strong>{event.event_type}</strong>
              </summary>
              <pre>{event.payload}</pre>
            </details>
          )) : <p className="info">Todavía no llegaron eventos.</p>}
        </div>
      </SectionCard>
    </main>
  );
}
