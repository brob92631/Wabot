// src/index.ts

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';
import http from 'http';
import { handleMessageCreate } from './handlers/messageCreate.handler';

// Load environment variables from .env file
dotenv.config();

const { DISCORD_BOT_TOKEN, GEMINI_API_KEY, PORT } = process.env;

// --- Essential Variable Check ---
if (!DISCORD_BOT_TOKEN || !GEMINI_API_KEY) {
    console.error('CRITICAL ERROR: Missing DISCORD_BOT_TOKEN or GEMINI_API_KEY in .env file. Exiting.');
    process.exit(1);
}

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
client.once('ready', () => {
    console.log(`Wabot is online! Logged in as ${client.user?.tag}`);
    console.log(`Ready to serve in ${client.guilds.cache.size} servers.`);
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
    console.log(`HTTP keep-alive server listening on port ${PORT || 3000}`);
});

// --- Start the Bot ---
client.login(DISCORD_BOT_TOKEN);
