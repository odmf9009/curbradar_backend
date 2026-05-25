const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { Alert } = require('../models/Alert');

// GET /api/alerts — Historial de alertas del usuario autenticado
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const alerts = await Alert.find({ userId: req.firebaseUid })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// POST /api/alerts — Guardar nueva alerta de proximidad
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { objectId, objectTitle, objectImageUrl, address, distance } = req.body;

    // Upsert: evitar duplicados por objectId para el mismo usuario
    const alert = await Alert.findOneAndUpdate(
      { userId: req.firebaseUid, objectId },
      {
        userId: req.firebaseUid,
        objectId,
        objectTitle,
        objectImageUrl: objectImageUrl || '',
        address: address || '',
        distance: parseFloat(distance) || 0,
        isRead: false,
        createdAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ alert });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/alerts/:alertId/read — Marcar alerta como leída
router.patch('/:alertId/read', authMiddleware, async (req, res, next) => {
  try {
    await Alert.findOneAndUpdate(
      { _id: req.params.alertId, userId: req.firebaseUid },
      { isRead: true }
    );
    res.json({ message: 'Alerta marcada como leída' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
