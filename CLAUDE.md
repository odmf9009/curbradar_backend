# 🧠 CLAUDE.md — curbradar_backend

> **LEE ESTE ARCHIVO COMPLETO ANTES DE HACER CUALQUIER TAREA.**
> Cubre exclusivamente el backend Node.js. Para contexto de negocio completo, lee también
> `curb_radar_backup/CLAUDE.md` (reglas de negocio, flujos de usuario, historia del proyecto).

---

## 1. ¿Qué es este proyecto?

`curbradar_backend/` es la API REST + WebSocket de **CurbRadar** en su arquitectura híbrida.
Sustituye Firestore como base de datos y centraliza toda la lógica de negocio.

**Lo que hace este backend:**
- Verifica tokens de Firebase Auth en **cada request** → nunca confía en el cliente
- Gestiona los objetos en la calle con MongoDB + índice geoespacial `2dsphere`
- Emite eventos Socket.io en tiempo real cuando un objeto cambia (reemplaza Firestore Streams)
- Sube imágenes a Firebase Storage con el Admin SDK (el cliente Flutter nunca toca Storage)
- Envía push notifications via FCM con el Admin SDK
- Analiza imágenes de objetos con Gemini 2.5 Flash (la clave nunca está en el APK)
- Expira objetos (48h) y claims (2h) automáticamente con un cron job cada hora

---

## 2. Qué Firebase conservamos (y por qué es GRATIS)

```
Firebase Auth Admin SDK  ✅ SE USA → verifica ID Tokens del cliente en cada request
Firebase Storage         ✅ SE USA → el backend sube las imágenes con Admin SDK
Firebase FCM Admin SDK   ✅ SE USA → push notifications a los dispositivos
─────────────────────────────────────────────────────────────────────────────────
Firestore                ❌ NO SE USA → reemplazado por MongoDB (VPS ya pagado, $0 extra)
```

**Por qué esta decisión:** Firestore cobra por cada listener activo en tiempo real.
Socket.io en nuestro VPS de Hostinger tiene costo $0 extra y da la misma UX.

---

## 3. Stack Completo

| Capa | Tecnología | Versión / Notas |
|------|-----------|----------------|
| Runtime | Node.js | ≥ 18 LTS |
| Framework | Express 4 | REST API |
| Base de datos | MongoDB + Mongoose | Índice `2dsphere` para geoquerías |
| Auth | Firebase Admin SDK | Verifica ID Tokens de Flutter |
| Storage | Firebase Storage (Admin) | El cliente nunca sube directo |
| Push | Firebase FCM (Admin) | `sendEachForMulticast` |
| Tiempo real | **Socket.io** | Reemplaza Firestore Streams |
| IA | Google Generative AI | Gemini 2.5 Flash |
| File uploads | Multer | `memoryStorage` → directo a Firebase Storage |
| Cron | node-cron | Limpieza de expirados cada hora |
| Proceso | PM2 | Ubuntu VPS Hostinger |
| Seguridad | helmet, cors, express-rate-limit | Rate limit: 200 req/15min |
| Logs | morgan | `combined` en prod, `dev` en local |

---

## 4. Estructura de Archivos

```
curbradar_backend/
├── server.js                        ← ⭐ Entry point: Express + Socket.io + boot
├── ecosystem.config.js              ← PM2 config (nombre proceso, logs, memoria máx.)
├── package.json
├── .env.example                     ← Plantilla de variables de entorno
├── .env                             ← ⚠️ NO commitear — credenciales reales
├── firebase-service-account.json    ← ⚠️ NO commitear — clave privada Firebase
├── logs/                            ← Creado automáticamente por PM2
└── src/
    ├── config/
    │   ├── database.js              ← Conexión Mongoose a MongoDB
    │   └── firebase.js              ← Firebase Admin SDK init (Auth + Storage + FCM)
    ├── models/                      ← Schemas de Mongoose
    │   ├── CurbObject.js            ← ⭐ Objeto en la calle (índice 2dsphere)
    │   ├── User.js                  ← Usuario + gamificación + FCM token
    │   ├── ChatMessage.js           ← Mensajes de chat por objeto
    │   ├── Alert.js                 ← Alertas de proximidad (1 por user+objeto)
    │   ├── Report.js                ← Reportes de moderación
    │   ├── Request.js               ← "Se busca" — búsquedas de objetos
    │   └── Comment.js               ← Comentarios en objetos
    ├── routes/                      ← Express Routers
    │   ├── auth.routes.js           ← POST /auth/verify, /auth/logout
    │   ├── objects.routes.js        ← ⭐ CRUD objetos + claim + confirm + ETA
    │   ├── users.routes.js          ← Perfil + ranking + favoritos + ubicación
    │   ├── chat.routes.js           ← GET/POST mensajes + Socket emit
    │   ├── alerts.routes.js         ← Historial alertas de proximidad
    │   ├── requests.routes.js       ← "Se busca"
    │   ├── upload.routes.js         ← POST /upload/image → Firebase Storage
    │   └── admin.routes.js          ← Moderación (requiere role=admin)
    ├── middlewares/
    │   ├── auth.middleware.js       ← ⭐ Verifica Firebase ID Token → req.firebaseUid
    │   ├── admin.middleware.js      ← Verifica req.user.role === 'admin'
    │   └── error.middleware.js      ← Handler global de errores JSON
    ├── services/
    │   ├── notification.service.js  ← FCM push via Admin SDK
    │   ├── upload.service.js        ← Sube/elimina imágenes en Firebase Storage
    │   ├── ai.service.js            ← Gemini 2.5 Flash — analiza imágenes de objetos
    │   └── expiry.service.js        ← Cron: soft-delete expirados + reset claims
    └── utils/
        ├── pointsUtils.js           ← Constantes de puntos + cálculo de nivel/título
        └── geoUtils.js              ← Haversine + conversión coords MongoDB↔Flutter
```

