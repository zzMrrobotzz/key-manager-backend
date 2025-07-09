require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- Import Utils & Models ---
const { createAuditLog } = require('./utils/auditLogger');
const ApiProvider = require('./models/ApiProvider');
const Transaction = require('./models/Transaction');
const AuditLog = require('./models/AuditLog');
const Key = require('./models/Key');

// --- App & Middleware Setup ---
const app = express();
app.use(express.json());

// --- CORS Configuration ---
const allowedOrigins = [
  'https://keyadmintoolviettruyen.netlify.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:5176',
  'https://toolviettruyen.netlify.app'
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// --- MongoDB Connection & Initialization ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected!');
    initializeApiProviders();
  })
  .catch(err => console.error('MongoDB connection error:', err));

const initializeApiProviders = async () => {
  const providers = ['Gemini', 'OpenAI', 'Stability AI', 'ElevenLabs', 'DeepSeek'];
  try {
    for (const providerName of providers) {
      const existingProvider = await ApiProvider.findOne({ name: providerName });
      if (!existingProvider) {
        const newProvider = new ApiProvider({ name: providerName, status: 'Operational', apiKeys: [] });
        await newProvider.save();
        console.log(`Initialized provider: ${providerName}`);
      }
    }
  } catch (error) {
    console.error('Error initializing API providers:', error);
  }
};

// --- API Routers ---
const keyRoutes = require('./routes/keys');
const packageRoutes = require('./routes/packages');
const adminKeysRoutes = require('./routes/adminKeys');
app.use('/api/keys', keyRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/admin/keys', adminKeysRoutes);

// --- General API Endpoints ---
// (Existing endpoints for stats, providers, audit-log, etc. remain here)

// --- AI Proxy Endpoint ---
app.post('/api/ai/generate', async (req, res) => {
    const { prompt, provider, systemInstruction, useGoogleSearch } = req.body;
    const userKey = req.headers.authorization?.split(' ')[1];

    if (!userKey) {
        return res.status(401).json({ message: 'Authorization key is missing.' });
    }
    
    const dbKey = await Key.findOne({ key: userKey, isActive: true });
    if (!dbKey) {
        return res.status(403).json({ message: 'Invalid or inactive key.' });
    }
    if (dbKey.credit <= 0) {
        return res.status(402).json({ message: 'Insufficient credits.' });
    }

    try {
        const providerDoc = await ApiProvider.findOne({ name: { $regex: new RegExp(provider, "i") } });
        if (!providerDoc || !providerDoc.apiKeys || providerDoc.apiKeys.length === 0) {
            return res.status(503).json({ message: `No API keys configured for provider: ${provider}.` });
        }

        const apiKey = providerDoc.apiKeys[Math.floor(Math.random() * providerDoc.apiKeys.length)];
        let generatedText = '';

        if (provider.toLowerCase() === 'gemini') {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(prompt); // Simplified for now
            generatedText = result.response.text();
        } else {
            return res.status(400).json({ message: `Provider '${provider}' is not yet supported.` });
        }
        
        // Deduct credit after successful generation
        dbKey.credit -= 1; // Simple deduction, can be made more complex
        await dbKey.save();

        res.json({ success: true, text: generatedText, remainingCredits: dbKey.credit });

    } catch (error) {
        console.error(`AI Proxy Error (${provider}):`, error);
        res.status(500).json({ success: false, error: `Failed to generate content with ${provider}.` });
    }
});

// --- Root and Server Start ---
app.get('/', (req, res) => {
  res.send('Backend is running with full features!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});