const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    objectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CurbObject',
      required: true,
      index: true,
    },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    senderImageUrl: { type: String, default: '' },
    text: { type: String, required: true, trim: true },
  },
  {
    timestamps: true, // createdAt = timestamp del mensaje
  }
);

chatMessageSchema.index({ objectId: 1, createdAt: -1 });

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
module.exports = { ChatMessage };
