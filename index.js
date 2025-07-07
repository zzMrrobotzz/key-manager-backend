require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

// --- Import Models ---
const Key = require('./models/Key');
const ApiProvider = require('./models/ApiProvider');
const Transaction = require('./models/Transaction');
const AuditLog = require('./models/AuditLog');

const app = express();

// --- Middlewares ---
const corsOptions = {
  origin: 'https://keyadmintoolviettruyen.netlify.app',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('MongoDB connected!');
    initializeApiProviders(); // Khởi tạo dữ liệu API providers khi kết nối thành công
  })
  .catch(err => console.error('MongoDB connection error:', err));

// --- Helper Functions ---
const generateKey = () => 'KEY-' + Math.random().toString(36).substr(2, 8).toUpperCase();

const createAuditLog = async (action, details = '', actor = 'System') => {
  try {
    const log = new AuditLog({ action, details, actor });
    await log.save();
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
};

// --- Initial Data Setup ---
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


// --- API Endpoints ---

// Router cho gói cước
const packageRoutes = require('./routes/packages');
app.use('/api/packages', packageRoutes);

// GET /api/stats/dashboard - Lấy dữ liệu tổng quan cho dashboard
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
        // Các thông số khác có thể thêm sau
        pendingRevenue: 0, 
        successRate: 100 
      },
      apiUsageStats: {
        totalRequests: apiUsage[0]?.totalRequests || 0,
        todayRequests: 0, // Cần cơ chế đếm request real-time hơn
        averageCost: 0, // Cần tính toán phức tạp hơn
        errorRate: 0 // Cần cơ chế ghi log lỗi
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Lỗi máy chủ' });
  }
});


// GET /api/providers - Lấy danh sách API providers
app.get('/api/providers', async (req, res) => {
    try {
        const providers = await ApiProvider.find();
        res.json(providers);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// PUT /api/providers/:id - Cập nhật API provider
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


// GET /api/audit-log - Lấy hoạt động gần đây
app.get('/api/audit-log', async (req, res) => {
    try {
        const logs = await AuditLog.find().sort({ timestamp: -1 }).limit(15);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// POST /api/usage/log - Ghi nhận việc sử dụng API từ client
app.post('/api/usage/log', async (req, res) => {
    const { providerName, cost } = req.body;
    if (!providerName) {
        return res.status(400).json({ message: 'Thiếu tên nhà cung cấp' });
    }
    try {
        // Cập nhật provider, tăng totalRequests và costToday
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


// --- Key Management APIs (Updated with Auditing) ---

app.post('/api/keys', async (req, res) => {
  const { expiredAt, maxActivations, note, credit } = req.body;
  const newKeyString = generateKey();
  const newKey = new Key({
    key: newKeyString,
    expiredAt,
    maxActivations,
    note,
    credit: typeof credit === 'number' ? credit : 0,
  });
  await newKey.save();
  await createAuditLog('CREATE_KEY', `Key ${newKeyString} created with ${credit || 0} credit.`, 'Admin');
  res.status(201).json(newKey);
});

app.get('/api/keys', async (req, res) => {
  const keys = await Key.find().sort({ createdAt: -1 });
  res.json(keys);
});

app.post('/api/keys/revoke', async (req, res) => {
  const { key } = req.body;
  await Key.updateOne({ key }, { isActive: false });
  await createAuditLog('REVOKE_KEY', `Key ${key} was revoked.`, 'Admin');
  res.json({ success: true });
});

app.post('/api/keys/update-credit', async (req, res) => {
  const { key, amount } = req.body;
  if (typeof amount !== 'number') {
    return res.status(400).json({ success: false, message: 'amount phải là số' });
  }
  const updatedKey = await Key.findOneAndUpdate({ key }, { $inc: { credit: amount } }, { new: true });
  if (!updatedKey) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy key' });
  }
  const action = amount > 0 ? 'ADD_CREDIT' : 'REMOVE_CREDIT';
  await createAuditLog(action, `${Math.abs(amount)} credit ${amount > 0 ? 'added to' : 'removed from'} key ${key}. New balance: ${updatedKey.credit}`, 'Admin');
  res.json({ success: true, credit: updatedKey.credit });
});

// --- Validation and Usage APIs (No change needed for now) ---
app.post('/api/validate', async (req, res) => {
  const { key } = req.body;
  const found = await Key.findOne({ key, isActive: true });
  if (found) {
    res.json({ valid: true, keyInfo: found });
  } else {
    res.json({ valid: false });
  }
});

app.post('/api/keys/use-credit', async (req, res) => {
  const { key } = req.body;
  const found = await Key.findOne({ key, isActive: true });
  if (!found) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy key' });
  }
  if ((found.credit || 0) < 1) {
    return res.status(400).json({ success: false, message: 'Hết credit' });
  }
  found.credit -= 1;
  await found.save();
  res.json({ success: true, credit: found.credit });
});


// --- Payment APIs (Updated with Auditing and Transaction logging) ---

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
        // PayOS khuyến khích xác thực webhook, nhưng để đơn giản, ta tạm bỏ qua
        if (webhookData.code === '00' && webhookData.data.status === 'PAID') {
            const { orderCode, amount, description } = webhookData.data;
            const key = description.split(' ').pop(); // Lấy key từ mô tả
            const credit = Math.floor(amount / 1000);

            // Tránh xử lý trùng lặp
            const existingTransaction = await Transaction.findOne({ orderId: orderCode });
            if (existingTransaction) {
                return res.status(200).json({ message: 'Transaction already processed.' });
            }

            // Cập nhật credit cho key
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

            // Ghi log
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
