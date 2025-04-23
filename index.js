const finetuning = require('./fine_tuning.js');
const dotenv = require('dotenv');
const processData = require('./processData.js');
const fs = require('fs');
const path = require('path');
const userManager = require('./userManager');
const AI = require('./askAI.js');
dotenv.config();
const util = require('./utils.js');
const express = require('express');
const apiRouter = require('./api.js');
const app = express();
const port = 3000;

// Increase JSON payload size limit for file uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files without requiring API key
app.use(express.static('public'));

// Define API routes that need to be protected
const protectedRoutes = [
  '/fine-tuning/checkFiles',
  '/fine-tuning/uploadFiles',
  '/fine-tuning/models',
  '/fine-tuning/askAI',
  '/fine-tuning',
  '/fine-tuning/deleteUserData',
  '/api/'  // New API endpoints are also protected
];

// Error handler middleware for API requests
function handleApiError(res, error, userId, endpoint) {
  console.error(`Error in ${endpoint} for user ${userId || 'unknown'}: ${error.message}`);

  // Check for API key related errors
  if (error.message && error.message.toLowerCase().includes('api key')) {
    return res.status(401).json({
      error: 'API key error',
      message: 'Your API key appears to be invalid or has expired. Please enter a valid OpenAI API key.',
      userId: userId
    });
  }

  // Return a standard error format with user ID included
  return res.status(500).json({
    error: 'Error processing request',
    message: error.message,
    userId: userId
  });
}

// Add route pattern for fine-tuning job status with job_id parameter
app.param('job_id', (req, res, next, id) => {
  if (req.path.startsWith('/fine-tuning/')) {
    // This is a fine-tuning job route that requires authentication
    protectedRoutes.push(`/fine-tuning/${id}`);
  }
  next();
});

// Middleware to extract API key from headers and validate ONLY for API routes
app.use((req, res, next) => {
  // Skip API key validation for non-API routes (like html pages, css, etc)
  if (!protectedRoutes.some(route => req.path.startsWith(route))) {
    return next();
  }

  // Headers are case-insensitive, so we check both variants
  let apiKey = req.headers['x-openai-api-key'] || req.headers['X-OpenAI-API-Key'] || req.headers['x-api-key'];

  if (apiKey) {
    // Clean up API key if it has comma-separated values
    if (apiKey.includes(", ")) apiKey = apiKey.split(", ")[0];
    
    // Trim any whitespace from the API key
    apiKey = apiKey.trim();
    
    // Validate API key format (simple validation)
    if (!apiKey.startsWith('sk-') && !process.env.NODE_ENV === 'development') {
      return res.status(401).json({
        error: 'Invalid API key format',
        message: 'The API key provided has an invalid format.'
      });
    }
    
    // Store in request for use in routes
    req.openaiApiKey = apiKey;
    next();
  } else {
    // Return a user-friendly error for API routes without key
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please enter your OpenAI API key to use this feature'
    });
  }
});

// Add request timeout middleware for API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    // Set a 30-second timeout for all API requests
    req.setTimeout(30000, () => {
      res.status(504).json({
        error: 'Request timeout',
        message: 'The request took too long to process. Please try again.'
      });
    });
  }
  next();
});

util.loadFormatters();

// Mount the API router under /api path
app.use('/api', apiRouter);

