// src/services/review.service.ts (A NEW, CLEAN FILE)

import { GoogleGenAI } from '@google/genai';
import { config } from '../config';

// This service uses its own instance of the client to keep it separate.
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

/**
 * Generates a code review using a simple, direct API call.
 * This is kept separate from the main chat logic to ensure stability.
 */
export async function generateCodeReview(code: string): Promise<string> {
    const prompt = `You are an expert code reviewer. Your personality is helpful and constructive.
Provide a detailed, constructive feedback on the following code snippet.
Analyze the code for logic, style, potential bugs, and suggest best-practice improvements.

FORMATTING REQUIREMENTS:
- Use proper Discord markdown formatting
- Wrap ALL code examples in proper code blocks with language specification
- Use inline code formatting when referencing specific functions or variables
- Structure your response with clear sections using headers

Code to review:
\`\`\`
${code}
\`\`\``;
    
    try {
        // This uses the 'generateContent' method which we know works for single tasks
        // from your original zip file.
        const result = await genAI.models.generateContent({
            model: config.GEMINI_MODELS.pro,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: config.GENERATION
        });

        // This is the correct way to get the text from this type of response.
        return result.text?.trim() || 'I was unable to generate a code review.';
    } catch (error) {
        console.error('Error generating code review:', error);
        return 'I encountered an error while reviewing the code. Please try again.';
    }
}
