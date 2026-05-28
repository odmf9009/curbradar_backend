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
    console.log(`[Backend] 📦 Body:`, req.body);

    if (!imageUrl) {
      return res.status(400).json({ message: 'imageUrl is required' });
    }

    // Actualizamos imageUrl y también lo añadimos al array imageUrls para historial
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
      console.log(`[Backend] ❌ Objeto no encontrado: ${id}`);
      return res.status(404).json({ message: 'Object not found' });
    }

    // Limitar historial a 5 fotos
    if (object.imageUrls && object.imageUrls.length > 5) {
      object.imageUrls = object.imageUrls.slice(0, 5);
      await object.save();
    }

    console.log(`[Backend] ✅ Imagen actualizada con éxito`);

    // Puntos para colaboradores (opcional)
    if (object.postedByUserId !== req.firebaseUid) {
      await addPointsToUser(req.firebaseUid, POINTS.CONFIRM_OBJECT);
    }

    const clientObj = toClientObject(object);

    // Notificar vía Socket
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

// ACTUALIZAR IMAGEN (Ruta específica solicitada)
router.patch('/:id/image', authMiddleware, updateObjectImage);

// Listar objetos
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { lat, lng, radius = 5000, category, status, searchQuery } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'Faltan coordenadas' });

    const query = {
      isDeleted: false,
      lastConfirmedAt: { $gt: new Date(Date.now() - 48*3600000) },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseFloat(radius)
        }
      }
    };
    if (category && category !== 'Todos') query.category = category;
    if (status && status !== 'all') query.status = status;
    if (searchQuery) query.$text = { $search: searchQuery };

    const objects = await CurbObject.find(query).limit(50).lean();
    res.json({ objects: objects.map(toClientObject) });
  } catch (err) { next(err); }
});

// Crear objeto
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { title, latitude, longitude } = req.body;
    const newObject = await CurbObject.create({
      ...req.body,
      location: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
      postedByUserId: req.firebaseUid,
      postedByUserName: req.user.username || req.user.name,
    });
    const clientObj = toClientObject(newObject);
    req.app.get('io').to('map').emit('object:new', { object: clientObj });
    res.status(201).json({ object: clientObj });
  } catch (err) { next(err); }
});

// Obtener detalle
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const object = await CurbObject.findById(req.params.id);
    if (!object || object.isDeleted) return res.status(404).json({ error: 'No encontrado' });
    res.json({ object: toClientObject(object) });
  } catch (err) { next(err); }
});

// Actualizar estado
router.patch('/:id/status', authMiddleware, async (req, res, next) => {
  try {
    const { status } = req.body;
    const object = await CurbObject.findById(req.params.id);
    if (!object) return res.status(404).json({ error: 'No encontrado' });

    object.status = status;
    await object.save();

    emitObjectEvent(req, 'object:updated', {
      objectId: object._id.toString(),
      status: object.status,
      object: toClientObject(object)
    });
    res.json({ success: true, status: object.status });
  } catch (err) { next(err); }
});

// Actualizar ETA
router.patch('/:id/eta', authMiddleware, async (req, res, next) => {
  try {
    const { eta } = req.body;
    const object = await CurbObject.findById(req.params.id);
    if (!object) return res.status(404).json({ error: 'No encontrado' });

    object.claimedUserEta = eta;
    await object.save();

    emitObjectEvent(req, 'object:updated', {
      objectId: object._id.toString(),
      claimedUserEta: eta,
      object: toClientObject(object)
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
