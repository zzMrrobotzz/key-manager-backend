const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/adminAuth');
const aiKeyManager = require('../services/aiKeyManager');
const rateLimit = require('express-rate-limit');

// Rate limiting cho AI requests
const aiRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 100, // Giới hạn 100 requests per windowMs per IP
  message: {
    success: false,
    message: 'Too many AI requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /ai/providers - Lấy danh sách provider đang bật
router.get('/providers', async (req, res) => {
  try {
    const activeProviders = await aiKeyManager.getActiveProviders();
    
    res.json({
      success: true,
      data: {
        providers: activeProviders,
        count: activeProviders.length
      }
    });
  } catch (error) {
    console.error('Error getting providers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get providers'
    });
  }
});

// POST /ai/generate - Proxy AI text generation
router.post('/generate', authenticateUser, aiRequestLimiter, async (req, res) => {
  try {
    const { prompt, systemInstruction, provider, model, useGoogleSearch, options } = req.body;
    const userId = req.user.key; // Lấy user key từ token

    // Validate input
    if (!prompt || !provider) {
      return res.status(400).json({
        success: false,
        message: 'Prompt and provider are required'
      });
    }

    // Kiểm tra provider có key hợp lệ không
    const hasValidKey = await aiKeyManager.hasValidKey(provider);
    if (!hasValidKey) {
      return res.status(400).json({
        success: false,
        message: `Provider ${provider} is not available or has invalid API key`
      });
    }

    // TODO: Trừ credit trước khi gọi AI
    // const creditResult = await consumeCredit(userId, 1);
    // if (!creditResult.success) {
    //   return res.status(402).json({
    //     success: false,
    //     message: creditResult.message
    //   });
    // }

    // Lấy API key
    const apiKey = await aiKeyManager.getKey(provider);

    // Gọi AI provider tương ứng
    let result;
    try {
      switch (provider.toLowerCase()) {
        case 'gemini':
          result = await callGeminiAPI(prompt, systemInstruction, apiKey, useGoogleSearch, options);
          break;
        case 'openai':
          result = await callOpenAIAPI(prompt, systemInstruction, apiKey, model, options);
          break;
        case 'deepseek':
          result = await callDeepSeekAPI(prompt, systemInstruction, apiKey, model, options);
          break;
        default:
          return res.status(400).json({
            success: false,
            message: `Unsupported provider: ${provider}`
          });
      }

      // Log request thành công
      console.log(`AI request successful - User: ${userId}, Provider: ${provider}, Prompt length: ${prompt.length}`);

      res.json({
        success: true,
        text: result.text,
        usage: result.usage || null
      });

    } catch (aiError) {
      console.error(`AI API error - Provider: ${provider}, Error:`, aiError);
      
      // TODO: Hoàn trả credit nếu có lỗi
      // await refundCredit(userId, 1);

      res.status(500).json({
        success: false,
        message: `AI generation failed: ${aiError.message}`
      });
    }

  } catch (error) {
    console.error('Error in AI proxy:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /ai/generate-image - Proxy AI image generation
router.post('/generate-image', authenticateUser, aiRequestLimiter, async (req, res) => {
  try {
    const { prompt, aspectRatio, provider } = req.body;
    const userId = req.user.key;

    // Validate input
    if (!prompt || !provider) {
      return res.status(400).json({
        success: false,
        message: 'Prompt and provider are required'
      });
    }

    // Kiểm tra provider có hỗ trợ image generation không
    const imageProviders = ['gemini', 'stability'];
    if (!imageProviders.includes(provider.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Provider ${provider} does not support image generation`
      });
    }

    // Kiểm tra provider có key hợp lệ không
    const hasValidKey = await aiKeyManager.hasValidKey(provider);
    if (!hasValidKey) {
      return res.status(400).json({
        success: false,
        message: `Provider ${provider} is not available or has invalid API key`
      });
    }

    // TODO: Trừ credit cho image generation (thường cao hơn text)
    // const creditResult = await consumeCredit(userId, 2);
    // if (!creditResult.success) {
    //   return res.status(402).json({
    //     success: false,
    //     message: creditResult.message
    //   });
    // }

    // Lấy API key
    const apiKey = await aiKeyManager.getKey(provider);

    // Gọi AI provider cho image generation
    let result;
    try {
      switch (provider.toLowerCase()) {
        case 'gemini':
          result = await callGeminiImageAPI(prompt, aspectRatio, apiKey);
          break;
        case 'stability':
          result = await callStabilityImageAPI(prompt, aspectRatio, apiKey);
          break;
        default:
          return res.status(400).json({
            success: false,
            message: `Unsupported image provider: ${provider}`
          });
      }

      // Log request thành công
      console.log(`Image generation successful - User: ${userId}, Provider: ${provider}`);

      res.json({
        success: true,
        imageData: result.imageData
      });

    } catch (aiError) {
      console.error(`Image API error - Provider: ${provider}, Error:`, aiError);
      
      // TODO: Hoàn trả credit nếu có lỗi
      // await refundCredit(userId, 2);

      res.status(500).json({
        success: false,
        message: `Image generation failed: ${aiError.message}`
      });
    }

  } catch (error) {
    console.error('Error in image proxy:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Helper functions để gọi các AI provider
async function callGeminiAPI(prompt, systemInstruction, apiKey, useGoogleSearch, options) {
  const { GoogleGenAI } = require('@google/genai');
  const genAI = new GoogleGenAI({ apiKey });
  const model = genAI.getGenerativeModel({ 
    model: 'gemini-pro',
    ...options
  });

  const request = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  };

  if (systemInstruction) {
    request.systemInstruction = systemInstruction;
  }

  if (useGoogleSearch) {
    request.tools = [{ googleSearch: {} }];
  }

  const result = await model.generateContent(request);
  const response = await result.response;
  
  return {
    text: response.text(),
    usage: {
      promptTokens: result.usageMetadata?.promptTokenCount || 0,
      completionTokens: result.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: result.usageMetadata?.totalTokenCount || 0
    }
  };
}

async function callOpenAIAPI(prompt, systemInstruction, apiKey, model = 'gpt-3.5-turbo', options) {
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey });

  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  messages.push({ role: 'user', content: prompt });

  const completion = await openai.chat.completions.create({
    model,
    messages,
    ...options
  });

  return {
    text: completion.choices[0].message.content,
    usage: completion.usage
  };
}

async function callDeepSeekAPI(prompt, systemInstruction, apiKey, model = 'deepseek-chat', options) {
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      ...options
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.statusText}`);
  }

  const data = await response.json();
  
  return {
    text: data.choices[0].message.content,
    usage: data.usage
  };
}

async function callGeminiImageAPI(prompt, aspectRatio, apiKey) {
  const { GoogleGenAI } = require('@google/genai');
  const genAI = new GoogleGenAI({ apiKey });
  
  const response = await genAI.models.generateImages({
    model: 'gemini-pro-vision',
    prompt,
    config: { 
      numberOfImages: 1, 
      outputMimeType: 'image/png',
      aspectRatio
    }
  });

  if (response.generatedImages && response.generatedImages.length > 0 && response.generatedImages[0].image?.imageBytes) {
    return {
      imageData: response.generatedImages[0].image.imageBytes
    };
  } else {
    throw new Error('No image data received from Gemini API');
  }
}

async function callStabilityImageAPI(prompt, aspectRatio, apiKey) {
  const response = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      text_prompts: [{ text: prompt }],
      cfg_scale: 7,
      height: aspectRatio === '16:9' ? 576 : 1024,
      width: aspectRatio === '16:9' ? 1024 : 1024,
      samples: 1,
      steps: 30
    })
  });

  if (!response.ok) {
    throw new Error(`Stability API error: ${response.statusText}`);
  }

  const data = await response.json();
  
  if (data.artifacts && data.artifacts.length > 0) {
    return {
      imageData: data.artifacts[0].base64
    };
  } else {
    throw new Error('No image data received from Stability API');
  }
}

module.exports = router; 