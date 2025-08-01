// src/services/conversation.service.ts
import { Content, Part } from '@google/genai';
import { config } from '../config';

const conversationHistories = new Map<string, Content[]>();

/**
 * Adds a message to the conversation history for a specific channel
 */
export function addMessageToHistory(channelId: string, role: 'user' | 'model', text: string): void {
    if (!conversationHistories.has(channelId)) {
        conversationHistories.set(channelId, []);
    }
    
    const history = conversationHistories.get(channelId)!;
    
    const newContent: Content = {
        role,
        parts: [{ text } as Part]
    };
    
    history.push(newContent);
    
    // Keep only the last N messages to manage memory
    if (history.length > config.MAX_HISTORY_MESSAGES * 2) { // Keep a bit more for context
        history.splice(0, history.length - (config.MAX_HISTORY_MESSAGES * 2));
    }
}

/**
 * Retrieves the conversation history for a specific channel
 */
export function getHistory(channelId: string): Content[] {
    return conversationHistories.get(channelId) || [];
}

/**
 * Clears the conversation history for a specific channel
 */
export function clearHistory(channelId: string): void {
    conversationHistories.delete(channelId);
}
