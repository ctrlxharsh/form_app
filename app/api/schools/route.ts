/**
 * API Route: GET /api/schools
 * 
 * Fetches schools from PostgreSQL with RBAC + intervention filtering.
 * - M&E/Lead: All schools (optionally filtered by intervention)
 * - Teacher/PM: Only assigned schools (optionally filtered by intervention)
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const intervention = searchParams.get('intervention');
        const userId = searchParams.get('userId');
        const role = searchParams.get('role');

        let schools;

        // If user is logged in and not M&E/Lead, filter by assigned schools
        if (userId && role && !['M&E', 'Lead'].includes(role)) {
            if (role === 'Program Manager') {
                // PM sees schools assigned to their teachers + intervention filter
                if (intervention && ['Prototype', 'Propagate'].includes(intervention)) {
                    schools = await sql`
                        SELECT DISTINCT s.school_id, s.school_name, s.udise_code, 
                               s.local_education_admin, s.state, s.district, s.intervention
                        FROM schools s
                        JOIN access_role_schools ars ON s.school_id = ars.school_id
                        JOIN user_access_roles uar ON ars.access_role_id = uar.access_role_id
                        JOIN program_manager_teacher_mapping pmtm ON uar.user_id = pmtm.teacher_id
                        WHERE pmtm.program_manager_id = ${parseInt(userId)}
                        AND s.intervention = ${intervention}
                        ORDER BY s.school_name
                    `;
                } else {
                    schools = await sql`
                        SELECT DISTINCT s.school_id, s.school_name, s.udise_code, 
                               s.local_education_admin, s.state, s.district, s.intervention
                        FROM schools s
                        JOIN access_role_schools ars ON s.school_id = ars.school_id
                        JOIN user_access_roles uar ON ars.access_role_id = uar.access_role_id
                        JOIN program_manager_teacher_mapping pmtm ON uar.user_id = pmtm.teacher_id
                        WHERE pmtm.program_manager_id = ${parseInt(userId)}
                        ORDER BY s.school_name
                    `;
                }
            } else {
                // Teacher sees only their assigned schools + intervention filter
                if (intervention && ['Prototype', 'Propagate'].includes(intervention)) {
                    schools = await sql`
                        SELECT DISTINCT s.school_id, s.school_name, s.udise_code, 
                               s.local_education_admin, s.state, s.district, s.intervention
                        FROM schools s
                        JOIN access_role_schools ars ON s.school_id = ars.school_id
                        JOIN user_access_roles uar ON ars.access_role_id = uar.access_role_id
                        WHERE uar.user_id = ${parseInt(userId)}
                        AND s.intervention = ${intervention}
                        ORDER BY s.school_name
                    `;
                } else {
                    schools = await sql`
                        SELECT DISTINCT s.school_id, s.school_name, s.udise_code, 
                               s.local_education_admin, s.state, s.district, s.intervention
                        FROM schools s
                        JOIN access_role_schools ars ON s.school_id = ars.school_id
                        JOIN user_access_roles uar ON ars.access_role_id = uar.access_role_id
                        WHERE uar.user_id = ${parseInt(userId)}
                        ORDER BY s.school_name
                    `;
                }
            }
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

        const result = await sql`
            SELECT 1 FROM schools WHERE school_id = ${schoolId} AND udise_code = ${udiseCode}
        `;
        const isValid = result.length > 0;
        return NextResponse.json({ valid: isValid });

    } catch (error) {
        console.error('Error validating school:', error);
        return NextResponse.json(
            { error: 'Failed to validate school' },
            { status: 500 }
        );
    }
}
