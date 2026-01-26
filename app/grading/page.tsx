/**
 * Grading Page
 * 
 * Teacher portal for grading subjective questions.
 * Works offline with cached submissions.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTeacherSession, verifyStoredPassword, type TeacherSession } from '@/lib/auth';
import {
    cacheSyncedSubmissions,
    getCachedSubmissionsForTeacher,
    getCachedAssessmentsForTeacher,
    saveOfflineGrade,
    getPendingOfflineGrades,
    markGradesAsSynced,
    type SyncedSubmission,
    type SyncedAnswer
} from '@/lib/db';

interface Assessment {
    assessmentId: number;
    title: string;
}

export default function GradingPage() {
    const router = useRouter();
    const [session, setSession] = useState<TeacherSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [passwordVerified, setPasswordVerified] = useState(false);
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [verifying, setVerifying] = useState(false);

    const [syncedSubmissions, setSyncedSubmissions] = useState<SyncedSubmission[]>([]);
    const [unsyncedSubmissions, setUnsyncedSubmissions] = useState<SyncedSubmission[]>([]);
    const [assessments, setAssessments] = useState<Assessment[]>([]);
    const [selectedAssessment, setSelectedAssessment] = useState<number | 'all'>('all');
    const [grades, setGrades] = useState<Record<number, Record<number, number>>>({});
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [online, setOnline] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [pendingGradesCount, setPendingGradesCount] = useState(0);

    // Check session
    useEffect(() => {
        async function checkSession() {
            const sess = await getTeacherSession();
            if (!sess) {
                router.push('/login');
                return;
            }
            setSession(sess);
            setLoading(false);
        }
        checkSession();

        // Online/offline detection
        setOnline(navigator.onLine);
        const handleOnline = () => setOnline(true);
        const handleOffline = () => setOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [router]);

    // Load submissions (online: from API + cache; offline: from cache only)
    const loadSubmissions = useCallback(async () => {
        if (!session) return;

        let syncedData: SyncedSubmission[] = [];
        let offlineData: SyncedSubmission[] = [];

        // 1. Load Synced/Cached Submissions
        if (online) {
            try {
                const assessmentParam = selectedAssessment !== 'all' ? `&assessmentId=${selectedAssessment}` : '';
                const response = await fetch(`/api/grading?teacherId=${session.userId}${assessmentParam}`);

                if (response.ok) {
                    const data = await response.json();
                    const fetchedSubs: SyncedSubmission[] = data.submissions.map((sub: any) => ({
                        submissionId: sub.submission_id,
                        studentFirstName: sub.student_first_name,
                        studentLastName: sub.student_last_name,
                        classGrade: sub.class_grade,
                        section: sub.section,
                        submittedAt: new Date(sub.submitted_at),
                        status: sub.status,
                        marksObtained: sub.marks_obtained,
                        assessmentId: sub.assessment_id,
                        assessmentTitle: sub.assessment_title,
                        submittedByTeacher: session.userId,
                        subjectiveAnswers: sub.subjectiveAnswers.map((ans: any) => ({
                            answerId: ans.answer_id,
                            questionId: ans.question_id,
                            answerText: ans.answer_text,
                            answerImageUrl: ans.answer_image_url,
                            marksAwarded: ans.marks_awarded,
                            questionText: ans.question_text,
                            questionType: ans.question_type,
                            maxMarks: ans.max_marks
                        })),
                        cachedAt: new Date()
                    }));

                    await cacheSyncedSubmissions(fetchedSubs);
                    syncedData = fetchedSubs;

                    setAssessments(data.assessments.map((a: any) => ({
                        assessmentId: a.assessment_id,
                        title: a.title
                    })));
                } else {
                    throw new Error('Fetch failed');
                }
            } catch (err) {
                console.error('Online load failed, falling back to cache', err);
                const assessmentId = selectedAssessment !== 'all' ? selectedAssessment : undefined;
                syncedData = await getCachedSubmissionsForTeacher(session.userId, assessmentId);
            }
        } else {
            const assessmentId = selectedAssessment !== 'all' ? selectedAssessment : undefined;
            syncedData = await getCachedSubmissionsForTeacher(session.userId, assessmentId);

            const cachedAssessments = await getCachedAssessmentsForTeacher(session.userId);
            setAssessments(cachedAssessments);
        }

        // 2. Load Offline/Unsynced Submissions
        try {
            const { getOfflineGradingSubmissions } = await import('@/lib/db');
            offlineData = await getOfflineGradingSubmissions(session.userId);

            if (selectedAssessment !== 'all') {
                offlineData = offlineData.filter(s => s.assessmentId === selectedAssessment);
            }
        } catch (e) { console.error('Error loading offline subs', e); }

        setSyncedSubmissions(syncedData);
        setUnsyncedSubmissions(offlineData);

        // 3. Initialize grades
        const initialGrades: Record<number, Record<number, number>> = {};

        // Populate updates from offlineGrades table (local overrides)
        let localGradesMap: Record<number, Record<number, number>> = {};
        try {
            const { db } = await import('@/lib/db');
            // We need to fetch all offline grades. 
            // Since we can't easily filter by "submissions in this list" without many queries, 
            // we'll fetch unsynced grades and filter in memory or iterate.
            const pendingGrades = await db.offlineGrades.where('synced').equals(0).toArray();

            for (const pg of pendingGrades) {
                if (!localGradesMap[pg.submissionId]) localGradesMap[pg.submissionId] = {};
                localGradesMap[pg.submissionId][pg.answerId] = pg.marks;
            }
        } catch (e) {
            console.error('Failed to load local grades', e);
        }

        for (const sub of [...syncedData, ...offlineData]) {
            initialGrades[sub.submissionId] = {};
            for (const ans of sub.subjectiveAnswers) {
                // specific offline grade > cached server grade > 0
                const localMark = localGradesMap[sub.submissionId]?.[ans.answerId];
                initialGrades[sub.submissionId][ans.answerId] = localMark ?? ans.marksAwarded ?? 0;
            }
        }
        setGrades(initialGrades);

        // Check pending
        try {
            const pendingGrades = await getPendingOfflineGrades();
            setPendingGradesCount(pendingGrades.length);
        } catch (e) { console.error(e); }
    }, [session, selectedAssessment, online]);

    useEffect(() => {
        if (passwordVerified && session) {
            loadSubmissions();
        }
    }, [passwordVerified, session, loadSubmissions]);

    // Sync pending grades when online
    const syncPendingGrades = useCallback(async () => {
        if (!online || !session) return;

        setSyncing(true);
        try {
            const pendingGrades = await getPendingOfflineGrades();
            if (pendingGrades.length === 0) {
                setSyncing(false);
                return;
            }

            // Group grades by submission
            const gradesBySubmission: Record<number, Record<number, number>> = {};
            for (const grade of pendingGrades) {
                if (!gradesBySubmission[grade.submissionId]) {
                    gradesBySubmission[grade.submissionId] = {};
                }
                gradesBySubmission[grade.submissionId][grade.answerId] = grade.marks;
            }

            const response = await fetch('/api/grading', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grades: gradesBySubmission,
                    graderId: session.userId
                })
            });

            if (response.ok) {
                await markGradesAsSynced(pendingGrades.map(g => g.id!));
                setPendingGradesCount(0);
                setSaveMessage('Grades synced successfully!');
                await loadSubmissions();
            }
        } catch (err) {
            console.error('Failed to sync grades:', err);
        } finally {
            setSyncing(false);
        }
    }, [online, session, loadSubmissions]);

    // Auto-sync when coming online
    useEffect(() => {
        if (online && passwordVerified && pendingGradesCount > 0) {
            syncPendingGrades();
        }
    }, [online, passwordVerified, pendingGradesCount, syncPendingGrades]);

    const handlePasswordVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError(null);
        setVerifying(true);

        try {
            const valid = await verifyStoredPassword(password);
            if (valid) {
                setPasswordVerified(true);
            } else {
                setPasswordError('Incorrect password');
            }
        } catch {
            setPasswordError('Verification failed');
        } finally {
            setVerifying(false);
        }
    };

    const handleGradeChange = async (submissionId: number, answerId: number, value: number, maxMarks: number) => {
        const clampedValue = Math.max(0, Math.min(value, maxMarks));
        setGrades(prev => ({
            ...prev,
            [submissionId]: {
                ...prev[submissionId],
                [answerId]: clampedValue
            }
        }));

        // Save to IndexedDB immediately
        await saveOfflineGrade(submissionId, answerId, clampedValue);

        // Update pending count
        const pendingGrades = await getPendingOfflineGrades();
        setPendingGradesCount(pendingGrades.length);
    };

    const handleSaveGrades = async () => {
        if (!session) return;
        setSaving(true);
        setSaveMessage(null);

        try {
            if (online) {
                // Sync all pending grades
                await syncPendingGrades();
                setSaveMessage('Grades saved and synced!');
            } else {
                setSaveMessage('Grades saved locally. Will sync when online.');
            }
        } catch {
            setSaveMessage('Failed to save grades');
        } finally {
            setSaving(false);
            setTimeout(() => setSaveMessage(null), 3000);
        }
    };

    // Mark all submissions as graded (auto-grade objective questions)
    const handleMarkAsGraded = async () => {
        if (!session || !online) return;
        setSaving(true);
        setSaveMessage(null);

        try {
            const submissionIds = syncedSubmissions.map(s => s.submissionId);
            const response = await fetch('/api/grading', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submissionIds,
                    graderId: session.userId
                })
            });

            if (response.ok) {
                const data = await response.json();
                setSaveMessage(`${data.graded} submissions marked as graded!`);
                await loadSubmissions();
            } else {
                throw new Error('Failed to mark as graded');
            }
        } catch {
            setSaveMessage('Failed to mark as graded');
        } finally {
            setSaving(false);
            setTimeout(() => setSaveMessage(null), 3000);
        }
    };


    if (loading) {
        return (
            <div className="grading-loading">
                <div className="loading-dots"><span></span><span></span><span></span></div>
            </div>
        );
    }

    // Password verification modal
    if (!passwordVerified) {
        return (
            <div className="grading-verify-container">
                <div className="verify-card">
                    <h2>🔐 Grading Access</h2>
                    <p>Please re-enter your password to access grading</p>
                    <p className="verify-user">Logged in as: <strong>{session?.fullName}</strong></p>

                    <form onSubmit={handlePasswordVerify}>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            autoFocus
                        />
                        {passwordError && <div className="verify-error">{passwordError}</div>}
                        <button type="submit" disabled={verifying}>
                            {verifying ? 'Verifying...' : 'Verify & Continue'}
                        </button>
                    </form>

                    <Link href="/" className="verify-back">← Back to Dashboard</Link>
                </div>

                <style jsx>{`
                    .grading-verify-container {
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 20px;
                        background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
                    }
                    .verify-card {
                        background: white;
                        padding: 40px;
                        border-radius: 16px;
                        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                        text-align: center;
                        max-width: 400px;
                        width: 100%;
                    }
                    .verify-card h2 { margin: 0 0 8px; }
                    .verify-card p { color: #666; margin: 0 0 8px; }
                    .verify-user { margin-bottom: 24px !important; }
                    .verify-card input {
                        width: 100%;
                        padding: 12px 16px;
                        border: 1px solid #ddd;
                        border-radius: 8px;
                        font-size: 16px;
                        margin-bottom: 12px;
                    }
                    .verify-error {
                        color: #c00;
                        margin-bottom: 12px;
                        font-size: 14px;
                    }
                    .verify-card button {
                        width: 100%;
                        padding: 12px;
                        background: #667eea;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-size: 16px;
                        cursor: pointer;
                    }
                    .verify-card button:disabled {
                        opacity: 0.6;
                    }
                    .verify-back {
                        display: inline-block;
                        margin-top: 16px;
                        color: #667eea;
                        text-decoration: none;
                    }
                `}</style>
            </div>
        );
    }



    return (
        <div className="grading-container">
            <header className="grading-header">
                <div>
                    <h1>📝 Grading Dashboard</h1>
                    <p>Grade subjective questions for your submissions</p>
                </div>
                <div className="header-actions">
                    <span className={`status-badge ${online ? 'online' : 'offline'}`}>
                        {online ? '● Online' : '○ Offline'}
                    </span>
                    {pendingGradesCount > 0 && (
                        <span className="pending-badge">
                            {pendingGradesCount} pending
                        </span>
                    )}
                    <Link href="/" className="back-btn">← Dashboard</Link>
                </div>
            </header>

            {/* Filter */}
            <div className="grading-filters">
                <label>Assessment:</label>
                <select
                    value={selectedAssessment}
                    onChange={(e) => setSelectedAssessment(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                >
                    <option value="all">All Assessments</option>
                    {assessments.map(a => (
                        <option key={a.assessmentId} value={a.assessmentId}>{a.title}</option>
                    ))}
                </select>
                {online && (
                    <button onClick={loadSubmissions} className="refresh-btn" disabled={syncing}>
                        {syncing ? '⟳' : '↻'} Refresh
                    </button>
                )}
            </div>

            {/* Grading Tables Grouped by Assessment */}
            {/* Grading Tables Grouped by Assessment */}
            {syncedSubmissions.length === 0 && unsyncedSubmissions.length === 0 ? (
                <div className="no-submissions">
                    <p>{online ? 'No submissions found.' : 'No cached submissions. Go online to sync.'}</p>
                </div>
            ) : (
                <div className="grading-groups">
                    {/* Unsynced Section */}
                    {unsyncedSubmissions.length > 0 && (
                        <div className="unsynced-section">
                            <div className="section-banner warning">
                                <h3>⚠️ Unsynced Offline Submissions</h3>
                                <p>These submissions are stored locally and need to be synced when online.</p>
                            </div>
                            <GradingTable
                                submissions={unsyncedSubmissions}
                                grades={grades}
                                onGradeChange={handleGradeChange}
                            />
                        </div>
                    )}

                    {/* Synced Section */}
                    {syncedSubmissions.length > 0 && (
                        <div className="synced-section">
                            {unsyncedSubmissions.length > 0 && <h3>✅ Synced Submissions</h3>}
                            <GradingTable
                                submissions={syncedSubmissions}
                                grades={grades}
                                onGradeChange={handleGradeChange}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Save Button */}
            {(syncedSubmissions.length > 0 || unsyncedSubmissions.length > 0) && (
                <div className="grading-actions">
                    <button
                        onClick={handleSaveGrades}
                        disabled={saving || syncing}
                        className="save-btn"
                    >
                        {saving || syncing ? 'Saving...' : online ? '💾 Save & Sync' : '💾 Save Locally'}
                    </button>
                    {online && syncedSubmissions.length > 0 && (
                        <button
                            onClick={handleMarkAsGraded}
                            disabled={saving || syncing}
                            className="mark-graded-btn"
                        >
                            ✓ Mark Synced as Graded
                        </button>
                    )}
                    {saveMessage && (
                        <span className={`save-message ${saveMessage.includes('success') || saveMessage.includes('synced') || saveMessage.includes('graded') ? 'success' : ''}`}>
                            {saveMessage}
                        </span>
                    )}
                </div>
            )}

            <style jsx>{`
                .grading-container {
                    max-width: 1400px;
                    margin: 0 auto;
                    padding: 24px;
                }
                .grading-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 24px;
                    flex-wrap: wrap;
                    gap: 16px;
                }
                .grading-header h1 { margin: 0; }
                .grading-header p { color: #666; margin: 4px 0 0; }
                .header-actions {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .status-badge {
                    padding: 4px 12px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 500;
                }
                .status-badge.online { background: #d4edda; color: #155724; }
                .status-badge.offline { background: #fff3cd; color: #856404; }
                .pending-badge {
                    padding: 4px 12px;
                    background: #f8d7da;
                    color: #721c24;
                    border-radius: 12px;
                    font-size: 12px;
                }
                .back-btn {
                    padding: 8px 16px;
                    background: #f0f0f0;
                    border-radius: 8px;
                    text-decoration: none;
                    color: #333;
                }
                .grading-filters {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 24px;
                    flex-wrap: wrap;
                }
                .grading-filters select {
                    padding: 8px 12px;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    font-size: 14px;
                }
                .refresh-btn {
                    padding: 8px 16px;
                    background: #667eea;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                }
                .refresh-btn:disabled { opacity: 0.6; }
                .grading-loading {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .loading-dots {
                    display: flex;
                    gap: 8px;
                }
                .loading-dots span {
                    width: 10px;
                    height: 10px;
                    background: #667eea;
                    border-radius: 50%;
                    animation: bounce 1.4s infinite ease-in-out both;
                }
                .loading-dots span:nth-child(1) { animation-delay: -0.32s; }
                .loading-dots span:nth-child(2) { animation-delay: -0.16s; }
                @keyframes bounce {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1); }
                }
                .unsynced-section { margin-bottom: 40px; }
                .section-banner {
                    padding: 12px 16px;
                    border-radius: 8px;
                    margin-bottom: 16px;
                    border: 1px solid transparent;
                }
                .section-banner.warning {
                    background: #fff3cd;
                    border-color: #ffeeba;
                    color: #856404;
                }
                .section-banner h3 { margin: 0 0 4px; font-size: 16px; }
                .section-banner p { margin: 0; font-size: 14px; }
                
                .grading-actions {
                    margin-top: 24px;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    padding: 16px;
                    background: white;
                    border-top: 1px solid #eee;
                    position: sticky;
                    bottom: 0;
                    z-index: 10;
                }
                .save-btn {
                    padding: 12px 24px;
                    background: #667eea;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
                .mark-graded-btn {
                    padding: 12px 24px;
                    background: #28a745;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    cursor: pointer;
                }
                .mark-graded-btn:hover { background: #218838; }
                .mark-graded-btn:disabled { opacity: 0.6; cursor: not-allowed; }
                .save-message { font-size: 14px; font-weight: 500; }
                .save-message.success { color: #155724; }
                .synced-section { margin-bottom: 40px; }
                .no-submissions {
                    text-align: center;
                    padding: 60px 20px;
                    color: #666;
                    background: white;
                    border-radius: 12px;
                    border: 1px solid #eee;
                }
            `}</style>
        </div>
    );
}

// Extracted Grading Table Component
function GradingTable({ submissions, grades, onGradeChange }: {
    submissions: SyncedSubmission[];
    grades: Record<number, Record<number, number>>;
    onGradeChange: (subId: number, ansId: number, val: number, max: number) => void;
}) {
    if (submissions.length === 0) return null;

    return (
        <div className="grading-groups">
            {Object.entries(
                submissions.reduce((groups, sub) => {
                    if (!groups[sub.assessmentTitle]) groups[sub.assessmentTitle] = [];
                    groups[sub.assessmentTitle].push(sub);
                    return groups;
                }, {} as Record<string, typeof submissions>)
            ).map(([title, groupSubmissions]) => {
                const groupQuestions: { questionId: number; questionText: string; maxMarks: number }[] = [];
                for (const sub of groupSubmissions) {
                    for (const ans of sub.subjectiveAnswers) {
                        if (!groupQuestions.find(q => q.questionId === ans.questionId)) {
                            groupQuestions.push({
                                questionId: ans.questionId,
                                questionText: ans.questionText,
                                maxMarks: ans.maxMarks
                            });
                        }
                    }
                }

                return (
                    <div key={title} className="assessment-group">
                        <h3 className="group-title">{title}</h3>
                        <div className="grading-table-wrapper">
                            <table className="grading-table">
                                <thead>
                                    <tr>
                                        <th className="sticky-col">Student</th>
                                        <th>Status</th>
                                        {groupQuestions.map(q => (
                                            <th key={q.questionId} title={q.questionText}>
                                                {q.questionText.substring(0, 30)}...
                                                <br />
                                                <small>(max: {q.maxMarks})</small>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {groupSubmissions.map(sub => (
                                        <tr key={sub.submissionId}>
                                            <td className="sticky-col">
                                                {sub.studentFirstName} {sub.studentLastName}
                                                <br />
                                                <small>{sub.classGrade}{sub.section}</small>
                                            </td>
                                            <td>
                                                <span className={`status-badge ${sub.status}`}>
                                                    {sub.status === 'graded' ? '✓ Graded' : '⏳ Pending'}
                                                </span>
                                            </td>
                                            {groupQuestions.map(q => {
                                                const ans = sub.subjectiveAnswers.find(a => a.questionId === q.questionId);
                                                if (!ans) return <td key={q.questionId}>-</td>;
                                                return (
                                                    <td key={q.questionId} className="grade-cell">
                                                        <div className="answer-preview" title={ans.answerText || ''}>
                                                            {ans.answerImageUrl ? (
                                                                <ImageLink url={ans.answerImageUrl} />
                                                            ) : (
                                                                <span className="ans-text">
                                                                    {ans.answerText ? (ans.answerText.length > 50 ? ans.answerText.substring(0, 50) + '...' : ans.answerText) : <em style={{ color: '#999' }}>No answer</em>}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={q.maxMarks}
                                                            value={grades[sub.submissionId]?.[ans.answerId] ?? 0}
                                                            onChange={(e) => onGradeChange(
                                                                sub.submissionId,
                                                                ans.answerId,
                                                                parseFloat(e.target.value) || 0,
                                                                q.maxMarks
                                                            )}
                                                            className="grade-input"
                                                        />
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}

            <style jsx>{`
                .grading-groups {
                    display: flex;
                    flex-direction: column;
                    gap: 40px;
                }
                .assessment-group {
                    background: white;
                    border-radius: 12px;
                    border: 1px solid #eee;
                    padding: 20px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                }
                .group-title {
                    margin: 0 0 16px;
                    font-size: 18px;
                    color: #333;
                    border-bottom: 2px solid #667eea;
                    display: inline-block;
                    padding-bottom: 4px;
                }
                .grading-table-wrapper {
                    overflow-x: auto;
                    border: 1px solid #ddd;
                    border-radius: 12px;
                }
                .grading-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 14px;
                }
                .grading-table th, .grading-table td {
                    padding: 12px;
                    border-bottom: 1px solid #eee;
                    text-align: left;
                }
                .grading-table th {
                    background: #f8f9fa;
                    font-weight: 600;
                    white-space: nowrap;
                }
                .sticky-col {
                    position: sticky;
                    left: 0;
                    background: white;
                    z-index: 1;
                }
                .grading-table th.sticky-col {
                    background: #f8f9fa;
                }
                .status-badge {
                    padding: 4px 12px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 500;
                }
                .status-badge.graded { background: #d4edda; color: #155724; }
                .status-badge.pending { background: #fff3cd; color: #856404; }
                .grade-cell {
                    min-width: 150px;
                }
                .grade-input {
                    width: 60px;
                    padding: 6px 8px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    text-align: center;
                }
                .answer-preview {
                    margin-bottom: 8px;
                    font-size: 13px;
                    background: #f8f9fa;
                    padding: 6px;
                    border-radius: 4px;
                    border: 1px solid #eee;
                    max-height: 80px;
                    overflow-y: auto;
                    word-wrap: break-word;
                }
                .ans-text { color: #333; }
                .view-img-link {
                    display: inline-block;
                    font-size: 12px;
                    color: #007bff;
                    text-decoration: underline;
                }
            `}</style>
        </div>
    );
}

function ImageLink({ url }: { url: string }) {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!navigator.onLine) {
            import('@/lib/db').then(({ getCachedImageBlob }) => {
                getCachedImageBlob(url).then(blob => {
                    if (blob) setBlobUrl(URL.createObjectURL(blob));
                });
            });
        }
    }, [url]);

    const finalUrl = blobUrl || url;

    return (
        <a href={finalUrl} target="_blank" rel="noopener noreferrer" className="view-img-link">
            📷 Image {blobUrl ? '(Offline)' : ''}
        </a>
    );
}
