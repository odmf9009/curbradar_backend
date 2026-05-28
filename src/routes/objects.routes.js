const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { CurbObject } = require('../models/CurbObject');
const { User } = require('../models/User');
const { Comment } = require('../models/Comment');
const { Report } = require('../models/Report');
const notificationService = require('../services/notification.service');
const { POINTS } = require('../utils/pointsUtils');

// Helper: convierte coordenadas MongoDB → campos planos para Flutter
function toClientObject(obj) {
  const plain = obj.toObject ? obj.toObject({ virtuals: true }) : { ...obj };
  if (plain.location && plain.location.coordinates) {
    plain.latitude  = plain.location.coordinates[1];
    plain.longitude = plain.location.coordinates[0];
  }
  delete plain.location;
  if (plain._id) plain.id = plain._id.toString();
  return plain;
}

// Helper: emite un evento Socket.io
function emitObjectEvent(req, event, payload) {
  const io = req.app.get('io');
  io.to('map').emit(event, payload);
  if (payload.objectId) {
    io.to(`object_${payload.objectId}`).emit(event, payload);
  }
}

// Helper: suma puntos y recalcula nivel
async function addPointsToUser(firebaseUid, points, extraIncrements = {}) {
  const inc = { points };
  Object.entries(extraIncrements).forEach(([k, v]) => {
    inc[k] = typeof v === 'number' ? v : 1;
  });

  const updated = await User.findOneAndUpdate(
    { firebaseUid },
    { $inc: inc },
    { new: true },
  );

  if (updated && updated.points) {
    const newLevel = Math.floor(updated.points / 500) + 1;
    if (newLevel !== updated.level) {
      await User.findOneAndUpdate({ firebaseUid }, { level: newLevel });
    }
  }
}

// ─── CONTROLADORES ──────────────────────────────────────────────────────────

const updateObjectImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { imageUrl } = req.body;

    console.log(`[Backend] 📸 PATCH /api/objects/${id}/image`);

    if (!imageUrl) {
      return res.status(400).json({ message: 'imageUrl is required' });
    }

    const object = await CurbObject.findByIdAndUpdate(
      id,
      {
        $set: { imageUrl: imageUrl },
        $push: { imageUrls: { $each: [imageUrl], $position: 0 } },
        $set: { lastConfirmedAt: new Date() }
      },
      { new: true }
    );

    if (!object) {
      return res.status(404).json({ message: 'Object not found' });
    }

    if (object.imageUrls && object.imageUrls.length > 5) {
      object.imageUrls = object.imageUrls.slice(0, 5);
      await object.save();
    }

    const wasUpdatedByOthers = object.postedByUserId !== req.firebaseUid;
    if (wasUpdatedByOthers) {
      await addPointsToUser(req.firebaseUid, POINTS.CONFIRM_OBJECT);
    }

    const clientObj = toClientObject(object);
    emitObjectEvent(req, 'object:updated', {
      objectId: id,
      object: clientObj,
      imageUrl: object.imageUrl,
      imageUrls: object.imageUrls
    });

    return res.json(clientObj);
  } catch (error) {
    console.error('Error updating object image:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── RUTAS ──────────────────────────────────────────────────────────────────

// Diagnóstico
router.get('/ping', (req, res) => res.json({ status: 'Objects Router is ONLINE' }));

// ACTUALIZAR IMAGEN
router.patch('/:id/image', authMiddleware, updateObjectImage);

// Listar objetos
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { lat, lng, radius = 5000, category, status, timeRange, searchQuery, page = 1, limit = 50 } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'Faltan coordenadas' });

    const expiryLimit = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const query = {
      isDeleted: false,
      lastConfirmedAt: { $gt: expiryLimit },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseFloat(radius)
        }
      }
    };

    if (category && category !== 'Todos') query.category = category;
    if (status && status !== 'all') query.status = status;
    if (timeRange && timeRange !== 'all') {
      const hours = { '1h': 1, '6h': 6, '24h': 24 }[timeRange];
      if (hours) query.createdAt = { $gt: new Date(Date.now() - hours * 3600000) };
    }
    if (searchQuery) query.$text = { $search: searchQuery };

    const objects = await CurbObject.find(query).limit(parseInt(limit)).skip((parseInt(page) - 1) * parseInt(limit)).lean();
    res.json({ objects: objects.map(toClientObject), total: objects.length });
  } catch (err) { next(err); }
});