---

## 5. Dominio y URLs

```
Dominio:        curbradar.tech
API producción: https://api.curbradar.tech/api
WS producción:  wss://api.curbradar.tech
Dev local:      http://localhost:3000/api
Health check:   http://localhost:3000/health
```

Nginx actúa como reverse proxy: `443 (SSL) → localhost:3000`.
El servidor escucha en `0.0.0.0` para ser accesible desde Nginx.

---

## 6. Middlewares

### 6.1 authMiddleware (`auth.middleware.js`) ⭐

**Aplicado a todas las rutas protegidas.** Es la pieza de seguridad más crítica.

```
Flujo:
  Header: Authorization: Bearer <Firebase ID Token>
    → admin.auth().verifyIdToken(idToken)
    → req.firebaseUid = decodedToken.uid       ← SIEMPRE usar esto para identificar al usuario
    → req.user = await User.findOne(...)        ← Puede ser null si es primer login
    → next()
```

**Errores que maneja:**
- Sin header → `401 Token de autenticación requerido`
- Token expirado → `401 Token expirado, vuelve a iniciar sesión`
- Token inválido → `401 Token inválido`

### 6.2 adminMiddleware (`admin.middleware.js`)

```javascript
// Aplicado en /api/admin/* además de authMiddleware:
if (req.user?.role !== 'admin') → 403 Acceso denegado
```

### 6.3 errorMiddleware (`error.middleware.js`)

Handler de último recurso. Convierte errores a JSON:
```json
{ "error": "Mensaje descriptivo", "stack": "..." }
```
En producción no expone el stack.

---

## 7. API REST — Todos los Endpoints

> Todos los endpoints requieren `Authorization: Bearer <token>` salvo `/health`.
> Los endpoints de `/api/admin/*` requieren además `role: 'admin'`.

### Auth (`/api/auth`)

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| POST | `/auth/verify` | `{ fcmToken? }` | `{ user }` — crea o retorna usuario MongoDB |
| POST | `/auth/logout` | — | `{ message }` — limpia fcmToken, isOnline=false |

### Objetos (`/api/objects`)

| Método | Ruta | Query / Body | Respuesta |
|--------|------|-------------|-----------|
| GET | `/objects` | `?lat&lng&radius&category&status&timeRange&searchQuery&page&limit` | `{ objects[], total }` |
| POST | `/objects` | `{ title, description, category, imageUrls[], latitude, longitude, address, locality, estimatedValue }` | `{ object }` + Socket `object:new` |
| GET | `/objects/:id` | — | `{ object }` (incrementa `views`) |
| PATCH | `/objects/:id/status` | `{ status: 'available'|'onMyWay'|'pickedUp' }` | `{ message, status }` + Socket `object:updated` o `object:deleted` |
| POST | `/objects/:id/confirm` | — | `{ message, firstTime: bool }` + Socket `object:updated` |
| PATCH | `/objects/:id/eta` | `{ eta: string }` | `{ message }` + Socket `object:updated` |
| GET | `/objects/:id/comments` | — | `{ comments[] }` |
| POST | `/objects/:id/comments` | `{ text }` | `{ comment }` |
| POST | `/objects/:id/report` | `{ reason, description? }` | `{ message }` |

