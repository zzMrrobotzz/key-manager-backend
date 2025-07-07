const mongoose = require('mongoose');

const keySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  expiredAt: { type: Date },
  maxActivations: { type: Number, default: 1 },
  note: { type: String, default: "" },
  credit: { type: Number, default: 0 },
});

module.exports = mongoose.model('Key', keySchema);
