// src/services/gemini.service.ts

import { GoogleGenAI, Content, GenerativeModel, ModelConfig, Part } from '@google/genai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Unified client for all Gemini services
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const flashModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
const proModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });


/**
 * Generates speech from text using the correct streaming TTS model.
 * @param text The text to convert to speech.
 * @returns A Buffer containing the WAV audio data.
 */
export async function generateSpeech(text: string): Promise<Buffer> {
    console.log(`Generating speech for: "${text.slice(0, 50)}..." using ${config.GEMINI_MODELS.tts}`);
    try {
        const ttsConfig: ModelConfig = {
            temperature: 0,
            responseMimeType: 'audio/wav', // Request audio directly
        };
        
        const ttsModel = genAI.getGenerativeModel({
             model: 'tts-1', // A common model for direct TTS
             generationConfig: {
                responseMimeType: "audio/wav",
             },
             safetySettings: [], // Adjust safety settings if needed
        });

        const result = await ttsModel.generateContent({
            parts: [{ text: `Speak with a ${config.TTS_VOICE} voice. ${text}`}]
        });

        const audioData = result.response.candidates?.[0]?.content.parts?.[0].inlineData?.data;

        if (!audioData) {
            console.error('TTS generation failed: The stream returned no audio data.');
            throw new Error('The AI did not generate any audio. The text might be unsupported or was blocked for safety.');
        }

        return Buffer.from(audioData, 'base64');

    } catch (error) {
        console.error('Error in generateSpeech:', error);
        throw new Error('Failed to generate the audio. The AI service may be busy or an unknown error occurred.');
    }
}


/**
 * Generates a text response from Gemini.
 */
export async function generateResponse(history: Content[], query: string, userProfile: UserProfile): Promise<string> {
    try {
        const modelType = getModelForQuery(query);
        const model = modelType === 'pro' ? proModel : flashModel;

        console.log(`Using ${modelType.toUpperCase()} model for query: "${query.slice(0, 50)}..."`);

        let systemInstructionText = (config.SYSTEM_PROMPT.parts[0] as Part).text;
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
        
        const systemInstruction = { role: 'system', parts: [{ text: systemInstructionText }] };

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
}
