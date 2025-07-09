const fs = require('fs').promises;
const path = require('path');

class AIKeyManager {
  constructor() {
    this.keysFilePath = path.join(__dirname, '../ai-keys.json');
    this.cache = null;
    this.cacheExpiry = null;
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 phút
  }

  // Đọc API keys từ file
  async loadKeys() {
    try {
      // Kiểm tra cache
      if (this.cache && this.cacheExpiry && Date.now() < this.cacheExpiry) {
        return this.cache;
      }

      const data = await fs.readFile(this.keysFilePath, 'utf8');
      this.cache = JSON.parse(data);
      this.cacheExpiry = Date.now() + this.CACHE_DURATION;
      
      return this.cache;
    } catch (error) {
      console.error('Error loading AI keys:', error);
      // Trả về object rỗng nếu file không tồn tại
      return {};
    }
  }

  // Lưu API keys vào file
  async saveKeys(keys) {
    try {
      await fs.writeFile(this.keysFilePath, JSON.stringify(keys, null, 2));
      // Cập nhật cache
      this.cache = keys;
      this.cacheExpiry = Date.now() + this.CACHE_DURATION;
      return true;
    } catch (error) {
      console.error('Error saving AI keys:', error);
      throw new Error('Failed to save AI keys');
    }
  }

  // Lấy API key cho provider cụ thể
  async getKey(provider) {
    const keys = await this.loadKeys();
    return keys[provider] || null;
  }

  // Cập nhật API key cho provider
  async updateKey(provider, apiKey) {
    const keys = await this.loadKeys();
    keys[provider] = apiKey;
    await this.saveKeys(keys);
    return true;
  }

  // Xóa API key cho provider
  async deleteKey(provider) {
    const keys = await this.loadKeys();
    delete keys[provider];
    await this.saveKeys(keys);
    return true;
  }

  // Lấy danh sách tất cả providers có key
  async getActiveProviders() {
    const keys = await this.loadKeys();
    return Object.keys(keys).filter(provider => keys[provider] && keys[provider].trim() !== '');
  }

  // Kiểm tra provider có key hợp lệ không
  async hasValidKey(provider) {
    const key = await this.getKey(provider);
    return key && key.trim() !== '' && key !== `YOUR_${provider.toUpperCase()}_API_KEY_HERE`;
  }

  // Validate API key format (cơ bản)
  validateKeyFormat(provider, apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      return { valid: false, message: 'API key cannot be empty' };
    }

    const trimmedKey = apiKey.trim();
    
    // Kiểm tra format cơ bản cho từng provider
    switch (provider.toLowerCase()) {
      case 'gemini':
        if (!trimmedKey.startsWith('AIza')) {
          return { valid: false, message: 'Invalid Gemini API key format' };
        }
        break;
      case 'openai':
        if (!trimmedKey.startsWith('sk-')) {
          return { valid: false, message: 'Invalid OpenAI API key format' };
        }
        break;
      case 'deepseek':
        if (trimmedKey.length < 20) {
          return { valid: false, message: 'Invalid DeepSeek API key format' };
        }
        break;
      case 'stability':
        if (!trimmedKey.startsWith('sk-')) {
          return { valid: false, message: 'Invalid Stability AI API key format' };
        }
        break;
      case 'elevenlabs':
        if (trimmedKey.length < 20) {
          return { valid: false, message: 'Invalid ElevenLabs API key format' };
        }
        break;
      default:
        // Cho các provider khác, chỉ kiểm tra độ dài tối thiểu
        if (trimmedKey.length < 10) {
          return { valid: false, message: 'API key too short' };
        }
    }

    return { valid: true, message: 'API key format is valid' };
  }
}

module.exports = new AIKeyManager(); 