### Usuarios (`/api/users`)

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| GET | `/users/ranking` | `?limit=50` | `{ users[] }` |
| GET | `/users/me` | — | `{ user }` |
| PATCH | `/users/me` | `{ username?, profileImageUrl? }` | `{ user }` |
| PATCH | `/users/me/location` | `{ latitude, longitude, isOnline }` | `{ message }` |
| PATCH | `/users/me/favorites/:objectId` | `{ isFavorite: bool }` | `{ message }` |
| GET | `/users/me/objects` | — | `{ objects[] }` |
| GET | `/users/me/favorites` | — | `{ objects[] }` |
| GET | `/users/active-hunters` | — | `{ hunters[] }` |
| GET | `/users/:uid` | — | `{ user }` perfil público |

### Chat (`/api/chat`)

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| GET | `/chat/:objectId` | — | `{ messages[] }` |
| POST | `/chat/:objectId` | `{ text }` | `{ message }` + Socket `newMessage` |

### Alertas (`/api/alerts`)

| Método | Ruta | Respuesta |
|--------|------|-----------|
| GET | `/alerts` | `{ alerts[] }` del usuario autenticado |
| POST | `/alerts` | `{ alert }` — guarda nueva alerta de proximidad |
| PATCH | `/alerts/:id/read` | `{ message }` |
| PATCH | `/alerts/read-all` | `{ message }` |

### "Se Busca" (`/api/requests`)

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| GET | `/requests` | `?lat&lng&radius` | `{ requests[] }` |
| POST | `/requests` | `{ title, description, category, city, latitude, longitude }` | `{ request }` |
| PATCH | `/requests/:id/resolve` | — | `{ message }` |

### Upload (`/api/upload`)

| Método | Ruta | Form-data | Respuesta |
|--------|------|-----------|-----------|
| POST | `/upload/image` | `file` (img), `folder?` ('objects'/'profiles') | `{ url: "https://storage.googleapis.com/..." }` |

### Admin (`/api/admin`) — solo `role=admin`

| Método | Ruta | Respuesta |
|--------|------|-----------|
| GET | `/admin/reports` | `{ reports[] }` pendientes |
| PATCH | `/admin/reports/:id/dismiss` | `{ message }` |
| DELETE | `/admin/objects/:id` | `{ message }` soft-delete por moderación |
| DELETE | `/admin/objects` | `{ message }` ⚠️ soft-delete de TODOS los objetos |
| GET | `/admin/users` | `{ users[] }` todos los usuarios |
| PATCH | `/admin/users/:uid/role` | `{ role }` cambia a 'user' o 'admin' |

### Health

| Método | Ruta | Respuesta |
|--------|------|-----------|
| GET | `/health` | `{ status, env, timestamp }` — sin autenticación |

---

## 8. Socket.io — Tiempo Real

El servidor Socket.io se registra en `app.set('io', io)` para ser accesible desde cualquier route:
```javascript
const io = req.app.get('io');
io.to('map').emit('object:new', { object: clientObj });
```

### Salas (Rooms)

| Sala | Quién entra | Para qué |
|------|-------------|---------|
| `map` | Usuario con mapa abierto | Recibir nuevos objetos y cambios de estado |
| `object_{id}` | Usuario en detalle/chat | Mensajes de chat + cambios del objeto |
| `hunters` | Usuario en modo caza activo | Ver ubicación de otros cazadores en vivo |

### Eventos: Servidor → Cliente

| Evento | Payload | Cuándo se emite |
|--------|---------|----------------|
| `object:new` | `{ object }` | POST /objects exitoso |
| `object:updated` | `{ objectId, status?, claimedByUserId?, claimedAt?, lastConfirmedAt?, claimedUserEta? }` | PATCH status (available/onMyWay), POST confirm, PATCH eta |
| `object:deleted` | `{ objectId }` | PATCH status=pickedUp, admin delete, cron expiry |
| `hunter:location` | `{ firebaseUid, lat, lng }` | Cliente emite `updateLocation` |
| `newMessage` | `{ message }` | POST /chat/:objectId |

### Eventos: Cliente → Servidor

| Evento | Payload | Qué hace el servidor |
|--------|---------|---------------------|
| `joinMap` | — | `socket.join('map')` |
| `leaveMap` | — | `socket.leave('map')` |
| `joinObject` | `objectId` | `socket.join('object_${objectId}')` |
| `leaveObject` | `objectId` | `socket.leave('object_${objectId}')` |
| `joinHunters` | — | `socket.join('hunters')` |
| `updateLocation` | `{ lat, lng, firebaseUid }` | Retransmite `hunter:location` a sala `hunters` |

---

## 9. Modelos de Mongoose — Schemas y Campos

### 9.1 CurbObject (`models/CurbObject.js`) ⭐

