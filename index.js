require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const corsOptions = {
  origin: 'https://keyadmintoolviettruyen.netlify.app',
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};

app.use(cors(corsOptions));
app.use(express.json());

// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected!'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mẫu schema cho Key
const keySchema = new mongoose.Schema({
  key: String,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  expiredAt: { type: Date },
  maxActivations: { type: Number, default: 1 },
  note: { type: String, default: "" },
  credit: { type: Number, default: 0 },
});
const Key = mongoose.model('Key', keySchema);

// PAYOS CONFIG
const PAYOS_CLIENT_ID = 'be64263c-d0b5-48c7-a5e4-9e1357786d4c';
const PAYOS_API_KEY = '6c790eab-3334-4180-bf54-d3071ca7f277';
const PAYOS_CHECKSUM_KEY = '271d878407a1020d240d9064d0bfb4300bfe2e02bf997bb28771dea73912bd55';
const PAYOS_API_URL = 'https://api-merchant.payos.vn/v2/payment-requests';

// API tạo key mới
app.post('/api/keys', async (req, res) => {
  const { expiredAt, maxActivations, note, credit } = req.body;
  const newKey = new Key({
    key: generateKey(),
    expiredAt,
    maxActivations,
    note,
    credit: typeof credit === 'number' ? credit : 0,
  });
  await newKey.save();
  res.json(newKey);
});

// API xác thực key
app.post('/api/validate', async (req, res) => {
  const { key } = req.body;
  const found = await Key.findOne({ key, isActive: true });
  if (found) {
    res.json({
      valid: true,
      keyInfo: {
        expiredAt: found.expiredAt,
        maxActivations: found.maxActivations,
        note: found.note,
        isActive: found.isActive,
        createdAt: found.createdAt,
        key: found.key,
        credit: found.credit,
      }
    });
  } else {
    res.json({ valid: false });
  }
});

// Hàm sinh key ngẫu nhiên
function generateKey() {
  return 'KEY-' + Math.random().toString(36).substr(2, 8).toUpperCase();
}

// API lấy danh sách key
app.get('/api/keys', async (req, res) => {
  const keys = await Key.find();
  res.json(keys);
});

// API thu hồi/khoá key
app.post('/api/keys/revoke', async (req, res) => {
  const { key } = req.body;
  await Key.updateOne({ key }, { isActive: false });
  res.json({ success: true });
});

// API cộng/trừ credit cho key (admin)
app.post('/api/keys/update-credit', async (req, res) => {
  const { key, amount } = req.body;
  if (typeof amount !== 'number') {
    return res.status(400).json({ success: false, message: 'amount phải là số' });
  }
  const found = await Key.findOne({ key });
  if (!found) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy key' });
  }
  found.credit = Math.max(0, (found.credit || 0) + amount); // Không cho credit âm
  await found.save();
  res.json({ success: true, credit: found.credit });
});

// API trừ 1 credit khi user tạo bài viết (chỉ cho 4 module tính phí)
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

// API tạo đơn hàng PayOS
app.post('/api/payment/create', async (req, res) => {
  console.log('Received /api/payment/create', req.body);
  try {
    // Log dữ liệu chuẩn bị gửi PayOS
    const { key, credit } = req.body;
    console.log('Chuẩn bị tạo đơn PayOS với key:', key, 'credit:', credit);
    if (!key || !credit || credit < 1) {
      return res.status(400).json({ success: false, message: 'Thiếu key hoặc số credit không hợp lệ' });
    }
    // Tính số tiền (VD: 1 credit = 1000 VND)
    const amount = credit * 1000;
    const orderId = 'ORDER-' + Date.now() + '-' + Math.floor(Math.random()*10000);
    const description = `Nạp ${credit} credit cho key ${key}`;
    const returnUrl = 'https://admintoolviettruyen.netlify.app'; // URL trả về sau khi thanh toán
    const webhookUrl = process.env.PAYOS_WEBHOOK_URL || 'https://key-manager-backend.onrender.com/api/payment/webhook';

    // Tạo payload
    const payload = {
      orderCode: orderId,
      amount,
      description,
      returnUrl,
      cancelUrl: returnUrl,
      buyerName: key,
      buyerEmail: '',
      buyerPhone: '',
      clientId: PAYOS_CLIENT_ID,
      webhookUrl
    };
    // Tạo signature (checksum) đúng thứ tự PayOS
    const rawSignature =
      String(orderId) +
      String(amount) +
      String(description) +
      String(returnUrl) +
      String(returnUrl) + // cancelUrl
      String(key) +       // buyerName
      '' +                // buyerEmail
      '' +                // buyerPhone
      String(PAYOS_CLIENT_ID) +
      String(webhookUrl) +
      String(PAYOS_API_KEY);
    payload.signature = crypto.createHmac('sha256', PAYOS_CHECKSUM_KEY).update(rawSignature).digest('hex');

    // Gọi PayOS (giả sử dùng axios)
    let payosRes;
    try {
      payosRes = await axios.post(PAYOS_API_URL, payload, {
        headers: {
          'x-client-id': PAYOS_CLIENT_ID,
          'x-api-key': PAYOS_API_KEY,
          'Content-Type': 'application/json',
        }
      });
      console.log('PayOS response:', payosRes.data);
    } catch (payosErr) {
      console.error('Lỗi khi gọi PayOS:', payosErr?.response?.data || payosErr.message || payosErr);
      throw payosErr;
    }

    // ... code xử lý tiếp ...
    // Trả về cho frontend
    res.json({ payUrl: payosRes.data?.checkoutUrl });
    console.log('Trả về payUrl:', payosRes.data?.checkoutUrl);
  } catch (err) {
    console.error('Lỗi tạo đơn hàng PayOS:', err?.response?.data || err.message || err);
    res.status(500).json({ message: 'Lỗi tạo đơn hàng PayOS', detail: err?.response?.data || err.message || err });
  }
});

// API webhook nhận thanh toán thành công từ PayOS
app.post('/api/payment/webhook', async (req, res) => {
  const { orderCode, amount, description, status, signature, buyerName } = req.body;
  // Xác thực signature
  const rawSignature = `${orderCode}${amount}${description}${status}${PAYOS_API_KEY}`;
  const expectedSignature = crypto.createHmac('sha256', PAYOS_CHECKSUM_KEY).update(rawSignature).digest('hex');
  if (signature !== expectedSignature) {
    return res.status(400).json({ success: false, message: 'Sai chữ ký xác thực' });
  }
  if (status !== 'PAID') {
    return res.status(200).json({ success: true, message: 'Chưa thanh toán thành công' });
  }
  // buyerName là key
  const key = buyerName;
  const credit = Math.floor(amount / 1000); // 1 credit = 1000 VND
  const found = await Key.findOne({ key });
  if (!found) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy key' });
  }
  found.credit = (found.credit || 0) + credit;
  await found.save();
  console.log(`Nạp ${credit} credit cho key ${key} qua PayOS!`);
  res.json({ success: true });
});

// Route cho trang chủ
app.get('/', (req, res) => {
  res.send('Backend is running!');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});