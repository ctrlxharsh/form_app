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

        // Types that require human grading
        const SUBJECTIVE_TYPES = ['short_answer', 'long_answer', 'image_upload'];

        // Fetch full assessment schema to get correct answers and marks
        const assessmentSchema = await getFullAssessment(assessmentId);
        let calculatedTotalMarks = assessmentSchema?.total_marks ? parseFloat(String(assessmentSchema.total_marks)) : 0;
        let hasSubjectiveQuestions = false;
        const subjectiveQuestionIds: number[] = [];

        if (assessmentSchema) {
            // Build question map for easy lookup
            const questionMap = new Map<number, any>();
            assessmentSchema.sections.forEach((s: any) =>
                s.questions.forEach((q: any) => {
                    questionMap.set(q.question_id, q);
                    if (SUBJECTIVE_TYPES.includes(q.question_type)) {
                        hasSubjectiveQuestions = true;
                        subjectiveQuestionIds.push(q.question_id);
                    }
                })
            );

            // Iterate through answers and calculate marks
            for (const [qIdStr, answerData] of Object.entries(answers)) {
                const questionId = parseInt(qIdStr, 10);
                const question = questionMap.get(questionId);

                if (question) {
                    let questionMarks = 0;

                    // MCQ: Single correct option
                    if (question.question_type === 'mcq') {
                        if (answerData.selectedOptions && answerData.selectedOptions.length > 0) {
                            const selectedOptionId = answerData.selectedOptions[0];
                            const correctOption = question.options.find((o: any) => o.is_correct);
                            if (correctOption && correctOption.option_id === selectedOptionId) {
                                const optMarks = correctOption.marks ? parseFloat(String(correctOption.marks)) : 0;
                                const qMarks = question.marks ? parseFloat(String(question.marks)) : 0;
                                questionMarks = optMarks || qMarks || 0;
                            }
                        }
                    }
                    // Multiple Select: Sum of marks for selected correct options
                    else if (question.question_type === 'multiple_select') {
                        if (answerData.selectedOptions && answerData.selectedOptions.length > 0) {
                            answerData.selectedOptions.forEach((optId: number) => {
                                const option = question.options.find((o: any) => o.option_id === optId);
                                if (option && option.is_correct) {
                                    questionMarks += parseFloat(String(option.marks || 0));
                                }
                            });
                        }
                    }
                    // True/False: Text-based comparison (form sends "True" or "False")
                    else if (question.question_type === 'true_false') {
                        if (answerData.text && question.correct_answer) {
                            if (answerData.text.toLowerCase().trim() === question.correct_answer.toLowerCase().trim()) {
                                questionMarks = question.marks ? parseFloat(String(question.marks)) : 0;
                            }
                        }
                    }
                    // Numerical: Compare parsed numbers
                    else if (question.question_type === 'numerical') {
                        if (answerData.text && question.correct_answer) {
                            const studentAnswer = parseFloat(answerData.text);
                            const correctAnswer = parseFloat(question.correct_answer);
                            if (!isNaN(studentAnswer) && !isNaN(correctAnswer) && studentAnswer === correctAnswer) {
                                questionMarks = question.marks ? parseFloat(String(question.marks)) : 0;
                            }
                        }
                    }

                    // If teacher pre-graded offline (marksAwarded set), use that
                    if (answerData.marksAwarded !== undefined && answerData.marksAwarded !== null) {
                        questionMarks = parseFloat(String(answerData.marksAwarded));
                    }

                    marksObtained += questionMarks;
                    answers[questionId].marksAwarded = questionMarks;
                }
            }
        }

        // Determine submission status:
        // - Objective-only assessments → 'graded' (fully auto-graded)
        // - Subjective questions fully graded (e.g. offline grading) → 'graded'
        // - Subjective questions NOT fully graded → 'pending'

        let allSubjectiveGraded = true;
        if (hasSubjectiveQuestions) {
            for (const qId of subjectiveQuestionIds) {
                const ans = answers[qId];
                // Check if answer exists and has marks
                if (!ans || ans.marksAwarded === undefined || ans.marksAwarded === null) {
                    allSubjectiveGraded = false;
                    break;
                }
            }
        }

        const submissionStatus = (hasSubjectiveQuestions && !allSubjectiveGraded) ? 'pending' : 'graded';
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
            clientSubmissionId || null, // Pass the client ID for Upsert
            submissionStatus // 'graded' for objective-only, 'pending' for subjective
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
