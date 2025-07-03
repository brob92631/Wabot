// src/config.ts

export const config = {
    // Bot settings
    COMMAND_PREFIX: 'w',
    
    // System prompt to define the bot's personality and rules
    SYSTEM_PROMPT: `You are Wabot, a helpful and friendly Discord assistant powered by Google Gemini. 
    - Your responses should be informative, concise, and formatted nicely for Discord using markdown where appropriate (e.g., code blocks, bold, italics).
    - Do not mention that you are an AI model unless it's directly relevant to the conversation.
    - Be friendly and engaging.`,

    // Gemini API settings
    GEMINI_MODELS: {
        // Use latest models for best performance
        flash: 'gemini-1.5-flash-latest',
        pro: 'gemini-1.5-pro-latest',
    },

    // Conversation memory settings
    MAX_HISTORY_MESSAGES: 10, // Max number of messages (user + bot) to keep in memory

    // Discord settings
    MAX_RESPONSE_LENGTH: 2000,
};
