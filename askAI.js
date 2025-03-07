const dotenv = require('dotenv');
const OpenAI = require('openai');
dotenv.config();

const doubleCheckModel = "gpt-4o-mini";

// Error messages to be shown to the user
const ERROR_MESSAGES = {
    INVALID_API_KEY: 'Your API key appears to be invalid or has expired. Please enter a valid OpenAI API key.',
    RATE_LIMIT: 'Rate limit exceeded. Please try again later or check your OpenAI account usage limits.',
    MODEL_NOT_FOUND: 'The requested model was not found. It may have been deleted or is not available in your account.',
    SERVER_ERROR: 'An OpenAI server error occurred. Please try again later.'
};

/**
 * Send a user message to an AI model and get a response
 * @param {string} userMessage - The message from the user
 * @param {string} model - The model to use (can be standard or fine-tuned)
 * @param {Array} history - The conversation history
 * @param {string} apiKey - User's OpenAI API key
 * @returns {Promise<string>} The AI's response
 */
async function askAI(userMessage, model, history, apiKey) {
    if (!apiKey) {
        throw new Error(ERROR_MESSAGES.INVALID_API_KEY);
    }

    const openai = new OpenAI({
        apiKey: apiKey
    });


    const systemPrompt = `
You are a clone of the user who is supposed to respond to messages for him. Please respond as the human would and never admit that you are a bot.

Some guidelines:
- Don't make things up. You are just there to respond, not to ask questions (except things like "and you?" or "how are you?")
- IMPORTANT: Make sure your responses make sense and are consistent with the previous message and the user's question.
`;


    try {
        const completion = await openai.chat.completions.create({
            model: model,
            messages: [
                ...history,
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: userMessage,
                },
            ],
            temperature: 0.65,
            top_p: 0.9,
            max_tokens: 500,
        });

        let response = completion.choices[0].message.content;

        // Second request to validate the response
        const checkup_completion = await openai.chat.completions.create({
            model: doubleCheckModel,
            messages: [
                ...history,
                {
                    role: "system", content: systemPrompt +
                        `YOUR TASK: The message the user send is the message the fine-tuned ai responded.
                Due to the fact that the ai is fine-tuned on the gpt-4o model, it might not fit the context. If it does not fit the context, respond with the fixed message in the same kind of speaking style as the ai.

                -----------------------------------
                The user's current message: "${userMessage}"
                
                Check if the AI's response is contextually appropriate.
                If the response is correct and contextually appropriate, respond with "[EMPTY]".
                Otherwise, provide a fixed version that maintains the same tone but is more contextually appropriate.
                AI Response:
                `
                },
                {
                    role: "user",
                    content: response,
                },

            ],
            temperature: 0.65,
            top_p: 0.9,
            max_tokens: 500,
        });

        let checkup_response = checkup_completion.choices[0].message.content;
        if (checkup_response == "[EMPTY]") {
            return response;
        } else {
            return "Reworked: " + checkup_response;
        }
    } catch (error) {
        console.error("Error in AI request:", error);

        // Handle different types of errors
        if (error.status === 401) {
            throw new Error(ERROR_MESSAGES.INVALID_API_KEY);
        } else if (error.status === 429) {
            throw new Error(ERROR_MESSAGES.RATE_LIMIT);
        } else if (error.status === 404) {
            throw new Error(ERROR_MESSAGES.MODEL_NOT_FOUND);
        } else if (error.status >= 500) {
            throw new Error(ERROR_MESSAGES.SERVER_ERROR);
        }

        // For any other error, throw the original message
        throw error;
    }
}

module.exports = { askAI };