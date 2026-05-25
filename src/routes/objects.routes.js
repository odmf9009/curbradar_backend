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
  const plain = obj.toObject ? obj.toObject({ virtuals: false }) : { ...obj };
  plain.latitude  = plain.location?.coordinates[1];
  plain.longitude = plain.location?.coordinates[0];
  delete plain.location;
  return plain;
}

// Helper: emite un evento Socket.io a la sala "map" y a la sala del objeto
function emitObjectEvent(req, event, payload) {
  const io = req.app.get('io');
  io.to('map').emit(event, payload);
  if (payload.objectId) {
    io.to(`object_${payload.objectId}`).emit(event, payload);
  }
}

// ─── GET /api/objects ─────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const {
      lat, lng,
      radius = 5000,
      category, status, timeRange, searchQuery,
      page = 1, limit = 50,
    } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Se requieren lat y lng' });
    }

    const expiryLimit = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const query = {
      isDeleted: false,
      lastConfirmedAt: { $gt: expiryLimit },
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: parseFloat(radius),
        },
      },
    };

    if (category && category !== 'Todos') query.category = category;
    if (status && status !== 'all') query.status = status;
    if (timeRange && timeRange !== 'all') {
      const hours = { '1h': 1, '6h': 6, '24h': 24 }[timeRange];
      if (hours) query.createdAt = { $gt: new Date(Date.now() - hours * 3600000) };
    }
    if (searchQuery) query.$text = { $search: searchQuery };

    const objects = await CurbObject.find(query)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    const result = objects.map((obj) => ({
      ...obj,
      latitude:  obj.location?.coordinates[1],
      longitude: obj.location?.coordinates[0],
      location: undefined,
    }));

    res.json({ objects: result, total: result.length });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/objects ────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(404).json({ error: 'Usuario no encontrado. Llama a /auth/verify primero.' });
    }

    const { title, description, category, imageUrls, latitude, longitude, address, locality, estimatedValue } = req.body;

    if (!title || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Faltan campos requeridos: title, latitude, longitude' });
    }

    const newObject = await CurbObject.create({
      title:        title.trim(),
      description:  description?.trim() || '',
      category:     category || 'Otros',
      imageUrls:    imageUrls || [],
      location: {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
      },
      address:        address || 'Ubicación desconocida',
      locality:       locality || null,
      estimatedValue: parseFloat(estimatedValue) || 0,
      postedByUserId:   req.firebaseUid,
      postedByUserName: req.user.username || req.user.name,
    });

    // ── Puntos ────────────────────────────────────────────────────────────
    await addPointsToUser(req.firebaseUid, POINTS.POST_OBJECT, { postsCount: 1 });

    // ── Socket.io: notificar al mapa que hay un nuevo objeto ──────────────
    const clientObj = toClientObject(newObject);
    req.app.get('io').to('map').emit('object:new', { object: clientObj });

    // ── FCM: push a usuarios cercanos ─────────────────────────────────────
    notificationService.notifyNearbyUsers(newObject).catch(console.error);

    res.status(201).json({ object: clientObj });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/objects/:id ─────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const object = await CurbObject.findById(req.params.id).lean();
    if (!object || object.isDeleted) {
      return res.status(404).json({ error: 'Objeto no encontrado' });
    }

    await CurbObject.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });

    res.json({
      object: {
        ...object,
        latitude:  object.location?.coordinates[1],
        longitude: object.location?.coordinates[0],
        location: undefined,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/objects/:id/status ───────────────────────────────────────────
router.patch('/:id/status', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { status } = req.body;
    if (!['available', 'onMyWay', 'pickedUp'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const object = await CurbObject.findById(req.params.id);
    if (!object || object.isDeleted) {
      return res.status(404).json({ error: 'Objeto no encontrado' });
    }

    const isOwner   = object.postedByUserId === req.firebaseUid;
    const isClaimer = object.claimedByUserId === req.firebaseUid;

    // ── onMyWay ──────────────────────────────────────────────────────────
    if (status === 'onMyWay') {
      if (object.status === 'onMyWay' && !object.isClaimExpired) {
        return res.status(409).json({ error: 'Alguien más ya va en camino' });
      }
      if (isOwner) {
        return res.status(403).json({ error: 'No puedes reclamar tu propio objeto' });
      }

      const activeClaim = await CurbObject.findOne({
        claimedByUserId: req.firebaseUid,
        status: 'onMyWay',
        isDeleted: false,
      });
      if (activeClaim && !activeClaim.isClaimExpired) {
        return res.status(409).json({
          error: 'Ya tienes un objeto reclamado activo',
          claimId: activeClaim._id,
        });
      }

      object.status           = 'onMyWay';
      object.claimedByUserId  = req.firebaseUid;
      object.claimedByUserName = req.user.username || req.user.name;
      object.claimedAt        = new Date();
      object.lastConfirmedAt  = new Date();

    // ── available ─────────────────────────────────────────────────────────
    } else if (status === 'available') {
      if (!isOwner && !isClaimer) {
        return res.status(403).json({ error: 'No tienes permiso para liberar este objeto' });
      }
      object.status            = 'available';
      object.claimedByUserId   = null;
      object.claimedByUserName = null;
      object.claimedAt         = null;
      object.claimedUserEta    = null;

    // ── pickedUp ──────────────────────────────────────────────────────────
    } else if (status === 'pickedUp') {
      if (!isClaimer && !isOwner) {
        return res.status(403).json({ error: 'No tienes permiso para marcar este objeto como recogido' });
      }

      // Puntos + estadísticas
      await addPointsToUser(req.firebaseUid, POINTS.PICK_OBJECT, {
        foundCount: 1,
        totalImpactValue: object.estimatedValue,
      });

      // Notificar al publicador via FCM
      if (!isOwner) {
        notificationService.notifyUser(
          object.postedByUserId,
          '🎉 ¡Tu objeto fue recogido!',
          `"${object.title}" fue recogido por ${req.user.username || req.user.name}`,
        ).catch(console.error);
      }

      object.status    = 'pickedUp';
      object.isDeleted = true;
      object.deletedAt = new Date();
    }

    await object.save();

    // ── Socket.io: notificar a todos en el mapa y en la sala del objeto ──
    const objectId = object._id.toString();

    if (status === 'pickedUp') {
      // El objeto desaparece del mapa
      emitObjectEvent(req, 'object:deleted', { objectId });
    } else {
      // El objeto cambió de estado
      emitObjectEvent(req, 'object:updated', {
        objectId,
        status:            object.status,
        claimedByUserId:   object.claimedByUserId,
        claimedByUserName: object.claimedByUserName,
        claimedAt:         object.claimedAt,
      });
    }

    res.json({ message: 'Estado actualizado', status: object.status });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/objects/:id/confirm ───────────────────────────────────────────
router.post('/:id/confirm', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const object = await CurbObject.findById(req.params.id);
    if (!object || object.isDeleted) {
      return res.status(404).json({ error: 'Objeto no encontrado' });
    }

    const confirmationKey = `confirmations.${req.firebaseUid}`;
    const alreadyConfirmed = await CurbObject.findOne({
      _id: req.params.id,
      [confirmationKey]: { $exists: true },
    });

    if (alreadyConfirmed) {
      return res.status(409).json({ error: 'Ya confirmaste este objeto', firstTime: false });
    }

    await CurbObject.findByIdAndUpdate(req.params.id, {
      lastConfirmedAt: new Date(),
      $inc: { confirmations: 1 },
      $set: { [confirmationKey]: new Date() },
    });

    await addPointsToUser(req.firebaseUid, POINTS.CONFIRM_OBJECT, { confirmationsCount: 1 });

    // Socket: actualizar el timer del objeto en todos los mapas abiertos
    emitObjectEvent(req, 'object:updated', {
      objectId: req.params.id,
      lastConfirmedAt: new Date().toISOString(),
      confirmations: (object.confirmations || 0) + 1,
    });

    res.json({ message: 'Confirmación registrada', firstTime: true });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/objects/:id/eta ───────────────────────────────────────────────
router.patch('/:id/eta', authMiddleware, async (req, res, next) => {
  try {
    const { eta } = req.body;
    const object = await CurbObject.findById(req.params.id);

    if (!object || object.claimedByUserId !== req.firebaseUid) {
      return res.status(403).json({ error: 'No puedes actualizar el ETA de este objeto' });
    }

    object.claimedUserEta = eta;
    await object.save();

    // Socket: publicador ve el ETA en tiempo real
    emitObjectEvent(req, 'object:updated', {
      objectId: req.params.id,
      claimedUserEta: eta,
    });

    res.json({ message: 'ETA actualizado' });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/objects/:id/comments ───────────────────────────────────────────
router.get('/:id/comments', authMiddleware, async (req, res, next) => {
  try {
    const comments = await Comment.find({ objectId: req.params.id })
      .sort({ createdAt: -1 }).limit(50).lean();
    res.json({ comments });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/objects/:id/comments ──────────────────────────────────────────
router.post('/:id/comments', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'El comentario no puede estar vacío' });

    const comment = await Comment.create({
      objectId:     req.params.id,
      userId:       req.firebaseUid,
      userName:     req.user.username || req.user.name,
      userImageUrl: req.user.profileImageUrl || '',
      text:         text.trim(),
    });

    res.status(201).json({ comment });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/objects/:id/report ─────────────────────────────────────────────
router.post('/:id/report', authMiddleware, async (req, res, next) => {
  try {
    const { reason, description } = req.body;
    if (!reason) return res.status(400).json({ error: 'Motivo requerido' });

    await Report.create({
      objectId:           req.params.id,
      reportedByUserId:   req.firebaseUid,
      reason,
      description:        description || '',
    });

    res.status(201).json({ message: 'Reporte enviado' });
  } catch (err) {
    next(err);
  }
});

// ─── Helper: sumar puntos y recalcular nivel ──────────────────────────────────
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

  if (updated) {
    const newLevel = Math.floor(updated.points / 500) + 1;
    if (newLevel !== updated.level) {
      await User.findOneAndUpdate({ firebaseUid }, { level: newLevel });
    }
  }
}

module.exports = router;
