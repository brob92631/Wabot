// src/utils/response.ts

import { EmbedBuilder, Message, Colors } from 'discord.js';
import { config } from '../config';

/**
 * Creates a standard, styled embed.
 */
const createBaseEmbed = () => new EmbedBuilder().setColor(Colors.Blurple);

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
        .setColor(Colors.Green)
        .setDescription(`✅ ${description}`);

/**
 * Creates an embed for an error message.
 * @param description The error details.
 */
export const createErrorEmbed = (description:string) =>
    createBaseEmbed()
        .setColor(Colors.Red)
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
    // Type guard: ensure we are in a channel that can receive messages.
    // The optional chaining (?.) is a small safety improvement.
    if (!message.channel?.isTextBased()) {
        console.error("Cannot send message in a non-text-based channel.");
        return;
    }
    
    // *** THE FIX ***
    // Store the narrowed channel in a variable. TypeScript will remember its type.
    const channel = message.channel;

    const trimmedContent = content.trim();

    if (!trimmedContent) {
        await message.reply({ embeds: [createErrorEmbed("I received an empty response. Please try again.")] });
        return;
    }

    if (trimmedContent.length <= 4096) {
        await message.reply({ embeds: [createResponseEmbed(trimmedContent)] });
        return;
    }
    
    const chunks = trimmedContent.match(/[\s\S]{1,2000}/g) || [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        try {
            if (i === 0) {
                await message.reply(chunk);
            } else {
                // Use the type-safe 'channel' variable
                await channel.send(chunk);
            }
        } catch (error) {
            console.error("Failed to send a message chunk:", error);
            // Use the type-safe 'channel' variable here too
            await channel.send({ embeds: [createErrorEmbed("I couldn't send the full response because it was too long or something went wrong.")] });
            break;
        }
    }
}
