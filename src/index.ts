import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import dotenv from 'dotenv';
import http from 'http';

// Load environment variables from .env file (for local development)
dotenv.config();

// Retrieve tokens from environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const COMMAND_PREFIX = 'w';

// Basic validation for environment variables
if (!DISCORD_BOT_TOKEN) {
    console.error('CRITICAL ERROR: DISCORD_BOT_TOKEN is not set in environment variables. Exiting.');
    process.exit(1);
}

if (!OPENROUTER_API_KEY) {
    console.error('CRITICAL ERROR: OPENROUTER_API_KEY is not set in environment variables. Exiting.');
    process.exit(1);
}

// Initialize Discord Client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

// Initialize OpenRouter with your API key
const openrouter = createOpenRouter({
    apiKey: OPENROUTER_API_KEY,
});

// Define the chat model instance once
const deepseekChatModel = openrouter.chat('mistralai/mistral-7b-instruct');

// Event: Bot is ready and online
client.once('ready', () => {
    console.log(`Warbot is online! Logged in as ${client.user?.tag}`);
});

// Event: A message is created
client.on('messageCreate', async message => {
    // Ignore messages from other bots (including itself) to prevent loops
    if (message.author.bot) return;

    // Log received message for debugging
    console.log(`[${new Date().toISOString()}] Received message from ${message.author.tag} (${message.author.id}): "${message.content}"`);

    // Check if the message starts with the command prefix followed by a space
    if (message.content.startsWith(COMMAND_PREFIX + ' ')) {
        const query = message.content.slice(COMMAND_PREFIX.length + 1).trim();

        if (!query) {
            console.log(`[${new Date().toISOString()}] No query provided after command by ${message.author.tag}.`);
            await message.reply('Please provide a query after the "w" command. Example: `w what day is it?`');
            return;
        }

        console.log(`[${new Date().toISOString()}] Processing command from ${message.author.tag}. Query: "${query}"`);

        try {
            await message.channel.sendTyping();

            const { text: aiResponse } = await generateText({
                model: deepseekChatModel,
                messages: [{ role: 'user', content: query }],
            });

            if (aiResponse) {
                if (aiResponse.length > 2000) {
                    console.warn(`[${new Date().toISOString()}] DeepSeek response too long for Discord message (length: ${aiResponse.length}).`);
                    await message.reply('The response from DeepSeek was too long. Please try a more concise query.');
                } else {
                    console.log(`[${new Date().toISOString()}] DeepSeek response for query "${query}": "${aiResponse.substring(0, 100)}${aiResponse.length > 100 ? '...' : ''}"`); // Log first 100 chars
                    await message.reply(aiResponse);
                }
            } else {
                console.warn(`[${new Date().toISOString()}] DeepSeek returned no response for query: "${query}"`);
                await message.reply('DeepSeek did not return a response for your query.');
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error communicating with DeepSeek for query "${query}":`);
            // Attempt to log more specific error details from the AI SDK error
            if (error instanceof Error) {
                console.error('  Error message:', error.message);
                if (error.stack) {
                    console.error('  Error stack:', error.stack.split('\n').slice(0, 5).join('\n') + '...'); // Log first few lines of stack
                }

                // Check for common properties in AI SDK errors (often wrapped in 'cause')
                if ('cause' in error && error.cause instanceof Error) {
                    console.error('  Error cause message:', error.cause.message);
                    // If the cause is an HTTP error, it might have a response property
                    if ('response' in error.cause && typeof (error.cause as any).response === 'object' && (error.cause as any).response !== null) {
                        const response = (error.cause as any).response;
                        console.error('  HTTP Response Status:', response.status);
                        console.error('  HTTP Response Status Text:', response.statusText);
                        if (response.data) {
                            console.error('  HTTP Response Data:', JSON.stringify(response.data, null, 2));
                        }
                    }
                } else if ('status' in error && typeof (error as any).status === 'number') { // Direct status from some AI SDK errors
                    console.error('  API Error Status:', (error as any).status);
                    if ('response' in error && typeof (error as any).response === 'object' && (error as any).response !== null) {
                         const response = (error as any).response;
                         if (response.data) {
                            console.error('  API Error Response Data:', JSON.stringify(response.data, null, 2));
                         }
                    }
                }
            } else {
                console.error('  Unknown error object:', error);
            }
            await message.reply('Sorry, I encountered an error trying to get a response from DeepSeek. Please check the Render.com logs for detailed error information.');
        }
    } else {
        console.log(`[${new Date().toISOString()}] Message "${message.content}" from ${message.author.tag} does not start with command prefix.`);
    }
});

// Event: Log any Discord client errors
client.on('error', err => {
    console.error(`[${new Date().toISOString()}] Discord Client Error:`, err);
});

// Start a simple HTTP server to keep the Repl alive (for Render.com's health checks)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Warbot is alive!');
}).listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] HTTP server listening on port ${PORT}`);
});

// Log in to Discord with your bot token
client.login(DISCORD_BOT_TOKEN);
