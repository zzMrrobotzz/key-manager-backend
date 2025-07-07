const express = require('express');
const router = express.Router();
const Key = require('../models/Key');
const { createAuditLog } = require('../utils/auditLogger');

// Helper sinh key ngẫu nhiên
const generateKey = () => 'KEY-' + Math.random().toString(36).substr(2, 8).toUpperCase();

// POST / - Tạo key mới
router.post('/', async (req, res) => {
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

// GET / - Lấy danh sách key
router.get('/', async (req, res) => {
    const keys = await Key.find().sort({ createdAt: -1 });
    res.json(keys);
});

// PUT /:id/details - Cập nhật chi tiết key (note, expiredAt, credit...)
router.put('/:id/details', async (req, res) => {
    try {
        const { note, expiredAt, credit, maxActivations } = req.body;
        const updateData = { note, expiredAt, credit, maxActivations };

        const key = await Key.findByIdAndUpdate(req.params.id, updateData, { new: true });
        if (!key) {
            return res.status(404).json({ message: 'Không tìm thấy key' });
        }
        await createAuditLog('UPDATE_KEY_DETAILS', `Details for key ${key.key} were updated.`, 'Admin');
        res.json(key);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});


// PUT /:id/status - Cập nhật tr��ng thái (Active/Inactive)
router.put('/:id/status', async (req, res) => {
    try {
        const { isActive } = req.body;
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
        }
        const key = await Key.findByIdAndUpdate(req.params.id, { isActive }, { new: true });
        if (!key) {
            return res.status(404).json({ message: 'Không tìm thấy key' });
        }
        const statusText = isActive ? 'activated' : 'deactivated';
        await createAuditLog('UPDATE_KEY_STATUS', `Key ${key.key} was ${statusText}.`, 'Admin');
        res.json(key);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// POST /update-credit - Cộng/trừ credit
router.post('/update-credit', async (req, res) => {
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


// --- Các API cho người dùng cuối (không thay đổi) ---

// POST /validate - Xác thực key
router.post('/validate', async (req, res) => {
    const { key } = req.body;
    const found = await Key.findOne({ key, isActive: true });
    if (found) {
        res.json({ valid: true, keyInfo: found });
    } else {
        res.json({ valid: false });
    }
});

// POST /use-credit - Trừ credit khi dùng
router.post('/use-credit', async (req, res) => {
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


module.exports = router;
