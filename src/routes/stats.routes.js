const express = require('express');
const router = express.Router();
const { CurbObject } = require('../models/CurbObject');
const { User } = require('../models/User');

/**
 * GET /api/stats
 * Estadísticas globales públicas de la comunidad.
 * No requiere autenticación — se usa en la pantalla "Acerca de".
 *
 * Response:
 * {
 *   totalObjectsPosted : number  — objetos publicados desde el inicio
 *   totalObjectsReused : number  — objetos recogidos
 *   totalUsers         : number  — usuarios registrados
 *   totalCities        : number  — ciudades/localidades activas
 * }
 */
router.get('/', async (req, res, next) => {
  try {
    const [totalObjectsPosted, totalObjectsReused, totalUsers, cities] = await Promise.all([
      // Todos los objetos publicados (incluyendo recogidos y expirados)
      CurbObject.countDocuments({}),

      // Objetos que fueron recogidos exitosamente
      CurbObject.countDocuments({ status: 'pickedUp' }),

      // Usuarios registrados
      User.countDocuments({ isActive: true }),

      // Ciudades/localidades distintas con al menos 1 objeto publicado
      CurbObject.distinct('locality', { locality: { $ne: null, $exists: true } }),
    ]);

    res.json({
      totalObjectsPosted,
      totalObjectsReused,
      totalUsers,
      totalCities: cities.filter(Boolean).length,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
