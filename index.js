require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- Import Models ---
const ApiProvider = require('./models/ApiProvider');
const Key = require('./models/Key');
const Transaction = require('./models/Transaction');
const AuditLog = require('./models/AuditLog');
const Package = require('./models/Package');
const Payment = require('./models/Payment');
const { createAuditLog } = require('./utils/auditLogger');

// --- Import Routes ---
const keysRouter = require('./routes/keys');
const adminKeysRouter = require('./routes/adminKeys');
const adminProxiesRouter = require('./routes/adminProxies');
const paymentRouter = require('./routes/payment');
const packagesRouter = require('./routes/packages');
const mockPayOSRouter = require('./routes/mockPayOS');
const bankInfoRouter = require('./routes/bankInfo');
const settingsRouter = require('./routes/settings');

// --- Import Services ---
const proxyManager = require('./services/proxyManager');

// --- App & Middleware Setup ---
const app = express();

// --- CORS Configuration ---
const allowedOrigins = [
  'https://keyadmintoolviettruyen.netlify.app',
  'https://toolviettruyen.netlify.app',
  'http://localhost:3000',
  'http://localhost:5173'
];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
};
app.use(cors(corsOptions));
app.use(express.json());

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected!'))
  .catch(err => console.error('MongoDB connection error:', err));

// --- API Endpoints ---

app.get('/api/status', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Backend is awake and running.' });
});

// Provider Management
app.get('/api/providers', async (req, res) => {
    try {
        const providers = await ApiProvider.find();
        res.json(providers);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch providers' });
    }
});

app.post('/api/providers/:providerId/keys', async (req, res) => {
    try {
        const { providerId } = req.params;
        const { apiKey } = req.body;
        if (!apiKey) return res.status(400).json({ message: 'apiKey is required' });

        const provider = await ApiProvider.findById(providerId);
        if (!provider) return res.status(404).json({ message: 'Provider not found' });

        if (provider.apiKeys.includes(apiKey)) {
            return res.status(409).json({ message: 'Key already exists' });
        }
        provider.apiKeys.push(apiKey);
        await provider.save();
        res.json(provider);
    } catch (error) {
        res.status(500).json({ message: 'Server error adding key' });
    }
});

app.delete('/api/providers/:providerId/keys/:apiKey', async (req, res) => {
    try {
        const { providerId, apiKey: apiKeyToDelete } = req.params;

        // Since the API key can contain special characters, it's good practice to decode it.
        const decodedApiKey = decodeURIComponent(apiKeyToDelete);

        const provider = await ApiProvider.findById(providerId);
        if (!provider) {
            return res.status(404).json({ message: 'Provider not found' });
        }

        // Filter out the key to be deleted.
        const initialKeyCount = provider.apiKeys.length;
        provider.apiKeys = provider.apiKeys.filter(k => k !== decodedApiKey);

        if (provider.apiKeys.length === initialKeyCount) {
            return res.status(404).json({ message: 'API key not found in this provider' });
        }

        await provider.save();
        res.json(provider);
    } catch (error) {
        res.status(500).json({ message: 'Server error deleting key' });
    }
});

app.post('/api/providers', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ message: 'Provider name is required' });
        }
        const existingProvider = await ApiProvider.findOne({ name });
        if (existingProvider) {
            return res.status(409).json({ message: `Provider '${name}' already exists.` });
        }
        const newProvider = new ApiProvider({ name });
        await newProvider.save();
        res.status(201).json(newProvider);
    } catch (error) {
        res.status(500).json({ message: 'Failed to create API provider' });
    }
});

// Package Management - moved to /routes/packages.js

