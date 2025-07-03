require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
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

// Route cho trang chủ
app.get('/', (req, res) => {
  res.send('Backend is running!');
});

app.listen(process.env.PORT, () => {
  console.log('Server running on port', process.env.PORT);
});