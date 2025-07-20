const ApiProvider = require('../models/ApiProvider');

class ApiKeyManager {
    /**
     * Get the best available API key for a provider
     * Prioritizes active keys without quota issues
     */
    static async getBestApiKey(providerName) {
        const provider = await ApiProvider.findOne({ 
            name: { $regex: new RegExp(`^${providerName}$`, "i") } 
        });
        
        if (!provider || !provider.apiKeys || provider.apiKeys.length === 0) {
            throw new Error(`No API keys configured for provider: ${providerName}`);
        }

        // Sync keyStatus with apiKeys if needed
        await this.syncKeyStatus(provider);
        
        // Find the best available key
        const availableKeys = provider.keyStatus.filter(keyInfo => 
            keyInfo.isActive && !keyInfo.quotaExceeded
        );
        
        if (availableKeys.length === 0) {
            // All keys have issues, try to use the least recently failed one
            const fallbackKeys = provider.keyStatus
                .filter(keyInfo => keyInfo.isActive)
                .sort((a, b) => (a.lastErrorTime || new Date(0)) - (b.lastErrorTime || new Date(0)));
            
            if (fallbackKeys.length > 0) {
                console.warn(`⚠️ Using fallback key for ${providerName}: all keys have quota/error issues`);
                return fallbackKeys[0].key;
            }
            
            throw new Error(`All API keys for provider ${providerName} are exhausted or inactive`);
        }
        
        // Select least recently used key among available ones
        const bestKey = availableKeys.sort((a, b) => 
            (a.lastUsed || new Date(0)) - (b.lastUsed || new Date(0))
        )[0];
        
        console.log(`🔑 Selected API key for ${providerName}: ${bestKey.key.slice(0, 12)}... (last used: ${bestKey.lastUsed || 'never'})`);
        
        return bestKey.key;
    }

    /**
     * Mark an API key as successfully used
     */
    static async markKeyUsed(providerName, apiKey) {
        try {
            await ApiProvider.updateOne(
                { 
                    name: { $regex: new RegExp(`^${providerName}$`, "i") },
                    'keyStatus.key': apiKey 
                },
                { 
                    $set: { 
                        'keyStatus.$.lastUsed': new Date(),
                        'keyStatus.$.lastError': null,
                        'keyStatus.$.lastErrorTime': null
                    },
                    $inc: { 'keyStatus.$.requestCount': 1 }
                }
            );
        } catch (error) {
            console.error(`Failed to mark key as used: ${error.message}`);
        }
    }

    /**
     * Mark an API key as having an error (quota exceeded, invalid, etc.)
     */
    static async markKeyError(providerName, apiKey, errorType, errorMessage) {
        try {
            const updateData = {
                'keyStatus.$.lastError': errorMessage,
                'keyStatus.$.lastErrorTime': new Date()
            };

            // Handle specific error types
            if (errorType === 'quota_exceeded' || errorMessage.includes('429') || errorMessage.includes('quota')) {
                updateData['keyStatus.$.quotaExceeded'] = true;
                console.warn(`🚫 API key quota exceeded: ${apiKey.slice(0, 12)}...`);
            }
            
            if (errorType === 'invalid_key' || errorMessage.includes('invalid') || errorMessage.includes('401')) {
                updateData['keyStatus.$.isActive'] = false;
                console.error(`❌ API key marked as invalid: ${apiKey.slice(0, 12)}...`);
            }

            await ApiProvider.updateOne(
                { 
                    name: { $regex: new RegExp(`^${providerName}$`, "i") },
                    'keyStatus.key': apiKey 
                },
                { $set: updateData }
            );
        } catch (error) {
            console.error(`Failed to mark key error: ${error.message}`);
        }
    }

    /**
     * Reset quota status for all keys (call this daily)
     */
    static async resetDailyQuotas(providerName) {
        try {
            await ApiProvider.updateOne(
                { name: { $regex: new RegExp(`^${providerName}$`, "i") } },
                { 
                    $set: { 
                        'keyStatus.$[].quotaExceeded': false,
                        'keyStatus.$[].lastError': null,
                        'keyStatus.$[].lastErrorTime': null
                    }
                }
            );
            console.log(`🔄 Reset daily quotas for ${providerName}`);
        } catch (error) {
            console.error(`Failed to reset quotas: ${error.message}`);
        }
    }

    /**
     * Sync keyStatus array with apiKeys array
     */
    static async syncKeyStatus(provider) {
        let updated = false;
        
        // Add missing keys to keyStatus
        for (const apiKey of provider.apiKeys) {
            const exists = provider.keyStatus.some(status => status.key === apiKey);
            if (!exists) {
                provider.keyStatus.push({
                    key: apiKey,
                    isActive: true,
                    quotaExceeded: false,
                    requestCount: 0
                });
                updated = true;
            }
        }
        
        // Remove keyStatus entries for keys that no longer exist
        provider.keyStatus = provider.keyStatus.filter(status => 
            provider.apiKeys.includes(status.key)
        );
        
        if (updated) {
            await provider.save();
        }
    }

    /**
     * Get statistics for all keys of a provider
     */
    static async getKeyStatistics(providerName) {
        const provider = await ApiProvider.findOne({ 
            name: { $regex: new RegExp(`^${providerName}$`, "i") } 
        });
        
        if (!provider) {
            return null;
        }

        await this.syncKeyStatus(provider);
        
        return {
            totalKeys: provider.apiKeys.length,
            activeKeys: provider.keyStatus.filter(k => k.isActive).length,
            quotaExceededKeys: provider.keyStatus.filter(k => k.quotaExceeded).length,
            availableKeys: provider.keyStatus.filter(k => k.isActive && !k.quotaExceeded).length,
            keyDetails: provider.keyStatus.map(k => ({
                key: k.key.slice(0, 12) + '...',
                isActive: k.isActive,
                quotaExceeded: k.quotaExceeded,
                requestCount: k.requestCount,
                lastUsed: k.lastUsed,
                lastError: k.lastError
            }))
        };
    }
}

module.exports = ApiKeyManager;