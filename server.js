require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { connectDB } = require('./src/config/database');
const { initFirebase } = require('./src/config/firebase');
const { startExpiryJob } = require('./src/services/expiry.service');
const errorMiddleware = require('./src/middlewares/error.middleware');

// ─── Routes ──────────────────────────────────────────────────────────────────
const authRoutes    = require('./src/routes/auth.routes');
const objectsRoutes = require('./src/routes/objects.routes');
const usersRoutes   = require('./src/routes/users.routes');
const chatRoutes    = require('./src/routes/chat.routes');
const alertsRoutes  = require('./src/routes/alerts.routes');
const requestsRoutes = require('./src/routes/requests.routes');
const adminRoutes   = require('./src/routes/admin.routes');
const uploadRoutes  = require('./src/routes/upload.routes');

const app    = express();
const server = http.createServer(app);

// ─── Socket.io ───────────────────────────────────────────────────────────────
// Reemplaza los Streams de Firestore con eventos en tiempo real.
//
// Salas disponibles:
//   "map"              → todos los usuarios con el mapa abierto
//   "object_{id}"      → usuarios viendo el detalle / chat de un objeto
//   "hunters"          → usuarios que comparten su ubicación en vivo
//
// Eventos que el SERVER emite al cliente:
//   "object:new"       → nuevo objeto publicado  { object }
//   "object:updated"   → objeto cambió de estado  { objectId, status, ... }
//   "object:deleted"   → objeto eliminado/expirado { objectId }
//   "hunter:location"  → cazador actualizó ubicación { firebaseUid, lat, lng }
//   "newMessage"       → mensaje de chat { message }
//
// Eventos que el CLIENTE envía al servidor:
//   "joinMap"          → entrar a sala del mapa
//   "leaveMap"         → salir del mapa
//   "joinObject"       → entrar a sala de un objeto (chat/detalle)
//   "leaveObject"      → salir del objeto
//   "joinHunters"      → activar modo caza (comparte ubicación)
//   "updateLocation"   → { lat, lng, firebaseUid }

const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log(`[Socket] ✅ Conectado: ${socket.id}`);

  // ── Mapa ────────────────────────────────────────────────────────────────
  socket.on('joinMap', () => {
    socket.join('map');
  });

  socket.on('leaveMap', () => {
    socket.leave('map');
  });

  // ── Detalle / Chat de objeto ─────────────────────────────────────────────
  socket.on('joinObject', (objectId) => {
    socket.join(`object_${objectId}`);
  });

  socket.on('leaveObject', (objectId) => {
    socket.leave(`object_${objectId}`);
  });

  // ── Cazadores en tiempo real ─────────────────────────────────────────────
  socket.on('joinHunters', () => {
    socket.join('hunters');
  });

  // El cliente envía su ubicación → se retransmite a todos en la sala "hunters"
  socket.on('updateLocation', ({ lat, lng, firebaseUid }) => {
    socket.to('hunters').emit('hunter:location', { firebaseUid, lat, lng });
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] ❌ Desconectado: ${socket.id}`);
  });
});

// Trust proxy — Nginx pasa la IP real en X-Forwarded-For
// Sin esto, express-rate-limit ve 127.0.0.1 para todos los requests
app.set('trust proxy', 1);

// ─── Log de cada request que llega a Node.js ────────────────────────────────
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl} | content-type: ${req.headers['content-type'] || '-'} | content-length: ${req.headers['content-length'] || '-'}`);
  next();
});

// ─── Middlewares Globales ────────────────────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate Limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta más tarde.' },
});
app.use('/api/', limiter);

// ─── Static Files ────────────────────────────────────────────────────────────
app.use(express.static('public'));

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/objects',  objectsRoutes);
app.use('/api/users',    usersRoutes);
app.use('/api/chat',     chatRoutes);
app.use('/api/alerts',   alertsRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/upload',   uploadRoutes);

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use(errorMiddleware);

// ─── Boot ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function bootstrap() {
  try {
    await connectDB();
    initFirebase();
    startExpiryJob();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 CurbRadar Backend — puerto ${PORT}`);
      console.log(`   Entorno  : ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Health   : http://localhost:${PORT}/health`);
      console.log(`   Socket.io: activo\n`);
    });
  } catch (err) {
    console.error('❌ Error fatal al iniciar:', err);
    process.exit(1);
  }
}

bootstrap();
