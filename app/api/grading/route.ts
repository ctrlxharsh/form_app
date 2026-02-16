/**
 * API Route: /api/grading
 * 
 * GET: Fetch submissions and subjective answers for grading
 * POST: Save grading marks
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';
import { logError } from '@/lib/error-logger';

/**
 * GET /api/grading?teacherId=X&assessmentId=Y
 * 
 * Fetch submissions by teacher with subjective questions for grading
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const teacherId = searchParams.get('teacherId');
        const assessmentId = searchParams.get('assessmentId');

        if (!teacherId) {
            return NextResponse.json(
                { error: 'teacherId is required' },
                { status: 400 }
            );
        }

        // Get status filter (default to pending only)
        const statusFilter = searchParams.get('status') || 'pending';

        // Get submissions by this teacher
        let submissions;
        if (assessmentId) {
            if (statusFilter === 'all') {
                submissions = await sql`
                    SELECT 
                        s.submission_id,
                        s.student_first_name,
                        s.student_last_name,
                        s.class_grade,
                        s.section,
                        s.submitted_at,
                        s.status,
                        s.marks_obtained,
                        s.total_marks,
                        a.assessment_id,
                        a.title as assessment_title
                    FROM submissions s
                    JOIN assessments a ON s.assessment_id = a.assessment_id
                    WHERE s.submitted_by_teacher = ${parseInt(teacherId)}
                    AND s.assessment_id = ${parseInt(assessmentId)}
                    ORDER BY s.submitted_at DESC
                `;
            } else {
                submissions = await sql`
                    SELECT 
                        s.submission_id,
                        s.student_first_name,
                        s.student_last_name,
                        s.class_grade,
                        s.section,
                        s.submitted_at,
                        s.status,
                        s.marks_obtained,
                        s.total_marks,
                        a.assessment_id,
                        a.title as assessment_title
                    FROM submissions s
                    JOIN assessments a ON s.assessment_id = a.assessment_id
                    WHERE s.submitted_by_teacher = ${parseInt(teacherId)}
                    AND s.assessment_id = ${parseInt(assessmentId)}
                    AND s.status = ${statusFilter}
                    ORDER BY s.submitted_at DESC
                `;
            }
        } else {
            if (statusFilter === 'all') {
                submissions = await sql`
                    SELECT 
                        s.submission_id,
                        s.student_first_name,
                        s.student_last_name,
                        s.class_grade,
                        s.section,
                        s.submitted_at,
                        s.status,
                        s.marks_obtained,
                        s.total_marks,
                        a.assessment_id,
                        a.title as assessment_title
                    FROM submissions s
                    JOIN assessments a ON s.assessment_id = a.assessment_id
                    WHERE s.submitted_by_teacher = ${parseInt(teacherId)}
                    ORDER BY s.submitted_at DESC
                `;
            } else {
                submissions = await sql`
                    SELECT 
                        s.submission_id,
                        s.student_first_name,
                        s.student_last_name,
                        s.class_grade,
                        s.section,
                        s.submitted_at,
                        s.status,
                        s.marks_obtained,
                        s.total_marks,
                        a.assessment_id,
                        a.title as assessment_title
                    FROM submissions s
                    JOIN assessments a ON s.assessment_id = a.assessment_id
                    WHERE s.submitted_by_teacher = ${parseInt(teacherId)}
                    AND s.status = ${statusFilter}
                    ORDER BY s.submitted_at DESC
                `;
            }
        }

        // For each submission, get subjective answers
        const result = [];
        for (const sub of submissions) {
            const answers = await sql`
                SELECT 
                    sa.answer_id,
                    sa.question_id,
                    sa.answer_text,
                    sa.answer_image_url,
                    sa.marks_awarded,
                    q.question_text,
                    q.question_type,
                    q.marks as max_marks
                FROM submission_answers sa
                JOIN questions q ON sa.question_id = q.question_id
                WHERE sa.submission_id = ${sub.submission_id}
                AND q.question_type IN ('short_answer', 'long_answer', 'image_upload')
                ORDER BY q.order_index
            `;

            result.push({
                ...sub,
                subjectiveAnswers: answers
            });
        }

        // Also get available assessments for filter
        const assessments = await sql`
            SELECT DISTINCT a.assessment_id, a.title
            FROM assessments a
            JOIN submissions s ON a.assessment_id = s.assessment_id
            WHERE s.submitted_by_teacher = ${parseInt(teacherId)}
            ORDER BY a.title
        `;

        return NextResponse.json({
            submissions: result,
            assessments
        });

    } catch (error) {
        await logError({
            error,
            endpoint: '/api/grading GET',
            userId: request.nextUrl.searchParams.get('teacherId')
        });
        return NextResponse.json(
            { error: 'Failed to fetch grading data' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/grading
 * 
 * Save grading marks for submissions
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { grades, graderId, completionStatus } = body;

        // grades: { submissionId: { answerId: marks }[] }
        if (!grades || !graderId) {
            return NextResponse.json(
                { error: 'grades and graderId are required' },
                { status: 400 }
            );
        }

        for (const [submissionIdStr, answerGrades] of Object.entries(grades)) {
            const submissionId = parseInt(submissionIdStr);
            let totalSubjectiveMarks = 0;

            // Update each answer's marks
            for (const [answerIdStr, marks] of Object.entries(answerGrades as Record<string, number>)) {
                const answerId = parseInt(answerIdStr);
                await sql`
                    UPDATE submission_answers
                    SET marks_awarded = ${marks}
                    WHERE answer_id = ${answerId}
                `;
                totalSubjectiveMarks += marks;
            }

            // --- AUTO-GRADE OBJECTIVE QUESTIONS (Ensure they have marks) ---

            // 1. Auto-grade MCQ & Multiple Select
            await sql`
                UPDATE submission_answers sa
                SET marks_awarded = (
                    SELECT COALESCE(SUM(qo.marks), 0)
                    FROM question_options qo
                    WHERE qo.option_id = ANY(sa.selected_options)
                )
                FROM questions q
                WHERE sa.question_id = q.question_id
                AND sa.submission_id = ${submissionId}
                AND q.question_type IN ('mcq', 'multiple_select')
                -- Update if NULL or if we want to ensure correctness (remove check to force update)
                AND sa.marks_awarded IS NULL 
            `;

            // 2. Auto-grade True/False & Numerical
            await sql`
                UPDATE submission_answers sa
                SET marks_awarded = CASE
                    WHEN LOWER(TRIM(sa.answer_text)) = LOWER(TRIM(q.correct_answer)) THEN q.marks
                    ELSE 0
                END
                FROM questions q
                WHERE sa.question_id = q.question_id
                AND sa.submission_id = ${submissionId}
                AND q.question_type IN ('true_false', 'numerical')
                AND sa.marks_awarded IS NULL
            `;

            // -------------------------------------------------------------

            // -------------------------------------------------------------

            // Calculate marks obtained (subjective + auto-graded)
            const marksResult = await sql`
                SELECT COALESCE(SUM(sa.marks_awarded), 0) as total
                FROM submission_answers sa
                WHERE sa.submission_id = ${submissionId}
            `;
            const marksObtained = marksResult[0]?.total || 0;

            // Determine status: Use provided status, or default to 'graded' (legacy behavior)
            const newStatus = completionStatus && completionStatus[submissionId]
                ? completionStatus[submissionId]
                : 'graded';

            console.log(`[Sync] Updating submission ${submissionId}: status=${newStatus}, marks=${marksObtained}`);

            // Update submission status and marks (preserve total_marks from creation)
            await sql`
                UPDATE submissions
                SET 
                    status = ${newStatus},
                    marks_obtained = ${marksObtained},
                    graded_by = ${graderId},
                    graded_at = NOW()
                WHERE submission_id = ${submissionId}
            `;
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        await logError({
            error,
            endpoint: '/api/grading POST'
        });
        return NextResponse.json(
            { error: 'Failed to save grades' },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/grading
 * 
 * Auto-grade objective questions and mark submissions as graded
 */
