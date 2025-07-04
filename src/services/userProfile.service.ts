// src/services/userProfile.service.ts

import path from 'path';

export interface UserProfile {
    tone?: string;
    persona?: string;
    customMemory?: Record<string, string>;
}

interface DatabaseSchema {
    userProfiles: Record<string, UserProfile>;
}

let db: any;

export async function initializeUserProfileDB() {
    // This is the critical fix for Vercel's filesystem.
    // It writes the database to the one writable directory: /tmp.
    const file = path.join('/tmp', 'userProfiles.json');

    const { Low } = await import('lowdb');
    const { JSONFile } = await import('lowdb/node');

    const adapter = new JSONFile<DatabaseSchema>(file);
    db = new Low(adapter, { userProfiles: {} });

    try {
        await db.read();
    } catch (e) {
        // If the file doesn't exist, it's okay. LowDB will create it on the first write.
        console.log("No existing database found. A new one will be created on first write.");
    }
    
    console.log('User profile database initialized. Storage path:', file);
}

// The rest of the functions in this file remain the same
// (getProfile, setProfileData, etc.)

export function getProfile(userId: string): UserProfile {
    if (!db || !db.data) {
        console.error('Database not initialized.');
        return {};
    }
    return db.data.userProfiles[userId] || {};
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
    if (!db || !db.data) return;
    if (!db.data.userProfiles[userId]) {
        db.data.userProfiles[userId] = {};
    }
    if (!db.data.userProfiles[userId].customMemory) {
        db.data.userProfiles[userId].customMemory = {};
    }
    db.data.userProfiles[userId].customMemory![key] = value;
    await db.write();
}

export async function removeCustomMemory(userId: string, key: string) {
    if (!db?.data?.userProfiles[userId]?.customMemory) return;
    
    delete db.data.userProfiles[userId].customMemory![key];
    if (Object.keys(db.data.userProfiles[userId].customMemory!).length === 0) {
        delete db.data.userProfiles[userId].customMemory;
    }
    await db.write();
}

export async function clearProfileData(userId: string, key?: 'tone' | 'persona' | 'customMemory') {
    if (!db?.data?.userProfiles[userId]) return;

    if (key) {
        delete db.data.userProfiles[userId][key];
    } else {
        delete db.data.userProfiles[userId];
    }
    await db.write();
}
