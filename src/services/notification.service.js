const { admin } = require('../config/firebase');
const { User } = require('../models/User');

/**
 * Servicio de notificaciones push via FCM (Firebase Cloud Messaging).
 * Usa Firebase Admin SDK para enviar desde el servidor (seguro).
 */

/**
 * Envía una notificación push a un usuario específico por firebaseUid.
 */
async function notifyUser(firebaseUid, title, body, data = {}) {
  try {
    const user = await User.findOne({ firebaseUid }).select('fcmToken').lean();
    if (!user?.fcmToken) return;

    const message = {
      notification: { title, body },
      data: { ...data },
      token: user.fcmToken,
      android: {
        priority: 'high',
        notification: { channelId: 'curbradar_alerts' },
      },
      apns: {
        payload: {
          aps: { badge: 1, sound: 'default' },
        },
      },
    };

    await admin.messaging().send(message);
    console.log(`[FCM] Notificación enviada a ${firebaseUid}`);
  } catch (err) {
    console.error(`[FCM] Error enviando a ${firebaseUid}:`, err.message);
  }
}

/**
 * Notifica a usuarios cercanos cuando se publica un nuevo objeto.
 * Busca usuarios online con isOnline=true dentro del radio del objeto.
 */
async function notifyNearbyUsers(curbObject) {
  try {
    const radiusInMeters = 5000; // 5km

    // Buscar usuarios online cercanos al objeto
    const nearbyUsers = await User.find({
      isOnline: true,
      firebaseUid: { $ne: curbObject.postedByUserId }, // Excluir al propio publicador
      location: {
        $near: {
          $geometry: curbObject.location,
          $maxDistance: radiusInMeters,
        },
      },
    })
      .select('firebaseUid fcmToken')
      .limit(50)
      .lean();

    if (!nearbyUsers.length) return;

    const tokens = nearbyUsers.map((u) => u.fcmToken).filter(Boolean);
    if (!tokens.length) return;

    const message = {
      notification: {
        title: '💎 ¡Nuevo tesoro cerca!',
        body: `"${curbObject.title}" está disponible cerca de ti. ¡Sé el primero!`,
      },
      data: {
        objectId: curbObject._id.toString(),
        type: 'new_object',
      },
      tokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`[FCM] Enviadas ${response.successCount}/${tokens.length} notificaciones de nuevo objeto`);
  } catch (err) {
    console.error('[FCM] Error en notifyNearbyUsers:', err.message);
  }
}

/**
 * Envía un multicast a un array de tokens.
 */
async function sendMulticast(tokens, title, body, data = {}) {
  if (!tokens.length) return;
  try {
    const message = {
      notification: { title, body },
      data,
      tokens,
    };
    const response = await admin.messaging().sendEachForMulticast(message);
    return response;
  } catch (err) {
    console.error('[FCM] Error en sendMulticast:', err.message);
  }
}

module.exports = { notifyUser, notifyNearbyUsers, sendMulticast };
