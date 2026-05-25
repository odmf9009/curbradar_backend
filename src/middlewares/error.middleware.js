/**
 * Middleware de manejo global de errores.
 * Intercepta todos los errores lanzados con next(err).
 * Devuelve respuestas JSON consistentes.
 */
function errorMiddleware(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Error interno del servidor';

  // Errores de validación de Mongoose
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ error: 'Error de validación', details: errors });
  }

  // Duplicate key error (ej: username ya existe)
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'campo';
    return res.status(409).json({ error: `El ${field} ya está en uso` });
  }

  // Error de ObjectId inválido de Mongoose
  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'ID inválido' });
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error('[Error]', err);
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

module.exports = errorMiddleware;