export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const { submissionIds, graderId } = body;

        if (!submissionIds || !Array.isArray(submissionIds) || !graderId) {
            return NextResponse.json(
                { error: 'submissionIds (array) and graderId are required' },
                { status: 400 }
            );
        }

        for (const submissionId of submissionIds) {
            // 1. Auto-grade MCQ & Multiple Select (Option-based marks)
            await sql`
                UPDATE submission_answers sa
                SET marks_awarded = (
                    SELECT COALESCE(SUM(qo.marks), 0)
                    FROM question_options qo
                    WHERE qo.option_id = ANY(sa.selected_options)
                )
                FROM questions q
                WHERE sa.question_id = q.question_id
                AND sa.submission_id = ${submissionId}
                AND q.question_type IN ('mcq', 'multiple_select')
                AND sa.marks_awarded IS NULL
            `;

            // 2. Auto-grade True/False & Numerical (Value-based marks)
            await sql`
                UPDATE submission_answers sa
                SET marks_awarded = CASE
                    WHEN LOWER(TRIM(sa.answer_text)) = LOWER(TRIM(q.correct_answer)) THEN q.marks
                    ELSE 0
                END
                FROM questions q
                WHERE sa.question_id = q.question_id
                AND sa.submission_id = ${submissionId}
                AND q.question_type IN ('true_false', 'numerical')
                AND sa.marks_awarded IS NULL
            `;

            // Calculate marks obtained (sum of awarded marks)
            const marksResult = await sql`
                SELECT COALESCE(SUM(sa.marks_awarded), 0) as total
                FROM submission_answers sa
                WHERE sa.submission_id = ${submissionId}
            `;
            const marksObtained = marksResult[0]?.total || 0;

            console.log(`[OnlineGrading] Marking submission ${submissionId} as graded. Marks: ${marksObtained}`);

            // Mark as graded with calculated marks (preserve total_marks from creation)
            await sql`
                UPDATE submissions
                SET 
                    status = 'graded',
                    marks_obtained = ${marksObtained},
                    graded_by = ${graderId},
                    graded_at = NOW()
                WHERE submission_id = ${submissionId}
            `;
        }

        return NextResponse.json({ success: true, graded: submissionIds.length });

    } catch (error) {
        await logError({
            error,
            endpoint: '/api/grading PATCH'
        });
        return NextResponse.json(
            { error: 'Failed to auto-grade' },
            { status: 500 }
        );
    }
}
