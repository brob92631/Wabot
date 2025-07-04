// src/handlers/messageCreate.handler.ts

import { Message, EmbedBuilder, Colors } from 'discord.js';
import { config } from '../config';
import { botState } from '../index';
import * as ConversationService from '../services/conversation.service';
import * as GeminiService from '../services/gemini.service';
import * as WebScrapingService from '../services/webScraping.service';
import * as UserProfileService from '../services/userProfile.service';

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

    // THE OFFICIAL SOLUTION: Use the built-in type guard.
    // This correctly narrows the type of `message.channel` to one that is guaranteed
    // to have .send() and .sendTyping() methods.
    if (!message.channel.isTextBased()) {
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
            // --- Commands that require Gemini ---
            default: {
                // Because of the .isTextBased() guard, message.channel is now safe to use.
                await message.channel.sendTyping();
                
                let prompt = content; // Use the full content as the default prompt

                // Pre-process specific commands
                if (command === 'summarize' || command === 'extract') {
                    const urlMatch = args.join(' ').match(/(https?:\/\/[^\s]+)/);
                    if (!urlMatch) {
                        await message.reply({ embeds: [createErrorEmbed(`Please provide a URL to ${command}.`)] });
                        return;
                    }
                    const webContent = await WebScrapingService.fetchAndExtractText(urlMatch[0]);
                    if (!webContent) {
                        await message.reply({ embeds: [createErrorEmbed(`Could not fetch content from URL.`)] });
                        return;
                    }
                    prompt = `${command} the following text:\n\n${webContent}`;
                }

                const history = ConversationService.getHistory(message.channel.id);
                const userProfile = UserProfileService.getProfile(message.author.id);
                const responseText = await GeminiService.generateResponse(history, prompt, userProfile);

                ConversationService.addMessageToHistory(message.channel.id, 'user', content);
                ConversationService.addMessageToHistory(message.channel.id, 'model', responseText);

                const trimmed = responseText.trim();
                if (!trimmed) {
                    await message.reply({ embeds: [createErrorEmbed("Received an empty response.")] });
                    return;
                }
                
                // Safely split and send long messages
                if (trimmed.length <= 2000) {
                    await message.reply(trimmed);
                } else {
                    const chunks = trimmed.match(/[\s\S]{1,2000}/g) || [];
                    for (const chunk of chunks) {
                        await message.channel.send(chunk);
                    }
                }
                break;
            }
        }
    } catch (error) {
        console.error("Fatal error in command router:", error);
        try {
            await message.reply({ embeds: [createErrorEmbed("A critical error occurred while processing your command.")] });
        } catch (e) {
            console.error("Failed to send error message:", e);
        }
    }
}
