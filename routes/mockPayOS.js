const express = require('express');
const router = express.Router();
const axios = require('axios');
const Payment = require('../models/Payment');

/**
 * MOCK PAYOS ENDPOINTS - FOR TESTING AUTO CREDIT SYSTEM
 * 
 * This simulates PayOS payment completion and webhook
 * Use this to test auto credit addition while waiting for real PayOS credentials
 */

// POST /api/mock-payos/complete-payment - Simulate payment completion
router.post('/complete-payment', async (req, res) => {
    try {
        const { orderCode, userKey } = req.body;
        
        if (!orderCode) {
            return res.status(400).json({
                success: false,
                error: 'Order code is required'
            });
        }

        console.log(`🧪 MOCK PayOS: Simulating payment completion for order ${orderCode}`);

        // Find the payment in database
        const payment = await Payment.findOne({ 
            $or: [
                { 'paymentData.orderCode': parseInt(orderCode) },
                { 'paymentData.orderCode': orderCode },
                { '_id': orderCode }, // Also allow payment ID
                { 'userKey': userKey, 'status': 'pending' } // Find any pending payment for user
            ]
        }).sort({ createdAt: -1 }); // Get latest payment

        if (!payment) {
            return res.status(404).json({
                success: false,
                error: `Payment with order code ${orderCode} not found`
            });
        }

        if (payment.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: `Payment ${orderCode} is not in pending status (current: ${payment.status})`
            });
        }

        console.log(`🧪 MOCK PayOS: Found payment ${payment._id} for user ${payment.userKey}`);
        console.log(`🧪 MOCK PayOS: Will add ${payment.creditAmount} credits`);

        // Simulate PayOS webhook data
        const mockWebhookData = {
            code: '00',
            desc: 'Success',
            data: {
                orderCode: parseInt(orderCode),
                status: 'PAID',
                amount: payment.amount || (payment.creditAmount * 4545),
                transactions: [{
                    reference: `MOCK_TEST_${orderCode}`,
                    amount: payment.amount || (payment.creditAmount * 4545),
                    when: new Date().toISOString()
                }]
            }
        };

        // Send webhook to our own endpoint to trigger auto credit addition
        const webhookUrl = `${req.protocol}://${req.get('host')}/api/payment/webhook/payos`;
        
        console.log(`🧪 MOCK PayOS: Sending webhook to ${webhookUrl}`);
        
        try {
            const webhookResponse = await axios.post(webhookUrl, mockWebhookData, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-mock-webhook': 'true'
                },
                timeout: 10000
            });
            
            console.log(`🧪 MOCK PayOS: Webhook sent successfully`);
            
            return res.json({
                success: true,
                message: `Mock payment completed for order ${orderCode}`,
                creditAmount: payment.creditAmount,
                userKey: payment.userKey,
                webhookResponse: webhookResponse.data
            });
            
        } catch (webhookError) {
            console.error('🧪 MOCK PayOS: Webhook failed:', webhookError.response?.data || webhookError.message);
            
            return res.status(500).json({
                success: false,
                error: 'Failed to send mock webhook',
                details: webhookError.response?.data || webhookError.message
            });
        }

    } catch (error) {
        console.error('🧪 MOCK PayOS: Complete payment error:', error);
        
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

// GET /api/mock-payos/payments - List pending payments for testing
router.get('/payments', async (req, res) => {
    try {
        const { userKey } = req.query;
        
        const filter = { status: 'pending' };
        if (userKey) {
            filter.userKey = userKey;
        }
        
        const payments = await Payment.find(filter)
            .sort({ createdAt: -1 })
            .limit(20)
            .select('_id userKey creditAmount amount paymentData.orderCode createdAt status');

        return res.json({
            success: true,
            payments: payments.map(p => ({
                _id: p._id,
                userKey: p.userKey,
                creditAmount: p.creditAmount,
                amount: p.amount,
                orderCode: p.paymentData?.orderCode,
                createdAt: p.createdAt,
                status: p.status
            }))
        });

    } catch (error) {
        console.error('🧪 MOCK PayOS: List payments error:', error);
        
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// POST /api/mock-payos/test-webhook - Direct webhook test
router.post('/test-webhook', async (req, res) => {
    try {
        const { orderCode } = req.body;
        
        const mockWebhookData = {
            code: '00',
            desc: 'Success',
            data: {
                orderCode: parseInt(orderCode),
                status: 'PAID',
                amount: 999000,
                transactions: [{
                    reference: `DIRECT_TEST_${orderCode}`,
                    amount: 999000,
                    when: new Date().toISOString()
                }]
            }
        };

        // Send to webhook endpoint
        const webhookUrl = `${req.protocol}://${req.get('host')}/api/payment/webhook/payos`;
        
        const webhookResponse = await axios.post(webhookUrl, mockWebhookData, {
            headers: {
                'Content-Type': 'application/json',
                'x-test-webhook': 'true'
            }
        });
        
        return res.json({
            success: true,
            message: 'Test webhook sent successfully',
            webhookData: mockWebhookData,
            webhookResponse: webhookResponse.data
        });

    } catch (error) {
        console.error('🧪 MOCK PayOS: Test webhook error:', error);
        
        return res.status(500).json({
            success: false,
            error: 'Test webhook failed',
            details: error.message
        });
    }
});

module.exports = router;