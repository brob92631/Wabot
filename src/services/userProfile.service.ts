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
    const dataDir = path.join(process.cwd(), 'data');
    try {
        await import('node:fs/promises').then(fs => fs.mkdir(dataDir, { recursive: true }));
    } catch (error) {
        console.error('Failed to create data directory:', error);
    }

    const { Low } = await import('lowdb');
    const { JSONFile } = await import('lowdb/node');

    const file = path.join(dataDir, 'userProfiles.json');
    const adapter = new JSONFile<DatabaseSchema>(file);
    db = new Low(adapter, { userProfiles: {} });

    await db.read();
    console.log('User profile database initialized.');
}

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
