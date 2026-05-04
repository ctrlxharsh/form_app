
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';

/**
 * POST /api/students/login
 * Verifies student unique_id and password, returns basic info.
 */
export async function POST(request: NextRequest) {
    try {
        const { studentId, password } = await request.json();

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

        return NextResponse.json({
            studentId: student.student_id,
            studentFirstName: student.first_name,
            studentLastName: student.last_name,
            studentName: `${student.first_name} ${student.last_name}`,
            classGrade: student.class_grade,
            section: student.section,
            schoolId: student.school_id,
            schoolName: student.school_name,
            udiseCode: student.udise_code,
            intervention: student.intervention || 'Prototype',
            gender: student.gender || 'Male'
        });

    } catch (error) {
        console.error('[API/Students/Login] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
