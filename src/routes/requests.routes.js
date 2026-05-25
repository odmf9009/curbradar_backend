const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { Request } = require('../models/Request');

// GET /api/requests — Listar búsquedas activas ("Se busca")
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const requests = await Request.find({ isResolved: false })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const result = requests.map((r) => ({
      ...r,
      latitude: r.location?.coordinates[1],
      longitude: r.location?.coordinates[0],
      location: undefined,
    }));

    res.json({ requests: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/requests — Crear una nueva búsqueda
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { title, description, category, city, latitude, longitude } = req.body;
    if (!title) return res.status(400).json({ error: 'Título requerido' });

    const request = await Request.create({
      userId: req.firebaseUid,
      userName: req.user.username || req.user.name,
      title: title.trim(),
      description: description?.trim() || '',
      category: category || 'Otros',
      city: city || '',
      location: {
        type: 'Point',
        coordinates: [parseFloat(longitude) || 0, parseFloat(latitude) || 0],
      },
    });

    res.status(201).json({ request });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/requests/:id/resolve — Marcar como resuelta
router.patch('/:id/resolve', authMiddleware, async (req, res, next) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Búsqueda no encontrada' });
    if (request.userId !== req.firebaseUid) {
      return res.status(403).json({ error: 'Solo el creador puede resolver esta búsqueda' });
    }

    request.isResolved = true;
    request.resolvedAt = new Date();
    await request.save();

    res.json({ message: 'Búsqueda marcada como resuelta' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
