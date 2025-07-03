// src/services/gemini.service.ts

import { GoogleGenerativeAI, Content, GenerateContentStreamResult } from '@google/generative-ai';
import { config } from '../config';

// Initialize the main Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const flashModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.flash });
const proModel = genAI.getGenerativeModel({ model: config.GEMINI_MODELS.pro });

/**
 * Analyzes the user's query to determine if it requires the advanced model.
 * @param query The user's query.
 * @returns 'pro' if complex, 'flash' if simple.
 */
async function getModelForQuery(query: string): Promise<'pro' | 'flash'> {
    try {
        const prompt = `Analyze the following user query. Is it a simple question that can be answered conversationally, or is it a complex request that requires deep reasoning, multi-step thinking, or code generation? Respond with only the word "flash" for a simple query or "pro" for a complex one.\n\nQuery: "${query}"`;
        
        const result = await flashModel.generateContent(prompt);
        const choice = result.response.text().trim().toLowerCase();

        console.log(`Model selection analysis for query "${query}": Chose "${choice}"`);
        return choice === 'pro' ? 'pro' : 'flash';
    } catch (error) {
        console.error('Error in model selection, defaulting to flash:', error);
        return 'flash'; // Default to the faster model in case of an error
    }
}

/**
 * Summarizes text that is too long for a Discord message.
 * @param text The text to summarize.
 * @returns A summarized version of the text.
 */
async function summarizeText(text: string): Promise<string> {
    console.log('Response is too long, attempting to summarize...');
    try {
        const prompt = `The following text is too long for a Discord message. Please summarize it concisely, keeping the core meaning and important information. The summary must be under ${config.MAX_RESPONSE_LENGTH} characters.\n\nText to summarize:\n---\n${text}`;
        
        const result = await flashModel.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error('Error summarizing text:', error);
        // Fallback to truncating if summarization fails
        return text.slice(0, config.MAX_RESPONSE_LENGTH - 10) + '... (truncated)';
    }
}

/**
 * Generates a response from Gemini based on the conversation history and a new query.
 * @param history The conversation history.
 * @param query The new user query.
 * @returns The generated text response.
 */
export async function generateResponse(history: Content[], query: string): Promise<string> {
    const modelType = await getModelForQuery(query);
    const model = modelType === 'pro' ? proModel : flashModel;

    console.log(`Using ${modelType.toUpperCase()} model for this request.`);

    const chat = model.startChat({
        history,
        generationConfig: {
            maxOutputTokens: 2000, // Limit output tokens to prevent overly long initial responses
        },
        systemInstruction: config.SYSTEM_PROMPT,
    });

    const result = await chat.sendMessageStream(query);
    
    let fullResponse = '';
    for await (const chunk of result.stream) {
        fullResponse += chunk.text();
    }

    if (fullResponse.length > config.MAX_RESPONSE_LENGTH) {
        return await summarizeText(fullResponse);
    }

    return fullResponse;
}
