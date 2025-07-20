const express = require('express');
const router = express.Router();
const BankInfo = require('../models/BankInfo');

// GET /api/bank-info - Get active bank info
router.get('/', async (req, res) => {
    try {
        const bankInfo = await BankInfo.getActiveBankInfo();
        
        if (!bankInfo) {
            // Return default if no bank info exists
            return res.json({
                success: true,
                bankInfo: {
                    bankName: 'Vietcombank',
                    accountNumber: '0123456789',
                    accountName: 'NGUYEN VAN A',
                    branchName: 'CN Ho Chi Minh'
                }
            });
        }

        res.json({
            success: true,
            bankInfo: {
                _id: bankInfo._id,
                bankName: bankInfo.bankName,
                accountNumber: bankInfo.accountNumber,
                accountName: bankInfo.accountName,
                branchName: bankInfo.branchName,
                note: bankInfo.note,
                updatedAt: bankInfo.updatedAt
            }
        });

    } catch (error) {
        console.error('Get bank info error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch bank info'
        });
    }
});

// POST /api/bank-info - Create or update bank info (Admin only)
router.post('/', async (req, res) => {
    try {
        const { bankName, accountNumber, accountName, branchName, note } = req.body;

        // Validation
        if (!bankName || !accountNumber || !accountName) {
            return res.status(400).json({
                success: false,
                error: 'Bank name, account number, and account name are required'
            });
        }

        // Check if bank info already exists
        let bankInfo = await BankInfo.getActiveBankInfo();
        
        if (bankInfo) {
            // Update existing
            bankInfo.bankName = bankName;
            bankInfo.accountNumber = accountNumber;
            bankInfo.accountName = accountName;
            bankInfo.branchName = branchName || bankInfo.branchName;
            bankInfo.note = note || '';
            await bankInfo.save();
        } else {
            // Create new
            bankInfo = new BankInfo({
                name: 'default',
                bankName,
                accountNumber,
                accountName,
                branchName: branchName || 'CN Ho Chi Minh',
                note: note || '',
                isActive: true
            });
            await bankInfo.save();
        }

        res.json({
            success: true,
            message: 'Bank info updated successfully',
            bankInfo: {
                _id: bankInfo._id,
                bankName: bankInfo.bankName,
                accountNumber: bankInfo.accountNumber,
                accountName: bankInfo.accountName,
                branchName: bankInfo.branchName,
                note: bankInfo.note,
                updatedAt: bankInfo.updatedAt
            }
        });

    } catch (error) {
        console.error('Update bank info error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update bank info'
        });
    }
});

// GET /api/bank-info/admin - Get all bank info (Admin only)
router.get('/admin', async (req, res) => {
    try {
        const bankInfos = await BankInfo.find().sort({ updatedAt: -1 });
        
        res.json({
            success: true,
            bankInfos
        });

    } catch (error) {
        console.error('Get all bank info error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch bank info list'
        });
    }
});

module.exports = router;