```javascript
{
  title: String,            // requerido
  description: String,      // default: ''
  category: String,         // enum: ['Muebles','Electrodomésticos','Electrónica','Ropa','Juguetes','Otros']
  imageUrls: [String],

  // ⚠️ CRÍTICO: MongoDB usa [longitude, latitude] — orden INVERTIDO vs Flutter/estándar
  location: {
    type: 'Point',
    coordinates: [Number],  // [longitude, latitude]
  },
  address: String,
  locality: String,

  status: String,           // enum: ['available','onMyWay','pickedUp'], default: 'available'

  // Publicador
  postedByUserId: String,   // Firebase UID
  postedByUserName: String,

  // Claim (quién va en camino)
  claimedByUserId: String,  // null si no hay claim
  claimedByUserName: String,
  claimedAt: Date,
  claimedUserEta: String,

  lastConfirmedAt: Date,    // default: Date.now — para calcular expiración 48h

  // Métricas
  views: Number,
  confirmations: Number,
  estimatedValue: Number,   // USD

  // Chat
  isChatEnabled: Boolean,
  lastMessageAt: Date,
  lastMessageBy: String,

  // Soft delete
  isDeleted: Boolean,       // default: false — NUNCA borrar físicamente
  deletedAt: Date,

  createdAt: Date,          // automático (timestamps: true)
  updatedAt: Date,          // automático
}
```

**Índices:**
```javascript
{ location: '2dsphere' }                   // ← CRÍTICO para $near queries
{ postedByUserId: 1, createdAt: -1 }
{ status: 1, lastConfirmedAt: -1 }
{ isDeleted: 1, status: 1 }
```

**Virtuals:**
```javascript
obj.isExpired       // lastConfirmedAt < (now - 48h) && status !== 'pickedUp'
obj.isClaimExpired  // status === 'onMyWay' && claimedAt < (now - 2h)
```

**Método `toClientFormat()`:**
Convierte `location.coordinates[lng, lat]` a `{ latitude, longitude }` plano para Flutter.
```javascript
const clientObj = curbObject.toClientObject(); // o el helper toClientObject() en routes
// Resultado: { ...campos, latitude: XX, longitude: XX }  — sin campo location
```

### 9.2 User (`models/User.js`)

```javascript
{
  firebaseUid: String,       // unique, index — primary key de identidad
  name: String,
  username: String,          // alias público (sparse index — puede estar vacío)
  email: String,
  profileImageUrl: String,
  points: Number,            // default: 0
  level: Number,             // default: 1
  postsCount: Number,
  foundCount: Number,
  confirmationsCount: Number,
  totalImpactValue: Number,  // USD total recogido
  favorites: [String],       // IDs de objetos guardados
  isOnline: Boolean,
  location: { type: 'Point', coordinates: [Number] },  // [lng, lat]
  lastLocationUpdate: Date,
  fcmToken: String,          // null al hacer logout
  lastActive: Date,
  role: String,              // enum: ['user','admin'], default: 'user'
  isActive: Boolean,         // default: true
}
```

**Índices:**
```javascript
{ firebaseUid: 1 }        // unique
{ location: '2dsphere' }  // para buscar cazadores cercanos
{ points: -1 }            // ranking
{ username: 1 }           // sparse
```

**Virtuals:**
```javascript
user.displayName  // username || 'Cazador Anónimo'
user.levelTitle   // 'Explorador'|'Cazador'|'Experto'|'Leyenda'
```

**Método `toPublicProfile()`:** Devuelve solo campos públicos (sin fcmToken, sin email).

**Método `recalculateLevel()`:** `this.level = Math.floor(this.points / 500) + 1`

### 9.3 ChatMessage (`models/ChatMessage.js`)

```javascript
{
  objectId: ObjectId,      // ref: 'CurbObject', index
  senderId: String,        // firebaseUid
  senderName: String,
  senderImageUrl: String,
  text: String,
  createdAt: Date,         // automático (timestamps: true)
}
// Índice: { objectId: 1, createdAt: -1 }
```

### 9.4 Alert (`models/Alert.js`)

```javascript
{
  userId: String,          // firebaseUid, index
  objectId: String,
  objectTitle: String,
  objectImageUrl: String,
  address: String,
  distance: Number,        // en metros
  isRead: Boolean,
  createdAt: Date,
}
// Índice UNIQUE: { userId: 1, objectId: 1 } — 1 alerta por user+objeto
```

### 9.5 Report (`models/Report.js`)

```javascript
{
  objectId: String,        // index
  reportedByUserId: String,
  reason: String,
  description: String,
  isResolved: Boolean,
  resolvedAt: Date,
  resolvedByUserId: String,
  createdAt: Date,
}
```

