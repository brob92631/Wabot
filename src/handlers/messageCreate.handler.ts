// src/handlers/messageCreate.handler.ts

import { Message, EmbedBuilder, Colors, TextBasedChannel, ChannelType } from 'discord.js';
import { config } from '../config';
import { botState } from '../index';
import * as ConversationService from '../services/conversation.service';
import * as GeminiService from '../services/gemini.service';
import * as WebScrapingService from '../services/webScraping.service';
import * as UserProfileService from '../services/userProfile.service';

// --- Response Utilities (Moved directly into this file for type safety) ---

const createEmbed = (description: string) => new EmbedBuilder().setColor(Colors.Blurple).setDescription(description);
const createSuccessEmbed = (description: string) => new EmbedBuilder().setColor(Colors.Green).setDescription(`✅ ${description}`);
const createErrorEmbed = (description: string) => new EmbedBuilder().setColor(Colors.Red).setTitle('Oops!').setDescription(`❌ ${description}`);

/**
 * The main handler for all incoming messages.
 */
export async function handleMessageCreate(message: Message) {
    // --- Initial Guards ---
    if (message.author.bot) return;

    // This is the most important check. It ensures we are in a channel where we can send messages.
    if (!message.channel.isTextBased() || message.channel.isDMBased()) {
        return;
    }
    
    if (botState.isMaintenance && message.author.id !== config.BOT_OWNER_ID) {
        return;
    }

    // --- Determine if Bot Should Process ---
    const isMentioned = message.mentions.has(message.client.user!.id);
    const startsWithPrefix = message.content.startsWith(config.COMMAND_PREFIX);

    if (!isMentioned && !startsWithPrefix) return;

    // --- Parse Content ---
    let content: string;
    if (isMentioned) {
        content = message.content.replace(/<@!?\d+>/g, '').trim();
    } else {
        content = message.content.substring(config.COMMAND_PREFIX.length).trim();
    }
    
    if (!content && isMentioned) {
        await message.reply({ embeds: [createEmbed(`Hey there! Need something? Use \`${config.COMMAND_PREFIX}help\` for commands.`)] });
        return;
    }

    const args = content.split(/ +/);
    const command = args.shift()?.toLowerCase();
    
    if (!command) return;
    
    // --- Command Router ---
    try {
        switch (command) {
            case 'help':
                const helpEmbed = new EmbedBuilder()
                    .setColor(Colors.Blurple)
                    .setTitle('🤖 Wabot Help Menu')
                    .setDescription(`Mention me (\`@Wabot\`) or use the prefix \`${config.COMMAND_PREFIX}\`.`)
                    .addFields(
                        { name: 'Core', value: `\`help\`, \`reset\`, \`ping\`, \`uptime\``, inline: true },
                        { name: 'Content', value: `\`review\`, \`summarize\`, \`extract\``, inline: true },
                        { name: 'Profile', value: `\`remember\`, \`forget\`, \`show-my-data\`, \`set-tone\`, \`set-persona\``, inline: true }
                    );
                await message.reply({ embeds: [helpEmbed] });
                break;

            case 'ping': {
                const sentMsg = await message.reply({ embeds: [createEmbed('Pinging...')] });
                const latency = sentMsg.createdTimestamp - message.createdTimestamp;
                await sentMsg.edit({ embeds: [createEmbed(`**🏓 Pong!**\nRoundtrip: ${latency}ms`)] });
                break;
            }
            
            case 'uptime': {
                const uptime = Date.now() - botState.startTime;
                const uptimeString = `${Math.floor(uptime / 86400000)}d ${Math.floor((uptime % 86400000) / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m`;
                await message.reply({ embeds: [createEmbed(`I've been online for **${uptimeString}**.`)] });
                break;
            }

            case 'reset':
                ConversationService.clearHistory(message.channel.id);
                await message.reply({ embeds: [createSuccessEmbed("Conversation history cleared.")] });
                break;

            // --- User Profile Commands ---
            case 'remember': {
                const parts = args.join(' ').split('=').map(s => s.trim());
                if (parts.length === 2 && parts[0] && parts[1]) {
                    const key = parts[0].replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
                    await UserProfileService.setProfileData(message.author.id, {
                        customMemory: { ...UserProfileService.getProfile(message.author.id).customMemory, [key]: parts[1] }
                    });
                    await message.reply({ embeds: [createSuccessEmbed(`Okay, I'll remember that \`${key}\` is "${parts[1]}".`)] });
                } else {
                    await message.reply({ embeds: [createErrorEmbed(`Usage: \`${config.COMMAND_PREFIX}remember <key>=<value>\``)] });
                }
                break;
            }

            case 'forget': {
                const keyToForget = args[0]?.toLowerCase();
                if (!keyToForget) {
                    await message.reply({ embeds: [createErrorEmbed(`Usage: \`${config.COMMAND_PREFIX}forget <key|all>\``)] });
                    return;
                }
                if (keyToForget === 'all') {
                    await UserProfileService.clearProfileData(message.author.id);
                    await message.reply({ embeds: [createSuccessEmbed("I've forgotten everything about you.")] });
                } else {
                    const currentMemory = UserProfileService.getProfile(message.author.id).customMemory || {};
                    if (currentMemory[keyToForget]) {
                        delete currentMemory[keyToForget];
                        await UserProfileService.setProfileData(message.author.id, { customMemory: currentMemory });
                        await message.reply({ embeds: [createSuccessEmbed(`Okay, I've forgotten \`${keyToForget}\`.`)] });
                    } else {
                        await message.reply({ embeds: [createErrorEmbed(`I don't have anything called \`${keyToForget}\` in my memory.`)] });
                    }
                }
                break;
            }
            
            case 'show-my-data': {
                const profile = UserProfileService.getProfile(message.author.id);
                let response = '';
                if (profile.tone) response += `**Tone:** ${profile.tone}\n`;
                if (profile.persona) response += `**Persona:** ${profile.persona}\n`;
                if (profile.customMemory && Object.keys(profile.customMemory).length > 0) {
                    response += '**Custom Memories:**\n';
                    for (const key in profile.customMemory) {
                        response += `- \`${key}\`: ${profile.customMemory[key]}\n`;
                    }
                }
                await message.reply({ embeds: [createEmbed(response || "I don't know anything about you yet!")] });
                break;
            }

            // --- Gemini Commands ---
            case 'summarize':
            case 'extract': {
                const urlMatch = args.join(' ').match(/(https?:\/\/[^\s]+)/);
                if (!urlMatch) {
                    await message.reply({ embeds: [createErrorEmbed(`Please provide a URL to ${command}.`)] });
                    return;
                }
                await message.channel.sendTyping();
                const webContent = await WebScrapingService.fetchAndExtractText(urlMatch[0]);
                if (!webContent) {
                    await message.reply({ embeds: [createErrorEmbed(`I couldn't fetch content from that URL.`)] });
                    return;
                }
                const prompt = `${command} the key points from the following text:\n\n${webContent}`;
                await processGeminiQuery(message, prompt, content);
                break;
            }
            
            default:
                await processGeminiQuery(message, content, content);
                break;
        }
    } catch (error) {
        console.error("Error in command router:", error);
        await message.reply({ embeds: [createErrorEmbed("A critical error occurred while running that command.")] });
    }
}

