const express = require('express');
const { askAI } = require('./askAI');
const app = express();
app.use(express.json());

// Example API endpoint for chat
app.post('/api/chat', async (req, res) => {
  try {
    // Extract data from request body
    const { message, context, model = 'gpt-4o', apiKey } = req.body;
    
    // Validate required fields
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }
    
    // Use provided context or default to empty array
    const conversationContext = context || [];
    
    // Call the askAI function with the provided context
    const response = await askAI(message, model, conversationContext, apiKey);
    
    // Return the AI response
    // Note: The API doesn't save any history - it's the client's responsibility
    return res.json({ response });
    
  } catch (error) {
    console.error('Error processing chat request:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Example usage of the API
/*
Client would send a request like this:
{
  "message": "User's current message",
  "apiKey": "your-openai-api-key",
  "model": "gpt-4o",
  "context": [
    {
      "role": "user",
      "content": "First user message"
    },
    {
      "role": "assistant",
      "content": "First assistant response"
    },
    {
      "role": "user",
      "content": "Second user message"
    }
  ]
}
*/

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 