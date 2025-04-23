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
 * @apiParam {Boolean} [isGroupMessage] Whether the message is from a group chat
 * @apiSuccess {String} response AI's response message
 * @apiSuccess {String} model Model used for generating the response
 */
router.post('/chat', async (req, res) => {
  try {
    const apiKey = validateApiKey(req, res);
    if (!apiKey) return;
    
    const userId = util.hashApiKey(apiKey).substring(0, 8);
    const { message } = req.body;
    const isGroupMessage = req.body.isGroupMessage === true;

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

    // Create appropriate system prompt based on whether it's a group message
    let systemPrompt;
    
    if (isGroupMessage) {
      systemPrompt = `You are a human participating in a group chat. Here are essential guidelines:

1. DON'T RESPOND AT ALL to messages that are not clearly directed at you.
2. DON'T make up ANY information whatsoever, especially:
   - Appointments, meetings, events, or plans
   - Personal details, preferences, or experiences
   - Locations, times, or dates
   - Medical, financial, or professional information
3. IF UNSURE, REMAIN SILENT - it's better to not respond than to make things up.
4. Only respond to direct questions or comments that contain factual information you're certain about.
5. For casual conversation, keep responses extremely minimal or don't respond at all.
6. NEVER schedule appointments, create plans, or make commitments on behalf of the user.
7. Respond ONLY with factual information, NEVER with made-up details.
8. NEVER use AI-like phrases or acknowledge being an AI.

Respond as a human would, with natural, casual language. If you can't provide a factual, non-fabricated response, DO NOT RESPOND.`;
    } else {
      systemPrompt = `You are a human having a conversation. Here are essential guidelines:

1. DON'T make up ANY information whatsoever, especially:
   - Appointments, meetings, events, or plans
   - Personal details, preferences, or experiences
   - Locations, times, or dates
   - Medical, financial, or professional information
2. IF UNSURE, KEEP YOUR RESPONSE MINIMAL - it's better to respond with "I'm not sure" than to make things up.
3. For casual conversation, keep responses minimal unless you're certain about the subject.
4. NEVER schedule appointments, create plans, or make commitments on behalf of the user.
5. Respond ONLY with factual information, NEVER with made-up details.
6. NEVER use AI-like phrases or acknowledge being an AI.

Respond as a human would, with natural, casual language. If you can't provide a factual, non-fabricated response, respond with a very brief, non-committal answer or say you're not sure.`;
    }

    // Call AI with user's history and appropriate system prompt, with retry logic
    let response = await withRetry(() => 
      AI.askAIWithSystemPrompt(message, modelToUse, history, apiKey, systemPrompt)
    );

    // Validate response for fabricated content and potential hallucinations
    const fabricationPatterns = [
      // Appointment patterns
      /\b(schedule|set up|arrange|book|make)\s+(an|a)?\s*(appointment|meeting|reservation|booking|event)\b/i,
      /\b(on|at|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      /\b\d{1,2}[:.]\d{2}\s*(am|pm)\b/i,
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(st|nd|rd|th)?\b/i,
      
      // Personal details patterns
      /\b(my|your)\s+(email|phone|address|number|contact)\b/i,
      /\b(I|we)\s+(live|stay|reside|am located)\s+in\b/i,
      /\b(I|we)\s+(prefer|like|enjoy|love|hate|dislike)\b/i,
      /\b(I|we)\s+(have been|went|traveled|visited)\b/i,
      
      // Planning patterns
      /\b(let's|we can|we should|we will|I will|I can)\s+(meet|talk|discuss|catch up|connect)\b/i,
      /\b(would|could)\s+(you|we)\s+(like to|want to|be able to)\s+(meet|talk|discuss|catch up|connect)\b/i
    ];

    const hasFabrication = fabricationPatterns.some(pattern => pattern.test(response));
    
    // If a fabrication is detected and message is casual, send empty or minimal response
    if (hasFabrication) {
      const casualPatterns = [
        /\b(hi|hello|hey|what's up|wassup|sup|how are you|how's it going)\b/i,
        /\b(nice|good)\s+(day|morning|afternoon|evening)\b/i,
        /\b(talk|speak|chat)\s+(later|soon)\b/i,
        /\b(what's new|what are you up to|what are you doing)\b/i
      ];
      
      const isCasualConversation = casualPatterns.some(pattern => pattern.test(message));
      
      if (isCasualConversation || isGroupMessage) {
        // For group messages or casual conversation with fabrication, return empty response
        return res.json({
          status: 'success',
          response: '',
          model: modelToUse,
          note: 'Message was filtered due to potential fabrication'
        });
      } else {
        // For non-casual messages, regenerate with a stronger conservative prompt
        const strictPrompt = `You are having a conversation. EXTREMELY IMPORTANT RULES:

1. DO NOT make up ANY information or details - PERIOD.
2. DO NOT mention appointments, meetings, events, or arrangements.
3. DO NOT suggest times, dates, or locations for anything.
4. DO NOT create plans or commitments of any kind.
5. DO NOT pretend to know personal details, preferences, or experiences.
6. Keep your response EXTREMELY brief and factual.
7. If you're unsure, simply say "I'm not sure" or "I don't know" - NOTHING more.
8. NEVER use AI-like phrases or acknowledge being an AI.

This is a ZERO TOLERANCE policy for made-up information. When in doubt, say less or nothing.`;

        response = await withRetry(() => 
          AI.askAIWithSystemPrompt(message, modelToUse, history, apiKey, strictPrompt)
        );
        
        // Check if the regenerated response still has fabrication
        const stillHasFabrication = fabricationPatterns.some(pattern => pattern.test(response));
        
        if (stillHasFabrication) {
          // If still problematic, return a safe minimal response
          response = "I'm not sure about that.";
        }
      }
    }

    // Additional validation for AI-like patterns
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
      
      // Check for fabrication again
      const newHasFabrication = fabricationPatterns.some(pattern => pattern.test(response));
      if (newHasFabrication && (isCasualConversation || isGroupMessage)) {
        // For casual conversation with fabrication, return empty response
        return res.json({
          status: 'success',
          response: '',
          model: modelToUse,
          note: 'Message was filtered due to potential fabrication after regeneration'
        });
      }
    }

    // Only update history if we're actually returning a response
    if (response && response.trim() !== '') {
      userManager.addMessageToHistory(apiKey, modelToUse, { role: "user", content: message });
      userManager.addMessageToHistory(apiKey, modelToUse, { role: "assistant", content: response });
    }

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