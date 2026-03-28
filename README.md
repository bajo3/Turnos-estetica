# Turnos Estética — Recordatorios WhatsApp

Sistema de recordatorios automáticos via WhatsApp para salones de estética.

## Cómo funciona

1. **WhatsApp** se conecta via Evolution API con código QR
2. **Google Calendar** se sincroniza automáticamente
3. El sistema lee los turnos del calendario y **envía recordatorios** a los teléfonos que figuren en el evento
4. Un panel web muestra el estado, los turnos y los recordatorios enviados

## Cómo agregar un teléfono a un turno en Google Calendar

En el **título** o **descripción** del evento incluí el número:

```
Manicura - María 11 2345-6789
```

O en la descripción:
```
Cliente: María López
Teléfono: 11 2345-6789
```

## Setup

### 1. Configurar variables de entorno

Copiá `.env.example` → `.env` y completá los valores.

### 2. Evolution API

Necesitás una instancia de Evolution API corriendo.
Deploy gratuito en Railway: https://railway.app

```
# En el panel: Preparar instancia → Obtener QR → Escanear con WhatsApp
```

### 3. Google Calendar

En el panel hacé click en **Conectar Google** y autorizá el acceso.

### 4. Deploy en Railway

```bash
# Backend
railway up --service backend

# Frontend  
railway up --service frontend
```

## Stack

- **Backend**: Node.js + Express
- **WhatsApp**: Evolution API (Baileys/QR)
- **Calendario**: Google Calendar API (OAuth)
- **DB**: JSON file (simple, sin dependencias externas)
- **Frontend**: React + Vite
- **Deploy**: Railway
