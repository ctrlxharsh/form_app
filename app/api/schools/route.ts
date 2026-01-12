/**
 * API Route: GET /api/schools
 * 
 * Fetches schools from PostgreSQL.
 * - GET /api/schools?all=true → Returns all schools (for syncing to IndexedDB)
 * - GET /api/schools?intervention=Prototype → Returns schools by intervention type
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllSchools, getSchoolsByIntervention, validateSchoolUdise } from '@/lib/postgres';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const all = searchParams.get('all');
        const intervention = searchParams.get('intervention');

        // Return all schools for syncing
        if (all === 'true') {
            const schools = await getAllSchools();
            return NextResponse.json(schools);
        }

        // Return schools filtered by intervention
        if (intervention) {
            if (!['Prototype', 'Propagate'].includes(intervention)) {
                return NextResponse.json(
                    { error: 'Invalid intervention type' },
                    { status: 400 }
                );
            }

            const schools = await getSchoolsByIntervention(intervention);
            return NextResponse.json(schools);
        }

        // Default: return all schools
        const schools = await getAllSchools();
        return NextResponse.json(schools);

    } catch (error) {
        console.error('Error fetching schools:', error);
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

        const isValid = await validateSchoolUdise(schoolId, udiseCode);
        return NextResponse.json({ valid: isValid });

    } catch (error) {
        console.error('Error validating school:', error);
        return NextResponse.json(
            { error: 'Failed to validate school' },
            { status: 500 }
        );
    }
}
