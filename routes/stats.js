const express = require('express');
const router = express.Router();
const Key = require('../models/Key');
const Payment = require('../models/Payment');
const CreditPackage = require('../models/CreditPackage');
const { createAuditLog } = require('../utils/auditLogger');

// GET /api/stats/dashboard - Lấy thống kê dashboard
router.get('/dashboard', async (req, res) => {
    try {
        console.log('📊 Loading dashboard stats...');
        
        // Thống kê keys
        const totalKeys = await Key.countDocuments();
        const activeKeys = await Key.countDocuments({ isActive: true });
        const expiredKeys = await Key.countDocuments({ 
            expiredAt: { $lt: new Date() } 
        });
        const totalCredits = await Key.aggregate([
            { $group: { _id: null, total: { $sum: '$credit' } } }
        ]);
        
        // Thống kê payments
        const totalRevenue = await Payment.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$price' } } }
        ]);
        
        const monthlyTransactions = await Payment.countDocuments({
            status: 'completed',
            completedAt: {
                $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            }
        });
        
        // Thống kê packages
        const totalPackages = await CreditPackage.countDocuments();
        const activePackages = await CreditPackage.countDocuments({ isActive: { $ne: false } });
        
        // Thống kê hôm nay
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        
        const todayPayments = await Payment.countDocuments({
            status: 'completed',
            completedAt: { $gte: todayStart }
        });
        
        const todayRevenue = await Payment.aggregate([
            { 
                $match: { 
                    status: 'completed',
                    completedAt: { $gte: todayStart }
                } 
            },
            { $group: { _id: null, total: { $sum: '$price' } } }
        ]);
        
        const stats = {
            // Key stats
            totalKeys,
            activeKeys,
            expiredKeys,
            totalCredits: totalCredits[0]?.total || 0,
            
            // Billing stats
            billingStats: {
                totalRevenue: totalRevenue[0]?.total || 0,
                monthlyTransactions,
                todayRevenue: todayRevenue[0]?.total || 0,
                todayTransactions: todayPayments
            },
            
            // Package stats
            packageStats: {
                totalPackages,
                activePackages
            },
            
            // API usage stats (placeholder - sẽ cập nhật sau)
            apiUsageStats: {
                totalRequests: 0,
                costToday: 0,
                requestsToday: 0
            }
        };
        
        console.log('✅ Dashboard stats loaded:', {
            totalKeys,
            activeKeys,
            totalRevenue: totalRevenue[0]?.total || 0,
            monthlyTransactions
        });
        
        return res.json({
            success: true,
            stats
        });
        
    } catch (error) {
        console.error('❌ Error loading dashboard stats:', error);
        return res.status(500).json({
            success: false,
            error: 'Unable to load dashboard statistics'
        });
    }
});

// GET /api/stats/revenue - Thống kê doanh thu chi tiết
router.get('/revenue', async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        
        let matchStage = { status: 'completed' };
        let groupStage;
        
        if (period === 'week') {
            groupStage = {
                _id: { 
                    year: { $year: '$completedAt' },
                    week: { $week: '$completedAt' }
                },
                revenue: { $sum: '$price' },
                transactions: { $sum: 1 }
            };
        } else if (period === 'day') {
            groupStage = {
                _id: { 
                    year: { $year: '$completedAt' },
                    month: { $month: '$completedAt' },
                    day: { $dayOfMonth: '$completedAt' }
                },
                revenue: { $sum: '$price' },
                transactions: { $sum: 1 }
            };
        } else {
            // Default to month
            groupStage = {
                _id: { 
                    year: { $year: '$completedAt' },
                    month: { $month: '$completedAt' }
                },
                revenue: { $sum: '$price' },
                transactions: { $sum: 1 }
            };
        }
        
        const revenueData = await Payment.aggregate([
            { $match: matchStage },
            { $group: groupStage },
            { $sort: { '_id.year': -1, '_id.month': -1, '_id.week': -1, '_id.day': -1 } },
            { $limit: 12 }
        ]);
        
        return res.json({
            success: true,
            data: revenueData
        });
        
    } catch (error) {
        console.error('Error loading revenue stats:', error);
        return res.status(500).json({
            success: false,
            error: 'Unable to load revenue statistics'
        });
    }
});

module.exports = router;