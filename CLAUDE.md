# 🧠 CLAUDE.md — curbradar_backend

> **Lee primero** el CLAUDE.md del proyecto backup (`curb_radar_backup/CLAUDE.md`) para el contexto completo del negocio.
> Este archivo cubre exclusivamente el backend Node.js.

---

## Arquitectura Híbrida — Qué conservamos de Firebase (GRATIS)

```
Firebase Auth     ✅ SE CONSERVA  → el cliente hace login, obtiene ID Token
Firebase Storage  ✅ SE CONSERVA  → el BACKEND sube imágenes (no el cliente)
Firebase FCM      ✅ SE CONSERVA  → notificaciones push via Admin SDK
─────────────────────────────────────────────────────
Firestore         ❌ REEMPLAZADO  → MongoDB en el VPS (gratis, ya pagado)
```

**Por qué esta decisión:** Los tres servicios de Firebase que conservamos son **gratis
indefinidamente** (o casi). Firestore es el único que escala en costo con cada listener
de tiempo real. Socket.io en nuestro propio VPS cuesta $0 extra.

---

## Stack Completo

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js ≥ 18 |
| Framework | Express 4 |
| Base de datos | MongoDB (Mongoose) en el VPS |
| Auth | Firebase Admin SDK — verifica ID Tokens del cliente |
| Storage | Firebase Storage via Admin SDK (imágenes) |
| Tiempo real | **Socket.io** — reemplaza los Streams de Firestore |
| Push notifications | Firebase FCM via Admin SDK |
| IA | Google Generative AI — Gemini 2.5 Flash |
| Cron | node-cron — limpia objetos expirados cada hora |
| Proceso | **PM2** en Ubuntu VPS (Hostinger) |

---

## Dominio y URLs

```
Dominio:   curbradar.tech
API prod:  https://api.curbradar.tech/api
WS prod:   wss://api.curbradar.tech
Dev local: http://localhost:3000/api
```

> Nginx actúa como reverse proxy: recibe en 443 (SSL) → redirige a localhost:3000

---

## Estructura de Archivos

```
curbradar_backend/
├── server.js                    ← Entry point: Express + Socket.io + boot
├── ecosystem.config.js          ← PM2 config para el VPS
├── package.json
├── .env.example                 ← Variables de entorno (copiar a .env)
├── .env                         ← ⚠️ NO commitear — credenciales reales
├── firebase-service-account.json ← ⚠️ NO commitear — clave privada Firebase
├── logs/                        ← Logs de PM2 (auto-creados)
└── src/
    ├── config/
    │   ├── database.js          ← Conexión Mongoose a MongoDB
    │   └── firebase.js          ← Firebase Admin SDK init (Auth + Storage + FCM)
    ├── models/                  ← Schemas de Mongoose
    │   ├── CurbObject.js        ← ⭐ Objeto en la calle (índice 2dsphere)
    │   ├── User.js              ← Usuario + gamificación + FCM token
    │   ├── ChatMessage.js       ← Mensajes de chat por objeto
    │   ├── Alert.js             ← Historial de alertas de proximidad
    │   ├── Report.js            ← Reportes de moderación
    │   ├── Request.js           ← "Se busca" — búsquedas de objetos
    │   └── Comment.js           ← Comentarios en objetos
    ├── routes/                  ← Express Routers (1 archivo por dominio)
    │   ├── auth.routes.js       ← POST /auth/verify, /auth/logout
    │   ├── objects.routes.js    ← CRUD objetos + claim + confirm + ETA
    │   ├── users.routes.js      ← Perfil + ranking + favoritos + ubicación RT
    │   ├── chat.routes.js       ← GET/POST mensajes + Socket.io emit
    │   ├── alerts.routes.js     ← Historial alertas de proximidad
    │   ├── requests.routes.js   ← "Se busca"
    │   ├── admin.routes.js      ← Moderación (requiere role=admin)
    │   └── upload.routes.js     ← POST /upload/image → Firebase Storage
    ├── middlewares/
    │   ├── auth.middleware.js   ← Verifica Firebase ID Token → req.firebaseUid
    │   ├── admin.middleware.js  ← Verifica req.user.role === 'admin'
    │   └── error.middleware.js  ← Handler global de errores JSON
    ├── services/
    │   ├── upload.service.js    ← Sube imágenes a Firebase Storage (Admin SDK)
    │   ├── notification.service.js ← FCM push via Admin SDK
    │   ├── ai.service.js        ← Gemini image analysis
    │   └── expiry.service.js    ← Cron: expira objetos 48h y claims 2h
    └── utils/
        ├── pointsUtils.js       ← Constantes de puntos + cálculo de nivel
        └── geoUtils.js          ← Haversine + conversión coords MongoDB↔Flutter
```

---

## Socket.io — Eventos en Tiempo Real

### Salas
| Sala | Quién entra | Para qué |
|------|-------------|---------|
| `map` | Usuario con mapa abierto | Recibir nuevos objetos y cambios de estado |
| `object_{id}` | Usuario en detalle/chat | Mensajes de chat + cambios del objeto |
| `hunters` | Usuario modo caza activo | Ver ubicación de otros cazadores en vivo |

