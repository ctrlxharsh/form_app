/**
 * Form Renderer Component
 * 
 * Main component for rendering the complete assessment form.
 * Section-based pagination: one page per section, final page is submit confirmation.
 */

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { QuestionInput, type AnswerValue } from './QuestionInput';
import { StudentDetailsForm, type StudentDetails } from './StudentDetailsForm';
import {
    type FormData,
    type FormSection,
    cacheForm,
    getCachedForm,
    createOfflineSubmission,
    queueImageForUpload
} from '@/lib/db';
import { isOnline, checkActualConnectivity } from '@/lib/sync';

interface FormRendererProps {
    formData: FormData;
    onComplete: (submissionId: number | string) => void;
}

type Step = 'student-details' | 'sections' | 'confirm' | 'complete';

export function FormRenderer({ formData, onComplete }: FormRendererProps) {
    const [step, setStep] = useState<Step>('student-details');
    const [studentDetails, setStudentDetails] = useState<StudentDetails | null>(null);
    const [answers, setAnswers] = useState<Record<number, AnswerValue>>({});
    const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCached, setIsCached] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Check if form is already cached on mount
    useEffect(() => {
        getCachedForm(formData.assessment_id).then(cached => {
            setIsCached(!!cached);
        });
    }, [formData.assessment_id]);

    const totalSections = formData.sections.length;
    const currentSection = formData.sections[currentSectionIndex];

    // Handle student details submission
    const handleStudentDetailsSubmit = (details: StudentDetails) => {
        setStudentDetails(details);
        setStep('sections');
        setCurrentSectionIndex(0);
    };

    // Handle answer change
    const handleAnswerChange = useCallback((questionId: number, value: AnswerValue) => {
        setAnswers(prev => ({
            ...prev,
            [questionId]: value
        }));
    }, []);

    // Save form for offline use
    const handleSaveForOffline = async () => {
        await cacheForm(formData);
        setIsCached(true);
    };

    // Navigate sections
    const handleNextSection = () => {
        if (currentSectionIndex < totalSections - 1) {
            setCurrentSectionIndex(prev => prev + 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            setStep('confirm');
        }
    };

    const handlePrevSection = () => {
        if (currentSectionIndex > 0) {
            setCurrentSectionIndex(prev => prev - 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            setStep('student-details');
        }
    };

    const handleBackFromConfirm = () => {
        setStep('sections');
        setCurrentSectionIndex(totalSections - 1);
    };

    // Submit assessment
    const handleSubmit = async () => {
        if (!studentDetails) return;

        setIsSubmitting(true);
        setError(null);

        try {
            // Use robust connectivity check instead of navigator.onLine
            const online = await checkActualConnectivity();

            // Prepare answer data
            const processedAnswers: Record<number, {
                text?: string;
                selectedOptions?: number[];
                rankingOrder?: number[];
                imageUrl?: string;
                localImageId?: number;
            }> = {};

            for (const [questionIdStr, answer] of Object.entries(answers)) {
                const questionId = parseInt(questionIdStr, 10);
                const processed: typeof processedAnswers[number] = {};

                if (answer.text !== undefined) {
                    processed.text = answer.text;
                }
                if (answer.selectedOptions?.length) {
                    processed.selectedOptions = answer.selectedOptions;
                }
                if (answer.rankingOrder?.length) {
                    processed.rankingOrder = answer.rankingOrder;
                }

                processedAnswers[questionId] = processed;
            }

            if (online) {
                // ONLINE: Submit directly to server
                for (const [questionIdStr, answer] of Object.entries(answers)) {
                    if (answer.file) {
                        const questionId = parseInt(questionIdStr, 10);
                        const formDataUpload = new FormData();
                        formDataUpload.append('file', answer.file);

                        const uploadResponse = await fetch('/api/upload', {
                            method: 'POST',
                            body: formDataUpload
                        });

                        if (uploadResponse.ok) {
                            const result = await uploadResponse.json();
                            processedAnswers[questionId] = {
                                ...processedAnswers[questionId],
                                imageUrl: result.url
                            };
                        } else {
                            throw new Error('Failed to upload image');
                        }
                    }
                }

                // Get teacher session to send with submission
                const { getTeacherSession } = await import('@/lib/auth');
                const teacherSession = await getTeacherSession();

                const response = await fetch('/api/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        assessmentId: formData.assessment_id,
                        schoolId: studentDetails.schoolId,
                        studentFirstName: studentDetails.studentFirstName,
                        studentLastName: studentDetails.studentLastName,
                        studentName: studentDetails.studentName,
                        gender: studentDetails.gender,
                        classGrade: studentDetails.classGrade,
                        section: studentDetails.section,
                        selectedLanguage: formData.language || 'English',
                        geolocation: studentDetails.geolocation || null,
                        answers: processedAnswers,
                        submittedByTeacher: teacherSession?.userId || null
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Submission failed');
                }

                const result = await response.json();

                // MIRROR TO LOCAL CACHE FOR OFFLINE GRADING if teacher is logged in
                // teacherSession is already fetched above for the submission

                if (teacherSession) {
                    const { db } = await import('@/lib/db');

                    // Collect all subjective answers fromformData
                    const subjectiveAnswers: any[] = [];
                    for (const section of formData.sections) {
                        for (const q of section.questions) {
                            if (['short_answer', 'long_answer', 'image_upload'].includes(q.question_type)) {
                                const answer = answers[q.question_id];
                                if (answer) {
                                    subjectiveAnswers.push({
                                        answerId: result.answerIds[q.question_id] || 0,
                                        questionId: q.question_id,
                                        answerText: answer.text || null,
                                        answerImageUrl: processedAnswers[q.question_id]?.imageUrl || null,
                                        marksAwarded: null,
                                        questionText: q.question_text,
                                        questionType: q.question_type,
                                        maxMarks: q.marks
                                    });
                                }
                            }
                        }
                    }

                    if (subjectiveAnswers.length > 0) {
                        await db.syncedSubmissions.put({
                            submissionId: result.submissionId,
                            studentFirstName: studentDetails.studentFirstName,
                            studentLastName: studentDetails.studentLastName,
                            classGrade: studentDetails.classGrade,
                            section: studentDetails.section,
                            submittedAt: new Date(),
                            status: 'pending',
                            marksObtained: null,
                            assessmentId: formData.assessment_id,
                            assessmentTitle: formData.title,
                            submittedByTeacher: teacherSession.userId,
                            subjectiveAnswers,
                            cachedAt: new Date()
                        });
                    }
                }

                onComplete(result.submissionId);

            } else {
                // OFFLINE: Store locally in IndexedDB
                // Get teacher session for offline submission too
                const { getTeacherSession } = await import('@/lib/auth');
                const teacherSession = await getTeacherSession();

                // Atomic transaction for submission + images
                const { saveSubmissionWithImages } = await import('@/lib/db');

                const imagesToSave = Object.entries(answers)
                    .filter(([_, answer]) => answer.file)
                    .map(([questionIdStr, answer]) => ({
                        questionId: parseInt(questionIdStr, 10),
                        file: answer.file!
                    }));

                const localId = await saveSubmissionWithImages({
                    formId: formData.assessment_id,
                    formVersion: new Date().toISOString(),
                    schoolId: studentDetails.schoolId,
                    studentFirstName: studentDetails.studentFirstName,
                    studentLastName: studentDetails.studentLastName,
                    selectedLanguage: formData.language || 'English',
                    totalMarks: formData.total_marks,
                    geolocation: studentDetails.geolocation || null,
                    gender: studentDetails.gender,
                    classGrade: studentDetails.classGrade,
                    section: studentDetails.section,
                    answers: processedAnswers,
                    status: 'pending',
                    submittedByTeacher: teacherSession?.userId
                }, imagesToSave);

                // Don't trigger sync immediately after offline submission
                // Sync will happen automatically when device comes back online via 'online' event listener
                onComplete(`offline-${localId}`);
            }

        } catch (err) {
            console.error('Submission error:', err);
            setError(err instanceof Error ? err.message : 'Submission failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Count questions answered in a section
    const getProgressForSection = (section: FormSection): { answered: number; total: number } => {
        let answered = 0;
        let total = section.questions.length;

        for (const question of section.questions) {
            const answer = answers[question.question_id];
            if (answer && (
                answer.text ||
                answer.selectedOptions?.length ||
                answer.rankingOrder?.length ||
                answer.file
            )) {
                answered++;
            }
        }

        return { answered, total };
    };

    // Render Step 1: Student Details
    if (step === 'student-details') {
        return (
            <div className="form-wrapper">
                <FormHeader
                    formData={formData}
                    isCached={isCached}
                    onSaveForOffline={handleSaveForOffline}
                />
                <StudentDetailsForm
                    initialClassGrade={formData.class_grade}
                    onSubmit={handleStudentDetailsSubmit}
                />
            </div>
        );
    }

    // Render Section Pages
    if (step === 'sections' && studentDetails && currentSection) {
        let questionNumber = 0;
        for (let i = 0; i < currentSectionIndex; i++) {
            questionNumber += formData.sections[i].questions.length;
        }

        const progress = getProgressForSection(currentSection);

        return (
            <div className="form-wrapper">
                {/* Progress Bar */}
                <div className="form-progress">
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ width: `${((currentSectionIndex + 1) / totalSections) * 100}%` }}
                        />
                    </div>
                    <span className="progress-text">
                        Section {currentSectionIndex + 1} of {totalSections}
                    </span>
                </div>

                {/* Section Header */}
                <div className="section-header">
                    <h2 className="section-title">{currentSection.section_title}</h2>
                    <span className="section-progress">
                        {progress.answered}/{progress.total} answered
                    </span>
                </div>

                {currentSection.section_instructions && (
                    <div className="section-instructions">
                        <p>{currentSection.section_instructions}</p>
                    </div>
                )}

                {/* Questions */}
                <div className="questions-container">
                    {currentSection.questions.map((question) => {
                        questionNumber++;
                        return (
                            <div key={question.question_id} className="question-wrapper">
                                <QuestionInput
                                    question={question}
                                    questionNumber={questionNumber}
                                    value={answers[question.question_id] || {}}
                                    onChange={(value) => handleAnswerChange(question.question_id, value)}
                                />
                            </div>
                        );
                    })}
                </div>

                {/* Navigation */}
                <div className="section-navigation">
                    <button onClick={handlePrevSection} className="nav-button secondary">
                        ← Previous
                    </button>
                    <button onClick={handleNextSection} className="nav-button primary">
                        {currentSectionIndex < totalSections - 1 ? 'Next →' : 'Review & Submit →'}
                    </button>
                </div>
            </div>
        );
    }

    // Render Confirmation Page
    if (step === 'confirm' && studentDetails) {
        const totalQuestions = formData.sections.reduce((sum, s) => sum + s.questions.length, 0);
        const totalAnswered = formData.sections.reduce((sum, s) => sum + getProgressForSection(s).answered, 0);

        return (
            <div className="form-wrapper">
                <div className="confirm-container">
                    <div className="confirm-icon">📋</div>
                    <h2 className="confirm-title">Ready to Submit?</h2>

                    <div className="confirm-summary">
                        <div className="summary-row">
                            <span>Assessment:</span>
                            <strong>{formData.title}</strong>
                        </div>
                        <div className="summary-row">
                            <span>Student:</span>
                            <strong>{studentDetails.studentName}</strong>
                        </div>
                        <div className="summary-row">
                            <span>School:</span>
                            <strong>{studentDetails.schoolName}</strong>
                        </div>
                        <div className="summary-row">
                            <span>Class:</span>
                            <strong>{studentDetails.classGrade}{studentDetails.section}</strong>
                        </div>
                        <div className="summary-row">
                            <span>Questions Answered:</span>
                            <strong>{totalAnswered} / {totalQuestions}</strong>
                        </div>
                    </div>

                    {error && (
                        <div className="error-message">{error}</div>
                    )}

                    <p className="confirm-warning">
                        Are you sure you want to submit? You cannot change your answers after submission.
                    </p>

                    <div className="confirm-actions">
                        <button
                            onClick={handleBackFromConfirm}
                            className="nav-button secondary"
                            disabled={isSubmitting}
                        >
                            ← No, Go Back
                        </button>
                        <button
                            onClick={handleSubmit}
                            className="nav-button primary submit-final"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <>
                                    <span className="button-spinner" />
                                    Submitting...
                                </>
                            ) : (
                                '✓ Yes, Submit'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

// Form Header Component
function FormHeader({
    formData,
    isCached,
    onSaveForOffline
}: {
    formData: FormData;
    isCached: boolean;
    onSaveForOffline: () => void;
}) {
    const [justSaved, setJustSaved] = useState(false);

    const handleSave = () => {
        onSaveForOffline();
        setJustSaved(true);
    };

    return (
        <div className="form-header-bar">
            <div className="form-header-content">
                <Link href="/" className="back-to-home">
                    ← Back to Dashboard
                </Link>
                <h1 className="form-title">{formData.title}</h1>
                {formData.description && (
                    <p className="form-description">{formData.description}</p>
                )}
            </div>
            <div className="form-header-actions">
                {justSaved ? (
                    <span className="cached-badge">✓ Saved Offline</span>
                ) : (
                    <button onClick={handleSave} className="save-offline-btn">
                        💾 {isCached ? 'Update Offline' : 'Save Offline'}
                    </button>
                )}
            </div>
        </div>
    );
}
