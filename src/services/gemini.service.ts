// src/services/gemini.service.ts (DEFINITIVE, WITH 2D FALLBACK FOR KEYS AND MODELS)

import { GoogleGenAI, Content, Part, Tool, GenerateContentResponse } from '@google/genai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Initialize the primary AI client
const genAI_primary = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Initialize the secondary AI client, falling back to the primary if the key is not provided
const secondaryApiKey = process.env.GEMINI_SECONDARY_API_KEY;
const genAI_secondary = secondaryApiKey ? new GoogleGenAI({ apiKey: secondaryApiKey }) : genAI_primary;
if (!secondaryApiKey) {
    console.warn("WARN: GEMINI_SECONDARY_API_KEY is not set. Using primary API key for all AI features.");
}


/**
 * An internal function that handles the MODEL fallback (Flash -> Pro) for a GIVEN client.
 * This will be called by our main functions.
 */
async function _generateWithModelFallback(
    client: GoogleGenAI, 
    prompt: string, 
    userProfile: UserProfile, 
    conversationHistory: Content[]
): Promise<string> {
    const modelName = getModelForQuery(prompt);
    
    let history: Content[] = [config.SYSTEM_PROMPT, ...conversationHistory];
    
    const profileText = `This is my user profile, use it for context: ${JSON.stringify(userProfile.automaticMemory, null, 2)}`;
    if (userProfile.memoryEnabled && userProfile.automaticMemory && Object.keys(userProfile.automaticMemory).length > 0) {
        history.push({ role: 'user', parts: [{ text: profileText }] });
        history.push({ role: 'model', parts: [{ text: "Got it. I'll keep that in mind." }] });
    }

    const startChatSession = (modelToUse: string) => {
        const isComplex = modelToUse === config.GEMINI_MODELS.pro;
        const model = client.getGenerativeModel({
            model: modelToUse,
            tools: isComplex ? [googleSearchTool] : undefined
        });

        return model.startChat({
            history: history,
            generationConfig: config.GENERATION
        });
    };

    try {
        // First attempt with the determined model
        const chat = startChatSession(modelName);
        const result = await chat.sendMessage(prompt);
        return result.response.text();

    } catch (error) {
        // If the first attempt fails, and it wasn't already using the Pro model, try again with Pro.
        if (modelName !== config.GEMINI_MODELS.pro) {
            console.warn(`Model ${modelName} with current key failed. Falling back to Pro model.`);
            const fallbackChat = startChatSession(config.GEMINI_MODELS.pro);
            const fallbackResult = await fallbackChat.sendMessage(prompt);
            return fallbackResult.response.text();
        }
        // If it failed and was already Pro, re-throw the error to be caught by the API key fallback handler.
        throw error;
    }
}


/**
 * Generates a conversational response with a two-dimensional fallback system.
 * Tries Primary Key (Flash > Pro), then falls back to Secondary Key (Flash > Pro).
 */
export async function generateResponse(prompt: string, userProfile: UserProfile, conversationHistory: Content[] = []): Promise<string> {
    try {
        // 1. First attempt with Primary API Key
        console.log("Attempting generation with Primary API Key.");
        return await _generateWithModelFallback(genAI_primary, prompt, userProfile, conversationHistory);
    } catch (primaryError) {
        console.warn(`Primary API Key failed entirely. Error: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`);
        
        // 2. Fallback to Secondary API Key
        if (secondaryApiKey) {
            console.log("Falling back to Secondary API Key.");
            try {
                return await _generateWithModelFallback(genAI_secondary, prompt, userProfile, conversationHistory);
            } catch (secondaryError) {
                console.error(`Secondary API Key also failed. Error:`, secondaryError);
                return 'I encountered an issue with both my primary and backup AI systems. Please try again.';
            }
        }
        
        // If no secondary key is available, the error is final.
        console.error("Primary API Key failed. No secondary key available.");
        return 'I encountered an error while processing your request. Please try again.';
    }
}


/**
 * Extracts memory. Uses the SECONDARY client to offload this non-critical background task.
 */
export async function extractMemoryFromConversation(userQuery: string, userProfile: UserProfile): Promise<{ key: string, value: string } | null> {
    // This function is less critical, so we can use the secondary client to reduce primary key load.
    const clientToUse = genAI_secondary; 
    
    // ... (rest of the logic is the same as before)
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
        const model = clientToUse.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
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
 * Generates a code review. Uses the SECONDARY client.
 */
export async function generateCodeReview(code: string): Promise<string> {
    const clientToUse = genAI_secondary;
    const prompt = `You are an expert code reviewer...`; // (prompt is the same)
    
    try {
        const model = clientToUse.getGenerativeModel({ model: config.GEMINI_MODELS.pro });
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error('Error generating code review:', error);
        return 'I encountered an error while reviewing the code. Please try again.';
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
