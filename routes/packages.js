const express = require('express');
const router = express.Router();
const CreditPackage = require('../models/CreditPackage');
const { createAuditLog } = require('../utils/auditLogger'); // Dùng hàm chung

// GET /api/packages - Lấy tất cả gói cước
router.get('/', async (req, res) => {
    try {
        const packages = await CreditPackage.find().sort({ price: 1 }); // Sắp xếp theo gi��
        res.json(packages);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// POST /api/packages - Tạo gói cước mới
router.post('/', async (req, res) => {
    try {
        const { name, price, credits, bonus, isPopular } = req.body;
        const newPackage = new CreditPackage({ name, price, credits, bonus, isPopular });
        await newPackage.save();
        await createAuditLog('CREATE_PACKAGE', `Gói cước "${name}" đã được tạo.`);
        res.status(201).json(newPackage);
    } catch (error) {
        res.status(400).json({ message: 'Dữ liệu không hợp lệ', error });
    }
});

// PUT /api/packages/:id - Cập nhật gói cước
router.put('/:id', async (req, res) => {
    try {
        const { name, price, credits, bonus, isPopular, isActive } = req.body;
        const updatedPackage = await CreditPackage.findByIdAndUpdate(
            req.params.id,
            { name, price, credits, bonus, isPopular, isActive },
            { new: true, runValidators: true }
        );
        if (!updatedPackage) {
            return res.status(404).json({ message: 'Không tìm thấy gói cước' });
        }
        await createAuditLog('UPDATE_PACKAGE', `Gói cước "${updatedPackage.name}" đã được cập nhật.`);
        res.json(updatedPackage);
    } catch (error) {
        res.status(400).json({ message: 'Dữ liệu không hợp lệ', error });
    }
});

// DELETE /api/packages/:id - Xóa gói cước
router.delete('/:id', async (req, res) => {
    try {
        const deletedPackage = await CreditPackage.findByIdAndDelete(req.params.id);
        if (!deletedPackage) {
            return res.status(404).json({ message: 'Không tìm thấy gói cước' });
        }
        await createAuditLog('DELETE_PACKAGE', `Gói cước "${deletedPackage.name}" đã bị xóa.`);
        res.json({ message: 'Gói cước đã được xóa' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

module.exports = router;
