const mongoose = require('mongoose');

const CURB_OBJECT_STATUSES = ['available', 'onMyWay', 'pickedUp'];
const CATEGORIES = ['Muebles', 'Electrodomésticos', 'Electrónica', 'Ropa', 'Juguetes', 'Otros'];

// ⚠️ REGLAS DE NEGOCIO CRÍTICAS (ver CLAUDE.md sección 3.1):
// - Expiración: 48h sin confirmación → objeto inactivo
// - Claim: Solo 1 usuario onMyWay, expira en 2h
// - pickedUp: En la app original se borraba; aquí lo marcamos isDeleted=true para auditoría

const curbObjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, enum: CATEGORIES, default: 'Otros' },
    imageUrls: [{ type: String }],

    // Geolocalización (índice 2dsphere para queries de proximidad)
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude] — orden MongoDB
        required: true,
      },
    },

    address: { type: String, default: 'Ubicación desconocida' },
    locality: { type: String }, // Ciudad/área para notificaciones segmentadas

    status: {
      type: String,
      enum: CURB_OBJECT_STATUSES,
      default: 'available',
    },

    // Publicador
    postedByUserId: { type: String, required: true },
    postedByUserName: { type: String, required: true },

    // Claim — quién va en camino
    claimedByUserId: { type: String, default: null },
    claimedByUserName: { type: String, default: null },
    claimedAt: { type: Date, default: null },
    claimedUserEta: { type: String, default: null },

    // Expiry logic
    lastConfirmedAt: { type: Date, default: Date.now },

    // Métricas
    views: { type: Number, default: 0 },
    confirmations: { type: Number, default: 0 },
    estimatedValue: { type: Number, default: 0.0 },

    // Chat
    isChatEnabled: { type: Boolean, default: true },
    lastMessageAt: { type: Date, default: null },
    lastMessageBy: { type: String, default: null },

    // Soft delete (a diferencia de Firebase, guardamos historial)
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true, // Agrega createdAt y updatedAt automáticamente
  }
);

// Índice geoespacial — CRÍTICO para queries de objetos cercanos
curbObjectSchema.index({ location: '2dsphere' });
curbObjectSchema.index({ postedByUserId: 1, createdAt: -1 });
curbObjectSchema.index({ status: 1, lastConfirmedAt: -1 });
curbObjectSchema.index({ isDeleted: 1, status: 1 });

// Método virtual: ¿Está expirado?
curbObjectSchema.virtual('isExpired').get(function () {
  const expiryLimit = new Date(Date.now() - 48 * 60 * 60 * 1000);
  return this.lastConfirmedAt < expiryLimit && this.status !== 'pickedUp';
});

// Método virtual: ¿El claim expiró?
curbObjectSchema.virtual('isClaimExpired').get(function () {
  if (this.status !== 'onMyWay' || !this.claimedAt) return false;
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  return this.claimedAt < twoHoursAgo;
});

// Helper: Coordenadas en formato {latitude, longitude} para el cliente
curbObjectSchema.methods.toClientFormat = function () {
  const obj = this.toObject({ virtuals: true });
  obj.latitude = this.location.coordinates[1];
  obj.longitude = this.location.coordinates[0];
  delete obj.location;
  return obj;
};

const CurbObject = mongoose.model('CurbObject', curbObjectSchema);

module.exports = { CurbObject, CURB_OBJECT_STATUSES, CATEGORIES };
