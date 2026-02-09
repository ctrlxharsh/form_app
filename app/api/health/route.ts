/**
 * Health Check Endpoint
 * 
 * Minimal endpoint for verifying actual connectivity before syncing.
 */

import { NextResponse } from 'next/server';

export async function GET() {
    return NextResponse.json({ status: 'ok' });
}

export async function HEAD() {
    return new Response(null, { status: 200 });
}
