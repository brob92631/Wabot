// src/services/conversation.service.ts

import { Content } from '@google/generative-ai';
import { config } from '../config';

// In-memory cache for conversation histories. Key: channelId, Value: message history
const conversationHistories = new Map<string, Content[]>();

/**
 * Adds a new message to a channel's conversation history.
 * @param channelId The ID of the channel.
 * @param role The role of the sender ('user' or 'model').
 * @param text The content of the message.
 */
export function addMessageToHistory(channelId: string, role: 'user' | 'model', text: string) {
    if (!conversationHistories.has(channelId)) {
        conversationHistories.set(channelId, []);
    }

    const history = conversationHistories.get(channelId)!;
    
    history.push({ role, parts: [{ text }] });

    // Ensure the history does not exceed the maximum length
    if (history.length > config.MAX_HISTORY_MESSAGES) {
        // Remove the oldest two messages (one user, one model) to keep the conversation flowing
        conversationHistories.set(channelId, history.slice(2));
    }
}

/**
 * Retrieves the conversation history for a given channel.
 * @param channelId The ID of the channel.
 * @returns The array of Content objects representing the history.
 */
export function getHistory(channelId: string): Content[] {
    return conversationHistories.get(channelId) || [];
}

/**
 * Clears the conversation history for a given channel.
 * @param channelId The ID of the channel.
 */
export function clearHistory(channelId: string) {
    conversationHistories.delete(channelId);
}
