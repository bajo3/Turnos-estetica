# Evolution API para Railway

## Crear servicio

1. New Service → Deploy from GitHub o subir esta carpeta.
2. Agregar PostgreSQL.
3. Agregar Redis.
4. Agregar Volume montado en:

```text
/evolution/instances
```

## Variables

Copiá `.env.example` y cargá esas variables en Railway.

## Endpoints que usa el backend

- Base URL: `https://TU-EVOLUTION.up.railway.app`
- API key: `AUTHENTICATION_API_KEY`
- Instancia: la define el backend con `EVOLUTION_INSTANCE`

## En el backend

Cargar:

```env
EVOLUTION_API_URL=https://TU-EVOLUTION.up.railway.app
EVOLUTION_API_KEY=TU_API_KEY
EVOLUTION_INSTANCE=emme-estetica
```
