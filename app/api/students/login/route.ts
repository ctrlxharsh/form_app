
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';
import { formatUdise } from '@/lib/utils';

/**
 * POST /api/students/login
 * Verifies student unique_id and password, returns basic info.
 */
export async function POST(request: NextRequest) {
    try {
        const { studentId, password, assessmentId, teacherId, role } = await request.json();

        if (!studentId || !password) {
            return NextResponse.json({ error: 'Student ID and Password are required' }, { status: 400 });
        }

        const students = await sql`
            SELECT s.*, sc.school_name, sc.udise_code, sc.intervention 
            FROM students s
            LEFT JOIN schools sc ON s.school_id = sc.school_id
            WHERE s.unique_id = ${studentId} 
            AND s.password = ${password}
            LIMIT 1
        `;

        if (students.length === 0) {
            return NextResponse.json({ error: 'Invalid Student ID or Password' }, { status: 401 });
        }

        const student = students[0];

        // Access check based on teacherId & role
        if (role && ['Lead', 'Program Lead', 'Program Manager', 'PM', 'M&E', 'Admin'].includes(role.trim())) {
            return NextResponse.json({ error: 'Lead and Program Manager roles cannot start assessment logins. Please login with a Teacher ID.' }, { status: 403 });
        }

        if (teacherId) {
            const isPrivileged = false;
            if (!isPrivileged) {
                let hasAccess;
                const parsedTeacherId = parseInt(String(teacherId), 10);
                if (role === 'Program Manager') {
                    hasAccess = await sql`
                        SELECT 1 FROM teacher_schools ts
                        WHERE ts.school_id = ${student.school_id}
                        AND (
                            ts.teacher_id = ${parsedTeacherId}
                            OR ts.teacher_id IN (
                                SELECT teacher_id FROM program_manager_teacher_mapping 
                                WHERE program_manager_id = ${parsedTeacherId}
                            )
                        )
                        LIMIT 1
                    `;
                } else {
                    hasAccess = await sql`
                        SELECT 1 FROM teacher_schools ts
                        WHERE ts.school_id = ${student.school_id}
                        AND ts.teacher_id = ${parsedTeacherId}
                        LIMIT 1
                    `;
                }

                if (hasAccess.length === 0) {
                    return NextResponse.json({ error: 'You do not have access to this student' }, { status: 403 });
                }
            }
        }

        // Check for duplicate submission (across all language variants) if assessmentId is passed
        let hasSubmitted = false;
        if (assessmentId) {
            const existing = await sql`
                SELECT 1 FROM submissions 
                WHERE student_id = ${student.student_id} 
                AND assessment_id IN (
                    SELECT a2.assessment_id FROM assessments a1
                    JOIN assessments a2 ON (
                        a2.group_identifier = a1.group_identifier
                        OR (a1.group_identifier IS NULL AND a2.group_identifier IS NULL
                            AND LOWER(TRIM(a2.title)) = LOWER(TRIM(a1.title))
                            AND a2.class_grade = a1.class_grade)
                    )
                    WHERE a1.assessment_id = ${parseInt(assessmentId)}
                )
                LIMIT 1
            `;
            if (existing.length > 0) {
                hasSubmitted = true;
            }
        }

        return NextResponse.json({
            studentId: student.student_id,
            studentFirstName: student.first_name,
            studentLastName: student.last_name,
            studentName: `${student.first_name} ${student.last_name}`,
            classGrade: student.class_grade,
            section: student.section,
            schoolId: student.school_id,
            schoolName: student.school_name,
            udiseCode: formatUdise(student.udise_code),
            intervention: student.intervention || 'Prototype',
            gender: student.gender || 'Male',
            hasSubmitted
        });

    } catch (error) {
        console.error('[API/Students/Login] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
