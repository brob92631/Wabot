// src/services/gemini.service.ts (DEFINITIVE, BASED ON YOUR WORKING ZIP)

import { GoogleGenAI, Content, Part, Tool } from '@google/genai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Initialize the AI client with the correct class name
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Define Google Search grounding tool
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
        const result = await genAI.models.generateContent({
            model: config.GEMINI_MODELS.flash,
            contents: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "user", parts: [{ text: `Analyze the user's latest message now.\nUser's message: "${userQuery}"` }] }
            ],
            // CORRECTED: The parameter is 'config', not 'generationConfig'
            config: {
                temperature: 0
            }
        });
        
        // CORRECTED: The response text is on result.text, not result.response.text()
        const text = result.text?.trim();
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
    const prompt = `You are an expert code reviewer...`; // (Full prompt text is not needed here)
    try {
        const result = await genAI.models.generateContent({
            model: config.GEMINI_MODELS.pro,
            contents: [{ role: 'user', parts: [{ text: prompt + `\n\n${code}` }] }],
            config: config.GENERATION
        });
        return result.text?.trim() || 'I was unable to generate a code review.';
    } catch (error) {
        console.error('Error generating code review:', error);
        return 'I encountered an error while reviewing the code. Please try again.';
    }
}

/**
 * Generates response using appropriate model based on query complexity
 */
export async function generateResponse(prompt: string, userProfile: UserProfile, conversationHistory: Content[] = []): Promise<string> {
    try {
        const modelName = getModelForQuery(prompt);
        const isComplexQuery = modelName === config.GEMINI_MODELS.pro;
        
        const history: Content[] = [config.SYSTEM_PROMPT, ...conversationHistory];
        
        const profileText = `This is my user profile, use it for context: ${JSON.stringify(userProfile.automaticMemory, null, 2)}`;
        if (userProfile.memoryEnabled && userProfile.automaticMemory && Object.keys(userProfile.automaticMemory).length > 0) {
            history.push({ role: 'user', parts: [{ text: profileText }] });
            history.push({ role: 'model', parts: [{ text: "Got it. I'll keep that in mind." }] });
        }

        const chat = genAI.chats.create({
            model: modelName,
            history: history,
            config: {
                ...config.GENERATION,
                tools: isComplexQuery ? [googleSearchTool] : undefined
            }
        });

        const result = await chat.sendMessage(prompt);
        
        // CORRECTED: The response text is on result.text, not result.response.text()
        return result.text || 'I apologize, but I was unable to generate a response at this time.';
    } catch (error) {
        console.error('Error generating response:', error);
        return 'I encountered an error while processing your request. Please try again.';
    }
}

/**
 * Determines which model to use based on query complexity and requirements
 */
export function getModelForQuery(query: string): string {
    const queryLower = query.toLowerCase();
    // ... (rest of the function is the same)
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
