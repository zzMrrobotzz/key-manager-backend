const Proxy = require('../models/Proxy');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

class ProxyManager {
  constructor() {
    this.cache = new Map(); // Cache cho proxy assignments
    this.healthCheckInterval = 5 * 60 * 1000; // 5 phút
    this.maxRetries = 3;
    
    // Health check định kỳ
    this.startHealthCheck();
  }

  /**
   * Lấy proxy được assign cho API key
   * @param {string} apiKey - API key cần lấy proxy
   * @returns {Object|null} Proxy object hoặc null nếu không tìm thấy
   */
  async getProxyForApiKey(apiKey) {
    try {
      // Kiểm tra cache trước
      if (this.cache.has(apiKey)) {
        const cachedProxy = this.cache.get(apiKey);
        // Kiểm tra xem cache có còn hợp lệ không (30 phút)
        if (Date.now() - cachedProxy.cacheTime < 30 * 60 * 1000) {
          return cachedProxy.proxy;
        } else {
          this.cache.delete(apiKey);
        }
      }

      // Query database
      const proxy = await Proxy.getProxyForApiKey(apiKey);
      
      if (proxy) {
        // Cache kết quả
        this.cache.set(apiKey, {
          proxy: proxy,
          cacheTime: Date.now()
        });
        
        console.log(`🔗 Found proxy for API key: ${apiKey.substring(0, 10)}... → ${proxy.host}:${proxy.port}`);
        return proxy;
      }

      console.log(`⚠️  No proxy assigned for API key: ${apiKey.substring(0, 10)}...`);
      return null;

    } catch (error) {
      console.error('Error getting proxy for API key:', error);
      return null;
    }
  }