// Crear objeto
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { title, description, category, imageUrls, latitude, longitude, address, locality, estimatedValue } = req.body;
    if (!title || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const newObject = await CurbObject.create({
      title: title.trim(),
      description: description || '',
      category: category || 'Otros',
      imageUrls: imageUrls || [],
      location: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
      address: address || 'Ubicación desconocida',
      locality: locality || null,
      estimatedValue: parseFloat(estimatedValue) || 0,
      postedByUserId: req.firebaseUid,
      postedByUserName: req.user.username || req.user.name,
    });

    await addPointsToUser(req.firebaseUid, POINTS.POST_OBJECT, { postsCount: 1 });

    const clientObj = toClientObject(newObject);
    req.app.get('io').to('map').emit('object:new', { object: clientObj });
    notificationService.notifyNearbyUsers(newObject).catch(console.error);

    res.status(201).json({ object: clientObj });
  } catch (err) { next(err); }
});

// Obtener detalle
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const object = await CurbObject.findById(req.params.id);
    if (!object || object.isDeleted) return res.status(404).json({ error: 'No encontrado' });
    await CurbObject.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });
    res.json({ object: toClientObject(object) });
  } catch (err) { next(err); }
});

// Actualizar estado
router.patch('/:id/status', authMiddleware, async (req, res, next) => {
  try {
    const { status } = req.body;
    const object = await CurbObject.findById(req.params.id);
    if (!object || object.isDeleted) return res.status(404).json({ error: 'No encontrado' });

    const isOwner = object.postedByUserId === req.firebaseUid;
    const isClaimer = object.claimedByUserId === req.firebaseUid;

    if (status === 'onMyWay') {
      if (object.status === 'onMyWay' && !object.isClaimExpired) return res.status(409).json({ error: 'Ya reclamado' });
      object.status = 'onMyWay';
      object.claimedByUserId = req.firebaseUid;
      object.claimedByUserName = req.user.username || req.user.name;
      object.claimedAt = new Date();
    } else if (status === 'available') {
      object.status = 'available';
      object.claimedByUserId = null;
      object.claimedByUserName = null;
    } else if (status === 'pickedUp') {
      object.status = 'pickedUp';
      object.isDeleted = true;
      object.deletedAt = new Date();
    }

    await object.save();

    const clientObj = toClientObject(object);
    if (status === 'pickedUp') {
      emitObjectEvent(req, 'object:deleted', { objectId: object._id.toString() });
    } else {
      emitObjectEvent(req, 'object:updated', { objectId: object._id.toString(), status: object.status, object: clientObj });
    }

    res.json({ success: true, status: object.status });
  } catch (err) { next(err); }
});

// Confirmar existencia
router.post('/:id/confirm', authMiddleware, async (req, res, next) => {
  try {
    const object = await CurbObject.findById(req.params.id);
    if (!object || object.isDeleted) return res.status(404).json({ error: 'No encontrado' });

    if (object.confirmedByIds?.includes(req.firebaseUid)) return res.status(409).json({ error: 'Ya confirmado' });

    await CurbObject.findByIdAndUpdate(req.params.id, {
      lastConfirmedAt: new Date(),
      $inc: { confirmations: 1 },
      $addToSet: { confirmedByIds: req.firebaseUid }
    });

    await addPointsToUser(req.firebaseUid, POINTS.CONFIRM_OBJECT, { confirmationsCount: 1 });

    const updated = await CurbObject.findById(req.params.id);
    emitObjectEvent(req, 'object:updated', { objectId: req.params.id, object: toClientObject(updated) });

    res.json({ success: true, firstTime: true });
  } catch (err) { next(err); }
});

// ETA
router.patch('/:id/eta', authMiddleware, async (req, res, next) => {
  try {
    const { eta } = req.body;
    const object = await CurbObject.findById(req.params.id);
    if (!object || object.claimedByUserId !== req.firebaseUid) return res.status(403).json({ error: 'No autorizado' });

    object.claimedUserEta = eta;
    await object.save();

    emitObjectEvent(req, 'object:updated', { objectId: object._id.toString(), claimedUserEta: eta, object: toClientObject(object) });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
