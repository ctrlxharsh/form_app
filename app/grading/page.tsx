/**
 * Grading Page (Redesigned)
 *
 * Sections:
 *  1. Needs Grading     — pending submissions with subjective answers (online + offline)
 *  2. Graded – Pending  — locally graded offline subs waiting to sync
 *  3. Recent Submissions— all submissions in the last 24 h (activity feed)
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getTeacherSession, verifyStoredPassword, type TeacherSession } from '@/lib/auth';
import {
    cacheSyncedSubmissions,
    getCachedSubmissionsForTeacher,
    saveOfflineGrade,
    getPendingOfflineGrades,
    markGradesAsSynced,
    getSubmissionIdsWithPendingGrades,
    type SyncedSubmission,
    type SyncedAnswer
} from '@/lib/db';
import { checkActualConnectivity, syncSpecificSubmission } from '@/lib/sync';
import { ImagePopup } from '@/components/ImagePopup';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Assessment { assessmentId: number; title: string; }

interface RecentSubmission {
    submission_id: number;
    student_first_name: string;
    student_last_name: string;
    class_grade: number;
    section: string;
    submitted_at: string;
    status: 'pending' | 'graded';
    marks_obtained: number | null;
    total_marks: number | null;
    assessment_id: number;
    assessment_title: string;
    school_name: string | null;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function GradingPage() {
    const router = useRouter();
    const [session, setSession] = useState<TeacherSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [passwordVerified, setPasswordVerified] = useState(false);
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [verifying, setVerifying] = useState(false);

    // Grading sections
    const [needsGrading, setNeedsGrading] = useState<SyncedSubmission[]>([]);
    const [gradedPendingSync, setGradedPendingSync] = useState<SyncedSubmission[]>([]);
    const [recentSubmissions, setRecentSubmissions] = useState<RecentSubmission[]>([]);

    // Offline submissions pending server sync (shown below server feed)
    interface OfflinePendingSub {
        localId: number;
        studentFirstName: string;
        studentLastName: string;
        classGrade: number;
        section: string;
        assessmentTitle: string;
        schoolName?: string;
        savedAt: Date;
        hasSubjective: boolean;
        gradingStatus: 'graded' | 'partial' | 'ungraded'; // based on local offline grades
        status: string;
    }
    const [offlinePendingSubs, setOfflinePendingSubs] = useState<OfflinePendingSub[]>([]);

    const [assessments, setAssessments] = useState<Assessment[]>([]);
    const [selectedAssessment, setSelectedAssessment] = useState<number | 'all'>('all');
    const [selectedGrade, setSelectedGrade] = useState<number | 'all'>('all');

    const [grades, setGrades] = useState<Record<number, Record<number, number>>>({});
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [online, setOnline] = useState(true);
    // Keep a ref so callbacks can read the current online value
    // without being in their dependency arrays (prevents page reloads on connectivity changes)
    const onlineRef = useRef(true);
    // Track previous online state to detect offline → online transitions
    const prevOnlineRef = useRef(true);
    const [pendingGradesCount, setPendingGradesCount] = useState(0);
    const [showSyncWarning, setShowSyncWarning] = useState(false);

    // ── Session + connectivity ────────────────────────────────────────────────

    useEffect(() => {
        async function checkSession() {
            const sess = await getTeacherSession();
            if (!sess) { router.push('/login'); return; }
            setSession(sess);
            setLoading(false);
        }
        checkSession();

        checkActualConnectivity().then(v => { setOnline(v); onlineRef.current = v; });
        const handleNetworkChange = () =>
            checkActualConnectivity().then(v => { setOnline(v); onlineRef.current = v; });
        window.addEventListener('online', handleNetworkChange);
        window.addEventListener('offline', handleNetworkChange);
        // Poll every 30s (was 15s) — only update the ref/state, never reload the page
        const interval = setInterval(() =>
            checkActualConnectivity().then(v => { setOnline(v); onlineRef.current = v; }),
            30000);
        return () => {
            window.removeEventListener('online', handleNetworkChange);
            window.removeEventListener('offline', handleNetworkChange);
            clearInterval(interval);
        };
    }, [router]);

    // ── Load submissions ──────────────────────────────────────────────────────

    const loadSubmissions = useCallback(async () => {
        if (!session) return;

        // 1. Load server-synced pending submissions (Type B — have subjective answers)
        let serverPending: SyncedSubmission[] = [];
        if (onlineRef.current) {
            try {
                const response = await fetch(`/api/grading?teacherId=${session.userId}&status=pending`);
                if (response.ok) {
                    const data = await response.json();
                    serverPending = data.submissions.map((sub: any): SyncedSubmission => ({
                        submissionId: sub.submission_id,
                        studentFirstName: sub.student_first_name,
                        studentLastName: sub.student_last_name,
                        classGrade: sub.class_grade,
                        section: sub.section,
                        submittedAt: new Date(sub.submitted_at),
                        status: sub.status,
                        marksObtained: sub.marks_obtained,
                        totalMarks: sub.total_marks,
                        assessmentId: sub.assessment_id,
                        assessmentTitle: sub.assessment_title,
                        submittedByTeacher: session.userId,
                        schoolName: undefined,
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
                    await cacheSyncedSubmissions(serverPending);
                } else {
                    throw new Error('Fetch failed');
                }
            } catch {
                serverPending = await getCachedSubmissionsForTeacher(session.userId);
                serverPending = serverPending.filter(s => s.status === 'pending');
            }
        } else {
            serverPending = await getCachedSubmissionsForTeacher(session.userId);
            serverPending = serverPending.filter(s => s.status === 'pending');
        }

        // 2. Load offline submission pool (Type B — subjective, not yet synced to server)
        let offlineSubjective: SyncedSubmission[] = [];
        try {
            const { getOfflineGradingSubmissions } = await import('@/lib/db');
            offlineSubjective = await getOfflineGradingSubmissions(session.userId);
        } catch (e) { console.error('Error loading offline subs', e); }

        // 3. Identify which submissions have been locally graded
        const pendingGradeIds = await getSubmissionIdsWithPendingGrades();

        // 4. Build unfiltered lists for options
        const unfilteredNeedsGrading = [
            ...serverPending.filter(s => s.subjectiveAnswers.length > 0 && !pendingGradeIds.has(s.submissionId)),
            ...offlineSubjective.filter(s =>
                s.subjectiveAnswers.length > 0 && !pendingGradeIds.has(s.submissionId)
            )
        ];

        const unfilteredGradedPending = [
            ...serverPending.filter(s => pendingGradeIds.has(s.submissionId)),
            ...offlineSubjective.filter(s =>
                s.subjectiveAnswers.length > 0 && pendingGradeIds.has(s.submissionId)
            ),
        ];

        // 5. Derive assessment filter list from unfiltered data so choices do not disappear
        const assessmentMap = new Map<number, string>();
        [...unfilteredNeedsGrading, ...unfilteredGradedPending].forEach(s => {
            assessmentMap.set(s.assessmentId, s.assessmentTitle);
        });
        setAssessments(Array.from(assessmentMap.entries())
            .map(([id, title]) => ({ assessmentId: id, title }))
            .sort((a, b) => a.title.localeCompare(b.title))
        );

        // 6. Build final filtered arrays for rendering
        const allNeedsGrading = unfilteredNeedsGrading.filter(s =>
            (selectedAssessment === 'all' || s.assessmentId === selectedAssessment) &&
            (selectedGrade === 'all' || s.classGrade === selectedGrade)
        );

        const gradedPending = unfilteredGradedPending.filter(s =>
            (selectedAssessment === 'all' || s.assessmentId === selectedAssessment) &&
            (selectedGrade === 'all' || s.classGrade === selectedGrade)
        );

        setNeedsGrading(allNeedsGrading);
        setGradedPendingSync(gradedPending);
        setPendingGradesCount(pendingGradeIds.size);

        // 7. Initialise grades state from IndexedDB and server data
        const allSubs = [...allNeedsGrading, ...gradedPending];
        const { db } = await import('@/lib/db');
        const pendingGrades = await db.offlineGrades.where('synced').equals(0).toArray();
        const localGradesMap: Record<number, Record<number, number>> = {};
        for (const pg of pendingGrades) {
            if (!localGradesMap[pg.submissionId]) localGradesMap[pg.submissionId] = {};
            localGradesMap[pg.submissionId][pg.answerId] = pg.marks;
        }

        const initialGrades: Record<number, Record<number, number>> = {};
        for (const sub of allSubs) {
            initialGrades[sub.submissionId] = {};
            for (const ans of sub.subjectiveAnswers) {
                const local = localGradesMap[sub.submissionId]?.[ans.answerId];
                initialGrades[sub.submissionId][ans.answerId] = local ?? ans.marksAwarded ?? 0;
            }
        }
        setGrades(prev => {
            const next = { ...prev };
            for (const subIdStr in initialGrades) {
                const subId = Number(subIdStr);
                if (!next[subId]) {
                    next[subId] = { ...initialGrades[subId] };
                } else {
                    for (const ansIdStr in initialGrades[subId]) {
                        const ansId = Number(ansIdStr);
                        // Preserve drafts by only initializing if undefined in current state
                        if (next[subId][ansId] === undefined) {
                            next[subId][ansId] = initialGrades[subId][ansId];
                        }
                    }
                }
            }
            return next;
        });
    }, [session, selectedAssessment, selectedGrade]); // ← `online` removed: use onlineRef.current inside

    // ── Load offline pending submissions (activity feed supplement) ───────────

    const loadOfflinePendingSubs = useCallback(async () => {
        if (!session) return;
        try {
            const { db: idb } = await import('@/lib/db');
            const subs = await idb.offlineSubmissions
                .where('submittedByTeacher')
                .equals(session.userId)
                .filter(s => s.status === 'pending')
                .toArray();

            const result: Parameters<typeof setOfflinePendingSubs>[0] = [];

            for (const sub of subs) {
                const form = await idb.cachedForms.get(sub.formId);
                const assessmentTitle = form?.formData.title ?? sub.assessmentTitle ?? `Assessment #${sub.formId}`;

                // Identify subjective questions
                const allQuestions = form?.formData.sections.flatMap(s => s.questions) ?? [];
                const subjectiveQIds = allQuestions
                    .filter(q => ['short_answer', 'long_answer', 'image_upload'].includes(q.question_type))
                    .map(q => q.question_id);

                // Count answered subjective questions in this submission
                const answeredSubjIds = subjectiveQIds.filter(qId => {
                    const ans = sub.answers[qId];
                    return ans && (ans.text || ans.imageUrl || ans.localImageId != null);
                });

                const hasSubjective = subjectiveQIds.length > 0;
                let gradingStatus: 'graded' | 'partial' | 'ungraded' = 'ungraded';

                if (hasSubjective) {
                    // Check offline grades for this local submission (submissionId = -localId)
                    const grades = await idb.offlineGrades
                        .where('submissionId')
                        .equals(-sub.localId!)
                        .toArray();
                    const gradedAnswerIds = new Set(grades.map(g => g.answerId));
                    // answerId for offline answers = -questionId
                    const gradedCount = answeredSubjIds.filter(qId => gradedAnswerIds.has(-qId)).length;
                    if (gradedCount === answeredSubjIds.length && answeredSubjIds.length > 0) {
                        gradingStatus = 'graded';
                    } else if (gradedCount > 0) {
                        gradingStatus = 'partial';
                    } else {
                        gradingStatus = 'ungraded';
                    }
                }

                result.push({
                    localId: sub.localId!,
                    studentFirstName: sub.studentFirstName,
                    studentLastName: sub.studentLastName,
                    classGrade: sub.classGrade,
                    section: sub.section,
                    assessmentTitle,
                    schoolName: sub.schoolName,
                    savedAt: sub.createdAt,
                    hasSubjective,
                    gradingStatus,
                    status: sub.status,
                });
            }

            // Sort newest first
            result.sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime());
            setOfflinePendingSubs(result);
        } catch (e) {
            console.error('Error loading offline pending subs:', e);
        }
    }, [session]);

    // ── Load recent submissions (activity feed) ───────────────────────────────

    const loadRecentSubmissions = useCallback(async () => {
        if (!session) return;

        if (onlineRef.current) {
            try {
                const res = await fetch(`/api/grading?teacherId=${session.userId}&recent=true`);
                if (res.ok) {
                    const data = await res.json();
                    setRecentSubmissions(data.submissions);
                    // Cache for offline
                    try {
                        localStorage.setItem(
                            `recent_submissions_${session.userId}`,
                            JSON.stringify({ data: data.submissions, cachedAt: Date.now() })
                        );
                    } catch {/* ignore */ }
                    return;
                }
            } catch {/* fall through to cache */ }
        }

        // Offline: read from localStorage cache
        try {
            const cached = localStorage.getItem(`recent_submissions_${session.userId}`);
            if (cached) {
                const { data } = JSON.parse(cached);
                setRecentSubmissions(data);
            }
        } catch {/* ignore */ }
    }, [session]); // ← `online` removed intentionally; uses onlineRef.current to avoid rebuild on connectivity change

    useEffect(() => {
        if (passwordVerified && session) {
            loadSubmissions();
            loadRecentSubmissions();
            loadOfflinePendingSubs();
        }
    }, [passwordVerified, session, loadSubmissions, loadRecentSubmissions, loadOfflinePendingSubs]);

    // ── Auto-sync on reconnect ────────────────────────────────────────────────
    // When connectivity is restored (offline → online) and there are grades
    // pending sync, automatically fire the sync — no manual click required.
    useEffect(() => {
        const wasOffline = !prevOnlineRef.current;
        const isNowOnline = online;
        prevOnlineRef.current = online;

        if (wasOffline && isNowOnline && passwordVerified && session && gradedPendingSync.length > 0 && !syncing) {
            // Small delay so the server is properly reachable before we fire
            const timer = setTimeout(() => {
                handleSyncGradedToServer();
            }, 1500);
            return () => clearTimeout(timer);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [online]);

    // ── Sync logic ────────────────────────────────────────────────────────────

    // ── Shared grade-flush helper ────────────────────────────────────────────────────────────────────
    // Reads every entry from the grades[submissionId] map (including synthetic
    // -questionId keys for skipped questions) and persists them to IndexedDB.
    // Must be called before any sync reads from getPendingOfflineGrades().
    const flushSubGrades = useCallback(async (subs: SyncedSubmission[]) => {
        for (const sub of subs) {
            const subGrades = grades[sub.submissionId];
            if (!subGrades) continue;
            // Iterate the grades MAP directly — not subjectiveAnswers — so
            // synthetic answerId entries (for skipped questions) are included.
            for (const [answerIdStr, mark] of Object.entries(subGrades)) {
                await saveOfflineGrade(sub.submissionId, Number(answerIdStr), mark);
            }
        }
    }, [grades]);

    // handleMarkAllAsGraded
    // ─────────────────────────────────────────────────────────────────────────
    // Works ONLINE and OFFLINE.
    // Flushes current in-memory grades for every "Needs Grading" submission to
    // IndexedDB, then moves them into "Graded – Pending Sync" purely in local
    // React state — no server call, no page reload.
    const handleMarkAllAsGraded = useCallback(async () => {
        if (needsGrading.length === 0) return;
        setSaving(true);
        try {
            const toMark = [...needsGrading];

            // Flush ALL grade entries (including synthetic keys for skipped questions)
            await flushSubGrades(toMark);

            setNeedsGrading([]);
            setGradedPendingSync(prev => {
                const existingIds = new Set(prev.map(s => s.submissionId));
                const fresh = toMark.filter(s => !existingIds.has(s.submissionId));
                return [...prev, ...fresh];
            });

            const pending = await getPendingOfflineGrades();
            // Count unique submissions, not individual grade records (1 submission can have many answers)
            setPendingGradesCount(new Set(pending.map(g => g.submissionId)).size);
            setSaveMessage('All submissions marked as graded locally.');
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (err) {
            console.error('Mark as graded error:', err);
            setSaveMessage('Failed to mark as graded.');
        } finally {
            setSaving(false);
        }
    }, [needsGrading, grades, flushSubGrades]);

    // handleSyncGradedToServer
    // ─────────────────────────────────────────────────────────────────────────
    // Syncs ONLY submissions currently in "Graded – Pending Sync".
    // Submissions still in "Needs Grading" (not yet marked) are left alone.
    // Edge-case safe: marking → new subs arrive → Sync only touches the marked batch.
    const handleSyncGradedToServer = useCallback(async () => {
        if (!session) return;
        if (!onlineRef.current) {
            setSaveMessage('You are offline. Grades are saved locally and will sync when you reconnect.');
            setTimeout(() => setSaveMessage(null), 4000);
            return;
        }
        if (gradedPendingSync.length === 0) {
            setSaveMessage('No graded submissions to sync. Mark submissions as graded first.');
            setTimeout(() => setSaveMessage(null), 3000);
            return;
        }

        setSyncing(true);
        let syncError: string | null = null;
        try {
            // ── Step 0: Flush current in-memory grades to IndexedDB FIRST ───────────────
            // This is the root-cause fix: if the teacher left inputs at their default
            // value (e.g. 0) and never onChange'd them, saveOfflineGrade was never
            // called, so getPendingOfflineGrades() returns empty below, and the
            // early-return fires with "all already synced" — nothing gets sent to server.
            await flushSubGrades(gradedPendingSync);

            // ── Step 1: Identify ONLY the submissions that are in gradedPendingSync ──
            // This is the key guard: new ungraded submissions are NOT in this set.
            const gradedIds = new Set(gradedPendingSync.map(s => s.submissionId));

            const allPendingGrades = await getPendingOfflineGrades();

            // Split into offline-origin (negative submissionId) and server-origin (positive)
            const offlineGrades = allPendingGrades.filter(g =>
                g.submissionId < 0 && gradedIds.has(g.submissionId)
            );
            const syncableOnline = allPendingGrades.filter(g =>
                g.submissionId > 0 && gradedIds.has(g.submissionId)
            );

            // ── Step 2: Sync offline-origin submissions ───────────────────────────────
            const offlineLocalIds = new Set(offlineGrades.map(g => Math.abs(g.submissionId)));
            for (const localId of offlineLocalIds) {
                try { await syncSpecificSubmission(localId); }
                catch (e) { console.error('Failed to sync offline sub', localId, e); }
            }

            // ── Step 3: Sync grades for server-origin submissions ─────────────────────
            if (syncableOnline.length > 0) {
                const gradesBySubmission: Record<number, Record<number, number>> = {};
                for (const g of syncableOnline) {
                    if (!gradesBySubmission[g.submissionId]) gradesBySubmission[g.submissionId] = {};
                    gradesBySubmission[g.submissionId][g.answerId] = g.marks;
                }

                const response = await fetch('/api/grading', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ grades: gradesBySubmission, graderId: session.userId })
                });

                if (response.ok) {
                    const { db } = await import('@/lib/db');
                    for (const subId of Object.keys(gradesBySubmission).map(Number)) {
                        try { await db.syncedSubmissions.update(subId, { status: 'graded' }); }
                        catch {/* ignore */ }
                    }
                    await markGradesAsSynced(syncableOnline.map(g => g.id!));
                } else {
                    const errData = await response.json().catch(() => ({}));
                    syncError = errData.error || `Server error (${response.status})`;
                }
            }

            const remaining = await getPendingOfflineGrades();
            setPendingGradesCount(new Set(remaining.map(g => g.submissionId)).size);
            setSaveMessage(syncError ? `Sync failed: ${syncError}` : 'Grades synced to server!');

            // Reload AFTER sync is complete — teacher was not mid-grading at this point
            await loadSubmissions();
            await loadRecentSubmissions();
            await loadOfflinePendingSubs();
        } catch (err) {
            console.error('Sync failed:', err);
            setSaveMessage('Failed to sync grades. Please try again.');
        } finally {
            setSyncing(false);
            setTimeout(() => setSaveMessage(null), 4000);
        }
    }, [session, gradedPendingSync, loadSubmissions, loadRecentSubmissions, loadOfflinePendingSubs]);

    // ── Handlers ──────────────────────────────────────────────────────────────

    const handlePasswordVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError(null);
        setVerifying(true);
        try {
            const valid = await verifyStoredPassword(password);
            if (valid) setPasswordVerified(true);
            else setPasswordError('Incorrect password');
        } catch { setPasswordError('Verification failed'); }
        finally { setVerifying(false); }
    };

    // Grade change: update React state + persist to IndexedDB.
    // Intentionally does NOT reload the page or trigger any network calls.
    const handleGradeChange = async (submissionId: number, answerId: number, value: number, maxMarks: number) => {
        const clamped = Math.max(0, Math.min(value, maxMarks));
        setGrades(prev => ({
            ...prev,
            [submissionId]: { ...prev[submissionId], [answerId]: clamped }
        }));
        // We do NOT save to IndexedDB here anymore. Grades only get "saved" and move to
        // "Graded - Pending Sync" when the user explicitly clicks "Mark All as Graded".
    };

    // ── Loading / Auth screens ────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="grading-loading">
                <div className="loading-dots">
                    <span /><span /><span />
                </div>
            </div>
        );
    }

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
                        <div className="verify-actions">
                            <button type="button" onClick={() => router.push('/')} className="verify-back-btn">
                                <span className="back-arrow">←</span> Back
                            </button>
                            <button type="submit" disabled={verifying} className="verify-submit-btn">
                                {verifying ? 'Verifying...' : 'Verify Access'}
                            </button>
                        </div>
                    </form>
                </div>
                <style jsx>{`
                    .grading-verify-container {
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 20px;
                        background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
                    }
                    .verify-card {
                        background: white;
                        padding: 48px 40px;
                        border-radius: 20px;
                        box-shadow: 0 20px 40px -10px rgba(0,0,0,0.1);
                        text-align: center;
                        max-width: 420px;
                        width: 100%;
                        border: 1px solid #f1f5f9;
                    }
                    .verify-card h2 { margin: 0 0 12px; font-size: 24px; color: #0f172a; letter-spacing: -0.02em; }
                    .verify-card p { color: #64748b; margin: 0 0 8px; font-size: 15px; }
                    .verify-user { margin-bottom: 32px !important; color: #475569 !important; }
                    .verify-user strong { color: #0f172a; font-weight: 600; }
                    .verify-card input {
                        width: 100%; padding: 14px 16px;
                        border: 1px solid #cbd5e1; border-radius: 10px;
                        font-size: 15px; margin-bottom: 20px; box-sizing: border-box;
                        transition: all 0.2s;
                        outline: none; color: #0f172a;
                    }
                    .verify-card input:focus {
                        border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
                    }
                    .verify-card input::placeholder { color: #94a3b8; }
                    .verify-error { color: #ef4444; margin-bottom: 16px; font-size: 14px; background: #fef2f2; padding: 10px; border-radius: 8px; border: 1px solid #fecaca; }
                    
                    .verify-actions { display: flex; gap: 12px; margin-top: 12px; }
                    
                    .verify-back-btn {
                        flex: 1; padding: 14px; background: transparent; color: #64748b; 
                        border: 1px solid transparent; border-radius: 10px; font-size: 15px; font-weight: 600; 
                        text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; 
                        transition: all 0.2s ease;
                    }
                    .verify-back-btn:hover { background: #f1f5f9; color: #0f172a; border-color: transparent; }
                    .back-arrow { font-size: 16px; transition: transform 0.2s; margin-top: -1px; }
                    .verify-back-btn:hover .back-arrow { transform: translateX(-4px); }
                    
                    .verify-submit-btn {
                        flex: 2; padding: 14px; background: #4f46e5; color: white; border: none;
                        border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer;
                        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2);
                        letter-spacing: 0.01em;
                    }
                    .verify-submit-btn:hover:not(:disabled) {
                        background: #4338ca;
                    }
                    .verify-submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
                `}</style>
            </div>
        );
    }
    // ── Main dashboard ────────────────────────────────────────────────────────

    const hasGradingWork = needsGrading.length > 0 || gradedPendingSync.length > 0;

    return (
        <div className="grading-container">
            {/* Header */}
            <header className="grading-header">
                <div className="header-left">
                    <button type="button" onClick={() => router.push('/')} className="back-btn" title="Back to Dashboard">
                        <span className="back-icon">←</span> Dashboard
                    </button>
                    <div>
                        <h1>📝 Grading Dashboard</h1>
                        <p>Grade subjective answers and track submissions</p>
                    </div>
                </div>
                <div className="header-actions">
                    <span className={`status-badge ${online ? 'online' : 'offline'}`}>
                        {online ? '● Online' : '○ Offline'}
                    </span>
                    {pendingGradesCount > 0 && (
                        <span className="pending-badge">{pendingGradesCount} pending sync</span>
                    )}
                    {online && (
                        <button
                            onClick={() => { loadSubmissions(); loadRecentSubmissions(); loadOfflinePendingSubs(); }}
                            className="refresh-btn"
                            disabled={syncing}
                        >
                            {syncing ? '⟳' : '↻'} Refresh
                        </button>
                    )}
                    {/* Button 1 ─ Mark All as Graded (online + offline) */}
                    {needsGrading.length > 0 && (
                        <button
                            onClick={handleMarkAllAsGraded}
                            disabled={saving || syncing}
                            className="save-btn mark-graded-btn"
                            style={{ padding: '8px 18px', fontSize: '14px' }}
                            title="Save current grades locally and mark all visible submissions as graded"
                        >
                            {saving ? '⟳ Saving...' : '✓ Mark All as Graded'}
                        </button>
                    )}
                    {/* Button 2 ─ Sync Graded to Server (online) / Queued indicator (offline) */}
                    {gradedPendingSync.length > 0 && (
                        <button
                            onClick={() => { if (online) setShowSyncWarning(true); }}
                            disabled={saving || syncing || !online}
                            className="save-btn"
                            style={{ padding: '8px 18px', fontSize: '14px', opacity: online ? 1 : 0.75 }}
                            title={online ? 'Push marked-as-graded submissions to the server' : 'Grades are saved locally — will auto-sync when internet returns'}
                        >
                            {syncing ? '⟳ Syncing...' : online ? '↑ Sync Graded to Server' : '📶 Will sync on reconnect'}
                        </button>
                    )}
                </div>
            </header>

            {/* Filters */}
            <div className="grading-filters">
                <label>Class:</label>
                <select
                    value={selectedGrade}
                    onChange={(e) => setSelectedGrade(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                >
                    <option value="all">All Classes</option>
                    {[4, 5, 6, 7, 8, 9, 10].map(g => (
                        <option key={g} value={g}>Class {g}</option>
                    ))}
                </select>
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
            </div>

            {/* ── Section 1: Needs Grading ──────────────────────────────── */}
            {needsGrading.length > 0 && (
                <div className="grading-section">
                    <div className="section-banner info">
                        <h3>⏳ Needs Grading ({needsGrading.length})</h3>
                        <p>Grade these submissions, then click <strong>"Mark All as Graded"</strong> to lock them in. They will move to the section below, ready to sync.</p>
                    </div>
                    <GradingTable
                        submissions={needsGrading}
                        grades={grades}
                        onGradeChange={handleGradeChange}
                    />
                </div>
            )}

            {/* ── Section 2: Graded – Pending Sync ─────────────────────── */}
            {gradedPendingSync.length > 0 && (
                <div className="grading-section">
                    <div className="section-banner success">
                        <h3>✅ Graded – Pending Sync ({gradedPendingSync.length})</h3>
                        <p>Locally graded and saved. {online ? 'Click "Sync Graded to Server" to push to server.' : '📶 Offline — grades will be automatically pushed to the server as soon as internet returns.'}</p>
                    </div>
                    <GradingTable
                        submissions={gradedPendingSync}
                        grades={grades}
                        onGradeChange={handleGradeChange}
                        readOnly
                    />
                </div>
            )}

            {/* No grading work */}
            {!hasGradingWork && (
                <div className="no-submissions">
                    <p>🎉 No pending submissions to grade.</p>
                    <p>{online ? 'All caught up!' : 'Go online to load new submissions.'}</p>
                </div>
            )}



            {/* ── Section 3: Offline – Pending Server Sync ──────────────── */}
            {offlinePendingSubs.length > 0 && (
                <div className="grading-section offline-pending-section">
                    <div className="section-banner offline-banner">
                        <h3>📴 Offline – Pending Server Sync ({offlinePendingSubs.length})</h3>
                        <p>
                            These assessments were saved locally and have not yet been uploaded to the server.
                            {online
                                ? ' Connect and use "Sync to Server" to push them.'
                                : ' They will be synced once you go online.'}
                        </p>
                    </div>
                    <div className="recent-table-wrapper">
                        <table className="recent-table offline-pending-table">
                            <thead>
                                <tr>
                                    <th>Student</th>
                                    <th>Class</th>
                                    <th>School</th>
                                    <th>Assessment</th>
                                    <th>Grading</th>
                                    <th>Saved At</th>
                                </tr>
                            </thead>
                            <tbody>
                                {offlinePendingSubs.map(sub => (
                                    <tr key={sub.localId}>
                                        <td className="student-name">
                                            {sub.studentFirstName} {sub.studentLastName}
                                        </td>
                                        <td>{sub.classGrade}{sub.section}</td>
                                        <td className="school-name">{sub.schoolName || '—'}</td>
                                        <td className="assessment-name">{sub.assessmentTitle}</td>
                                        <td>
                                            {!sub.hasSubjective ? (
                                                <span className="status-pill auto-graded">⚡ Auto</span>
                                            ) : sub.gradingStatus === 'graded' ? (
                                                <span className="status-pill graded">✓ Graded</span>
                                            ) : sub.gradingStatus === 'partial' ? (
                                                <span className="status-pill partial">◐ Partial</span>
                                            ) : (
                                                <span className="status-pill pending">⏳ Ungraded</span>
                                            )}
                                        </td>
                                        <td className="time-cell">
                                            {formatRelativeTime(sub.savedAt)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Section 4: Recent Submissions (Activity Feed) ─────────── */}
            <div className="grading-section recent-section">
                <div className="section-banner neutral">
                    <h3>📋 Recent Submissions (Last 24h)</h3>
                    <p>{online ? 'Live from server.' : 'Showing cached data from last sync.'}</p>
                </div>
                {recentSubmissions.length === 0 ? (
                    <div className="no-submissions small">
                        <p>No submissions in the last 24 hours.</p>
                    </div>
                ) : (
                    <div className="recent-table-wrapper">
                        <table className="recent-table">
                            <thead>
                                <tr>
                                    <th>Student</th>
                                    <th>Class</th>
                                    <th>School</th>
                                    <th>Assessment</th>
                                    <th>Status</th>
                                    <th>Score</th>
                                    <th>Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentSubmissions.map(sub => (
                                    <tr key={sub.submission_id}>
                                        <td className="student-name">
                                            {sub.student_first_name} {sub.student_last_name}
                                        </td>
                                        <td>{sub.class_grade}{sub.section}</td>
                                        <td className="school-name">{sub.school_name || '—'}</td>
                                        <td className="assessment-name">{sub.assessment_title}</td>
                                        <td>
                                            <span className={`status-pill ${sub.status}`}>
                                                {sub.status === 'graded' ? '✓ Graded' : '⏳ Pending'}
                                            </span>
                                        </td>
                                        <td>
                                            {sub.status === 'graded' && sub.marks_obtained !== null
                                                ? `${sub.marks_obtained}${sub.total_marks ? '/' + sub.total_marks : ''}`
                                                : '—'}
                                        </td>
                                        <td className="time-cell">
                                            {formatRelativeTime(new Date(sub.submitted_at))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <style jsx>{`
                .grading-container {
                    max-width: 1400px;
                    margin: 0 auto;
                    padding: 24px;
                    padding-bottom: 80px;
                }
                .grading-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 24px;
                    flex-wrap: wrap;
                    gap: 16px;
                }
                .header-left {
                    display: flex;
                    align-items: center;
                    gap: 24px;
                }
                .grading-header h1 { margin: 0 0 4px; font-size: 26px; font-weight: 700; color: #0f172a; letter-spacing: -0.01em; display: flex; align-items: center; gap: 10px; }
                .grading-header p { color: #64748b; margin: 0; font-size: 14px; font-weight: 400; }
                .header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
                .status-badge {
                    padding: 6px 14px; border-radius: 20px;
                    font-size: 13px; font-weight: 600;
                    border: 1px solid transparent;
                }
                .status-badge.online { background: oklch(96% 0.03 144); color: oklch(40% 0.1 144); border-color: oklch(90% 0.06 144); }
                .status-badge.offline { background: oklch(96% 0.04 80); color: oklch(45% 0.12 80); border-color: oklch(90% 0.08 80); }
                .pending-badge {
                    padding: 6px 14px; background: oklch(96% 0.04 15);
                    color: oklch(50% 0.16 15); border-radius: 20px; font-size: 13px; font-weight: 600;
                    border: 1px solid oklch(90% 0.06 15);
                }
                .back-btn {
                    padding: 8px 14px; background: transparent;
                    border: 1px solid transparent;
                    border-radius: 8px; text-decoration: none; color: #64748b;
                    font-weight: 600; font-size: 14px;
                    transition: all 0.2s ease;
                    display: inline-flex; align-items: center; gap: 6px;
                }
                .back-btn:hover {
                    background: #f1f5f9; color: #0f172a; border-color: transparent;
                }
                .back-icon { transition: transform 0.2s; font-size: 16px; margin-top: -1px; }
                .back-btn:hover .back-icon { transform: translateX(-4px); }
                .refresh-btn {
                    padding: 10px 18px; background: #f1f5f9; color: #475569;
                    border: 1px solid transparent; border-radius: 10px; cursor: pointer; font-size: 14px;
                    font-weight: 600; transition: all 0.2s;
                }
                .refresh-btn:hover:not(:disabled) { background: #e2e8f0; color: #0f172a; }
                .refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }
                .grading-filters {
                    display: flex; align-items: center; gap: 12px;
                    margin-bottom: 24px; flex-wrap: wrap;
                }
                .grading-filters label { font-size: 14px; font-weight: 500; color: #555; }
                .grading-filters select {
                    padding: 8px 12px; border: 1px solid #ddd;
                    border-radius: 8px; font-size: 14px;
                }
                .grading-loading {
                    min-height: 100vh; display: flex;
                    align-items: center; justify-content: center;
                }
                .loading-dots { display: flex; gap: 8px; }
                .loading-dots span {
                    width: 10px; height: 10px; background: #667eea;
                    border-radius: 50%; animation: bounce 1.4s infinite ease-in-out both;
                }
                .loading-dots span:nth-child(1) { animation-delay: -0.32s; }
                .loading-dots span:nth-child(2) { animation-delay: -0.16s; }
                @keyframes bounce {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1); }
                }
                .grading-section { margin-bottom: 48px; }
                .recent-section { margin-top: 48px; }
                .section-banner {
                    padding: 16px 24px; border-radius: 12px;
                    margin-bottom: 20px; border: 1px solid transparent;
                    display: flex; flex-direction: column; gap: 4px;
                }
                .section-banner h3 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
                .section-banner p { margin: 0; font-size: 14px; opacity: 0.9; }
                .section-banner.info { background: oklch(96% 0.02 240); border-color: oklch(90% 0.04 240); color: oklch(35% 0.08 240); }
                .section-banner.success { background: oklch(96% 0.03 144); border-color: oklch(90% 0.06 144); color: oklch(35% 0.08 144); }
                .section-banner.neutral { background: oklch(98% 0 0); border-color: oklch(90% 0 0); color: oklch(40% 0 0); }
                .offline-banner { background: oklch(96% 0.04 80); border-color: oklch(90% 0.08 80); color: oklch(40% 0.1 80); }
                .no-submissions {
                    text-align: center; padding: 64px 20px; color: oklch(50% 0 0);
                    background: white; border-radius: 16px; border: 1px dashed oklch(85% 0 0);
                    font-size: 15px;
                }
                .no-submissions.small { padding: 32px 20px; }
                .save-btn {
                    padding: 12px 24px; background: #0f172a;
                    color: white; border: none; border-radius: 10px;
                    font-size: 14px; font-weight: 600; cursor: pointer;
                    transition: background-color 0.2s ease;
                }
                .save-btn:hover:not(:disabled) {
                    background: #1e293b;
                }
                .save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
                .mark-graded-btn {
                    background: oklch(50% 0.12 144) !important;
                }
                .mark-graded-btn:hover:not(:disabled) {
                    background: oklch(45% 0.12 144) !important;
                }
                /* Recent table container */
                .recent-table-wrapper {
                    overflow-x: auto; border: 1px solid #e2e8f0;
                    border-radius: 12px; background: white;
                    box-shadow: 0 2px 4px -2px rgba(0,0,0,0.02);
                }
                .recent-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 14px; }
                .recent-table th {
                    padding: 14px 16px; background: #f8fafc;
                    font-weight: 600; text-align: left; color: #475569;
                    border-bottom: 1px solid #e2e8f0; white-space: nowrap;
                    font-size: 13px;
                }
                .recent-table td {
                    padding: 14px 16px; border-bottom: 1px solid #f1f5f9;
                    color: #334155; vertical-align: middle;
                }
                .recent-table tr:last-child td { border-bottom: none; }
                .recent-table tr:hover td { background: #f8fafc; }
                .student-name { font-weight: 600; color: #0f172a; white-space: nowrap; }
                .school-name { color: #64748b; font-size: 13px; max-width: 160px; }
                .assessment-name { max-width: 200px; color: #334155; font-weight: 500; }
                .time-cell { color: #64748b; font-size: 13px; white-space: nowrap; }
                
                .status-pill {
                    display: inline-flex; align-items: center; justify-content: center;
                    padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;
                    white-space: nowrap; letter-spacing: 0.01em; height: 24px;
                }
                .status-pill.graded { background: oklch(96% 0.03 144); color: oklch(40% 0.1 144); }
                .status-pill.pending { background: oklch(96% 0.04 80); color: oklch(45% 0.12 80); }
                .status-pill.auto-graded { background: oklch(96% 0.03 240); color: oklch(45% 0.1 240); }
                .status-pill.partial { background: oklch(96% 0.04 45); color: oklch(50% 0.14 45); }
            `}</style>

            {/* Save message toast */}
            {saveMessage && (
                <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: '#155724', color: 'white', padding: '12px 20px', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 999 }}>
                    {saveMessage}
                </div>
            )}

            {/* Sync Warning Modal */}
            {showSyncWarning && (
                <div
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
                    onClick={() => setShowSyncWarning(false)}
                >
                    <div
                        style={{ background: 'white', borderRadius: '12px', padding: '28px', maxWidth: '420px', width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 style={{ margin: '0 0 12px', color: '#856404', fontSize: '1.1rem' }}>⚠️ Confirm Sync to Server</h3>
                        <p style={{ margin: '0 0 24px', lineHeight: 1.6, color: '#333', fontSize: '0.95rem' }}>
                            This will push <strong>{gradedPendingSync.length} graded submission{gradedPendingSync.length !== 1 ? 's' : ''}</strong> to the server.
                            Submissions still in "Needs Grading" will <em>not</em> be affected.
                            Once synced, marks cannot be changed from this dashboard.
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowSyncWarning(false)}
                                style={{ padding: '9px 20px', border: '1px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '14px' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => { setShowSyncWarning(false); await handleSyncGradedToServer(); }}
                                style={{ padding: '9px 20px', background: '#667eea', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
                            >
                                Proceed &amp; Sync
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date): string {
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return date.toLocaleDateString();
}

// ─── GradingTable Component ───────────────────────────────────────────────────

function GradingTable({ submissions, grades, onGradeChange, readOnly = false }: {
    submissions: SyncedSubmission[];
    grades: Record<number, Record<number, number>>;
    onGradeChange: (subId: number, ansId: number, val: number, max: number) => void;
    readOnly?: boolean;
}) {
    const [selectedAnswerText, setSelectedAnswerText] = useState<string | null>(null);
    if (submissions.length === 0) return null;

    // Group by assessment title
    const groups = submissions.reduce((acc, sub) => {
        if (!acc[sub.assessmentTitle]) acc[sub.assessmentTitle] = [];
        acc[sub.assessmentTitle].push(sub);
        return acc;
    }, {} as Record<string, SyncedSubmission[]>);

    return (
        <div className="grading-groups">
            {Object.entries(groups).map(([title, subs]) => {
                // Collect unique questions across this assessment group
                const questions: { questionId: number; questionText: string; maxMarks: number }[] = [];
                for (const sub of subs) {
                    for (const ans of sub.subjectiveAnswers) {
                        if (!questions.find(q => q.questionId === ans.questionId)) {
                            questions.push({
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
                                        {questions.map(q => (
                                            <th key={q.questionId} title={q.questionText}>
                                                {q.questionText.length > 28
                                                    ? q.questionText.substring(0, 28) + '…'
                                                    : q.questionText}
                                                <br />
                                                <small style={{ fontWeight: 'normal', color: '#888' }}>
                                                    max {q.maxMarks}
                                                </small>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {subs.map(sub => (
                                        <tr key={sub.submissionId}>
                                            <td className="sticky-col student-cell">
                                                <div className="student-name">
                                                    {sub.studentFirstName} {sub.studentLastName}
                                                </div>
                                                <div className="student-meta">
                                                    Class {sub.classGrade}{sub.section}
                                                    {sub.schoolName && ` · ${sub.schoolName}`}
                                                </div>
                                            </td>
                                            {questions.map(q => {
                                                const ans = sub.subjectiveAnswers.find(a => a.questionId === q.questionId);
                                                if (!ans) {
                                                    // Student skipped this question — no answer record exists.
                                                    // Use a synthetic answerId (-questionId) so the teacher
                                                    // can still assign a mark. Grade is stored in the grades
                                                    // map and flushed to IndexedDB on "Mark All as Graded".
                                                    const syntheticAnswerId = -q.questionId;
                                                    return (
                                                        <td key={q.questionId} className="grade-cell">
                                                            <div className="answer-preview">
                                                                <em style={{ color: '#bbb' }}>No answer submitted</em>
                                                            </div>
                                                            {readOnly ? (
                                                                <span
                                                                    className="grade-badge"
                                                                    title={`Grade: ${grades[sub.submissionId]?.[syntheticAnswerId] ?? 0} / ${q.maxMarks}`}
                                                                >
                                                                    {grades[sub.submissionId]?.[syntheticAnswerId] ?? 0} / {q.maxMarks}
                                                                </span>
                                                            ) : (
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    max={q.maxMarks}
                                                                    value={grades[sub.submissionId]?.[syntheticAnswerId] ?? 0}
                                                                    onChange={(e) => onGradeChange(
                                                                        sub.submissionId,
                                                                        syntheticAnswerId,
                                                                        parseFloat(e.target.value) || 0,
                                                                        q.maxMarks
                                                                    )}
                                                                    className="grade-input"
                                                                />
                                                            )}
                                                        </td>
                                                    );
                                                }
                                                return (
                                                    <td key={q.questionId} className="grade-cell">
                                                        <div className="answer-preview">
                                                            {ans.answerImageUrl || ans.answerImageBlob ? (
                                                                <ImageLink url={ans.answerImageUrl} blob={ans.answerImageBlob} />
                                                            ) : (
                                                                <span
                                                                    className="ans-text clickable"
                                                                    onClick={() => {
                                                                        if (ans.answerText) setSelectedAnswerText(ans.answerText);
                                                                    }}
                                                                    title={ans.answerText ? "Click to view full answer" : ""}
                                                                >
                                                                    {ans.answerText
                                                                        ? (ans.answerText.length > 60
                                                                            ? ans.answerText.substring(0, 60) + '…'
                                                                            : ans.answerText)
                                                                        : <em style={{ color: '#bbb' }}>No answer</em>}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {readOnly ? (
                                                            <span
                                                                className="grade-badge"
                                                                title={`Grade: ${grades[sub.submissionId]?.[ans.answerId] ?? 0} / ${q.maxMarks}`}
                                                            >
                                                                {grades[sub.submissionId]?.[ans.answerId] ?? 0} / {q.maxMarks}
                                                            </span>
                                                        ) : (
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
                                                        )}
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
                .grading-groups { display: flex; flex-direction: column; gap: 40px; }
                .assessment-group {
                    background: white; border-radius: 16px;
                    border: 1px solid #e2e8f0; padding: 24px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.02);
                }
                .group-title {
                    margin: 0 0 20px; font-size: 20px; color: #0f172a;
                    font-weight: 700; letter-spacing: -0.01em;
                    display: flex; align-items: center; gap: 8px;
                }
                .group-title::before {
                    content: ''; display: block; width: 6px; height: 24px;
                    background: #4f46e5; border-radius: 4px;
                }
                .grading-table-wrapper {
                    overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 12px;
                    box-shadow: 0 2px 4px -2px rgba(0,0,0,0.02);
                }
                .grading-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 14px; }
                .grading-table th, .grading-table td {
                    padding: 14px 16px; border-bottom: 1px solid #f1f5f9; text-align: left;
                    vertical-align: middle;
                }
                .grading-table th { 
                    background: #f8fafc; font-weight: 600; color: #475569; white-space: nowrap; 
                    font-size: 13px;
                }
                .grading-table tr:last-child td { border-bottom: none; }
                .grading-table tbody tr:hover td { background: #f8fafc; }
                .sticky-col {
                    position: sticky; left: 0; background: white; z-index: 1;
                    min-width: 140px; border-right: 1px solid #e2e8f0;
                }
                .grading-table tbody tr:hover td.sticky-col { background: #f8fafc; }
                .grading-table th.sticky-col { background: #f8fafc; }
                .student-cell { max-width: 250px; }
                .student-name { font-weight: 600; color: #0f172a; }
                .student-meta { font-size: 13px; color: #64748b; margin-top: 4px; }
                .grade-cell { min-width: 200px; }
                .grade-input {
                    width: 72px; padding: 8px 10px;
                    border: 1px solid #cbd5e1; border-radius: 8px;
                    text-align: center; font-size: 14px; font-weight: 500;
                    color: #0f172a; transition: all 0.2s;
                }
                .grade-input:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1); }
                .grade-badge {
                    display: inline-flex; align-items: center; justify-content: center;
                    padding: 4px 12px; height: 28px;
                    background: oklch(96% 0.03 144); color: oklch(40% 0.1 144);
                    border-radius: 14px; font-size: 13px; font-weight: 600;
                    white-space: nowrap; border: 1px solid oklch(90% 0.06 144);
                }
                .grade-badge-zero {
                    background: #f8fafc; color: #64748b;
                    border-color: #e2e8f0;
                }
                .answer-preview {
                    margin-bottom: 8px; font-size: 13px;
                    background: #f8f9fa; padding: 6px 8px; border-radius: 6px;
                    border: 1px solid #eee; max-height: 80px;
                    overflow-y: auto; word-wrap: break-word;
                }
                .ans-text { color: #333; }
                .ans-text.clickable {
                    cursor: pointer;
                }
                .ans-text.clickable:hover {
                    text-decoration: underline;
                    color: #667eea;
                }
                .view-img-link {
                    display: inline-block; font-size: 12px;
                    color: #667eea; text-decoration: underline; cursor: pointer;
                }
                .view-img-link.disabled { color: #bbb; cursor: default; text-decoration: none; }
            `}</style>

            {selectedAnswerText && (
                <TextPopup text={selectedAnswerText} onClose={() => setSelectedAnswerText(null)} />
            )}
        </div>
    );
}

// ─── TextPopup Component ──────────────────────────────────────────────────────

function TextPopup({ text, onClose }: { text: string; onClose: () => void }) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="text-popup-overlay" onClick={onClose}>
            <div className="text-popup-content-wrapper" onClick={e => e.stopPropagation()}>
                <div className="text-popup-controls">
                    <button onClick={onClose} className="close-btn" title="Close">✕</button>
                </div>
                <div className="text-popup-title">Full Answer Text</div>
                <div className="text-popup-text">
                    {text}
                </div>
            </div>
            <style jsx>{`
                .text-popup-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.5); display: flex;
                    align-items: center; justify-content: center; z-index: 10000;
                }
                .text-popup-content-wrapper {
                    background: white; padding: 40px 24px 24px;
                    border-radius: 12px; max-width: 650px; width: 90%;
                    max-height: 85vh; overflow-y: auto; position: relative;
                    box-shadow: 0 4px 24px rgba(0,0,0,0.2);
                }
                .text-popup-controls {
                    position: absolute; top: 12px; right: 12px;
                }
                .close-btn {
                    background: none; border: none; font-size: 20px;
                    cursor: pointer; color: #888;
                }
                .close-btn:hover { color: #d93025; }
                .text-popup-title {
                    font-size: 18px; font-weight: 500; color: #222; margin-bottom: 12px;
                    border-bottom: 1px solid #eee; padding-bottom: 8px;
                }
                .text-popup-text {
                    font-size: 15px; line-height: 1.6; color: #333;
                    white-space: pre-wrap; word-wrap: break-word;
                }
            `}</style>
        </div>
    );
}

// ─── ImageLink Component ──────────────────────────────────────────────────────

function ImageLink({ url, blob }: { url: string | null; blob?: Blob }) {
    const [displayUrl, setDisplayUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [isPopupOpen, setIsPopupOpen] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        let active = true;
        let objectUrl: string | null = null;

        const init = async () => {
            if (blob) {
                objectUrl = URL.createObjectURL(blob);
                if (active) setDisplayUrl(objectUrl);
                setLoading(false);
                return;
            }

            if (url) {
                // Try from cache first (for offline support)
                try {
                    const { db } = await import('@/lib/db');
                    const cached = await db.cachedImages.get(url);
                    if (cached && active) {
                        objectUrl = URL.createObjectURL(cached.blob);
                        setDisplayUrl(objectUrl);
                        setLoading(false);
                        return;
                    }
                } catch { /* ignore */ }

                // Fallback to direct URL if online
                if (navigator.onLine) {
                    if (active) setDisplayUrl(url);
                }
                setLoading(false);
            } else {
                setLoading(false);
            }
        };

        setLoading(true);
        init();

        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [url, blob]);

    if (loading) {
        return <span className="view-img-link loading">⌛ Loading...</span>;
    }

    if (!displayUrl || error) {
        return (
            <span className="view-img-link disabled" title="Image not available offline">
                📷 Not cached
            </span>
        );
    }

    return (
        <div className="thumbnail-container">
            <div
                className="thumbnail-preview"
                onClick={() => setIsPopupOpen(true)}
                title="Click to view full image"
            >
                <img
                    src={displayUrl}
                    alt="Answer thumbnail"
                    onError={() => setError(true)}
                    className="thumb-img"
                />
                <div className="thumb-overlay">
                    <span>🔍 View</span>
                </div>
            </div>

            {isPopupOpen && (
                <ImagePopup
                    src={displayUrl}
                    alt="Answer preview"
                    onClose={() => setIsPopupOpen(false)}
                />
            )}

            <style jsx>{`
                .thumbnail-container {
                    display: inline-block;
                    margin-top: 4px;
                }
                .thumbnail-preview {
                    position: relative;
                    width: 100px;
                    height: 60px;
                    border-radius: 6px;
                    overflow: hidden;
                    border: 1px solid #ddd;
                    cursor: zoom-in;
                    background: #eee;
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                .thumbnail-preview:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                    border-color: #667eea;
                }
                .thumb-img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .thumb-overlay {
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(102, 126, 234, 0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    transition: opacity 0.2s;
                }
                .thumbnail-preview:hover .thumb-overlay {
                    opacity: 1;
                }
                .thumb-overlay span {
                    color: white;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    background: rgba(0,0,0,0.4);
                    padding: 2px 6px;
                    border-radius: 4px;
                }
                .loading { color: #888; font-style: italic; }
            `}</style>
        </div>
    );
}
