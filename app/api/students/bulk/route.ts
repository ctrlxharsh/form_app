
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';
import { logError } from '@/lib/error-logger';

interface BulkStudent {
    schoolName: string;
    classGrade: string | number;
    firstName: string;
    lastName?: string;
    password?: string;
    section?: string;
    fatherName?: string;
    motherName?: string;
    dateOfBirth?: string;
    fathersOccupation?: string;
    mothersOccupation?: string;
    address?: string;
    emailId?: string;
}

const STATE_CODES: Record<string, string> = {
    'Maharashtra': 'MH',
    'MAHARASHTRA': 'MH',
    'Karnataka': 'KA',
    'KARNATAKA': 'KA',
    'Goa': 'GA',
    'GOA': 'GA',
    'Gujarat': 'GJ',
    'GUJARAT': 'GJ',
    'Telangana': 'TS',
    'TELANGANA': 'TS',
};

function getStateCode(stateName: string): string {
    return STATE_CODES[stateName] || stateName?.substring(0, 2).toUpperCase() || 'MH';
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { students, teacherId } = body;

        if (!students || !Array.isArray(students)) {
            return NextResponse.json({ error: 'Invalid students data' }, { status: 400 });
        }

        const allSchools = await sql`SELECT school_id, school_name, udise_code, state FROM schools`;
        const schoolMap = new Map();
        allSchools.forEach(s => {
            schoolMap.set(s.school_name.toLowerCase().trim(), s);
        });

        const errors: string[] = [];
        const validStudents: any[] = [];
        const cohortCounters = new Map<string, number>();

        for (let i = 0; i < students.length; i++) {
            const s = students[i];
            const rowNum = i + 1;

            if (!s.schoolName || !s.classGrade || !s.firstName) {
                errors.push(`Row ${rowNum}: Mandatory fields (schoolName, classGrade, firstName) are missing.`);
                continue;
            }

            const school = schoolMap.get(s.schoolName.toLowerCase().trim());
            if (!school) {
                errors.push(`Row ${rowNum}: Invalid school name "${s.schoolName}".`);
                continue;
            }

            const classGrade = parseInt(s.classGrade.toString());
            if (isNaN(classGrade) || classGrade < 4 || classGrade > 10) {
                errors.push(`Row ${rowNum}: Invalid class grade "${s.classGrade}".`);
                continue;
            }

            const stateCode = getStateCode(school.state);
            const udiseLast5 = school.udise_code.slice(-5);
            const currentYear = 2026;
            const passingYear = (currentYear + (10 - classGrade)).toString().slice(-2);
            const cohortId = `PJM${stateCode}${passingYear}${udiseLast5}`;

            if (!cohortCounters.has(cohortId)) {
                const existingCount = await sql`SELECT COUNT(*) FROM students WHERE unique_cohort_id = ${cohortId}`;
                cohortCounters.set(cohortId, parseInt(existingCount[0].count));
            }
            
            const nextVal = cohortCounters.get(cohortId)! + 1;
            cohortCounters.set(cohortId, nextVal);
            const uniqueId = `${cohortId}${nextVal.toString().padStart(4, '0')}`;

            validStudents.push({
                unique_id: uniqueId,
                unique_cohort_id: cohortId,
                first_name: s.firstName,
                last_name: s.lastName || '',
                fathers_name: s.fatherName || '',
                mothers_name: s.motherName || '',
                school_id: school.school_id,
                class_grade: classGrade,
                section: s.section || 'A',
                password: s.password || '01012001',
                date_of_birth: s.dateOfBirth || null,
                fathers_occupation: s.fathersOccupation || '',
                mothers_occupation: s.mothersOccupation || '',
                address: s.address || '',
                email_id: s.emailId || ''
            });
        }

        if (errors.length > 0) {
            return NextResponse.json({ errors }, { status: 400 });
        }

        if (validStudents.length > 0) {
            await sql.begin(async sql => {
                for (const student of validStudents) {
                    await sql`INSERT INTO students ${sql(student)}`;
                }
            });
        }

        return NextResponse.json({ success: true, message: `Successfully uploaded ${validStudents.length} students.` });
    } catch (error) {
        console.error('[Bulk Upload] Error:', error);
        return NextResponse.json({ error: 'Failed to process bulk upload' }, { status: 500 });
    }
}
