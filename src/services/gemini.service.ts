// src/services/gemini.service.ts (UPDATED)

import { GoogleGenAI, Content, Tool } from '@google/genai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// --- KEY CHANGES START HERE ---

// Initialize the PRIMARY AI client for general chat and memory
const primaryGenAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Initialize the SECONDARY AI client for specific tasks like code review
// It falls back to the primary key if the secondary one is not provided.
const secondaryGenAI = new GoogleGenAI({ 
    apiKey: process.env.GEMINI_SECONDARY_API_KEY || process.env.GEMINI_API_KEY! 
});

// --- KEY CHANGES END HERE ---


/**
 * Extracts key information from conversation history for memory formation.
 * Uses the primary, general-purpose client.
 */
export async function extractMemoryFromConversation(userQuery: string, userProfile: UserProfile): Promise<{ key: string, value: string } | null> {
    const existingMemories = JSON.stringify(userProfile.automaticMemory || {}, null, 2);
    const systemPrompt = `You are a sophisticated AI memory assistant. Your job is to analyze the user's latest message and their existing memories to maintain a profile of core facts.
**EXISTING MEMORIES:**
${existingMemories}
**YOUR TASK:**
1.  **Identify New Facts:** Look for new, core, long-term facts about the user (name, job, core preferences, hometown).
2.  **Identify Updates:** Check if the user is correcting or updating an existing memory.
**RULES:**
-   IGNORE temporary states ("I'm tired"), conversational filler, questions, or commands.
-   Focus ONLY on explicit facts about the user.
**OUTPUT FORMAT (IMPORTANT - CHOOSE ONE):**
-   For a **new** or **updated** memory: \`SAVE::key::value\`
-   If **no new facts or updates** are found: \`null\``;

    try {
        // CHANGED: Uses the primary client
        const result = await primaryGenAI.models.generateContent({
            model: config.GEMINI_MODELS.flash,
            contents: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "user", parts: [{ text: `Analyze the user's latest message now.\nUser's message: "${userQuery}"` }] }
            ],
            config: {
                temperature: 0
            }
        });
        
        const text = result.text?.trim();
        if (!text || text === 'null' || !text.includes('::')) return null;
        
        const parts = text.split('::');
        if (parts.length !== 3) return null;
        const [action, key, value] = parts.map((p: string) => p.trim());

        if (action === 'SAVE' && key && value) {
            return { key, value };
        }
        return null;
    } catch (error) {
        console.error("Error during memory extraction:", error);
        return null;
    }
}

/**
 * Generates a dedicated code review.
 * This function now uses the SECONDARY client to isolate its API usage.
 */
export async function generateCodeReview(code: string): Promise<string> {
    const prompt = `You are an expert code reviewer. Your personality is helpful and constructive.
Provide a detailed, constructive feedback on the following code snippet.
Analyze the code for logic, style, potential bugs, and suggest best-practice improvements.
Use Discord markdown for formatting.

Code to review:
\`\`\`
${code}
\`\`\``;

    try {
        // CHANGED: Uses the secondary client
        const result = await secondaryGenAI.models.generateContent({
            model: config.GEMINI_MODELS.pro, // Use the more powerful model for code
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: config.GENERATION
        });

        return result.text?.trim() || 'I was unable to generate a code review for some reason.';
    } catch (error) {
        console.error('Error generating code review:', error);
        return 'I encountered an error while reviewing the code. Please try again.';
    }
}


/**
 * Generates a conversational response using the chat-based API pattern.
 * Uses the primary, general-purpose client.
 */
export async function generateResponse(prompt: string, userProfile: UserProfile, conversationHistory: Content[] = []): Promise<string> {
    try {
        const modelName = getModelForQuery(prompt);
        const isComplexQuery = modelName === config.GEMINI_MODELS.pro;
        
        const history: Content[] = [config.SYSTEM_PROMPT, ...conversationHistory];
        
        const profileText = `This is my user profile, use it for context: ${JSON.stringify(userProfile.automaticMemory, null, 2)}`;
        if (userProfile.memoryEnabled && userProfile.automaticMemory && Object.keys(userProfile.automaticMemory).length > 0) {
            history.push({ role: 'user', parts: [{ text: profileText }] });
            history.push({ role: 'model', parts: [{ text: "Understood. I'll use this context for my response." }] });
        }

        // CHANGED: Uses the primary client
        const chat = primaryGenAI.chats.create({
            model: modelName,
            history: history,
            config: {
                ...config.GENERATION,
                tools: isComplexQuery ? [{ googleSearch: {} }] : undefined
            }
        });

        const result = await chat.sendMessage({
            message: prompt
        });
        
        return result.text || 'I apologize, but I was unable to generate a response at this time.';
    } catch (error) {
        console.error('Error generating response:', error);
        return 'I encountered an error while processing your request. Please try again.';
    }
}

/**
 * Determines which model to use based on query complexity and requirements.
 */
export function getModelForQuery(query: string): string {
    const queryLower = query.toLowerCase();
    const complexityIndicators = [
        'analyze', 'research', 'compare', 'explain in detail', 'comprehensive',
        'what are the latest', 'current events', 'recent news', 'up to date',
        'search for', 'find information', 'look up', 'investigate',
        'tell me about recent', 'what happened', 'latest updates', 'review'
    ];
    
    if (queryLower.startsWith('review')) {
        return config.GEMINI_MODELS.pro;
    }
    
    const hasComplexityIndicator = complexityIndicators.some(indicator => queryLower.includes(indicator));
    const isUrlProvided = /(https?:\/\/[^\s]+)/.test(query);
    const isLongQuery = query.length > 150;
    const hasQuestionWords = /\b(who|what|when|where|why|how)\b/i.test(queryLower);
    
    if (hasComplexityIndicator || isUrlProvided || (isLongQuery && hasQuestionWords)) {
        return config.GEMINI_MODELS.pro;
    }
    
    return config.GEMINI_MODELS.flash;
}
