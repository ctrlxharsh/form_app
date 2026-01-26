/**
 * API Route: POST /api/auth/login
 * 
 * Authenticates teacher credentials against the database.
 * Returns user info including password_hash for offline verification.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';

interface LoginRequest {
    username: string;
    password: string;
}

/**
 * Verify password against stored hash
 * Hash format: "salt:hash" using SHA-256
 */
async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    try {
        const [salt, hash] = storedHash.split(':');
        if (!salt || !hash) return false;

        // Create SHA-256 hash of salt + password
        const encoder = new TextEncoder();
        const data = encoder.encode(salt + password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        return computedHash === hash;
    } catch {
        return false;
    }
}

export async function POST(request: NextRequest) {
    try {
        const body: LoginRequest = await request.json();
        const { username, password } = body;

        if (!username || !password) {
            return NextResponse.json(
                { error: 'Username and password are required' },
                { status: 400 }
            );
        }

        // Fetch user with role info
        const users = await sql`
            SELECT u.user_id, u.username, u.email, u.full_name, u.password_hash,
                   r.role_name, COALESCE(r.can_edit, false) as can_edit
            FROM users u
            JOIN user_roles ur ON u.user_id = ur.user_id
            JOIN roles r ON ur.role_id = r.role_id
            WHERE u.username = ${username} AND u.is_active = true
            LIMIT 1
        `;

        if (users.length === 0) {
            return NextResponse.json(
                { error: 'Invalid username or password' },
                { status: 401 }
            );
        }

        const user = users[0];

        // Verify password
        const isValid = await verifyPassword(password, user.password_hash);
        if (!isValid) {
            return NextResponse.json(
                { error: 'Invalid username or password' },
                { status: 401 }
            );
        }

        // Update last login
        await sql`
            UPDATE users SET last_login = NOW() WHERE user_id = ${user.user_id}
        `;

        // Return user info (including hash for offline verification)
        return NextResponse.json({
            success: true,
            user: {
                userId: user.user_id,
                username: user.username,
                fullName: user.full_name,
                role: user.role_name,
                passwordHash: user.password_hash,
                canEdit: user.can_edit
            }
        });

    } catch (error) {
        console.error('Login error details:', error);
        // @ts-ignore
        if (error.message) console.error('Error message:', error.message);
        // @ts-ignore
        if (error.stack) console.error('Error stack:', error.stack);

        return NextResponse.json(
            // @ts-ignore
            { error: 'Authentication failed', details: error.message },
            { status: 500 }
        );
    }
}
