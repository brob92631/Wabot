// src/services/gemini.service.ts (FINAL, RESTORED AND CORRECTED)

import { GoogleGenAI, Content, Part, Tool, GenerateContentResponse } from '@google/genai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Initialize the AI client
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// FIX: Define the tool at the top level so all functions can access it.
const googleSearchTool: Tool = { googleSearch: {} };

/**
 * Extracts key information from conversation history for memory formation
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
-   For a **new** memory: \`ADD::key::value\`
-   For an **updated** memory: \`UPDATE::key::new_value\`
-   If **no new facts or updates** are found: \`null\``;

    try {
        // FIX: Reverted to the original, correct syntax that works with your library version
        const model = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
        const result = await model.generateContent([
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "user", parts: [{ text: `Analyze the user's latest message now.\nUser's message: "${userQuery}"` }] }
        ]);
        
        const response = result.response;
        const text = response.text().trim();

        if (!text || text === 'null' || !text.includes('::')) return null;
        
        const parts = text.split('::');
        if (parts.length !== 3) return null;
        const [action, key, value] = parts.map((p: string) => p.trim());

        if ((action === 'ADD' || action === 'UPDATE') && key && value) {
            return { key, value };
        }
        return null;
    } catch (error) {
        console.error("Error during memory extraction:", error);
        return null;
    }
}

/**
 * Generates a code review.
 */
export async function generateCodeReview(code: string): Promise<string> {
    const prompt = `You are an expert code reviewer. Your personality is helpful and constructive.
Provide a detailed, constructive feedback on the following code snippet.
Analyze the code for logic, style, potential bugs, and suggest best-practice improvements.
Use Discord markdown for formatting.

Code to review:
${code}`;
    
    try {
        const model = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });
        const result = await model.generateContent(prompt);
        // FIX: The response object from a non-chat generation has a text() method.
        return result.response.text();
    } catch (error) {
        console.error('Error generating code review:', error);
        return 'I encountered an error while reviewing the code. Please try again.';
    }
}

/**
 * Generates a conversational response using the chat interface.
 */
export async function generateResponse(prompt: string, userProfile: UserProfile, conversationHistory: Content[] = []): Promise<string> {
    try {
        const modelName = getModelForQuery(prompt);
        const isComplexQuery = modelName === config.GEMINI_MODELS.pro;
        
        let history: Content[] = [config.SYSTEM_PROMPT, ...conversationHistory];
        
        const profileText = `This is my user profile, use it for context: ${JSON.stringify(userProfile.automaticMemory, null, 2)}`;
        if (userProfile.memoryEnabled && userProfile.automaticMemory && Object.keys(userProfile.automaticMemory).length > 0) {
            history.push({ role: 'user', parts: [{ text: profileText }] });
            history.push({ role: 'model', parts: [{ text: "Got it. I'll keep that in mind." }] });
        }

        const model = genAI.getGenerativeModel({
            model: modelName,
            tools: isComplexQuery ? [googleSearchTool] : undefined
        });

        const chat = model.startChat({
            history: history,
            generationConfig: config.GENERATION
        });

        const result = await chat.sendMessage(prompt);
        
        // FIX: The response object from a chat session has a text() method.
        return result.response.text();
    } catch (error) {
        console.error('Error generating response:', error);
        return 'I encountered an error while processing your request. Please try again.';
    }
}

/**
 * Determines which model to use based on query complexity.
 */
export function getModelForQuery(query: string): string {
    const queryLower = query.toLowerCase();
    const complexityIndicators = [
        'analyze', 'research', 'compare', 'explain in detail', 'comprehensive',
        'what are the latest', 'current events', 'recent news', 'up to date',
        'search for', 'find information', 'look up', 'investigate',
        'tell me about recent', 'what happened', 'latest updates'
    ];
    
    const hasComplexityIndicator = complexityIndicators.some(indicator => queryLower.includes(indicator));
    const isUrlProvided = /(https?:\/\/[^\s]+)/.test(query);
    const isLongQuery = query.length > 150;
    const hasQuestionWords = /\b(who|what|when|where|why|how)\b/i.test(queryLower);
    
    if (hasComplexityIndicator || isUrlProvided || isLongQuery || hasQuestionWords) {
        return config.GEMINI_MODELS.pro;
    }
    
    return config.GEMINI_MODELS.flash;
}
