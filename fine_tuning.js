const fs = require('fs');
const path = require('path');
const utils = require('./utils');
const processData = require('./processData');
const userManager = require('./userManager');
const { calculateFineTuneSettings } = require('./math/calculateSettings');
const { calculateCost } = require('./math/calculateCost');
const dotenv = require('dotenv');
const { name } = require('./formatters/discord');
dotenv.config();

async function parseMessages(folder, finetuningPrompt, apiKey, cloneNames = {}) {
    try {
        //read dir inputData and all txt files
        let filesDir = fs.readdirSync(folder);
        let files = filesDir.filter(file => file.endsWith('.txt'));
        if (!files || files.length === 0) return { error: "No .txt files found in folder" };

        let totalLines = 0;
        let parsedMessages = [];

        for (let file of files) {
            try {
                let fileContent = utils.readFile(path.join(folder, file));

                if (typeof fileContent !== 'string') {
                    console.error(`File content for ${file} is not a string:`, typeof fileContent);
                    // Remove invalid file from directory
                    try {
                        fs.unlinkSync(path.join(folder, file));
                        console.log(`Removed invalid file ${file} (not a string)`);
                    } catch (unlinkError) {
                        console.error(`Failed to remove invalid file ${file}:`, unlinkError.message);
                    }
                    continue;
                }

                // Check if clone name is provided in the UI
                let cloneName = cloneNames[file] || "";

                // If not provided in UI, try to find it in the file (backward compatibility)
                if (!cloneName) {
                    let nameGetterSplit = fileContent.split('\n');
                    nameGetterSplit.forEach((line, index) => {
                        if (line && line !== "" && line.length > 5) totalLines++;
                        if (line.includes("CloneNameTag:")) {
                            cloneName = line.split(":")[1].trim();
                            //remove the line from the fileContent
                            nameGetterSplit.splice(index, 1);
                            fileContent = nameGetterSplit.join('\n');
                        }
                    });
                } else {
                    // Count lines for the file with UI-provided clone name
                    let lines = fileContent.split('\n');
                    lines.forEach(line => {
                        if (line && line !== "" && line.length > 5) totalLines++;
                    });
                }

                // If no clone name found, log warning but use a default value
                if (cloneName === "") {
                    console.warn(`No CloneNameTag found in file: ${file}. This may affect training quality.`);
                    cloneName = "AI Assistant"; // Default fallback name
                }

                let formatters = utils.detectFormatter(fileContent);
                if (formatters.length === 0) {
                    console.log(`No formatter detected in file: ${file}`);
                    // Remove invalid file from directory
                    try {
                        fs.unlinkSync(path.join(folder, file));
                        console.log(`Removed invalid file: ${file}`);
                    } catch (unlinkError) {
                        console.error(`Failed to remove invalid file ${file}:`, unlinkError.message);
                    }
                    continue;
                }

                if (formatters.length > 1) {
                    console.log(`Multiple formatters detected. Using first one in file: ${file}`);
                }

                let formatter = formatters[0];

                // Use the parseChat function to handle multiple messages
                let parsedMessagesLocal = formatter.parseChat(fileContent);
                if (!parsedMessagesLocal || parsedMessagesLocal.length === 0) {
                    console.error(`No messages found in file: ${file}`);
                    // Remove invalid file from directory
                    try {
                        fs.unlinkSync(path.join(folder, file));
                        console.log(`Removed invalid file: ${file}`);
                    } catch (unlinkError) {
                        console.error(`Failed to remove invalid file ${file}:`, unlinkError.message);
                    }
                    continue;
                }

                let namesFound = utils.findNames(parsedMessagesLocal);
                if (namesFound.length === 0) {
                    console.error(`No names found in file: ${file}`);
                    // Remove invalid file from directory
                    try {
                        fs.unlinkSync(path.join(folder, file));
                        console.log(`Removed invalid file: ${file}`);
                    } catch (unlinkError) {
                        console.error(`Failed to remove invalid file ${file}:`, unlinkError.message);
                    }
                    continue;
                } else {
                    namesFound = namesFound.filter(name => name !== cloneName);
                }


                if (namesFound.length > 1) {
                    console.log(`Multiple names found in file: ${file}. Using all messages.`);
                }

                let processedJson = await processData.processToJSON(parsedMessagesLocal, finetuningPrompt, cloneName);
                parsedMessages.push(processedJson);
            } catch (fileError) {
                console.error(`Error processing file ${file}:`, fileError.message);
                // Remove invalid file from directory
                try {
                    fs.unlinkSync(path.join(folder, file));
                    console.log(`Removed invalid file ${file} due to processing error`);
                } catch (unlinkError) {
                    console.error(`Failed to remove invalid file ${file}:`, unlinkError.message);
                }
                // Continue with next file instead of stopping completely
                continue;
            }
        }

        if (parsedMessages.length === 0) {
            return { error: "No messages could be successfully parsed from any files" };
        }

        let fineTuneSettings = calculateFineTuneSettings(totalLines);
        if (!fineTuneSettings) return { error: "Error calculating fine tune settings" };

        //combine parsedMessages into one array
        parsedMessages = parsedMessages.flat();

        let cost = calculateCost(parsedMessages, fineTuneSettings.n_epochs);

        return { parsedMessages, fineTuneSettings, cost };
    } catch (error) {
        console.error("Error in parseMessages:", error.message);
        return { error: `Error parsing messages: ${error.message}` };
    }
}

async function main(finetuningPrompt, folder, apiKey, cloneNames = {}) {
    // Use user-specific directory
    const userFolder = userManager.getUserInputDir(apiKey);

    let { parsedMessages, fineTuneSettings, cost } = await parseMessages(userFolder, finetuningPrompt, apiKey, cloneNames);

    console.log("FINAL COST: ", cost);


    if (!parsedMessages) return { error: "Error parsing messages" };

    // Use provided API key
    if (!apiKey) return { error: "No API key provided" };

    let fileID = await processData.uploadFileToOpenAI(parsedMessages, apiKey);
    if (!fileID) return { error: "Error uploading file to OpenAI" };

    //force remove user folder
    fs.rmSync(userFolder, { recursive: true, force: true });

    // Get the next model name with proper versioning (chatbot-v1, chatbot-v2, etc.)
    let name = await utils.getNextOpenAIModelName(apiKey);

    let fineTuningResponse = await processData.createFineTuningJob(fileID, apiKey, name, fineTuneSettings);
    if (!fineTuningResponse) return { error: "Error creating fine tuning job" };

    // Store job information in user's data
    userManager.storeFineTuningJob(apiKey, fineTuningResponse, {
        status: "pending",
        fineTuneSettings,
        modelName: name
    });

    return fineTuningResponse; //job-id
}

async function preParseFiles(folder, apiKey, cloneNames = {}) {
    // Use user-specific directory
    const userFolder = userManager.getUserInputDir(apiKey);

    let { parsedMessages, fineTuneSettings, cost } = await parseMessages(userFolder, "", apiKey, cloneNames);

    if (!parsedMessages) return { error: "Error parsing messages" };
    if (!fineTuneSettings) return { error: "Error calculating fine tune settings" };

    return { parsedMessages: parsedMessages.length, fineTuneSettings, cost };
}


module.exports = { main, preParseFiles };