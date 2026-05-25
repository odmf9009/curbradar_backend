const mongoose = require('mongoose');

// "Se busca" — Un usuario publica que busca un tipo de objeto específico
const requestSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    category: { type: String, default: 'Otros' },
    city: { type: String, default: '' },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    isResolved: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

requestSchema.index({ location: '2dsphere' });
requestSchema.index({ isResolved: 1, createdAt: -1 });

const Request = mongoose.model('Request', requestSchema);
module.exports = { Request };
