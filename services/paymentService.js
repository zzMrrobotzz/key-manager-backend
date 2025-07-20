const Payment = require('../models/Payment');
const Key = require('../models/Key');
const CreditPackage = require('../models/CreditPackage');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const axios = require('axios');

// Import PayOS SDK
let PayOS;
try {
    PayOS = require('@payos/node');
} catch (error) {
    console.warn('PayOS SDK not installed, using fallback mode');
}

class PaymentService {
    constructor() {
        // PayOS Configuration
        this.payos = {
            clientId: process.env.PAYOS_CLIENT_ID || 'be64263c-d0b5-48c7-a5e4-9e1357786d4c',
            apiKey: process.env.PAYOS_API_KEY || '6c790eab-3334-4180-bf54-d3071ca7f277',
            checksumKey: process.env.PAYOS_CHECKSUM_KEY || '271d878407a1020d240d9064d0bfb4300bfe2e02bf997bb28771dea73912bd55',
            baseUrl: 'https://api-merchant.payos.vn'
        };

        // Initialize PayOS SDK if available
        if (PayOS) {
            this.payOSClient = new PayOS(
                this.payos.clientId,
                this.payos.apiKey,
                this.payos.checksumKey
            );
        }

        // Fallback bank info for manual transfer
        this.bankInfo = {
            accountNumber: process.env.BANK_ACCOUNT_NUMBER || '0123456789',
            accountName: process.env.BANK_ACCOUNT_NAME || 'NGUYEN VAN A',
            bankName: process.env.BANK_NAME || 'Vietcombank',
            branchName: process.env.BANK_BRANCH || 'CN Ho Chi Minh'
        };
    }

    /**
     * Get price for credit amount from database (with fallback calculation)
     */
    async getPriceForCredit(creditAmount) {
        try {
            // First check if exact package exists
            const creditPackage = await CreditPackage.findOne({ 
                credits: creditAmount, 
                isActive: { $ne: false } 
            });
            
            if (creditPackage) {
                return creditPackage.price;
            }
            
            // ✅ FIXED: Fallback price calculation for flexible amounts
            // Use rate: 1 credit = 4545 VNĐ (approximately)
            const fallbackRate = 4545;
            return creditAmount * fallbackRate;
        } catch (error) {
            console.error('Error getting price for credit:', error);
            // Emergency fallback
            return creditAmount * 4545;
        }
    }

    /**
     * Validate credit amount from database (with fallback for flexible amounts)
     */
    async isValidCreditAmount(creditAmount) {
        try {
            // First check if exact package exists
            const creditPackage = await CreditPackage.findOne({ 
                credits: creditAmount, 
                isActive: { $ne: false } 
            });
            
            if (creditPackage) {
                return true;
            }
            
            // ✅ FIXED: Allow any positive credit amount as fallback
            // This enables frontend default packages (100, 220, 800 credits)
            return creditAmount > 0 && creditAmount <= 10000; // Max 10k credits
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
     * Generate PayOS signature
     */
    generatePayOSSignature(data) {
        const sortedKeys = Object.keys(data).sort();
        const dataString = sortedKeys.map(key => {
            const value = data[key];
            if (typeof value === 'object') {
                return `${key}=${JSON.stringify(value)}`;
            }
            return `${key}=${value}`;
        }).join('&');
        return crypto.createHmac('sha256', this.payos.checksumKey).update(dataString).digest('hex');
    }

    /**
     * Create PayOS payment link
     */
    async createPayOSPayment(orderCode, amount, description, returnUrl = '', cancelUrl = '') {
        try {
            // Use PayOS SDK if available
            if (this.payOSClient) {
                const paymentData = {
                    orderCode: parseInt(orderCode),
                    amount: parseInt(amount),
                    description: description,
                    items: [
                        {
                            name: "Nạp credit",
                            quantity: 1,
                            price: parseInt(amount)
                        }
                    ],
                    returnUrl: returnUrl || 'https://toolviettruyen.netlify.app/return',
                    cancelUrl: cancelUrl || 'https://toolviettruyen.netlify.app/cancel'
                };

                console.log('Using PayOS SDK to create payment:', paymentData);
                const paymentLinkRes = await this.payOSClient.createPaymentLink(paymentData);
                
                return {
                    success: true,
                    paymentLinkId: paymentLinkRes.paymentLinkId,
                    checkoutUrl: paymentLinkRes.checkoutUrl,
                    qrCode: paymentLinkRes.qrCode
                };
            } else {
                throw new Error('PayOS SDK not available');
            }

        } catch (error) {
            console.error('PayOS payment creation error:', error.message || error);
            throw new Error(`Failed to create PayOS payment: ${error.message || error}`);
        }
    }

    /**
     * Generate payment URL (fallback to manual transfer if PayOS fails)
     */
    generatePaymentUrl(paymentData) {
        // Fallback manual transfer URL
        const params = new URLSearchParams({
            amount: paymentData.amount,
            content: paymentData.transferContent,
            account: this.bankInfo.accountNumber,
            bank: this.bankInfo.bankName
        });
        
        return `https://your-manual-payment-page.com/pay?${params.toString()}`;
    }

    /**
     * Generate QR code data (fallback for manual transfer)
     */
    generateQRData(paymentData) {
        // Vietnam QR Pay format for manual transfer
        return `2|010|${this.bankInfo.accountNumber}|${this.bankInfo.accountName}|${this.bankInfo.bankName}|${paymentData.amount}|${paymentData.transferContent}|VN`;
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
            const orderCode = Date.now(); // Unique order code for PayOS
            const transferContent = this.generateTransferContent(userKey, paymentId);
            const description = `Nap ${creditAmount} credit`; // Max 25 chars for PayOS
            
            const paymentData = {
                amount: price,
                transferContent,
                bankAccount: this.bankInfo.accountNumber,
                payUrl: '',
                qrCode: '',
                orderCode: orderCode,
                payosPaymentLinkId: null
            };

            try {
                // Try to create PayOS payment first
                console.log('Creating PayOS payment...', { orderCode, amount: price, description });
                const payosResult = await this.createPayOSPayment(orderCode, price, description);
                
                if (payosResult.success) {
                    paymentData.payUrl = payosResult.checkoutUrl;
                    paymentData.qrCode = payosResult.qrCode;
                    paymentData.payosPaymentLinkId = payosResult.paymentLinkId;
                    console.log('PayOS payment created successfully:', payosResult.paymentLinkId);
                } else {
                    throw new Error('PayOS payment creation failed');
                }
            } catch (payosError) {
                console.warn('PayOS payment creation failed, falling back to manual transfer:', payosError.message);
                // Fallback to manual transfer
                paymentData.payUrl = this.generatePaymentUrl(paymentData);
                paymentData.qrCode = this.generateQRData(paymentData);
            }

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
     * Check PayOS payment status
     */
    async checkPayOSPaymentStatus(orderCode) {
        try {
            const response = await axios.get(`${this.payos.baseUrl}/v2/payment-requests/${orderCode}`, {
                headers: {
                    'x-client-id': this.payos.clientId,
                    'x-api-key': this.payos.apiKey,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.code === '00') {
                return {
                    success: true,
                    status: response.data.data.status, // PENDING, PAID, CANCELLED
                    data: response.data.data
                };
            } else {
                return {
                    success: false,
                    error: response.data.desc || 'Unknown error'
                };
            }

        } catch (error) {
            console.error('PayOS status check error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.desc || error.message
            };
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