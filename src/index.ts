// src/index.ts (Corrected Version)

import dotenv from 'dotenv';
// Load environment variables FIRST, before anything else.
dotenv.config();

import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import { config } from './config';
import { initializeUserProfileDB } from './services/userProfile.service';
import { handleMessageCreate } from './handlers/messageCreate.handler';

// Bot state that can be exported
export const botState = {
    startTime: Date.now(),
    isMaintenance: false,
};

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Bot ready event
client.once('ready', async () => {
    console.log(`✅ ${client.user?.tag} is now online!`);
    
    // Initialize user profile database
    await initializeUserProfileDB();
    
    // Set bot activity
    client.user?.setActivity('with Discord API', { type: ActivityType.Playing });
});

// Message create event
client.on('messageCreate', handleMessageCreate);

// Error handling
client.on('error', (error) => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// Validate environment variables before login
if (!process.env.DISCORD_BOT_TOKEN || !process.env.GEMINI_API_KEY) {
    console.error("FATAL: Missing DISCORD_BOT_TOKEN or GEMINI_API_KEY in .env file. Please check your configuration.");
    process.exit(1);
}

if (!process.env.GEMINI_SECONDARY_API_KEY) {
    console.warn("WARN: GEMINI_SECONDARY_API_KEY is not set. The primary API key will be used for all features, which may impact primary rate limits.");
}

// Start the bot
client.login(process.env.DISCORD_BOT_TOKEN).catch((error) => {
    console.error('Failed to login:', error);
    process.exit(1);
});
