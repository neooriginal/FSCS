

const name = 'discord';


function cleanUpString(str) {
    const badWords = [
        //regex for links
        "https?:\/\/[^ ]+",
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

function isPatternDetected(message) {
    const headerRegex = /^\[\d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2}\]\s+\S+/m;
    return headerRegex.test(message);
}

/**
 * Parse a complete chat log containing multiple messages
 * @param {string} chatText - The entire chat text with multiple messages
 * @returns {Array} - Array of parsed messages
 */
function parseChat(chatText) {
    // Regex breakdown:
    // \[(\d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2})\]  -> Matches the timestamp in square brackets.
    // \s+(\S+)\s*                              -> Matches the author name (non-whitespace) with possible surrounding spaces.
    // \n([\s\S]*?)                             -> Lazily matches the message content (could be multi-line).
    // (?=\n\s*\n|\n?$)                         -> Lookahead to ensure we stop at a double newline or end of file.
    const regex = /\[(\d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2})\]\s+(\S+)\s*\n([\s\S]*?)(?=\n\s*\n|\n?$)/g;
    const result = [];
    let match;
    while ((match = regex.exec(chatText)) !== null) {
        const timestamp = match[1];
        const author = match[2];
        const message = match[3].trim();
        result.push({ date: timestamp, sender: author, message });
    }
    //cleanup the messages
    result.forEach(message => {
        message.message = cleanUpString(message.message);
    });
    return result;
}

module.exports = {
    isPatternDetected,
    parseChat,
    name
};