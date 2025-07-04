// src/services/userProfile.service.ts

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';

// Define the structure of your database
export interface UserProfile {
    tone?: string; // e.g., 'friendly', 'formal', 'humorous'
    persona?: string; // e.g., 'pirate', 'academic', 'chef'
    customMemory?: Record<string, string>; // key-value pairs for user-defined memories
}

interface DatabaseSchema {
    userProfiles: Record<string, UserProfile>; // Key: userId
}

let db: Low<DatabaseSchema>;

/**
 * Initializes the LowDB database.
 */
export async function initializeUserProfileDB() {
    // Ensure the 'data' directory exists
    const dataDir = path.join(process.cwd(), 'data');
    try {
        await import('node:fs/promises').then(fs => fs.mkdir(dataDir, { recursive: true }));
    } catch (error) {
        console.error('Failed to create data directory:', error);
    }

    const file = path.join(dataDir, 'userProfiles.json'); // Stores data in a 'data' folder
    const adapter = new JSONFile<DatabaseSchema>(file);
    db = new Low(adapter, { userProfiles: {} });

    await db.read();
    console.log('User profile database initialized.');
}

/**
 * Retrieves a user's profile.
 * @param userId The ID of the user.
 * @returns The user's profile object, or an empty object if not found.
 */
export function getProfile(userId: string): UserProfile {
    if (!db || !db.data) {
        console.error('Database not initialized or data not loaded.');
        return {};
    }
    return db.data.userProfiles[userId] || {};
}

/**
 * Sets specific data within a user's profile.
 * @param userId The ID of the user.
 * @param data The partial UserProfile data to set.
 */
export async function setProfileData(userId: string, data: Partial<UserProfile>) {
    if (!db || !db.data) {
        console.error('Database not initialized or data not loaded.');
        return;
    }
    if (!db.data.userProfiles[userId]) {
        db.data.userProfiles[userId] = {};
    }
    Object.assign(db.data.userProfiles[userId], data);
    await db.write();
}

/**
 * Adds or updates a custom memory key-value pair for a user.
 * @param userId The ID of the user.
 * @param key The memory key.
 * @param value The memory value.
 */
export async function addCustomMemory(userId: string, key: string, value: string) {
    if (!db || !db.data) {
        console.error('Database not initialized or data not loaded.');
        return;
    }
    if (!db.data.userProfiles[userId]) {
        db.data.userProfiles[userId] = {};
    }
    if (!db.data.userProfiles[userId].customMemory) {
        db.data.userProfiles[userId].customMemory = {};
    }
    db.data.userProfiles[userId].customMemory![key] = value;
    await db.write();
}

/**
 * Removes a custom memory key from a user's profile.
 * @param userId The ID of the user.
 * @param key The memory key to remove.
 */
export async function removeCustomMemory(userId: string, key: string) {
    if (!db || !db.data) {
        console.error('Database not initialized or data not loaded.');
        return;
    }
    if (db.data.userProfiles[userId]?.customMemory) {
        delete db.data.userProfiles[userId].customMemory![key];
        // If customMemory is now empty, remove the object itself for cleanliness
        if (Object.keys(db.data.userProfiles[userId].customMemory!).length === 0) {
            delete db.data.userProfiles[userId].customMemory;
        }
        await db.write();
    }
}

/**
 * Clears specific data or the entire profile for a user.
 * @param userId The ID of the user.
 * @param key Optional. If provided, clears only a top-level key like 'tone' or 'persona'. If not, clears the entire profile.
 */
export async function clearProfileData(userId: string, key?: 'tone' | 'persona' | 'customMemory') {
    if (!db || !db.data) {
        console.error('Database not initialized or data not loaded.');
        return;
    }
    if (db.data.userProfiles[userId]) {
        if (key) {
            delete db.data.userProfiles[userId][key];
        } else {
            // Clear the entire profile for the user
            delete db.data.userProfiles[userId];
        }
        await db.write();
    }
}
