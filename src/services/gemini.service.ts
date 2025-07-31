// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content, Part, Tool } from '@google/generative-ai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Initialize models with their specific configurations
const flashModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });

// This is the corrected way to enable Google Search grounding
const proModel = genAI.getGenerativeModel({
    model: config.GEMINI_MODELS.pro,
    tools: [{ googleSearch: {} }],
});


/**
 * Analyzes a conversation to extract or update a persistent fact about the user.
 * @returns An object with an action ('ADD' or 'UPDATE') and the key-value pair, or null.
 */
export async function extractMemoryFromConversation(userQuery: string, userProfile: UserProfile): Promise<{ action: 'ADD' | 'UPDATE', key: string, value: string } | null> {
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

**Keys must be short, normalized summaries (e.g., "Favorite Color", "Hometown").**

---
Analyze the user's latest message now.
User's message: "${userQuery}"`;

    const model = genAI.getGenerativeModel({
        model: config.GEMINI_MODELS.flash,
        systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] }
    });
    
    try {
        const result = await model.generateContent(userQuery);
        const text = result.response.text().trim();

        if (text === 'null' || !text.includes('::')) {
            return null;
        }

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
        const modelType = getModelForQuery(query);
        const model = modelType === 'pro' ? proModel : flashModel;

        let systemInstructionText = (config.SYSTEM_PROMPT.parts[0] as Part).text || '';
        
        if (userProfile.memoryEnabled) {
            if (userProfile.tone) systemInstructionText += `\n- Adopt a ${userProfile.tone} tone.`;
            if (userProfile.persona) systemInstructionText += `\n- Act as a ${userProfile.persona}.`;

            const hasAutoMemory = userProfile.automaticMemory && Object.keys(userProfile.automaticMemory).length > 0;
            if (hasAutoMemory) {
                systemInstructionText += `\n- Remember the following about the user:`;
                for (const key in userProfile.automaticMemory) {
                    systemInstructionText += `\n  - ${key}: ${userProfile.automaticMemory[key]}`;
                }
            }
        }
        
        const systemInstruction = { role: 'system' as const, parts: [{ text: systemInstructionText }] };
        const chat = model.startChat({
            history,
            generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
            systemInstruction,
            // The 'tools' are now part of the model initialization, so no need to pass them here.
        });

        const result = await chat.sendMessageStream(query);
        let fullResponse = '';
        for await (const chunk of result.stream) {
            fullResponse += chunk.text();
        }

        return fullResponse.trim() || "I'm sorry, I couldn't generate a proper response. Could you please rephrase your question?";
        
    } catch (error) {
        console.error('Error generating response:', error);
        if (error instanceof Error) {
            if (error.message.includes('quota')) return "I'm experiencing high usage right now. Please try again in a moment.";
            if (error.message.includes('safety')) return "I can't respond to that due to my safety guidelines.";
        }
        throw error;
    }
}

function getModelForQuery(query: string): 'pro' | 'flash' {
    const queryLower = query.toLowerCase();
    const complexKeywords = ['code', 'explain', 'analyze', 'review', 'debate', 'what is', 'who is', 'how to'];
    const hasUrl = /(https?:\/\/[^\s]+)/.test(query);

    if (hasUrl || complexKeywords.some(keyword => queryLower.startsWith(keyword)) || query.length > 150) {
        console.log("Switching to Pro model for complex query, URL, or grounding.");
        return 'pro';
    }
    return 'flash';
}