// Dashboard Stats
app.get('/api/stats/dashboard', async (req, res) => {
  try {
    console.log('📊 Loading dashboard stats...');
    
    // Key stats
    const totalKeys = await Key.countDocuments();
    const activeKeys = await Key.countDocuments({ isActive: true });
    const expiredKeys = await Key.countDocuments({ expiredAt: { $lt: new Date() } });
    const totalCredits = await Key.aggregate([
      { $group: { _id: null, total: { $sum: '$credit' } } }
    ]);
    
    // Payment stats (using new Payment model)
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
    
    // Today stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayRevenue = await Payment.aggregate([
      { 
        $match: { 
          status: 'completed',
          completedAt: { $gte: todayStart }
        } 
      },
      { $group: { _id: null, total: { $sum: '$price' } } }
    ]);
    
    // API usage stats
    const providers = await ApiProvider.find();
    const totalRequests = providers.reduce((sum, p) => sum + (p.totalRequests || 0), 0);
    const costToday = providers.reduce((sum, p) => sum + (p.costToday || 0), 0);

    // Proxy stats
    const proxyStats = await proxyManager.getProxyStatistics();
    
    console.log('✅ Dashboard stats loaded:', {
      totalKeys,
      activeKeys,
      totalRevenue: totalRevenue[0]?.total || 0,
      monthlyTransactions
    });

    res.json({
      success: true,
      keyStats: { total: totalKeys, active: activeKeys, expired: expiredKeys },
      billingStats: { 
        totalRevenue: totalRevenue[0]?.total || 0, 
        monthlyTransactions,
        todayRevenue: todayRevenue[0]?.total || 0
      },
      apiUsageStats: { totalRequests, costToday },
      proxyStats: proxyStats || { overview: {}, topPerformers: [] },
      totalCredits: totalCredits[0]?.total || 0
    });
  } catch (error) {
    console.error('❌ Error loading dashboard stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
  }
});

// Audit Log
app.get('/api/audit-log', async (req, res) => {
    try {
        const logs = await AuditLog.find().sort({ timestamp: -1 }).limit(50);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch audit logs' });
    }
});

// AI Proxy Endpoint - CORRECTED AND FINAL VERSION
app.post('/api/ai/generate', async (req, res) => {
    const { prompt, provider } = req.body;
    const userKey = req.headers.authorization?.split(' ')[1];

    if (!userKey) {
        return res.status(401).json({ message: 'Authorization key is missing.' });
    }

    let updatedKey;
    try {
        updatedKey = await Key.findOneAndUpdate(
            { key: userKey, isActive: true, credit: { $gt: 0 } },
            { $inc: { credit: -1 } },
            { new: true }
        );

        if (!updatedKey) {
            return res.status(403).json({ message: 'Invalid key, inactive key, or insufficient credits.' });
        }

        const providerDoc = await ApiProvider.findOne({ name: { $regex: new RegExp(`^${provider}$`, "i") } });
        if (!providerDoc || !providerDoc.apiKeys || providerDoc.apiKeys.length === 0) {
            throw new Error(`No API keys configured for provider: ${provider}.`);
        }

        const apiKey = providerDoc.apiKeys[Math.floor(Math.random() * providerDoc.apiKeys.length)];
        
        let generatedText;
        switch (provider.toLowerCase()) {
            case 'gemini': {
                // Sử dụng proxy nếu có
                const proxyForKey = await proxyManager.getProxyForApiKey(apiKey);
                
                if (proxyForKey) {
                    // Gọi Gemini API qua proxy
                    const agent = proxyManager.createProxyAgent(proxyForKey);
                    const response = await proxyManager.makeRequestWithProxy(
                        'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-goog-api-key': apiKey
                            },
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: prompt }] }]
                            })
                        },
                        apiKey
                    );
                    
                    if (!response.ok) {
                        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
                    }
                    
                    const data = await response.json();
                    generatedText = data.candidates[0]?.content?.parts[0]?.text || 'No content generated';
                } else {
                    // Fallback to direct connection nếu không có proxy
                    console.log(`📡 No proxy assigned for API key, using direct connection`);
                    const genAI = new GoogleGenerativeAI(apiKey);
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    const result = await model.generateContent(prompt);
                    generatedText = result.response.text();
                }
                break;
            }
            default:
                throw new Error(`Provider '${provider}' is not yet supported.`);
        }
        
        return res.json({ success: true, text: generatedText, remainingCredits: updatedKey.credit });

    } catch (error) {
        if (updatedKey) {
            await Key.findByIdAndUpdate(updatedKey._id, { $inc: { credit: 1 } });
        }
        
        console.error(`AI Generation Error for key ${userKey}: ${error.message}`);

        if (error.message.includes('No API keys')) {
            return res.status(503).json({ success: false, error: error.message });
        }
        if (error.message.includes('not yet supported')) {
            return res.status(400).json({ success: false, error: error.message });
        }
        
        return res.status(500).json({ success: false, error: 'An internal server error occurred.' });
    }
});

// Mount routers
app.use('/api/keys', keysRouter);
app.use('/api/admin/keys', adminKeysRouter);
app.use('/api/admin/proxies', adminProxiesRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/packages', packagesRouter);
app.use('/api/mock-payos', mockPayOSRouter);
app.use('/api/bank-info', bankInfoRouter);
app.use('/api/settings', settingsRouter);

// --- Root and Server Start ---
app.get('/', (req, res) => {
  res.send('Backend is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
