
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const cohortId = searchParams.get('cohortId');

        if (!cohortId) {
            return NextResponse.json({ error: 'cohortId is required' }, { status: 400 });
        }

        // Count students with this cohort ID to get the next sequence number
        const result = await sql`
            SELECT COUNT(*) FROM students 
            WHERE unique_cohort_id = ${cohortId}
        `;

        const nextSeq = parseInt(result[0].count) + 1;
        
        return NextResponse.json({ nextSeq });
    } catch (error) {
        console.error('[API/NextId] Error:', error);
        return NextResponse.json({ error: 'Failed to generate next sequence' }, { status: 500 });
    }
}
