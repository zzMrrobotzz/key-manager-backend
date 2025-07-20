const mongoose = require('mongoose');

const apiProviderSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  apiKeys: [{ type: String, unique: true }], // Array to store multiple API keys
  status: { type: String, enum: ['Operational', 'Degraded', 'Error', 'Unknown'], default: 'Unknown' },
  costToday: { type: Number, default: 0 },
  totalRequests: { type: Number, default: 0 },
  lastChecked: { type: Date, default: Date.now },
  // Enhanced API key tracking
  keyStatus: [{
    key: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    quotaExceeded: { type: Boolean, default: false },
    lastError: { type: String, default: null },
    lastErrorTime: { type: Date, default: null },
    requestCount: { type: Number, default: 0 },
    lastUsed: { type: Date, default: null }
  }]
});

module.exports = mongoose.model('ApiProvider', apiProviderSchema);
