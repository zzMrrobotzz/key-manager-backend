require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

// --- Import Utils & Models ---
const { createAuditLog } = require('./utils/auditLogger');
const ApiProvider = require('./models/ApiProvider');
const Transaction = require('./models/Transaction');
const AuditLog = require('./models/AuditLog'); // <--- DÒNG BỊ THIẾU

// --- App & Middleware Setup ---
const app = express();

// --- CORS Configuration ---
const allowedOrigins = [
  'https://keyadmintoolviettruyen.netlify.app', // Deployed Admin Frontend
  'http://localhost:3000', // Local Admin Frontend for testing
  'http://localhost:5173',  // Local Main App Frontend for testing
  'https://toolviettruyen.netlify.app' // Deployed Main App Frontend
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  optionsSuccessStatus: 200,
  credentials: true // Optional: if you need to send cookies
};

app.use(cors(corsOptions));
app.use(express.json());

// --- MongoDB Connection & Initialization ---
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
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
        const newProvider = new ApiProvider({ name: providerName, status: 'Operational' });
        await newProvider.save();
        console.log(`Initialized provider: ${providerName}`);
      }
    }
  } catch (error) {
    console.error('Error initializing API providers:', error);
  }
};

// --- PAYOS CONFIG ---
const PAYOS_CLIENT_ID = 'be64263c-d0b5-48c7-a5e4-9e1357786d4c';
const PAYOS_API_KEY = '6c790eab-3334-4180-bf54-d3071ca7f277';
const PAYOS_CHECKSUM_KEY = '271d878407a1020d240d9064d0bfb4300bfe2e02bf997bb28771dea73912bd55';
const PAYOS_API_URL = 'https://api-merchant.payos.vn/v2/payment-requests';

// --- API Routers ---
const keyRoutes = require('./routes/keys');
const packageRoutes = require('./routes/packages');
app.use('/api/keys', keyRoutes);
app.use('/api/packages', packageRoutes);


// --- General API Endpoints ---

// Dashboard Stats
app.get('/api/stats/dashboard', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalRevenue = await Transaction.aggregate([
      { $match: { status: 'Success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const monthlyTransactions = await Transaction.countDocuments({
      status: 'Success',
      timestamp: { $gte: new Date(today.getFullYear(), today.getMonth(), 1) }
    });
    
    const apiUsage = await ApiProvider.aggregate([
        { $group: { _id: null, totalRequests: { $sum: '$totalRequests' }, costToday: { $sum: '$costToday' } } }
    ]);

    res.json({
      billingStats: {
        totalRevenue: totalRevenue[0]?.total || 0,
        monthlyTransactions: monthlyTransactions,
        pendingRevenue: 0, 
        successRate: 100 
      },
      apiUsageStats: {
        totalRequests: apiUsage[0]?.totalRequests || 0,
        todayRequests: 0,
        averageCost: 0,
        errorRate: 0
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Lỗi máy chủ' });
  }
});

// API Providers
app.get('/api/providers', async (req, res) => {
    try {
        const providers = await ApiProvider.find();
        res.json(providers);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

app.put('/api/providers/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const provider = await ApiProvider.findByIdAndUpdate(req.params.id, { status, lastChecked: Date.now() }, { new: true });
        if (!provider) {
            return res.status(404).json({ message: 'Không tìm thấy provider' });
        }
        await createAuditLog('UPDATE_PROVIDER_STATUS', `Status of ${provider.name} changed to ${status}`, 'Admin');
        res.json(provider);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// Audit Log
app.get('/api/audit-log', async (req, res) => {
    try {
        const logs = await AuditLog.find().sort({ timestamp: -1 }).limit(15);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// API Usage Logging
app.post('/api/usage/log', async (req, res) => {
    const { providerName, cost } = req.body;
    if (!providerName) {
        return res.status(400).json({ message: 'Thiếu tên nhà cung cấp' });
    }
    try {
        await ApiProvider.updateOne(
            { name: providerName },
            { 
                $inc: { totalRequests: 1, costToday: cost || 0 },
                $set: { lastChecked: Date.now() }
            }
        );
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error logging API usage:', error);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// --- Payment APIs ---
app.post('/api/payment/create', async (req, res) => {
  try {
    const { key, credit } = req.body;
    if (!key || !credit || credit < 1) {
      return res.status(400).json({ success: false, message: 'Thiếu key hoặc số credit không hợp lệ' });
    }
    const amount = credit * 1000;
    const orderCode = 'ORDER-' + Date.now();
    const description = `Nap ${credit} credit cho key ${key}`;
    const returnUrl = 'https://keyadmintoolviettruyen.netlify.app';
    const cancelUrl = 'https://keyadmintoolviettruyen.netlify.app';
    const signature = crypto.createHmac("sha256", PAYOS_CHECKSUM_KEY).update(`amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`).digest("hex");

    const payosData = {
      orderCode,
      amount,
      description,
      buyerName: key,
      returnUrl,
      cancelUrl,
      signature,
    };

    const { data: payosRes } = await axios.post(PAYOS_API_URL, payosData, {
      headers: { 'x-client-id': PAYOS_CLIENT_ID, 'x-api-key': PAYOS_API_KEY }
    });
    
    res.json({ payUrl: payosRes.data.checkoutUrl });
  } catch (err) {
    console.error('Lỗi tạo đơn hàng PayOS:', err?.response?.data || err.message);
    res.status(500).json({ message: 'Lỗi tạo đơn hàng PayOS' });
  }
});

app.post('/api/payment/webhook', async (req, res) => {
    const webhookData = req.body;
    try {
        if (webhookData.code === '00' && webhookData.data.status === 'PAID') {
            const { orderCode, amount, description } = webhookData.data;
            const key = description.split(' ').pop();
            const credit = Math.floor(amount / 1000);

            const existingTransaction = await Transaction.findOne({ orderId: orderCode });
            if (existingTransaction) {
                return res.status(200).json({ message: 'Transaction already processed.' });
            }

            // Sửa lỗi nghiêm trọng ở đây:
            const Key = require('./models/Key');
            await Key.updateOne({ key }, { $inc: { credit: credit } });

            // Ghi nhận giao dịch
            const newTransaction = new Transaction({
                orderId: orderCode,
                amount,
                creditAmount: credit,
                key,
                status: 'Success'
            });
            await newTransaction.save();

            await createAuditLog('PAYMENT_SUCCESS', `${credit} credit added to key ${key} via PayOS. Order: ${orderCode}.`, 'PayOS');
        }
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ success: false });
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