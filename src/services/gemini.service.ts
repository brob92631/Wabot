// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content } from '@google/generative-ai';
import { config } from '../config';

// Initialize the main Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const flashModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
const proModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });

/**
 * Analyzes the user's query to determine if it requires the advanced model.
 * Uses keyword-based analysis for reliability and speed.
 * @param query The user's query.
 * @returns 'pro' if complex, 'flash' if simple.
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
        'strategy', 'plan', 'approach', 'methodology'
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

    if (hasComplexKeywords || hasProgrammingKeywords || isLongQuery || hasMultipleQuestions) {
        console.log(`Using PRO model for complex query: "${query.slice(0, 100)}..."`);
        return 'pro';
    }

    console.log(`Using FLASH model for simple query: "${query.slice(0, 100)}..."`);
    return 'flash';
}

/**
 * Summarizes text that is too long for a Discord message.
 * @param text The text to summarize.
 * @returns A summarized version of the text.
 */
async function summarizeText(text: string): Promise<string> {
    console.log(`Response is ${text.length} characters, attempting to summarize...`);
    
    try {
        const prompt = `Please create a concise summary of the following text. Keep all important information but make it shorter for Discord (under ${config.MAX_RESPONSE_LENGTH - 100} characters). Maintain the same tone and include key points:\n\n${text}`;
        
        const result = await flashModel.generateContent(prompt);
        const summary = result.response.text().trim();
        
        if (summary.length > config.MAX_RESPONSE_LENGTH) {
            // If summarization still too long, truncate intelligently
            return truncateAtSentence(summary, config.MAX_RESPONSE_LENGTH - 50) + '\n\n*(Response truncated)*';
        }
        
        return summary;
    } catch (error) {
        console.error('Error summarizing text:', error);
        // Fallback to intelligent truncation
        return truncateAtSentence(text, config.MAX_RESPONSE_LENGTH - 50) + '\n\n*(Response truncated)*';
    }
}

/**
 * Truncates text at the last complete sentence within the limit.
 * @param text The text to truncate.
 * @param maxLength The maximum length.
 * @returns The truncated text.
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
    
    // If no good sentence break found, truncate at last space
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
}

/**
 * Generates a response from Gemini based on the conversation history and a new query.
 * @param history The conversation history.
 * @param query The new user query.
 * @returns The generated text response.
 */
export async function generateResponse(history: Content[], query: string): Promise<string> {
    try {
        const modelType = getModelForQuery(query);
        const model = modelType === 'pro' ? proModel : flashModel;

        console.log(`Using ${modelType.toUpperCase()} model for query: "${query.slice(0, 50)}..."`);

        const chat = model.startChat({
            history,
            generationConfig: {
                maxOutputTokens: modelType === 'pro' ? 4000 : 2000,
                temperature: 0.7,
                topP: 0.9,
                topK: 40,
            },
            systemInstruction: config.SYSTEM_PROMPT,
        });

        const result = await chat.sendMessageStream(query);
        
        let fullResponse = '';
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            fullResponse += chunkText;
            
            // Early termination if response is getting too long
            if (fullResponse.length > config.MAX_RESPONSE_LENGTH * 2) {
                console.log('Response getting too long, stopping stream early');
                break;
            }
        }

        // Handle empty or very short responses
        if (!fullResponse || fullResponse.trim().length < 5) {
            console.warn('Generated response is empty or too short');
            return "I'm sorry, I couldn't generate a proper response. Could you please rephrase your question?";
        }

        // Handle overly long responses
        if (fullResponse.length > config.MAX_RESPONSE_LENGTH) {
            console.log(`Response too long (${fullResponse.length} chars), summarizing...`);
            return await summarizeText(fullResponse);
        }

        return fullResponse.trim();
        
    } catch (error) {
        console.error('Error generating response:', error);
        
        // More specific error handling
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
