// src/handlers/messageCreate.handler.ts (DEFINITIVE, CORRECTED VERSION)

import { Message, EmbedBuilder, Colors, TextChannel } from 'discord.js';
import { config } from '../config';
import { botState } from '../index';
import * as ConversationService from '../services/conversation.service';
import * as GeminiService from '../services/gemini.service';
import * as UserProfileService from '../services/userProfile.service';
import * as ReviewService from '../services/review.service'; // <-- IMPORT THE NEW SERVICE

const createSuccessEmbed = (desc: string) => new EmbedBuilder().setColor(Colors.Green).setDescription(`✅ ${desc}`);
const createErrorEmbed = (desc: string) => new EmbedBuilder().setColor(Colors.Red).setTitle('Error').setDescription(`❌ ${desc}`);

export async function handleMessageCreate(message: Message) {
    if (message.author.bot) return;
    const channel = message.channel as TextChannel;
    if (botState.isMaintenance && message.author.id !== config.BOT_OWNER_ID) return;

    const isMentioned = message.mentions.has(message.client.user!.id);
    const startsWithPrefix = message.content.startsWith(config.COMMAND_PREFIX);
    if (!isMentioned && !startsWithPrefix) return;

    let content = isMentioned
        ? message.content.replace(/<@!?\d+>/g, '').trim()
        : message.content.substring(config.COMMAND_PREFIX.length).trim();

    if (!content && isMentioned) {
        return message.reply({ embeds: [new EmbedBuilder().setColor(config.DISCORD.EMBED_COLOR).setDescription(`Hi there! Use \`${config.COMMAND_PREFIX}help\` to see what I can do.`)] });
    }

    const args = content.split(/ +/);
    const command = args.shift()?.toLowerCase();
    if (!command) return;

    try {
        switch (command) {
            case 'help': {
                const helpEmbed = new EmbedBuilder()
                    .setColor(config.DISCORD.EMBED_COLOR).setTitle('🤖 Wabot Help')
                    .setDescription(`I can now automatically search Google and understand URLs to give you the best answers. Just ask me a question or include a link!`)
                    .addFields(
                        { name: '💬 Core Commands', value: '`help`: Shows this message.\n`ping`: Checks my response time.\n`reset`: Clears our conversation history.' },
                        { name: '🧠 Memory & Profile', value: '`toggle-memory [on|off]`: Turns my memory on or off.\n`forget`: Wipes all of my memories about you.\n`forget [key]`: Makes me forget one specific thing.\n`show-my-data`: See everything I remember about you.\n`reset-profile`: Clears your entire profile (memories, tone, etc.).' },
                        { name: '✨ Other AI Features', value: '`review [code]`: Reviews a code snippet.' }
                    );
                await message.reply({ embeds: [helpEmbed] });
                break;
            }
            case 'ping': {
                const sentMsg = await message.reply({ content: 'Pinging...' });
                await sentMsg.edit(`Pong! Latency is ${sentMsg.createdTimestamp - message.createdTimestamp}ms.`);
                break;
            }
            case 'reset': {
                ConversationService.clearHistory(channel.id);
                await message.reply({ embeds: [createSuccessEmbed('Conversation history cleared.')] });
                break;
            }
            case 'toggle-memory': {
                const option = args[0]?.toLowerCase();
                if (option !== 'on' && option !== 'off') return message.reply({ embeds: [createErrorEmbed('Please specify `on` or `off`.')] });
                await UserProfileService.setProfileData(message.author.id, { memoryEnabled: option === 'on' });
                await message.reply({ embeds: [createSuccessEmbed(`Memory has been turned **${option.toUpperCase()}**.`)] });
                break;
            }
            case 'forget': {
                const key = args.join(' ').trim();
                if (!key) {
                    await UserProfileService.clearAllMemory(message.author.id);
                    await message.reply({ embeds: [createSuccessEmbed('Okay, I\'ve wiped all of my learned memories about you.')] });
                } else {
                    const success = await UserProfileService.removeMemory(message.author.id, key);
                    if (success) {
                        await message.reply({ embeds: [createSuccessEmbed(`Okay, I've forgotten about **${key}**.`)] });
                    } else {
                        await message.reply({ embeds: [createErrorEmbed(`I don't have a memory with the key **${key}**.`)] });
                    }
                }
                break;
            }
            case 'show-my-data': {
                const profile = UserProfileService.getProfile(message.author.id);
                const embed = new EmbedBuilder().setColor(config.DISCORD.EMBED_COLOR).setTitle(`${message.author.username}'s Profile Data`).setTimestamp();
                embed.addFields({ name: 'Memory Status', value: `Memory is currently **${profile.memoryEnabled ? 'ON' : 'OFF'}**.` });
                
                const autoMemory = profile.automaticMemory && Object.keys(profile.automaticMemory).length > 0
                    ? Object.entries(profile.automaticMemory).map(([k, v]) => `• **${k}**: ${v}`).join('\n')
                    : '*None yet! Just keep chatting with me.*';
                embed.addFields({ name: 'Learned Memories', value: autoMemory });

                await message.reply({ embeds: [embed] });
                break;
            }
            case 'reset-profile': {
                await UserProfileService.clearProfileData(message.author.id);
                await message.reply({ embeds: [createSuccessEmbed('Your entire user profile has been cleared.')] });
                break;
            }
            // DEDICATED 'review' COMMAND
            case 'review': {
                await channel.sendTyping();
                const codeBlockMatch = content.match(/```(?:\w*\n)?([\s\S]+)```/);
                if (!codeBlockMatch || !codeBlockMatch[1]) {
                    return message.reply({ embeds: [createErrorEmbed('Please provide a code snippet in a code block using triple backticks.')] });
                }
                const code = codeBlockMatch[1]; 

                // USE THE NEW, CLEAN SERVICE
                const responseText = await ReviewService.generateCodeReview(code);

                const chunks = responseText.match(/[\s\S]{1,2000}/g) || [];
                for (const chunk of chunks) {
                    await message.reply(chunk);
                }
                break;
            }
            default: {
                await channel.sendTyping();
                
                const prompt = `${command} ${args.join(' ')}`.trim();

                const history = ConversationService.getHistory(channel.id);
                const userProfile = UserProfileService.getProfile(message.author.id);
                
                const responseText = await GeminiService.generateResponse(prompt, userProfile, history);

                const chunks = responseText.match(/[\s\S]{1,2000}/g) || [];
                for (const chunk of chunks) {
                    await message.reply(chunk);
                }
                
                ConversationService.addMessageToHistory(channel.id, 'user', prompt);
                ConversationService.addMessageToHistory(channel.id, 'model', responseText);
                
                // FIX THE MEMORY RACE CONDITION
                if (userProfile.memoryEnabled) {
                    try {
                        const memory = await GeminiService.extractMemoryFromConversation(prompt, userProfile);
                        if (memory) {
                            await UserProfileService.setAutomaticMemory(message.author.id, memory.key, memory.value);
                        }
                    } catch (error) {
                        console.error("Failed to extract or save memory:", error);
                    }
                }
                break;
            }
        }
    } catch (error) {
        console.error("Fatal error in command router:", error);
    }
}
