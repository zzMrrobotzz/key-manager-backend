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
const { createAuditLog } = require('./utils/auditLogger');

// --- App & Middleware Setup ---
const app = express();
app.use(cors());
app.use(express.json());

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected!'))
  .catch(err => console.error('MongoDB connection error:', err));

// --- API Endpoints ---

// Key Management
app.get('/api/keys', async (req, res) => {
    try {
        const keys = await Key.find().sort({ createdAt: -1 });
        res.json(keys);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch keys' });
    }
});

app.post('/api/keys', async (req, res) => {
    try {
        const newKey = new Key({
            key: req.body.key,
            credit: req.body.credit || 0,
            note: req.body.note,
            expiredAt: req.body.expiredAt,
            maxActivations: req.body.maxActivations || 1,
        });
        await newKey.save();
        res.status(201).json(newKey);
    } catch (error) {
        res.status(500).json({ message: 'Failed to create key' });
    }
});

app.post('/api/keys/validate', async (req, res) => {
    try {
        const { key } = req.body;
        const keyDoc = await Key.findOne({ key, isActive: true });
        if (!keyDoc) {
            return res.status(404).json({ message: 'Key not found or inactive' });
        }
        res.json({ success: true, keyInfo: keyDoc });
    } catch (error) {
        res.status(500).json({ message: 'Server error during key validation' });
    }
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

app.delete('/api/providers/:providerId/keys', async (req, res) => {
    try {
        const { providerId } = req.params;
        const { apiKey } = req.body;
        if (!apiKey) return res.status(400).json({ message: 'apiKey is required' });
        
        const provider = await ApiProvider.findById(providerId);
        if (!provider) return res.status(404).json({ message: 'Provider not found' });

        provider.apiKeys = provider.apiKeys.filter(k => k !== apiKey);
        await provider.save();
        res.json(provider);
    } catch (error) {
        res.status(500).json({ message: 'Server error deleting key' });
    }
});

// --- NEW: Create a new API Provider ---
app.post('/api/providers', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ message: 'Provider name is required' });
        }
        // Check if provider already exists
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

// Package Management
app.get('/api/packages', async (req, res) => {
    try {
        const packages = await Package.find().sort({ price: 1 });
        res.json(packages);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch packages' });
    }
});

// Dashboard Stats
app.get('/api/stats/dashboard', async (req, res) => {
  try {
    const totalKeys = await Key.countDocuments();
    const activeKeys = await Key.countDocuments({ isActive: true });
    const expiredKeys = await Key.countDocuments({ expiredAt: { $lt: new Date() } });
    
    const billingResult = await Transaction.aggregate([
      { $match: { status: 'Success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    // Lấy dữ liệu từ các providers
    const providers = await ApiProvider.find();
    const totalRequests = providers.reduce((sum, p) => sum + (p.totalRequests || 0), 0);
    const costToday = providers.reduce((sum, p) => sum + (p.costToday || 0), 0);

    res.json({
      keyStats: {
        total: totalKeys,
        active: activeKeys,
        expired: expiredKeys,
      },
      billingStats: {
        totalRevenue: billingResult[0]?.total || 0,
        monthlyTransactions: 0, // Cần logic phức tạp hơn để tính, tạm thời để 0
      },
      apiUsageStats: {
        totalRequests: totalRequests,
        costToday: costToday,
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch dashboard stats' });
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

// AI Proxy Endpoint
app.post('/api/ai/generate', async (req, res) => {
    const { prompt, provider } = req.body;
    const userKey = req.headers.authorization?.split(' ')[1];

    if (!userKey) return res.status(401).json({ message: 'Authorization key is missing.' });
    
    const dbKey = await Key.findOne({ key: userKey, isActive: true });
    if (!dbKey) return res.status(403).json({ message: 'Invalid or inactive key.' });
    if (dbKey.credit <= 0) return res.status(402).json({ message: 'Insufficient credits.' });

    try {
        const providerDoc = await ApiProvider.findOne({ name: { $regex: new RegExp(provider, "i") } });
        if (!providerDoc || !providerDoc.apiKeys || providerDoc.apiKeys.length === 0) {
            return res.status(503).json({ message: `No API keys configured for provider: ${provider}.` });
        }

        const apiKey = providerDoc.apiKeys[Math.floor(Math.random() * providerDoc.apiKeys.length)];
        
        if (provider.toLowerCase() === 'gemini') {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(prompt);
            const generatedText = result.response.text();
            
            dbKey.credit -= 1;
            await dbKey.save();
            
            res.json({ success: true, text: generatedText, remainingCredits: dbKey.credit });
        } else {
            return res.status(400).json({ message: `Provider '${provider}' is not yet supported.` });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: `Failed to generate content with ${provider}.` });
    }
});

// --- Root and Server Start ---
app.get('/', (req, res) => {
  res.send('Backend is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
