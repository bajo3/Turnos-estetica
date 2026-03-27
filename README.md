# Emme Estetica · MVP WhatsApp Cloud API

MVP full stack para **Emme Estetica**.

## Qué hace

- Recibe mensajes entrantes desde **WhatsApp Cloud API** por webhook.
- Muestra un menú para:
  - Agendar turno
  - Cambiar turno
  - Cancelar turno
  - Hablar con Emme
- Cuando la clienta elige una opción, el bot **no agenda**: deriva a otro WhatsApp con mensaje prellenado para que **Emme** coordine manualmente.
- Guarda registros de interacciones y webhooks en un archivo **JSON local**.
- Expone un panel web simple para ver logs, interacciones y configuración activa.

## Decisión técnica importante

WhatsApp **reply buttons** admiten hasta **3 opciones**, así que para estas 4 acciones el MVP usa un **interactive list message**. Si más adelante querés, se puede pasar a:

- 3 botones + 1 mensaje adicional, o
- un flujo de varios pasos.

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

## Flujo del MVP

1. La clienta escribe “hola” o cualquier mensaje.
2. El backend envía una lista interactiva con 4 opciones.
3. La clienta elige una opción.
4. El backend responde con un botón que abre el WhatsApp de Emme con texto prellenado.
5. Se guarda registro local.
6. Cuando Meta envía estados del mensaje, también quedan guardados.

## Notas reales de MVP

- El archivo JSON sirve para validar el flujo. Para producción conviene migrar a Postgres.
- No hay autenticación en el panel porque es MVP. Antes de producción, agregá login o al menos Basic Auth.
- No hay lógica de agenda ni calendario: este bot solo **captura, deriva y registra**.

## Próximos pasos recomendados

- Login básico para el panel
- Postgres en Railway
- Etiquetas por servicio
- Plantillas aprobadas para seguimientos fuera de ventana
- Dashboard de métricas



## Deploy en Railway separado (recomendado)

Este repo ya incluye ajustes para deployar **frontend** y **backend** como servicios distintos en Railway.

### Backend

- Root Directory: `backend`
- Variable clave: `SERVE_FRONTEND=false`
- Callback URL del webhook: `https://TU-BACKEND.up.railway.app/webhook`

### Frontend

- Root Directory: `frontend`
- Variable clave: `VITE_API_BASE_URL=https://TU-BACKEND.up.railway.app`

### Nota importante sobre el 502

En Railway, un `502 Bad Gateway` suele significar que el proceso no está escuchando en `0.0.0.0` y en el `PORT` inyectado, o que el dominio apunta a un puerto incorrecto. Railway lo documenta así en su guía de troubleshooting.

### Nota importante sobre el webhook de Meta

Meta verifica el webhook con un `GET` al callback URL y espera `200` devolviendo exactamente el `hub.challenge` cuando el verify token coincide.

Más detalle operativo en `RAILWAY_DEPLOY.md`.
