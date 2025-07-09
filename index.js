
// --- AI Proxy Endpoint ---
const { GoogleGenerativeAI } = require('@google/generative-ai');

app.post('/api/ai/generate', async (req, res) => {
    const { prompt, provider, systemInstruction, useGoogleSearch } = req.body;
    const userKey = req.headers.authorization?.split(' ')[1]; // Extract key from 'Bearer <key>'

    if (!userKey) {
        return res.status(401).json({ message: 'Authorization key is missing.' });
    }

    // Validate user key (optional but recommended)
    // For now, we assume the key is valid if it exists.

    try {
        const providerDoc = await ApiProvider.findOne({ name: { $regex: new RegExp(provider, "i") } });

        if (!providerDoc || !providerDoc.apiKeys || providerDoc.apiKeys.length === 0) {
            return res.status(503).json({ message: `No API keys configured for provider: ${provider}. Please contact admin.` });
        }

        // --- Key Rotation Logic ---
        const apiKey = providerDoc.apiKeys[Math.floor(Math.random() * providerDoc.apiKeys.length)];

        let generatedText = '';

        // Currently, only Gemini is implemented via proxy. Others would need similar logic.
        if (provider.toLowerCase() === 'gemini') {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Or get model from request
            
            const generationConfig = {
                systemInstruction: systemInstruction,
                tools: useGoogleSearch ? [{googleSearch: {}}] : undefined,
            };

            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: generationConfig,
            });

            generatedText = result.response.text();
        } else {
            return res.status(400).json({ message: `Provider '${provider}' is not yet supported by the proxy.` });
        }

        // Log usage and deduct credit (future implementation)
        // await Key.updateOne({ key: userKey }, { $inc: { credit: -1 } });

        res.json({ success: true, text: generatedText });

    } catch (error) {
        console.error(`AI Proxy Error (${provider}):`, error);
        res.status(500).json({ success: false, error: `Failed to generate content with ${provider}.` });
    }
});


// --- Root and Server Start ---