### 9.6 Request (`models/Request.js`) — "Se Busca"

```javascript
{
  userId: String,
  userName: String,
  title: String,
  description: String,
  category: String,
  city: String,
  location: { type: 'Point', coordinates: [Number] },
  isResolved: Boolean,
  resolvedAt: Date,
  createdAt: Date,
}
// Índices: { location: '2dsphere' }, { isResolved: 1, createdAt: -1 }
```

### 9.7 Comment (`models/Comment.js`)

```javascript
{
  objectId: ObjectId,      // ref: 'CurbObject', index
  userId: String,
  userName: String,
  userImageUrl: String,
  text: String,
  createdAt: Date,
}
// Índice: { objectId: 1, createdAt: -1 }
```

---

## 10. Servicios — Lógica de Negocio

### 10.1 notificationService (`notification.service.js`)

```javascript
const notif = require('./notification.service');

// Notificar a un usuario específico por firebaseUid
await notif.notifyUser(firebaseUid, 'Título', 'Cuerpo', { objectId: '...' });

// Notificar a usuarios online dentro de 5km del objeto (excluye al publicador)
await notif.notifyNearbyUsers(curbObjectDocument);

// Multicast a array de FCM tokens
await notif.sendMulticast(tokens, 'Título', 'Cuerpo', dataObj);
```

**Canales Android:** `curbradar_alerts` (alta prioridad).
**iOS:** badge=1, sonido por defecto.

### 10.2 uploadService (`upload.service.js`)

```javascript
const { uploadImage, deleteImage } = require('./upload.service');

// Subir buffer de imagen a Firebase Storage
// folder: 'objects' | 'profiles'
const publicUrl = await uploadImage(fileBuffer, 'image/jpeg', 'objects');
// Retorna: https://storage.googleapis.com/BUCKET/objects/UUID.jpg

// Eliminar imagen (cuando usuario actualiza foto o admin borra objeto)
await deleteImage(publicUrl);  // silencioso si no existe
```

**Límites:** máx 10MB, solo `image/jpeg`, `image/png`, `image/webp`.
**Multer** usa `memoryStorage` — el archivo nunca toca el disco del VPS.

### 10.3 aiService (`ai.service.js`)

```javascript
const { analyzeObjectImage } = require('./ai.service');

// imageBuffer: Buffer del archivo de imagen
// mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
const result = await analyzeObjectImage(imageBuffer, 'image/jpeg');
// Retorna: { title: '...', category: 'Muebles', description: '...' }
// o null si falla o la key no está configurada
```

**Modelo:** `gemini-2.5-flash`
**Prompt:** Pide JSON plano `{ title, category, description }`.
**Categorías válidas:** Muebles, Electrodomésticos, Electrónica, Ropa, Juguetes, Otros.

### 10.4 expiryService (`expiry.service.js`)

Cron job que corre **cada hora** (`0 * * * *`):

1. **Objetos expirados (48h):** `lastConfirmedAt < (now - 48h)` → `isDeleted=true`
2. **Claims expirados (2h):** `status=onMyWay && claimedAt < (now - 2h)` → reset a `available`

```javascript
const { startExpiryJob } = require('./expiry.service');
startExpiryJob(); // Llamado en bootstrap() de server.js
```

---

## 11. Utilidades

### 11.1 pointsUtils (`utils/pointsUtils.js`)

```javascript
const { POINTS, calculateLevel, getLevelTitle, pointsToNextLevel } = require('./pointsUtils');

POINTS.POST_OBJECT    // 50  — publicar objeto
POINTS.PICK_OBJECT    // 100 — recoger objeto (pickedUp)
POINTS.CONFIRM_OBJECT // 20  — confirmar que sigue ahí (1 vez por objeto)
POINTS.UPDATE_PHOTO   // 30  — actualizar foto del objeto
POINTS.FIRST_CLAIM    // 10  — primera vez que reclamas

calculateLevel(750)         // → 2  (floor(750/500) + 1)
getLevelTitle(4)            // → 'Explorador'
getLevelTitle(10)           // → 'Cazador'
getLevelTitle(20)           // → 'Experto'
getLevelTitle(35)           // → 'Leyenda'
pointsToNextLevel(750)      // → 250 puntos para el siguiente nivel
```

**Regla:** `Nivel = Math.floor(points / 500) + 1`

### 11.2 geoUtils (`utils/geoUtils.js`)

