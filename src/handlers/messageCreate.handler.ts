// src/handlers/messageCreate.handler.ts

import { Message, TextBasedChannel } from 'discord.js'; // Import TextBasedChannel
import { config } from '../config';
import * as ConversationService from '../services/conversation.service';
import * as GeminiService from '../services/gemini.service';
import * as WebScrapingService from '../services/webScraping.service';
import * as UserProfileService from '../services/userProfile.service';

// Track recently processed messages to prevent duplicates
const processedMessages = new Set<string>();
const MESSAGE_CACHE_DURATION = 5000; // 5 seconds

/**
 * Handles the logic for incoming messages.
 * @param message The Discord message object.
 */
export async function handleMessageCreate(message: Message) {
    // Ignore bots
    if (message.author.bot) return;

    // Ensure the channel is a type that can send messages before proceeding.
    if (!message.channel.isTextBased()) {
        return;
    }

    // Prevent duplicate processing of the same message
    const messageKey = `${message.id}-${message.author.id}`;
    if (processedMessages.has(messageKey)) {
        console.log(`Ignoring duplicate message: ${messageKey}`);
        return;
    }
    
    // Add to processed messages and clean up after delay
    processedMessages.add(messageKey);
    setTimeout(() => {
        processedMessages.delete(messageKey);
    }, MESSAGE_CACHE_DURATION);

    const isMentioned = message.mentions.has(message.client.user!.id);
    const startsWithPrefix = message.content.startsWith(config.COMMAND_PREFIX + ' ');

    // Debug logging
    console.log(`Message: "${message.content}" | Mentioned: ${isMentioned} | Prefix: ${startsWithPrefix}`);

    // Check if we should process this message (mention OR prefix, not both)
    if (!isMentioned && !startsWithPrefix) {
        return; // Not for us, ignore
    }

    // Extract the query - prioritize mention over prefix
    let rawQuery = '';
    
    if (isMentioned) {
        // If mentioned, remove the mention and use the rest as query
        rawQuery = message.content.replace(/<@!?\d+>/g, '').trim();
        // If the remaining content still has the prefix, remove it too
        if (rawQuery.startsWith(config.COMMAND_PREFIX + ' ')) {
            rawQuery = rawQuery.slice(config.COMMAND_PREFIX.length + 1).trim();
        }
    } else {
        // Only process prefix if NOT mentioned
        rawQuery = message.content.slice(config.COMMAND_PREFIX.length + 1).trim();
    }

    console.log(`Extracted raw query: "${rawQuery}"`);

    // If query is empty after processing, show help
    if (!rawQuery) {
        await message.reply('Hello! How can I help you today? You can ask me a question, or type `w help` for more options.');
        return;
    }
    
    // Convert to lowercase for command matching, but keep original for Gemini
    const queryLower = rawQuery.toLowerCase();

    // --- Handle special commands ---
    if (queryLower === 'help') {
        const helpText = `
**Wabot Commands**
- \`${config.COMMAND_PREFIX} <your question>\`: Ask me anything!
- \`@Wabot <your question>\`: Mention me to ask a question.
- \`${config.COMMAND_PREFIX} reset\`: I will forget our current conversation in this channel.
- \`${config.COMMAND_PREFIX} help\`: Shows this help message.
- \`${config.COMMAND_PREFIX} review <code>\`: Get a code review or explanation.
- \`${config.COMMAND_PREFIX} summarize <url>\`: Summarize content from a webpage.
- \`${config.COMMAND_PREFIX} extract <url>\`: Extract key information from a webpage.
- \`${config.COMMAND_PREFIX} solve <problem>\`: Engage in multi-turn problem solving.
- \`${config.COMMAND_PREFIX} remember <key>=<value>\`: Store personal information (e.g., \`w remember my-name=Alice\`).
- \`${config.COMMAND_PREFIX} forget <key>\`: Forget a specific memory (e.g., \`w forget my-name\`). Use \`w forget all\` to clear all your memories.
- \`${config.COMMAND_PREFIX} show my-data\`: See what I remember about you.
- \`${config.COMMAND_PREFIX} set-tone <tone>\`: Set my conversational tone (e.g., \`w set-tone humorous\`, \`w set-tone formal\`, \`w set-tone friendly\`).
- \`${config.COMMAND_PREFIX} set-persona <persona>\`: Set my persona (e.g., \`w set-persona pirate\`, \`w set-persona academic\`).

I remember the last few messages in our conversation for context. If you want to start fresh, just use the reset command!
        `;
        await message.reply(helpText);
        return;
    }

    if (queryLower === 'reset') {
        ConversationService.clearHistory(message.channel.id);
        await message.reply('I\'ve cleared our conversation history. Let\'s start a fresh chat!');
        return;
    }

    // --- User Profile Commands ---
    if (queryLower.startsWith('remember ')) {
        const parts = rawQuery.substring('remember '.length).split('=').map(s => s.trim());
        if (parts.length === 2 && parts[0] && parts[1]) {
            const key = parts[0].replace(/[^a-zA-Z0-9-]/g, '').toLowerCase(); // Sanitize key
            const value = parts[1];
            await UserProfileService.setProfileData(message.author.id, {
                customMemory: { ...UserProfileService.getProfile(message.author.id).customMemory, [key]: value }
            });
            await message.reply(`Okay, I'll remember that "${key}" is "${value}".`);
        } else {
            await message.reply(`To remember something, use \`${config.COMMAND_PREFIX} remember <key>=<value>\`.`);
        }
        return;
    }

    if (queryLower.startsWith('forget ')) {
        const keyToForget = queryLower.substring('forget '.length).trim();
        if (keyToForget === 'all') {
            await UserProfileService.clearProfileData(message.author.id);
            await message.reply('I\'ve forgotten everything I remembered about you.');
        } else if (keyToForget) {
            const currentMemory = UserProfileService.getProfile(message.author.id).customMemory || {};
            if (currentMemory[keyToForget]) {
                delete currentMemory[keyToForget];
                await UserProfileService.setProfileData(message.author.id, { customMemory: currentMemory });
                await message.reply(`Okay, I've forgotten "${keyToForget}".`);
            } else {
                await message.reply(`I don't seem to have "${keyToForget}" in my memory.`);
            }
        } else {
            await message.reply(`To forget something, use \`${config.COMMAND_PREFIX} forget <key>\` or \`${config.COMMAND_PREFIX} forget all\`.`);
        }
        return;
    }

    if (queryLower === 'show my-data' || queryLower === 'show my data') {
        const profile = UserProfileService.getProfile(message.author.id);
        let response = 'Here\'s what I remember about you:\n';
        if (Object.keys(profile).length === 0) {
            response += 'Nothing yet! Use `w remember <key>=<value>` to teach me something.';
        } else {
            if (profile.tone) response += `- **Tone:** ${profile.tone}\n`;
            if (profile.persona) response += `- **Persona:** ${profile.persona}\n`;
            if (profile.customMemory && Object.keys(profile.customMemory).length > 0) {
                response += '**Custom Memories:**\n';
                for (const key in profile.customMemory) {
                    response += `- \`${key}\`: ${profile.customMemory[key]}\n`;
                }
            } else if (!profile.tone && !profile.persona) {
                response += 'No custom memories, tone, or persona set yet.';
            }
        }
        await message.reply(response);
        return;
    }

    if (queryLower.startsWith('set-tone ')) {
        const tone = rawQuery.substring('set-tone '.length).trim();
        if (tone) {
            await UserProfileService.setProfileData(message.author.id, { tone: tone.toLowerCase() });
            await message.reply(`Okay, I'll try to be more **${tone}** in our conversations!`);
        } else {
            await message.reply(`Please specify a tone, e.g., \`${config.COMMAND_PREFIX} set-tone friendly\`.`);
        }
        return;
    }

    if (queryLower.startsWith('set-persona ')) {
        const persona = rawQuery.substring('set-persona '.length).trim();
        if (persona) {
            await UserProfileService.setProfileData(message.author.id, { persona: persona });
            await message.reply(`Understood! I will now try to adopt a **${persona}** persona.`);
        } else {
            await message.reply(`Please specify a persona, e.g., \`${config.COMMAND_PREFIX} set-persona pirate\`.`);
        }
        return;
    }

    // --- URL Processing Commands ---
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urlsInQuery = rawQuery.match(urlRegex);

    if (queryLower.startsWith('summarize ') && urlsInQuery && urlsInQuery.length > 0) {
        const url = urlsInQuery[0];
        // Ensure sendTyping is called on a TextBasedChannel
        if (message.channel.isTextBased()) {
            await (message.channel as TextBasedChannel).sendTyping();
        }
        const content = await WebScrapingService.fetchAndExtractText(url);
        if (content) {
            const prompt = `Please provide a concise summary of the following text from ${url}:\n\n${content}`;
            await processGeminiQuery(message, prompt, rawQuery);
        } else {
            await message.reply(`Sorry, I couldn't fetch or extract content from that URL: <${url}>. It might be behind a login, a private page, or an unsupported format.`);
        }
        return;
    }

    if (queryLower.startsWith('extract ') && urlsInQuery && urlsInQuery.length > 0) {
        const url = urlsInQuery[0];
        // Ensure sendTyping is called on a TextBasedChannel
        if (message.channel.isTextBased()) {
            await (message.channel as TextBasedChannel).sendTyping();
        }
        const content = await WebScrapingService.fetchAndExtractText(url);
        if (content) {
            const prompt = `Please extract the key information and main points from the following text from ${url}:\n\n${content}`;
            await processGeminiQuery(message, prompt, rawQuery);
        } else {
            await message.reply(`Sorry, I couldn't fetch or extract content from that URL: <${url}>. It might be behind a login, a private page, or an unsupported format.`);
        }
        return;
    }

    // --- General Gemini Processing (including review, explain, solve) ---
    // The GeminiService.generateResponse will handle the specific prompt interpretation
    // based on keywords like "review", "explain", "solve".
    await processGeminiQuery(message, rawQuery, rawQuery);
}

/**
 * Helper function to process queries with Gemini, including typing indicator and error handling.
 * @param message The Discord message object.
 * @param prompt The actual prompt to send to Gemini.
 * @param originalQuery The original user query for history logging.
 */
async function processGeminiQuery(message: Message, prompt: string, originalQuery: string) {
    try {
        // Only send typing if the channel supports it and is a TextBasedChannel
        if (message.channel.isTextBased()) {
            await (message.channel as TextBasedChannel).sendTyping();
        } 

        const history = ConversationService.getHistory(message.channel.id);
        const userProfile = UserProfileService.getProfile(message.author.id); // Get user profile

        const responseText = await GeminiService.generateResponse(history, prompt, userProfile); // Pass user profile

        // Add the new exchange to history (using original query for user's side)
        ConversationService.addMessageToHistory(message.channel.id, 'user', originalQuery);
        ConversationService.addMessageToHistory(message.channel.id, 'model', responseText);

        if (responseText) {
            await message.reply(responseText);
        } else {
            await message.reply("I'm sorry, I couldn't generate a response. Please try again.");
        }
    } catch (error) {
        console.error('Error processing message:', error);
        await message.reply('Sorry, an error occurred. The API might be busy or there could be an issue with my configuration. Please try again later.');
    }
}
