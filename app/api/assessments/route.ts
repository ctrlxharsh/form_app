/**
 * API Route: GET /api/assessments
 * 
 * Fetches assessments filtered by user role (RBAC) and class grade.
 * - M&E/Lead: All assessments
 * - Teacher/PM: Only assigned assessments
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');
        const role = searchParams.get('role');
        const classGrade = searchParams.get('classGrade');

        let assessments;

        // If user is logged in and not M&E/Lead, filter by assigned assessments
        if (userId && role && !['M&E', 'Lead'].includes(role)) {
            if (role === 'Program Manager') {
                // PM sees assessments assigned to their teachers
                if (classGrade) {
                    assessments = await sql`
                        SELECT DISTINCT a.assessment_id, a.title, a.description, 
                               a.class_grade, a.language, a.group_identifier, a.academic_year
                        FROM assessments a
                        JOIN access_role_assessments ara ON a.assessment_id = ara.assessment_id
                        JOIN user_access_roles uar ON ara.access_role_id = uar.access_role_id
                        JOIN program_manager_teacher_mapping pmtm ON uar.user_id = pmtm.teacher_id
                        WHERE a.status = 'published' 
                        AND a.is_active = true
                        AND a.class_grade = ${parseInt(classGrade)}
                        AND pmtm.program_manager_id = ${parseInt(userId)}
                        ORDER BY a.class_grade, a.title
                    `;
                } else {
                    assessments = await sql`
                        SELECT DISTINCT a.assessment_id, a.title, a.description, 
                               a.class_grade, a.language, a.group_identifier, a.academic_year
                        FROM assessments a
                        JOIN access_role_assessments ara ON a.assessment_id = ara.assessment_id
                        JOIN user_access_roles uar ON ara.access_role_id = uar.access_role_id
                        JOIN program_manager_teacher_mapping pmtm ON uar.user_id = pmtm.teacher_id
                        WHERE a.status = 'published' 
                        AND a.is_active = true
                        AND pmtm.program_manager_id = ${parseInt(userId)}
                        ORDER BY a.class_grade, a.title
                    `;
                }
            } else {
                // Teacher sees only their assigned assessments
                if (classGrade) {
                    assessments = await sql`
                        SELECT DISTINCT a.assessment_id, a.title, a.description, 
                               a.class_grade, a.language, a.group_identifier, a.academic_year
                        FROM assessments a
                        JOIN access_role_assessments ara ON a.assessment_id = ara.assessment_id
                        JOIN user_access_roles uar ON ara.access_role_id = uar.access_role_id
                        WHERE a.status = 'published' 
                        AND a.is_active = true
                        AND a.class_grade = ${parseInt(classGrade)}
                        AND uar.user_id = ${parseInt(userId)}
                        ORDER BY a.class_grade, a.title
                    `;
                } else {
                    assessments = await sql`
                        SELECT DISTINCT a.assessment_id, a.title, a.description, 
                               a.class_grade, a.language, a.group_identifier, a.academic_year
                        FROM assessments a
                        JOIN access_role_assessments ara ON a.assessment_id = ara.assessment_id
                        JOIN user_access_roles uar ON ara.access_role_id = uar.access_role_id
                        WHERE a.status = 'published' 
                        AND a.is_active = true
                        AND uar.user_id = ${parseInt(userId)}
                        ORDER BY a.class_grade, a.title
                    `;
                }
            }
        } else {
            // M&E/Lead or no user - show all published assessments
            if (classGrade) {
                assessments = await sql`
                    SELECT assessment_id, title, description, class_grade, language, 
                           group_identifier, academic_year
                    FROM assessments
                    WHERE status = 'published' AND is_active = true 
                    AND class_grade = ${parseInt(classGrade)}
                    ORDER BY title
                `;
            } else {
                assessments = await sql`
                    SELECT assessment_id, title, description, class_grade, language, 
                           group_identifier, academic_year
                    FROM assessments
                    WHERE status = 'published' AND is_active = true
                    ORDER BY class_grade, title
                `;
            }
        }

        return NextResponse.json(assessments);

    } catch (error) {
        console.error('Error fetching assessments:', error);
        return NextResponse.json(
            { error: 'Failed to fetch assessments' },
            { status: 500 }
        );
    }
}
