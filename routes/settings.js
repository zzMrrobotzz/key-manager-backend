const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { createAuditLog } = require('../utils/auditLogger');

// GET /api/settings - Get all settings
router.get('/', async (req, res) => {
    try {
        console.log('⚙️ Loading system settings...');
        
        const settings = await Settings.find();
        const settingsObj = {};
        
        settings.forEach(setting => {
            settingsObj[setting.key] = {
                value: setting.value,
                type: setting.type,
                description: setting.description,
                updatedAt: setting.updatedAt
            };
        });
        
        // Default settings if not found
        const defaults = {
            maintenanceMode: { value: false, type: 'boolean', description: 'Enable maintenance mode' },
            announcement: { value: '', type: 'string', description: 'Global announcement banner' },
            enableNewFeature: { value: true, type: 'boolean', description: 'Enable new features' },
            systemName: { value: 'AI Story Creator', type: 'string', description: 'System name' },
            adminEmail: { value: 'admin@example.com', type: 'string', description: 'Admin contact email' },
            aiMaxOutputTokens: { value: 32768, type: 'number', description: 'Maximum output tokens for AI generation' },
            aiTemperature: { value: 0.7, type: 'number', description: 'AI generation temperature (0.0-1.0)' },
            aiTopP: { value: 0.8, type: 'number', description: 'AI generation top P value (0.0-1.0)' },
            aiTopK: { value: 40, type: 'number', description: 'AI generation top K value' }
        };
        
        // Merge defaults with actual settings
        const finalSettings = { ...defaults, ...settingsObj };
        
        console.log('✅ Loaded system settings');
        
        return res.json({
            success: true,
            settings: finalSettings
        });
        
    } catch (error) {
        console.error('❌ Error loading settings:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to load system settings'
        });
    }
});

// GET /api/settings/:key - Get specific setting
router.get('/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const setting = await Settings.findOne({ key });
        
        if (!setting) {
            return res.status(404).json({
                success: false,
                error: 'Setting not found'
            });
        }
        
        return res.json({
            success: true,
            setting: {
                key: setting.key,
                value: setting.value,
                type: setting.type,
                description: setting.description,
                updatedAt: setting.updatedAt
            }
        });
        
    } catch (error) {
        console.error('Error getting setting:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get setting'
        });
    }
});

// POST /api/settings - Update multiple settings
router.post('/', async (req, res) => {
    try {
        const { settings } = req.body;
        
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Invalid settings format'
            });
        }
        
        console.log('⚙️ Updating system settings:', Object.keys(settings));
        
        const updatePromises = Object.entries(settings).map(([key, config]) => {
            return Settings.setSetting(
                key, 
                config.value, 
                config.description || '', 
                config.type || 'string'
            );
        });
        
        await Promise.all(updatePromises);
        
        await createAuditLog('UPDATE_SETTINGS', `Updated ${Object.keys(settings).length} system settings`);
        
        console.log('✅ System settings updated successfully');
        
        return res.json({
            success: true,
            message: 'Settings updated successfully'
        });
        
    } catch (error) {
        console.error('❌ Error updating settings:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update settings'
        });
    }
});

// PUT /api/settings/:key - Update specific setting
router.put('/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { value, description, type } = req.body;
        
        const setting = await Settings.setSetting(key, value, description, type);
        
        await createAuditLog('UPDATE_SETTING', `Updated setting: ${key}`);
        
        return res.json({
            success: true,
            setting
        });
        
    } catch (error) {
        console.error('Error updating setting:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update setting'
        });
    }
});

module.exports = router;