// src/services/gemini.service.ts (FINAL, CORRECTED VERSION)

import { GoogleGenAI, Content, Part, Tool, GenerateContentResponse } from '@google/genai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Initialize the AI client
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Define the tool at the top level so all functions can access it.
const googleSearchTool: Tool = { googleSearch: {} };

/**
 * A robust, centralized function to generate content with a Flash-to-Pro fallback.
 * This is the core function that all other functions will now use.
 * It uses the client.models.generateContent() syntax to avoid the previous errors.
 */
async function generateContentWithFallback(request: {
    contents: Content[],
    tools?: Tool[],
    modelToUse?: 'flash' | 'pro'
}): Promise<GenerateContentResponse> {
    const modelName = request.modelToUse === 'pro' 
        ? config.GEMINI_MODELS.pro 
        : config.GEMINI_MODELS.flash;

    try {
        const result = await genAI.models.generateContent({
            model: modelName,
            contents: request.contents,
            tools: request.tools,
            generationConfig: config.GENERATION,
        });
        return result;
    } catch (error) {
        // If the first attempt fails and it wasn't already the Pro model, fallback to Pro.
        if (modelName !== config.GEMINI_MODELS.pro) {
            console.warn(`Model ${modelName} failed. Falling back to Pro model.`);
            const fallbackResult = await genAI.models.generateContent({
                model: config.GEMINI_MODELS.pro,
                contents: request.contents,
                tools: request.tools,
                generationConfig: config.GENERATION,
            });
            return fallbackResult;
        }
        // If it was already Pro, re-throw the error.
        throw error;
    }
}

/**
 * Extracts key information from conversation history for memory formation
 */
export async function extractMemoryFromConversation(userQuery: string, userProfile: UserProfile): Promise<{ key: string, value: string } | null> {
    const existingMemories = JSON.stringify(userProfile.automaticMemory || {}, null, 2);
    const systemPrompt = `You are a sophisticated AI memory assistant...`; // (Full prompt text)

    try {
        const result = await generateContentWithFallback({
            contents: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "user", parts: [{ text: `Analyze the user's latest message now.\nUser's message: "${userQuery}"` }] }
            ],
            modelToUse: 'flash' // Always use flash for this simple task
        });
        
        const text = result.response.text().trim();
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
    const prompt = `You are an expert code reviewer...`; // (Full prompt text)
    
    try {
        const result = await generateContentWithFallback({
            contents: [{ role: 'user', parts: [{ text: prompt + `\n\n${code}` }] }],
            modelToUse: 'pro' // Always use pro for detailed reviews
        });
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
        const modelChoice = getModelForQuery(prompt);
        
        let fullHistory: Content[] = [config.SYSTEM_PROMPT, ...conversationHistory];
        
        const profileText = `This is my user profile...`; // (Full prompt text)
        if (userProfile.memoryEnabled && userProfile.automaticMemory && Object.keys(userProfile.automaticMemory).length > 0) {
            fullHistory.push({ role: 'user', parts: [{ text: profileText }] });
            fullHistory.push({ role: 'model', parts: [{ text: "Got it. I'll keep that in mind." }] });
        }
        fullHistory.push({ role: 'user', parts: [{ text: prompt }] });

        const result = await generateContentWithFallback({
            contents: fullHistory,
            tools: modelChoice === config.GEMINI_MODELS.pro ? [googleSearchTool] : undefined,
            modelToUse: modelChoice === 'pro' ? 'pro' : 'flash'
        });
        
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
