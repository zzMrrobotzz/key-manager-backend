const mongoose = require('mongoose');

const bankInfoSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        default: 'default'
    },
    bankName: {
        type: String,
        required: true,
        default: 'Vietcombank'
    },
    accountNumber: {
        type: String,
        required: true,
        default: '0123456789'
    },
    accountName: {
        type: String,
        required: true,
        default: 'NGUYEN VAN A'
    },
    branchName: {
        type: String,
        default: 'CN Ho Chi Minh'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    note: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// Only allow one active bank info at a time
bankInfoSchema.pre('save', async function(next) {
    if (this.isActive) {
        await mongoose.model('BankInfo').updateMany(
            { _id: { $ne: this._id } },
            { isActive: false }
        );
    }
    next();
});

// Static method to get active bank info
bankInfoSchema.statics.getActiveBankInfo = function() {
    return this.findOne({ isActive: true });
};

module.exports = mongoose.model('BankInfo', bankInfoSchema);