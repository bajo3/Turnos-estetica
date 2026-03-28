import { useEffect, useMemo, useState } from 'react';

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
const api = (path) => `${API_BASE}${path}`;

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(text.slice(0, 200) || `Error ${res.status}`); }
  if (!res.ok) throw new Error(data?.error || data?.message || `Error ${res.status}`);
  return data;
}

function Card({ title, subtitle, actions, children }) {
  return (
    <section style={{ background: '#fff', borderRadius: 12, padding: 24, marginBottom: 24, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{title}</h2>
          {subtitle && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}>{subtitle}</p>}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function Btn({ onClick, children, primary, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 16px', borderRadius: 8, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        background: primary ? '#7c3aed' : '#f3f4f6', color: primary ? '#fff' : '#333',
        fontWeight: 500, fontSize: 13, opacity: disabled ? .6 : 1
      }}
    >{children}</button>
  );
}

function StatusDot({ ok }) {
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: ok ? '#22c55e' : '#ef4444', marginRight: 6 }} />;
}

function Badge({ color, children }) {
  const colors = { green: '#dcfce7', red: '#fee2e2', yellow: '#fef9c3', gray: '#f3f4f6' };
  const texts = { green: '#166534', red: '#991b1b', yellow: '#854d0e', gray: '#555' };
  const c = colors[color] || colors.gray;
  const t = texts[color] || texts.gray;
  return <span style={{ padding: '2px 8px', borderRadius: 12, background: c, color: t, fontSize: 12, fontWeight: 500 }}>{children}</span>;
}

function reminderBadge(status) {
  if (status === 'sent') return <Badge color="green">enviado</Badge>;
  if (status === 'missing_phone') return <Badge color="yellow">sin teléfono</Badge>;
  if (status === 'cancelled') return <Badge color="gray">cancelado</Badge>;
  if (status === 'daily_limit_reached') return <Badge color="red">límite diario</Badge>;
  if (status === 'not_existing_contact') return <Badge color="yellow">no es contacto</Badge>;
  return <Badge color="gray">{status || 'pendiente'}</Badge>;
}

