const mongoose = require('mongoose');

const creditPackageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  credits: { type: Number, required: true },
  bonus: { type: String, default: '' },
  isPopular: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true }, // Để ẩn/hiện gói cước
});

module.exports = mongoose.model('CreditPackage', creditPackageSchema);
