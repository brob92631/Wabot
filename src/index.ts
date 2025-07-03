import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai'; // Correct import
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Using the Gemini key
const COMMAND_PREFIX = 'w';

if (!DISCORD_BOT_TOKEN || !GEMINI_API_KEY) {
    console.error('CRITICAL ERROR: Missing DISCORD_BOT_TOKEN or GEMINI_API_KEY. Exiting.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

// Initialize Google Gemini with the correct class name
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// Get the generative model
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

client.once('ready', () => {
    console.log(`Warbot is online! Logged in as ${client.user?.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content.startsWith(COMMAND_PREFIX + ' ')) {
        const query = message.content.slice(COMMAND_PREFIX.length + 1).trim();

        if (!query) {
            await message.reply('Please provide a query after the "w" command.');
            return;
        }

        try {
            await message.channel.sendTyping();

            // Structure the content for Gemini as per your example
            const contents = [{
                role: 'user',
                parts: [{ text: query }],
            }];

            // Use the generateContentStream method
            const result = await geminiModel.generateContentStream({ contents });

            let fullResponse = '';
            // Process the stream and build the full response
            for await (const chunk of result.stream) {
                fullResponse += chunk.text();
            }

            if (fullResponse) {
                // Split message if it's too long for Discord
                if (fullResponse.length > 2000) {
                    const chunks = fullResponse.match(/[\s\S]{1,2000}/g) || [];
                    for (const chunk of chunks) {
                        await message.reply(chunk);
                    }
                } else {
                    await message.reply(fullResponse);
                }
            } else {
                await message.reply('I could not get a response from Gemini.');
            }
        } catch (error) {
            console.error('Error communicating with Gemini:', error);
            await message.reply('Sorry, I encountered an error trying to get a response from Gemini. The free tier might have rate limits, or the API key may be invalid.');
        }
    }
});

client.on('error', console.error);

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Wabot is alive!');
}).listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

client.login(DISCORD_BOT_TOKEN);
