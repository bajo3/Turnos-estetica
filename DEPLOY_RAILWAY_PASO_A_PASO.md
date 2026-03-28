# Deploy en Railway — bundle listo

Este zip queda preparado para desplegar **3 servicios**:

1. `backend`
2. `frontend`
3. `evolution-api`

---

## 1. Backend

Crear servicio en Railway con root directory: `backend`

Variables mínimas:

```env
HOST=0.0.0.0
APP_BASE_URL=https://TU-BACKEND.up.railway.app
FRONTEND_ORIGIN=https://TU-FRONTEND.up.railway.app
SERVE_FRONTEND=false

EVOLUTION_API_URL=https://TU-EVOLUTION.up.railway.app
EVOLUTION_API_KEY=TU_API_KEY
EVOLUTION_INSTANCE=emme-estetica

OWNER_WHATSAPP_NUMBER=5492494XXXXXXX
OWNER_DISPLAY_NAME=Emme
SALON_NAME=Emme Estetica

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://TU-BACKEND.up.railway.app/auth/google/callback
GOOGLE_CALENDAR_ID=primary
```

Opcional para persistencia local del JSON:

- Mount volume en `/app/data`
- Agregar variable `DATA_DIR=/app/data`

Healthcheck:

```text
/health
```

---

## 2. Frontend

Crear servicio con root directory: `frontend`

Variables:

```env
VITE_API_BASE_URL=https://TU-BACKEND.up.railway.app
```

---

## 3. Evolution API

Crear servicio con root directory: `evolution-api`

Además crear y conectar dentro del proyecto:

- PostgreSQL
- Redis
- Volume montado en `/evolution/instances`

Variables: usar `evolution-api/.env.example`

---

## 4. Flujo de conexión

1. Deployar Evolution.
2. Copiar URL pública y API key en backend.
3. Deployar backend.
4. Deployar frontend.
5. En el panel, ejecutar:
   - preparar instancia
   - obtener QR
   - escanear QR
6. Conectar Google Calendar.
7. Probar sync y envío manual.

---

## 5. Webhooks

### Evolution → backend

El backend publica:

```text
/webhook/evolution
```

Por eso en backend `APP_BASE_URL` debe ser la URL pública real.

### Google OAuth redirect

```text
/auth/google/callback
```

---

## 6. Orden recomendado en Railway

1. Evolution API
2. Backend
3. Frontend

---

## 7. Qué corrige este bundle

- Dockerfile agregado para backend.
- Dockerfile agregado para frontend.
- Servicio separado para Evolution API.
- Variables de ejemplo listas.
- Guía de deploy unificada.
