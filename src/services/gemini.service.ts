// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content, FunctionDeclaration, GenerativeModel, FunctionDeclarationSchemaType, Tool } from '@google/generative-ai';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';
// The mime package is not needed here as we request WAV directly and don't need to convert.

// --- INITIALIZE CLIENTS ---
// Client for text/chat generation
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const flashModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
const proModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });

// Client for advanced features like TTS
const googleGenAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });


// --- TOOLS FOR TEXT MODELS ---
const tools: Tool[] = [
    {
        functionDeclarations: [
            {
                name: 'get_current_time',
                description: 'Gets the current time for a specified timezone.',
                parameters: {
                    type: FunctionDeclarationSchemaType.OBJECT,
                    properties: {
                        timezone: {
                            type: FunctionDeclarationSchemaType.STRING,
                            description: 'The timezone to get the current time for, e.g., "America/New_York", "Europe/London".'
                        }
                    },
                    required: ['timezone']
                }
            },
        ]
    }
];

/**
 * Executes a tool call and returns the result.
 */
async function callTool(functionName: string, args: any): Promise<any> {
    switch (functionName) {
        case 'get_current_time':
            try {
                const now = new Date();
                const options: Intl.DateTimeFormatOptions = {
                    timeZone: args.timezone,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric'
                };
                const formatter = new Intl.DateTimeFormat('en-US', options);
                return { time: formatter.format(now) };
            } catch (e) {
                console.error(`Invalid timezone for get_current_time: ${args.timezone}`, e);
                return { error: `Invalid timezone: ${args.timezone}` };
            }
        default:
            throw new Error(`Unknown function: ${functionName}`);
    }
}

/**
 * Analyzes the user's query to determine if it requires the advanced model.
 */
function getModelForQuery(query: string): 'pro' | 'flash' {
    const queryLower = query.toLowerCase();
    
    const complexKeywords = [
        'code', 'program', 'function', 'algorithm', 'debug', 'error', 'fix',
        'explain', 'analyze', 'compare', 'research', 'study', 'thesis',
        'calculate', 'math', 'formula', 'equation', 'solve',
        'step by step', 'detailed', 'comprehensive', 'thorough',
        'complex', 'advanced', 'technical', 'implementation',
        'design', 'architecture', 'structure', 'system',
        'pros and cons', 'advantages', 'disadvantages',
        'strategy', 'plan', 'approach', 'methodology',
        'review', 'summarize', 'extract',
        'what time is it', 'current time', 'timezone',
        'debate', 'argue'
    ];

    const programmingKeywords = [
        'javascript', 'python', 'java', 'c++', 'html', 'css', 'sql',
        'react', 'node', 'typescript', 'php', 'ruby', 'go', 'rust',
        'api', 'database', 'server', 'client', 'framework'
    ];

    const hasComplexKeywords = complexKeywords.some(keyword => queryLower.includes(keyword));
    const hasProgrammingKeywords = programmingKeywords.some(keyword => queryLower.includes(keyword));
    const isLongQuery = query.length > 200;
    const hasMultipleQuestions = (query.match(/\?/g) || []).length > 1;
    const wantsTime = queryLower.includes('time') && (queryLower.includes('what') || queryLower.includes('current'));

    if (hasComplexKeywords || hasProgrammingKeywords || isLongQuery || hasMultipleQuestions || wantsTime) {
        console.log(`Using PRO model for complex query: "${query.slice(0, 100)}..."`);
        return 'pro';
    }

    console.log(`Using FLASH model for simple query: "${query.slice(0, 100)}..."`);
    return 'flash';
}


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

        // The TTS model is part of the standard generateContent endpoint
        const response = await proModel.generateContent({
            contents,
            generationConfig: ttsConfig,
        });

        const audioPart = response?.response.candidates?.[0]?.content?.parts?.[0];

        // THIS IS THE CORRECTED, MORE ROBUST CHECK
        if (!audioPart?.inlineData?.data) {
            console.error('TTS generation failed: No audio data was returned from the API.');
            throw new Error('The AI did not generate any audio. The text might have been too long, contained unsupported characters, or was blocked for safety reasons.');
        }

        // After the check above, TypeScript knows `audioPart.inlineData.data` is a string.
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
            tools: tools,
        });

        const result = await chat.sendMessageStream(query);
        
        let fullResponse = '';
        let toolCallDetected = false;

        for await (const chunk of result.stream) {
            const calls = chunk.functionCalls();
            if (calls && calls.length > 0) {
                toolCallDetected = true;
                const call = calls[0];
                console.log(`Gemini requested tool call: ${call.name} with args:`, call.args);
                try {
                    const toolResult = await callTool(call.name, call.args);
                    console.log('Tool result:', toolResult);
                    const toolResponseResult = await chat.sendMessage([
                        {
                            functionResponse: {
                                name: call.name,
                                response: toolResult,
                            },
                        },
                    ]);
                    fullResponse += toolResponseResult.response.text();
                    break; 
                } catch (toolError) {
                    console.error('Error executing tool:', toolError);
                    fullResponse = `I tried to use a tool, but it failed: ${toolError instanceof Error ? toolError.message : String(toolError)}`;
                    break;
                }
            } else {
                fullResponse += chunk.text();
                if (fullResponse.length > config.MAX_RESPONSE_LENGTH * 4) {
                    console.log('Response getting too long, stopping stream early');
                    break;
                }
            }
        }

        if (!toolCallDetected && (!fullResponse || fullResponse.trim().length < 1)) {
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
