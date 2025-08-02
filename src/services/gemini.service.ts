// src/services/gemini.service.ts (DEFINITIVE, CORRECTED VERSION for @google/genai v1.12.0+)

import { GoogleGenAI, Content, Tool, GenerateContentResult, GenerationConfig } from '@google/genai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Initialize the primary AI client
const genAI_primary = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Initialize the secondary AI client, falling back to the primary if not provided
const secondaryApiKey = process.env.GEMINI_SECONDARY_API_KEY;
const genAI_secondary = secondaryApiKey ? new GoogleGenAI({ apiKey: secondaryApiKey }) : genAI_primary;

if (!secondaryApiKey) {
    console.warn("WARN: GEMINI_SECONDARY_API_KEY is not set. Using primary API key for all AI features.");
}

// Define the shape of the parameters for our internal function
interface GenerationParams {
    contents: Content[];
    tools?: Tool[];
    generationConfig?: GenerationConfig;
}

/**
 * A robust wrapper for generateContent that attempts to use the Flash model first
 * and falls back to the Pro model on any failure.
 * @param client The GoogleGenAI client to use.
 * @param params The parameters for the generateContent call.
 * @param startWithPro If true, starts with Pro model and does not fall back from it.
 * @returns The generated text content.
 */
async function generateContentWithFallback(
    client: GoogleGenAI,
    params: GenerationParams,
    startWithPro: boolean = false
): Promise<string> {
    const flashModelName = config.GEMINI_MODELS.flash;
    const proModelName = config.GEMINI_MODELS.pro;

    const getResponseText = (result: GenerateContentResult): string => {
        // Updated to handle the modern response structure safely
        return result.response.text?.()?.trim() || '';
    };

    if (!startWithPro) {
        try {
            const result = await client.getGenerativeModel({ model: flashModelName }).generateContent(params);
            return getResponseText(result);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`Model ${flashModelName} failed, falling back to ${proModelName}. Error: ${errorMessage}`);
            // Fall through to try the Pro model
        }
    }

    // This block is reached if startWithPro is true, or if the flash model failed.
    const result = await client.getGenerativeModel({ model: proModelName }).generateContent(params);
    return getResponseText(result);
}

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
        const responseText = await generateContentWithFallback(
            genAI_secondary,
            {
                contents: [
                    { role: "user", parts: [{ text: systemPrompt }] },
                    { role: "user", parts: [{ text: `Analyze the user's latest message now.\nUser's message: "${userQuery}"` }] }
                ],
                generationConfig: { temperature: 0 }
            },
            false // Always start with Flash
        );

        if (!responseText || responseText === 'null' || !responseText.includes('::')) return null;

        const parts = responseText.split('::');
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
 * Generates a code review using the secondary API key.
 * Uses a Flash -> Pro fallback.
 */
export async function generateCodeReview(code: string): Promise<string> {
    const prompt = `You are an expert code reviewer. Your personality is helpful and constructive.
Provide a detailed, constructive feedback on the following code snippet.
Analyze the code for logic, style, potential bugs, and suggest best-practice improvements.
Use Discord markdown for formatting.

Code to review:
${code}`;

    try {
        return await generateContentWithFallback(
            genAI_secondary,
            {
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: config.GENERATION
            },
            false // Always start with Flash
        );
    } catch (error) {
        console.error('Error generating code review:', error);
        return 'I encountered an error while reviewing the code. Please try again.';
    }
}

/**
 * Generates a conversational response using the primary API key.
 * Uses model routing (Flash or Pro) with a fallback from Flash to Pro if needed.
 */
export async function generateResponse(prompt: string, userProfile: UserProfile, conversationHistory: Content[] = []): Promise<string> {
    try {
        const modelChoice = getModelForQuery(prompt);
        const startWithPro = modelChoice === config.GEMINI_MODELS.pro;
        
        let contents: Content[] = [config.SYSTEM_PROMPT, ...conversationHistory];
        
        const profileText = `This is my user profile, use it for context: ${JSON.stringify(userProfile.automaticMemory, null, 2)}`;
        if (userProfile.memoryEnabled && userProfile.automaticMemory && Object.keys(userProfile.automaticMemory).length > 0) {
            contents.push({ role: 'user', parts: [{ text: profileText }] });
            contents.push({ role: 'model', parts: [{ text: "Got it. I'll keep that in mind." }] });
        }

        contents.push({ role: 'user', parts: [{ text: prompt }] });

        return await generateContentWithFallback(
            genAI_primary,
            {
                contents,
                generationConfig: config.GENERATION,
                tools: startWithPro ? [{ googleSearch: {} }] : undefined
            },
            startWithPro
        );
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
    
    if (hasComplexityIndicator || isUrlProvided || (isLongQuery && hasQuestionWords)) {
        return config.GEMINI_MODELS.pro;
    }
    
    return config.GEMINI_MODELS.flash;
}
