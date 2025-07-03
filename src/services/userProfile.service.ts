// src/services/userProfile.service.ts

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';

// Define the structure of your database
interface UserProfile {
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
    const file = path.join(process.cwd(), 'data', 'userProfiles.json'); // Stores data in a 'data' folder
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
 * Clears specific data or the entire profile for a user.
 * @param userId The ID of the user.
 * @param key Optional. The specific key to clear (e.g., 'tone', 'persona', 'customMemory'). If not provided, clears the entire profile.
 */
export async function clearProfileData(userId: string, key?: keyof UserProfile) {
    if (!db || !db.data) {
        console.error('Database not initialized or data not loaded.');
        return;
    }
    if (db.data.userProfiles[userId]) {
        if (key) {
            delete db.data.userProfiles[userId][key];
        } else {
            delete db.data.userProfiles[userId];
        }
        await db.write();
    }
}
