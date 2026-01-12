/**
 * API Route: POST /api/submit
 * 
 * Submits assessment answers to PostgreSQL.
 * Mirrors the submit_assessment() function from Streamlit middleware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSubmission, saveAnswer } from '@/lib/postgres';

interface SubmitRequest {
    assessmentId: number;
    schoolId: number;
    studentFirstName: string;
    studentLastName: string;
    selectedLanguage: string;
    geolocation?: string;
    gender: 'Male' | 'Female';
    classGrade: number;
    section: string;
    answers: Record<number, AnswerData>;
}

interface AnswerData {
    text?: string;
    selectedOptions?: number[];
    rankingOrder?: number[];
    imageUrl?: string;
}

export async function POST(request: NextRequest) {
    try {
        const body: SubmitRequest = await request.json();

        // Validate required fields
        const { assessmentId, schoolId, studentFirstName, studentLastName, selectedLanguage, geolocation, gender, classGrade, section, answers } = body;

        if (!assessmentId || !schoolId || !studentFirstName || !studentLastName || !selectedLanguage || !gender || !classGrade || !section) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Validate UDISE format is handled on client side
        // Validate gender
        if (!['Male', 'Female'].includes(gender)) {
            return NextResponse.json(
                { error: 'Invalid gender' },
                { status: 400 }
            );
        }

        // Validate class grade
        if (classGrade < 4 || classGrade > 10) {
            return NextResponse.json(
                { error: 'Class grade must be between 4 and 10' },
                { status: 400 }
            );
        }

        // Get IP address from request headers
        const forwardedFor = request.headers.get('x-forwarded-for');
        const ipAddress = forwardedFor ? forwardedFor.split(',')[0].trim() : null;

        // Create submission
        const submission = await createSubmission(
            assessmentId,
            schoolId,
            studentFirstName,
            studentLastName,
            gender,
            classGrade,
            section,
            selectedLanguage,
            geolocation,
            ipAddress
        );

        const submissionId = submission.submission_id;

        // Save each answer
        // This mirrors the logic from submit_all_answers() in Streamlit
        for (const [questionIdStr, answerData] of Object.entries(answers)) {
            const questionId = parseInt(questionIdStr, 10);

            await saveAnswer(
                submissionId,
                questionId,
                answerData.text ?? null,           // answer_text
                answerData.imageUrl ?? null,        // answer_image_url
                answerData.selectedOptions ?? null, // selected_options (array)
                answerData.rankingOrder ?? null     // ranking_order (array)
            );
        }

        return NextResponse.json({
            success: true,
            submissionId
        });

    } catch (error) {
        console.error('Error submitting assessment:', error);
        return NextResponse.json(
            { error: 'Failed to submit assessment' },
            { status: 500 }
        );
    }
}
