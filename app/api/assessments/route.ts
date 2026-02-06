/**
 * API Route: GET /api/assessments
 * 
 * Fetches assessments filtered by user role (RBAC) and class grade.
 * - M&E/Lead: All assessments
 * - Teacher: Hybrid Logic
 *   - 'survey': Via existing access_role_assessments
 *   - 'prototype'/'propagate'/'both': Via assigned schools (teacher_schools table) intersection
 * - Program Manager: Inherits all assessments visible to their assigned teachers
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');
        const role = searchParams.get('role');
        const classGrade = searchParams.get('classGrade');
        const parsedUserId = userId ? parseInt(userId) : null;
        const parsedClassGrade = classGrade ? parseInt(classGrade) : null;

        let assessments;

        if (parsedUserId && role && !['M&E', 'Lead'].includes(role)) {

            // Logic for Teachers and PMs
            // We use a CTE to determine accessible assessments based on the hybrid logic

            let query;

            if (role === 'Teacher') {
                // TEACHER LOGIC
                // 1. Survey: assigned via access_role_assessments
                // 2. Others: based on assigned schools' interventions

                query = sql`
                    WITH teacher_interventions AS (
                        /* Get distinct interventions from schools assigned to this teacher */
                        SELECT DISTINCT s.intervention
                        FROM schools s
                        JOIN teacher_schools ts ON s.school_id = ts.school_id
                        WHERE ts.teacher_id = ${parsedUserId}
                    ),
                    accessible_assessments AS (
                        /* 1. Assessments explicitly assigned via roles (Surveys) */
                        SELECT a.assessment_id
                        FROM assessments a
                        JOIN access_role_assessments ara ON a.assessment_id = ara.assessment_id
                        JOIN user_access_roles uar ON ara.access_role_id = uar.access_role_id
                        WHERE uar.user_id = ${parsedUserId}
                        AND a.assessment_type = 'survey'

                        UNION

                        /* 2. Assessments matching teacher's school contexts */
                        SELECT a.assessment_id
                        FROM assessments a
                        CROSS JOIN teacher_interventions ti
                        WHERE a.assessment_type IN ('prototype', 'propagate', 'both')
                        AND (
                            (a.assessment_type = 'prototype' AND ti.intervention = 'Prototype') OR
                            (a.assessment_type = 'propagate' AND ti.intervention = 'Propagate') OR
                            (a.assessment_type = 'both' AND ti.intervention IN ('Prototype', 'Propagate'))
                        )
                    )
                    SELECT DISTINCT a.assessment_id, a.title, a.description, 
                           a.class_grade, a.language, a.group_identifier, a.academic_year, a.assessment_type
                    FROM assessments a
                    JOIN accessible_assessments aa ON a.assessment_id = aa.assessment_id
                    WHERE a.status = 'published' AND a.is_active = true
                    ${parsedClassGrade ? sql`AND a.class_grade = ${parsedClassGrade}` : sql``}
                    ORDER BY a.class_grade, a.title
                `;

            } else if (role === 'Program Manager') {
                // PROGRAM MANAGER LOGIC
                // PM sees union of what their assigned teachers see

                query = sql`
                    WITH my_teachers AS (
                        SELECT teacher_id FROM program_manager_teacher_mapping 
                        WHERE program_manager_id = ${parsedUserId}
                    ),
                    teacher_interventions AS (
                        /* Get interventions for EACH teacher */
                        SELECT ts.teacher_id, s.intervention
                        FROM schools s
                        JOIN teacher_schools ts ON s.school_id = ts.school_id
                        WHERE ts.teacher_id IN (SELECT teacher_id FROM my_teachers)
                    ),
                    accessible_assessments AS (
                        /* 1. Surveys assigned to my teachers */
                        SELECT a.assessment_id
                        FROM assessments a
                        JOIN access_role_assessments ara ON a.assessment_id = ara.assessment_id
                        JOIN user_access_roles uar ON ara.access_role_id = uar.access_role_id
                        WHERE uar.user_id IN (SELECT teacher_id FROM my_teachers)
                        AND a.assessment_type = 'survey'

                        UNION

                        /* 2. Non-surveys visible to my teachers */
                        SELECT a.assessment_id
                        FROM assessments a
                        JOIN teacher_interventions ti ON 1=1 -- Logic handled in WHERE
                        WHERE a.assessment_type IN ('prototype', 'propagate', 'both')
                        AND (
                            (a.assessment_type = 'prototype' AND ti.intervention = 'Prototype') OR
                            (a.assessment_type = 'propagate' AND ti.intervention = 'Propagate') OR
                            (a.assessment_type = 'both' AND ti.intervention IN ('Prototype', 'Propagate'))
                        )
                    )
                    SELECT DISTINCT a.assessment_id, a.title, a.description, 
                           a.class_grade, a.language, a.group_identifier, a.academic_year, a.assessment_type
                    FROM assessments a
                    JOIN accessible_assessments aa ON a.assessment_id = aa.assessment_id
                    WHERE a.status = 'published' AND a.is_active = true
                    ${parsedClassGrade ? sql`AND a.class_grade = ${parsedClassGrade}` : sql``}
                    ORDER BY a.class_grade, a.title
                `;
            }

            assessments = await query;

        } else {
            // M&E/Lead or no user - show all published assessments
            assessments = await sql`
                SELECT assessment_id, title, description, class_grade, language, 
                       group_identifier, academic_year, assessment_type
                FROM assessments
                WHERE status = 'published' AND is_active = true
                ${parsedClassGrade ? sql`AND class_grade = ${parsedClassGrade}` : sql``}
                ORDER BY class_grade, title
            `;
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
