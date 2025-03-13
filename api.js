const express = require('express');
const router = express.Router();
const AI = require('./askAI.js');
const util = require('./utils.js');
const userManager = require('./userManager');

// Error handler middleware for API requests
function handleApiError(res, error, userId, endpoint) {
  console.error(`Error in ${endpoint} for user ${userId || 'unknown'}: ${error.message}`);

  // Check for API key related errors
  if (error.message && error.message.toLowerCase().includes('api key')) {
    return res.status(401).json({
      status: 'error',
      code: 'invalid_api_key',
      message: 'Your API key appears to be invalid or has expired. Please provide a valid OpenAI API key.',
    });
  }

  // Return a standard error format with status code
  return res.status(500).json({
    status: 'error',
    code: 'server_error',
    message: error.message,
  });
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
    const apiKey = req.openaiApiKey;
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
    const apiKey = req.openaiApiKey;
    const userId = util.hashApiKey(apiKey).substring(0, 8);

    // Get list of fine-tuned models
    const fineTunedModelsResponse = await util.getOpenAIFineTunedModels(apiKey);

    // Add default OpenAI models
    const models = [
      ...fineTunedModelsResponse.models,
      {
        id: "gpt-4o",
        name: "GPT-4o",
        type: "base",
        description: "OpenAI's most advanced model"
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        type: "base",
        description: "More efficient version of GPT-4o"
      }
    ];

    res.json({
      status: 'success',
      models: models
    });
  } catch (error) {
    handleApiError(res, error, util.hashApiKey(req.openaiApiKey).substring(0, 8), 'GET /api/models');
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
    const apiKey = req.openaiApiKey;
    const userId = util.hashApiKey(apiKey).substring(0, 8);
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        status: 'error',
        code: 'missing_message',
        message: 'Message is required'
      });
    }

    // Determine which model to use (provided or get the latest)
    let modelToUse = req.body.model;

    if (!modelToUse) {
      // Get models and find the latest one
      const { models } = await util.getOpenAIFineTunedModels(apiKey);

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

    // Call AI with user's history
    const response = await AI.askAI(message, modelToUse, history, apiKey);

    // Update user's history with new messages
    userManager.addMessageToHistory(apiKey, modelToUse, { role: "user", content: message });
    userManager.addMessageToHistory(apiKey, modelToUse, { role: "assistant", content: response });

    res.json({
      status: 'success',
      response: response,
      model: modelToUse
    });
  } catch (error) {
    handleApiError(res, error, util.hashApiKey(req.openaiApiKey).substring(0, 8), 'POST /api/chat');
  }
});

module.exports = router;