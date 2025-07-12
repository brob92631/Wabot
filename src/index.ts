// Wabot-main/src/index.ts

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';
import http from 'http';
import { handleMessageCreate } from './handlers/messageCreate.handler';
import { initializeUserProfileDB } from './services/userProfile.service';
import { config } from './config';

dotenv.config();

const { DISCORD_BOT_TOKEN, GEMINI_API_KEY, PORT, BOT_OWNER_ID } = process.env;
const listenPort = PORT || 3000; // Define the port to use

export const botState = {
    isMaintenance: false,
    startTime: Date.now(),
};

if (!DISCORD_BOT_TOKEN || !GEMINI_API_KEY || !BOT_OWNER_ID) {
    console.error('CRITICAL ERROR: Missing environment variables. Exiting.');
    process.exit(1);
}
config.BOT_OWNER_ID = BOT_OWNER_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

client.once('ready', async () => {
    console.log(`✅ Wabot is online! Logged in as ${client.user?.tag}`);
    console.log(`   Serving ${client.guilds.cache.size} servers.`);
    await initializeUserProfileDB();
});

client.on('messageCreate', handleMessageCreate);
client.on('error', (error) => console.error('Discord Client Error:', error));

// This simple server is still useful to confirm the process is running.
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Wabot is alive and kicking!');
});

// --- THIS IS THE PERMANENT FIX ---
// This code listens for errors on the server. If the port is in use,
// it prints a warning instead of crashing the whole bot.
server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
        console.warn(`⚠️ Port ${listenPort} is already in use. The keep-alive server will not start, but the Discord bot will continue to run.`);
    } else {
        console.error('An error occurred with the HTTP keep-alive server:', error);
    }
});

server.listen(listenPort, () => {
    console.log(`🚀 HTTP keep-alive server listening on port ${listenPort}`);
});

client.login(DISCORD_BOT_TOKEN);
