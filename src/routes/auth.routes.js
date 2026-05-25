const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { admin } = require('../config/firebase');
const { User } = require('../models/User');

/**
 * POST /api/auth/verify
 * Verifica el token de Firebase y crea/retorna el usuario en MongoDB.
 * El cliente debe llamar esto en el primer login y cuando quiera obtener su perfil.
 * Body: { fcmToken?: string }
 */
router.post('/verify', authMiddleware, async (req, res, next) => {
  try {
    const { fcmToken } = req.body;

    // Obtener info del usuario desde Firebase Auth
    const firebaseUser = await admin.auth().getUser(req.firebaseUid);

    let user = await User.findOne({ firebaseUid: req.firebaseUid });

    if (!user) {
      // Primera vez: crear perfil en MongoDB
      user = await User.create({
        firebaseUid: req.firebaseUid,
        name: firebaseUser.displayName || 'Usuario CurbRadar',
        email: firebaseUser.email || '',
        profileImageUrl: firebaseUser.photoURL || '',
        fcmToken: fcmToken || null,
      });
      console.log(`[Auth] Nuevo usuario creado: ${user.firebaseUid}`);
    } else if (fcmToken && user.fcmToken !== fcmToken) {
      // Actualizar FCM token si cambió
      user.fcmToken = fcmToken;
      user.lastActive = new Date();
      await user.save();
    }

    res.json({
      user: {
        id: user._id,
        firebaseUid: user.firebaseUid,
        name: user.name,
        username: user.username,
        email: user.email,
        profileImageUrl: user.profileImageUrl,
        points: user.points,
        level: user.level,
        levelTitle: user.levelTitle,
        postsCount: user.postsCount,
        foundCount: user.foundCount,
        confirmationsCount: user.confirmationsCount,
        totalImpactValue: user.totalImpactValue,
        favorites: user.favorites,
        isOnline: user.isOnline,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 * Limpia el FCM token y pone isOnline = false
 */
router.post('/logout', authMiddleware, async (req, res, next) => {
  try {
    await User.findOneAndUpdate(
      { firebaseUid: req.firebaseUid },
      { fcmToken: null, isOnline: false, lastActive: new Date() }
    );
    res.json({ message: 'Sesión cerrada correctamente' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
