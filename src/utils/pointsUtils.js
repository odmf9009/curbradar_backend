/**
 * Sistema de puntos de CurbRadar (ver CLAUDE.md sección 3.2).
 * Nivel = floor(points / 500) + 1
 */

const POINTS = {
  POST_OBJECT: 50,          // Publicar un objeto en la calle
  PICK_OBJECT: 100,         // Recoger un objeto (marcar como pickedUp)
  CONFIRM_OBJECT: 20,       // Confirmar que un objeto sigue ahí (1 vez por objeto)
  UPDATE_PHOTO: 30,         // Actualizar la foto de un objeto (1 vez por objeto por usuario)
  FIRST_CLAIM: 10,          // Primera vez que reclamas un objeto
};

/**
 * Calcula el nivel a partir de los puntos.
 */
function calculateLevel(points) {
  return Math.floor(points / 500) + 1;
}

/**
 * Obtiene el título del nivel.
 */
function getLevelTitle(level) {
  if (level < 5) return 'Explorador';
  if (level < 15) return 'Cazador';
  if (level < 30) return 'Experto';
  return 'Leyenda';
}

/**
 * Calcula los puntos necesarios para el siguiente nivel.
 */
function pointsToNextLevel(currentPoints) {
  const currentLevel = calculateLevel(currentPoints);
  const nextLevelPoints = currentLevel * 500;
  return nextLevelPoints - currentPoints;
}

module.exports = { POINTS, calculateLevel, getLevelTitle, pointsToNextLevel };
