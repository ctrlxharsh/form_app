/**
 * Health Check Endpoint
 * 
 * Minimal endpoint for verifying actual connectivity before syncing.
 */

import { NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';

export async function GET() {
    try {
        await sql`SELECT 1`;
        return NextResponse.json({ status: 'ok' });
    } catch (e) {
        return NextResponse.json({ status: 'error', message: 'Database unreachable' }, { status: 503 });
    }
}

export async function HEAD() {
    try {
        await sql`SELECT 1`;
        return new Response(null, { status: 200 });
    } catch (e) {
        return new Response(null, { status: 503 });
    }
}
