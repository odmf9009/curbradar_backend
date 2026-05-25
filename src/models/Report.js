const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    objectId: { type: String, required: true, index: true },
    reportedByUserId: { type: String, required: true },
    reason: { type: String, required: true },
    description: { type: String, default: '' },
    isResolved: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
    resolvedByUserId: { type: String, default: null },
  },
  { timestamps: true }
);

const Report = mongoose.model('Report', reportSchema);
module.exports = { Report };
