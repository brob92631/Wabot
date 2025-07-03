// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content, FunctionDeclaration, GenerativeModel, FunctionDeclarationSchemaType, Tool } from '@google/generative-ai';
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
        'what time is it', 'current time', 'timezone' // For get_current_time tool
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
 * Summarizes text that is too long for a Discord message.
 */
async function summarizeText(text: string): Promise<string> {
    console.log(`Response is ${text.length} characters, attempting to summarize...`);
    
    try {
        const prompt = `Please create a concise summary of the following text. Keep all important information but make it shorter for Discord (under ${config.MAX_RESPONSE_LENGTH - 100} characters). Maintain the same tone and include key points:\n\n${text}`;
        
        const result = await flashModel.generateContent(prompt);
        const summary = result.response.text().trim();
        
        if (summary.length > config.MAX_RESPONSE_LENGTH) {
            return truncateAtSentence(summary, config.MAX_RESPONSE_LENGTH - 50) + '\n\n*(Response truncated)*';
        }
        
        return summary;
    } catch (error) {
        console.error('Error summarizing text:', error);
        return truncateAtSentence(text, config.MAX_RESPONSE_LENGTH - 50) + '\n\n*(Response truncated)*';
    }
}

/**
 * Truncates text at the last complete sentence within the limit.
 */
function truncateAtSentence(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    
    const truncated = text.slice(0, maxLength);
    const lastSentenceEnd = Math.max(
        truncated.lastIndexOf('.'),
        truncated.lastIndexOf('!'),
        truncated.lastIndexOf('?'),
        truncated.lastIndexOf('\n')
    );
    
    if (lastSentenceEnd > maxLength * 0.5) {
        return truncated.slice(0, lastSentenceEnd + 1);
    }
    
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
}

/**
 * Generates a response from Gemini based on the conversation history and a new query.
 */
export async function generateResponse(history: Content[], query: string, userProfile: UserProfile): Promise<string> {
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
                maxOutputTokens: modelType === 'pro' ? 4000 : 2000,
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
            // ---- THIS IS THE FIX ----
            // Use the recommended functionCalls() which returns an array.
            const calls = chunk.functionCalls();
            if (calls && calls.length > 0) {
                // For simplicity, we'll process the first call.
                // A more robust implementation might handle multiple parallel calls.
                const call = calls[0];
                toolCallDetected = true;
                console.log(`Gemini requested tool call: ${call.name} with args:`, call.args);
                try {
                    const toolResult = await callTool(call.name, call.args);
                    console.log('Tool result:', toolResult);
                    // Send tool response back to Gemini and get the final response
                    const toolResponseResult = await chat.sendMessage([
                        {
                            functionResponse: {
                                name: call.name,
                                response: toolResult,
                            },
                        },
                    ]);
                    // Collect the text from the non-streaming tool response
                    fullResponse += toolResponseResult.response.text();
                    break; // Exit loop after handling tool call and getting response
                } catch (toolError) {
                    console.error('Error executing tool:', toolError);
                    fullResponse = `Error executing tool: ${toolError instanceof Error ? toolError.message : toolError}`;
                    break;
                }
            } else {
                // If there's no function call, just append the text.
                const chunkText = chunk.text();
                fullResponse += chunkText;
                
                if (fullResponse.length > config.MAX_RESPONSE_LENGTH * 2) {
                    console.log('Response getting too long, stopping stream early');
                    break;
                }
            }
        }

        if (!toolCallDetected && (!fullResponse || fullResponse.trim().length < 5)) {
            console.warn('Generated response is empty or too short');
            return "I'm sorry, I couldn't generate a proper response. Could you please rephrase your question?";
        }

        if (fullResponse.length > config.MAX_RESPONSE_LENGTH) {
            console.log(`Response too long (${fullResponse.length} chars), summarizing...`);
            return await summarizeText(fullResponse);
        }

        return fullResponse.trim();
        
    } catch (error) {
        console.error('Error generating response:', error);
        
        if (error instanceof Error) {
            if (error.message.includes('quota') || error.message.includes('rate limit')) {
                return "I'm experiencing high usage right now. Please try again in a moment.";
            } else if (error.message.includes('safety')) {
                return "I can't provide a response to that request. Please try asking something else.";
            } else if (error.message.includes('network') || error.message.includes('fetch')) {
                return "I'm having trouble connecting to my AI service. Please try again.";
            }
        }
        
        return "Sorry, I encountered an error while generating a response. Please try again.";
    }
}
