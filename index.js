
// --- API Key Management for Providers ---

// Add a key to a provider
app.post('/api/providers/:providerId/keys', async (req, res) => {
    const { providerId } = req.params;
    const { apiKey } = req.body;

    if (!apiKey) {
        return res.status(400).json({ message: 'API key is required' });
    }

    try {
        const provider = await ApiProvider.findById(providerId);
        if (!provider) {
            return res.status(404).json({ message: 'Provider not found' });
        }

        if (provider.apiKeys.includes(apiKey)) {
            return res.status(409).json({ message: 'API key already exists for this provider' });
        }

        provider.apiKeys.push(apiKey);
        await provider.save();
        
        await createAuditLog('ADD_API_KEY', `Added new API key to ${provider.name}`, 'Admin');
        res.status(201).json(provider);
    } catch (error) {
        console.error('Error adding API key:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete a key from a provider
app.delete('/api/providers/:providerId/keys', async (req, res) => {
    const { providerId } = req.params;
    const { apiKey } = req.body;

    if (!apiKey) {
        return res.status(400).json({ message: 'API key is required' });
    }

    try {
        const provider = await ApiProvider.findById(providerId);
        if (!provider) {
            return res.status(404).json({ message: 'Provider not found' });
        }

        const keyIndex = provider.apiKeys.indexOf(apiKey);
        if (keyIndex === -1) {
            return res.status(404).json({ message: 'API key not found for this provider' });
        }

        provider.apiKeys.splice(keyIndex, 1);
        await provider.save();

        await createAuditLog('DELETE_API_KEY', `Removed an API key from ${provider.name}`, 'Admin');
        res.status(200).json(provider);
    } catch (error) {
        console.error('Error deleting API key:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


// --- Payment APIs ---