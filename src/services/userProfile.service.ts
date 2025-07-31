// Wabot-main/src/services/userProfile.service.ts

import path from 'path';

export interface UserProfile {
    tone?: string;
    persona?: string;
    customMemory?: Record<string, string>;
    automaticMemory?: Record<string, string>; // Added for automatic memory
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
        return { memoryEnabled: true, customMemory: {}, automaticMemory: {} };
    }
    const profile = db.data.userProfiles[userId] || {};
    
    // Set defaults for new features
    if (profile.memoryEnabled === undefined) profile.memoryEnabled = true;
    if (!profile.customMemory) profile.customMemory = {};
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

export async function addCustomMemory(userId: string, key: string, value: string) {
    const profile = getProfile(userId);
    profile.customMemory![key] = value;
    await setProfileData(userId, { customMemory: profile.customMemory });
}

// New function for automatic memory
export async function addAutomaticMemory(userId: string, key: string, value: string) {
    const profile = getProfile(userId);
    // Don't overwrite a manual memory with an automatic one
    if (profile.customMemory && profile.customMemory[key]) {
        console.log(`Automatic memory for key "${key}" ignored; a manual memory already exists.`);
        return;
    }
    profile.automaticMemory![key] = value;
    await setProfileData(userId, { automaticMemory: profile.automaticMemory });
    console.log(`Automatically remembered for user ${userId}: { ${key}: ${value} }`);
}

// Updated to handle both memory types
export async function removeMemory(userId: string, key: string): Promise<boolean> {
    const profile = getProfile(userId);
    let memoryFound = false;

    if (profile.customMemory && profile.customMemory[key]) {
        delete profile.customMemory[key];
        memoryFound = true;
    } else if (profile.automaticMemory && profile.automaticMemory[key]) {
        delete profile.automaticMemory[key];
        memoryFound = true;
    }

    if (memoryFound) {
        await db.write();
    }
    return memoryFound;
}

export async function clearProfileData(userId: string) {
    if (!db?.data?.userProfiles[userId]) return;
    delete db.data.userProfiles[userId];
    await db.write();
}
