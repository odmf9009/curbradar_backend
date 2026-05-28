const mongoose = require('mongoose');

const CURB_OBJECT_STATUSES = ['available', 'onMyWay', 'pickedUp'];
const CATEGORIES = ['Muebles', 'Electrodomésticos', 'Electrónica', 'Ropa', 'Juguetes', 'Otros'];

const curbObjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, enum: CATEGORIES, default: 'Otros' },
    imageUrl: { type: String }, // Imagen principal
    imageUrls: [{ type: String }], // Historial de imágenes

    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },

    address: { type: String, default: 'Ubicación desconocida' },
    locality: { type: String },

    status: {
      type: String,
      enum: CURB_OBJECT_STATUSES,
      default: 'available',
    },

    postedByUserId: { type: String, required: true },
    postedByUserName: { type: String, required: true },

    claimedByUserId: { type: String, default: null },
    claimedByUserName: { type: String, default: null },
    claimedAt: { type: Date, default: null },
    claimedUserEta: { type: String, default: null },

    lastConfirmedAt: { type: Date, default: Date.now },

    views: { type: Number, default: 0 },
    confirmations: { type: Number, default: 0 },
    confirmedBy: { type: Map, of: Date, default: {} },
    confirmedByIds: [{ type: String }], // Mantenemos ambos por compatibilidad durante la migración

    estimatedValue: { type: Number, default: 0.0 },

    isChatEnabled: { type: Boolean, default: true },
    lastMessageAt: { type: Date, default: null },
    lastMessageBy: { type: String, default: null },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

curbObjectSchema.index({ location: '2dsphere' });
curbObjectSchema.index({ postedByUserId: 1, createdAt: -1 });
curbObjectSchema.index({ status: 1, lastConfirmedAt: -1 });
curbObjectSchema.index({ isDeleted: 1, status: 1 });

curbObjectSchema.virtual('isExpired').get(function () {
  const expiryLimit = new Date(Date.now() - 48 * 60 * 60 * 1000);
  return this.lastConfirmedAt < expiryLimit && this.status !== 'pickedUp';
});

curbObjectSchema.virtual('isClaimExpired').get(function () {
  if (this.status !== 'onMyWay' || !this.claimedAt) return false;
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  return this.claimedAt < twoHoursAgo;
});

const CurbObject = mongoose.model('CurbObject', curbObjectSchema);

module.exports = { CurbObject, CURB_OBJECT_STATUSES, CATEGORIES };
