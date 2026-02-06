/**
 * API Route: GET /api/schools
 * 
 * Fetches schools from PostgreSQL with RBAC + intervention filtering.
 * - M&E/Lead: All schools (optionally filtered by intervention)
 * - Teacher/PM: Only assigned schools (optionally filtered by intervention)
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';
import { logError } from '@/lib/error-logger';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const intervention = searchParams.get('intervention');
        const userId = searchParams.get('userId');
        const role = searchParams.get('role');

        let schools;

        // M&E, Lead, and Admin roles see all schools (filtered by intervention)
        // Teachers see ALL their assigned schools (no intervention filter for RBAC)
        if (userId && role && !['M&E', 'Lead', 'Admin'].includes(role)) {
            // Teacher or other roles - show ALL assigned schools (ignoring intervention filter)
            schools = await sql`
                SELECT DISTINCT s.school_id, s.school_name, s.udise_code, 
                       s.local_education_admin, s.state, s.district, s.intervention
                FROM schools s
                JOIN teacher_schools ts ON s.school_id = ts.school_id
                WHERE ts.teacher_id = ${parseInt(userId)}
                ORDER BY s.school_name
            `;
        } else if (intervention && ['Prototype', 'Propagate'].includes(intervention)) {
            // M&E/Lead with intervention filter
            schools = await sql`
                SELECT school_id, school_name, udise_code, local_education_admin, 
                       state, district, intervention
                FROM schools
                WHERE intervention = ${intervention}
                ORDER BY school_name
            `;
        } else {
            // M&E/Lead - all schools
            schools = await sql`
                SELECT school_id, school_name, udise_code, local_education_admin, 
                       state, district, intervention
                FROM schools
                ORDER BY school_name
            `;
        }

        return NextResponse.json(schools);

    } catch (error) {
        await logError({
            error,
            endpoint: '/api/schools GET',
            userId: request.nextUrl.searchParams.get('userId'),
            requestData: { intervention: request.nextUrl.searchParams.get('intervention'), role: request.nextUrl.searchParams.get('role') }
        });
        return NextResponse.json(
            { error: 'Failed to fetch schools' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/schools/validate
 * Validates that a school ID matches a UDISE code
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { schoolId, udiseCode } = body;

        if (!schoolId || !udiseCode) {
            return NextResponse.json(
                { error: 'Missing schoolId or udiseCode' },
                { status: 400 }
            );
        }

        const result = await sql`
            SELECT 1 FROM schools WHERE school_id = ${schoolId} AND udise_code = ${udiseCode}
        `;
        const isValid = result.length > 0;
        return NextResponse.json({ valid: isValid });

    } catch (error) {
        await logError({
            error,
            endpoint: '/api/schools POST (validate)',
            requestData: { schoolId: 'sanitized', udiseCode: 'sanitized' }
        });
        return NextResponse.json(
            { error: 'Failed to validate school' },
            { status: 500 }
        );
    }
}
