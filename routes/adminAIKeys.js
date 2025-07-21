const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/adminAuth');
const aiKeyManager = require('../services/aiKeyManager');

// GET /admin/ai-keys - Lấy danh sách tất cả API keys (chỉ admin)
router.get('/ai-keys', isAdmin, async (req, res) => {
  try {
    const keys = await aiKeyManager.loadKeys();
    
    // Trả về thông tin provider và trạng thái key (không trả về key thật)
    const providersInfo = [];
    for (const provider of Object.keys(keys)) {
      const hasKey = await aiKeyManager.hasValidKey(provider);
      providersInfo.push({
        provider,
        hasKey,
        keyLength: keys[provider] ? keys[provider].length : 0,
        lastUpdated: new Date().toISOString() // Có thể thêm timestamp thực tế
      });
    }

    res.json({
      success: true,
      data: {
        providers: providersInfo,
        totalProviders: providersInfo.length,
        activeProviders: providersInfo.filter(p => p.hasKey).length
      }
    });
  } catch (error) {
    console.error('Error getting AI keys:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve AI keys'
    });
  }
});

// POST /admin/ai-keys - Thêm/cập nhật API key cho provider (chỉ admin)
router.post('/ai-keys', isAdmin, async (req, res) => {
  try {
    const { provider, apiKey } = req.body;

    // Validate input
    if (!provider || !apiKey) {
      return res.status(400).json({
        success: false,
        message: 'Provider and API key are required'
      });
    }

    // Validate provider name
    const validProviders = ['gemini', 'openai', 'deepseek', 'stability', 'elevenlabs'];
    if (!validProviders.includes(provider.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid provider. Supported providers: ${validProviders.join(', ')}`
      });
    }

    // Validate API key format
    const validation = aiKeyManager.validateKeyFormat(provider, apiKey);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message
      });
    }

    // Cập nhật key
    await aiKeyManager.updateKey(provider.toLowerCase(), apiKey.trim());

    res.json({
      success: true,
      message: `API key for ${provider} updated successfully`,
      data: {
        provider: provider.toLowerCase(),
        hasKey: true,
        keyLength: apiKey.trim().length
      }
    });
  } catch (error) {
    console.error('Error updating AI key:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update AI key'
    });
  }
});

// DELETE /admin/ai-keys/:provider - Xóa API key cho provider (chỉ admin)
router.delete('/ai-keys/:provider', isAdmin, async (req, res) => {
  try {
    const { provider } = req.params;

    // Validate provider name
    const validProviders = ['gemini', 'openai', 'deepseek', 'stability', 'elevenlabs'];
    if (!validProviders.includes(provider.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid provider. Supported providers: ${validProviders.join(', ')}`
      });
    }

    // Kiểm tra xem provider có key không
    const hasKey = await aiKeyManager.hasValidKey(provider);
    if (!hasKey) {
      return res.status(404).json({
        success: false,
        message: `No API key found for provider: ${provider}`
      });
    }

    // Xóa key
    await aiKeyManager.deleteKey(provider.toLowerCase());

    res.json({
      success: true,
      message: `API key for ${provider} deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting AI key:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete AI key'
    });
  }
});

// GET /admin/ai-keys/:provider - Lấy thông tin API key cho provider cụ thể (chỉ admin)
router.get('/ai-keys/:provider', isAdmin, async (req, res) => {
  try {
    const { provider } = req.params;

    // Validate provider name
    const validProviders = ['gemini', 'openai', 'deepseek', 'stability', 'elevenlabs'];
    if (!validProviders.includes(provider.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid provider. Supported providers: ${validProviders.join(', ')}`
      });
    }

    const hasKey = await aiKeyManager.hasValidKey(provider);
    const key = await aiKeyManager.getKey(provider);

    res.json({
      success: true,
      data: {
        provider: provider.toLowerCase(),
        hasKey,
        keyLength: key ? key.length : 0,
        // Không trả về key thật, chỉ trả về mask key để admin biết có key hay không
        keyMask: key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : null
      }
    });
  } catch (error) {
    console.error('Error getting AI key info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get AI key information'
    });
  }
});

// POST /admin/ai-keys/test/:provider - Test API key cho provider (chỉ admin)
router.post('/ai-keys/test/:provider', isAdmin, async (req, res) => {
  try {
    const { provider } = req.params;

    // Validate provider name
    const validProviders = ['gemini', 'openai', 'deepseek', 'stability', 'elevenlabs'];
    if (!validProviders.includes(provider.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid provider. Supported providers: ${validProviders.join(', ')}`
      });
    }

    const hasKey = await aiKeyManager.hasValidKey(provider);
    if (!hasKey) {
      return res.status(400).json({
        success: false,
        message: `No valid API key found for provider: ${provider}`
      });
    }

    // Test API key bằng cách gọi API đơn giản
    const key = await aiKeyManager.getKey(provider);
    let testResult = { valid: false, message: 'Test failed' };

    try {
      switch (provider.toLowerCase()) {
        case 'gemini':
          // Test Gemini API
          const { GoogleGenerativeAI } = require('@google/generative-ai');
          const genAI = new GoogleGenerativeAI(key);
          const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
          const result = await model.generateContent('Test connection');
          await result.response.text(); // Make sure the response can be parsed
          testResult = { valid: true, message: 'Gemini API key is valid' };
          break;

        case 'openai':
          // Test OpenAI API
          const OpenAI = require('openai');
          const openai = new OpenAI({ apiKey: key });
          await openai.models.list();
          testResult = { valid: true, message: 'OpenAI API key is valid' };
          break;

        case 'deepseek':
          // Test DeepSeek API
          const response = await fetch('https://api.deepseek.com/v1/models', {
            headers: { 'Authorization': `Bearer ${key}` }
          });
          if (response.ok) {
            testResult = { valid: true, message: 'DeepSeek API key is valid' };
          } else {
            testResult = { valid: false, message: 'DeepSeek API key is invalid' };
          }
          break;

        default:
          testResult = { valid: false, message: 'Test not implemented for this provider' };
      }
    } catch (testError) {
      testResult = { valid: false, message: `API test failed: ${testError.message}` };
    }

    res.json({
      success: true,
      data: {
        provider: provider.toLowerCase(),
        testResult
      }
    });
  } catch (error) {
    console.error('Error testing AI key:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test AI key'
    });
  }
});

module.exports = router; 