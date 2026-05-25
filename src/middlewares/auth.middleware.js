const { admin } = require('../config/firebase');
const { User } = require('../models/User');

/**
 * Middleware de autenticación.
 * Verifica el Firebase ID Token enviado en el header Authorization: Bearer <token>
 * Agrega req.user con los datos del usuario de MongoDB (o null si no existe).
 * Agrega req.firebaseUid con el UID verificado.
 *
 * ⚠️ REGLA CRÍTICA: NUNCA confiar en req.body.userId. Siempre usar req.firebaseUid.
 */
async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticación requerido' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    // Verificar el token con Firebase Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.firebaseUid = decodedToken.uid;

    // Obtener el usuario de nuestra base de datos
    const user = await User.findOne({ firebaseUid: decodedToken.uid });
    req.user = user; // Puede ser null si es la primera vez

    next();
  } catch (err) {
    console.error('[Auth] Error verificando token:', err.message);

    if (err.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expirado, vuelve a iniciar sesión' });
    }
    if (err.code === 'auth/argument-error' || err.code === 'auth/invalid-id-token') {
      return res.status(401).json({ error: 'Token inválido' });
    }

    return res.status(401).json({ error: 'No autorizado' });
  }
}

module.exports = authMiddleware;
