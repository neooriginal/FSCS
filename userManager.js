/**
 * User Manager for FSCS
 *
 * This module handles user-specific data using OpenAI API keys as unique identifiers
 * Manages chat histories, file uploads, and fine-tuning jobs for individual users
 */

const dotenv = require('dotenv');
dotenv.config();


const fs = require('fs');
const path = require('path');
const { hashApiKey } = require('./utils');

class UserManager {
    constructor() {
        // Store user data in memory with API key as identifier
        this.users = new Map();

        // Create user directory if it doesn't exist
        this.userBaseDir = path.join(__dirname, 'userData');
        if (!fs.existsSync(this.userBaseDir)) {
            fs.mkdirSync(this.userBaseDir);
        }
    }

    /**
     * Get user data by API key
     * @param {string} apiKey - User's OpenAI API key
     * @returns {Object} User's data
     */
    getUser(apiKey) {
        if (!apiKey) {
            throw new Error('API key is required');
        }

        // Create new user if they don't exist
        if (!this.users.has(apiKey)) {
            this.users.set(apiKey, {
                apiKey: apiKey,
                chatHistory: {},
                activeFinetuningJobs: {},
                lastAccess: Date.now()
            });

            // Create user-specific directory for their uploads
            this.ensureUserDirectory(apiKey);
        }

        // Update last access time
        const userData = this.users.get(apiKey);
        userData.lastAccess = Date.now();

        return userData;
    }

    getUserName(apiKey) {
        const userData = this.getUser(apiKey);
        let userName = userData.apiKey.split("-")[3];

        return userName;
    }

    /**
     * Get user's chat history for a specific model
     * @param {string} apiKey - User's OpenAI API key
     * @param {string} model - Model name
     * @returns {Array} Chat history for the model
     */
    getChatHistory(apiKey, model) {
        const userData = this.getUser(apiKey);

        if (!userData.chatHistory[model]) {
            userData.chatHistory[model] = [];
        }

        return userData.chatHistory[model];
    }

    /**
     * Update user's chat history for a specific model
     * @param {string} apiKey - User's OpenAI API key
     * @param {string} model - Model name
     * @param {Array} history - New chat history
     */
    updateChatHistory(apiKey, model, history) {
        const userData = this.getUser(apiKey);
        userData.chatHistory[model] = history;
    }

    /**
     * Add a message to user's chat history
     * @param {string} apiKey - User's OpenAI API key
     * @param {string} model - Model name
     * @param {Object} message - Message to add
     */
    addMessageToHistory(apiKey, model, message) {
        const history = this.getChatHistory(apiKey, model);
        history.push(message);
    }

    /**
     * Get user's input directory for uploaded files
     * @param {string} apiKey - User's OpenAI API key
     * @returns {string} Path to user's input directory
     */
    getUserInputDir(apiKey) {
        const userHash = this.hashApiKey(apiKey);
        if (process.env.userDataPath.startsWith('/')) {
            return process.env.userDataPath;
        } else {
            return path.join(this.userBaseDir, userHash, process.env.userDataPath);
        }

    }

    /**
     * Store information about a fine-tuning job
     * @param {string} apiKey - User's OpenAI API key
     * @param {string} jobId - Fine-tuning job ID
     * @param {Object} jobDetails - Job details
     */
    storeFineTuningJob(apiKey, jobId, jobDetails = {}) {
        const userData = this.getUser(apiKey);
        userData.activeFinetuningJobs[jobId] = {
            ...jobDetails,
            createdAt: Date.now()
        };
    }

    /**
     * Get user's fine-tuning job
     * @param {string} apiKey - User's OpenAI API key
     * @param {string} jobId - Fine-tuning job ID
     * @returns {Object} Job details
     */
    getFineTuningJob(apiKey, jobId) {
        const userData = this.getUser(apiKey);
        return userData.activeFinetuningJobs[jobId];
    }

    /**
     * Get all fine-tuning jobs for a user
     * @param {string} apiKey - User's OpenAI API key
     * @returns {Object} All job details
     */
    getAllFineTuningJobs(apiKey) {
        const userData = this.getUser(apiKey);
        return userData.activeFinetuningJobs;
    }

    /**
     * Create user-specific directories
     * @param {string} apiKey - User's OpenAI API key
     * @private
     */
    ensureUserDirectory(apiKey) {
        const userHash = this.hashApiKey(apiKey);
        const userDir = path.join(this.userBaseDir, userHash);
        const inputDir = path.join(userDir, 'inputData');

        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        if (!fs.existsSync(inputDir)) {
            fs.mkdirSync(inputDir);
        }
    }

    /**
     * Delete user data directory and remove user from memory
     * @param {string} apiKey - User's OpenAI API key
     * @returns {boolean} True if deletion was successful, false otherwise
     */
    deleteUserData(apiKey) {
        if (!apiKey) {
            throw new Error('API key is required');
        }

        const userHash = this.hashApiKey(apiKey);
        const userDir = path.join(this.userBaseDir, userHash);

        try {
            // Check if directory exists
            if (fs.existsSync(userDir)) {
                // Delete directory and all contents recursively
                fs.rmSync(userDir, { recursive: true, force: true });

                // Remove user from memory cache
                this.users.delete(apiKey);

                console.log(`Deleted user data directory for user ID: ${userHash.substring(0, 8)}`);
                return true;
            } else {
                console.log(`No user directory found for user ID: ${userHash.substring(0, 8)}`);
                return false;
            }
        } catch (error) {
            console.error(`Error deleting user data for user ID ${userHash.substring(0, 8)}:`, error.message);
            return false;
        }
    }

    /**
     * Hash API key to create safe directory name
     * @param {string} apiKey - User's OpenAI API key
     * @returns {string} Hashed key for directory naming
     * @private
     */
    hashApiKey(apiKey) {
        // Use the imported hashApiKey function from utils
        // This ensures consistent hashing across the application
        return hashApiKey(apiKey).substring(0, 16);
    }
}

// Create singleton instance
const userManager = new UserManager();

module.exports = userManager;