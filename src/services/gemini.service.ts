// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content, FunctionDeclaration, GenerativeModel, FunctionDeclarationSchemaType, Tool } from '@google/generative-ai';
import { GoogleGenAI } from '@google/genai';
import mime from 'mime';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// --- INITIALIZE CLIENTS ---
// Client for text/chat generation
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const flashModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
const proModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });

// Client for advanced features like TTS from the other library
const googleGenAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });


// --- WAV CONVERSION HELPERS (from your example) ---
interface WavConversionOptions {
    numChannels: number,
    sampleRate: number,
    bitsPerSample: number
}

function parseMimeType(mimeType : string): WavConversionOptions {
  const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
  const [_, format] = fileType.split('/');

  const options : Partial<WavConversionOptions> = {
    numChannels: 1,
  };

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map(s => s.trim());
    if (key === 'rate') {
      options.sampleRate = parseInt(value, 10);
    }
  }

  return options as WavConversionOptions;
}

function createWavHeader(dataLength: number, options: WavConversionOptions): Buffer {
  const { numChannels, sampleRate, bitsPerSample } = options;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

function convertToWav(rawData: Buffer, mimeType: string): Buffer {
  const options = parseMimeType(mimeType);
  const wavHeader = createWavHeader(rawData.length, options);
  return Buffer.concat([wavHeader, rawData]);
}


// --- CORE GEMINI SERVICES ---

/**
 * Generates speech from text using the TTS model.
 * @param text The text to convert to speech.
 * @returns A Buffer containing the WAV audio data.
 */
export async function generateSpeech(text: string): Promise<Buffer> {
    console.log(`Generating speech for: "${text.slice(0, 50)}..."`);
    try {
        const ttsConfig = {
            temperature: 0,
            responseMimeType: 'audio/wav', // Request WAV directly
        };
        const contents = [{ role: 'user', parts: [{ text }] }];

        const response = await googleGenAI.models.generateContent({
            model: config.GEMINI_MODELS.tts,
            config: ttsConfig,
            contents,
        });

        const audioPart = response?.candidates?.[0]?.content?.parts?.[0];

        if (!audioPart || !audioPart.inlineData) {
            console.error('TTS generation failed: No audio data was returned.');
            throw new Error('The AI did not generate any audio. The text might have been too long or contained unsupported characters.');
        }

        return Buffer.from(audioPart.inlineData.data, 'base64');
        
    } catch (error) {
        console.error('Error in generateSpeech:', error);
        throw new Error('Failed to generate the audio. The AI service might be busy or an unknown error occurred.');
    }
}


/**
 * Generates a response from Gemini based on the conversation history and a new query.
 */
export async function generateResponse(history: Content[], query: string, userProfile: UserProfile): Promise<string> {
    // This function for text chat remains unchanged
    // ... (rest of the function is identical to the previous version)
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
            // tools: tools, // 'tools' is not defined, but it's not used here anyway
        });

        const result = await chat.sendMessageStream(query);
        
        let fullResponse = '';
        for await (const chunk of result.stream) {
            fullResponse += chunk.text();
        }

        if ((!fullResponse || fullResponse.trim().length < 1)) {
            console.warn('Generated response is empty.');
            return "I'm sorry, I couldn't generate a proper response. Could you please rephrase your question?";
        }

        if (fullResponse.length > config.MAX_RESPONSE_LENGTH) {
            return fullResponse;
        }

        return fullResponse.trim();
        
    } catch (error) {
        console.error('Error generating response:', error);
        
        if (error instanceof Error) {
            if (error.message.includes('quota') || error.message.includes('rate limit')) {
                return "I'm experiencing high usage right now. Please try again in a moment.";
            } else if (error.message.includes('safety')) {
                return "I can't provide a response to that request due to my safety guidelines. Please try asking something else.";
            } else if (error.message.includes('network') || error.message.includes('fetch')) {
                return "I'm having trouble connecting to the AI service. Please check your connection and try again.";
            }
        }
        
        throw error;
    }
}

// Minimal getModelForQuery as tools/complex logic is reduced for this example
function getModelForQuery(query: string): 'pro' | 'flash' {
    const queryLower = query.toLowerCase();
    const complexKeywords = ['code', 'explain', 'analyze', 'review', 'summarize', 'extract', 'debate'];
    if (complexKeywords.some(keyword => queryLower.includes(keyword)) || query.length > 200) {
        return 'pro';
    }
    return 'flash';
}
