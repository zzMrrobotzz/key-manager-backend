const express = require('express');
const router = express.Router();

// Dummy validate endpoint
router.post('/validate', (req, res) => {
  // TODO: Thực hiện xác thực key thực tế ở đây
  res.json({ success: true, message: 'Key hợp lệ (demo)' });
});

// Dummy use-credit endpoint
router.post('/use-credit', (req, res) => {
  // TODO: Trừ credit thực tế ở đây
  res.json({ success: true, message: 'Đã trừ credit (demo)' });
});

module.exports = router; 