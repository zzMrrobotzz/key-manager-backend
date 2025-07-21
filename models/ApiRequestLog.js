const mongoose = require('mongoose');

const apiRequestLogSchema = new mongoose.Schema({
  provider: { 
    type: String, 
    required: true,
    index: true
  },
  userId: { 
    type: String, 
    required: true,
    index: true
  },
  promptLength: { type: Number, default: 0 },
  responseLength: { type: Number, default: 0 },
  tokenUsage: {
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 }
  },
  success: { type: Boolean, required: true },
  error: { type: String, default: null },
  retries: { type: Number, default: 0 },
  requestType: { 
    type: String, 
    enum: ['text', 'image'], 
    default: 'text' 
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true
  }
});

// Compound index for efficient daily stats queries
apiRequestLogSchema.index({ provider: 1, createdAt: 1 });
apiRequestLogSchema.index({ createdAt: 1, success: 1 });

module.exports = mongoose.model('ApiRequestLog', apiRequestLogSchema);