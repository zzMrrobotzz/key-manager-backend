const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  actor: { type: String, default: 'System' },
  action: { type: String, required: true },
  details: { type: String },
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
