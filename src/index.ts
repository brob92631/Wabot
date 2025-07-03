// src/index.ts

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';
import http from 'http';
import { handleMessageCreate } from './handlers/messageCreate.handler';
import { initializeUserProfileDB } from './services/userProfile.service';
import { config } from './config';

// Load environment variables from .env file
dotenv.config();

const { DISCORD_BOT_TOKEN, GEMINI_API_KEY, PORT, BOT_OWNER_ID } = process.env;

// --- Bot State ---
// A centralized place for global bot state.
export const botState = {
    isMaintenance: false,
    startTime: Date.now(),
};

// --- Essential Variable Check ---
if (!DISCORD_BOT_TOKEN || !GEMINI_API_KEY || !BOT_OWNER_ID) {
    console.error('CRITICAL ERROR: Missing DISCORD_BOT_TOKEN, GEMINI_API_KEY, or BOT_OWNER_ID in .env file. Exiting.');
    process.exit(1);
}
// Update the config with the validated owner ID
config.BOT_OWNER_ID = BOT_OWNER_ID;


// --- Discord Client Initialization ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel], // Required for DMs
});

// --- Client Event Handlers ---
client.once('ready', async () => {
    console.log(`✅ Wabot is online! Logged in as ${client.user?.tag}`);
    console.log(`   Serving ${client.guilds.cache.size} servers.`);
    await initializeUserProfileDB();
});

// Delegate message handling to the specialized handler
client.on('messageCreate', handleMessageCreate);

client.on('error', (error) => {
    console.error('Discord Client Error:', error);
});

// --- Keep-Alive Server for Hosting Platforms ---
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Wabot is alive and kicking!');
}).listen(PORT || 3000, () => {
    console.log(`🚀 HTTP keep-alive server listening on port ${PORT || 3000}`);
});

// --- Start the Bot ---
client.login(DISCORD_BOT_TOKEN);
