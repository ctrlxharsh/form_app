/**
 * Teacher Authentication Module
 * 
 * Handles teacher login, session persistence in IndexedDB,
 * and password verification for grading access.
 */

import { db } from './db';

// ============ TYPES ============

export interface TeacherSession {
    id: number;  // Always 1 - singleton session
    userId: number;
    username: string;
    fullName: string;
    role: string;
    passwordHash: string;  // Original hash from DB
    storedPassword: string;  // Encrypted password for offline verification
    canEdit: boolean;
    loggedInAt: Date;
}

export interface LoginCredentials {
    username: string;
    password: string;
}

export interface LoginResponse {
    success: boolean;
    error?: string;
    user?: {
        userId: number;
        username: string;
        fullName: string;
        role: string;
        passwordHash: string;
        canEdit: boolean;
    };
}

// ============ PASSWORD ENCRYPTION ============

/**
 * Simple XOR encryption for storing password locally
 * Not meant to be ultra-secure, just obfuscation
 */
function encryptPassword(password: string): string {
    const key = 'pijam-offline-key';
    let result = '';
    for (let i = 0; i < password.length; i++) {
        result += String.fromCharCode(password.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(result);  // Base64 encode
}

function decryptPassword(encrypted: string): string {
    const key = 'pijam-offline-key';
    const decoded = atob(encrypted);  // Base64 decode
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
}

// ============ SESSION MANAGEMENT ============

/**
 * Get current teacher session from IndexedDB
 */
export async function getTeacherSession(): Promise<TeacherSession | null> {
    try {
        const session = await db.table('teacherSession').get(1);
        return session || null;
    } catch {
        return null;
    }
}

/**
 * Save teacher session to IndexedDB
 */
export async function saveTeacherSession(
    session: Omit<TeacherSession, 'id' | 'loggedInAt'>,
    password: string
): Promise<void> {
    await db.table('teacherSession').put({
        id: 1,  // Singleton
        ...session,
        storedPassword: encryptPassword(password),
        loggedInAt: new Date()
    });
}

/**
 * Clear teacher session (logout)
 */
export async function clearTeacherSession(): Promise<void> {
    await db.table('teacherSession').delete(1);
}

/**
 * Check if teacher is logged in
 */
export async function isTeacherLoggedIn(): Promise<boolean> {
    const session = await getTeacherSession();
    return session !== null;
}

// ============ AUTHENTICATION ============

/**
 * Login teacher (requires online connection)
 */
export async function loginTeacher(credentials: LoginCredentials): Promise<LoginResponse> {
    const { getKnownUser, saveKnownUser } = await import('./db');

    // Offline Login Check
    if (!navigator.onLine) {
        try {
            const knownUser = await getKnownUser(credentials.username);
            if (!knownUser) {
                return { success: false, error: 'User not found on this device. Please login online first.' };
            }

            // Verify password
            const decryptedStored = decryptPassword(knownUser.storedPassword);
            if (credentials.password !== decryptedStored) {
                return { success: false, error: 'Invalid password' };
            }

            // Restore session
            await saveTeacherSession({
                userId: knownUser.userId,
                username: knownUser.username,
                fullName: knownUser.fullName,
                role: knownUser.role,
                passwordHash: knownUser.passwordHash,
                storedPassword: '', // Will be set by saveTeacherSession
                canEdit: knownUser.canEdit
            }, credentials.password);

            return {
                success: true,
                user: {
                    userId: knownUser.userId,
                    username: knownUser.username,
                    fullName: knownUser.fullName,
                    role: knownUser.role,
                    passwordHash: knownUser.passwordHash,
                    canEdit: knownUser.canEdit
                }
            };

        } catch (error) {
            return { success: false, error: 'Offline login failed: ' + (error instanceof Error ? error.message : 'Unknown error') };
        }
    }

    // Online Login
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials)
        });

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error || 'Login failed' };
        }

        // Save session to IndexedDB (with password for offline verification)
        await saveTeacherSession({
            userId: data.user.userId,
            username: data.user.username,
            fullName: data.user.fullName,
            role: data.user.role,
            passwordHash: data.user.passwordHash,
            storedPassword: '',  // Will be set by saveTeacherSession
            canEdit: data.user.canEdit
        }, credentials.password);

        // Save to known users cache for future offline login
        await saveKnownUser({
            userId: data.user.userId,
            username: data.user.username,
            fullName: data.user.fullName,
            role: data.user.role,
            passwordHash: data.user.passwordHash,
            storedPassword: encryptPassword(credentials.password),
            canEdit: data.user.canEdit,
            lastLoginAt: new Date()
        });

        return { success: true, user: data.user };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Network error'
        };
    }
}

/**
 * Logout teacher
 */
export async function logoutTeacher(): Promise<void> {
    await clearTeacherSession();
}

// ============ PASSWORD VERIFICATION ============

/**
 * Verify password against stored password (for grading access)
 */
export async function verifyStoredPassword(password: string): Promise<boolean> {
    const session = await getTeacherSession();
    if (!session) return false;

    try {
        // Compare with stored encrypted password
        const storedPassword = decryptPassword(session.storedPassword);
        return password === storedPassword;
    } catch {
        return false;
    }
}

