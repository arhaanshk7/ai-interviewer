const OpenAI = require("openai");

// Groq is OpenAI-compatible: same SDK, just a different baseURL + API key.
const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
});

module.exports = client;