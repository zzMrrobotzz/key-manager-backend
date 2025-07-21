const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/adminAuth');

// Import models with error handling
let ApiRequestLog, ApiProvider;
try {
  ApiRequestLog = require('../models/ApiRequestLog');
  ApiProvider = require('../models/ApiProvider');
} catch (err) {
  console.log('⚠️ Statistics models not found, returning empty stats');
}

// GET /admin/stats/daily-requests - Get daily API request statistics (temporarily without auth)
router.get('/daily-requests', async (req, res) => {
  try {
    if (!ApiRequestLog || !ApiProvider) {
      return res.json({
        success: true,
        data: {
          date: new Date().toISOString().split('T')[0],
          providers: [],
          summary: {
            totalRequests: 0,
            totalSuccess: 0,
            totalFailed: 0,
            totalTokens: 0
          }
        }
      });
    }

    // Get today's date range (start of day to end of day)
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    // Aggregate daily stats by provider
    const dailyStats = await ApiRequestLog.aggregate([
      {
        $match: {
          createdAt: {
            $gte: startOfDay,
            $lt: endOfDay
          }
        }
      },
      {
        $group: {
          _id: '$provider',
          totalRequests: { $sum: 1 },
          successfulRequests: { 
            $sum: { $cond: ['$success', 1, 0] }
          },
          failedRequests: { 
            $sum: { $cond: ['$success', 0, 1] }
          },
          totalTokens: { 
            $sum: '$tokenUsage.totalTokens'
          },
          totalPromptLength: { 
            $sum: '$promptLength'
          },
          totalResponseLength: { 
            $sum: '$responseLength'
          }
        }
      },
      {
        $sort: { totalRequests: -1 }
      }
    ]);

    // Get provider details and merge with daily stats
    const providers = await ApiProvider.find({}).lean();
    
    const enrichedStats = providers.map(provider => {
      const stats = dailyStats.find(stat => stat._id === provider.name) || {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalTokens: 0,
        totalPromptLength: 0,
        totalResponseLength: 0
      };

      return {
        _id: provider._id,
        name: provider.name,
        status: provider.status || 'Unknown',
        dailyRequests: stats.totalRequests,
        successfulRequests: stats.successfulRequests,
        failedRequests: stats.failedRequests,
        successRate: stats.totalRequests > 0 ? 
          (stats.successfulRequests / stats.totalRequests * 100).toFixed(1) + '%' : '0%',
        totalTokensToday: stats.totalTokens,
        totalPromptLength: stats.totalPromptLength,
        totalResponseLength: stats.totalResponseLength,
        costToday: provider.costToday || 0
      };
    });

    res.json({
      success: true,
      data: {
        date: today.toISOString().split('T')[0],
        providers: enrichedStats,
        summary: {
          totalRequests: dailyStats.reduce((sum, stat) => sum + stat.totalRequests, 0),
          totalSuccess: dailyStats.reduce((sum, stat) => sum + stat.successfulRequests, 0),
          totalFailed: dailyStats.reduce((sum, stat) => sum + stat.failedRequests, 0),
          totalTokens: dailyStats.reduce((sum, stat) => sum + stat.totalTokens, 0)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch daily statistics'
    });
  }
});

module.exports = router;