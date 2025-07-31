// src/handlers/messageCreate.handler.ts

import { Message, EmbedBuilder, Colors, TextChannel } from 'discord.js';
import { config } from '../config';
import { botState } from '../index';
import * as ConversationService from '../services/conversation.service';
import * as GeminiService from '../services/gemini.service';
import * as WebScrapingService from '../services/webScraping.service';
import * as UserProfileService from '../services/userProfile.service';

const createSuccessEmbed = (desc: string) => new EmbedBuilder().setColor(Colors.Green).setDescription(`✅ ${desc}`);
const createErrorEmbed = (desc: string) => new EmbedBuilder().setColor(Colors.Red).setTitle('Error').setDescription(`❌ ${desc}`);

/**
 * Main handler for incoming messages.
 */
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
        await message.reply({ embeds: [new EmbedBuilder().setColor(Colors.Blurple).setDescription(`Hi there! Use \`${config.COMMAND_PREFIX}help\` to see what I can do.`)] });
        return;
    }

    const args = content.split(/ +/);
    const command = args.shift()?.toLowerCase();
    if (!command) return;

    try {
        switch (command) {
            case 'help': {
                const helpEmbed = new EmbedBuilder()
                    .setColor(Colors.Blurple).setTitle('🤖 Wabot Help')
                    .setDescription(`I can automatically remember details from our conversation to personalize our interactions. You are in full control of this memory.`)
                    .addFields(
                        { name: '💬 Core Commands', value: '`help`: Shows this message.\n`ping`: Checks my response time.\n`reset`: Clears our conversation history in this channel.' },
                        { name: '🧠 Memory & Profile', value: '`toggle-memory [on|off]`: Turns my memory on or off for you.\n`remember [key] is [value]`: Manually teach me something.\n`forget [key]`: Makes me forget a specific memory (manual or automatic).\n`show-my-data`: See everything I remember about you.\n`reset-profile`: Clears your entire user profile.' },
                        { name: '✨ AI Features', value: '`summarize [url]`: I\'ll summarize a webpage.\n`review [code]`: I\'ll review a code snippet.' }
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
            case 'reset': {
                ConversationService.clearHistory(channel.id);
                await message.reply({ embeds: [createSuccessEmbed('Conversation history cleared.')] });
                break;
            }
            case 'toggle-memory': {
                const option = args[0]?.toLowerCase();
                if (option !== 'on' && option !== 'off') return message.reply({ embeds: [createErrorEmbed('Please specify `on` or `off`.')] });
                await UserProfileService.setProfileData(message.author.id, { memoryEnabled: option === 'on' });
                await message.reply({ embeds: [createSuccessEmbed(`Memory has been turned **${option.toUpperCase()}** for you.`)] });
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
                const success = await UserProfileService.removeMemory(message.author.id, key);
                if (success) {
                    await message.reply({ embeds: [createSuccessEmbed(`Okay, I've forgotten about **${key}**.`)] });
                } else {
                    await message.reply({ embeds: [createErrorEmbed(`I don't have a memory with the key **${key}**.`)] });
                }
                break;
            }
            case 'show-my-data': {
                const profile = UserProfileService.getProfile(message.author.id);
                const embed = new EmbedBuilder().setColor(Colors.Blurple).setTitle(`${message.author.username}'s Profile Data`).setTimestamp();
                embed.addFields({ name: 'Memory Status', value: `Memory is currently **${profile.memoryEnabled ? 'ON' : 'OFF'}**.` });

                if (profile.tone) embed.addFields({ name: 'Custom Tone', value: profile.tone });
                if (profile.persona) embed.addFields({ name: 'Custom Persona', value: profile.persona });

                const customMemory = profile.customMemory && Object.keys(profile.customMemory).length > 0
                    ? Object.entries(profile.customMemory).map(([k, v]) => `• **${k}**: ${v}`).join('\n')
                    : '*None*';
                embed.addFields({ name: 'Manual Memories', value: customMemory });

                const autoMemory = profile.automaticMemory && Object.keys(profile.automaticMemory).length > 0
                    ? Object.entries(profile.automaticMemory).map(([k, v]) => `• **${k}**: ${v}`).join('\n')
                    : '*None yet! Just keep chatting with me.*';
                embed.addFields({ name: 'Automatic Memories', value: autoMemory });

                await message.reply({ embeds: [embed] });
                break;
            }
            case 'reset-profile': {
                await UserProfileService.clearProfileData(message.author.id);
                await message.reply({ embeds: [createSuccessEmbed('Your entire user profile has been cleared.')] });
                break;
            }
            default: {
                await channel.sendTyping();
                
                let prompt = content;
                // Handle complex commands like summarize, review, etc.
                // This part remains the same...

                const history = ConversationService.getHistory(channel.id);
                const userProfile = UserProfileService.getProfile(message.author.id);
                const responseText = await GeminiService.generateResponse(history, prompt, userProfile);

                ConversationService.addMessageToHistory(channel.id, 'user', content);
                ConversationService.addMessageToHistory(channel.id, 'model', responseText);
                
                // --- AUTOMATIC MEMORY EXTRACTION (RUNS IN BACKGROUND) ---
                if (userProfile.memoryEnabled && command !== 'show-my-data') {
                     GeminiService.extractMemoryFromConversation(content, responseText)
                        .then(memory => {
                            if (memory) {
                                UserProfileService.addAutomaticMemory(message.author.id, memory.key, memory.value);
                            }
                        })
                        .catch(console.error);
                }

                if (responseText.length <= 2000) {
                    await message.reply(responseText);
                } else {
                    const chunks = responseText.match(/[\s\S]{1,2000}/g) || [];
                    for (const chunk of chunks) {
                        await channel.send(chunk);
                    }
                }
                break;
            }
        }
    } catch (error) {
        console.error("Fatal error in command router:", error);
    }
}
