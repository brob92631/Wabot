// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content, Part, Tool, StartChatParams } from '@google/genai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Initialize with the modern SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Define the Google Search tool
const googleSearchTool: Tool = { googleSearch: {} };

/**
 * Analyzes a conversation to extract or update a persistent fact about the user.
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

        const [action, key, value] = parts.map(p => p.trim());
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
 * Generates a text response from Gemini.
 */
export async function generateResponse(history: Content[], query: string, userProfile: UserProfile): Promise<string> {
    try {
        const modelName = getModelForQuery(query);
        const model = genAI.getGenerativeModel({ model: modelName });

        let systemInstructionText = (config.SYSTEM_PROMPT.parts[0] as Part).text || '';
        if (userProfile.memoryEnabled) {
            if (userProfile.tone) systemInstructionText += `\n- Adopt a ${userProfile.tone} tone.`;
            if (userProfile.persona) systemInstructionText += `\n- Act as a ${userProfile.persona}.`;
            const autoMemory = userProfile.automaticMemory || {};
            if (Object.keys(autoMemory).length > 0) {
                systemInstructionText += `\n- Remember the following about the user:`;
                for (const key in autoMemory) {
                    systemInstructionText += `\n  - ${key}: ${autoMemory[key]}`;
                }
            }
        }
        
        const chatParams: StartChatParams = {
            history,
            systemInstruction: { role: 'system', parts: [{ text: systemInstructionText }] },
        };

        // Only add tools if using the Pro model
        if (modelName === config.GEMINI_MODELS.pro) {
            chatParams.tools = [googleSearchTool];
        }

        const chat = model.startChat(chatParams);
        const result = await chat.sendMessage(query);
        const responseText = result.response.text();

        return responseText.trim() || "I'm sorry, I couldn't generate a proper response.";
    } catch (error) {
        console.error('Error generating response:', error);
        if (error instanceof Error) {
            if (error.message.includes('quota')) return "I'm experiencing high usage right now.";
            if (error.message.includes('safety')) return "I can't respond to that due to my safety guidelines.";
        }
        return "I encountered a critical error. Please try again later.";
    }
}

function getModelForQuery(query: string): string {
    const queryLower = query.toLowerCase();
    const complexKeywords = ['code', 'explain', 'analyze', 'review', 'debate', 'what is', 'who is', 'how to', 'which is', 'which are'];
    const hasUrl = /(https?:\/\/[^\s]+)/.test(query);

    if (hasUrl || complexKeywords.some(keyword => queryLower.startsWith(keyword)) || query.length > 150) {
        console.log("Switching to Pro model for complex query, URL, or grounding.");
        return config.GEMINI_MODELS.pro;
    }
    return config.GEMINI_MODELS.flash;
}
