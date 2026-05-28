const { admin } = require('../config/firebase');
const { User } = require('../models/User');

/**
 * Middleware de autenticación.
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  // LOG DE SEGURIDAD (Solo para depuración)
  console.log(`[Auth] 🔐 Verificando ruta: ${req.method} ${req.url}`);
  if (!authHeader) {
    console.log('[Auth] ❌ Error: No se recibió cabecera Authorization');
  } else {
    console.log('[Auth] ✅ Cabecera recibida:', authHeader.substring(0, 20) + '...');
  }

  try {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticación requerido' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.firebaseUid = decodedToken.uid;

    const user = await User.findOne({ firebaseUid: decodedToken.uid });
    req.user = user;

    next();
  } catch (err) {
    console.error('[Auth] 🔥 Error verificando token:', err.message);
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = authMiddleware;
