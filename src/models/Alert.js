const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    objectId: { type: String, required: true },
    objectTitle: { type: String, required: true },
    objectImageUrl: { type: String, default: '' },
    address: { type: String, default: '' },
    distance: { type: Number, default: 0 }, // En metros
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Evitar duplicados: un usuario solo recibe 1 alerta por objeto (por sesión/día)
alertSchema.index({ userId: 1, objectId: 1 }, { unique: true });
alertSchema.index({ userId: 1, createdAt: -1 });

const Alert = mongoose.model('Alert', alertSchema);
module.exports = { Alert };
