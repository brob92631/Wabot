// src/services/gemini.service.ts (DEFINITIVE, FINAL, CORRECTED VERSION)

import { GoogleGenAI, Content, Part, Tool, GenerateContentResponse } from '@google/genai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Initialize the AI client
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Define the tool at the top level so all functions can access it.
const googleSearchTool: Tool = { googleSearch: {} };

/**
 * A safe way to extract text from a Gemini response, accounting for the candidates array.
 */
function getResponseText(response: GenerateContentResponse): string {
    // The key insight: The text is inside the 'candidates' array.
    if (response.candidates && response.candidates.length > 0) {
        // Check for content to avoid errors on empty responses
        if (response.candidates[0].content && response.candidates[0].content.parts.length > 0) {
            return response.candidates[0].content.parts[0].text?.trim() || '';
        }
    }
    console.warn("Gemini response was empty or had no candidates.");
    return ''; // Return empty string if no valid text is found
}


/**
 * Extracts key information from conversation history for memory formation
 */
export async function extractMemoryFromConversation(userQuery: string, userProfile: UserProfile): Promise<{ key: string, value: string } | null> {
    const existingMemories = JSON.stringify(userProfile.automaticMemory || {}, null, 2);
    const systemPrompt = `You are a sophisticated AI memory assistant...`; // Same prompt

    try {
        const model = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
        const result = await model.generateContent([
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "user", parts: [{ text: `Analyze the user's latest message now.\nUser's message: "${userQuery}"` }] }
        ]);
        
        const text = getResponseText(result.response);

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
    const prompt = `You are an expert code reviewer...`; // Same prompt
    
    try {
        const model = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });
        const result = await model.generateContent(prompt + `\n\n${code}`);
        return getResponseText(result.response);
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
        
        const profileText = `This is my user profile...`; // Same logic
        if (userProfile.memoryEnabled && userProfile.automaticMemory && Object.keys(userProfile.automaticMemory).length > 0) {
            const fullProfileText = `This is my user profile, use it for context: ${JSON.stringify(userProfile.automaticMemory, null, 2)}`;
            history.push({ role: 'user', parts: [{ text: fullProfileText }] });
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
        
        return getResponseText(result.response);
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
