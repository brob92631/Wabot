// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const flashModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
const proModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });


/**
 * Analyzes a conversation to extract a persistent fact about the user.
 * @returns A key-value pair if a memory is found, otherwise null.
 */
export async function extractMemoryFromConversation(userQuery: string, modelResponse: string): Promise<{ key: string; value: string; } | null> {
    const systemPrompt = `You are a memory extraction AI. Your task is to analyze the user's last message.
Identify if the user stated a new, persistent fact about themselves (like preferences, personal details, location, name, etc.).
- IGNORE questions, commands, greetings, or temporary states.
- IGNORE facts about the bot or anyone other than the user.
- The fact must be explicitly stated by the user.
If a new, persistent fact is found, output it in the format: key::value
The 'key' should be a short, 2-4 word summary (e.g., 'favorite color', 'job title', 'hometown').
The 'value' is the fact itself (e.g., 'blue', 'software engineer', 'New York City').
If no new, persistent fact is found, output the single word: null`;

    const model = genAI.getGenerativeModel({
        model: config.GEMINI_MODELS.flash,
        systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] }
    });

    const prompt = `User's message: "${userQuery}"\nModel's response: "${modelResponse}"`;
    
    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();

        if (text === 'null' || !text.includes('::')) {
            return null;
        }

        const [key, value] = text.split('::', 2);
        if (key && value) {
            return { key: key.trim(), value: value.trim() };
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
        
        // Only add personal data if memory is enabled
        if (userProfile.memoryEnabled) {
            if (userProfile.tone) systemInstructionText += `\n- Adopt a ${userProfile.tone} tone.`;
            if (userProfile.persona) systemInstructionText += `\n- Act as a ${userProfile.persona}.`;

            const hasCustomMemory = userProfile.customMemory && Object.keys(userProfile.customMemory).length > 0;
            const hasAutoMemory = userProfile.automaticMemory && Object.keys(userProfile.automaticMemory).length > 0;

            if (hasCustomMemory || hasAutoMemory) {
                 systemInstructionText += `\n- Remember the following about the user:`;
                if (hasCustomMemory) {
                    for (const key in userProfile.customMemory) {
                        systemInstructionText += `\n  - ${key}: ${userProfile.customMemory[key]}`;
                    }
                }
                if (hasAutoMemory) {
                    for (const key in userProfile.automaticMemory) {
                        systemInstructionText += `\n  - ${key}: ${userProfile.automaticMemory[key]}`;
                    }
                }
            }
        }
        
        const systemInstruction = { role: 'system' as const, parts: [{ text: systemInstructionText }] };

        const chat = model.startChat({
            history,
            generationConfig: { maxOutputTokens: 4096, temperature: 0.7, topP: 0.9, topK: 40 },
            systemInstruction,
        });

        const result = await chat.sendMessageStream(query);
        let fullResponse = '';
        for await (const chunk of result.stream) {
            fullResponse += chunk.text();
        }

        if (!fullResponse.trim()) {
            return "I'm sorry, I couldn't generate a proper response. Could you please rephrase your question?";
        }

        return fullResponse.trim();
        
    } catch (error) {
        console.error('Error generating response:', error);
        if (error instanceof Error && (error.message.includes('quota') || error.message.includes('rate limit'))) {
            return "I'm experiencing high usage right now. Please try again in a moment.";
        } else if (error instanceof Error && error.message.includes('safety')) {
            return "I can't provide a response to that request due to my safety guidelines.";
        }
        throw error;
    }
}

function getModelForQuery(query: string): 'pro' | 'flash' {
    const queryLower = query.toLowerCase();
    const complexKeywords = ['code', 'explain', 'analyze', 'review', 'summarize', 'extract', 'debate'];
    if (complexKeywords.some(keyword => queryLower.includes(keyword)) || query.length > 200) {
        return 'pro';
    }
    return 'flash';
}