export default function App() {
  const [settings, setSettings] = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [evolutionStatus, setEvolutionStatus] = useState(null);
  const [googleStatus, setGoogleStatus] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [selectedContact, setSelectedContact] = useState(null);
  const [reminderWhen, setReminderWhen] = useState('mañana');
  const [customText, setCustomText] = useState('');

  function flash(message, isErr = false) {
    if (isErr) setErr(message); else setMsg(message);
    setTimeout(() => isErr ? setErr('') : setMsg(''), 5000);
  }

  async function loadAll() {
    const [settingsJson, interactionsJson, contactsJson, appointmentsJson, statusJson, googleJson] = await Promise.all([
      fetchJson(api('/api/settings')),
      fetchJson(api('/api/interactions')),
      fetchJson(api('/api/contacts')),
      fetchJson(api('/api/appointments')),
      fetchJson(api('/api/evolution/status')),
      fetchJson(api('/api/google/status'))
    ]);
    setSettings(settingsJson);
    setInteractions(interactionsJson.items || []);
    setContacts(contactsJson.items || []);
    setAppointments(appointmentsJson.items || []);
    setEvolutionStatus(statusJson);
    setGoogleStatus(googleJson);
    // Mostrar QR si está esperando escaneo
    if (statusJson?.connection?.status === 'awaiting_qr_scan' && statusJson?.connection?.qrCode) {
      setQrCode(statusJson.connection.qrCode);
    } else if (statusJson?.connection?.status === 'open') {
      setQrCode(null);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        await loadAll();
        if (!active) return;
        const params = new URLSearchParams(window.location.search);
        if (params.get('google') === 'connected') {
          flash('Google Calendar conectado correctamente.');
          window.history.replaceState({}, '', window.location.pathname);
        }
      } catch (e) {
        if (active) flash(e.message || 'No se pudo cargar el panel.', true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    const timer = setInterval(() => active && loadAll().catch(() => {}), 20000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const stats = useMemo(() => ({
    pending: appointments.filter(a => a.reminder_status === 'pending' && new Date(a.start_at) > new Date()).length,
    sent: appointments.filter(a => a.reminder_status === 'sent').length,
    upcoming: appointments.filter(a => new Date(a.start_at) > new Date()).length,
    missingPhone: appointments.filter(a => a.reminder_status === 'missing_phone').length,
  }), [appointments]);

  const whatsappConnected = evolutionStatus?.connection?.status === 'open';
  const googleConnected = googleStatus?.state?.connected;

  async function handlePrepare() {
    try {
      const r = await fetchJson(api('/api/evolution/ensure-instance'), { method: 'POST' });
      flash(`Instancia lista. Webhook: ${r.webhookUrl || '(configurá APP_BASE_URL)'}`);
      await loadAll();
    } catch (e) { flash(e.message, true); }
  }

  async function handleGetQr() {
    try {
      const r = await fetchJson(api('/api/evolution/qr'));
      if (r.qrCode) {
        setQrCode(r.qrCode);
        flash('Escaneá el QR con WhatsApp → Dispositivos vinculados → Vincular un dispositivo.');
      } else {
        flash('No hay QR disponible. La instancia puede ya estar conectada.');
      }
    } catch (e) { flash(e.message, true); }
  }

  async function handleSync() {
    try {
      const r = await fetchJson(api('/api/google/sync'), { method: 'POST' });
      flash(`Agenda sincronizada. Turnos actualizados: ${r.count}`);
      await loadAll();
    } catch (e) { flash(e.message, true); }
  }

  async function handleReminders() {
    try {
      const r = await fetchJson(api('/api/reminders/run'), { method: 'POST' });
      flash(`Recordatorios enviados: ${r.processed}. Salteados: ${r.skipped}.`);
      await loadAll();
    } catch (e) { flash(e.message, true); }
  }

  async function handleDisconnectGoogle() {
    try {
      await fetchJson(api('/api/google/disconnect'), { method: 'POST' });
      flash('Google Calendar desconectado.');
      await loadAll();
    } catch (e) { flash(e.message, true); }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const r = await fetchJson(api('/api/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      setSettings(r.settings);
      flash('Configuración guardada.');
    } catch (e) { flash(e.message, true); }
    finally { setSaving(false); }
  }

  async function handleManualReminder(e) {
    e.preventDefault();
    if (!selectedContact) return;
    try {
      const r = await fetchJson(api('/api/reminders/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waId: selectedContact.wa_id, name: selectedContact.name, when: reminderWhen, text: customText })
      });
      flash(`Recordatorio enviado (delay: ${Math.round((r.delayMs || 0) / 1000)}s).`);
      setCustomText('');
      await loadAll();
    } catch (e) { flash(e.message, true); }
  }

  const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' };
  const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#555' };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, sans-serif', background: '#f9fafb', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111' }}>
          {settings?.salonName || 'Emme Estética'} — Recordatorios WhatsApp
        </h1>
        <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>
          Conecta WhatsApp vía QR, sincronizá Google Calendar y enviá recordatorios automáticos.
        </p>
      </div>

      {/* Stats */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Próximos turnos', val: stats.upcoming, color: '#7c3aed' },
            { label: 'Recordatorios enviados', val: stats.sent, color: '#22c55e' },
            { label: 'Pendientes de envío', val: stats.pending, color: '#f59e0b' },
            { label: 'Sin teléfono', val: stats.missingPhone, color: '#ef4444' },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', borderRadius: 10, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.07)' }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {msg && <div style={{ background: '#dcfce7', color: '#166534', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{msg}</div>}
      {err && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{err}</div>}
      {loading && <p style={{ color: '#666', fontSize: 14 }}>Cargando panel...</p>}

      {/* Conexiones */}
      <Card
        title="Conexiones"
        subtitle="Estado de WhatsApp y Google Calendar"
        actions={<>
          <Btn onClick={handlePrepare}>Preparar instancia</Btn>
          <Btn onClick={handleGetQr}>Obtener QR</Btn>
        </>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* WhatsApp */}
          <div style={{ background: '#f9fafb', borderRadius: 10, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>
              <StatusDot ok={whatsappConnected} /> WhatsApp (Evolution API)
            </h3>
            <p style={{ margin: '0 0 4px', fontSize: 13 }}><b>Instancia:</b> {evolutionStatus?.instanceName || '-'}</p>
            <p style={{ margin: '0 0 4px', fontSize: 13 }}>
              <b>Estado:</b>{' '}
              {whatsappConnected
                ? <Badge color="green">conectado</Badge>
                : <Badge color="red">{evolutionStatus?.connection?.status || 'desconectado'}</Badge>}
            </p>
            <p style={{ margin: '0 0 12px', fontSize: 13 }}><b>Webhook:</b> {evolutionStatus?.webhookUrl || '(configurá APP_BASE_URL)'}</p>

            {qrCode && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: '0 0 8px', fontSize: 12, color: '#666' }}>
                  Escaneá con WhatsApp → Dispositivos vinculados → Vincular dispositivo
                </p>
                <img
                  src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                  alt="QR WhatsApp"
                  style={{ width: 200, height: 200, border: '4px solid #7c3aed', borderRadius: 8 }}
                />
              </div>
            )}
            {whatsappConnected && <p style={{ color: '#22c55e', fontSize: 13, fontWeight: 600 }}>✓ WhatsApp conectado y listo para enviar</p>}
          </div>

          {/* Google Calendar */}
          <div style={{ background: '#f9fafb', borderRadius: 10, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>
              <StatusDot ok={googleConnected} /> Google Calendar
            </h3>
            <p style={{ margin: '0 0 4px', fontSize: 13 }}>
              <b>Estado:</b>{' '}
              {googleConnected ? <Badge color="green">conectado</Badge> : <Badge color="red">desconectado</Badge>}
            </p>
            {googleConnected && <>
              <p style={{ margin: '0 0 4px', fontSize: 13 }}><b>Calendario:</b> {googleStatus?.state?.calendarId || 'primary'}</p>
              <p style={{ margin: '0 0 12px', fontSize: 13 }}>
                <b>Última sync:</b>{' '}
                {googleStatus?.state?.lastSyncAt ? new Date(googleStatus.state.lastSyncAt).toLocaleString('es-AR') : '-'}
              </p>
            </>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {!googleConnected
                ? <a href={api('/auth/google')} style={{ padding: '8px 14px', background: '#7c3aed', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 500 }}>Conectar Google</a>
                : <>
                  <Btn onClick={handleSync}>Sincronizar ahora</Btn>
                  <Btn onClick={handleDisconnectGoogle}>Desconectar</Btn>
                </>
              }
            </div>
          </div>
        </div>
      </Card>

      {/* Turnos */}
      <Card
        title="Turnos del calendario"
        subtitle="Los turnos se sincronizan automáticamente. El teléfono se lee del título o descripción del evento."
        actions={<Btn onClick={handleReminders} primary>Enviar recordatorios ahora</Btn>}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #f3f4f6', textAlign: 'left' }}>
                {['Fecha', 'Turno', 'Cliente', 'WhatsApp', 'Recordatorio', 'Enviado'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', fontWeight: 600, color: '#555' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {appointments.length ? appointments.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px 10px' }}>{new Date(a.start_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td style={{ padding: '8px 10px' }}>{a.summary}</td>
                  <td style={{ padding: '8px 10px' }}>{a.contact_name || '-'}</td>
                  <td style={{ padding: '8px 10px' }}>{a.contact_phone || '-'}</td>
                  <td style={{ padding: '8px 10px' }}>{reminderBadge(a.reminder_status)}</td>
                  <td style={{ padding: '8px 10px' }}>{a.reminder_sent_at ? new Date(a.reminder_sent_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                </tr>
              )) : (
                <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#999' }}>No hay turnos sincronizados todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recordatorio manual */}
      <Card title="Recordatorio manual" subtitle="Elegí un contacto y enviá un mensaje personalizado.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            {contacts.length ? contacts.map(c => (
              <button key={c.id} onClick={() => setSelectedContact(c)} style={{
                width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: '1px solid #f3f4f6',
                background: selectedContact?.id === c.id ? '#f5f3ff' : 'transparent', cursor: 'pointer'
              }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name || 'Sin nombre'}</div>
                <div style={{ fontSize: 12, color: '#666' }}>{c.wa_id}</div>
              </button>
            )) : <p style={{ padding: 16, color: '#999', fontSize: 13 }}>Todavía no hay contactos.</p>}
          </div>
          <form onSubmit={handleManualReminder} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>
              {selectedContact ? `Enviar a ${selectedContact.name || selectedContact.wa_id}` : 'Seleccioná un contacto'}
            </h3>
            <label style={labelStyle}>
              Cuándo
              <input style={inputStyle} value={reminderWhen} onChange={e => setReminderWhen(e.target.value)} placeholder="mañana a las 15:00" />
            </label>
            <label style={labelStyle}>
              Texto personalizado (opcional)
              <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={4} value={customText}
                onChange={e => setCustomText(e.target.value)}
                placeholder="Si lo dejás vacío usa la plantilla configurada." />
            </label>
            <Btn primary disabled={!selectedContact}>Enviar recordatorio</Btn>
          </form>
        </div>
      </Card>

      {/* Configuración */}
      <Card title="Configuración" subtitle="Ajustá los parámetros del sistema de recordatorios.">
        {settings && (
          <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                ['Nombre del salón', 'salonName', 'text'],
                ['Atiende (nombre bot)', 'ownerDisplayName', 'text'],
                ['WhatsApp del negocio', 'ownerWhatsAppNumber', 'text'],
                ['Horas antes del recordatorio', 'reminderHoursBefore', 'number'],
                ['Límite diario de recordatorios', 'dailyReminderLimit', 'number'],
                ['Pausa mínima entre mensajes (seg)', 'minDelaySeconds', 'number'],
                ['Pausa máxima entre mensajes (seg)', 'maxDelaySeconds', 'number'],
                ['Sincronizar calendario cada (min)', 'syncEveryMinutes', 'number'],
              ].map(([label, key, type]) => (
                <label key={key} style={labelStyle}>
                  {label}
                  <input style={inputStyle} type={type} value={settings[key] ?? ''}
                    onChange={e => setSettings(s => ({ ...s, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))} />
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {[
                ['Recordatorios activados', 'botEnabled'],
                ['Solo contactos existentes', 'onlyExistingContacts'],
              ].map(([label, key]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={Boolean(settings[key])}
                    onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>

            <label style={labelStyle}>
              Plantilla del recordatorio
              <p style={{ margin: '0 0 4px', fontSize: 12, color: '#888' }}>Variables disponibles: {'{name}'} {'{salon}'} {'{when}'}</p>
              <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={3} value={settings.reminderTemplate || ''}
                onChange={e => setSettings(s => ({ ...s, reminderTemplate: e.target.value }))} />
            </label>

            <Btn primary disabled={saving}>{saving ? 'Guardando...' : 'Guardar configuración'}</Btn>
          </form>
        )}
      </Card>

      {/* Últimos mensajes */}
      <Card title="Últimos mensajes enviados" subtitle="Historial de recordatorios y actividad del bot.">
        {interactions.filter(i => i.direction === 'outbound').slice(0, 20).map(i => (
          <div key={i.id} style={{ borderBottom: '1px solid #f3f4f6', padding: '10px 0', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <strong>{i.customer_name || i.customer_wa_id || '-'}</strong>
              <span style={{ color: '#888', fontSize: 12 }}>{new Date(i.created_at).toLocaleString('es-AR')}</span>
            </div>
            <p style={{ margin: 0, color: '#555' }}>{i.message_preview || '-'}</p>
          </div>
        ))}
        {interactions.filter(i => i.direction === 'outbound').length === 0 && (
          <p style={{ color: '#999', fontSize: 13 }}>Todavía no se enviaron mensajes.</p>
        )}
      </Card>
    </div>
  );
}
