// src/config.ts
import { Content } from '@google/generative-ai';

export const config = {
    // Bot settings
    COMMAND_PREFIX: 'w', // 'w' for Wabot, can be changed to '!' or any other prefix.
    BOT_OWNER_ID: process.env.BOT_OWNER_ID || '', // Your Discord User ID for owner-only commands
    EMBED_COLOR: '#5865F2', // Discord's "Blurple" color
    
    // System Prompt
    SYSTEM_PROMPT: { /* ... (no changes here) ... */ },

    // Gemini API settings
    GEMINI_MODELS: {
        // Use latest models for best performance
        flash: 'gemini-2.5-flash',
        pro: 'gemini-2.5-pro',
        // New dedicated model for Text-to-Speech
        tts: 'gemini-2.5-pro-preview-tts', // <-- CORRECTED to the model that supports speechConfig
    },
    
    // Default voice for the 'say' command
    TTS_VOICE: 'Zephyr', // Other options include: Puck, Piper, Dash

    // Conversation memory settings
    MAX_HISTORY_MESSAGES: 10,

    // Discord settings
    MAX_RESPONSE_LENGTH: 2000,
};
