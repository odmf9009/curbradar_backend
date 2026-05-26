/**
 * PM2 Ecosystem Config — CurbRadar Backend
 *
 * Uso en el VPS (Ubuntu + Hostinger):
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup   ← genera el comando para arrancar al reiniciar el servidor
 *
 * Comandos útiles:
 *   pm2 status                  → ver estado
 *   pm2 logs curbradar-backend  → ver logs en vivo
 *   pm2 restart curbradar-backend
 *   pm2 reload curbradar-backend  ← recarga sin downtime (zero-downtime)
 */
module.exports = {
  apps: [
    {
      name: 'curbradar-backend',
      script: 'server.js',

      // Número de instancias (1 por ahora; aumentar si tienes múltiples CPUs)
      instances: 1,

      // Reiniciar si el proceso cae
      autorestart: true,
      watch: false,

      // Memoria máxima antes de reiniciar automáticamente
      max_memory_restart: '512M',

      // Variables de entorno para producción
      // ⚠️ Las sensibles van en el archivo .env del servidor, NO aquí
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },

      env_development: {
        NODE_ENV: 'development',
        PORT: 3001,
      },

      // Logs
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Esperar antes de considerar el proceso como caído
      min_uptime: '10s',
      max_restarts: 10,
    },
  ],
};
