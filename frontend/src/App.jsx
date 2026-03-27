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

function SectionCard({ title, subtitle, children }) {
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function InteractionRow({ item }) {
  return (
    <tr>
      <td>{new Date(item.created_at).toLocaleString('es-AR')}</td>
      <td>{item.customer_name || 'Sin nombre'}</td>
      <td>{item.customer_wa_id || '-'}</td>
      <td>{item.message_type}</td>
      <td>{item.selected_option || '-'}</td>
      <td>{item.status}</td>
      <td className="preview-cell">{item.message_preview || '-'}</td>
    </tr>
  );
}

async function parseResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = data?.error || data?.message || `Error HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [webhookEvents, setWebhookEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);

        const [configJson, interactionsJson, eventsJson] = await Promise.all([
          fetch(buildApiUrl('/api/config')).then(parseResponse),
          fetch(buildApiUrl('/api/interactions')).then(parseResponse),
          fetch(buildApiUrl('/api/webhook-events')).then(parseResponse)
        ]);

        if (!active) return;
        setConfig(configJson);
        setInteractions(interactionsJson.items || []);
        setWebhookEvents(eventsJson.items || []);
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
    const redirects = interactions.filter((item) => item.owner_link).length;
    return { inbound, statuses, redirects };
  }, [interactions]);

  return (
    <main className="page">
      <header className="hero">
        <div>
          <span className="eyebrow">MVP · WhatsApp Cloud API</span>
          <h1>{config?.salonName || 'Emme Estetica'}</h1>
          <p>
            Bot de derivación para agendar, cambiar, cancelar y hablar con Emme.
            El panel guarda registros de interacciones y eventos webhook.
          </p>
          {!import.meta.env.VITE_API_BASE_URL && typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? (
            <p className="info">
              Producción detectada sin <code>VITE_API_BASE_URL</code>. Si el frontend y el backend están en Railway por separado,
              cargá esa variable con la URL pública del backend.
            </p>
          ) : null}
        </div>
        <a className="primary-link" href={config?.ownerLink || '#'} target="_blank" rel="noreferrer">
          Abrir WhatsApp de Emme
        </a>
      </header>

      <section className="stats-grid">
        <article className="stat-card">
          <span>Interacciones entrantes</span>
          <strong>{totals.inbound}</strong>
        </article>
        <article className="stat-card">
          <span>Estados recibidos</span>
          <strong>{totals.statuses}</strong>
        </article>
        <article className="stat-card">
          <span>Derivaciones generadas</span>
          <strong>{totals.redirects}</strong>
        </article>
      </section>

      {loading ? <p className="info">Cargando panel...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <SectionCard
        title="Configuración activa"
        subtitle="Número de derivación y etiquetas visibles en el bot"
      >
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
        </div>
      </SectionCard>

      <SectionCard
        title="Últimas interacciones"
        subtitle="Se guardan mensajes entrantes, opciones elegidas y estados de entrega"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Nombre</th>
                <th>WhatsApp</th>
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
                  <td colSpan="7">Todavía no hay interacciones registradas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Últimos webhooks"
        subtitle="Debug rápido de eventos crudos recibidos desde Meta"
      >
        <div className="events-list">
          {webhookEvents.length ? (
            webhookEvents.map((event) => (
              <details key={event.id} className="event-item">
                <summary>
                  <span>{new Date(event.created_at).toLocaleString('es-AR')}</span>
                  <strong>{event.event_type}</strong>
                </summary>
                <pre>{event.payload}</pre>
              </details>
            ))
          ) : (
            <p className="info">Todavía no llegaron eventos.</p>
          )}
        </div>
      </SectionCard>
    </main>
  );
}
