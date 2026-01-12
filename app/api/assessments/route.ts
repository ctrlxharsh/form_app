/**
 * API Route: GET /api/assessments
 * 
 * Fetches list of published assessments.
 * - GET /api/assessments?class=5 → Returns assessments for a specific class
 * - GET /api/assessments → Returns all published assessments
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPublishedAssessmentsByClass, getAllPublishedAssessments } from '@/lib/postgres';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const classGrade = searchParams.get('class');

        if (classGrade) {
            const grade = parseInt(classGrade, 10);
            if (isNaN(grade) || grade < 4 || grade > 10) {
                return NextResponse.json(
                    { error: 'Class must be between 4 and 10' },
                    { status: 400 }
                );
            }

            const assessments = await getPublishedAssessmentsByClass(grade);
            return NextResponse.json(assessments);
        }

        // Return all published assessments
        const assessments = await getAllPublishedAssessments();
        return NextResponse.json(assessments);

    } catch (error) {
        console.error('Error fetching assessments:', error);
        return NextResponse.json(
            { error: 'Failed to fetch assessments' },
            { status: 500 }
        );
    }
}