### Eventos: Servidor → Cliente
| Evento | Payload | Cuándo |
|--------|---------|--------|
| `object:new` | `{ object }` | Nuevo objeto publicado |
| `object:updated` | `{ objectId, status, ... }` | Cambio de estado, ETA, confirmación |
| `object:deleted` | `{ objectId }` | Objeto recogido o expirado |
| `hunter:location` | `{ firebaseUid, lat, lng }` | Cazador actualizó posición |
| `newMessage` | `{ message }` | Mensaje de chat |

### Eventos: Cliente → Servidor
| Evento | Payload | Acción |
|--------|---------|--------|
| `joinMap` | — | Entrar a sala del mapa |
| `leaveMap` | — | Salir del mapa |
| `joinObject` | `objectId` | Entrar al chat/detalle |
| `leaveObject` | `objectId` | Salir del objeto |
| `joinHunters` | — | Ver cazadores activos |
| `updateLocation` | `{ lat, lng, firebaseUid }` | Actualizar posición propia |

---

## API REST — Endpoints

```
POST   /api/auth/verify              → Crear/obtener usuario MongoDB (primer login)
POST   /api/auth/logout              → Limpiar token FCM + isOnline=false

GET    /api/objects?lat&lng&radius   → Objetos cercanos con filtros
POST   /api/objects                  → Crear objeto (emite object:new por Socket)
GET    /api/objects/:id              → Detalle de objeto
PATCH  /api/objects/:id/status       → Cambiar estado (emite object:updated/deleted)
POST   /api/objects/:id/confirm      → Confirmar que sigue ahí
PATCH  /api/objects/:id/eta          → Actualizar ETA del claim
GET    /api/objects/:id/comments     → Comentarios
POST   /api/objects/:id/comments     → Añadir comentario
POST   /api/objects/:id/report       → Reportar objeto

GET    /api/users/me                 → Perfil propio
PATCH  /api/users/me                 → Actualizar username/foto
PATCH  /api/users/me/location        → Ubicación en tiempo real
PATCH  /api/users/me/favorites/:id   → Toggle favorito
GET    /api/users/me/objects         → Mis publicaciones
GET    /api/users/me/favorites       → Objetos guardados
GET    /api/users/ranking            → Leaderboard
GET    /api/users/active-hunters     → Cazadores online
GET    /api/users/:uid               → Perfil público

GET    /api/chat/:objectId           → Historial de mensajes
POST   /api/chat/:objectId           → Enviar mensaje (emite newMessage por Socket)

GET    /api/alerts                   → Mis alertas de proximidad
POST   /api/alerts                   → Guardar alerta
PATCH  /api/alerts/:id/read          → Marcar como leída

GET    /api/requests                 → "Se busca" activas
POST   /api/requests                 → Crear búsqueda
PATCH  /api/requests/:id/resolve     → Marcar como resuelta

POST   /api/upload/image             → Subir imagen → Firebase Storage → URL

GET    /api/admin/reports            → Ver reportes (admin)
PATCH  /api/admin/reports/:id/dismiss → Descartar reporte
DELETE /api/admin/objects/:id        → Eliminar objeto (moderación)
DELETE /api/admin/objects            → Eliminar todos (¡cuidado!)
GET    /api/admin/users              → Ver todos los usuarios
PATCH  /api/admin/users/:uid/role    → Cambiar rol
```

---

## Reglas CRÍTICAS — Nunca violar

1. **NUNCA usar `req.body.userId`** — siempre `req.firebaseUid` (viene del token verificado)
2. **Coordenadas MongoDB** = `[longitude, latitude]` (orden invertido vs Flutter/estándar)
3. **Objetos eliminados** = soft delete (`isDeleted: true`), nunca borrar de MongoDB
4. **Puntos y niveles** = solo el servidor los calcula, nunca confiar en el cliente
5. **Claims** = verificar que no haya claim activo antes de asignar `onMyWay`
6. **API Keys** = TODAS en `.env`, NUNCA en el código fuente
7. **Imágenes** = el cliente envía al backend, el backend sube a Firebase Storage
8. **Socket.io** = emitir eventos SIEMPRE que un objeto cambie de estado

---

## PM2 en el VPS

```bash
# Primera vez
npm install
cp .env.example .env      # rellenar con valores reales
mkdir -p logs
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup               # copiar y ejecutar el comando que genera

# Despliegues siguientes (zero-downtime)
git pull
npm install
pm2 reload curbradar-backend

# Ver logs en vivo
pm2 logs curbradar-backend
```

---

## Variables de Entorno Requeridas

Ver `.env.example` para la lista completa. Mínimo para arrancar:
- `MONGODB_URI`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_SERVICE_ACCOUNT_PATH` o `FIREBASE_SERVICE_ACCOUNT_JSON`
- `GEMINI_API_KEY`
