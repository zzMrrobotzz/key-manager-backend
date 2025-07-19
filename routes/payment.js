const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const { createAuditLog } = require('../utils/auditLogger');

// POST /api/payment/create - Tạo payment mới
router.post('/create', async (req, res) => {
    try {
        const { key, credit } = req.body;

        if (!key || !credit) {
            return res.status(400).json({
                success: false,
                error: 'Key and credit amount are required'
            });
        }

        // Extract metadata from request
        const metadata = {
            ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            userAgent: req.headers['user-agent'],
            referer: req.headers.referer
        };

        const result = await paymentService.createPayment(key, credit, metadata);

        await createAuditLog('PAYMENT_CREATED', `Payment created for key ${key.substring(0, 10)}... Amount: ${credit} credits`);

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

// GET /api/payment/packages - Lấy danh sách gói credit
router.get('/packages', (req, res) => {
    const packages = [
        { label: '100 bài viết', credit: 100, price: 500000 },
        { label: '220 bài viết', credit: 220, price: 1000000 },
        { label: '800 bài viết', credit: 800, price: 3000000 },
    ];

    return res.json({
        success: true,
        packages
    });
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