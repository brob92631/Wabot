// src/handlers/messageCreate.handler.ts

import { Message, EmbedBuilder, Colors, TextChannel, AttachmentBuilder, ActivityType } from 'discord.js';
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

    const channel = message.channel as TextChannel;
    
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
                    .setDescription(`You can mention me or use the prefix \`${config.COMMAND_PREFIX}\`. I remember conversations in each channel.`)
                    .addFields(
                        { name: '💬 Core', value: '`help`: Shows this message.\n`ping`: Checks my response time.\n`uptime`: Shows how long I\'ve been online.\n`reset`: Clears our conversation history in this channel.' },
                        { name: '🧠 Profile', value: '`set-tone [tone]`: Set my tone (e.g., witty, formal).\n`set-persona [persona]`: Set my persona (e.g., pirate, scientist).\n`remember [key] is [value]`: Teach me something about you.\n`forget [key]`: Make me forget something.\n`show-my-data`: See what I remember about you.\n`reset-profile`: Clears your entire user profile.' },
                        { name: '✨ AI Features', value: '`debate [topic]`: I\'ll take a stance and debate you.\n`review [code]`: I\'ll review a code snippet for you.\n`summarize [url]`: I\'ll summarize the content of a webpage.\n`extract [url]`: I\'ll extract the main text from a webpage.\n\n*Note: Text-to-speech is currently unavailable*' }
                    )
                    .setFooter({ text: 'Any other message will start a normal conversation!' });
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
                ConversationService.clearHistory(channel.id);
                await message.reply({ embeds: [createSuccessEmbed('Conversation history cleared.')] });
                break;
            }
            case 'set-tone': {
                const tone = args.join(' ');
                if (!tone) return message.reply({ embeds: [createErrorEmbed('Please provide a tone, e.g., `set-tone witty and slightly sarcastic`.')] });
                await UserProfileService.setProfileData(message.author.id, { tone });
                await message.reply({ embeds: [createSuccessEmbed(`My tone has been set to: **${tone}**`)] });
                break;
            }
            case 'set-persona': {
                const persona = args.join(' ');
                if (!persona) return message.reply({ embeds: [createErrorEmbed('Please provide a persona, e.g., `set-persona a helpful librarian`.')] });
                await UserProfileService.setProfileData(message.author.id, { persona });
                await message.reply({ embeds: [createSuccessEmbed(`My persona has been set to: **${persona}**`)] });
                break;
            }
            case 'remember': {
                const memoryString = args.join(' ');
                const match = memoryString.match(/(.+) is (.+)/i);
                if (!match) return message.reply({ embeds: [createErrorEmbed('Please use the format `remember [key] is [value]`.')] });
                const [, key, value] = match;
                await UserProfileService.addCustomMemory(message.author.id, key.trim(), value.trim());
                await message.reply({ embeds: [createSuccessEmbed(`Okay, I'll remember that **${key.trim()}** is **${value.trim()}**.`)] });
                break;
            }
            case 'forget': {
                const key = args.join(' ');
                if (!key) return message.reply({ embeds: [createErrorEmbed('Please tell me what to forget.')] });
                await UserProfileService.removeCustomMemory(message.author.id, key);
                await message.reply({ embeds: [createSuccessEmbed(`Okay, I've forgotten about **${key}**.`)] });
                break;
            }
            case 'show-my-data': {
                const profile = UserProfileService.getProfile(message.author.id);
                const embed = new EmbedBuilder().setColor(Colors.Blurple).setTitle(`${message.author.username}'s Profile Data`).setTimestamp();
                const hasData = profile && (profile.tone || profile.persona || (profile.customMemory && Object.keys(profile.customMemory).length > 0));
                if (!hasData) {
                    embed.setDescription("I don't have any data stored for you yet!");
                } else {
                    embed.setDescription("Here's what I know about you. Use `forget [key]` or `reset-profile` to remove data.");
                    if (profile.tone) embed.addFields({ name: 'Tone', value: profile.tone });
                    if (profile.persona) embed.addFields({ name: 'Persona', value: profile.persona });
                    if (profile.customMemory && Object.keys(profile.customMemory).length > 0) {
                        const memoryString = Object.entries(profile.customMemory).map(([k, v]) => `• **${k}**: ${v}`).join('\n');
                        embed.addFields({ name: 'Custom Memories', value: memoryString });
                    }
                }
                await message.reply({ embeds: [embed] });
                break;
            }
            case 'reset-profile': {
                await UserProfileService.clearProfileData(message.author.id);
                await message.reply({ embeds: [createSuccessEmbed('Your entire user profile has been cleared.')] });
                break;
            }
            case 'say': {
                // TTS is not available with Gemini
                await message.reply({ embeds: [createErrorEmbed('Text-to-speech is currently unavailable. Please use Google Text-to-Speech API or another TTS service.')] });
                break;
            }
            default: {
                await channel.sendTyping();
                
                let prompt = content;

                if (command === 'summarize' || command === 'extract') {
                    const urlMatch = args.join(' ').match(/(https?:\/\/[^\s]+)/);
                    if (!urlMatch) {
                        await message.reply({ embeds: [createErrorEmbed(`Please provide a URL to ${command}.`)] });
                        return;
                    }
                    const thinkingMessage = await message.reply(`🔎 Fetching content from the URL for \`${command}\`...`);
                    const webContent = await WebScrapingService.fetchAndExtractText(urlMatch[0]);
                    if (!webContent) {
                        await thinkingMessage.edit({ embeds: [createErrorEmbed(`Could not fetch content from that URL.`)] });
                        return;
                    }
                    await thinkingMessage.delete().catch(() => {});
                    prompt = `${command} the following text:\n\n${webContent}`;
                } else if (command === 'review') {
                    const codeBlockMatch = content.match(/```(?:\w*\n)?([\s\S]+)```/);
                    if (!codeBlockMatch) {
                        await message.reply({ embeds: [createErrorEmbed('Please provide a code snippet in a code block (e.g., \\`\\`\\`js ... \\`\\`\\`).')] });
                        return;
                    }
                    prompt = `Please provide a detailed review of the following code snippet. Analyze it for potential bugs, suggest improvements for performance and readability, and explain what the code does:\n\n${codeBlockMatch[0]}`;
                } else if (command === 'debate') {
                    const topic = args.join(' ');
                    if (!topic) {
                        await message.reply({ embeds: [createErrorEmbed('Please provide a topic to debate!')] });
                        return;
                    }
                    prompt = `You are a debater. Take a strong, random stance (either for or against) on the topic: "${topic}". State your initial position clearly and provide three supporting points. Await the user's counter-argument. Engage in a spirited but respectful debate.`;
                }

                const history = ConversationService.getHistory(channel.id);
                const userProfile = UserProfileService.getProfile(message.author.id);
                const responseText = await GeminiService.generateResponse(history, prompt, userProfile);

                ConversationService.addMessageToHistory(channel.id, 'user', content);
                ConversationService.addMessageToHistory(channel.id, 'model', responseText);

                const trimmed = responseText.trim();
                if (!trimmed) {
                    await message.reply({ embeds: [createErrorEmbed("Received an empty response.")] });
                    return;
                }
                
                if (trimmed.length <= 2000) {
                    await message.reply(trimmed);
                } else {
                    const chunks = trimmed.match(/[\s\S]{1,2000}/g) || [];
                    for (const chunk of chunks) {
                        await channel.send(chunk);
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
