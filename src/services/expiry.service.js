const cron = require('node-cron');
const { CurbObject } = require('../models/CurbObject');

/**
 * Job de limpieza de objetos expirados y claims vencidos.
 * Se ejecuta cada hora.
 *
 * Reglas (ver CLAUDE.md sección 3.1):
 * - Objetos: expiran a las 48h sin confirmación
 * - Claims: expiran a las 2h desde claimedAt
 */
function startExpiryJob() {
  // Cada hora
  cron.schedule('0 * * * *', async () => {
    console.log('[Expiry] Iniciando limpieza de objetos expirados y claims...');

    try {
      const now = new Date();
      const expiryLimit = new Date(now - 48 * 60 * 60 * 1000);
      const claimExpiryLimit = new Date(now - 2 * 60 * 60 * 1000);

      // 1. Marcar como eliminados (soft delete) los objetos expirados
      const expiredResult = await CurbObject.updateMany(
        {
          isDeleted: false,
          status: { $in: ['available', 'onMyWay'] },
          lastConfirmedAt: { $lt: expiryLimit },
        },
        {
          $set: {
            isDeleted: true,
            deletedAt: now,
          },
        }
      );

      if (expiredResult.modifiedCount > 0) {
        console.log(`[Expiry] ${expiredResult.modifiedCount} objetos expirados eliminados`);
      }

      // 2. Resetear claims expirados (onMyWay → available)
      const claimsResult = await CurbObject.updateMany(
        {
          isDeleted: false,
          status: 'onMyWay',
          claimedAt: { $lt: claimExpiryLimit },
        },
        {
          $set: {
            status: 'available',
            claimedByUserId: null,
            claimedByUserName: null,
            claimedAt: null,
            claimedUserEta: null,
          },
        }
      );

      if (claimsResult.modifiedCount > 0) {
        console.log(`[Expiry] ${claimsResult.modifiedCount} claims expirados reseteados`);
      }
    } catch (err) {
      console.error('[Expiry] Error en job de limpieza:', err.message);
    }
  });

  console.log('✅ Job de expiración iniciado (cada hora)');
}

module.exports = { startExpiryJob };
