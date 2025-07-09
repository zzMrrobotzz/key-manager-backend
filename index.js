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

// GET all keys for admin panel
app.get('/api/keys', async (req, res) => {
    try {
        const keys = await Key.find().sort({ createdAt: -1 });
        res.json(keys);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch keys' });
    }
});

// POST a new key
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

// Validate a key for end-user
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


// GET all providers
app.get('/api/providers', async (req, res) => {
    try {
        const providers = await ApiProvider.find();
        res.json(providers);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch providers' });
    }
});

// GET audit logs
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
