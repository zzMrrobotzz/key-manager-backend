const express = require('express');
const router = express.Router();
const CreditPackage = require('../models/CreditPackage');
const { createAuditLog } = require('../utils/auditLogger');

// GET /api/packages - Lấy tất cả gói cước
router.get('/', async (req, res) => {
    try {
        const packages = await CreditPackage.find().sort({ price: 1 });
        res.json({ success: true, packages });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
});

// POST /api/packages - Tạo gói cước mới
router.post('/', async (req, res) => {
    try {
        const { name, price, credits, bonus, isPopular, isActive, description } = req.body;
        const newPackage = new CreditPackage({ 
            name, 
            price, 
            credits, 
            bonus, 
            isPopular: isPopular || false,
            isActive: isActive !== undefined ? isActive : true,
            description 
        });
        await newPackage.save();
        await createAuditLog('CREATE_PACKAGE', `Gói cước "${name}" đã được tạo.`);
        res.status(201).json({ success: true, package: newPackage });
    } catch (error) {
        res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ', details: error.message });
    }
});

// PUT /api/packages/:id - Cập nhật gói cước
router.put('/:id', async (req, res) => {
    try {
        const { name, price, credits, bonus, isPopular, isActive, description } = req.body;
        const updatedPackage = await CreditPackage.findByIdAndUpdate(
            req.params.id,
            { name, price, credits, bonus, isPopular, isActive, description },
            { new: true, runValidators: true }
        );
        if (!updatedPackage) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy gói cước' });
        }
        await createAuditLog('UPDATE_PACKAGE', `Gói cước "${updatedPackage.name}" đã được cập nhật.`);
        res.json({ success: true, package: updatedPackage });
    } catch (error) {
        res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ', details: error.message });
    }
});

// DELETE /api/packages/:id - Xóa gói cước
router.delete('/:id', async (req, res) => {
    try {
        const deletedPackage = await CreditPackage.findByIdAndDelete(req.params.id);
        if (!deletedPackage) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy gói cước' });
        }
        await createAuditLog('DELETE_PACKAGE', `Gói cước "${deletedPackage.name}" đã bị xóa.`);
        res.json({ success: true, message: 'Gói cước đã được xóa' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
});

module.exports = router; 