// Add a route for API documentation
app.get("/api-docs", (req, res) => {
  res.sendFile(__dirname + '/public/api-docs.html');
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get("/train", (req, res) => {
  res.sendFile(__dirname + '/public/fine-tuning.html');
});

app.get("/chat", (req, res) => {
  res.sendFile(__dirname + '/public/chat.html');
});

app.get("/privacy-policy", (req, res) => {
  res.sendFile(__dirname + '/public/privacy-policy.html');
});

app.get("/formatting-guide", (req, res) => {
  res.sendFile(__dirname + '/public/formatting-guide.html');
});

// Apply basic auth only to non-API routes
if (process.env.betaPassword) {
  app.use((req, res, next) => {
    // Skip basic auth for API routes
    if (req.path.startsWith('/api/') || protectedRoutes.some(route => req.path.startsWith(route))) {
      return next();
    }
    
    // Apply basic auth for all other routes
    const basicAuth = require('express-basic-auth');
    basicAuth({
      users: { 'beta': process.env.betaPassword }, //iknowthisisabeta
      challenge: true,
      realm: 'Beta Testing'
    })(req, res, next);
  });
}

app.get("/fine-tuning/checkFiles", async (req, res) => {
  try {
    // Get user-specific folder
    const apiKey = req.openaiApiKey;
    const userId = util.hashApiKey(apiKey).substring(0, 8);
    const userFolder = userManager.getUserInputDir(apiKey);

    // Ensure user directory exists
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
      return res.json({
        parsedMessages: 0,
        fineTuneSettings: null,
        cost: 0,
        message: "No files uploaded yet.",
        userId: userId
      });
    }

    // Get files in user folder with their existing clone names
    const files = fs.readdirSync(userFolder)
      .filter(file => file.endsWith('.txt'))
      .map(file => {
        try {
          const filePath = path.join(userFolder, file);
          const fileStat = fs.statSync(filePath);
          const fileContent = fs.readFileSync(filePath, 'utf8');

          // Count lines that contain text
          const lines = fileContent.split('\n').filter(line => line.trim().length > 0).length;

          // Extract existing clone name if present
          let existingCloneName = "";
          fileContent.split('\n').forEach(line => {
            if (line.includes("CloneNameTag:")) {
              existingCloneName = line.split(":")[1].trim();
            }
          });

          return {
            name: file,
            size: fileStat.size,
            created: fileStat.birthtime,
            modified: fileStat.mtime,
            lines: lines,
            existingCloneName: existingCloneName
          };
        } catch (error) {
          console.error(`Error reading file ${file}:`, error);
          return null;
        }
      })
      .filter(file => file !== null);

    let response = await finetuning.preParseFiles(userFolder, apiKey);
    // Add files and user identifier to the response
    response.files = files;
    response.userId = userId;
    res.json(response);
  } catch (error) {
    handleApiError(res, error, util.hashApiKey(req.openaiApiKey).substring(0, 8), 'GET /fine-tuning/checkFiles');
  }
});

app.post("/fine-tuning/uploadFiles", async (req, res) => {
  try {
    let files = req.body.files;
    let cloneNames = req.body.cloneNames || {};
    const apiKey = req.openaiApiKey;
    const userId = util.hashApiKey(apiKey).substring(0, 8);

    // Get user-specific folder
    const userFolder = userManager.getUserInputDir(apiKey);

    // Save files to user-specific folder
    for (let file of files) {
      try {
        let filename = '';
        let fileContent = '';

        if (typeof file === 'string' && file.includes(';base64,')) {
          // Handle base64 string format
          filename = `upload_${Date.now()}.txt`;
          let base64Data = file.split(';base64,').pop();
          fileContent = Buffer.from(base64Data, 'base64').toString('utf8');
        } else if (file && typeof file === 'object') {
          // Handle object format
          filename = file.name || `upload_${Date.now()}.txt`;
          let rawContent = file.data || file.content || file;

          // Handle base64 content properly
          if (typeof rawContent === 'string' && rawContent.includes(';base64,')) {
            const base64Data = rawContent.split(';base64,').pop();
            fileContent = Buffer.from(base64Data, 'base64').toString('utf8');
          } else if (typeof rawContent === 'string') {
            // Plain text content
            fileContent = rawContent;
          } else {
            console.error(`Unsupported file content type for user ${userId}:`, typeof rawContent);
            continue;
          }
        } else {
          console.error(`Invalid file format for user ${userId}:`, file);
          continue;
        }

        // Check if file has CloneNameTag and if a clone name is provided in the request
        if (cloneNames[filename] && !fileContent.includes("CloneNameTag:")) {
          // Add CloneNameTag to the beginning of the file
          fileContent = `CloneNameTag: ${cloneNames[filename]}\n${fileContent}`;
        }

        // Write the file with potentially modified content
        fs.writeFileSync(path.join(userFolder, filename), fileContent, 'utf8');

      } catch (fileError) {
        console.error(`Error processing file for user ${userId}:`, fileError.message);
      }
    }
    // Get files in user folder with their existing clone names
    const processedFiles = fs.readdirSync(userFolder)
      .filter(file => file.endsWith('.txt'))
      .map(file => {
        try {
          const filePath = path.join(userFolder, file);
          const fileStat = fs.statSync(filePath);
          const fileContent = fs.readFileSync(filePath, 'utf8');

          // Count lines that contain text
          const lines = fileContent.split('\n').filter(line => line.trim().length > 0).length;

          // Extract existing clone name if present
          let existingCloneName = "";
          fileContent.split('\n').forEach(line => {
            if (line.includes("CloneNameTag:")) {
              existingCloneName = line.split(":")[1].trim();
            }
          });

          return {
            name: file,
            size: fileStat.size,
            created: fileStat.birthtime,
            modified: fileStat.mtime,
            lines: lines,
            existingCloneName: existingCloneName
          };
        } catch (error) {
          console.error(`Error reading file ${file}:`, error);
          return null;
        }
      })
      .filter(file => file !== null);

    let response = await finetuning.preParseFiles(userFolder, apiKey, cloneNames);
    response.files = processedFiles;
    response.userId = userId;
    res.json(response);
  } catch (error) {
    handleApiError(res, error, util.hashApiKey(req.openaiApiKey).substring(0, 8), 'POST /fine-tuning/uploadFiles');
  }
});

app.post('/fine-tuning', async (req, res) => {
  try {
    let finetuningPrompt = req.body.finetuningPrompt;
    let cloneNames = req.body.cloneNames || {};

    const apiKey = req.openaiApiKey;
    const userId = util.hashApiKey(apiKey).substring(0, 8);

    // Get user-specific folder
    const userFolder = userManager.getUserInputDir(apiKey);

    let response = await finetuning.main(finetuningPrompt, userFolder, apiKey, cloneNames);

    res.json({
      id: response,
      userId: userId
    });
  } catch (error) {
    handleApiError(res, error, util.hashApiKey(req.openaiApiKey).substring(0, 8), 'POST /fine-tuning');
  }
});


// Important: More specific routes must come before less specific (parameterized) routes
app.get("/fine-tuning/models", async (req, res) => {
  try {
    const apiKey = req.openaiApiKey;
    const userId = util.hashApiKey(apiKey).substring(0, 8);

    let response = await util.getOpenAIFineTunedModels(apiKey);

    // Add user ID to the response
    const modelsWithUser = response.models.map(model => ({
      ...model,
      userId: userId
    }));

    res.json(modelsWithUser);
  } catch (error) {
    handleApiError(res, error, util.hashApiKey(req.openaiApiKey).substring(0, 8), 'GET /fine-tuning/models');
  }
});

app.get("/fine-tuning/:job_id", async (req, res) => {
  try {
    let job_id = req.params.job_id;
    const apiKey = req.openaiApiKey;
    const userId = util.hashApiKey(apiKey).substring(0, 8);

    // Get job details and update user's job data
    let response = await processData.watchFineTuningJob(job_id, apiKey);

    // Update job status in user manager if it exists
    const existingJob = userManager.getFineTuningJob(apiKey, job_id);
    if (existingJob) {
      userManager.storeFineTuningJob(apiKey, job_id, {
        ...existingJob,
        status: response.statusDetail,
        fineTunedModel: response.name
      });
    }

    // Add user identifier to the response
    response.userId = userId;
    res.json(response);
  } catch (error) {
    handleApiError(res, error, util.hashApiKey(req.openaiApiKey).substring(0, 8), 'GET /fine-tuning/:job_id');
  }
});

app.post("/fine-tuning/askAI", async (req, res) => {
  try {
    let model = req.body.model;
    let userMessage = req.body.userMessage;

    // Get API key from request
    const apiKey = req.openaiApiKey;
    const userId = util.hashApiKey(apiKey).substring(0, 8);

    // Get user-specific chat history
    const history = userManager.getChatHistory(apiKey, model);

    // Call AI with user's history
    let response = await AI.askAI(userMessage, model, history, apiKey);

    // Update user's history with new messages
    userManager.addMessageToHistory(apiKey, model, { role: "user", content: userMessage });
    userManager.addMessageToHistory(apiKey, model, { role: "assistant", content: response });

    // Send response with user id
    res.json({
      response: response,
      userId: userId
    });
  } catch (error) {
    handleApiError(res, error, util.hashApiKey(req.openaiApiKey).substring(0, 8), 'POST /fine-tuning/askAI');
  }
});

// Route to delete user data
app.delete("/fine-tuning/deleteUserData", async (req, res) => {
  try {
    // Get API key from request
    const apiKey = req.openaiApiKey;
    const userId = util.hashApiKey(apiKey).substring(0, 8);

    // Delete user data folder
    const result = userManager.deleteUserData(apiKey);

    // Send response with result
    res.json({
      success: result,
      message: result ? "User data deleted successfully" : "No user data found or error deleting data",
      userId: userId
    });
  } catch (error) {
    handleApiError(res, error, util.hashApiKey(req.openaiApiKey).substring(0, 8), 'DELETE /fine-tuning/deleteUserData');
  }
});

app.listen(port, () => {
  console.log(`App listening on http://localhost:${port}`);
});