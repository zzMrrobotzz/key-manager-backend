const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const { createAuditLog } = require('../utils/auditLogger');

// POST /api/payment/create - Tạo payment mới
router.post('/create', async (req, res) => {
    try {
        // ✅ FIXED: Accept multiple field formats from frontend
        const { 
            key, 
            credit, 
            creditAmount, 
            credits, 
            amount,
            packageId,
            price
        } = req.body;

        console.log('Payment request received:', req.body);

        // ✅ FIXED: Validate key
        if (!key || typeof key !== 'string' || key.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Valid key is required'
            });
        }

        // ✅ FIXED: Extract credit amount from any field
        const finalCreditAmount = creditAmount || credit || credits || amount;
        
        if (!finalCreditAmount || finalCreditAmount <= 0 || isNaN(finalCreditAmount)) {
            return res.status(400).json({
                success: false,
                error: 'Valid credit amount is required'
            });
        }

        console.log('Processed payment request:', { 
            key: key.substring(0, 10) + '...', 
            creditAmount: finalCreditAmount 
        });

        // Extract metadata from request
        const metadata = {
            ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            userAgent: req.headers['user-agent'],
            referer: req.headers.referer
        };

        const result = await paymentService.createPayment(key, finalCreditAmount, metadata);

        await createAuditLog('PAYMENT_CREATED', `Payment created for key ${key.substring(0, 10)}... Amount: ${finalCreditAmount} credits`);

        return res.json({
            success: true,
            payUrl: result.payUrl,
            qrData: result.qrData,
            transferInfo: result.transferInfo,
            paymentId: result.payment._id,
            expiredAt: result.payment.expiredAt
        });

    } catch (error) {
        console.error('Payment creation error:', error);
        
        let statusCode = 500;
        let errorMessage = 'Internal server error';

        if (error.message.includes('Invalid') || error.message.includes('required')) {
            statusCode = 400;
            errorMessage = error.message;
        } else if (error.message.includes('not found') || error.message.includes('inactive')) {
            statusCode = 404;
            errorMessage = error.message;
        }

        return res.status(statusCode).json({
            success: false,
            error: errorMessage
        });
    }
});

// POST /api/payment/complete/:paymentId - Hoàn thành payment (manual verification)
router.post('/complete/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { transactionId } = req.body;

        if (!paymentId) {
            return res.status(400).json({
                success: false,
                error: 'Payment ID is required'
            });
        }

        const result = await paymentService.completePayment(paymentId, transactionId);

        await createAuditLog('PAYMENT_COMPLETED', `Payment ${paymentId} completed. Credits added: ${result.payment.creditAmount}`);

        return res.json({
            success: true,
            message: 'Payment completed successfully',
            newCreditBalance: result.newCreditBalance,
            payment: result.payment
        });

    } catch (error) {
        console.error('Payment completion error:', error);
        
        let statusCode = 500;
        let errorMessage = 'Internal server error';

        if (error.message.includes('not found')) {
            statusCode = 404;
            errorMessage = error.message;
        } else if (error.message.includes('not in pending') || error.message.includes('expired')) {
            statusCode = 400;
            errorMessage = error.message;
        }

        return res.status(statusCode).json({
            success: false,
            error: errorMessage
        });
    }
});

// GET /api/payment/status/:paymentId - Kiểm tra trạng thái payment
router.get('/status/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;

        if (!paymentId) {
            return res.status(400).json({
                success: false,
                error: 'Payment ID is required'
            });
        }

        const result = await paymentService.getPaymentStatus(paymentId);

        return res.json({
            success: true,
            payment: result.payment,
            isExpired: result.isExpired
        });

    } catch (error) {
        console.error('Get payment status error:', error);
        
        let statusCode = 500;
        let errorMessage = 'Internal server error';

        if (error.message.includes('not found')) {
            statusCode = 404;
            errorMessage = error.message;
        }

        return res.status(statusCode).json({
            success: false,
            error: errorMessage
        });
    }
});

