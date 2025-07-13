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
  console.log('--- YÊU CẦU TRỪ CREDIT ---');
  console.log('Payload nhận được:', req.body);

  if (!key) {
    console.log('Thiếu key!');
    return res.status(400).json({ success: false, message: 'Thiếu key!' });
  }

  try {
    const foundKey = await Key.findOne({ key: key.trim() });

    if (!foundKey) {
      console.log('Key không tồn tại!');
      return res.status(404).json({ success: false, message: 'Key không tồn tại!' });
    }
    if (!foundKey.isActive) {
      console.log('Key đã bị khóa!');
      return res.status(403).json({ success: false, message: 'Key đã bị khóa!' });
    }
    if (foundKey.expiredAt && new Date(foundKey.expiredAt) < new Date()) {
      console.log('Key đã hết hạn!');
      return res.status(403).json({ success: false, message: 'Key đã hết hạn!' });
    }
    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      console.log('Amount không hợp lệ:', amount);
      return res.status(400).json({ success: false, message: 'Amount không hợp lệ!' });
    }
    if (foundKey.credit < amountNum) {
      console.log(`Không đủ credit! Key: ${key}, Credit hiện tại: ${foundKey.credit}, Amount yêu cầu: ${amountNum}`);
      return res.status(402).json({ success: false, message: 'Không đủ credit!' });
    }

    // Trừ credit và lưu lại
    foundKey.credit -= amountNum;
    await foundKey.save();

    console.log(`Đã trừ ${amountNum} credit cho key ${key}. Credit còn lại: ${foundKey.credit}`);
    res.json({ 
      success: true, 
      message: `Đã trừ ${amountNum} credit.`, 
      newCredit: foundKey.credit 
    });

  } catch (error) {
    console.error('Lỗi khi trừ credit:', error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ.' });
  }
});

module.exports = router; 