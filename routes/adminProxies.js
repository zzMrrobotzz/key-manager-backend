const express = require('express');
const router = express.Router();
const Proxy = require('../models/Proxy');
const ApiProvider = require('../models/ApiProvider');
const { createAuditLog } = require('../utils/auditLogger');

// GET /api/admin/proxies - Lấy danh sách proxy
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, location, assigned } = req.query;
    
    // Build filter
    const filter = {};
    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;
    if (location && location !== 'all') filter.location = location;
    if (assigned === 'true') filter.assignedApiKey = { $ne: null, $ne: '' };
    if (assigned === 'false') filter.$or = [{ assignedApiKey: null }, { assignedApiKey: '' }];

    const proxies = await Proxy.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Proxy.countDocuments(filter);

    // Thêm stats cho mỗi proxy
    const proxiesWithStats = proxies.map(proxy => {
      const totalRequests = proxy.successCount + proxy.failureCount;
      const successRate = totalRequests > 0 ? (proxy.successCount / totalRequests * 100) : 0;
      
      return {
        ...proxy,
        stats: {
          totalRequests,
          successRate: Math.round(successRate * 100) / 100,
          avgResponseTime: proxy.avgResponseTime || 0,
          isAssigned: !!proxy.assignedApiKey
        }
      };
    });

    res.json({
      success: true,
      data: {
        proxies: proxiesWithStats,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching proxies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch proxies'
    });
  }
});

// POST /api/admin/proxies - Thêm proxy mới
router.post('/', async (req, res) => {
  try {
    const { name, host, port, username, password, protocol, location, provider, notes } = req.body;

    // Validate required fields
    if (!name || !host || !port) {
      return res.status(400).json({
        success: false,
        message: 'Name, host, and port are required'
      });
    }

    // Check if proxy already exists
    const existingProxy = await Proxy.findOne({ host, port });
    if (existingProxy) {
      return res.status(409).json({
        success: false,
        message: 'Proxy with this host and port already exists'
      });
    }

    const newProxy = new Proxy({
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port),
      username: username?.trim() || '',
      password: password?.trim() || '',
      protocol: protocol || 'http',
      location: location?.trim() || 'Unknown',
      provider: provider?.trim() || 'Manual',
      notes: notes?.trim() || ''
    });

    await newProxy.save();

    await createAuditLog({
      action: 'CREATE_PROXY',
      details: `Created proxy: ${name} (${host}:${port})`,
      adminId: req.adminId || 'system'
    });

    res.status(201).json({
      success: true,
      message: 'Proxy created successfully',
      data: newProxy
    });

  } catch (error) {
    console.error('Error creating proxy:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create proxy'
    });
  }
});

// PUT /api/admin/proxies/:id - Cập nhật proxy
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove sensitive fields from update
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.successCount;
    delete updateData.failureCount;

    const proxy = await Proxy.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    if (!proxy) {
      return res.status(404).json({
        success: false,
        message: 'Proxy not found'
      });
    }

    await createAuditLog({
      action: 'UPDATE_PROXY',
      details: `Updated proxy: ${proxy.name} (${proxy.host}:${proxy.port})`,
      adminId: req.adminId || 'system'
    });

    res.json({
      success: true,
      message: 'Proxy updated successfully',
      data: proxy
    });

  } catch (error) {
    console.error('Error updating proxy:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update proxy'
    });
  }
});

// DELETE /api/admin/proxies/:id - Xóa proxy
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const proxy = await Proxy.findById(id);
    if (!proxy) {
      return res.status(404).json({
        success: false,
        message: 'Proxy not found'
      });
    }

    // Check nếu proxy đang được assign
    if (proxy.assignedApiKey) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete proxy that is assigned to an API key. Please unassign first.'
      });
    }

    await Proxy.findByIdAndDelete(id);

    await createAuditLog({
      action: 'DELETE_PROXY',
      details: `Deleted proxy: ${proxy.name} (${proxy.host}:${proxy.port})`,
      adminId: req.adminId || 'system'
    });

    res.json({
      success: true,
      message: 'Proxy deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting proxy:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete proxy'
    });
  }
});

// POST /api/admin/proxies/:id/test - Test proxy connection
router.post('/:id/test', async (req, res) => {
  try {
    const { id } = req.params;

    const proxy = await Proxy.findById(id);
    if (!proxy) {
      return res.status(404).json({
        success: false,
        message: 'Proxy not found'
      });
    }

    const testResult = await proxy.testConnection();

    await createAuditLog({
      action: 'TEST_PROXY',
      details: `Tested proxy: ${proxy.name} - ${testResult.success ? 'SUCCESS' : 'FAILED'}`,
      adminId: req.adminId || 'system'
    });

    res.json({
      success: true,
      data: testResult
    });

  } catch (error) {
    console.error('Error testing proxy:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test proxy'
    });
  }
});

