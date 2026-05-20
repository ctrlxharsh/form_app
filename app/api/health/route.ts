/**
 * Health Check Endpoint
 * 
 * Minimal endpoint for verifying actual network connectivity.
 * This intentionally does NOT query the database — it only needs to prove
 * that the client can reach the server. DB availability is a separate concern
 * and should not affect the online/offline indicator.
 */

import { NextResponse } from 'next/server';

export async function GET() {
    return NextResponse.json({ status: 'ok' });
}

export async function HEAD() {
    return new Response(null, { status: 200 });
}
