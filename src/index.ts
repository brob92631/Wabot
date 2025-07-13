// src/index.ts

import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config';
import { initializeUserProfileDB } from './services/userProfile.service';
import { handleMessageCreate } from './handlers/messageCreate.handler';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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
    client.user?.setActivity('with Discord API', { type: 'PLAYING' });
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

// Start the bot
client.login(process.env.DISCORD_BOT_TOKEN).catch((error) => {
    console.error('Failed to login:', error);
    process.exit(1);
});
