# Deploy en Railway

## Diagnóstico del problema original

### Frontend · 502 Bad Gateway

El frontend no tenía script `start` para producción y `vite preview` estaba escuchando solo en `localhost`.
En Railway eso suele terminar en `502`, porque el proxy no puede conectarse al proceso si no expone `0.0.0.0` y el `PORT` inyectado.

### Backend / Meta webhook

Había dos puntos frágiles:

1. El backend asumía que siempre existía `frontend/dist`, aunque el frontend estuviera desplegado en otro servicio.
2. La base JSON usaba `process.cwd()`, lo que generaba rutas inconsistentes como `backend/backend/data/db.json` según desde dónde arrancara el proceso.

## Cómo deployar separado

### Servicio 1: backend

- Root Directory: `backend`
- Build/Install: automático por `nixpacks.toml`
- Start: automático por `nixpacks.toml`

Variables mínimas:

- `PORT` → lo inyecta Railway
- `HOST=0.0.0.0`
- `FRONTEND_ORIGIN=https://TU-FRONTEND.up.railway.app`
- `WEBHOOK_VERIFY_TOKEN=...`
- `META_ACCESS_TOKEN=...`
- `META_PHONE_NUMBER_ID=...`
- `OWNER_WHATSAPP_NUMBER=549...`
- `OWNER_DISPLAY_NAME=Emme`
- `SALON_NAME=Emme Estetica`
- `SERVE_FRONTEND=false`

Webhook en Meta:

- Callback URL: `https://TU-BACKEND.up.railway.app/webhook`
- Verify token: exactamente el mismo `WEBHOOK_VERIFY_TOKEN`

Chequeos:

- `GET /health`
- `GET /webhook?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=1234`

### Servicio 2: frontend

- Root Directory: `frontend`
- Build/Install: automático por `nixpacks.toml`
- Start: automático por `nixpacks.toml`

Variables:

- `PORT` → lo inyecta Railway
- `VITE_API_BASE_URL=https://TU-BACKEND.up.railway.app`

## Si querés deploy único

También podés usar un solo servicio con build del frontend y backend sirviendo `frontend/dist`.
En ese caso no pongas `SERVE_FRONTEND=false`.

## Qué validar después del deploy

1. El frontend abre sin `502`.
2. El backend responde `200` en `/health`.
3. La verificación del webhook devuelve el `hub.challenge`.
4. Cuando escribís al número de WhatsApp, aparecen eventos en `/api/webhook-events`.
