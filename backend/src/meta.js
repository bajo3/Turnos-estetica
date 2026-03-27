const GRAPH_BASE = 'https://graph.facebook.com';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function getOwnerNumber() {
  return (process.env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '');
}

export function buildOwnerLink(optionLabel) {
  const ownerNumber = getOwnerNumber();
  if (!ownerNumber) {
    return '';
  }

  const salonName = process.env.SALON_NAME || 'Emme Estetica';
  const ownerName = process.env.OWNER_DISPLAY_NAME || 'Emme';
  const text = encodeURIComponent(
    `Hola ${ownerName}, vengo desde el bot de ${salonName}. Quiero: ${optionLabel}.`
  );
  return `https://wa.me/${ownerNumber}?text=${text}`;
}

export async function sendListMenu(to, settings = null) {
  const bookingEnabled =
    settings?.booking?.mode === 'booking_link' && settings?.booking?.bookingPageUrl;
  const scheduleConfigured = Array.isArray(settings?.schedule)
    ? settings.schedule.some((day) => day.enabled)
    : false;

  const rows = [
    {
      id: 'agendar_turno',
      title: 'Agendar turno',
      description: bookingEnabled
        ? 'Recibí el link de agenda online.'
        : 'Coordiná tu turno con Emme.'
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
    }
  ];

  if (scheduleConfigured) {
    rows.push({
      id: 'ver_horarios',
      title: 'Ver horarios',
      description: 'Consultá días y horarios de atención.'
    });
  }

  rows.push({
    id: 'hablar_emme',
    title: 'Hablar con Emme',
    description: 'Ir directo al WhatsApp de Emme.'
  });

  return sendWhatsAppMessage(
    {
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
          text: bookingEnabled
            ? 'Hola 💅 Elegí una opción. Si querés, también podés reservar online.'
            : 'Hola 💅 Bienvenida a Emme Estetica. Elegí una opción para seguir.'
        },
        footer: {
          text: 'Te respondemos por WhatsApp.'
        },
        action: {
          button: 'Ver opciones',
          sections: [
            {
              title: 'Turnos',
              rows
            }
          ]
        }
      }
    },
    {
      messageType: 'interactive_list',
      preview: rows.map((row) => row.title).join(' · '),
      bodyText: 'Menú principal enviado',
      meta: { rows }
    }
  );
}

export async function sendOwnerRedirect(to, optionLabel) {
  const link = buildOwnerLink(optionLabel);

  if (!link) {
    return sendText(
      to,
      'Gracias por escribir. En este momento no pudimos generar el acceso directo al WhatsApp de Emme. Intentá nuevamente en unos minutos.'
    );
  }

  const bodyText =
    optionLabel === 'Hablar con Emme'
      ? 'Perfecto. Escribinos directo a este WhatsApp y Emme te responde personalmente.'
      : `Perfecto. Para ${optionLabel.toLowerCase()}, escribinos directamente a este WhatsApp y Emme lo coordina con vos.`;

  return sendWhatsAppMessage(
    {
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
          text: bodyText
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
    },
    {
      messageType: 'interactive_cta_url',
      preview: bodyText,
      bodyText,
      ownerLink: link,
      meta: { displayText: 'Ir al WhatsApp de Emme' }
    }
  );
}

export async function sendBookingLink(to, options) {
  const bodyText = options?.bodyText || 'Reservá tu turno desde este enlace.';
  const label = options?.label || 'Reservar online';
  const url = options?.url;

  if (!url) {
    return sendText(
      to,
      'Todavía no está configurado el link de agenda online. Escribinos por WhatsApp y lo coordinamos manualmente.'
    );
  }

  return sendWhatsAppMessage(
    {
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
          text: bodyText
        },
        footer: {
          text: 'El botón abre tu agenda online.'
        },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: label,
            url
          }
        }
      }
    },
    {
      messageType: 'interactive_cta_url',
      preview: bodyText,
      bodyText,
      ownerLink: url,
      meta: { displayText: label }
    }
  );
}

export async function sendText(to, text) {
  return sendWhatsAppMessage(
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text }
    },
    {
      messageType: 'text',
      preview: text,
      bodyText: text
    }
  );
}

async function sendWhatsAppMessage(payload, meta = {}) {
  const version = process.env.META_API_VERSION || 'v23.0';
  const phoneNumberId = requiredEnv('META_PHONE_NUMBER_ID');
  const accessToken = requiredEnv('META_ACCESS_TOKEN');

  const response = await fetch(`${GRAPH_BASE}/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Meta send failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return {
    response: data,
    messageType: meta.messageType || payload.type || 'text',
    preview: meta.preview || null,
    bodyText: meta.bodyText || null,
    ownerLink: meta.ownerLink || null,
    meta: meta.meta || null
  };
}
