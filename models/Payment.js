const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    userKey: {
        type: String,
        required: true,
        index: true
    },
    creditAmount: {
        type: Number,
        required: true,
        min: 1
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'expired'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['bank_transfer', 'qr_code', 'momo', 'zalopay'],
        default: 'qr_code'
    },
    transactionId: {
        type: String,
        unique: true,
        sparse: true  // Allow multiple null values
    },
    paymentData: {
        payUrl: String,
        qrCode: String,
        bankAccount: String,
        amount: Number,
        transferContent: String,
        orderCode: Number,
        payosPaymentLinkId: String
    },
    metadata: {
        ip: String,
        userAgent: String,
        referer: String
    },
    completedAt: {
        type: Date
    },
    expiredAt: {
        type: Date,
        default: function() {
            // Payment expires after 30 minutes
            return new Date(Date.now() + 30 * 60 * 1000);
        }
    }
}, {
    timestamps: true
});

// Index for performance
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ userKey: 1, status: 1 });
paymentSchema.index({ expiredAt: 1 }, { expireAfterSeconds: 0 }); // Auto-delete expired documents

// Methods
paymentSchema.methods.isExpired = function() {
    return new Date() > this.expiredAt;
};

paymentSchema.methods.markAsCompleted = function(transactionId) {
    this.status = 'completed';
    this.transactionId = transactionId;
    this.completedAt = new Date();
    return this.save();
};

paymentSchema.methods.markAsFailed = function() {
    this.status = 'failed';
    return this.save();
};

// Static methods
paymentSchema.statics.findActivePayment = function(userKey, creditAmount) {
    return this.findOne({
        userKey,
        creditAmount,
        status: 'pending',
        expiredAt: { $gt: new Date() }
    });
};

paymentSchema.statics.cleanup = async function() {
    // Clean up expired pending payments
    const result = await this.updateMany(
        {
            status: 'pending',
            expiredAt: { $lt: new Date() }
        },
        {
            $set: { status: 'expired' }
        }
    );
    return result;
};

module.exports = mongoose.model('Payment', paymentSchema);