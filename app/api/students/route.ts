
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';
import { logError } from '@/lib/error-logger';

/**
 * GET /api/students?schoolId=X&classGrade=Y&teacherId=Z&role=W
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const schoolId = searchParams.get('schoolId');
        const classGrade = searchParams.get('classGrade');
        const teacherId = searchParams.get('teacherId');
        const role = searchParams.get('role') || 'Teacher';

        if (!teacherId) {
            return NextResponse.json({ error: 'teacherId is required' }, { status: 400 });
        }

        let students;
        const isPrivileged = ['M&E', 'Lead', 'Admin', 'Program Lead'].includes(role);

        if (isPrivileged) {
            if (schoolId && classGrade) {
                students = await sql`
                    SELECT s.*, sc.school_name, sc.udise_code, sc.intervention 
                    FROM students s
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE s.school_id = ${parseInt(schoolId)} 
                    AND s.class_grade = ${classGrade.toString()}
                    ORDER BY s.first_name, s.last_name
                `;
            } else if (schoolId) {
                 students = await sql`
                    SELECT s.*, sc.school_name, sc.udise_code, sc.intervention 
                    FROM students s
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE s.school_id = ${parseInt(schoolId)} 
                    ORDER BY s.class_grade, s.first_name, s.last_name
                `;
            } else {
                students = await sql`
                    SELECT s.*, sc.school_name, sc.udise_code, sc.intervention 
                    FROM students s
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    ORDER BY s.school_id, s.class_grade, s.first_name, s.last_name
                    LIMIT 2000
                `;
            }
        } else if (role === 'Program Manager') {
            if (schoolId && classGrade) {
                students = await sql`
                    SELECT DISTINCT s.*, sc.school_name, sc.udise_code, sc.intervention 
                    FROM students s
                    JOIN teacher_schools ts ON s.school_id = ts.school_id
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE (
                        ts.teacher_id = ${parseInt(teacherId)}
                        OR ts.teacher_id IN (
                            SELECT teacher_id FROM program_manager_teacher_mapping 
                            WHERE program_manager_id = ${parseInt(teacherId)}
                        )
                    )
                    AND s.school_id = ${parseInt(schoolId)} 
                    AND s.class_grade = ${classGrade.toString()}
                    ORDER BY s.first_name, s.last_name
                `;
            } else if (schoolId) {
                 students = await sql`
                    SELECT DISTINCT s.*, sc.school_name, sc.udise_code, sc.intervention 
                    FROM students s
                    JOIN teacher_schools ts ON s.school_id = ts.school_id
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE (
                        ts.teacher_id = ${parseInt(teacherId)}
                        OR ts.teacher_id IN (
                            SELECT teacher_id FROM program_manager_teacher_mapping 
                            WHERE program_manager_id = ${parseInt(teacherId)}
                        )
                    )
                    AND s.school_id = ${parseInt(schoolId)} 
                    ORDER BY s.class_grade, s.first_name, s.last_name
                `;
            } else {
                students = await sql`
                    SELECT DISTINCT s.*, sc.school_name, sc.udise_code, sc.intervention 
                    FROM students s
                    JOIN teacher_schools ts ON s.school_id = ts.school_id
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE (
                        ts.teacher_id = ${parseInt(teacherId)}
                        OR ts.teacher_id IN (
                            SELECT teacher_id FROM program_manager_teacher_mapping 
                            WHERE program_manager_id = ${parseInt(teacherId)}
                        )
                    )
                    ORDER BY s.school_id, s.class_grade, s.first_name, s.last_name
                `;
            }
        } else {
            if (schoolId && classGrade) {
                students = await sql`
                    SELECT s.*, sc.school_name, sc.udise_code, sc.intervention 
                    FROM students s
                    JOIN teacher_schools ts ON s.school_id = ts.school_id
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE ts.teacher_id = ${parseInt(teacherId)}
                    AND s.school_id = ${parseInt(schoolId)} 
                    AND s.class_grade = ${classGrade.toString()}
                    ORDER BY s.first_name, s.last_name
                `;
            } else if (schoolId) {
                 students = await sql`
                    SELECT s.*, sc.school_name, sc.udise_code, sc.intervention 
                    FROM students s
                    JOIN teacher_schools ts ON s.school_id = ts.school_id
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE ts.teacher_id = ${parseInt(teacherId)}
                    AND s.school_id = ${parseInt(schoolId)} 
                    ORDER BY s.class_grade, s.first_name, s.last_name
                `;
            } else {
                students = await sql`
                    SELECT s.*, sc.school_name, sc.udise_code, sc.intervention 
                    FROM students s
                    JOIN teacher_schools ts ON s.school_id = ts.school_id
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE ts.teacher_id = ${parseInt(teacherId)}
                    ORDER BY s.school_id, s.class_grade, s.first_name, s.last_name
                `;
            }
        }

        return NextResponse.json(students);
    } catch (error) {
        await logError({
            error,
            endpoint: '/api/students GET',
            userId: request.nextUrl.searchParams.get('teacherId')
        });
        return NextResponse.json({ error: 'Failed to fetch students' }, { status: 500 });
    }
}

/**
 * POST /api/students
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { 
            uniqueId, cohortId, firstName, lastName, fathersName, mothersName, 
            schoolId, classGrade, section, password, 
            dateOfBirth, fathersOccupation, mothersOccupation, address, emailId,
            teacherId, role
        } = body;

        if (!uniqueId || !firstName || !schoolId || !teacherId) {
            return NextResponse.json({ error: 'uniqueId, firstName, schoolId, and teacherId are required' }, { status: 400 });
        }

        const isPrivileged = ['M&E', 'Lead', 'Admin', 'Program Lead'].includes(role || 'Teacher');

        if (!isPrivileged) {
            let hasAccess;
            if (role === 'Program Manager') {
                hasAccess = await sql`
                    SELECT 1 FROM teacher_schools ts
                    JOIN program_manager_teacher_mapping pmtm ON ts.teacher_id = pmtm.teacher_id
                    WHERE pmtm.program_manager_id = ${parseInt(teacherId)} AND ts.school_id = ${parseInt(schoolId)}
                    UNION
                    SELECT 1 FROM teacher_schools 
                    WHERE teacher_id = ${parseInt(teacherId)} AND school_id = ${parseInt(schoolId)}
                `;
            } else {
                hasAccess = await sql`
                    SELECT 1 FROM teacher_schools 
                    WHERE teacher_id = ${parseInt(teacherId)} AND school_id = ${parseInt(schoolId)}
                `;
            }
            if (hasAccess.length === 0) {
                return NextResponse.json({ error: 'You do not have access to this school' }, { status: 403 });
            }
        }

        const schools = await sql`SELECT udise_code FROM schools WHERE school_id = ${parseInt(schoolId)}`;
        const schoolUdise = schools.length > 0 ? schools[0].udise_code : '';

        const result = await sql`
            INSERT INTO students (
                unique_id, unique_cohort_id, first_name, last_name, fathers_name, mothers_name, 
                school_id, school_udise, class_grade, section, password,
                date_of_birth, fathers_occupation, mothers_occupation, address, email_id
            ) VALUES (
                ${uniqueId}, ${cohortId}, ${firstName}, ${lastName}, ${fathersName}, ${mothersName}, 
                ${parseInt(schoolId)}, ${schoolUdise}, ${classGrade ? classGrade.toString() : null}, ${section}, ${password || '01012001'},
                ${dateOfBirth || null}, ${fathersOccupation || ''}, ${mothersOccupation || ''}, ${address || ''}, ${emailId || ''}
            )
            RETURNING *
        `;

        return NextResponse.json(result[0]);
    } catch (error) {
        await logError({
            error,
            endpoint: '/api/students POST'
        });
        return NextResponse.json({ error: 'Failed to add student' }, { status: 500 });
    }
}
