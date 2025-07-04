// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content, FunctionDeclaration, GenerativeModel, FunctionDeclarationSchemaType, Tool } from '@google/generative-ai';
import { GoogleGenAI } from '@google/genai'; // <-- Using this library for TTS
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Client for standard text generation
const textGenAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const flashModel = textGenAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
const proModel = textGenAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });

// Client for TTS using the correct library
const speechGenAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });


/**
 * Generates speech from text using the correct streaming TTS model.
 * @param text The text to convert to speech.
 * @returns A Buffer containing the WAV audio data.
 */
export async function generateSpeech(text: string): Promise<Buffer> {
    console.log(`Generating speech for: "${text.slice(0, 50)}..." using ${config.GEMINI_MODELS.tts}`);
    try {
        const ttsConfig = {
            temperature: 0,
            responseModalities: ['audio'],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: config.TTS_VOICE,
                    }
                }
            },
        };
        
        const contents = [{ role: 'user', parts: [{ text }] }];

        const responseStream = await speechGenAI.models.generateContentStream({
            model: config.GEMINI_MODELS.tts,
            config: ttsConfig,
            contents,
        });

        const audioChunks: Buffer[] = [];
        for await (const chunk of responseStream) {
            // Check for the audio data in the chunk
            const audioData = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (audioData) {
                audioChunks.push(Buffer.from(audioData, 'base64'));
            }
        }

        if (audioChunks.length === 0) {
            console.error('TTS generation failed: The stream returned no audio data.');
            throw new Error('The AI did not generate any audio. The text might be unsupported or was blocked for safety.');
        }

        // Combine all received audio chunks into a single buffer
        return Buffer.concat(audioChunks);

    } catch (error) {
        console.error('Error in generateSpeech:', error);
        throw new Error('Failed to generate the audio. The AI service may be busy or an unknown error occurred.');
    }
}


/**
 * Generates a text response from Gemini.
 * (This function and its helpers like callTool and getModelForQuery remain unchanged from the last correct version)
 */
export async function generateResponse(history: Content[], query: string, userProfile: UserProfile): Promise<string> {
    // ... Function content is the same ...
    try {
        const modelType = getModelForQuery(query);
        const model = modelType === 'pro' ? proModel : flashModel;

        console.log(`Using ${modelType.toUpperCase()} model for query: "${query.slice(0, 50)}..."`);

        let currentSystemInstruction = (config.SYSTEM_PROMPT.parts[0] as { text: string }).text;
        if (userProfile.tone) {
            currentSystemInstruction += `\n- Adopt a ${userProfile.tone} tone.`;
        }
        if (userProfile.persona) {
            currentSystemInstruction += `\n- Act as a ${userProfile.persona}.`;
        }
        if (userProfile.customMemory && Object.keys(userProfile.customMemory).length > 0) {
            currentSystemInstruction += `\n- Remember the following about the user:`;
            for (const key in userProfile.customMemory) {
                currentSystemInstruction += `\n  - ${key}: ${userProfile.customMemory[key]}`;
            }
        }
        
        const systemInstructionContent: Content = { role: 'system', parts: [{ text: currentSystemInstruction }] };

        const chat = model.startChat({
            history,
            generationConfig: {
                maxOutputTokens: 4096,
                temperature: 0.7,
                topP: 0.9,
                topK: 40,
            },
            systemInstruction: systemInstructionContent,
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