```javascript
const { distanceBetween, toMongoCoordinates, fromMongoCoordinates } = require('./geoUtils');

// Distancia Haversine en metros
distanceBetween(25.76, -80.19, 25.77, -80.18)  // → metros

// Flutter/estándar → MongoDB (INVERTIR siempre antes de guardar)
toMongoCoordinates(latitude, longitude)  // → [longitude, latitude]

// MongoDB → Flutter/estándar
fromMongoCoordinates([longitude, latitude])  // → { latitude, longitude }
```

---

## 12. Reglas de Negocio Críticas

### Claim (`onMyWay`)
```
Validaciones ANTES de asignar onMyWay:
  1. El objeto NO tiene claim activo (o su claim expiró)
  2. El solicitante NO es el publicador del objeto
  3. El solicitante NO tiene otro claim activo en otro objeto

Al asignar:
  → claimedByUserId = req.firebaseUid
  → claimedAt = new Date()
  → lastConfirmedAt = new Date()  ← reinicia el timer de 48h

Expiración automática (cron cada hora):
  claimedAt < (now - 2h) → reset a available, claimedByUserId=null
```

### Expiración de objetos
```
Cada hora el cron busca:
  isDeleted=false && lastConfirmedAt < (now - 48h)
  → isDeleted=true, deletedAt=now

Para consultas de objetos activos SIEMPRE filtrar:
  { isDeleted: false, lastConfirmedAt: { $gt: expiryLimit } }
```

### Soft Delete
```
Nunca usar deleteOne() o deleteMany() en CurbObject.
Siempre: { $set: { isDeleted: true, deletedAt: new Date() } }
Esto aplica a: pickedUp, expiración 48h, borrado por admin.
```

### Puntos y nivel
```
El SERVIDOR calcula y guarda los puntos, nunca el cliente.
Cada vez que se suman puntos → recalcular level:
  newLevel = Math.floor(updatedPoints / 500) + 1
  Si newLevel !== user.level → actualizar level en DB
```

### Coordenadas
```
MongoDB:  coordinates: [longitude, latitude]  ← ORDEN INVERTIDO
Flutter:  latitude, longitude                  ← orden estándar

Al guardar: toMongoCoordinates(lat, lng)      → [lng, lat]
Al enviar:  { latitude: coords[1], longitude: coords[0] }
            O usar toClientObject() / toClientFormat()
```

---

## 13. Configuración — Variables de Entorno

Crear `.env` copiando `.env.example`:

