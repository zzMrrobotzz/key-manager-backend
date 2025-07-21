const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/adminAuth');
const rateLimit = require('express-rate-limit');

// Import logging models (create simplified versions if they don't exist)
let ApiRequestLog, ApiProvider;
try {
  ApiRequestLog = require('../models/ApiRequestLog');
  ApiProvider = require('../models/ApiProvider');
} catch (err) {
  console.log('⚠️ Logging models not found, statistics will be disabled');
}

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
router.post('/generate', aiRequestLimiter, async (req, res) => {
  try {
    const { prompt, systemInstruction, provider, model, useGoogleSearch, options } = req.body;
    const userId = req.headers.authorization?.split(' ')[1]; // Lấy user key từ authorization header

    // Validate input
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authorization header is required'
      });
    }

    if (!prompt || !provider) {
      return res.status(400).json({
        success: false,
        message: 'Prompt and provider are required'
      });
    }

    // Kiểm tra provider có key hợp lệ không (sử dụng database thay vì file)
    if (!ApiProvider) {
      console.log('❌ ApiProvider model not available');
      return res.status(500).json({
        success: false,
        message: 'Database models not available'
      });
    }
    console.log('✅ ApiProvider model is available');

    console.log(`🔍 Searching for provider: ${provider}`);
    const providerRecord = await ApiProvider.findOne({ name: { $regex: new RegExp(`^${provider}$`, 'i') } });
    console.log(`📋 Found provider:`, providerRecord ? {name: providerRecord.name, keyCount: providerRecord.apiKeys?.length} : 'null');
    
    if (!providerRecord || !providerRecord.apiKeys || providerRecord.apiKeys.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Provider ${provider} is not available or has no API keys`
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

    // Lấy API key từ database (sử dụng key đầu tiên)
    const apiKey = providerRecord.apiKeys[0];

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

      // Log to database for statistics
      try {
        await logApiRequest({
          provider,
          userId,
          promptLength: prompt.length,
          responseLength: result.text ? result.text.length : 0,
          tokenUsage: result.usage || {},
          success: true,
          retries: 0,
          requestType: 'text'
        });
      } catch (logError) {
        console.error('Error logging request:', logError);
        // Don't fail the request if logging fails
      }

      res.json({
        success: true,
        text: result.text,
        usage: result.usage || null
      });

    } catch (aiError) {
      console.error(`AI API error - Provider: ${provider}, Error:`, aiError);
      
      // ✅ AUTOMATIC FALLBACK: If Gemini fails with quota/rate limit, try DeepSeek
      const errorMsg = aiError.message.toLowerCase();
      const isQuotaError = errorMsg.includes('429') || 
                          errorMsg.includes('too many requests') || 
                          errorMsg.includes('quota') || 
                          errorMsg.includes('rate limit');
      
      if (provider.toLowerCase() === 'gemini' && isQuotaError) {
        console.log('🔄 Gemini quota exceeded, attempting DeepSeek fallback...');
        
        try {
          // Check if DeepSeek is available
          const deepseekProvider = await ApiProvider.findOne({ name: { $regex: new RegExp('^deepseek$', 'i') } });
          if (deepseekProvider && deepseekProvider.apiKeys && deepseekProvider.apiKeys.length > 0) {
            const deepseekKey = deepseekProvider.apiKeys[0];
            console.log('🚀 Using DeepSeek as fallback provider');
            
            const fallbackResult = await callDeepSeekAPI(prompt, systemInstruction, deepseekKey, model, options);
            
            // Log successful fallback
            try {
              await logApiRequest({
                provider: 'deepseek-fallback',
                userId,
                promptLength: prompt.length,
                responseLength: fallbackResult.text ? fallbackResult.text.length : 0,
                tokenUsage: fallbackResult.usage || {},
                success: true,
                retries: 1,
                requestType: 'text'
              });
            } catch (logError) {
              console.error('Error logging fallback request:', logError);
            }
            
            return res.json({
              success: true,
              text: fallbackResult.text,
              usage: fallbackResult.usage || null,
              fallback: 'deepseek' // Indicate this was a fallback
            });
          }
        } catch (fallbackError) {
          console.error('❌ DeepSeek fallback also failed:', fallbackError);
          // Continue to log original error and respond with failure
        }
      }
      
      // Log failed request to database
      try {
        await logApiRequest({
          provider,
          userId,
          promptLength: prompt.length,
          responseLength: 0,
          tokenUsage: {},
          success: false,
          error: aiError.message,
          retries: 0,
          requestType: 'text'
        });
      } catch (logError) {
        console.error('Error logging failed request:', logError);
      }
      
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
router.post('/generate-image', aiRequestLimiter, async (req, res) => {
  try {
    const { prompt, aspectRatio, provider } = req.body;
    const userId = req.headers.authorization?.split(' ')[1]; // Lấy user key từ authorization header

    // Validate input
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authorization header is required'
      });
    }

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

    // Kiểm tra provider có key hợp lệ không (sử dụng database thay vì file)
    if (!ApiProvider) {
      console.log('❌ ApiProvider model not available');
      return res.status(500).json({
        success: false,
        message: 'Database models not available'
      });
    }
    console.log('✅ ApiProvider model is available');

    console.log(`🔍 Searching for provider: ${provider}`);
    const providerRecord = await ApiProvider.findOne({ name: { $regex: new RegExp(`^${provider}$`, 'i') } });
    console.log(`📋 Found provider:`, providerRecord ? {name: providerRecord.name, keyCount: providerRecord.apiKeys?.length} : 'null');
    
    if (!providerRecord || !providerRecord.apiKeys || providerRecord.apiKeys.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Provider ${provider} is not available or has no API keys`
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

    // Lấy API key từ database (sử dụng key đầu tiên)
    const apiKey = providerRecord.apiKeys[0];

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
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // ✅ Fix: Sử dụng Gemini 1.5 Flash stable (tương tự index.js)
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: {
      maxOutputTokens: 32768,
      temperature: 0.7,
      topP: 0.8,
      topK: 40
    }
  });

  // ✅ Fix: Sử dụng generateContent API như trong index.js
  const result = await model.generateContent(prompt);
  
  let responseText = result.response.text();
  
  // ✅ Fix: Xử lý JSON parsing như frontend nếu cần
  if (options && options.useJsonOutput) {
    let jsonStr = responseText.trim();
    const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
    const match = jsonStr.match(fenceRegex);
    if (match && match[2]) {
      jsonStr = match[2].trim();
    }
    responseText = jsonStr;
  }
  
  return {
    text: responseText,
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
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // ✅ Fix: Sử dụng model mới cho image generation
  const MODEL_IMAGE = "gemini-ultra";
  
  const response = await genAI.models.generateImages({
    model: MODEL_IMAGE,
    prompt: prompt, // Use the direct prompt from the user
    config: { 
      numberOfImages: 1, 
      outputMimeType: 'image/png',
      aspectRatio: aspectRatio // Pass aspectRatio directly in config
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

// Helper function to log API requests (optional if models exist)
async function logApiRequest(logData) {
  if (!ApiRequestLog || !ApiProvider) return; // Skip if models not available
  
  try {
    const requestLog = new ApiRequestLog({
      provider: logData.provider,
      userId: logData.userId,
      promptLength: logData.promptLength || 0,
      responseLength: logData.responseLength || 0,
      tokenUsage: {
        promptTokens: logData.tokenUsage?.promptTokens || 0,
        completionTokens: logData.tokenUsage?.completionTokens || 0,
        totalTokens: logData.tokenUsage?.totalTokens || 0
      },
      success: logData.success,
      error: logData.error || null,
      retries: logData.retries || 0,
      requestType: logData.requestType || 'text'
    });

    await requestLog.save();

    // Also update provider statistics
    if (logData.success) {
      await ApiProvider.findOneAndUpdate(
        { name: logData.provider },
        { 
          $inc: { totalRequests: 1 },
          lastChecked: new Date()
        },
        { upsert: true }
      );
    }
  } catch (error) {
    console.error('Error logging API request:', error);
    // Don't fail the main request if logging fails
  }
}

module.exports = router; 