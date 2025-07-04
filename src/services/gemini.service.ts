// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content, FunctionDeclaration, GenerativeModel, FunctionDeclarationSchemaType, Tool } from '@google/generative-ai';
import { GoogleGenAI } from '@google/genai'; // <-- NEW: Import for image generation
import { config } from '../config';
import { UserProfile } from './userProfile.service';

// --- INITIALIZE CLIENTS ---
// Client for text/chat generation
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const flashModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
const proModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });

// Client for image generation using the correct library
const imageGenAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });


// --- TOOLS FOR TEXT MODELS (Unchanged) ---
const tools: Tool[] = [ /* ... rest of tool definition is unchanged ... */ ];
async function callTool(functionName: string, args: any): Promise<any> { /* ... unchanged ... */ }
function getModelForQuery(query: string): 'pro' | 'flash' { /* ... unchanged ... */ }

/**
 * Generates an image using the Imagen model.
 * @param prompt The text prompt for the image.
 * @returns A Buffer containing the image data (PNG).
 * @throws An error if image generation fails or is blocked.
 */
export async function generateImage(prompt: string): Promise<Buffer> {
    console.log(`Generating image with prompt: "${prompt}" using ${config.GEMINI_MODELS.imagen}`);
    try {
        const response = await imageGenAI.models.generateImages({
            model: config.GEMINI_MODELS.imagen,
            prompt: prompt,
            config: {
                numberOfImages: 1,
                outputMimeType: 'image/png', // PNG supports transparency and is high quality
                aspectRatio: '1:1',
            },
        });

        if (!response?.generatedImages || response.generatedImages.length === 0) {
            // Check for more specific error info if available in the response structure
            console.error('Image generation failed: No images were returned.');
            throw new Error('The AI did not generate any images. Your prompt might have been blocked for safety reasons or was too ambiguous.');
        }

        const image = response.generatedImages[0];
        if (!image?.image?.imageBytes) {
            console.error('Image generation failed: Returned object is missing image data.');
            throw new Error('The AI response was incomplete and did not contain image data.');
        }

        // The imageBytes are a base64 encoded string, convert it to a Buffer
        return Buffer.from(image.image.imageBytes, 'base64');

    } catch (error) {
        console.error('Error in generateImage:', error);
        // Re-throw a user-friendly error
        if (error instanceof Error && (error.message.includes('blocked') || error.message.includes('incomplete'))) {
            throw error;
        }
        throw new Error('Failed to generate the image. The AI service might be busy or an unknown error occurred.');
    }
}


/**
 * Generates a response from Gemini based on the conversation history and a new query.
 */
export async function generateResponse(history: Content[], query: string, userProfile: UserProfile): Promise<string> {
    // THIS FUNCTION REMAINS THE SAME AS BEFORE
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
