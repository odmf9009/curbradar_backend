const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const adminMiddleware = require('../middlewares/admin.middleware');
const { CurbObject } = require('../models/CurbObject');
const { User } = require('../models/User');
const { Report } = require('../models/Report');

// Todas las rutas de admin requieren autenticación + rol admin
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/reports — Ver todos los reportes pendientes
router.get('/reports', async (req, res, next) => {
  try {
    const reports = await Report.find({ isResolved: false })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ reports });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/reports/:id/dismiss — Descartar un reporte
router.patch('/reports/:id/dismiss', async (req, res, next) => {
  try {
    await Report.findByIdAndUpdate(req.params.id, {
      isResolved: true,
      resolvedAt: new Date(),
      resolvedByUserId: req.firebaseUid,
    });
    res.json({ message: 'Reporte descartado' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/objects/:id — Eliminar un objeto (por moderación)
router.delete('/objects/:id', async (req, res, next) => {
  try {
    await CurbObject.findByIdAndUpdate(req.params.id, {
      isDeleted: true,
      deletedAt: new Date(),
    });
    // Resolver reportes asociados
    await Report.updateMany(
      { objectId: req.params.id, isResolved: false },
      { isResolved: true, resolvedAt: new Date(), resolvedByUserId: req.firebaseUid }
    );
    res.json({ message: 'Objeto eliminado por moderación' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/objects — Eliminar TODOS los objetos (¡cuidado!)
router.delete('/objects', async (req, res, next) => {
  try {
    const result = await CurbObject.updateMany(
      { isDeleted: false },
      { isDeleted: true, deletedAt: new Date() }
    );
    res.json({ message: `${result.modifiedCount} objetos eliminados` });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users — Ver todos los usuarios
router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find()
      .sort({ lastActive: -1 })
      .limit(100)
      .lean();
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/users/:uid/role — Cambiar rol de usuario
router.patch('/users/:uid/role', async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    await User.findOneAndUpdate({ firebaseUid: req.params.uid }, { role });
    res.json({ message: `Rol actualizado a ${role}` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
