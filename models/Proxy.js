const mongoose = require('mongoose');

const proxySchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 100
  },
  host: { 
    type: String, 
    required: true,
    trim: true
  },
  port: { 
    type: Number, 
    required: true,
    min: 1,
    max: 65535
  },
  username: { 
    type: String, 
    default: '',
    trim: true
  },
  password: { 
    type: String, 
    default: '',
    trim: true
  },
  protocol: { 
    type: String, 
    enum: ['http', 'https', 'socks4', 'socks5'], 
    default: 'http' 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  location: { 
    type: String, 
    default: 'Unknown',
    trim: true
  },
  provider: { 
    type: String, 
    default: 'Manual',
    trim: true
  },
  lastUsed: { 
    type: Date, 
    default: null 
  },
  successCount: { 
    type: Number, 
    default: 0 
  },
  failureCount: { 
    type: Number, 
    default: 0 
  },
  avgResponseTime: { 
    type: Number, 
    default: 0 
  },
  assignedApiKey: { 
    type: String, 
    default: null,
    index: true // Index để query nhanh
  },
  notes: { 
    type: String, 
    default: '',
    maxlength: 500
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Index compound để tối ưu query
proxySchema.index({ isActive: 1, assignedApiKey: 1 });
proxySchema.index({ host: 1, port: 1 }, { unique: true });

// Middleware to update updatedAt
proxySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual cho proxy URL
proxySchema.virtual('proxyUrl').get(function() {
  const auth = this.username && this.password ? `${this.username}:${this.password}@` : '';
  return `${this.protocol}://${auth}${this.host}:${this.port}`;
});

// Method để test proxy
proxySchema.methods.testConnection = async function() {
  const { HttpsProxyAgent } = require('https-proxy-agent');
  const fetch = require('node-fetch');
  
  try {
    const startTime = Date.now();
    const agent = new HttpsProxyAgent(this.proxyUrl);
    
    const response = await fetch('https://httpbin.org/ip', {
      agent: agent,
      timeout: 10000
    });
    
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    if (response.ok) {
      const data = await response.json();
      
      // Update stats
      this.successCount += 1;
      this.avgResponseTime = this.avgResponseTime 
        ? (this.avgResponseTime + responseTime) / 2 
        : responseTime;
      this.lastUsed = new Date();
      
      await this.save();
      
      return {
        success: true,
        ip: data.origin,
        responseTime: responseTime,
        message: 'Proxy working correctly'
      };
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    this.failureCount += 1;
    await this.save();
    
    return {
      success: false,
      error: error.message,
      message: 'Proxy connection failed'
    };
  }
};

// Method để lấy proxy statistics
proxySchema.methods.getStats = function() {
  const totalRequests = this.successCount + this.failureCount;
  const successRate = totalRequests > 0 ? (this.successCount / totalRequests * 100) : 0;
  
  return {
    totalRequests,
    successCount: this.successCount,
    failureCount: this.failureCount,
    successRate: Math.round(successRate * 100) / 100,
    avgResponseTime: this.avgResponseTime,
    lastUsed: this.lastUsed,
    isAssigned: !!this.assignedApiKey
  };
};

// Static method để lấy proxy chưa assign
proxySchema.statics.getUnassignedProxies = function() {
  return this.find({ 
    isActive: true, 
    $or: [
      { assignedApiKey: null },
      { assignedApiKey: '' }
    ]
  }).sort({ createdAt: 1 });
};

// Static method để lấy proxy theo API key
proxySchema.statics.getProxyForApiKey = function(apiKey) {
  return this.findOne({ 
    assignedApiKey: apiKey,
    isActive: true 
  });
};

module.exports = mongoose.model('Proxy', proxySchema);