```bash
cp .env.example .env
```

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `PORT` | No | Puerto del servidor (default: 3000) |
| `NODE_ENV` | No | `development` o `production` |
| `MONGODB_URI` | ✅ | URI de conexión a MongoDB |
| `FIREBASE_PROJECT_ID` | ✅ | `curbradar-6d8f0` |
| `FIREBASE_STORAGE_BUCKET` | ✅ | `curbradar-6d8f0.appspot.com` |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | ⚠️ uno de los dos | Ruta al JSON local (dev) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | ⚠️ uno de los dos | JSON inline (VPS/producción) |
| `GEMINI_API_KEY` | ✅ | Clave de Google AI Studio |
| `ALLOWED_ORIGINS` | No | CORS origins (default: `*`) |
| `RATE_LIMIT_WINDOW_MS` | No | Ventana rate limit (default: 900000 = 15min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | Max requests por ventana (default: 200) |

**Obtener Firebase Service Account:**
Firebase Console → Proyecto `curbradar-6d8f0` → Configuración → Cuentas de servicio → Generar nueva clave privada

---

## 14. Firebase Admin SDK (`src/config/firebase.js`)

Soporta dos modos (detecta automáticamente):

```javascript
// Modo A — Desarrollo local (archivo JSON):
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json

// Modo B — VPS / Deploy (variable de entorno con JSON inline):
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"curbradar-6d8f0",...}
```

Exporta `{ initFirebase, admin }`. Para usar en cualquier archivo:
```javascript
const { admin } = require('../config/firebase');

// Auth
const decoded = await admin.auth().verifyIdToken(token);
const user    = await admin.auth().getUser(firebaseUid);

// Storage
const bucket = admin.storage().bucket();
await bucket.file('objects/img.jpg').save(buffer, { metadata: { contentType: 'image/jpeg' } });

// FCM
await admin.messaging().send(message);
await admin.messaging().sendEachForMulticast(multicastMessage);
```

---

## 15. PM2 — Proceso en el VPS

```bash
# Instalar dependencias (primera vez)
npm install

# Crear .env con los valores reales
cp .env.example .env
# editar .env...

# Crear carpeta de logs
mkdir -p logs

# Arrancar con PM2
pm2 start ecosystem.config.js --env production
pm2 save          # persistir para reinicios del sistema
pm2 startup       # copiar y ejecutar el comando que genera

# Despliegues siguientes (zero-downtime)
git pull
npm install
pm2 reload curbradar-backend

# Comandos útiles
pm2 status
pm2 logs curbradar-backend
pm2 logs curbradar-backend --lines 200
pm2 restart curbradar-backend
pm2 stop curbradar-backend
pm2 monit
```

**Configuración del proceso (`ecosystem.config.js`):**
- Nombre: `curbradar-backend`
- Instancias: 1
- Memoria máxima antes de auto-restart: 512MB
- Logs: `logs/out.log`, `logs/error.log`
- Min uptime: 10s, Max restarts: 10

---

## 16. Nginx — Reverse Proxy (cuando esté listo el dominio)

El servidor ya escucha en `0.0.0.0:3000`. Cuando configures Nginx:

```nginx
server {
    listen 443 ssl;
    server_name api.curbradar.tech;

    # SSL — configurar con Certbot / Let's Encrypt
    ssl_certificate     /etc/letsencrypt/live/api.curbradar.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.curbradar.tech/privkey.pem;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;      # WebSocket
        proxy_set_header   Connection 'upgrade';       # WebSocket
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

# Redirigir HTTP a HTTPS
server {
    listen 80;
    server_name api.curbradar.tech;
    return 301 https://$host$request_uri;
}
```

> ⚠️ `proxy_set_header Upgrade` y `Connection 'upgrade'` son obligatorios para que Socket.io funcione a través de Nginx.

---

## 17. Patrones de Código — Cómo hacer las cosas

### 17.1 Ruta protegida estándar

```javascript
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');

router.get('/algo', authMiddleware, async (req, res, next) => {
  try {
    // req.firebaseUid → siempre disponible (verificado por Firebase)
    // req.user        → User de MongoDB (puede ser null en primer login)

    const data = await MiModelo.find({ userId: req.firebaseUid });
    res.json({ data });
  } catch (err) {
    next(err); // Pasa al error middleware — SIEMPRE usar next(err)
  }
});
```

### 17.2 Convertir coordenadas antes de guardar y al responder

```javascript
// Al GUARDAR un objeto (Flutter envía lat/lng → MongoDB necesita [lng, lat])
const obj = await CurbObject.create({
  ...otrosCampos,
  location: {
    type: 'Point',
    coordinates: [parseFloat(longitude), parseFloat(latitude)], // ← invertido
  },
});

// Al RESPONDER (MongoDB [lng,lat] → Flutter {latitude, longitude})
function toClientObject(obj) {
  const plain = obj.toObject ? obj.toObject() : { ...obj };
  plain.latitude  = plain.location?.coordinates[1];
  plain.longitude = plain.location?.coordinates[0];
  delete plain.location;
  return plain;
}
```

### 17.3 Sumar puntos y recalcular nivel

```javascript
async function addPointsToUser(firebaseUid, points, extraIncrements = {}) {
  const inc = { points };
  Object.entries(extraIncrements).forEach(([k, v]) => { inc[k] = v; });

  const updated = await User.findOneAndUpdate(
    { firebaseUid },
    { $inc: inc },
    { new: true },
  );

  if (updated) {
    const newLevel = Math.floor(updated.points / 500) + 1;
    if (newLevel !== updated.level) {
      await User.findOneAndUpdate({ firebaseUid }, { level: newLevel });
    }
  }
}

// Uso:
await addPointsToUser(req.firebaseUid, POINTS.POST_OBJECT, { postsCount: 1 });
await addPointsToUser(req.firebaseUid, POINTS.PICK_OBJECT, { foundCount: 1, totalImpactValue: obj.estimatedValue });
await addPointsToUser(req.firebaseUid, POINTS.CONFIRM_OBJECT, { confirmationsCount: 1 });
```

### 17.4 Emitir eventos Socket.io desde una ruta

```javascript
// El io está en req.app.get('io') desde cualquier ruta
function emitObjectEvent(req, event, payload) {
  const io = req.app.get('io');
  io.to('map').emit(event, payload);                          // A todos en el mapa
  if (payload.objectId) {
    io.to(`object_${payload.objectId}`).emit(event, payload); // A los que ven el detalle
  }
}

// Nuevo objeto → sala map
req.app.get('io').to('map').emit('object:new', { object: clientObj });

// Cambio de estado → mapa + sala del objeto
emitObjectEvent(req, 'object:updated', { objectId, status, claimedByUserId, ... });

// Objeto eliminado → mapa + sala del objeto
emitObjectEvent(req, 'object:deleted', { objectId });

// Mensaje de chat → solo sala del objeto
req.app.get('io').to(`object_${objectId}`).emit('newMessage', { message });
```

### 17.5 Consulta de objetos cercanos (patrón estándar)

```javascript
const expiryLimit = new Date(Date.now() - 48 * 60 * 60 * 1000);

const objects = await CurbObject.find({
  isDeleted: false,
  lastConfirmedAt: { $gt: expiryLimit },  // No expirados
  location: {
    $near: {
      $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
      $maxDistance: parseFloat(radius), // metros
    },
  },
  // Filtros opcionales:
  ...(category ? { category } : {}),
  ...(status ? { status } : {}),
}).lean();
```

---

## 18. Checklist para Agregar un Nuevo Endpoint

- [ ] Protegido con `authMiddleware` (o `authMiddleware + adminMiddleware` si es admin)
- [ ] Usa `req.firebaseUid` para identificar al usuario — nunca `req.body.userId`
- [ ] Convierte coordenadas MongoDB → `{ latitude, longitude }` antes de responder
- [ ] Emite evento Socket.io si el estado de un objeto cambia
- [ ] Suma puntos via `addPointsToUser()` si la acción los genera
- [ ] Usa soft delete (`isDeleted: true`) en lugar de `deleteOne()`
- [ ] Responde errores con `next(err)` — nunca `res.status(500).send(...)`
- [ ] Valida que los campos requeridos estén presentes antes de guardar
- [ ] Loguea errores con `console.error` en los catch (no `console.log`)

---

## 19. Reglas CRÍTICAS — Nunca Violar

```javascript
// ❌ MAL — confiar en el cuerpo del request para el userId
const userId = req.body.userId;

// ✅ BIEN — usar el UID verificado del token Firebase
const userId = req.firebaseUid;

// ❌ MAL — hardcodear API keys
const genAI = new GoogleGenerativeAI('AIzaSy...');

// ✅ BIEN — usar variables de entorno
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ❌ MAL — borrar objetos físicamente
await CurbObject.deleteOne({ _id: id });

// ✅ BIEN — soft delete
await CurbObject.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() });

// ❌ MAL — coordenadas en orden estándar al guardar en MongoDB
coordinates: [latitude, longitude]

// ✅ BIEN — MongoDB requiere [longitude, latitude]
coordinates: [parseFloat(longitude), parseFloat(latitude)]

// ❌ MAL — calcular puntos en el cliente Flutter
// ✅ BIEN — el servidor siempre calcula y actualiza con $inc

// ❌ MAL — emitir objeto sin convertir coordenadas
res.json({ object: curbObjectDoc });

// ✅ BIEN — convertir siempre antes de responder
res.json({ object: toClientObject(curbObjectDoc) });
```

---

*Actualizado: Mayo 2026 — curbradar_backend v1.0.0*

---

## 20. Changelog

### 2026-05-26 — Fixes producción + infraestructura

**server.js:**
- `app.set('trust proxy', 1)` — express-rate-limit leía 127.0.0.1 para todos los clientes por estar detrás de Nginx; esto lo corrige leyendo X-Forwarded-For
- `app.use(express.static('public'))` — sirve archivos estáticos desde `public/`

**src/middlewares/auth.middleware.js:**
- Mejorado logging de errores: ahora muestra `err.code` y `err.message` por separado para diagnosticar errores Firebase

**public/privacy.html** — política de privacidad de CurbRadar (accesible en curbradar.tech/privacy.html, no desde api.curbradar.tech)

**MongoDB (VPS):**
- Auth habilitada (`security.authorization: enabled` en `/etc/mongod.conf`)
- Usuario creado: `curbradar_app` con rol `readWrite` en db `curbradar`
- `.env` actualizado: `MONGODB_URI=mongodb://curbradar_app:CurbR4d4r_S3cur3!@localhost:27017/curbradar`
- Fix permisos: `sudo chown -R mongodb:mongodb /var/lib/mongodb /var/log/mongodb`

**Firebase Storage (.env en VPS):**
- `FIREBASE_STORAGE_BUCKET=curbradar-6d8f0.firebasestorage.app` (era `.appspot.com`, causaba error "bucket does not exist")

**Nginx (VPS `/etc/nginx/sites-available/curbradar-api`):**
- `client_max_body_size 15m;` en el bloque `location /` — antes daba 413 en uploads de imágenes

**Infraestructura VPS:**
- `/var/www/curbradar_web/` — directorio del sitio web principal (curbradar.tech)
- Config Nginx: `curbradar-web` sirve estáticos desde `/var/www/curbradar_web`, SSL via Certbot
- Privacy policy copiada a `/var/www/curbradar_web/privacy.html`
