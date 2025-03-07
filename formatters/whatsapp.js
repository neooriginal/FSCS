// WhatsApp Chat Formatter - Configurable settings
// Supports both standard WhatsApp format and additional custom formats
// Standard format: DD.MM.YY, HH:MM - Sender: Message
// Custom format: M/YYYY H:MM AM/PM - Sender: Message (e.g., 8/2024 2:22 PM - username_: Message)

const { log } = require("console");

// Format configuration - adjust these variables to support different formats
const formatConfig = {
    // Date format options
    dateFormats: [
        '\\d{2}\\.\\d{2}\\.\\d{2}',  // DD.MM.YY (dots)
        '\\d{2}/\\d{2}/\\d{2}',      // MM/DD/YY (slashes)
        '\\d{1,2}/\\d{4}'            // M/YYYY (month/year format)
    ],
    // Time format options
    timeFormats: [
        '\\d{2}:\\d{2}',             // HH:MM
        '\\d{2}:\\d{2}:\\d{2}',      // HH:MM:SS
        '\\d{1,2}:\\d{2} (AM|PM)',   // H:MM AM/PM (supports single-digit hours)
    ],
    // Separators
    dateSeparator: ',\\s',           // Standard separator between date and time
    prefixSeparator: '\\s-\\s',      // Separator before sender
    senderMessageSeparator: [
        ':\\s',                      // Colon + space
        ':\\S',                      // Colon without space
        '\\s'                        // Just space (no colon)
    ]
};



const name = 'whatsapp';

// Generate patterns dynamically based on configuration
function generatePatterns(config) {
    const patterns = [];

    // PATTERN TYPE 1: Standard WhatsApp formats with comma separator (DD.MM.YY, HH:MM - Sender: Message)
    const standardDateFormats = ['\\d{2}\\.\\d{2}\\.\\d{2}', '\\d{2}/\\d{2}/\\d{2}'];
    const standardTimeFormats = ['\\d{2}:\\d{2}', '\\d{2}:\\d{2}:\\d{2}'];

    standardDateFormats.forEach(dateFormat => {
        standardTimeFormats.forEach(timeFormat => {
            config.senderMessageSeparator.forEach(separator => {
                // Standard WhatsApp format with comma
                const pattern = new RegExp(
                    `(${dateFormat}),\\s(${timeFormat})${config.prefixSeparator}(.*?)${separator}(.*)`,
                    'i'
                );
                patterns.push(pattern);
            });
        });
    });

    // PATTERN TYPE 2: M/YYYY format with space separator (M/YYYY H:MM AM/PM - Sender: Message)
    config.senderMessageSeparator.forEach(separator => {
        // Month/Year format with AM/PM time
        const newFormatPattern = new RegExp(
            `(\\d{1,2}/\\d{4})\\s(\\d{1,2}:\\d{2}\\s(?:AM|PM))${config.prefixSeparator}([\\w_]+)${separator}(.*)`,
            'i'
        );
        patterns.push(newFormatPattern);
    });

    // PATTERN TYPE 3: MM/DD/YYYY format with space separator (MM/DD/YYYY H:MM AM/PM - Sender: Message)
    config.senderMessageSeparator.forEach(separator => {
        // Month/Day/Year format with AM/PM time - creating a specific pattern that captures the entire date format
        const mmddyyyyPattern = new RegExp(
            `(\\d{1,2}/\\d{1,2}/\\d{4})\\s(\\d{1,2}:\\d{2}\\s(?:AM|PM))${config.prefixSeparator}([\\w_]+)${separator}(.*)`,
            'i'
        );
        patterns.push(mmddyyyyPattern);
    });

    return patterns;
}

// Special pattern for complex formats like MM/DD/YYYY with urls
function getSpecialPatterns() {
    return [
        // MM/DD/YYYY format for complex messages - capturing the full date
        new RegExp(`(\\d{1,2}/\\d{1,2}/\\d{4})\\s(\\d{1,2}:\\d{2}\\s(?:AM|PM))\\s-\\s([\\w_]+):\\s(.*)`, 'i')
    ];
}

function cleanUpString(str) {
    const badWords = [
        "Selbstlöschende Nachrichten wurden deaktiviert. Tippe zum Ändern.",
        "Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt. Niemand außerhalb dieses Chats kann sie lesen oder anhören, nicht einmal WhatsApp. Tippe, um mehr zu erfahren.",
        "<Medien ausgeschlossen>",
        // Do not filter links for MM/DD/YYYY format messages since they often contain URLs
        // "https?:\/\/[^ ]+",
        //regex for phone numbers
        "\\+\\d{1,3} \\d{3} \\d{3} \\d{2} \\d{2}",
        //regex for emojis
        ":[^ ]+:",
    ]
    //str is a huge message with multiple lines. 
    //We need to split it into lines and remove the bad words
    let lines = str.split('\n');
    let cleanedLines = [];
    lines.forEach(line => {
        let cleanedLine = line;
        badWords.forEach(badWord => {
            cleanedLine = cleanedLine.replace(new RegExp(badWord, 'g'), '');
        });
        cleanedLines.push(cleanedLine);
    });
    return cleanedLines.join('\n');
}

const patterns = generatePatterns(formatConfig);
const specialPatterns = getSpecialPatterns();

function isPatternDetected(message) {
    return patterns.some(p => p.test(message)) ||
        specialPatterns.some(p => p.test(message));
}

function parseMessage(message) {
    message = cleanUpString(message);

    // First try the MM/DD/YYYY special patterns
    for (const p of specialPatterns) {
        const match = message.match(p);
        if (match) {
            // Extract values using capturing groups
            const [_, date, time, sender, messageText] = match;

            return {
                date: `${date}, ${time}`,
                sender: sender.trim(),
                message: messageText.trim()
            };
        }
    }

    // Then try the regular patterns
    for (const p of patterns) {
        const match = message.match(p);
        if (match) {
            // Extract values using capturing groups
            const [_, date, time, sender, messageText] = match;

            return {
                date: `${date}, ${time}`,
                sender: sender.trim(),
                message: messageText.trim()
            };
        }
    }

    return null; // Return null if no pattern matches
}

// Test function for debugging
function testFormatter() {
    const testMessages = [
        // Standard WhatsApp format
        "01.05.22, 14:30 - John Doe: Hello there!",
        "05/01/22, 14:30 - John Doe: Hello there!",
        // New format to support
        "8/2024 2:22 PM - me_too_: TM to plastic tab",
        "8/2024 2:22 PM - ibrahimalbayrak0: As if you would be better if you slice all into a bowl"
    ];

    console.log("Testing WhatsApp formatter patterns:");
    testMessages.forEach(msg => {
        const result = parseMessage(msg);
        console.log(`Input: ${msg}`);
        console.log(`Parsed: ${result ? JSON.stringify(result) : 'Failed to parse'}`);
        console.log("---");
    });
}

// Uncomment to run tests
// testFormatter();

/**
 * Parse a complete chat log containing multiple messages
 * @param {string} chatText - The entire chat text with multiple messages
 * @returns {Array} - Array of parsed messages
 */
function parseChat(chatText) {
    // Split the input into lines
    const lines = chatText.split('\n').filter(line => line.trim() !== '');

    // Process each line and collect valid messages
    const messages = [];

    // Check each line for a valid message pattern
    for (const line of lines) {
        const parsedMessage = parseMessage(line);
        if (parsedMessage) {
            messages.push(parsedMessage);
        }
    }

    return messages;
}

module.exports = {
    isPatternDetected,
    parseChat,
    parseMessage,
    name
};