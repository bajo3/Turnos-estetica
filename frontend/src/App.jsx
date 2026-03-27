import { useEffect, useMemo, useState } from 'react';

function resolveApiBase() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:8080';
    }

    return origin;
  }

  return '';
}

const API_BASE = resolveApiBase();

function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}

function clone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

async function parseResponse(response) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    throw new Error(`La API devolvió una respuesta no JSON: ${text.slice(0, 180)}`);
  }

  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = data?.error || data?.message || `Error HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

async function apiFetch(path, options = {}) {
  return fetch(buildApiUrl(path), options).then(parseResponse);
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-AR');
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

function InteractionRow({ item }) {
  return (
    <tr>
      <td>{formatDate(item.created_at)}</td>
      <td>{item.customer_name || 'Sin nombre'}</td>
      <td>{item.customer_wa_id || '-'}</td>
      <td>{item.direction}</td>
      <td>{item.message_type}</td>
      <td>{item.selected_option || '-'}</td>
      <td>{item.status}</td>
      <td className="preview-cell">{item.message_preview || '-'}</td>
    </tr>
  );
}

function MessageBubble({ item }) {
  const roleClass = item.direction === 'inbound' ? 'bubble-inbound' : item.direction === 'outbound_bot' ? 'bubble-bot' : 'bubble-status';
  const title =
    item.direction === 'inbound'
      ? 'Cliente'
      : item.direction === 'outbound_bot'
      ? 'Bot'
      : 'Estado Meta';

  return (
    <article className={`message-bubble ${roleClass}`}>
      <div className="message-bubble-top">
        <strong>{title}</strong>
        <span>{formatDate(item.created_at)}</span>
      </div>
      <p>{item.message_body || item.message_preview || '-'}</p>
      <div className="message-bubble-meta">
        <span>{item.message_type}</span>
        {item.selected_option ? <span>{item.selected_option}</span> : null}
        {item.status ? <span>{item.status}</span> : null}
      </div>
      {item.owner_link ? (
        <a href={item.owner_link} target="_blank" rel="noreferrer">
          Abrir link
        </a>
      ) : null}
    </article>
  );
}

function SettingsEditor({ value, onChange, onSave, saving, saveMessage }) {
  if (!value) {
    return null;
  }

  function update(path, nextValue) {
    const draft = clone(value);
    let ref = draft;

    for (let index = 0; index < path.length - 1; index += 1) {
      ref = ref[path[index]];
    }

    ref[path[path.length - 1]] = nextValue;
    onChange(draft);
  }

  function updateDay(dayKey, patch) {
    const draft = clone(value);
    draft.schedule = draft.schedule.map((day) =>
      day.key === dayKey ? { ...day, ...patch } : day
    );
    onChange(draft);
  }

  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="settings-grid">
        <div>
          <label>Zona horaria</label>
          <input
            value={value.timezone}
            onChange={(event) => update(['timezone'], event.target.value)}
            placeholder="America/Argentina/Buenos_Aires"
          />
        </div>
        <div>
          <label>Modo de agenda</label>
          <select
            value={value.booking.mode}
            onChange={(event) => update(['booking', 'mode'], event.target.value)}
          >
            <option value="owner_whatsapp">Derivar al WhatsApp de Emme</option>
            <option value="booking_link">Usar link de agenda online</option>
          </select>
        </div>
        <div>
          <label>Texto del botón</label>
          <input
            value={value.booking.bookingPageLabel}
            onChange={(event) => update(['booking', 'bookingPageLabel'], event.target.value)}
            placeholder="Reservar online"
          />
        </div>
        <div>
          <label>Mostrar horarios en respuestas</label>
          <select
            value={value.bot.includeScheduleInReplies ? 'yes' : 'no'}
            onChange={(event) => update(['bot', 'includeScheduleInReplies'], event.target.value === 'yes')}
          >
            <option value="yes">Sí</option>
            <option value="no">No</option>
          </select>
        </div>
        <div className="field-span-2">
          <label>Link de agenda online</label>
          <input
            value={value.booking.bookingPageUrl}
            onChange={(event) => update(['booking', 'bookingPageUrl'], event.target.value)}
            placeholder="https://calendar.google.com/..."
          />
        </div>
        <div className="field-span-2">
          <label>Mensaje cuando el cliente pide agendar</label>
          <textarea
            rows="3"
            value={value.booking.bookingMessage}
            onChange={(event) => update(['booking', 'bookingMessage'], event.target.value)}
            placeholder="Si te queda cómodo, también podés reservar online desde este enlace."
          />
        </div>
        <div className="field-span-2">
          <label>Notas internas</label>
          <textarea
            rows="2"
            value={value.booking.notes}
            onChange={(event) => update(['booking', 'notes'], event.target.value)}
            placeholder="Ejemplo: link de Google Calendar appointment schedule"
          />
        </div>
      </div>

      <div className="schedule-editor">
        <div className="schedule-editor-header">
          <h3>Días y horarios</h3>
          <p>Esto alimenta el panel y la respuesta automática cuando preguntan por horarios.</p>
        </div>
        <div className="days-grid">
          {value.schedule.map((day) => (
            <div key={day.key} className="day-card">
              <div className="day-card-top">
                <strong>{day.label}</strong>
                <label className="toggle-inline">
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={(event) => updateDay(day.key, { enabled: event.target.checked })}
                  />
                  Activo
                </label>
              </div>
              <div className="day-times">
                <div>
                  <label>Desde</label>
                  <input
                    type="time"
                    value={day.start}
                    disabled={!day.enabled}
                    onChange={(event) => updateDay(day.key, { start: event.target.value })}
                  />
                </div>
                <div>
                  <label>Hasta</label>
                  <input
                    type="time"
                    value={day.end}
                    disabled={!day.enabled}
                    onChange={(event) => updateDay(day.key, { end: event.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-footer">
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
        {saveMessage ? <span className="save-message">{saveMessage}</span> : null}
      </div>
    </form>
  );
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [webhookEvents, setWebhookEvents] = useState([]);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [selectedConversation, setSelectedConversation] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);

        const [configJson, interactionsJson, eventsJson] = await Promise.all([
          apiFetch('/api/config'),
          apiFetch('/api/interactions?limit=500'),
          apiFetch('/api/webhook-events?limit=120')
        ]);

        if (!active) return;
        setConfig(configJson);
        setInteractions(interactionsJson.items || []);
        setWebhookEvents(eventsJson.items || []);
        setSettingsDraft((current) => current || clone(configJson.settings));
        setError('');
      } catch (err) {
        if (!active) return;
        setError(err.message || 'Error desconocido');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const totals = useMemo(() => {
    const inbound = interactions.filter((item) => item.direction === 'inbound').length;
    const statuses = interactions.filter((item) => item.direction === 'outbound_status').length;
    const botMessages = interactions.filter((item) => item.direction === 'outbound_bot').length;
    return { inbound, statuses, botMessages };
  }, [interactions]);

  const conversations = useMemo(() => {
    const grouped = new Map();

    [...interactions]
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .forEach((item) => {
        const key = item.customer_wa_id || 'sin-numero';
        if (!grouped.has(key)) {
          grouped.set(key, {
            key,
            customerName: item.customer_name || 'Sin nombre',
            customerWaId: item.customer_wa_id || '-',
            items: []
          });
        }

        const group = grouped.get(key);
        if (!group.customerName && item.customer_name) {
          group.customerName = item.customer_name;
        }
        group.items.push(item);
      });

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        lastItem: group.items[group.items.length - 1]
      }))
      .sort((a, b) => new Date(b.lastItem?.created_at || 0) - new Date(a.lastItem?.created_at || 0));
  }, [interactions]);

  useEffect(() => {
    if (!conversations.length) {
      setSelectedConversation('');
      return;
    }

    const exists = conversations.some((conversation) => conversation.key === selectedConversation);
    if (!selectedConversation || !exists) {
      setSelectedConversation(conversations[0].key);
    }
  }, [conversations, selectedConversation]);

  const selectedChat = conversations.find((conversation) => conversation.key === selectedConversation) || null;
  const botMessages = interactions.filter((item) => item.direction === 'outbound_bot').slice(0, 12);

  async function saveSettings() {
    if (!settingsDraft) return;

    try {
      setSavingSettings(true);
      const result = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settingsDraft)
      });

      setConfig((current) =>
        current
          ? {
              ...current,
              settings: result.settings,
              scheduleSummary: result.scheduleSummary,
              bookingEnabled:
                result.settings.booking.mode === 'booking_link' && Boolean(result.settings.booking.bookingPageUrl),
              bookingMode: result.settings.booking.mode,
              bookingPageUrl: result.settings.booking.bookingPageUrl
            }
          : current
      );
      setSettingsDraft(clone(result.settings));
      setSaveMessage('Configuración guardada.');
      setError('');
    } catch (err) {
      setError(err.message || 'No se pudo guardar la configuración.');
    } finally {
      setSavingSettings(false);
      window.setTimeout(() => setSaveMessage(''), 2500);
    }
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <span className="eyebrow">MVP · WhatsApp Cloud API</span>
          <h1>{config?.salonName || 'Emme Estetica'}</h1>
          <p>
            Panel operativo con conversaciones, mensajes salientes del bot y configuración de horarios.
            También deja listo un modo simple de agenda online por link.
          </p>
          {!import.meta.env.VITE_API_BASE_URL && typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? (
            <p className="info">
              Producción detectada sin <code>VITE_API_BASE_URL</code>. Si el frontend y el backend están en Railway por separado,
              cargá esa variable con la URL pública del backend.
            </p>
          ) : null}
        </div>
        <div className="hero-actions">
          <a className="primary-link" href={config?.ownerLink || '#'} target="_blank" rel="noreferrer">
            Abrir WhatsApp de Emme
          </a>
          {config?.bookingPageUrl ? (
            <a className="secondary-link" href={config.bookingPageUrl} target="_blank" rel="noreferrer">
              Abrir agenda online
            </a>
          ) : null}
        </div>
      </header>

      <section className="stats-grid">
        <article className="stat-card">
          <span>Interacciones entrantes</span>
          <strong>{totals.inbound}</strong>
        </article>
        <article className="stat-card">
          <span>Mensajes del bot</span>
          <strong>{totals.botMessages}</strong>
        </article>
        <article className="stat-card">
          <span>Estados recibidos</span>
          <strong>{totals.statuses}</strong>
        </article>
      </section>

      {loading ? <p className="info">Cargando panel...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <SectionCard title="Configuración activa" subtitle="Ruta de agenda, días abiertos y resumen operativo">
        <div className="config-grid">
          <div>
            <label>Salón</label>
            <div>{config?.salonName || '-'}</div>
          </div>
          <div>
            <label>Atiende</label>
            <div>{config?.ownerDisplayName || '-'}</div>
          </div>
          <div>
            <label>WhatsApp destino</label>
            <div>{config?.ownerWhatsAppNumber || '-'}</div>
          </div>
          <div>
            <label>API base</label>
            <div>{API_BASE || '(misma URL del frontend)'}</div>
          </div>
          <div className="field-span-2">
            <label>Resumen de horarios</label>
            <div>{config?.scheduleSummary || 'Todavía no configurado.'}</div>
          </div>
          <div>
            <label>Modo de agenda</label>
            <div>{config?.bookingMode === 'booking_link' ? 'Agenda online por link' : 'Derivación por WhatsApp'}</div>
          </div>
          <div>
            <label>Link online</label>
            <div>
              {config?.bookingPageUrl ? (
                <a href={config.bookingPageUrl} target="_blank" rel="noreferrer">
                  {config.bookingPageUrl}
                </a>
              ) : (
                'No configurado'
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Agenda y horarios"
        subtitle="Podés dejar el flujo manual por WhatsApp o pasar a una agenda online por link."
      >
        <div className="recommendation-box">
          <strong>Recomendación para este MVP</strong>
          <p>
            Si querés lo más simple, usá un link de agenda online. El bot le manda ese botón al cliente cuando toca “Agendar turno”.
          </p>
        </div>
        <SettingsEditor
          value={settingsDraft}
          onChange={setSettingsDraft}
          onSave={saveSettings}
          saving={savingSettings}
          saveMessage={saveMessage}
        />
      </SectionCard>

      <SectionCard
        title="Conversaciones"
        subtitle="Acá ves lo que entra del cliente y exactamente lo que responde el bot."
      >
        <div className="conversation-layout">
          <aside className="conversation-sidebar">
            {conversations.length ? (
              conversations.map((conversation) => (
                <button
                  key={conversation.key}
                  className={`conversation-item ${selectedConversation === conversation.key ? 'active' : ''}`}
                  onClick={() => setSelectedConversation(conversation.key)}
                >
                  <strong>{conversation.customerName || 'Sin nombre'}</strong>
                  <span>{conversation.customerWaId}</span>
                  <p>{conversation.lastItem?.message_preview || 'Sin actividad'}</p>
                </button>
              ))
            ) : (
              <p className="info compact">Todavía no hay conversaciones registradas.</p>
            )}
          </aside>
          <div className="conversation-thread">
            {selectedChat ? (
              <>
                <div className="conversation-thread-header">
                  <div>
                    <strong>{selectedChat.customerName}</strong>
                    <span>{selectedChat.customerWaId}</span>
                  </div>
                  <span>{selectedChat.items.length} eventos</span>
                </div>
                <div className="bubble-list">
                  {selectedChat.items.map((item) => (
                    <MessageBubble key={item.id} item={item} />
                  ))}
                </div>
              </>
            ) : (
              <p className="info compact">Elegí una conversación para ver el detalle.</p>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Últimos mensajes del bot"
        subtitle="Atajo rápido para auditar respuestas automáticas sin abrir cada conversación."
      >
        <div className="bot-message-list">
          {botMessages.length ? (
            botMessages.map((item) => (
              <div key={item.id} className="bot-message-item">
                <div>
                  <strong>{item.customer_name || item.customer_wa_id || 'Sin destinatario'}</strong>
                  <span>{formatDate(item.created_at)}</span>
                </div>
                <p>{item.message_body || item.message_preview || '-'}</p>
              </div>
            ))
          ) : (
            <p className="info compact">Todavía no hay mensajes del bot guardados.</p>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Últimas interacciones"
        subtitle="Tabla completa para debug rápido de eventos de entrada, salida y estados de Meta."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Nombre</th>
                <th>WhatsApp</th>
                <th>Dirección</th>
                <th>Tipo</th>
                <th>Opción</th>
                <th>Estado</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {interactions.length ? (
                interactions.map((item) => <InteractionRow key={item.id} item={item} />)
              ) : (
                <tr>
                  <td colSpan="8">Todavía no hay interacciones registradas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Últimos webhooks"
        subtitle="Debug rápido de eventos crudos recibidos desde Meta."
      >
        <div className="events-list">
          {webhookEvents.length ? (
            webhookEvents.map((event) => (
              <details key={event.id} className="event-item">
                <summary>
                  <span>{formatDate(event.created_at)}</span>
                  <strong>{event.event_type}</strong>
                </summary>
                <pre>{event.payload}</pre>
              </details>
            ))
          ) : (
            <p className="info compact">Todavía no llegaron eventos.</p>
          )}
        </div>
      </SectionCard>
    </main>
  );
}
