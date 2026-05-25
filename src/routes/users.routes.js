const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { User } = require('../models/User');
const { CurbObject } = require('../models/CurbObject');

// GET /api/users/ranking — Top usuarios por puntos
router.get('/ranking', authMiddleware, async (req, res, next) => {
  try {
    const { limit = 50 } = req.query;
    const users = await User.find({ isActive: true })
      .sort({ points: -1 })
      .limit(parseInt(limit))
      .select('firebaseUid name username profileImageUrl points level postsCount foundCount confirmationsCount totalImpactValue')
      .lean();

    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/me — Perfil propio completo
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ user: req.user });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/me — Actualizar perfil propio
router.patch('/me', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { username, profileImageUrl } = req.body;
    const updates = {};

    if (username !== undefined) {
      const trimmed = username.trim();
      if (trimmed.length > 0) {
        // Verificar que el alias no esté tomado
        const existing = await User.findOne({ username: trimmed, firebaseUid: { $ne: req.firebaseUid } });
        if (existing) return res.status(409).json({ error: 'Este alias ya está en uso' });
        updates.username = trimmed;
      }
    }

    if (profileImageUrl) {
      updates.profileImageUrl = profileImageUrl;
    }

    const updated = await User.findOneAndUpdate(
      { firebaseUid: req.firebaseUid },
      { $set: updates },
      { new: true }
    );

    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/me/location — Actualizar ubicación en tiempo real
router.patch('/me/location', authMiddleware, async (req, res, next) => {
  try {
    const { latitude, longitude, isOnline } = req.body;

    const update = {
      isOnline: isOnline !== undefined ? isOnline : true,
      lastActive: new Date(),
    };

    if (latitude && longitude) {
      update.location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
      };
      update.lastLocationUpdate = new Date();
    }

    await User.findOneAndUpdate({ firebaseUid: req.firebaseUid }, { $set: update });
    res.json({ message: 'Ubicación actualizada' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/me/favorites/:objectId — Toggle favorito
router.patch('/me/favorites/:objectId', authMiddleware, async (req, res, next) => {
  try {
    const { objectId } = req.params;
    const { isFavorite } = req.body;

    const update = isFavorite
      ? { $addToSet: { favorites: objectId } }
      : { $pull: { favorites: objectId } };

    await User.findOneAndUpdate({ firebaseUid: req.firebaseUid }, update);
    res.json({ message: isFavorite ? 'Guardado en favoritos' : 'Eliminado de favoritos' });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/me/objects — Mis publicaciones
router.get('/me/objects', authMiddleware, async (req, res, next) => {
  try {
    const objects = await CurbObject.find({
      postedByUserId: req.firebaseUid,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .lean();

    const result = objects.map((obj) => ({
      ...obj,
      latitude: obj.location?.coordinates[1],
      longitude: obj.location?.coordinates[0],
      location: undefined,
    }));

    res.json({ objects: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/me/favorites — Objetos guardados como favoritos
router.get('/me/favorites', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user || !req.user.favorites?.length) {
      return res.json({ objects: [] });
    }

    const objects = await CurbObject.find({
      _id: { $in: req.user.favorites },
      isDeleted: false,
    }).lean();

    const result = objects.map((obj) => ({
      ...obj,
      latitude: obj.location?.coordinates[1],
      longitude: obj.location?.coordinates[0],
      location: undefined,
    }));

    res.json({ objects: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/active-hunters — Cazadores activos (online) con ubicación
router.get('/active-hunters', authMiddleware, async (req, res, next) => {
  try {
    const hunters = await User.find({ isOnline: true, isActive: true })
      .select('firebaseUid username name profileImageUrl location lastLocationUpdate')
      .lean();

    const result = hunters.map((h) => ({
      ...h,
      latitude: h.location?.coordinates[1],
      longitude: h.location?.coordinates[0],
      location: undefined,
    }));

    res.json({ hunters: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:uid — Perfil público de un usuario
router.get('/:uid', authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.params.uid })
      .select('firebaseUid username name profileImageUrl points level postsCount foundCount confirmationsCount totalImpactValue')
      .lean();

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
