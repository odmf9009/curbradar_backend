const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema(
  {
    objectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CurbObject',
      required: true,
      index: true,
    },
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    userImageUrl: { type: String, default: '' },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

commentSchema.index({ objectId: 1, createdAt: -1 });

const Comment = mongoose.model('Comment', commentSchema);
module.exports = { Comment };
