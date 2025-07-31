// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Correctly initialize the client with API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Get models from the correctly initialized client
const flashModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
const proModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });

/**
 * Generates speech from text.
 * Note: Google Gemini doesn't directly support TTS. This is a placeholder.
 * You would need to use Google Text-to-Speech API or another TTS service.
 * @param text The text to convert to speech.
 * @returns A Buffer containing the WAV audio data.
 */
export async function generateSpeech(text: string): Promise<Buffer> {
    console.log(`Speech generation requested for: "${text.slice(0, 50)}..."`);
    
    // For now, throw an error as Gemini doesn't support TTS directly
    throw new Error('Text-to-speech is not available. Please use Google Text-to-Speech API or another TTS service.');
    
    // If you implement actual TTS, replace the above with your implementation
    // const audioBuffer = await yourTTSService.synthesize(text);
    // return audioBuffer;
}

/**
 * Generates a text response from Gemini.
 */
export async function generateResponse(history: Content[], query: string, userProfile: UserProfile): Promise<string> {
    try {
        const modelType = getModelForQuery(query);
        const model = modelType === 'pro' ? proModel : flashModel;

        console.log(`Using ${modelType.toUpperCase()} model for query: "${query.slice(0, 50)}..."`);

        const systemPromptParts = config.SYSTEM_PROMPT.parts;
        if (!systemPromptParts || systemPromptParts.length === 0) {
            throw new Error("System prompt is not configured correctly in config.ts");
        }
        
        let systemInstructionText = (systemPromptParts[0] as Part).text || '';
        
        // Only add personal data if memory is enabled
        if (userProfile.memoryEnabled) {
            if (userProfile.tone) {
                systemInstructionText += `\n- Adopt a ${userProfile.tone} tone.`;
            }
            if (userProfile.persona) {
                systemInstructionText += `\n- Act as a ${userProfile.persona}.`;
            }
            if (userProfile.customMemory && Object.keys(userProfile.customMemory).length > 0) {
                systemInstructionText += `\n- Remember the following about the user:`;
                for (const key in userProfile.customMemory) {
                    systemInstructionText += `\n  - ${key}: ${userProfile.customMemory[key]}`;
                }
            }
        }
        
        const systemInstruction = { 
            role: 'system' as const, 
            parts: [{ text: systemInstructionText }] 
        };

        const chat = model.startChat({
            history,
            generationConfig: {
                maxOutputTokens: 4096,
                temperature: 0.7,
                topP: 0.9,
                topK: 40,
            },
            systemInstruction,
        });

        const result = await chat.sendMessageStream(query);
        
        let fullResponse = '';
        for await (const chunk of result.stream) {
            fullResponse += chunk.text();
        }

        if (!fullResponse || fullResponse.trim().length < 1) {
            console.warn('Generated response is empty.');
            return "I'm sorry, I couldn't generate a proper response. Could you please rephrase your question?";
        }

        return fullResponse.trim();
        
    } catch (error) {
        console.error('Error generating response:', error);
        
        if (error instanceof Error) {
            if (error.message.includes('quota') || error.message.includes('rate limit')) {
                return "I'm experiencing high usage right now. Please try again in a moment.";
            } else if (error.message.includes('safety')) {
                return "I can't provide a response to that request due to my safety guidelines. Please try asking something else.";
            }
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
}```
