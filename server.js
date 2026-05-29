require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

const { connectDB } = require('./src/config/database');
const { initFirebase } = require('./src/config/firebase');
const { startExpiryJob } = require('./src/services/expiry.service');
const errorMiddleware = require('./src/middlewares/error.middleware');

const authRoutes    = require('./src/routes/auth.routes');
const objectsRoutes = require('./src/routes/objects.routes');
const usersRoutes   = require('./src/routes/users.routes');
const chatRoutes    = require('./src/routes/chat.routes');
const alertsRoutes  = require('./src/routes/alerts.routes');
const requestsRoutes = require('./src/routes/requests.routes');
const adminRoutes   = require('./src/routes/admin.routes');
const uploadRoutes  = require('./src/routes/upload.routes');
const statsRoutes   = require('./src/routes/stats.routes');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log(`[Socket] ✅ Conectado: ${socket.id}`);

  socket.on('joinMap', () => {
    socket.join('map');
  });

  socket.on('leaveMap', () => {
    socket.leave('map');
  });

  socket.on('joinObject', (objectId) => {
    socket.join(`object_${objectId}`);
  });

  socket.on('leaveObject', (objectId) => {
    socket.leave(`object_${objectId}`);
  });

  socket.on('joinHunters', () => {
    socket.join('hunters');
  });

  socket.on('updateLocation', ({ lat, lng, firebaseUid }) => {
    socket.to('hunters').emit('hunter:location', { firebaseUid, lat, lng });
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] ❌ Desconectado: ${socket.id}`);
  });
});

app.set('trust proxy', 1);

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(morgan('dev'));

// Logger global para ver qué rutas llegan al servidor
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl} | type: ${req.headers['content-type'] || '-'}`);
  next();
});

// ─── RUTAS ──────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/objects',  objectsRoutes);
app.use('/api/users',    usersRoutes);
app.use('/api/chat',     chatRoutes);
app.use('/api/alerts',   alertsRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/upload',   uploadRoutes);
app.use('/api/stats',    statsRoutes);

// Catch-all para /api que NO existen -> Devolver JSON, NO HTML
app.all('/api/*', (req, res) => {
  console.log(`[404 NOT FOUND] ${req.method} ${req.url}`);
  res.status(404).json({
    success: false,
    error: `Ruta ${req.method} ${req.url} no encontrada en este servidor.`,
    availableRoutes: ['/api/auth', '/api/objects', '/api/users', '/api/chat', '/api/upload']
  });
});

app.use(errorMiddleware);

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  try {
    await connectDB();
    initFirebase();
    startExpiryJob();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor CurbRadar funcionando en puerto ${PORT}`);
    });
  } catch (err) {
    console.error('Error al iniciar servidor:', err);
  }
}

bootstrap();
