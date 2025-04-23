const express = require('express');
const router = express.Router();
const AI = require('./askAI.js');
const util = require('./utils.js');
const userManager = require('./userManager');

// Enhanced error handler middleware for API requests
function handleApiError(res, error, userId, endpoint) {
  console.error(`Error in ${endpoint} for user ${userId || 'unknown'}: ${error.message}`);
  console.error(error.stack); // Log stack trace for better debugging

  // Check for API key related errors
  if (error.message && error.message.toLowerCase().includes('api key')) {
    return res.status(401).json({
      status: 'error',
      code: 'invalid_api_key',
      message: 'Your API key appears to be invalid or has expired. Please provide a valid OpenAI API key.',
    });
  }

  // Check for rate limit errors
  if (error.message && error.message.toLowerCase().includes('rate limit')) {
    return res.status(429).json({
      status: 'error',
      code: 'rate_limit_exceeded',
      message: 'Rate limit exceeded. Please try again later.',
    });
  }

  // Check for timeout errors
  if (error.message && (error.message.includes('timeout') || error.message.includes('ETIMEDOUT'))) {
    return res.status(504).json({
      status: 'error',
      code: 'request_timeout',
      message: 'Request timed out. Please try again.',
    });
  }

  // Return a standard error format with status code
  return res.status(500).json({
    status: 'error',
    code: 'server_error',
    message: error.message,
  });
}

// Helper function to validate API key
function validateApiKey(req, res) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    res.status(401).json({
      status: 'error',
      code: 'missing_api_key',
      message: 'API key is required in X-API-Key header'
    });
    return null;
  }
  
  return apiKey;
}

