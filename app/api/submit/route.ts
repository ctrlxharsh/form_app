/**
 * API Route: POST /api/submit
 * 
 * Submits assessment answers to PostgreSQL.
 * Mirrors the submit_assessment() function from Streamlit middleware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSubmission, saveAnswer, getFullAssessment } from '@/lib/postgres';
import { logError } from '@/lib/error-logger';

interface SubmitRequest {
    assessmentId: number;
    clientSubmissionId?: string; // UUID for upsert
    schoolId: number;
    studentFirstName: string;
    studentLastName: string;
    selectedLanguage: string;
    geolocation?: string;
    gender: 'Male' | 'Female';
    classGrade: number;
    section: string;
    answers: Record<number, AnswerData>;
    submittedByTeacher?: number;  // Teacher user ID if logged in
}

interface AnswerData {
    text?: string;
    selectedOptions?: number[];
    rankingOrder?: number[];
    imageUrl?: string;
    marksAwarded?: number;
}

export async function POST(request: NextRequest) {
    try {
        const body: SubmitRequest = await request.json();

        // Validate required fields
        const { assessmentId, clientSubmissionId, schoolId, studentFirstName, studentLastName, selectedLanguage, geolocation, gender, classGrade, section, answers, submittedByTeacher } = body;

        if (!assessmentId || !schoolId || !studentFirstName || !studentLastName || !selectedLanguage || !gender || !classGrade || !section) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        if (!['Male', 'Female'].includes(gender)) {
            return NextResponse.json({ error: 'Invalid gender' }, { status: 400 });
        }

        if (classGrade < 4 || classGrade > 10) {
            return NextResponse.json({ error: 'Class grade must be between 4 and 10' }, { status: 400 });
        }

        const forwardedFor = request.headers.get('x-forwarded-for');
        const ipAddress = forwardedFor ? forwardedFor.split(',')[0].trim() : null;

        // --- AUTO-GRADING LOGIC ---
        let marksObtained = 0;
        const totalMarks = 0; // Does the assessment define total marks?

        // Fetch full assessment schema to get correct answers and marks
        const assessmentSchema = await getFullAssessment(assessmentId);
        let calculatedTotalMarks = assessmentSchema?.total_marks ? parseFloat(String(assessmentSchema.total_marks)) : 0;

        if (assessmentSchema) {
            // Build question map for easy lookup
            const questionMap = new Map<number, any>();
            assessmentSchema.sections.forEach((s: any) =>
                s.questions.forEach((q: any) => questionMap.set(q.question_id, q))
            );

            // Iterate through answers and calculate marks
            for (const [qIdStr, answerData] of Object.entries(answers)) {
                const questionId = parseInt(qIdStr, 10);
                const question = questionMap.get(questionId);

                if (question) {
                    let questionMarks = 0;

                    // Logic for Objective Questions
                    if (['mcq', 'true_false'].includes(question.question_type)) {
                        // Single correct option logic
                        if (answerData.selectedOptions && answerData.selectedOptions.length > 0) {
                            const selectedOptionId = answerData.selectedOptions[0];
                            const correctOption = question.options.find((o: any) => o.is_correct);

                            // Check if selected matches correct
                            if (correctOption && correctOption.option_id === selectedOptionId) {
                                // Prefer option marks if set, otherwise question marks
                                const optMarks = correctOption.marks ? parseFloat(String(correctOption.marks)) : 0;
                                const qMarks = question.marks ? parseFloat(String(question.marks)) : 0;
                                questionMarks = optMarks || qMarks || 0;
                            }
                        }
                    }
                    else if (question.question_type === 'multiple_select') {
                        // Sum of marks for selected correct options
                        // (Assuming simple accumulation logic as requested: "max marks is the sum for all like that")
                        if (answerData.selectedOptions && answerData.selectedOptions.length > 0) {
                            answerData.selectedOptions.forEach((optId: number) => {
                                const option = question.options.find((o: any) => o.option_id === optId);
                                if (option && option.is_correct) {
                                    questionMarks += parseFloat(String(option.marks || 0));
                                }
                            });
                        }
                    }

                    // For subjective questions, marksAwarded is null unless provided by teacher (offline grading)
                    // If marksAwarded implies offline graded, use it
                    if (answerData.marksAwarded !== undefined && answerData.marksAwarded !== null) {
                        questionMarks = parseFloat(String(answerData.marksAwarded));
                    }

                    // Update marks obtained
                    marksObtained += questionMarks;

                    // Update answerData to persist the calculated marks
                    // (This modifies the object in place before saving)
                    answers[questionId].marksAwarded = questionMarks;
                }
            }
        }
        // --------------------------

        // Create submission record (or Upsert)
        const submissionResult = await createSubmission(
            assessmentId,
            schoolId,
            studentFirstName,
            studentLastName,
            gender,
            classGrade,
            section,
            selectedLanguage,
            geolocation,
            ipAddress,
            submittedByTeacher || null,
            marksObtained,
            calculatedTotalMarks,
            clientSubmissionId || null // Pass the client ID for Upsert
        );

        const submissionId = submissionResult.submission_id;

        // Save each answer and collect IDs
        const answerIds: Record<number, number> = {};
        for (const [questionIdStr, answerData] of Object.entries(answers)) {
            const questionId = parseInt(questionIdStr, 10);

            const answerId = await saveAnswer(
                submissionId,
                questionId,
                answerData.text ?? null,           // answer_text
                answerData.imageUrl ?? null,        // answer_image_url
                answerData.selectedOptions ?? null, // selected_options (array)
                answerData.rankingOrder ?? null,     // ranking_order (array)
                answerData.marksAwarded ?? null      // marks_awarded (now calculated)
            );

            if (answerId) {
                answerIds[questionId] = answerId;
            }
        }

        return NextResponse.json({
            success: true,
            submissionId,
            answerIds
        });

    } catch (error) {
        await logError({
            error,
            endpoint: '/api/submit POST',
            requestData: { assessmentId: 'present', schoolId: 'present' }
        });
        return NextResponse.json(
            { error: 'Failed to submit assessment' },
            { status: 500 }
        );
    }
}