/**
 * Final processing step for sending a query to Gemini and replying with the response.
 */
async function processGeminiQuery(message: Message, prompt: string, queryForHistory: string) {
    // We already know the channel is text-based from the top-level guard.
    const channel = message.channel as TextBasedChannel;

    try {
        await channel.sendTyping();

        const history = ConversationService.getHistory(channel.id);
        const userProfile = UserProfileService.getProfile(message.author.id);

        const responseText = await GeminiService.generateResponse(history, prompt, userProfile);

        ConversationService.addMessageToHistory(channel.id, 'user', queryForHistory);
        ConversationService.addMessageToHistory(channel.id, 'model', responseText);

        // --- Safe Reply Logic (Moved from smartReply) ---
        const trimmedContent = responseText.trim();
        if (!trimmedContent) {
            await message.reply({ embeds: [createErrorEmbed("I received an empty response.")] });
            return;
        }

        if (trimmedContent.length <= 4096) {
            await message.reply({ embeds: [createEmbed(trimmedContent)] });
        } else {
            const chunks = trimmedContent.match(/[\s\S]{1,2000}/g) || [];
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                if (chunk) { // This check solves the 'undefined' error
                    await (i === 0 ? message.reply(chunk) : channel.send(chunk));
                }
            }
        }
    } catch (error) {
        console.error('Error processing Gemini query:', error);
        await message.reply({ embeds: [createErrorEmbed("I ran into an error trying to generate a response.")] });
    }
}
