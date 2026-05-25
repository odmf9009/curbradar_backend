/**
 * Utilidades de geolocalización para CurbRadar.
 */

const EARTH_RADIUS_M = 6371000; // Radio de la tierra en metros

/**
 * Calcula la distancia en metros entre dos coordenadas usando la fórmula de Haversine.
 */
function distanceBetween(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Convierte coordenadas Flutter (lat, lng) al formato MongoDB (coordinates: [lng, lat]).
 */
function toMongoCoordinates(latitude, longitude) {
  return [parseFloat(longitude), parseFloat(latitude)];
}

/**
 * Convierte coordenadas MongoDB ([lng, lat]) al formato Flutter ({ latitude, longitude }).
 */
function fromMongoCoordinates(coordinates) {
  return {
    longitude: coordinates[0],
    latitude: coordinates[1],
  };
}

module.exports = { distanceBetween, toMongoCoordinates, fromMongoCoordinates };
