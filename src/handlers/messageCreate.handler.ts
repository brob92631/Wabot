// src/handlers/messageCreate.handler.ts

import { Message } from 'discord.js';
import { config } from '../config';
import * as ConversationService from '../services/conversation.service';
import * as GeminiService from '../services/gemini.service';

/**
 * Handles the logic for incoming messages.
 * @param message The Discord message object.
 */
export async function handleMessageCreate(message: Message) {
    // Ignore bots
    if (message.author.bot) return;

    // --- NEW, ROBUST TYPE GUARD ---
    // Ensure the channel is a type that can send messages before proceeding.
    // This resolves the TS build error definitively.
    if (!message.channel.isTextBased()) {
        return;
    }

    const isMentioned = message.mentions.has(message.client.user!.id);
    const startsWithPrefix = message.content.startsWith(config.COMMAND_PREFIX + ' ');

    // Ignore messages without the prefix or a mention
    if (!isMentioned && !startsWithPrefix) return;

    // Extract the query
    let query = '';
    if (isMentioned) {
        query = message.content.replace(/<@!?\d+>/, '').trim();
    } else { // startsWithPrefix
        query = message.content.slice(config.COMMAND_PREFIX.length + 1).trim();
    }

    if (!query) {
        await message.reply('Hello! How can I help you today? You can ask me a question, or type `w help` for more options.');
        return;
    }
    
    // Handle special commands
    if (query.toLowerCase() === 'help') {
        const helpText = `
**Wabot Commands**
- \`w <your question>\`: Ask me anything!
- \`@Wabot <your question>\`: Mention me to ask a question.
- \`w reset\`: I will forget our current conversation in this channel.
- \`w help\`: Shows this help message.

I remember the last few messages in our conversation for context. If you want to start fresh, just use the reset command!
        `;
        await message.reply(helpText);
        return;
    }

    if (query.toLowerCase() === 'reset') {
        ConversationService.clearHistory(message.channel.id);
        await message.reply('I\'ve cleared our conversation history. Let\'s start a fresh chat!');
        return;
    }

    // Process the query with Gemini
    try {
        // Now this is guaranteed to be safe because of the check at the top.
        await message.channel.sendTyping();

        const history = ConversationService.getHistory(message.channel.id);
        const responseText = await GeminiService.generateResponse(history, query);

        // Add the new exchange to history
        ConversationService.addMessageToHistory(message.channel.id, 'user', query);
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
