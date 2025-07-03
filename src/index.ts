import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai'; // <--- ADD THIS LINE: Import generateText from 'ai'
import dotenv from 'dotenv';
import http from 'http';

// Load environment variables from .env file (for local development)
dotenv.config();

// Retrieve tokens from environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const COMMAND_PREFIX = 'w'; // The command prefix as requested

// Basic validation for environment variables
if (!DISCORD_BOT_TOKEN) {
    console.error('Error: DISCORD_BOT_TOKEN is not set in environment variables.');
    process.exit(1); // Exit if essential token is missing
}

if (!OPENROUTER_API_KEY) {
    console.error('Error: OPENROUTER_API_KEY is not set in environment variables.');
    process.exit(1); // Exit if essential token is missing
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
const deepseekChatModel = openrouter.chat('deepseek/deepseek-v3:free'); // <--- ADD THIS LINE: Get the chat model instance

// Event: Bot is ready and online
client.once('ready', () => {
    console.log(`Warbot is online! Logged in as ${client.user?.tag}`);
});

// Event: A message is created
client.on('messageCreate', async message => {
    // Ignore messages from other bots (including itself) to prevent loops
    if (message.author.bot) return;

    // Check if the message starts with the command prefix followed by a space
    if (message.content.startsWith(COMMAND_PREFIX + ' ')) {
        // Extract the query by removing the command prefix and trimming whitespace
        const query = message.content.slice(COMMAND_PREFIX.length + 1).trim();

        // If no query is provided after the command
        if (!query) {
            await message.reply('Please provide a query after the "w" command. Example: `w what day is it?`');
            return;
        }

        try {
            // Indicate that the bot is "typing" in the channel
            await message.channel.sendTyping();

            // Make a request to DeepSeek via OpenRouter using generateText
            const { text: aiResponse } = await generateText({ // <--- MODIFIED LINE
                model: deepseekChatModel, // <--- Use the chat model instance here
                messages: [{ role: 'user', content: query }],
            });

            if (aiResponse) {
                // Discord has a 2000 character limit per message.
                if (aiResponse.length > 2000) {
                    await message.reply('The response from DeepSeek was too long. Please try a more concise query.');
                    // You could implement logic here to split the response into multiple messages
                } else {
                    await message.reply(aiResponse);
                }
            } else {
                await message.reply('DeepSeek did not return a response for your query.');
            }
        } catch (error) {
            console.error('Error communicating with DeepSeek:', error);
            await message.reply('Sorry, I encountered an error trying to get a response from DeepSeek. Please try again later.');
        }
    }
});

// Event: Log any Discord client errors
client.on('error', console.error);

// Start a simple HTTP server to keep the Repl alive
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Warbot is alive!');
}).listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

// Log in to Discord with your bot token
client.login(DISCORD_BOT_TOKEN);
