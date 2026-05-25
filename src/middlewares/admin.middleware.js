/**
 * Middleware de autorización para rutas de Admin.
 * Debe usarse DESPUÉS de authMiddleware.
 * Verifica que req.user tenga role === 'admin'.
 */
function adminMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Usuario no encontrado' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado: se requiere rol de administrador' });
  }

  next();
}

module.exports = adminMiddleware;
