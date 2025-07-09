const express = require('express');
const router = express.Router();
const Key = require('../models/Key');

// Validate key thực tế
router.post('/validate', async (req, res) => {
  const { key } = req.body;
  console.log('--- YÊU CẦU XÁC THỰC KEY ---');
  console.log('Key nhận được từ frontend:', key);

  if (!key) {
    return res.json({ success: false, message: 'Thiếu key!' });
  }

  try {
    const foundKey = await Key.findOne({ key: key.trim() });
    console.log('Kết quả tìm thấy trong DB:', foundKey);

    if (!foundKey) {
      return res.json({ success: false, message: 'Key không tồn tại!' });
    }
    if (!foundKey.isActive) {
      return res.json({ success: false, message: 'Key đã bị khóa!' });
    }
    if (foundKey.expiredAt && new Date(foundKey.expiredAt) < new Date()) {
      return res.json({ success: false, message: 'Key đã hết hạn!' });
    }
    if (foundKey.credit <= 0) {
      return res.json({ success: false, message: 'Key đã hết credit!' });
    }

    res.json({ success: true, message: 'Key hợp lệ', keyInfo: { credit: foundKey.credit, expiredAt: foundKey.expiredAt } });
  } catch (error) {
    console.error('Lỗi khi xác thực key:', error);
    res.status(500).json({ success: false, message: 'Lỗi server khi xác thực key.' });
  }
});

// Endpoint để sử dụng và trừ credit
router.post('/use-credit', async (req, res) => {
  const { key, amount = 1 } = req.body; // Mặc định trừ 1 credit nếu không có amount

  if (!key) {
    return res.status(400).json({ success: false, message: 'Thiếu key!' });
  }

  try {
    const foundKey = await Key.findOne({ key: key.trim() });

    if (!foundKey) {
      return res.status(404).json({ success: false, message: 'Key không tồn tại!' });
    }
    if (!foundKey.isActive) {
      return res.status(403).json({ success: false, message: 'Key đã bị khóa!' });
    }
    if (foundKey.expiredAt && new Date(foundKey.expiredAt) < new Date()) {
      return res.status(403).json({ success: false, message: 'Key đã hết hạn!' });
    }
    if (foundKey.credit < amount) {
      return res.status(402).json({ success: false, message: 'Không đủ credit!' });
    }

    // Trừ credit và lưu lại
    foundKey.credit -= amount;
    await foundKey.save();

    res.json({ 
      success: true, 
      message: `Đã trừ ${amount} credit.`, 
      newCredit: foundKey.credit 
    });

  } catch (error) {
    console.error('Lỗi khi trừ credit:', error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ.' });
  }
});

module.exports = router; 