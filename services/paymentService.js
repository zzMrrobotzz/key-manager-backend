const Payment = require('../models/Payment');
const Key = require('../models/Key');
const CreditPackage = require('../models/CreditPackage');
const { v4: uuidv4 } = require('uuid');

class PaymentService {
    constructor() {
        this.bankInfo = {
            accountNumber: process.env.BANK_ACCOUNT_NUMBER || '0123456789',
            accountName: process.env.BANK_ACCOUNT_NAME || 'NGUYEN VAN A',
            bankName: process.env.BANK_NAME || 'Vietcombank',
            branchName: process.env.BANK_BRANCH || 'CN Ho Chi Minh'
        };
    }

    /**
     * Get price for credit amount from database
     */
    async getPriceForCredit(creditAmount) {
        try {
            const creditPackage = await CreditPackage.findOne({ 
                credits: creditAmount, 
                isActive: { $ne: false } 
            });
            return creditPackage ? creditPackage.price : null;
        } catch (error) {
            console.error('Error getting price for credit:', error);
            return null;
        }
    }

    /**
     * Validate credit amount from database
     */
    async isValidCreditAmount(creditAmount) {
        try {
            const creditPackage = await CreditPackage.findOne({ 
                credits: creditAmount, 
                isActive: { $ne: false } 
            });
            return !!creditPackage;
        } catch (error) {
            console.error('Error validating credit amount:', error);
            return false;
        }
    }

    /**
     * Generate transfer content
     */
    generateTransferContent(userKey, paymentId) {
        // Use last 8 chars of userKey and payment ID for uniqueness
        const keyShort = userKey.slice(-8);
        const paymentShort = paymentId.slice(-8);
        return `NAPCREDIT ${keyShort} ${paymentShort}`;
    }

    /**
     * Generate payment URL (for demo purposes - replace with real payment gateway)
     */
    generatePaymentUrl(paymentData) {
        // For demo, we'll create a simple URL that shows payment info
        // In production, integrate with real payment gateways like VNPay, MoMo, ZaloPay
        const params = new URLSearchParams({
            amount: paymentData.amount,
            content: paymentData.transferContent,
            account: this.bankInfo.accountNumber,
            bank: this.bankInfo.bankName
        });
        
        // This should be replaced with actual payment gateway URL
        return `https://demo-payment-gateway.com/pay?${params.toString()}`;
    }

    /**
     * Generate QR code data
     */
    generateQRData(paymentData) {
        // Vietnam QR Pay format
        // This is a simplified version - in production use proper QR banking format
        return `BANK:${this.bankInfo.bankName}|ACC:${this.bankInfo.accountNumber}|AMOUNT:${paymentData.amount}|MSG:${paymentData.transferContent}`;
    }

    /**
     * Create payment
     */
    async createPayment(userKey, creditAmount, metadata = {}) {
        try {
            // Validate inputs
            if (!userKey || !creditAmount) {
                throw new Error('User key and credit amount are required');
            }

            if (!(await this.isValidCreditAmount(creditAmount))) {
                throw new Error('Invalid credit amount');
            }

            // Check if user key exists and is active
            const keyDoc = await Key.findOne({ key: userKey, isActive: true });
            if (!keyDoc) {
                throw new Error('Invalid or inactive user key');
            }

            const price = await this.getPriceForCredit(creditAmount);
            if (!price) {
                throw new Error('Unable to get price for credit amount');
            }

            // Check for existing active payment
            const existingPayment = await Payment.findActivePayment(userKey, creditAmount);
            if (existingPayment) {
                // Return existing payment if still valid
                return {
                    success: true,
                    payment: existingPayment,
                    payUrl: existingPayment.paymentData.payUrl,
                    qrData: existingPayment.paymentData.qrCode
                };
            }

            // Create new payment
            const paymentId = uuidv4();
            const transferContent = this.generateTransferContent(userKey, paymentId);
            
            const paymentData = {
                amount: price,
                transferContent,
                bankAccount: this.bankInfo.accountNumber,
                payUrl: '',
                qrCode: ''
            };

            // Generate payment URL and QR data
            paymentData.payUrl = this.generatePaymentUrl(paymentData);
            paymentData.qrCode = this.generateQRData(paymentData);

            const payment = new Payment({
                userKey,
                creditAmount,
                price,
                paymentData,
                metadata,
                status: 'pending'
            });

            await payment.save();

            console.log(`💳 Payment created: ${payment._id} for user ${userKey.substring(0, 10)}... Amount: ${price} VND`);

            return {
                success: true,
                payment,
                payUrl: paymentData.payUrl,
                qrData: paymentData.qrCode,
                transferInfo: {
                    accountNumber: this.bankInfo.accountNumber,
                    accountName: this.bankInfo.accountName,
                    bankName: this.bankInfo.bankName,
                    amount: price,
                    content: transferContent
                }
            };

        } catch (error) {
            console.error('Payment creation error:', error);
            throw error;
        }
    }

    /**
     * Complete payment (manual verification for now)
     */
    async completePayment(paymentId, transactionId = null) {
        try {
            const payment = await Payment.findById(paymentId);
            if (!payment) {
                throw new Error('Payment not found');
            }

            if (payment.status !== 'pending') {
                throw new Error('Payment is not in pending status');
            }

            if (payment.isExpired()) {
                await payment.markAsFailed();
                throw new Error('Payment has expired');
            }

            // Update user credit
            const key = await Key.findOne({ key: payment.userKey });
            if (!key) {
                throw new Error('User key not found');
            }

            await Key.findByIdAndUpdate(key._id, {
                $inc: { credit: payment.creditAmount }
            });

            // Mark payment as completed
            await payment.markAsCompleted(transactionId || `MANUAL_${Date.now()}`);

            console.log(`✅ Payment completed: ${payment._id} - Added ${payment.creditAmount} credits to ${payment.userKey.substring(0, 10)}...`);

            return {
                success: true,
                payment,
                newCreditBalance: key.credit + payment.creditAmount
            };

        } catch (error) {
            console.error('Payment completion error:', error);
            throw error;
        }
    }

    /**
     * Get payment status
     */
    async getPaymentStatus(paymentId) {
        try {
            const payment = await Payment.findById(paymentId);
            if (!payment) {
                throw new Error('Payment not found');
            }

            return {
                success: true,
                payment,
                isExpired: payment.isExpired()
            };

        } catch (error) {
            console.error('Get payment status error:', error);
            throw error;
        }
    }

    /**
     * Get user payments
     */
    async getUserPayments(userKey, limit = 10) {
        try {
            const payments = await Payment.find({ userKey })
                .sort({ createdAt: -1 })
                .limit(limit);

            return {
                success: true,
                payments
            };

        } catch (error) {
            console.error('Get user payments error:', error);
            throw error;
        }
    }

    /**
     * Cleanup expired payments
     */
    async cleanupExpiredPayments() {
        try {
            const result = await Payment.cleanup();
            console.log(`🧹 Cleaned up ${result.modifiedCount} expired payments`);
            return result;
        } catch (error) {
            console.error('Cleanup expired payments error:', error);
            throw error;
        }
    }
}

const paymentServiceInstance = new PaymentService();

// Export both the instance and class
module.exports = paymentServiceInstance;
module.exports.PaymentService = PaymentService;