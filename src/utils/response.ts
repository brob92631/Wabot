// src/utils/response.ts

import { EmbedBuilder, Message, Colors, MessagePayload, MessageReplyOptions } from 'discord.js';
import { config } from '../config';

/**
 * Creates a standard, styled embed.
 */
const createBaseEmbed = () => new EmbedBuilder().setColor(Colors.Blurple); // FIX: Use the type-safe Colors.Blurple

/**
 * Creates an embed for a standard response.
 * @param description The main text of the embed.
 */
export const createResponseEmbed = (description: string) =>
    createBaseEmbed().setDescription(description);

/**
 * Creates an embed for a successful action.
 * @param description The success message.
 */
export const createSuccessEmbed = (description: string) =>
    createBaseEmbed()
        .setColor(Colors.Green) // FIX: Use type-safe Colors.Green
        .setDescription(`✅ ${description}`);

/**
 * Creates an embed for an error message.
 * @param description The error details.
 */
export const createErrorEmbed = (description:string) =>
    createBaseEmbed()
        .setColor(Colors.Red) // FIX: Use type-safe Colors.Red
        .setTitle('Oops! Something went wrong.')
        .setDescription(`❌ ${description}`);

/**
 * Creates the help embed with all commands listed.
 */
export const createHelpEmbed = () => {
    const prefix = config.COMMAND_PREFIX;
    return createBaseEmbed()
        .setTitle('🤖 Wabot Help Menu')
        .setDescription(`You can talk to me by mentioning me (\`@Wabot\`) or by using the prefix \`${prefix}\`.\nExample: \`${prefix} what is a closure in javascript?\``)
        .addFields(
            { name: '🧠 Core Commands', value: `
- \`${prefix} help\`: Shows this help menu.
- \`${prefix} reset\`: Clears our conversation history in this channel.
- \`${prefix} <question>\`: Ask me anything!
            ` },
            { name: '📝 Content & Web', value: `
- \`${prefix} review <code>\`: Get a code review.
- \`${prefix} summarize <url>\`: Summarize a webpage.
- \`${prefix} extract <url>\`: Extract key info from a webpage.
            ` },
            { name: '👤 User Profile', value: `
- \`${prefix} remember <key>=<value>\`: I'll remember a piece of info about you.
- \`${prefix} forget <key|all>\`: I'll forget a piece of info or everything.
- \`${prefix} show-my-data\`: Shows what I remember about you.
- \`${prefix} set-tone <tone>\`: Sets my tone (e.g., \`humorous\`).
- \`${prefix} set-persona <persona>\`: Sets my persona (e.g., \`pirate\`).
            ` },
            { name: '🛠️ Developer & Utility', value: `
- \`${prefix} ping\`: Checks my response time.
- \`${prefix} uptime\`: Shows how long I've been online.
            `},
        )
        .setFooter({ text: 'Wabot | Powered by Google Gemini' })
        .setTimestamp();
};

/**
 * A smart reply function that uses embeds for shorter messages and splits longer ones.
 * This is ideal for Gemini responses that might contain long code blocks.
 * @param message The original message object to reply to.
 * @param content The text content of the reply.
 */
export async function smartReply(message: Message, content: string) {
    // FIX: Add a type guard to ensure we are in a channel that can receive messages.
    // This resolves the "Property 'send' does not exist" error.
    if (!message.channel || !message.channel.isTextBased()) {
        console.error("Cannot send message in a non-text-based channel.");
        return;
    }
    
    const trimmedContent = content.trim();

    if (!trimmedContent) {
        await message.reply({ embeds: [createErrorEmbed("I received an empty response. Please try again.")] });
        return;
    }

    // Use a simple embed for reasonably sized responses (under Discord's embed description limit)
    if (trimmedContent.length <= 4096) {
        await message.reply({ embeds: [createResponseEmbed(trimmedContent)] });
        return; // Exit after sending the embed
    }
    
    // For very long responses, split the message into raw text chunks
    // This is better for readability and for copying large code blocks
    const chunks = trimmedContent.match(/[\s\S]{1,2000}/g) || [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]; // chunk is guaranteed to be a string here
        try {
            if (i === 0) {
                // Reply to the user with the first chunk
                await message.reply(chunk);
            } else {
                // Send subsequent chunks in the channel
                await message.channel.send(chunk);
            }
        } catch (error) {
            console.error("Failed to send a message chunk:", error);
            // If one chunk fails, send an error and stop to avoid spam
            await message.channel.send({ embeds: [createErrorEmbed("I couldn't send the full response because it was too long or something went wrong.")] });
            break;
        }
    }
}