  /**
   * Tạo proxy agent từ proxy object
   * @param {Object} proxy - Proxy object từ database
   * @returns {Object} Proxy agent
   */
  createProxyAgent(proxy) {
    if (!proxy) return null;

    try {
      const auth = proxy.username && proxy.password 
        ? `${proxy.username}:${proxy.password}@` 
        : '';
      
      const proxyUrl = `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;

      let agent;
      switch (proxy.protocol) {
        case 'http':
          agent = new HttpProxyAgent(proxyUrl);
          break;
        case 'https':
          agent = new HttpsProxyAgent(proxyUrl);
          break;
        case 'socks4':
        case 'socks5':
          agent = new SocksProxyAgent(proxyUrl);
          break;
        default:
          agent = new HttpsProxyAgent(proxyUrl);
      }

      return agent;

    } catch (error) {
      console.error('Error creating proxy agent:', error);
      return null;
    }
  }

  /**
   * Thực hiện request với proxy
   * @param {string} url - URL để request
   * @param {Object} options - Fetch options
   * @param {string} apiKey - API key để lấy proxy
   * @returns {Promise} Response từ fetch
   */
  async makeRequestWithProxy(url, options = {}, apiKey) {
    const fetch = require('node-fetch');
    const proxy = await this.getProxyForApiKey(apiKey);
    
    if (!proxy) {
      console.log(`📡 Making direct request (no proxy) for API key: ${apiKey.substring(0, 10)}...`);
      return fetch(url, options);
    }

    const agent = this.createProxyAgent(proxy);
    if (!agent) {
      console.log(`❌ Failed to create proxy agent, making direct request`);
      return fetch(url, options);
    }

    const startTime = Date.now();
    
    try {
      console.log(`🌐 Making request via proxy: ${proxy.host}:${proxy.port} for API key: ${apiKey.substring(0, 10)}...`);
      
      const response = await fetch(url, {
        ...options,
        agent: agent,
        timeout: options.timeout || 30000
      });

      const responseTime = Date.now() - startTime;

      // Cập nhật thống kê thành công
      await this.updateProxyStats(proxy._id, true, responseTime);

      return response;

    } catch (error) {
      const responseTime = Date.now() - startTime;

      // Cập nhật thống kê thất bại
      await this.updateProxyStats(proxy._id, false, responseTime);

      console.error(`💥 Proxy request failed: ${proxy.host}:${proxy.port} - ${error.message}`);
      
      // Retry với proxy khác nếu có thể
      if (this.shouldRetry(error)) {
        console.log(`🔄 Retrying with direct connection...`);
        return fetch(url, options);
      }

      throw error;
    }
  }

  /**
   * Cập nhật thống kê cho proxy
   * @param {string} proxyId - ID của proxy
   * @param {boolean} success - Request thành công hay không
   * @param {number} responseTime - Thời gian response
   */
  async updateProxyStats(proxyId, success, responseTime) {
    try {
      const updateData = {
        lastUsed: new Date(),
        updatedAt: new Date()
      };

      if (success) {
        updateData.$inc = { successCount: 1 };
        updateData.avgResponseTime = responseTime;
      } else {
        updateData.$inc = { failureCount: 1 };
      }

      await Proxy.findByIdAndUpdate(proxyId, updateData);

    } catch (error) {
      console.error('Error updating proxy stats:', error);
    }
  }

  /**
   * Kiểm tra xem có nên retry không
   * @param {Error} error - Error object
   * @returns {boolean}
   */
  shouldRetry(error) {
    const retryableErrors = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNRESET',
      'EHOSTUNREACH'
    ];

    return retryableErrors.some(code => error.code === code || error.message.includes(code));
  }

  /**
   * Lấy thống kê tổng quan về proxy
   * @returns {Object} Proxy statistics
   */
  async getProxyStatistics() {
    try {
      const [totalProxies, activeProxies, assignedProxies] = await Promise.all([
        Proxy.countDocuments(),
        Proxy.countDocuments({ isActive: true }),
        Proxy.countDocuments({ assignedApiKey: { $ne: null, $ne: '' } })
      ]);

      const recentActivity = await Proxy.find({ 
        lastUsed: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
      }).countDocuments();

      const topPerformers = await Proxy.find({ isActive: true })
        .sort({ successCount: -1, avgResponseTime: 1 })
        .limit(5)
        .select('name host port successCount failureCount avgResponseTime');

      return {
        overview: {
          total: totalProxies,
          active: activeProxies,
          assigned: assignedProxies,
          available: activeProxies - assignedProxies,
          recentActivity
        },
        topPerformers: topPerformers.map(proxy => ({
          name: proxy.name,
          endpoint: `${proxy.host}:${proxy.port}`,
          successRate: proxy.successCount / (proxy.successCount + proxy.failureCount) * 100,
          avgResponseTime: proxy.avgResponseTime
        }))
      };

    } catch (error) {
      console.error('Error getting proxy statistics:', error);
      return null;
    }
  }

  /**
   * Health check cho tất cả proxy
   */
  async performHealthCheck() {
    try {
      console.log('🏥 Starting proxy health check...');
      
      const activeProxies = await Proxy.find({ isActive: true });
      const results = [];

      for (const proxy of activeProxies) {
        try {
          const result = await proxy.testConnection();
          results.push({
            proxyId: proxy._id,
            name: proxy.name,
            success: result.success,
            responseTime: result.responseTime || 0
          });

          // Tự động disable proxy nếu fail nhiều lần
          if (!result.success && proxy.failureCount > 10) {
            await Proxy.findByIdAndUpdate(proxy._id, { 
              isActive: false,
              notes: `Auto-disabled due to consecutive failures at ${new Date().toISOString()}`
            });
            console.log(`🚫 Auto-disabled proxy: ${proxy.name} due to consecutive failures`);
          }

        } catch (error) {
          results.push({
            proxyId: proxy._id,
            name: proxy.name,
            success: false,
            error: error.message
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`✅ Health check completed: ${successCount}/${results.length} proxies healthy`);

      return results;

    } catch (error) {
      console.error('Error performing health check:', error);
      return [];
    }
  }

  /**
   * Bắt đầu health check định kỳ
   */
  startHealthCheck() {
    setInterval(async () => {
      await this.performHealthCheck();
    }, this.healthCheckInterval);

    console.log(`🏥 Proxy health check started (interval: ${this.healthCheckInterval / 1000 / 60} minutes)`);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('🧹 Proxy cache cleared');
  }

  /**
   * Lấy proxy suggestions cho API key chưa assign
   * @param {string} apiKey - API key cần suggest proxy
   * @returns {Array} Danh sách proxy suggestions
   */
  async getSuggestedProxies(apiKey) {
    try {
      // Tìm proxy chưa assign và active
      const availableProxies = await Proxy.find({
        isActive: true,
        $or: [
          { assignedApiKey: null },
          { assignedApiKey: '' }
        ]
      }).sort({ 
        successCount: -1,  // Ưu tiên proxy có success rate cao
        avgResponseTime: 1 // Ưu tiên proxy có response time thấp
      }).limit(10);

      return availableProxies.map(proxy => ({
        id: proxy._id,
        name: proxy.name,
        endpoint: `${proxy.host}:${proxy.port}`,
        location: proxy.location,
        protocol: proxy.protocol,
        stats: proxy.getStats()
      }));

    } catch (error) {
      console.error('Error getting suggested proxies:', error);
      return [];
    }
  }
}

// Singleton instance
const proxyManager = new ProxyManager();

module.exports = proxyManager;