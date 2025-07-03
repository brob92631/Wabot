// src/handlers/messageCreate.handler.ts

import { Message } from 'discord.js';
import { config } from '../config';
import { botState } from '../index';
import * as ConversationService from '../services/conversation.service';
import * as GeminiService from '../services/gemini.service';
import * as WebScrapingService from '../services/webScraping.service';
import * as UserProfileService from '../services/userProfile.service';
import * as Response from '../utils/response';

/**
 * Handles the logic for incoming messages.
 * @param message The Discord message object.
 */
export async function handleMessageCreate(message: Message) {
    // --- Initial Guards ---
    if (message.author.bot) return;
    if (!message.channel.isTextBased()) return;
    if (botState.isMaintenance && message.author.id !== config.BOT_OWNER_ID) {
        // In maintenance mode, the bot ignores everyone except the owner
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
        // Remove prefix, but not the space after it, so "w help" -> "help"
        content = message.content.substring(config.COMMAND_PREFIX.length).trim();
    }
    
    if (!content) {
        if (isMentioned) {
            await message.reply({ embeds: [Response.createResponseEmbed(`Hey there! Need something? You can ask me a question or use \`${config.COMMAND_PREFIX}help\` for a list of commands.`)] });
        }
        return;
    }

    const args = content.split(/ +/);
    const command = args.shift()?.toLowerCase();
    
    if (!command) return;

    // --- Command Router ---
    switch (command) {
        // --- Standalone Utility Commands ---
        case 'help':
            await message.reply({ embeds: [Response.createHelpEmbed()] });
            break;

        case 'ping': {
            const sentMsg = await message.reply({ embeds: [Response.createResponseEmbed('Pinging...')] });
            const roundtripLatency = sentMsg.createdTimestamp - message.createdTimestamp;
            const apiLatency = Math.round(message.client.ws.ping);
            const embed = Response.createResponseEmbed(
                `**Roundtrip:** ${roundtripLatency}ms\n**API Heartbeat:** ${apiLatency}ms`
            ).setTitle('🏓 Pong!');
            await sentMsg.edit({ embeds: [embed] });
            break;
        }

        case 'uptime': {
            const uptime = Date.now() - botState.startTime;
            const d = Math.floor(uptime / 86400000);
            const h = Math.floor((uptime % 86400000) / 3600000);
            const m = Math.floor((uptime % 3600000) / 60000);
            const s = Math.floor((uptime % 60000) / 1000);
            const uptimeString = `${d}d ${h}h ${m}m ${s}s`;
            await message.reply({ embeds: [Response.createResponseEmbed(`I've been online for **${uptimeString}**.`)] });
            break;
        }

        case 'maintenance': {
            if (message.author.id !== config.BOT_OWNER_ID) {
                await message.reply({ embeds: [Response.createErrorEmbed('This is an owner-only command.')] });
                return;
            }
            const subCommand = args[0]?.toLowerCase();
            if (subCommand === 'on') {
                botState.isMaintenance = true;
                await message.reply({ embeds: [Response.createSuccessEmbed('Maintenance mode has been **enabled**.')] });
            } else if (subCommand === 'off') {
                botState.isMaintenance = false;
                await message.reply({ embeds: [Response.createSuccessEmbed('Maintenance mode has been **disabled**.')] });
            } else {
                await message.reply({ embeds: [Response.createErrorEmbed(`Invalid usage. Use \`${config.COMMAND_PREFIX} maintenance <on|off>\`.`)] });
            }
            break;
        }

        case 'reset':
            ConversationService.clearHistory(message.channel.id);
            await message.reply({ embeds: [Response.createSuccessEmbed("I've cleared our conversation history. Let's start a fresh chat!")] });
            break;

        // --- User Profile Commands ---
        case 'remember': {
            const whatToRemember = args.join(' ');
            const parts = whatToRemember.split('=').map(s => s.trim());
            if (parts.length === 2 && parts[0] && parts[1]) {
                const key = parts[0].replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
                await UserProfileService.setProfileData(message.author.id, {
                    customMemory: { ...UserProfileService.getProfile(message.author.id).customMemory, [key]: parts[1] }
                });
                await message.reply({ embeds: [Response.createSuccessEmbed(`Okay, I'll remember that \`${key}\` is "${parts[1]}".`)] });
            } else {
                await message.reply({ embeds: [Response.createErrorEmbed(`To remember something, use \`${config.COMMAND_PREFIX} remember <key>=<value>\`.`)] });
            }
            break;
        }

        case 'forget': {
            const keyToForget = args[0]?.toLowerCase();
            if (!keyToForget) {
                await message.reply({ embeds: [Response.createErrorEmbed(`Please tell me what to forget. Use \`${config.COMMAND_PREFIX} forget <key>\` or \`${config.COMMAND_PREFIX} forget all\`.`)] });
                return;
            }
            if (keyToForget === 'all') {
                await UserProfileService.clearProfileData(message.author.id);
                await message.reply({ embeds: [Response.createSuccessEmbed("I've forgotten everything I remembered about you.")] });
            } else {
                const currentMemory = UserProfileService.getProfile(message.author.id).customMemory || {};
                if (currentMemory[keyToForget]) {
                    delete currentMemory[keyToForget];
                    await UserProfileService.setProfileData(message.author.id, { customMemory: currentMemory });
                    await message.reply({ embeds: [Response.createSuccessEmbed(`Okay, I've forgotten \`${keyToForget}\`.`)] });
                } else {
                    await message.reply({ embeds: [Response.createErrorEmbed(`I don't have anything called \`${keyToForget}\` in my memory for you.`)] });
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
            if (!response) {
                response = `I don't remember anything about you yet! Use \`${config.COMMAND_PREFIX}remember <key>=<value>\` to teach me.`;
            }
            await message.reply({ embeds: [Response.createResponseEmbed(response).setTitle('Here\'s what I know')] });
            break;
        }

        case 'set-tone': {
            const tone = args.join(' ').trim();
            if (tone) {
                await UserProfileService.setProfileData(message.author.id, { tone: tone.toLowerCase() });
                await message.reply({ embeds: [Response.createSuccessEmbed(`Okay, I'll try to be more **${tone}** in our conversations!`)] });
            } else {
                await message.reply({ embeds: [Response.createErrorEmbed(`Please specify a tone, e.g., \`${config.COMMAND_PREFIX} set-tone friendly\`.`)] });
            }
            break;
        }

        case 'set-persona': {
            const persona = args.join(' ').trim();
            if (persona) {
                await UserProfileService.setProfileData(message.author.id, { persona: persona });
                await message.reply({ embeds: [Response.createSuccessEmbed(`Understood! I will now try to adopt a **${persona}** persona.`)] });
            } else {
                await message.reply({ embeds: [Response.createErrorEmbed(`Please specify a persona, e.g., \`${config.COMMAND_PREFIX} set-persona pirate\`.`)] });
            }
            break;
        }

        // --- Pre-processor Commands for Gemini ---
        case 'summarize':
        case 'extract': {
            const urlMatch = args.join(' ').match(/(https?:\/\/[^\s]+)/);
            if (!urlMatch) {
                await message.reply({ embeds: [Response.createErrorEmbed(`Please provide a URL to ${command}.`)] });
                return;
            }
            const url = urlMatch[0];
            if ('sendTyping' in message.channel) await message.channel.sendTyping();
            
            const webContent = await WebScrapingService.fetchAndExtractText(url);
            if (!webContent) {
                await message.reply({ embeds: [Response.createErrorEmbed(`I couldn't fetch content from that URL. It might be a private page or an unsupported format.`)] });
                return;
            }
            
            const prompt = command === 'summarize'
                ? `Please provide a concise summary of the following text from ${url}:\n\n${webContent}`
                : `Please extract the key information and main points from the following text from ${url}:\n\n${webContent}`;
    
            await processGeminiQuery(message, prompt, content);
            break;
        }
        
        // --- Default Case: General query for Gemini ---
        default:
            await processGeminiQuery(message, content, content);
            break;
    }
}

/**
 * Helper function to process queries with Gemini, including typing indicator and error handling.
 * @param message The Discord message object.
 * @param prompt The actual prompt to send to Gemini.
 * @param queryForHistory The original user query for history logging.
 */
async function processGeminiQuery(message: Message, prompt: string, queryForHistory: string) {
    try {
        if ('sendTyping' in message.channel) {
            await message.channel.sendTyping();
        } 

        const history = ConversationService.getHistory(message.channel.id);
        const userProfile = UserProfileService.getProfile(message.author.id);

        const responseText = await GeminiService.generateResponse(history, prompt, userProfile);

        // Add the new exchange to history
        ConversationService.addMessageToHistory(message.channel.id, 'user', queryForHistory);
        ConversationService.addMessageToHistory(message.channel.id, 'model', responseText);

        await Response.smartReply(message, responseText);

    } catch (error) {
        console.error('Error processing Gemini query:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
        await message.reply({ embeds: [Response.createErrorEmbed(`Sorry, an error occurred while talking to Gemini. \n*Details: ${errorMessage}*`)] });
    }
}
