const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { ChatMessage } = require('../models/ChatMessage');
const { CurbObject } = require('../models/CurbObject');

// GET /api/chat/:objectId — Obtener mensajes del chat de un objeto
router.get('/:objectId', authMiddleware, async (req, res, next) => {
  try {
    const messages = await ChatMessage.find({ objectId: req.params.objectId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/:objectId — Enviar mensaje al chat de un objeto
router.post('/:objectId', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Mensaje vacío' });

    const message = await ChatMessage.create({
      objectId: req.params.objectId,
      senderId: req.firebaseUid,
      senderName: req.user.username || req.user.name,
      senderImageUrl: req.user.profileImageUrl || '',
      text: text.trim(),
    });

    // Actualizar metadata del objeto para notificaciones de no leídos
    await CurbObject.findByIdAndUpdate(req.params.objectId, {
      lastMessageAt: new Date(),
      lastMessageBy: req.firebaseUid,
    });

    // Emitir por Socket.io para tiempo real
    const io = req.app.get('io');
    io.to(`object_${req.params.objectId}`).emit('newMessage', message);

    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