// POST /api/admin/proxies/batch-test - Test tất cả proxy
router.post('/batch-test', async (req, res) => {
  try {
    const proxies = await Proxy.find({ isActive: true });
    const testResults = [];

    for (const proxy of proxies) {
      try {
        const result = await proxy.testConnection();
        testResults.push({
          proxyId: proxy._id,
          name: proxy.name,
          host: proxy.host,
          port: proxy.port,
          ...result
        });
      } catch (error) {
        testResults.push({
          proxyId: proxy._id,
          name: proxy.name,
          host: proxy.host,
          port: proxy.port,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = testResults.filter(r => r.success).length;
    const failCount = testResults.filter(r => !r.success).length;

    await createAuditLog({
      action: 'BATCH_TEST_PROXIES',
      details: `Tested ${testResults.length} proxies - ${successCount} success, ${failCount} failed`,
      adminId: req.adminId || 'system'
    });

    res.json({
      success: true,
      data: {
        results: testResults,
        summary: {
          total: testResults.length,
          success: successCount,
          failed: failCount,
          successRate: Math.round((successCount / testResults.length) * 10000) / 100
        }
      }
    });

  } catch (error) {
    console.error('Error batch testing proxies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to batch test proxies'
    });
  }
});

// POST /api/admin/proxies/auto-assign - Tự động assign proxy cho API keys
router.post('/auto-assign', async (req, res) => {
  try {
    const { provider = 'all', forceReassign = false } = req.body;

    // Lấy danh sách providers
    let providersToProcess;
    if (provider === 'all') {
      providersToProcess = await ApiProvider.find();
    } else {
      providersToProcess = await ApiProvider.find({ name: provider });
    }

    if (!providersToProcess.length) {
      return res.status(404).json({
        success: false,
        message: 'No providers found'
      });
    }

    const assignmentResults = [];
    let totalAssigned = 0;

    for (const providerDoc of providersToProcess) {
      for (const apiKey of providerDoc.apiKeys || []) {
        try {
          // Kiểm tra xem API key đã có proxy chưa
          const existingProxy = await Proxy.findOne({ assignedApiKey: apiKey });
          
          if (existingProxy && !forceReassign) {
            assignmentResults.push({
              apiKey: apiKey.substring(0, 10) + '...',
              provider: providerDoc.name,
              status: 'already_assigned',
              proxyName: existingProxy.name
            });
            continue;
          }

          // Nếu force reassign, unassign proxy cũ
          if (existingProxy && forceReassign) {
            existingProxy.assignedApiKey = null;
            await existingProxy.save();
          }

          // Tìm proxy chưa assign
          const availableProxy = await Proxy.findOne({
            isActive: true,
            $or: [
              { assignedApiKey: null },
              { assignedApiKey: '' }
            ]
          });

          if (availableProxy) {
            availableProxy.assignedApiKey = apiKey;
            await availableProxy.save();
            totalAssigned++;

            assignmentResults.push({
              apiKey: apiKey.substring(0, 10) + '...',
              provider: providerDoc.name,
              status: 'assigned',
              proxyName: availableProxy.name,
              proxyHost: `${availableProxy.host}:${availableProxy.port}`
            });
          } else {
            assignmentResults.push({
              apiKey: apiKey.substring(0, 10) + '...',
              provider: providerDoc.name,
              status: 'no_proxy_available'
            });
          }

        } catch (error) {
          assignmentResults.push({
            apiKey: apiKey.substring(0, 10) + '...',
            provider: providerDoc.name,
            status: 'error',
            error: error.message
          });
        }
      }
    }

    await createAuditLog({
      action: 'AUTO_ASSIGN_PROXIES',
      details: `Auto-assigned ${totalAssigned} proxies to API keys`,
      adminId: req.adminId || 'system'
    });

    res.json({
      success: true,
      message: `Auto-assignment completed. ${totalAssigned} proxies assigned.`,
      data: {
        totalAssigned,
        results: assignmentResults
      }
    });

  } catch (error) {
    console.error('Error auto-assigning proxies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to auto-assign proxies'
    });
  }
});

// GET /api/admin/proxies/stats - Lấy thống kê proxy
router.get('/stats', async (req, res) => {
  try {
    const totalProxies = await Proxy.countDocuments();
    const activeProxies = await Proxy.countDocuments({ isActive: true });
    const assignedProxies = await Proxy.countDocuments({ 
      assignedApiKey: { $ne: null, $ne: '' }
    });

    const locationStats = await Proxy.aggregate([
      { $group: { _id: '$location', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const protocolStats = await Proxy.aggregate([
      { $group: { _id: '$protocol', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const providerStats = await Proxy.aggregate([
      { $group: { _id: '$provider', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        overview: {
          totalProxies,
          activeProxies,
          assignedProxies,
          availableProxies: activeProxies - assignedProxies,
          assignmentRate: totalProxies > 0 ? Math.round((assignedProxies / totalProxies) * 10000) / 100 : 0
        },
        locationStats,
        protocolStats,
        providerStats
      }
    });

  } catch (error) {
    console.error('Error fetching proxy stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch proxy statistics'
    });
  }
});

module.exports = router;