// src/index.ts

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';
import { handleMessageCreate } from './handlers/messageCreate.handler';
import { initializeUserProfileDB } from './services/userProfile.service';
import { config } from './config';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// --- Initialize clients and state outside the handler ---
dotenv.config();

const { DISCORD_BOT_TOKEN, GEMINI_API_KEY, BOT_OWNER_ID } = process.env;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

export const botState = {
    isMaintenance: false,
    startTime: Date.now(),
};

// --- A flag to ensure we only login once ---
let isBotInitialized = false;

// --- This is the function Vercel will run ---
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // We only want to run the setup and login logic ONCE.
    if (!isBotInitialized) {
        console.log('Bot is starting up for the first time...');

        // Check for essential variables
        if (!DISCORD_BOT_TOKEN || !GEMINI_API_KEY || !BOT_OWNER_ID) {
            console.error('CRITICAL ERROR: Missing environment variables. Exiting.');
            // Send a server error response
            return res.status(500).send('CRITICAL ERROR: Missing environment variables.');
        }
        config.BOT_OWNER_ID = BOT_OWNER_ID;

        // Add all event listeners
        client.once('ready', async () => {
            console.log(`✅ Wabot is online! Logged in as ${client.user?.tag}`);
            console.log(`   Serving ${client.guilds.cache.size} servers.`);
            // Initialize the database AFTER the bot is ready
            await initializeUserProfileDB();
        });

        client.on('messageCreate', handleMessageCreate);
        client.on('error', (error) => console.error('Discord Client Error:', error));

        // Login to Discord and initialize the bot
        await client.login(DISCORD_BOT_TOKEN);

        // Set the flag to true so this block doesn't run again
        isBotInitialized = true;
        console.log('Bot initialization complete.');
    }

    // This is the response to the HTTP request from Vercel.
    // It keeps the function "warm" and proves the bot is running.
    res.status(200).send('Wabot is running.');
}