// Add retry logic for OpenAI API calls
async function withRetry(fn, maxRetries = 3, delay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Only retry on network errors, timeouts, or rate limits
      const shouldRetry = 
        error.message.includes('network') || 
        error.message.includes('timeout') || 
        error.message.includes('rate limit') ||
        error.message.includes('ETIMEDOUT') ||
        error.code === 'ECONNRESET';
      
      if (!shouldRetry) throw error;
      
      // Wait before retrying (with exponential backoff)
      const retryDelay = delay * Math.pow(2, attempt);
      console.log(`Retrying API call (attempt ${attempt + 1}/${maxRetries}) after ${retryDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  throw lastError;
}

/**
 * @api {get} /api/status Check API Status
 * @apiName GetStatus
 * @apiGroup API
 * @apiDescription Check if the API is online and verify API key validity
 * @apiHeader {String} X-API-Key OpenAI API key for authentication
 * @apiSuccess {String} status Status of the API (online)
 * @apiSuccess {String} message Success message
 * @apiSuccess {String} version API version
 */
router.get('/status', (req, res) => {
  try {
    const apiKey = validateApiKey(req, res);
    if (!apiKey) return;
    
    const userId = util.hashApiKey(apiKey).substring(0, 8);

    res.json({
      status: 'online',
      message: 'API is functioning correctly',
      version: '1.0.0',
      authenticated: true,
      user_id: userId
    });
  } catch (error) {
    handleApiError(res, error, null, 'GET /api/status');
  }
});

/**
 * @api {get} /api/models List Available AI Models
 * @apiName GetModels
 * @apiGroup AI
 * @apiDescription Get a list of available AI models (including fine-tuned ones)
 * @apiHeader {String} X-API-Key OpenAI API key for authentication
 * @apiSuccess {Array} models List of available models
 */
router.get('/models', async (req, res) => {
  try {
    const apiKey = validateApiKey(req, res);
    if (!apiKey) return;
    
    const userId = util.hashApiKey(apiKey).substring(0, 8);

    // Get list of fine-tuned models with retry logic
    const fineTunedModelsResponse = await withRetry(() => 
      util.getOpenAIFineTunedModels(apiKey)
    );

    // Add default OpenAI models
    const models = [
      ...fineTunedModelsResponse.models,
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
      { id: "gpt-4", name: "GPT-4" },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    ];

    res.json({
      status: 'success',
      models: models
    });
  } catch (error) {
    const apiKey = req.headers['x-api-key'];
    const userId = apiKey ? util.hashApiKey(apiKey).substring(0, 8) : null;
    handleApiError(res, error, userId, 'GET /api/models');
  }
});

/**
 * @api {post} /api/chat Chat with AI
 * @apiName ChatWithAI
 * @apiGroup AI
 * @apiDescription Send a message to an AI model and get a response (uses latest model by default)
 * @apiHeader {String} X-API-Key OpenAI API key for authentication
 * @apiParam {String} message User's message to send to the AI
 * @apiParam {String} [model] Optional model ID (if not provided, uses the latest available model)
 * @apiSuccess {String} response AI's response message
 * @apiSuccess {String} model Model used for generating the response
 */
router.post('/chat', async (req, res) => {
  try {
    const apiKey = validateApiKey(req, res);
    if (!apiKey) return;
    
    const userId = util.hashApiKey(apiKey).substring(0, 8);
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        status: 'error',
        code: 'missing_message',
        message: 'Message is required'
      });
    }

    if (typeof message !== 'string') {
      return res.status(400).json({
        status: 'error',
        code: 'invalid_message_format',
        message: 'Message must be a string'
      });
    }

    // Set a reasonable message length limit
    if (message.length > 10000) {
      return res.status(400).json({
        status: 'error',
        code: 'message_too_long',
        message: 'Message exceeds maximum length (10000 characters)'
      });
    }

    // Determine which model to use (provided or get the latest)
    let modelToUse = req.body.model;

    if (!modelToUse) {
      // Get models and find the latest one
      const { models } = await withRetry(() => 
        util.getOpenAIFineTunedModels(apiKey)
      );

      if (models && models.length > 0) {
        // Sort by creation date (newest first)
        models.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        modelToUse = models[0].id;
      } else {
        // Fallback to default model
        modelToUse = "gpt-4o";
      }
    }

    // Get user-specific chat history for this model
    const history = userManager.getChatHistory(apiKey, modelToUse);

    // Call AI with user's history, with retry logic
    let response = await withRetry(() => 
      AI.askAI(message, modelToUse, history, apiKey)
    );

    // Extra validation to ensure no generic AI-like responses
    const aiPatterns = [
      "as an ai", "i'm an ai", "ai assistant", "artificial intelligence",
      "i don't have personal", "i don't have the ability",
      "i'm not able to", "i cannot access", "i don't have access",
      "i'd be happy to help", "i'd be happy to assist",
      "is there anything else", "how can i assist", "how else can i help",
      "my training", "my programming", "my knowledge", "my capabilities",
      "i'm designed to", "i was trained to", "i am not able to"
    ];

    // Check if response contains AI patterns
    const responseLower = response.toLowerCase();
    const hasAIPattern = aiPatterns.some(pattern => responseLower.includes(pattern));

    if (hasAIPattern) {
      // Regenerate response via stronger enforcement
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey });

      const strictSystemPrompt = `You MUST speak as the actual human user would speak. 
NEVER use AI-like phrases or tones.
NEVER say "As an AI" or acknowledge being an AI.
NEVER apologize for limitations.
NEVER use customer service phrases like "How can I help you" or "I'd be happy to assist".
Respond EXACTLY as the human user would with their exact style, tone, and attitude.
Your response must be 100% indistinguishable from a natural human conversation.`;

      // Regenerate with retry logic
      const strictResponse = await withRetry(() =>
        openai.chat.completions.create({
          model: modelToUse,
          messages: [
            { role: "system", content: strictSystemPrompt },
            ...history,
            { role: "user", content: message }
          ],
          temperature: 0.75,
          top_p: 0.95,
          max_tokens: 500,
        })
      );

      response = strictResponse.choices[0].message.content;
    }

    // Update user's history with new messages
    userManager.addMessageToHistory(apiKey, modelToUse, { role: "user", content: message });
    userManager.addMessageToHistory(apiKey, modelToUse, { role: "assistant", content: response });

    res.json({
      status: 'success',
      response: response,
      model: modelToUse
    });
  } catch (error) {
    const apiKey = req.headers['x-api-key'];
    const userId = apiKey ? util.hashApiKey(apiKey).substring(0, 8) : null;
    handleApiError(res, error, userId, 'POST /api/chat');
  }
});

module.exports = router;