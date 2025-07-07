const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  creditAmount: { type: Number, required: true },
  key: { type: String, required: true },
  status: { type: String, enum: ['Success', 'Failed'], required: true },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Transaction', transactionSchema);
