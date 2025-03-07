const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Detect the formatter type based on conversation content
function detectFormatter(content) {
    const formatters = loadFormatters();
    const matchingFormatters = [];

    for (const formatter of formatters) {
        if (formatter.isPatternDetected(content)) {
            matchingFormatters.push(formatter);
        }
    }

    return matchingFormatters;
}

// Read file contents
function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.error(`Error reading file ${filePath}:`, err.message);
        throw err;
    }
}

// Find all names in a conversation
function findNames(json, cloneName) {
    let namesFound = [];
    json.forEach(message => {
        if (!namesFound.includes(message.sender)) {
            if (message.sender == cloneName) return;
            namesFound.push(message.sender);
        }
    });
    return namesFound;
}

// Load all formatters dynamically
function loadFormatters() {
    const formattersDir = path.join(__dirname, 'formatters');
    const formatterFiles = fs.readdirSync(formattersDir)
        .filter(file => file.endsWith('.js'));

    return formatterFiles.map(file => {
        const formatterPath = path.join(formattersDir, file);
        return require(formatterPath);
    });
}

// Get list of fine-tuned models from OpenAI
async function getOpenAIFineTunedModels(apiKey) {
    // API key validation is handled separately in the error handling

    const OpenAI = require('openai');
    const openai = new OpenAI({
        apiKey: apiKey
    });

    try {
        const response = await openai.fineTuning.jobs.list({
            limit: 100
        });

        // Filter out only completed jobs
        let completedJobs = response.data.filter(job => job.status === 'succeeded');

        completedJobs = completedJobs.filter(job => job.fine_tuned_model.includes("chatbot-"));


        // Map to get just the fine-tuned model IDs
        const models = completedJobs.map(job => ({
            id: job.fine_tuned_model,
            jobId: job.id,
            createdAt: job.created_at,
        }));

        // Return models along with a hashed user ID derived from the API key
        const userId = hashApiKey(apiKey);

        return {
            models,
            userId
        };
    } catch (error) {
        console.error('Error getting fine-tuned models:', error.message);
        throw error;
    }
}

// Determine the next version number for model naming (chatbot-v1, chatbot-v2, etc.)
async function getNextOpenAIModelName(apiKey) {
    try {
        // Get all existing models
        const { models } = await getOpenAIFineTunedModels(apiKey);

        // Filter models that start with "chatbot-v"
        const versionedModels = models.filter(model =>
            model.id.startsWith("chatbot-v")
        );

        if (versionedModels.length === 0) {
            // If no models with proper versioning found, start with v1
            return "chatbot-v1";
        }

        // Extract version numbers - handle both formats: chatbot-v1 and chatbot-vN
        const versions = versionedModels.map(model => {
            const match = model.id.match(/chatbot-v(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
        });

        // Find the highest version number and increment it
        const nextVersion = Math.max(...versions) + 1;

        return `chatbot-v${nextVersion}`;
    } catch (error) {
        console.error('Error determining next model name:', error.message);
        // Fallback to a random name pattern if the process fails
        const randomString = Math.random().toString(36).substring(7);
        return `chatbot-${randomString}`;
    }
}

// Create a deterministic hash of the API key to use as a user identifier
function hashApiKey(apiKey) {
    return crypto
        .createHash('sha256')
        .update(apiKey)
        .digest('hex');
}

module.exports = {
    detectFormatter,
    readFile,
    findNames,
    loadFormatters,
    getOpenAIFineTunedModels,
    getNextOpenAIModelName,
    hashApiKey
}