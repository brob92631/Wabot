// src/services/webScraping.service.ts

import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Fetches content from a URL and extracts readable text.
 * @param url The URL to fetch.
 * @returns The extracted text content, or null if an error occurs.
 */
export async function fetchAndExtractText(url: string): Promise<string | null> {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Wabot/1.0; +https://wabot-2b50.onrender.com)'
            },
            timeout: 10000 // 10 seconds timeout
        });

        if (response.status !== 200 || !response.headers['content-type']?.includes('text/html')) {
            console.warn(`Non-HTML content or bad status from ${url}: ${response.status}`);
            return null;
        }

        const $ = cheerio.load(response.data);

        // Remove script and style elements
        $('script, style').remove();

        // Try to find main content areas, prioritize common article/main tags
        const mainContent = $('article, main, .content, #main-content').first().text() || $('body').text();

        // Basic text cleaning
        const cleanedText = mainContent
            .replace(/\s+/g, ' ') // Replace multiple spaces/newlines with single space
            .trim();

        // Return a reasonable portion of the text to avoid overwhelming Gemini
        const MAX_SCRAPED_TEXT_LENGTH = 10000; // Limit to 10k characters for processing
        return cleanedText.slice(0, MAX_SCRAPED_TEXT_LENGTH);

    } catch (error) {
        console.error(`Error fetching or parsing URL ${url}:`, error instanceof Error ? error.message : error);
        return null;
    }
}
