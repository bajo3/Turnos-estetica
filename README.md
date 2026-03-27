# Emme Estetica · Evolution QR + Google Calendar

MVP full stack para conectar WhatsApp por **Evolution API + QR** y tomar a **Google Calendar** como fuente de verdad de los turnos.

## Qué hace

- Conecta un número de WhatsApp mediante **Evolution API**.
- Guarda mensajes entrantes y salientes en un JSON local.
- Conecta **Google Calendar** por OAuth 2.0.
- Sincroniza eventos del calendario y los muestra en el panel.
- Detecta turnos próximos y manda **recordatorios por WhatsApp**.
- Respeta reglas operativas:
  - solo recordatorios,
  - solo contactos existentes si así lo configurás,
  - límite diario,
  - pausas aleatorias entre envíos,
  - botón de apagado fácil.

## Regla importante para que funcione el recordatorio

Cada evento del calendario debe incluir un **teléfono** en el título o la descripción. Ejemplo:

```txt
Depilación - Ana Pérez
Cliente: Ana Pérez
Tel: 5492494123456
```

Sin teléfono, el turno se sincroniza igual, pero queda con estado `missing_phone` y no se puede enviar recordatorio.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Persistencia: JSON local
- WhatsApp: Evolution API (Baileys / QR)
- Calendario: Google Calendar API (OAuth web app)

## Variables de entorno

Copiá `.env.example` a `.env` y completá:

```bash
cp .env.example .env
```

### Requeridas para QR

- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE`
- `APP_BASE_URL`

### Requeridas para Google Calendar

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_CALENDAR_ID` (`primary` sirve en la mayoría de los casos)

## Desarrollo local

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8080`

## Endpoints internos útiles

- `GET /health`
- `GET /api/config`
- `GET /api/interactions`
- `GET /api/contacts`
- `GET /api/appointments`
- `GET /api/evolution/status`
- `POST /api/evolution/ensure-instance`
- `GET /api/evolution/qr`
- `GET /auth/google`
- `GET /api/google/status`
- `POST /api/google/sync`
- `POST /api/reminders/run`

## Flujo recomendado

1. Preparar la instancia de Evolution.
2. Pedir el QR y escanearlo con el WhatsApp del negocio.
3. Conectar Google Calendar desde el panel.
4. Crear turnos en Google Calendar con nombre y teléfono.
5. Sincronizar agenda o esperar al proceso automático.
6. Procesar recordatorios o dejar que corran por intervalo.

## Nota de producción

Este MVP usa JSON local. Para producción real, conviene migrar la persistencia a Postgres o SQLite.
