// src/handlers/messageCreate.handler.ts

import { Message, EmbedBuilder, Colors, TextBasedChannel, ChannelType } from 'discord.js';
import { config } from '../config';
import { botState } from '../index';
import * as ConversationService from '../services/conversation.service';
import * as GeminiService from '../services/gemini.service';
import * as WebScrapingService from '../services/webScraping.service';
import *s UserProfileService from '../services/userProfile.service';

// --- Embed Utilities ---
const createEmbed = (desc: string) => new EmbedBuilder().setColor(Colors.Blurple).setDescription(desc);
const createSuccessEmbed = (desc: string) => new EmbedBuilder().setColor(Colors.Green).setDescription(`✅ ${desc}`);
const createErrorEmbed = (desc: string) => new EmbedBuilder().setColor(Colors.Red).setTitle('Error').setDescription(`❌ ${desc}`);

/**
 * Main handler for incoming messages.
 */
export async function handleMessageCreate(message: Message) {
    // --- GUARDS ---
    if (message.author.bot) return;

    // THE OFFICIAL FIX: Explicitly check for channel types that can receive messages.
    // This guarantees to TypeScript that methods like .send() and .sendTyping() exist.
    // This check excludes all partials, voice channels, forums, etc.
    if (message.channel.type !== ChannelType.GuildText && message.channel.type !== ChannelType.DM) {
        return;
    }
    
    if (botState.isMaintenance && message.author.id !== config.BOT_OWNER_ID) {
        return;
    }

    const isMentioned = message.mentions.has(message.client.user!.id);
    const startsWithPrefix = message.content.startsWith(config.COMMAND_PREFIX);

    if (!isMentioned && !startsWithPrefix) return;

    // --- PARSE CONTENT ---
    let content = isMentioned
        ? message.content.replace(/<@!?\d+>/g, '').trim()
        : message.content.substring(config.COMMAND_PREFIX.length).trim();

    if (!content) {
        if (isMentioned) await message.reply({ embeds: [createEmbed(`Hi there! Use \`${config.COMMAND_PREFIX}help\` to see what I can do.`)] });
        return;
    }

    const args = content.split(/ +/);
    const command = args.shift()?.toLowerCase();
    if (!command) return;

    // --- COMMAND ROUTER ---
    try {
        switch (command) {
            case 'help': {
                const helpEmbed = new EmbedBuilder()
                    .setColor(Colors.Blurple).setTitle('🤖 Wabot Help')
                    .setDescription(`You can mention me or use the prefix \`${config.COMMAND_PREFIX}\`.`)
                    .addFields(
                        { name: 'Core', value: `\`help\`, \`reset\`, \`ping\`, \`uptime\`` },
                        { name: 'Content', value: `\`review\`, \`summarize\`, \`extract\`` },
                        { name: 'Profile', value: `\`remember\`, \`forget\`, \`show-my-data\`, \`set-tone\`, \`set-persona\`` }
                    );
                await message.reply({ embeds: [helpEmbed] });
                break;
            }
            case 'ping': {
                const sentMsg = await message.reply({ content: 'Pinging...' });
                await sentMsg.edit(`Pong! Latency is ${sentMsg.createdTimestamp - message.createdTimestamp}ms.`);
                break;
            }
            case 'uptime': {
                const uptime = Date.now() - botState.startTime;
                const d = Math.floor(uptime / 86400000);
                const h = Math.floor((uptime % 86400000) / 3600000);
                const m = Math.floor((uptime % 3600000) / 60000);
                await message.reply({ embeds: [createEmbed(`Online for: **${d}d ${h}h ${m}m**`)] });
                break;
            }
            case 'reset': {
                ConversationService.clearHistory(message.channel.id);
                await message.reply({ embeds: [createSuccessEmbed('Conversation history cleared.')] });
                break;
            }
            // --- Gemini Commands ---
            default: {
                await processGeminiQuery(message, command, content);
            }
        }
    } catch (error) {
        console.error("Fatal error in command router:", error);
        await message.reply({ embeds: [createErrorEmbed("A critical error occurred.")] });
    }
}

/**
 * Handles all logic that requires interacting with the Gemini API.
 */
async function processGeminiQuery(message: Message, command: string, content: string) {
    // We already know channel is safe from the top-level guard
    const channel = message.channel; 
    let prompt = content;

    try {
        // Handle commands that need pre-processing
        if (command === 'summarize' || command === 'extract') {
            const urlMatch = content.match(/(https?:\/\/[^\s]+)/);
            if (!urlMatch) {
                await message.reply({ embeds: [createErrorEmbed(`Please provide a URL to ${command}.`)] });
                return;
            }
            await channel.sendTyping();
            const webContent = await WebScrapingService.fetchAndExtractText(urlMatch[0]);
            if (!webContent) {
                await message.reply({ embeds: [createErrorEmbed(`Could not fetch content from URL.`)] });
                return;
            }
            prompt = `${command} the following text:\n\n${webContent}`;
        } else {
             await channel.sendTyping();
        }

        const history = ConversationService.getHistory(channel.id);
        const userProfile = UserProfileService.getProfile(message.author.id);
        const responseText = await GeminiService.generateResponse(history, prompt, userProfile);

        ConversationService.addMessageToHistory(channel.id, 'user', content);
        ConversationService.addMessageToHistory(channel.id, 'model', responseText);

        // --- Safe Reply Logic ---
        const trimmed = responseText.trim();
        if (!trimmed) {
            await message.reply({ embeds: [createErrorEmbed("Received an empty response.")] });
            return;
        }

        if (trimmed.length <= 2000) {
            await message.reply(trimmed);
        } else {
            // Split and send for long messages
            const chunks = trimmed.match(/[\s\S]{1,2000}/g) || [];
            for (let i = 0; i < chunks.length; i++) {
                await message.channel.send(chunks[i]);
            }
        }
    } catch (error) {
        console.error(`Error in processGeminiQuery for command "${command}":`, error);
        await message.reply({ embeds: [createErrorEmbed("An error occurred while generating a response.")] });
    }
}
