# Emme Estetica · MVP WhatsApp Cloud API

MVP full stack para **Emme Estetica**.

## Qué hace ahora

- Recibe mensajes entrantes desde **WhatsApp Cloud API** por webhook.
- Muestra un menú para:
  - Agendar turno
  - Cambiar turno
  - Cancelar turno
  - Ver horarios
  - Hablar con Emme
- Guarda **mensajes entrantes, mensajes salientes del bot y estados de Meta** en un archivo JSON local.
- Expone un panel web para:
  - ver conversaciones completas,
  - auditar exactamente lo que manda el bot,
  - editar días y horarios,
  - elegir si “Agendar turno” deriva a WhatsApp o manda un **link de agenda online**.

## Decisión técnica importante

WhatsApp **reply buttons** admiten hasta **3 opciones**, así que el MVP usa un **interactive list message**.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Persistencia: JSON file local (MVP)
- Deploy sugerido: Railway

## Estructura

- `frontend/`: panel admin simple
- `backend/`: webhook, envío de mensajes, persistencia y API interna

## Variables de entorno

Copiá `.env.example` a `.env` y completá:

```bash
cp .env.example .env
```

### Requeridas

- `META_ACCESS_TOKEN`: token permanente o de larga duración de Meta
- `META_PHONE_NUMBER_ID`: Phone Number ID del número Cloud API
- `WEBHOOK_VERIFY_TOKEN`: token para verificar el webhook
- `APP_BASE_URL`: URL pública del backend (por ejemplo Railway)
- `OWNER_WHATSAPP_NUMBER`: número al que querés derivar, ya cargado con `5492494514175`

### Configuración desde el panel

No necesitás nuevas variables para horarios o agenda online. Eso ahora se guarda en el JSON interno del backend desde el panel:

- zona horaria,
- días activos,
- horarios por día,
- modo de agenda,
- link de agenda online,
- texto del botón y mensaje automático.

## Desarrollo local

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8080`

## Build

```bash
npm run build
npm start
```

## Endpoints

### Público para Meta

- `GET /webhook` → verificación del webhook
- `POST /webhook` → recepción de mensajes y statuses

### Internos para el panel

- `GET /health`
- `GET /api/config`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/interactions`
- `GET /api/webhook-events`

## Cómo conectar con Meta

1. Crear app en Meta for Developers.
2. Agregar producto **WhatsApp**.
3. Obtener:
   - `Phone Number ID`
   - `Access Token`
4. Configurar webhook:
   - Callback URL: `https://TU-BACKEND/webhook`
   - Verify token: el mismo valor de `WEBHOOK_VERIFY_TOKEN`
5. Suscribirse al campo `messages`.
6. Poner el número Cloud API en producción según tu cuenta WABA.

## Cómo usar la agenda online más simple

La integración más liviana para este MVP es:

1. crear tu página de reservas en Google Calendar,
2. copiar el link público,
3. pegarlo en el panel,
4. cambiar el modo a **“Usar link de agenda online”**.

Desde ese momento, cuando la clienta toque **“Agendar turno”**, el bot manda un botón con ese enlace.

## Flujo del MVP

1. La clienta escribe “hola” o cualquier mensaje.
2. El backend envía una lista interactiva.
3. La clienta elige una opción.
4. El backend responde con:
   - link al WhatsApp de Emme, o
   - link de agenda online, según configuración.
5. Se guarda registro local.
6. Cuando Meta envía estados del mensaje, también quedan guardados.

## Notas reales de MVP

- El archivo JSON sirve para validar el flujo. Para producción conviene migrar a Postgres.
- No hay autenticación en el panel porque es MVP. Antes de producción, agregá login o al menos Basic Auth.
- La agenda online por link evita OAuth y reduce mucho la complejidad.

## Próximos pasos recomendados

- Login básico para el panel
- Postgres en Railway
- Servicios/precios
- Bloqueo de slots por duración real
- Google Calendar OAuth solo si necesitás crear eventos desde tu backend

## Deploy en Railway separado (recomendado)

Este repo ya incluye ajustes para deployar **frontend** y **backend** como servicios distintos en Railway.

### Backend

- Root Directory: `backend`
- Variable clave: `SERVE_FRONTEND=false`
- Callback URL del webhook: `https://TU-BACKEND.up.railway.app/webhook`

### Frontend

- Root Directory: `frontend`
- Variable clave: `VITE_API_BASE_URL=https://TU-BACKEND.up.railway.app`

### Nota importante sobre el webhook de Meta

Meta verifica el webhook con un `GET` al callback URL y espera `200` devolviendo exactamente el `hub.challenge` cuando el verify token coincide.

Más detalle operativo en `RAILWAY_DEPLOY.md`.