// GET /api/payment/user/:userKey - Lấy danh sách payment của user
router.get('/user/:userKey', async (req, res) => {
    try {
        const { userKey } = req.params;
        const { limit } = req.query;

        if (!userKey) {
            return res.status(400).json({
                success: false,
                error: 'User key is required'
            });
        }

        const result = await paymentService.getUserPayments(userKey, parseInt(limit) || 10);

        return res.json({
            success: true,
            payments: result.payments
        });

    } catch (error) {
        console.error('Get user payments error:', error);
        
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// POST /api/payment/check-payos/:orderCode - Kiểm tra trạng thái thanh toán PayOS
router.post('/check-payos/:orderCode', async (req, res) => {
    try {
        const { orderCode } = req.params;

        if (!orderCode) {
            return res.status(400).json({
                success: false,
                error: 'Order code is required'
            });
        }

        const result = await paymentService.checkPayOSPaymentStatus(orderCode);

        if (result.success && result.status === 'PAID') {
            // Tự động hoàn thành payment nếu đã thanh toán
            const payment = await Payment.findOne({ 'paymentData.orderCode': parseInt(orderCode) });
            if (payment && payment.status === 'pending') {
                await paymentService.completePayment(payment._id, result.data.transactions?.[0]?.reference || `PAYOS_${orderCode}`);
                await createAuditLog('PAYMENT_AUTO_COMPLETED', `PayOS payment ${orderCode} auto completed`);
            }
        }

        return res.json({
            success: true,
            payosStatus: result.status,
            payosData: result.data || null,
            error: result.error || null
        });

    } catch (error) {
        console.error('Check PayOS payment error:', error);
        
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// POST /api/payment/webhook/payos - Webhook cho PayOS
router.post('/webhook/payos', async (req, res) => {
    try {
        const webhookData = req.body;
        
        console.log('PayOS webhook received:', webhookData);

        // Verify webhook signature if needed
        // const signature = req.headers['x-signature'];
        
        if (webhookData.code === '00' && webhookData.data.status === 'PAID') {
            const orderCode = webhookData.data.orderCode;
            
            // Tìm payment tương ứng
            const payment = await Payment.findOne({ 'paymentData.orderCode': orderCode });
            
            if (payment && payment.status === 'pending') {
                // Tự động hoàn thành payment
                await paymentService.completePayment(
                    payment._id, 
                    webhookData.data.transactions?.[0]?.reference || `PAYOS_WEBHOOK_${orderCode}`
                );
                
                await createAuditLog('PAYMENT_WEBHOOK_COMPLETED', `PayOS webhook completed payment ${payment._id}`);
                
                console.log(`✅ PayOS webhook: Payment ${payment._id} completed automatically`);
            }
        }

        return res.json({ success: true });

    } catch (error) {
        console.error('PayOS webhook error:', error);
        return res.status(500).json({ success: false, error: 'Webhook processing failed' });
    }
});

// GET /api/payment/packages - Lấy danh sách gói credit
router.get('/packages', async (req, res) => {
    try {
        const CreditPackage = require('../models/CreditPackage');
        
        // Lấy tất cả gói credit đang active
        const packages = await CreditPackage.find({ isActive: { $ne: false } }).sort({ price: 1 });

        return res.json({
            success: true,
            packages: packages.map(pkg => ({
                _id: pkg._id,
                name: pkg.name,
                price: pkg.price,
                credits: pkg.credits,
                bonus: pkg.bonus,
                isPopular: pkg.isPopular,
                isActive: pkg.isActive
            }))
        });

    } catch (error) {
        console.error('Get packages error:', error);
        
        return res.status(500).json({
            success: false,
            error: 'Unable to fetch credit packages'
        });
    }
});

// POST /api/payment/init-packages - Khởi tạo gói credit mặc định (admin only)
router.post('/init-packages', async (req, res) => {
    try {
        const { initCreditPackages } = require('../scripts/initCreditPackages');
        
        const packages = await initCreditPackages();

        await createAuditLog('CREDIT_PACKAGES_INIT', `Initialized ${packages.length} credit packages`);

        return res.json({
            success: true,
            message: `Initialized ${packages.length} credit packages successfully`,
            packages: packages.map(pkg => ({
                name: pkg.name,
                price: pkg.price,
                credits: pkg.credits,
                bonus: pkg.bonus
            }))
        });

    } catch (error) {
        console.error('Init packages error:', error);
        
        return res.status(500).json({
            success: false,
            error: 'Failed to initialize credit packages'
        });
    }
});

// POST /api/payment/cleanup - Cleanup expired payments (admin only)
router.post('/cleanup', async (req, res) => {
    try {
        const result = await paymentService.cleanupExpiredPayments();

        await createAuditLog('PAYMENT_CLEANUP', `Cleaned up ${result.modifiedCount} expired payments`);

        return res.json({
            success: true,
            message: `Cleaned up ${result.modifiedCount} expired payments`,
            result
        });

    } catch (error) {
        console.error('Payment cleanup error:', error);
        
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

module.exports = router;