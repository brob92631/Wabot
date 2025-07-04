// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content, FunctionDeclaration, GenerativeModel, FunctionDeclarationSchemaType, Tool, GenerativeContentResult } from '@google/generative-ai';
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// Initialize the main Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const flashModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
const proModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });

/**
 * Defines the available tools (functions) that Gemini can call.
 */
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
    
    // Complex query indicators
    const complexKeywords = [
        'code', 'program', 'function', 'algorithm', 'debug', 'error', 'fix',
        'explain', 'analyze', 'compare', 'research', 'study', 'thesis',
        'calculate', 'math', 'formula', 'equation', 'solve',
        'step by step', 'detailed', 'comprehensive', 'thorough',
        'complex', 'advanced', 'technical', 'implementation',
        'design', 'architecture', 'structure', 'system',
        'pros and cons', 'advantages', 'disadvantages',
        'strategy', 'plan', 'approach', 'methodology',
        'review', // Added for code review/explanation
        'summarize', 'extract', // Added for URL processing
        'what time is it', 'current time', 'timezone', // For get_current_time tool
        'debate', 'argue', // For debate feature
        'imagine', 'draw', 'create an image' // For image generation
    ];

    // Programming language keywords
    const programmingKeywords = [
        'javascript', 'python', 'java', 'c++', 'html', 'css', 'sql',
        'react', 'node', 'typescript', 'php', 'ruby', 'go', 'rust',
        'api', 'database', 'server', 'client', 'framework'
    ];

    // Check for complex indicators
    const hasComplexKeywords = complexKeywords.some(keyword => queryLower.includes(keyword));
    const hasProgrammingKeywords = programmingKeywords.some(keyword => queryLower.includes(keyword));
    const isLongQuery = query.length > 200;
    const hasMultipleQuestions = (query.match(/\?/g) || []).length > 1;

    // Also check for explicit tool call intent
    const wantsTime = queryLower.includes('time') && queryLower.includes('what') || queryLower.includes('current time');

    if (hasComplexKeywords || hasProgrammingKeywords || isLongQuery || hasMultipleQuestions || wantsTime) {
        console.log(`Using PRO model for complex query: "${query.slice(0, 100)}..."`);
        return 'pro';
    }

    console.log(`Using FLASH model for simple query: "${query.slice(0, 100)}..."`);
    return 'flash';
}

/**
 * Generates an image using the Gemini Pro model.
 * @param prompt The text prompt for the image.
 * @returns A Buffer containing the image data (PNG).
 * @throws An error if image generation fails or is blocked.
 */
export async function generateImage(prompt: string): Promise<Buffer> {
    try {
        console.log(`Generating image with prompt: "${prompt}"`);
        const imagePrompt = `Generate a high-quality, detailed, digital art image of: ${prompt}.`;

        const result: GenerativeContentResult = await proModel.generateContent(imagePrompt);
        
        const response = result.response;
        const imagePart = response.parts?.find(part => part.inlineData);

        if (!imagePart || !imagePart.inlineData) {
            const blockReason = response.promptFeedback?.blockReason;
            if (blockReason) {
                console.warn(`Image generation blocked. Reason: ${blockReason}`);
                throw new Error(`I couldn't generate that image. The request was blocked for: ${blockReason}. Please try a different prompt.`);
            }
            throw new Error('API did not return image data. The prompt might have been too complex or ambiguous.');
        }

        return Buffer.from(imagePart.inlineData.data, 'base64');

    } catch (error) {
        console.error('Error in generateImage:', error);
        if (error instanceof Error) {
            if (error.message.includes('blocked') || error.message.includes('API did not return')) {
                throw error;
            }
        }
        throw new Error('Failed to generate the image. The AI service might be busy or the prompt could not be processed.');
    }
}


/**
 * Generates a response from Gemini based on the conversation history and a new query.
 */
export async function generateResponse(history: Content[], query: string, userProfile: UserProfile): Promise<string> {
    // THIS FUNCTION REMAINS THE SAME AS THE ORIGINAL
    try {
        const modelType = getModelForQuery(query);
        const model = modelType === 'pro' ? proModel : flashModel;

        console.log(`Using ${modelType.toUpperCase()} model for query: "${query.slice(0, 50)}..."`);

        // Construct dynamic system instruction
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
                const call = calls[0];
                toolCallDetected = true;
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
                    fullResponse = `I tried to use a tool, but it failed: ${toolError instanceof Error ? toolError.message : toolError}`;
                    break;
                }
            } else {
                fullResponse += chunk.text();
                
                if (fullResponse.length > config.MAX_RESPONSE_LENGTH * 4) { // Increased limit before early stop
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
            return fullResponse; // Let the smartReply handler split the message
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
        
        throw error; // Re-throw the error to be caught by the handler
    }
}
