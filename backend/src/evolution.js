function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export function getInstanceName() {
  return process.env.EVOLUTION_INSTANCE || 'emme-estetica';
}

function getBaseUrl() {
  return requiredEnv('EVOLUTION_API_URL').replace(/\/$/, '');
}

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: requiredEnv('EVOLUTION_API_KEY')
  };
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

async function evolutionRequest(path, options = {}) {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      ...getHeaders(),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Evolution request failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

export async function ensureInstance(webhookUrl) {
  const instanceName = getInstanceName();

  try {
    return await evolutionRequest('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        rejectCall: true,
        msgCall: 'Hola, ahora no podemos atender llamadas. Escribinos por WhatsApp.',
        groupsIgnore: true,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false,
        webhook: webhookUrl,
        webhook_by_events: false,
        events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'SEND_MESSAGE']
      })
    });
  } catch (error) {
    if (error.message.includes('409') || error.message.toLowerCase().includes('already')) {
      return { instance: { instanceName }, reused: true };
    }
    throw error;
  }
}

export async function fetchQrCode() {
  return evolutionRequest(`/instance/connect/${getInstanceName()}`, {
    method: 'GET'
  });
}

export async function sendTextMessage({ number, text, delayMs = 0 }) {
  return evolutionRequest(`/message/sendText/${getInstanceName()}`, {
    method: 'POST',
    body: JSON.stringify({
      number: normalizePhone(number),
      text,
      delay: Math.max(0, Math.round(delayMs)),
      linkPreview: true
    })
  });
}
