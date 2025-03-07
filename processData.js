
const OPENAI_MODEL_USED = "gpt-4o-mini-2024-07-18"; // Model used for fine-tuning
const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');

async function processToJSON(formattedJson, finetuningPrompt, cloneName) {
    // If multiple messages are sent by the same person, we need to merge them
    let mergedMessages = [];
    let currentSender = "";
    let currentMessage = "";

    // Add last message if it's not merged yet
    formattedJson.forEach(message => {
        if (message.sender == currentSender) {
            currentMessage += "\n" + message.message;
        } else {
            if (currentSender != "") {
                mergedMessages.push({ sender: currentSender, message: currentMessage });
            }
            currentSender = message.sender;
            currentMessage = message.message;
        }
    });

    // Add the final message that hasn't been added in the loop
    if (currentSender !== "") {
        mergedMessages.push({ sender: currentSender, message: currentMessage });
    }

    // If the first message is from the clone/bot, remove it since we need user->assistant pattern
    if (mergedMessages.length > 0 && mergedMessages[0].sender == cloneName) {
        mergedMessages.shift();
    }

    let lasti = 0;
    let finalizedJSON = [];

    // Ensure we have an even number of messages for proper pairing
    const messageCount = Math.floor(mergedMessages.length / 2) * 2;

    for (let i = 0; i < (messageCount / 2); i++) {
        const userMessageIdx = lasti;
        const assistantMessageIdx = lasti + 1;

        // Verify we have valid indices before accessing
        if (assistantMessageIdx < mergedMessages.length) {
            const userMessage = mergedMessages[userMessageIdx];
            const assistantMessage = mergedMessages[assistantMessageIdx];

            // Make sure the content is not empty
            if (userMessage.message && assistantMessage.message) {
                finalizedJSON.push({
                    "messages": [
                        { "role": "system", "content": finetuningPrompt },
                        { "role": "user", "content": userMessage.message },
                        { "role": "assistant", "content": assistantMessage.message }
                    ]
                });
            }
            lasti += 2;
        }
    }


    // Validate the final JSON structure
    if (finalizedJSON.length === 0) {
        console.warn('Warning: No valid message pairs found for fine-tuning');
    }

    return finalizedJSON;
}


async function uploadFileToOpenAI(json, apikey) {
    const form = new FormData();

    // Convert array of JSON objects to JSONL format (each JSON object on a new line)
    let jsonlContent = '';
    try {
        jsonlContent = json.flat().map(obj => JSON.stringify(obj)).join('\n');
    } catch (err) {
        console.error('Error creating JSONL content:', err.message);
        console.error('JSON structure:', JSON.stringify(json).substring(0, 200) + '...');
        throw new Error('Failed to create JSONL format: ' + err.message);
    }

    const jsonlBuffer = Buffer.from(jsonlContent);
    const jsonlStream = Readable.from(jsonlBuffer);

    // Append the file correctly
    form.append('file', jsonlStream, { filename: 'data.jsonl', contentType: 'application/json' });
    form.append('purpose', 'fine-tune');
    try {
        const response = await axios.post('https://api.openai.com/v1/files', form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${apikey}`
            }
        });

        return response.data.id;
    } catch (error) {
        console.error('Error uploading file to OpenAI:');
        if (error.response?.status === 401) {
            console.error('Authentication error: Invalid API key or unauthorized access.');
            throw new Error('Authentication failed: Please check that your OpenAI API key is valid and has not expired.');
        } else if (error.response?.status === 400 &&
            (error.response?.data?.error?.message?.includes('JSONL') ||
                error.response?.data?.error?.message?.includes('format'))) {
            console.error('JSONL Format Error:', error.response.data.error.message);
            console.error('Please ensure each line is a valid JSON object and the overall format is JSONL');

            // Log sample of the JSONL content for debugging
            const sampleContent = jsonlContent.split('\n').slice(0, 2).join('\n');
            console.error('Sample content (first 2 lines):', sampleContent);

            throw new Error(`JSONL Format Error: ${error.response.data.error.message}`);
        } else if (error.response?.data?.error) {
            console.error('API Error:', error.response.data.error);
            throw new Error(`OpenAI API Error: ${error.response.data.error.message}`);
        } else {
            console.error('Error details:', error.message);
            throw error;
        }
    }
}




async function createFineTuningJob(fileId, openaikey, modelName, params) {
    try {
        const payload = {
            training_file: fileId,
            model: OPENAI_MODEL_USED,
        };

        // Add optional parameters only if they're defined
        if (modelName) {
            payload.suffix = modelName;
            console.log(`Using model suffix: ${modelName}`);
        }

        // Set up hyperparameters - these are fixed values optimized for large datasets
        payload.hyperparameters = params;
        console.log('Using hyperparameters:', JSON.stringify(params));

        const response = await axios.post('https://api.openai.com/v1/fine_tuning/jobs', payload, {
            headers: {
                'Authorization': `Bearer ${openaikey}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.id;
    } catch (error) {
        console.error('Error creating fine-tuning job:');
        if (error.response?.status === 401) {
            console.error('Authentication error: Invalid API key or unauthorized access.');
            throw new Error('Authentication failed: Please check that your OpenAI API key is valid and has not expired.');
        } else if (error.response?.data?.error) {
            console.error('API Error:', error.response.data.error);
            throw new Error(`OpenAI API Error: ${error.response.data.error.message}`);
        } else {
            console.error('Error details:', error.message);
            throw error;
        }
    }
}

async function watchFineTuningJob(job_id, openaikey) {
    //watch fine tuning and return true of false if it is done
    try {
        const response = await axios.get(`https://api.openai.com/v1/fine_tuning/jobs/${job_id}`, {
            headers: {
                'Authorization': `Bearer ${openaikey}`
            }
        });

        const status = response.data.status;

        return {
            status: status === 'succeeded',
            statusDetail: status,
            id: response.data.id || null,
            name: response.data.fine_tuned_model || response.data.name || null
        };

    } catch (error) {
        console.error('Error watching fine-tuning job:');
        if (error.response?.status === 401) {
            console.error('Authentication error: Invalid API key or unauthorized access.');
            throw new Error('Authentication failed: Please check that your OpenAI API key is valid and has not expired.');
        } else if (error.response?.data?.error) {
            console.error('API Error:', error.response.data.error);
            throw new Error(`OpenAI API Error: ${error.response.data.error.message}`);
        } else {
            console.error('Error details:', error.message);
            throw error;
        }
    }

}

module.exports = {
    processToJSON,
    uploadFileToOpenAI,
    createFineTuningJob,
    watchFineTuningJob
}