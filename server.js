const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 1000, // Giới hạn 1000 requests per windowMs per IP
  message: {
    success: false,
    message: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

// Import routes
const keyRoutes = require('./routes/keys');
const adminAIRoutes = require('./routes/adminAIKeys');
const aiProxyRoutes = require('./routes/aiProxy');
const adminKeysRoutes = require('./routes/adminKeys');
const packagesRoutes = require('./routes/packages');

// Route middleware
app.use('/api/keys', keyRoutes);
app.use('/api/admin', adminAIRoutes);
app.use('/api/admin/keys', adminKeysRoutes);
app.use('/api/admin/packages', packagesRoutes);
app.use('/api/ai', aiProxyRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error:', error);
  
  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔑 Key management: http://localhost:${PORT}/api/keys`);
  console.log(`🤖 AI proxy: http://localhost:${PORT}/api/ai`);
  console.log(`⚙️  Admin routes: http://localhost:${PORT}/api/admin`);
});

module.exports = app; 