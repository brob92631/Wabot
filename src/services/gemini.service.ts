// src/services/gemini.service.ts
import { GoogleGenerativeAI, Content, Part, Tool } from '@google/genai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Initialize the AI client with the correct class name
const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY!);

// Define Google Search grounding tool
const googleSearchTool: Tool = { googleSearch: {} };

/**
 * Extracts key information from conversation history for memory formation
 */
export async function extractMemoryFromConversation(userQuery: string, userProfile: UserProfile): Promise<{ action: 'ADD' | 'UPDATE', key: string, value: string } | null> {
    const model = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
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
-   If **no new facts or updates** are found: \`null\`
**Keys must be short, normalized summaries (e.g., "Favorite Color", "Hometown").**`;

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: `Analyze the user's latest message now.\nUser's message: "${userQuery}"` }] }],
            systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
        });
        const text = result.response.text().trim();

        if (text === 'null' || !text.includes('::')) return null;
        const parts = text.split('::');
        if (parts.length !== 3) return null;
        const [action, key, value] = parts.map((p: string) => p.trim());

        if ((action === 'ADD' || action === 'UPDATE') && key && value) {
            return { action: action as 'ADD' | 'UPDATE', key, value };
        }
        return null;
    } catch (error) {
        console.error("Error during memory extraction:", error);
        return null;
    }
}

/**
 * Generates response using appropriate model based on query complexity
 */
export async function generateResponse(prompt: string, userProfile: UserProfile, conversationHistory: Content[] = []): Promise<string> {
    try {
        const modelName = getModelForQuery(prompt);
        const model = genAI.getGenerativeModel({ model: modelName });
        const isComplexQuery = modelName === config.GEMINI_MODELS.pro;
        
        // Prepare conversation context
        const history: Content[] = [config.SYSTEM_PROMPT, ...conversationHistory];
        
        // Add user profile context as the second-to-last user message
        const profileText = `This is my user profile, use it for context: ${JSON.stringify(userProfile.automaticMemory, null, 2)}`;
        if (userProfile.memoryEnabled && userProfile.automaticMemory && Object.keys(userProfile.automaticMemory).length > 0) {
            history.push({ role: 'user', parts: [{ text: profileText }] });
            // Add a simple model part to keep the turn order correct
            history.push({ role: 'model', parts: [{ text: "Got it. I'll keep that in mind." }] });
        }
        
        const chat = model.startChat({
            history,
            tools: isComplexQuery ? [googleSearchTool] : undefined,
            generationConfig: config.GENERATION
        });

        const result = await chat.sendMessage(prompt);
        return result.response.text() || 'I apologize, but I was unable to generate a response at this time.';
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
