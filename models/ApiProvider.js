const mongoose = require('mongoose');

const apiProviderSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  apiKeys: [{ type: String, unique: true }], // Array to store multiple API keys
  status: { type: String, enum: ['Operational', 'Degraded', 'Error', 'Unknown'], default: 'Unknown' },
  costToday: { type: Number, default: 0 },
  totalRequests: { type: Number, default: 0 },
  lastChecked: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ApiProvider', apiProviderSchema);
