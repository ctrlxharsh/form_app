
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
        const isPrivileged = ['M&E', 'Lead', 'Admin', 'Program Lead', 'Program Manager'].includes(role);

        if (isPrivileged) {
            if (schoolId && classGrade) {
                students = await sql`
                    SELECT s.*, sc.school_name 
                    FROM students s
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE s.school_id = ${parseInt(schoolId)} 
                    AND s.class_grade = ${parseInt(classGrade)}
                    ORDER BY s.first_name, s.last_name
                `;
            } else if (schoolId) {
                 students = await sql`
                    SELECT s.*, sc.school_name 
                    FROM students s
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE s.school_id = ${parseInt(schoolId)} 
                    ORDER BY s.class_grade, s.first_name, s.last_name
                `;
            } else {
                students = await sql`
                    SELECT s.*, sc.school_name 
                    FROM students s
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    ORDER BY s.school_id, s.class_grade, s.first_name, s.last_name
                    LIMIT 2000
                `;
            }
        } else {
            if (schoolId && classGrade) {
                students = await sql`
                    SELECT s.*, sc.school_name 
                    FROM students s
                    JOIN teacher_schools ts ON s.school_id = ts.school_id
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE ts.teacher_id = ${parseInt(teacherId)}
                    AND s.school_id = ${parseInt(schoolId)} 
                    AND s.class_grade = ${parseInt(classGrade)}
                    ORDER BY s.first_name, s.last_name
                `;
            } else if (schoolId) {
                 students = await sql`
                    SELECT s.*, sc.school_name 
                    FROM students s
                    JOIN teacher_schools ts ON s.school_id = ts.school_id
                    LEFT JOIN schools sc ON s.school_id = sc.school_id
                    WHERE ts.teacher_id = ${parseInt(teacherId)}
                    AND s.school_id = ${parseInt(schoolId)} 
                    ORDER BY s.class_grade, s.first_name, s.last_name
                `;
            } else {
                students = await sql`
                    SELECT s.*, sc.school_name 
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
            dateOfBirth, fathersOccupation, mothersOccupation, address, emailId
        } = body;

        if (!uniqueId || !firstName || !schoolId) {
            return NextResponse.json({ error: 'uniqueId, firstName, and schoolId are required' }, { status: 400 });
        }

        const result = await sql`
            INSERT INTO students (
                unique_id, unique_cohort_id, first_name, last_name, fathers_name, mothers_name, 
                school_id, class_grade, section, password,
                date_of_birth, fathers_occupation, mothers_occupation, address, email_id
            ) VALUES (
                ${uniqueId}, ${cohortId}, ${firstName}, ${lastName}, ${fathersName}, ${mothersName}, 
                ${parseInt(schoolId)}, ${parseInt(classGrade)}, ${section}, ${password || '01012001'},
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
