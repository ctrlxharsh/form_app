/**
 * API Route: GET /api/forms/[id]
 * 
 * Fetches complete form structure (assessment + sections + questions + options)
 * from PostgreSQL. Mirrors get_full_assessment() from the Streamlit app.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFullAssessment } from '@/lib/postgres';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const assessmentId = parseInt(id, 10);

        if (isNaN(assessmentId)) {
            return NextResponse.json(
                { error: 'Invalid assessment ID' },
                { status: 400 }
            );
        }

        const assessment = await getFullAssessment(assessmentId);

        if (!assessment) {
            return NextResponse.json(
                { error: 'Assessment not found' },
                { status: 404 }
            );
        }

        // Only return published assessments for public access
        if (assessment.status !== 'published') {
            return NextResponse.json(
                { error: 'Assessment not available' },
                { status: 403 }
            );
        }

        return NextResponse.json(assessment);

    } catch (error) {
        console.error('Error fetching assessment:', error);
        return NextResponse.json(
            { error: 'Failed to fetch assessment' },
            { status: 500 }
        );
    }
}
