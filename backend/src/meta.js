const GRAPH_BASE = 'https://graph.facebook.com';

function env(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export function buildOwnerLink(optionLabel) {
  const ownerNumber = env('OWNER_WHATSAPP_NUMBER').replace(/\D/g, '');
  const salonName = process.env.SALON_NAME || 'Emme Estetica';
  const ownerName = process.env.OWNER_DISPLAY_NAME || 'Emme';
  const text = encodeURIComponent(
    `Hola ${ownerName}, vengo desde el bot de ${salonName}. Quiero: ${optionLabel}.`
  );
  return `https://wa.me/${ownerNumber}?text=${text}`;
}

export async function sendListMenu(to) {
  return sendWhatsAppMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: {
        type: 'text',
        text: process.env.SALON_NAME || 'Emme Estetica'
      },
      body: {
        text: 'Hola 💅 Bienvenida a Emme Estetica. Elegí una opción para seguir.'
      },
      footer: {
        text: 'Te respondemos por WhatsApp.'
      },
      action: {
        button: 'Ver opciones',
        sections: [
          {
            title: 'Turnos',
            rows: [
              {
                id: 'agendar_turno',
                title: 'Agendar turno',
                description: 'Coordiná tu turno con Emme.'
              },
              {
                id: 'cambiar_turno',
                title: 'Cambiar turno',
                description: 'Pedí reprogramar tu turno actual.'
              },
              {
                id: 'cancelar_turno',
                title: 'Cancelar turno',
                description: 'Avisá tu cancelación.'
              },
              {
                id: 'hablar_emme',
                title: 'Hablar con Emme',
                description: 'Ir directo al WhatsApp de Emme.'
              }
            ]
          }
        ]
      }
    }
  });
}

export async function sendOwnerRedirect(to, optionLabel) {
  const link = buildOwnerLink(optionLabel);
  return sendWhatsAppMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      header: {
        type: 'text',
        text: process.env.SALON_NAME || 'Emme Estetica'
      },
      body: {
        text:
          optionLabel === 'Hablar con Emme'
            ? 'Perfecto. Escribinos directo a este WhatsApp y Emme te responde personalmente.'
            : `Perfecto. Para ${optionLabel.toLowerCase()}, escribinos directamente a este WhatsApp y Emme lo coordina con vos.`
      },
      footer: {
        text: 'Al tocar el botón se abre el WhatsApp de Emme.'
      },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: 'Ir al WhatsApp de Emme',
          url: link
        }
      }
    }
  });
}

export async function sendText(to, text) {
  return sendWhatsAppMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text }
  });
}

async function sendWhatsAppMessage(payload) {
  const version = process.env.META_API_VERSION || 'v23.0';
  const phoneNumberId = env('META_PHONE_NUMBER_ID');
  const accessToken = env('META_ACCESS_TOKEN');

  const response = await fetch(
    `${GRAPH_BASE}/${version}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Meta send failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}
