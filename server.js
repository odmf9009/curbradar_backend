require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { connectDB } = require('./src/config/database');
const { initFirebase } = require('./src/config/firebase');
const errorMiddleware = require('./src/middlewares/error.middleware');

const authRoutes    = require('./src/routes/auth.routes');
const objectsRoutes = require('./src/routes/objects.routes');
const usersRoutes   = require('./src/routes/users.routes');
const chatRoutes    = require('./src/routes/chat.routes');
const uploadRoutes  = require('./src/routes/upload.routes');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
app.set('io', io);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(morgan('dev'));

// Logger global para ver qué rutas llegan al servidor
app.use((req, res, next) => {
  console.log(`[Incoming Request] ${req.method} ${req.url}`);
  next();
});

// ─── RUTAS ──────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/objects',  objectsRoutes);
app.use('/api/users',    usersRoutes);
app.use('/api/chat',     chatRoutes);
app.use('/api/upload',   uploadRoutes);

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
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor CurbRadar funcionando en puerto ${PORT}`);
    });
  } catch (err) {
    console.error('Error al iniciar servidor:', err);
  }
}
bootstrap();
