/**
 * API Route: POST /api/submit
 * 
 * Submits assessment answers to PostgreSQL.
 * Mirrors the submit_assessment() function from Streamlit middleware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSubmission, saveAnswers, getFullAssessment, sql } from '@/lib/postgres';
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
    deviceInfo?: any;
    studentId?: number;
}

interface AnswerData {
    text?: string;
    selectedOptions?: number[];
    rankingOrder?: number[];
    imageUrl?: string;
    localImageId?: number;
    marksAwarded?: number;
}

function getQuestionMaxMarks(question: any): number {
    const qType = question.question_type;
    const qMarks = question.marks ? parseFloat(String(question.marks)) : 0;

    if (qType === 'mcq') {
        const correctOption = question.options?.find((o: any) => o.is_correct);
        const correctOptMarks = correctOption?.marks ? parseFloat(String(correctOption.marks)) : 0;
        if (correctOptMarks > 0) return correctOptMarks;
        
        let maxOptMarks = 0;
        if (question.options) {
            for (const opt of question.options) {
                const optMarks = opt.marks ? parseFloat(String(opt.marks)) : 0;
                if (optMarks > maxOptMarks) {
                    maxOptMarks = optMarks;
                }
            }
        }
        return maxOptMarks || qMarks || 0;
    } 
    else if (qType === 'multiple_select') {
        let correctSum = 0;
        if (question.options) {
            for (const opt of question.options) {
                if (opt.is_correct) {
                    correctSum += opt.marks ? parseFloat(String(opt.marks)) : 0;
                }
            }
        }
        return correctSum || qMarks || 0;
    } 
    else if (qType === 'ranking') {
        let maxOptMarks = 0;
        if (question.options) {
            for (const opt of question.options) {
                const optMarks = opt.marks ? parseFloat(String(opt.marks)) : 0;
                if (optMarks > maxOptMarks) {
                    maxOptMarks = optMarks;
                }
            }
        }
        return maxOptMarks || qMarks || 0;
    } 
    else {
        return qMarks;
    }
}

export async function POST(request: NextRequest) {
    try {
        const body: SubmitRequest = await request.json();

        // Validate required fields
        const { assessmentId, clientSubmissionId, schoolId, studentFirstName, studentLastName, selectedLanguage, geolocation, gender, classGrade, section, answers, submittedByTeacher, deviceInfo, studentId } = body;

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

        // Validate submittedByTeacher exists in users table to prevent FK violations
        let validTeacherId: number | null = null;
        if (submittedByTeacher) {
            const teacherExists = await sql`
                SELECT 1 FROM users WHERE user_id = ${parseInt(String(submittedByTeacher), 10)} AND is_active = true
            `;
            if (teacherExists.length > 0) {
                validTeacherId = parseInt(String(submittedByTeacher), 10);
            }
        }

        // Validate studentId exists in students table to prevent FK violations
        let validStudentId: number | null = null;
        if (studentId) {
            const studentExists = await sql`
                SELECT 1 FROM students WHERE student_id = ${parseInt(String(studentId), 10)}
            `;
            if (studentExists.length > 0) {
                validStudentId = parseInt(String(studentId), 10);
            }
        }

        // Check for duplicate submission across all language variants (same group_identifier)
        const existing = await sql`
            SELECT 1 FROM submissions 
            WHERE assessment_id IN (
                SELECT a2.assessment_id FROM assessments a1
                JOIN assessments a2 ON (
                    a2.group_identifier = a1.group_identifier
                    OR (a1.group_identifier IS NULL AND a2.group_identifier IS NULL 
                        AND LOWER(TRIM(a2.title)) = LOWER(TRIM(a1.title)) 
                        AND a2.class_grade = a1.class_grade)
                )
                WHERE a1.assessment_id = ${assessmentId}
            )
            AND (
                (student_id IS NOT NULL AND student_id = ${validStudentId})
                OR 
                (LOWER(TRIM(student_first_name)) = LOWER(TRIM(${studentFirstName})) 
                 AND LOWER(TRIM(student_last_name)) = LOWER(TRIM(${studentLastName})))
            )
            -- Exclude the current submission itself if we are retrying a sync for it
            AND (
                ${clientSubmissionId || null}::uuid IS NULL 
                OR client_submission_id IS DISTINCT FROM ${clientSubmissionId || null}::uuid
            )
            LIMIT 1
        `;
        if (existing.length > 0) {
            return NextResponse.json(
                { error: 'You have already submitted this assessment.' },
                { status: 400 }
            );
        }

        const forwardedFor = request.headers.get('x-forwarded-for');
        const ipAddress = forwardedFor ? forwardedFor.split(',')[0].trim() : null;

        // --- AUTO-GRADING LOGIC ---
        let marksObtained = 0;

        // Types that require human grading
        const SUBJECTIVE_TYPES = ['short_answer', 'long_answer', 'image_upload', 'fill_blank', 'range', 'ranking'];

        // Fetch full assessment schema to get correct answers and marks
        const assessmentSchema = await getFullAssessment(assessmentId);
        let calculatedTotalMarks = 0;
        if (assessmentSchema) {
            // Calculate total possible marks based on question types and option marks
            assessmentSchema.sections.forEach((s: any) =>
                s.questions.forEach((q: any) => {
                    calculatedTotalMarks += getQuestionMaxMarks(q);
                })
            );
            
            // Fallback to the total_marks column if questions sum to 0
            if (calculatedTotalMarks === 0 && assessmentSchema.total_marks) {
                calculatedTotalMarks = parseFloat(String(assessmentSchema.total_marks));
            }
        }
        let hasSubjectiveQuestions = false;
        const subjectiveQuestionIds: number[] = [];
        const questionMap = new Map<number, any>();

        if (assessmentSchema) {
            // Build question map for easy lookup
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
                    // CRITICAL FIX: Initialize marks as null (not 0) for subjective questions
                    // This ensures they are marked as 'pending' grading, not 'graded' with 0 marks
                    let questionMarks: number | null = null;

                    // MCQ: Single correct option
                    if (question.question_type === 'mcq') {
                        questionMarks = 0; // Initialize to 0 for auto-graded types
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
                        questionMarks = 0;
                        if (answerData.selectedOptions && answerData.selectedOptions.length > 0) {
                            answerData.selectedOptions.forEach((optId: number) => {
                                const option = question.options.find((o: any) => o.option_id === optId);
                                if (option && option.is_correct) {
                                    questionMarks = (questionMarks ?? 0) + parseFloat(String(option.marks || 0));
                                }
                            });
                        }
                    }
                    // True/False: Text-based comparison (form sends "True" or "False")
                    else if (question.question_type === 'true_false') {
                        questionMarks = 0;
                        if (answerData.text && question.correct_answer) {
                            if (answerData.text.toLowerCase().trim() === question.correct_answer.toLowerCase().trim()) {
                                questionMarks = question.marks ? parseFloat(String(question.marks)) : 0;
                            }
                        }
                    }
                    // Numerical: Compare parsed numbers
                    else if (question.question_type === 'numerical') {
                        questionMarks = 0;
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

                    if (questionMarks !== null) {
                        marksObtained += questionMarks;
                        answers[questionId].marksAwarded = questionMarks;
                    }
                }
            }
        }

        let allSubjectiveGraded = true;
        let requiresManualGrading = false;

        if (hasSubjectiveQuestions) {
            requiresManualGrading = true;

            // ── Step 1: Ensure every subjective question has an answer entry ─────────
            // This guarantees a row is created in submission_answers so the teacher
            // can grade it in the dashboard. We DO NOT auto-grade it to 0.
            for (const qId of subjectiveQuestionIds) {
                if (!answers[qId]) {
                    answers[qId] = { text: undefined };
                }
            }

            // ── Step 2: Check whether all subjective questions are pre-graded ────────
            for (const qId of subjectiveQuestionIds) {
                const ans = answers[qId];
                // marksAwarded=0 is valid (counts as graded); only undefined/null means ungraded
                const isPreGraded = ans.marksAwarded !== undefined && ans.marksAwarded !== null;
                if (!isPreGraded) {
                    allSubjectiveGraded = false;
                    break;
                }
            }
        }

        const submissionStatus = (requiresManualGrading && !allSubjectiveGraded) ? 'pending' : 'graded';
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
            validTeacherId,
            marksObtained,
            calculatedTotalMarks,
            clientSubmissionId || null, // Pass the client ID for Upsert
            submissionStatus, // 'graded' for objective-only, 'pending' for subjective
            deviceInfo || null, // Pass device info securely
            validStudentId
        );

        const submissionId = submissionResult.submission_id;

        // Save all answers in bulk and collect IDs
        const answersList = Object.entries(answers)
            .map(([questionIdStr, answerData]) => {
                const questionId = parseInt(questionIdStr, 10);
                return {
                    submissionId,
                    questionId,
                    answerText: answerData.text ?? null,
                    answerImageUrl: answerData.imageUrl ?? null,
                    selectedOptions: answerData.selectedOptions ?? null,
                    rankingOrder: answerData.rankingOrder ?? null,
                    marksAwarded: answerData.marksAwarded ?? null
                };
            })
            .filter(answer => {
                // Only save answers for questions that exist in the assessment schema
                return questionMap.has(answer.questionId);
            });

        const insertedAnswers = await saveAnswers(answersList);
        const answerIds: Record<number, number> = {};
        for (const row of insertedAnswers) {
            answerIds[row.question_id] = row.answer_id;
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
