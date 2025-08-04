// Wabot-main/src/services/userProfile.service.ts (Corrected and Merged)

import path from 'path';

export interface UserProfile {
    tone?: string;
    persona?: string;
    automaticMemory?: Record<string, string>;
    memoryEnabled?: boolean;
}

interface DatabaseSchema {
    userProfiles: Record<string, UserProfile>;
}

let db: any;

export async function initializeUserProfileDB() {
    const dataDir = path.join(process.cwd(), 'data');
    try {
        await import('node:fs/promises').then(fs => fs.mkdir(dataDir, { recursive: true }));
    } catch (error) {
        console.error('Failed to create data directory:', error);
    }
    const file = path.join(dataDir, 'userProfiles.json');

    const { Low } = await import('lowdb');
    const { JSONFile } = await import('lowdb/node');

    const adapter = new JSONFile<DatabaseSchema>(file);
    db = new Low(adapter, { userProfiles: {} });

    await db.read();
    console.log('User profile database initialized.');
}

export function getProfile(userId: string): UserProfile {
    if (!db || !db.data) {
        console.error('Database not initialized.');
        return { memoryEnabled: true, automaticMemory: {} };
    }
    const profile = db.data.userProfiles[userId] || {};
    
    // Set defaults if they don't exist
    if (profile.memoryEnabled === undefined) profile.memoryEnabled = true;
    if (!profile.automaticMemory) profile.automaticMemory = {};

    return profile;
}

export async function setProfileData(userId: string, data: Partial<UserProfile>) {
    if (!db || !db.data) return;
    if (!db.data.userProfiles[userId]) {
        db.data.userProfiles[userId] = {};
    }
    Object.assign(db.data.userProfiles[userId], data);
    await db.write();
}

// Handles both adding and updating memories
export async function setAutomaticMemory(userId: string, key: string, value: string) {
    const profile = getProfile(userId);
    // This ensures automaticMemory exists before trying to assign to it
    if (!profile.automaticMemory) {
        profile.automaticMemory = {};
    }
    profile.automaticMemory[key] = value;
    await setProfileData(userId, { automaticMemory: profile.automaticMemory });
    console.log(`Automatically set/updated memory for user ${userId}: { ${key}: ${value} }`);
}

// Removes a single memory by its key
export async function removeMemory(userId: string, key: string): Promise<boolean> {
    const profile = getProfile(userId);
    if (profile.automaticMemory && profile.automaticMemory[key] !== undefined) {
        delete profile.automaticMemory[key];
        await db.write();
        return true;
    }
    return false;
}

// ADDED: Wipes all of a user's learned memories, as used by the handler
export async function clearAllMemory(userId: string) {
    const profile = getProfile(userId);
    if (profile) {
        profile.automaticMemory = {};
        await setProfileData(userId, { automaticMemory: {} });
        await db.write();
    }
}

export async function clearProfileData(userId: string) {
    if (!db?.data?.userProfiles[userId]) return;
    delete db.data.userProfiles[userId];
    await db.write();
}
