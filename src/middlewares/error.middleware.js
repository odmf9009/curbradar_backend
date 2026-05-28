/**
 * Middleware de manejo global de errores.
 * Intercepta todos los errores lanzados con next(err).
 * Siempre loguea el error completo (visible en pm2 logs).
 * Devuelve respuestas JSON consistentes.
 */
function errorMiddleware(err, req, res, next) {
  // ── Log siempre, en cualquier entorno ────────────────────────────────────
  console.error(
    `[ERROR] ${req.method} ${req.originalUrl} →`,
    err.message || err,
    '\nStack:', err.stack || '(sin stack)',
  );

  // ── Errores de validación de Mongoose ────────────────────────────────────
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ error: 'Error de validación', details: errors });
  }

  // ── Duplicate key (ej: username ya existe) ───────────────────────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'campo';
    return res.status(409).json({ error: `El ${field} ya está en uso` });
  }

  // ── ObjectId inválido de Mongoose ────────────────────────────────────────
  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'ID inválido' });
  }

  // ── Errores de autenticación ya manejados en auth.middleware ─────────────
  if (err.status === 401 || err.statusCode === 401) {
    return res.status(401).json({ error: err.message || 'No autorizado' });
  }

  // ── Cualquier otro error → siempre 500 ───────────────────────────────────
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
}

module.exports = errorMiddleware;
