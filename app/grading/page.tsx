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

interface Assessment { filterKey: string; assessmentId: number; title: string; language?: string; }

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
    selected_language?: string;
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
        selectedLanguage?: string;
    }
    const [offlinePendingSubs, setOfflinePendingSubs] = useState<OfflinePendingSub[]>([]);

    const [assessments, setAssessments] = useState<Assessment[]>([]);
    const [selectedAssessment, setSelectedAssessment] = useState<string | 'all'>('all');
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
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    // ── Session + connectivity ────────────────────────────────────────────────

    useEffect(() => {
        async function checkSession() {
            const sess = await getTeacherSession();
            if (!sess) { router.replace('/login'); return; }
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
                const response = await fetch(`/api/grading?teacherId=${session.userId}&status=pending&role=${encodeURIComponent(session.role)}`);
                if (response.ok) {
                    const data = await response.json();
                    serverPending = data.submissions.map((sub: any): SyncedSubmission => ({
                        submissionId: sub.submission_id,
                        studentFirstName: sub.student_first_name,
                        studentLastName: sub.student_last_name,
                        studentId: sub.student_id,
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
                        selectedLanguage: sub.selected_language,
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
        const assessmentMap = new Map<string, { id: number, title: string, lang: string }>();
        [...unfilteredNeedsGrading, ...unfilteredGradedPending].forEach(s => {
            const key = s.selectedLanguage ? `${s.assessmentId}-${s.selectedLanguage}` : `${s.assessmentId}`;
            const title = s.selectedLanguage ? `${s.assessmentTitle} (${s.selectedLanguage})` : s.assessmentTitle;
            assessmentMap.set(key, { id: s.assessmentId, title, lang: s.selectedLanguage || '' });
        });
        setAssessments(Array.from(assessmentMap.entries())
            .map(([key, data]) => ({ filterKey: key, assessmentId: data.id, title: data.title, language: data.lang }))
            .sort((a, b) => a.title.localeCompare(b.title))
        );

        // 6. Build final filtered arrays for rendering
        const allNeedsGrading = unfilteredNeedsGrading.filter(s => {
            const currentKey = s.selectedLanguage ? `${s.assessmentId}-${s.selectedLanguage}` : `${s.assessmentId}`;
            return (selectedAssessment === 'all' || currentKey === selectedAssessment) &&
                (selectedGrade === 'all' || s.classGrade === selectedGrade);
        });

        const gradedPending = unfilteredGradedPending.filter(s => {
            const currentKey = s.selectedLanguage ? `${s.assessmentId}-${s.selectedLanguage}` : `${s.assessmentId}`;
            return (selectedAssessment === 'all' || currentKey === selectedAssessment) &&
                (selectedGrade === 'all' || s.classGrade === selectedGrade);
        });

        setNeedsGrading(allNeedsGrading);
        setGradedPendingSync(gradedPending);
        setPendingGradesCount(pendingGradeIds.size);

        // 7. Initialise grades state from IndexedDB and server data
        const allSubs = [...allNeedsGrading, ...gradedPending];
        const { db } = await import('@/lib/db');
        const allOfflineGrades = await db.offlineGrades.toArray();
        const localGradesMap: Record<number, Record<number, number>> = {};
        for (const pg of allOfflineGrades) {
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
                    selectedLanguage: sub.selectedLanguage,
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
                const res = await fetch(`/api/grading?teacherId=${session.userId}&recent=true&role=${encodeURIComponent(session.role)}`);
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
    // ── Shared grade-flush helper ────────────────────────────────────────────────────────────────────
    // Reads every entry from the grades[submissionId] map (including synthetic
    // -questionId keys for skipped questions) and persists them to IndexedDB.
    // Must be called before any sync reads from getPendingOfflineGrades().
    const flushSubGrades = useCallback(async (subs: SyncedSubmission[], isDraft: boolean = true) => {
        console.log('[DEBUG] flushSubGrades started for submissions:', subs.map(s => s.submissionId), 'isDraft:', isDraft);
        for (const sub of subs) {
            const subGrades = grades[sub.submissionId];
            console.log(`[DEBUG] flushSubGrades checking sub ${sub.submissionId}. Grades in memory:`, subGrades);
            if (!subGrades) {
                console.warn(`[DEBUG] No grades found in React state for submission ${sub.submissionId}. Initializing with 0s.`);
                // Fallback: If no entry exists in memory, write 0s for all subjective questions
                for (const ans of sub.subjectiveAnswers) {
                    console.log(`[DEBUG] Writing default 0 grade for sub ${sub.submissionId}, ans ${ans.answerId}`);
                    await saveOfflineGrade(sub.submissionId, ans.answerId, 0, isDraft);
                }
                continue;
            }
            // Iterate the grades MAP directly — not subjectiveAnswers — so
            // synthetic answerId entries (for skipped questions) are included.
            for (const [answerIdStr, mark] of Object.entries(subGrades)) {
                console.log(`[DEBUG] Saving offline grade for sub ${sub.submissionId}, answerId ${answerIdStr} = ${mark}`);
                await saveOfflineGrade(sub.submissionId, Number(answerIdStr), mark, isDraft);
            }
        }
        console.log('[DEBUG] flushSubGrades completed.');
    }, [grades]);

    // handleSyncGradedToServer
    // ─────────────────────────────────────────────────────────────────────────
    // Syncs ONLY submissions currently in "Graded – Pending Sync" (or target list if provided).
    // Submissions still in "Needs Grading" (not yet marked) are left alone.
    // Edge-case safe: marking → new subs arrive → Sync only touches the marked batch.
    const handleSyncGradedToServer = useCallback(async (subsToSync?: SyncedSubmission[]) => {
        console.log('=== [DEBUG] handleSyncGradedToServer CALLED ===');
        if (!session) {
            console.error('[DEBUG] No session found during sync.');
            return;
        }
        console.log('[DEBUG] Current Session UserID:', session.userId, 'Role:', session.role);
        console.log('[DEBUG] Is online (onlineRef.current):', onlineRef.current);
        
        if (!onlineRef.current) {
            setSaveMessage('You are offline. Grades are saved locally and will sync when you reconnect.');
            setTimeout(() => setSaveMessage(null), 4000);
            return;
        }
        
        const targets = subsToSync || gradedPendingSync;
        console.log('[DEBUG] targets to sync:', targets.map(s => s.submissionId));
        if (targets.length === 0) {
            setSaveMessage('No graded submissions to sync. Mark submissions as graded first.');
            setTimeout(() => setSaveMessage(null), 3000);
            return;
        }

        setSyncing(true);
        let syncError: string | null = null;
        try {
            // ── Step 0: Flush current in-memory grades to IndexedDB FIRST ───────────────
            console.log('[DEBUG] Step 0: Triggering flushSubGrades before sync...');
            await flushSubGrades(targets, false);

            // ── Step 1: Identify ONLY the submissions that are in targets ──
            const gradedIds = new Set(targets.map(s => s.submissionId));
            console.log('[DEBUG] Step 1: Graded submission IDs:', Array.from(gradedIds));

            const allPendingGrades = await getPendingOfflineGrades();
            console.log('[DEBUG] All pending grades in IndexedDB:', allPendingGrades);

            // Split into offline-origin (negative submissionId) and server-origin (positive)
            const offlineGrades = allPendingGrades.filter(g =>
                g.submissionId < 0 && gradedIds.has(g.submissionId)
            );
            const syncableOnline = allPendingGrades.filter(g =>
                g.submissionId > 0 && gradedIds.has(g.submissionId)
            );
            console.log('[DEBUG] Offline grades to sync (negative IDs):', offlineGrades);
            console.log('[DEBUG] Online grades to sync (positive IDs):', syncableOnline);

            // ── Step 2: Sync offline-origin submissions ───────────────────────────────
            const offlineLocalIds = new Set(offlineGrades.map(g => Math.abs(g.submissionId)));
            console.log('[DEBUG] Step 2: Offline origin local IDs to sync:', Array.from(offlineLocalIds));
            for (const localId of offlineLocalIds) {
                try {
                    console.log(`[DEBUG] Triggering syncSpecificSubmission for localId: ${localId}`);
                    await syncSpecificSubmission(localId);
                    console.log(`[DEBUG] Successfully synced localId: ${localId}`);
                } catch (e) {
                    console.error('[DEBUG] Failed to sync offline sub', localId, e);
                    syncError = e instanceof Error ? e.message : `Failed to sync offline submission #${localId}`;
                }
            }

            // ── Step 3: Sync grades for server-origin submissions ─────────────────────
            const onlineTargets = targets.filter(s => s.submissionId > 0);
            console.log('[DEBUG] Step 3: Server-origin targets to sync:', onlineTargets.map(t => t.submissionId));
            if (onlineTargets.length > 0) {
                const gradesBySubmission: Record<number, Record<number, number>> = {};
                for (const sub of onlineTargets) {
                    gradesBySubmission[sub.submissionId] = {};
                }
                for (const g of syncableOnline) {
                    if (gradesBySubmission[g.submissionId]) {
                        gradesBySubmission[g.submissionId][g.answerId] = g.marks;
                    }
                }
                console.log('[DEBUG] Preparing POST payload to /api/grading:', gradesBySubmission);

                console.log('[DEBUG] Sending POST /api/grading request...');
                const response = await fetch('/api/grading', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ grades: gradesBySubmission, graderId: session.userId })
                });
                console.log('[DEBUG] POST /api/grading response status:', response.status);

                if (response.ok) {
                    console.log('[DEBUG] POST successful! Updating syncedSubmissions in Dexie to "graded"...');
                    const { db } = await import('@/lib/db');
                    for (const subId of Object.keys(gradesBySubmission).map(Number)) {
                        try {
                            await db.syncedSubmissions.update(subId, { status: 'graded' });
                            console.log(`[DEBUG] Updated IndexedDB syncedSubmissions status for sub ${subId} to "graded"`);
                        } catch (e) {
                            console.error(`[DEBUG] Failed to update IndexedDB status for sub ${subId}`, e);
                        }
                    }
                    console.log('[DEBUG] Marking grades as synced in IndexedDB...');
                    await markGradesAsSynced(syncableOnline.map(g => g.id!));
                    console.log('[DEBUG] Grades marked as synced successfully.');
                } else {
                    const errData = await response.json().catch(() => ({}));
                    console.error('[DEBUG] POST failed with response:', errData);
                    syncError = errData.error || `Server error (${response.status})`;
                }
            }

            const remaining = await getPendingOfflineGrades();
            console.log('[DEBUG] Remaining unsynced grades in IndexedDB:', remaining);
            setPendingGradesCount(new Set(remaining.map(g => g.submissionId)).size);
            setSaveMessage(syncError ? `Sync failed: ${syncError}` : 'Grades synced to server!');

            console.log('[DEBUG] Reloading all submissions after sync...');
            await loadSubmissions();
            await loadRecentSubmissions();
            await loadOfflinePendingSubs();
            console.log('[DEBUG] Submissions reloaded successfully.');
        } catch (err) {
            console.error('[DEBUG] Critical error during sync:', err);
            setSaveMessage('Failed to sync grades. Please try again.');
        } finally {
            setSyncing(false);
            setTimeout(() => setSaveMessage(null), 4000);
            console.log('=== [DEBUG] handleSyncGradedToServer COMPLETED ===');
        }
    }, [session, gradedPendingSync, loadSubmissions, loadRecentSubmissions, loadOfflinePendingSubs, flushSubGrades]);

    // handleMarkAllAsGraded
    // ─────────────────────────────────────────────────────────────────────────
    // Works ONLINE and OFFLINE.
    // Flushes current in-memory grades for every "Needs Grading" submission to
    // IndexedDB, then moves them into "Graded – Pending Sync" purely in local
    // React state.
    // In Online mode, automatically triggers a sync to immediately submit the marks.
    // handleSaveGradesLocally
    // ─────────────────────────────────────────────────────────────────────────
    // Saves all current grades in memory locally to IndexedDB as drafts.
    // Keeps submissions editable in the "Needs Grading" list.
    const handleSaveGradesLocally = useCallback(async () => {
        console.log('=== [DEBUG] handleSaveGradesLocally CALLED ===');
        console.log('[DEBUG] visible needsGrading count:', needsGrading.length);
        if (needsGrading.length === 0) {
            console.warn('[DEBUG] No visible submissions to save.');
            return;
        }
        setSaving(true);
        try {
            const toSave = [...needsGrading];
            console.log('[DEBUG] Submissions to save locally:', toSave.map(s => s.submissionId));

            // Flush ALL grade entries to IndexedDB as drafts (isDraft: true)
            console.log('[DEBUG] Triggering flushSubGrades with isDraft: true...');
            await flushSubGrades(toSave, true);

            setHasUnsavedChanges(false);
            setSaveMessage('Grades saved locally.');
            setTimeout(() => setSaveMessage(null), 3000);

            // Reload submissions to refresh IndexedDB state
            await loadSubmissions();
            await loadOfflinePendingSubs();
        } catch (err) {
            console.error('[DEBUG] Critical error in handleSaveGradesLocally:', err);
            setSaveMessage('Failed to save grades locally.');
        } finally {
            setSaving(false);
            console.log('=== [DEBUG] handleSaveGradesLocally COMPLETED ===');
        }
    }, [needsGrading, grades, flushSubGrades, loadSubmissions, loadOfflinePendingSubs]);

    // handleUploadGrades
    // ─────────────────────────────────────────────────────────────────────────
    // Finalize all current grades in memory and upload to server (online)
    // or queue for sync (offline).
    const handleUploadGrades = useCallback(async () => {
        console.log('=== [DEBUG] handleUploadGrades CALLED ===');
        console.log('[DEBUG] visible needsGrading count:', needsGrading.length);
        if (needsGrading.length === 0) {
            console.warn('[DEBUG] No visible submissions to grade.');
            return;
        }
        setSaving(true);
        try {
            const toMark = [...needsGrading];
            console.log('[DEBUG] Submissions to upload grades for:', toMark.map(s => s.submissionId));

            // Flush ALL grade entries as FINALIZED (isDraft: false)
            console.log('[DEBUG] Triggering flushSubGrades with isDraft: false...');
            await flushSubGrades(toMark, false);

            setHasUnsavedChanges(false);

            // If online, trigger auto-sync to server immediately.
            console.log('[DEBUG] Checking if online to trigger upload:', onlineRef.current);
            if (onlineRef.current) {
                console.log('[DEBUG] Online! Triggering sync to server...');
                await handleSyncGradedToServer(toMark);
            } else {
                console.log('[DEBUG] Offline. Moved grades to pending sync.');
                setSaveMessage('Grades finalized and marked as pending sync. They will sync automatically when internet returns.');
                setTimeout(() => setSaveMessage(null), 5000);

                // Reload lists to move finalized items to the read-only Graded Pending Sync section
                await loadSubmissions();
                await loadOfflinePendingSubs();
            }
        } catch (err) {
            console.error('[DEBUG] Critical error in handleUploadGrades:', err);
            setSaveMessage('Failed to upload grades.');
        } finally {
            setSaving(false);
            console.log('=== [DEBUG] handleUploadGrades COMPLETED ===');
        }
    }, [needsGrading, grades, flushSubGrades, handleSyncGradedToServer, loadSubmissions, loadOfflinePendingSubs]);

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
        setHasUnsavedChanges(true);
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
                    <h2 className="verify-title-flex">
                        <span className="material-symbols-rounded lock-icon">lock</span>
                        Grading Access
                    </h2>
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
                                <span className="material-symbols-rounded font-icon-btn">arrow_back</span> Back
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
                        background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-navy) 100%);
                        font-family: var(--font-sans);
                    }
                    .verify-card {
                        background: white;
                        padding: 48px 40px;
                        border-radius: var(--radius-lg);
                        box-shadow: var(--shadow-lg);
                        text-align: center;
                        max-width: 420px;
                        width: 100%;
                        border: 1.5px solid var(--color-border);
                    }
                    .verify-title-flex {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        gap: 10px;
                        margin: 0 0 12px;
                        font-size: 26px;
                        font-weight: 700;
                        color: var(--color-primary);
                        letter-spacing: -0.02em;
                        font-family: var(--font-sans);
                    }
                    .lock-icon {
                        font-size: 28px;
                        color: var(--color-accent-peach);
                    }
                    .verify-card p { color: var(--color-text-secondary); margin: 0 0 8px; font-size: 15px; font-family: var(--font-sans); }
                    .verify-user { margin-bottom: 32px !important; color: var(--color-text-secondary) !important; font-family: var(--font-sans); }
                    .verify-user strong { color: var(--color-primary); font-weight: 600; }
                    .verify-card input {
                        width: 100%; padding: 14px 16px;
                        border: 1.5px solid var(--color-border); border-radius: var(--radius-md);
                        font-size: 15px; margin-bottom: 20px; box-sizing: border-box;
                        transition: all 0.2s;
                        outline: none; color: var(--color-text);
                        background-color: var(--color-bg);
                        font-family: var(--font-sans);
                        height: 52px;
                    }
                    .verify-card input:focus {
                        border-color: var(--color-accent); box-shadow: 0 0 0 3px rgba(78, 205, 196, 0.25);
                        background-color: white;
                    }
                    .verify-card input::placeholder { color: var(--color-text-secondary); }
                    .verify-error { color: var(--color-error); margin-bottom: 16px; font-size: 14px; background: #fee2e2; padding: 10px; border-radius: var(--radius-sm); border: 1.5px solid #fca5a5; font-family: var(--font-sans); }
                    
                    .verify-actions { display: flex; gap: 12px; margin-top: 12px; }
                    .verify-back-btn {
                        border: 1.5px solid var(--color-border); border-radius: var(--radius-md); font-size: 15px; font-weight: 600; 
                        text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 6px; 
                        transition: all 0.2s ease; padding: 0 18px; color: var(--color-text-secondary);
                        font-family: var(--font-sans);
                        height: 50px;
                        cursor: pointer;
                        background: white;
                    }
                    .verify-back-btn:hover { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-primary); }
                    .font-icon-btn { font-size: 20px; transition: transform 0.2s; }
                    .verify-back-btn:hover .font-icon-btn { transform: translateX(-4px); }
                    
                    .verify-submit-btn {
                        flex: 2; padding: 14px; background: var(--color-primary); color: white; border: 1.5px solid transparent;
                        border-radius: var(--radius-md); font-size: 15px; font-weight: 600; cursor: pointer;
                        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 4px 12px rgba(21, 65, 89, 0.15);
                        letter-spacing: 0.01em;
                        font-family: var(--font-sans);
                        height: 50px;
                    }
                    .verify-submit-btn:hover:not(:disabled) {
                        background: var(--color-accent);
                        color: var(--color-primary);
                        box-shadow: 0 4px 12px rgba(78, 205, 196, 0.3);
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
                        <span className="material-symbols-rounded back-icon">arrow_back</span> Dashboard
                    </button>
                    <div>
                        <h1 className="header-title-flex">
                            <span className="material-symbols-rounded header-icon-dashboard">assignment</span>
                            Grading Dashboard
                        </h1>
                        <p>Grade subjective answers and track submissions</p>
                    </div>
                </div>
                <div className="header-actions">
                    <span className={`status-badge ${online ? 'online' : 'offline'}`}>
                        {online ? (
                            <span className="flex-status-item">
                                <span className="material-symbols-rounded status-symbol">wifi</span> Online
                            </span>
                        ) : (
                            <span className="flex-status-item">
                                <span className="material-symbols-rounded status-symbol">wifi_off</span> Offline
                            </span>
                        )}
                    </span>
                    <button 
                        onClick={() => router.push('/students')}
                        className="manage-students-btn"
                    >
                        <span className="material-symbols-rounded">group</span> Manage Students
                    </button>
                    {pendingGradesCount > 0 && (
                        <span className="pending-badge">
                            <span className="material-symbols-rounded badge-icon-inline">schedule</span> {pendingGradesCount} pending sync
                        </span>
                    )}
                    {online && (
                        <button
                            onClick={() => { loadSubmissions(); loadRecentSubmissions(); loadOfflinePendingSubs(); }}
                            className="refresh-btn flex-btn-icon"
                            disabled={syncing}
                        >
                            <span className={`material-symbols-rounded ${syncing ? 'animate-spin' : ''}`}>refresh</span>
                            Refresh
                        </button>
                    )}
                    {/* Save Grades Button */}
                    {needsGrading.length > 0 && (
                        <button
                            onClick={handleSaveGradesLocally}
                            disabled={saving || syncing || !hasUnsavedChanges}
                            className="save-btn flex-btn-icon"
                            title="Save current grades locally as draft"
                            style={{ background: 'var(--color-primary)', color: 'white' }}
                        >
                            <span className="material-symbols-rounded">{saving ? 'hourglass_empty' : 'save'}</span>
                            {saving ? 'Saving...' : 'Save Grades'}
                        </button>
                    )}
                    {/* Upload Grades Button */}
                    {needsGrading.length > 0 && (
                        <button
                            onClick={() => {
                                console.log('[DEBUG] "Upload Grades" button clicked. needsGrading.length =', needsGrading.length);
                                setShowSyncWarning(true);
                            }}
                            disabled={saving || syncing}
                            className="save-btn mark-graded-btn flex-btn-icon"
                            title="Finalize and upload grades to server"
                        >
                            <span className="material-symbols-rounded">cloud_upload</span>
                            Upload Grades
                        </button>
                    )}
                    {/* Sync Graded to Server Button (offline-queued finalized items) */}
                    {gradedPendingSync.length > 0 && (
                        <button
                            onClick={() => {
                                console.log('[DEBUG] "Sync Graded to Server" primary button clicked. gradedPendingSync.length =', gradedPendingSync.length);
                                if (online) handleSyncGradedToServer();
                            }}
                            disabled={saving || syncing || !online}
                            className="save-btn sync-server-btn flex-btn-icon"
                            style={{ opacity: online ? 1 : 0.75 }}
                            title={online ? 'Push finalized grades to the server' : 'Grades are finalized and saved locally — will auto-sync when internet returns'}
                        >
                            {syncing ? (
                                <>
                                    <span className="material-symbols-rounded animate-spin">refresh</span>
                                    Syncing...
                                </>
                            ) : online ? (
                                <>
                                    <span className="material-symbols-rounded">cloud_upload</span>
                                    Sync Graded to Server
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-rounded">cloud_queue</span>
                                    Will sync on reconnect
                                </>
                            )}
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
                    onChange={(e) => setSelectedAssessment(e.target.value)}
                >
                    <option value="all">All Assessments</option>
                    {assessments.map(a => (
                        <option key={a.filterKey} value={a.filterKey}>{a.title}</option>
                    ))}
                </select>
            </div>

            {/* ── Section 1: Needs Grading ──────────────────────────────── */}
            {needsGrading.length > 0 && (
                <div className="grading-section">
                    <div className="section-banner info">
                        <h3 className="section-header-flex">
                            <span className="material-symbols-rounded banner-icon info-icon">schedule</span>
                            Needs Grading ({needsGrading.length})
                        </h3>
                        <p>Grade these submissions. You can click <strong>"Save Grades"</strong> to save draft progress locally. When ready, click <strong>"Upload Grades"</strong> to finalize and sync them.</p>
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
                        <h3 className="section-header-flex">
                            <span className="material-symbols-rounded banner-icon success-icon">check_circle</span>
                            Graded – Pending Sync ({gradedPendingSync.length})
                        </h3>
                        <p>Locally graded and saved. {online ? 'Click "Sync Graded to Server" to push to server.' : <span className="offline-alert-flex"><span className="material-symbols-rounded font-inline-alert">wifi_off</span> Offline — grades will be automatically pushed to the server as soon as internet returns.</span>}</p>
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
                    <p className="no-submissions-flex">
                        <span className="material-symbols-rounded satisfied-smiley">sentiment_satisfied</span>
                        No pending submissions to grade.
                    </p>
                    <p>{online ? 'All caught up!' : 'Go online to load new submissions.'}</p>
                </div>
            )}



            {/* ── Section 3: Offline – Pending Server Sync ──────────────── */}
            {offlinePendingSubs.length > 0 && (
                <div className="grading-section offline-pending-section">
                    <div className="section-banner offline-banner">
                        <h3 className="section-header-flex">
                            <span className="material-symbols-rounded banner-icon offline-icon">cloud_off</span>
                            Offline – Pending Server Sync ({offlinePendingSubs.length})
                        </h3>
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
                                            {sub.selectedLanguage && (
                                                <span className="student-lang-tag">
                                                    {sub.selectedLanguage}
                                                </span>
                                            )}
                                        </td>
                                        <td>{sub.classGrade}{sub.section}</td>
                                        <td className="school-name">{sub.schoolName || '—'}</td>
                                        <td className="assessment-name">
                                            {sub.selectedLanguage ? `${sub.assessmentTitle} (${sub.selectedLanguage})` : sub.assessmentTitle}
                                        </td>
                                        <td>
                                            {!sub.hasSubjective ? (
                                                <span className="status-pill auto-graded flex-status-pill">
                                                    <span className="material-symbols-rounded pill-symbol">bolt</span> Auto
                                                </span>
                                            ) : sub.gradingStatus === 'graded' ? (
                                                <span className="status-pill graded flex-status-pill">
                                                    <span className="material-symbols-rounded pill-symbol">check_circle</span> Graded
                                                </span>
                                            ) : sub.gradingStatus === 'partial' ? (
                                                <span className="status-pill partial flex-status-pill">
                                                    <span className="material-symbols-rounded pill-symbol">published_with_changes</span> Partial
                                                </span>
                                            ) : (
                                                <span className="status-pill pending flex-status-pill">
                                                    <span className="material-symbols-rounded pill-symbol">schedule</span> Ungraded
                                                </span>
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
                    <h3 className="section-header-flex">
                        <span className="material-symbols-rounded banner-icon neutral-icon">feed</span>
                        Recent Submissions (Last 24h)
                    </h3>
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
                                            {sub.selected_language && (
                                                <span className="student-lang-tag">
                                                    {sub.selected_language}
                                                </span>
                                            )}
                                        </td>
                                        <td>{sub.class_grade}{sub.section}</td>
                                        <td className="school-name">{sub.school_name || '—'}</td>
                                        <td className="assessment-name">
                                            {sub.selected_language ? `${sub.assessment_title} (${sub.selected_language})` : sub.assessment_title}
                                        </td>
                                        <td>
                                            {sub.status === 'graded' ? (
                                                <span className="status-pill graded flex-status-pill">
                                                    <span className="material-symbols-rounded pill-symbol">check_circle</span> Graded
                                                </span>
                                            ) : (
                                                <span className="status-pill pending flex-status-pill">
                                                    <span className="material-symbols-rounded pill-symbol">schedule</span> Pending
                                                </span>
                                            )}
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
                    padding: 40px 24px;
                    padding-bottom: 80px;
                    font-family: var(--font-sans);
                }
                .grading-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 32px;
                    flex-wrap: wrap;
                    gap: 16px;
                    font-family: var(--font-sans);
                }
                .header-left {
                    display: flex;
                    align-items: center;
                    gap: 24px;
                }
                .header-title-flex {
                    margin: 0 0 4px;
                    font-size: 28px;
                    font-weight: 700;
                    color: var(--color-primary);
                    letter-spacing: -0.02em;
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    font-family: var(--font-sans);
                }
                .header-icon-dashboard {
                    font-size: 32px;
                    color: var(--color-primary);
                }
                .grading-header p { color: var(--color-text-secondary); margin: 0; font-size: 14px; font-weight: 400; font-family: var(--font-sans); }
                .header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
                
                .status-badge {
                    padding: 8px 16px;
                    border-radius: var(--radius-md);
                    font-size: 13px;
                    font-weight: 600;
                    border: 1.5px solid transparent;
                    font-family: var(--font-sans);
                    display: inline-flex;
                    align-items: center;
                }
                .flex-status-item {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                .status-symbol {
                    font-size: 18px;
                }
                .status-badge.online { background: rgba(16, 185, 129, 0.1); color: var(--color-success); border-color: rgba(16, 185, 129, 0.2); }
                .status-badge.offline { background: rgba(245, 158, 11, 0.1); color: var(--color-warning); border-color: rgba(245, 158, 11, 0.2); }
                
                .pending-badge {
                    padding: 8px 16px;
                    background: rgba(239, 68, 68, 0.1);
                    color: var(--color-error);
                    border-radius: var(--radius-md);
                    font-size: 13px;
                    font-weight: 600;
                    border: 1.5px solid rgba(239, 68, 68, 0.2);
                    font-family: var(--font-sans);
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                .badge-icon-inline {
                    font-size: 16px;
                }

                .back-btn {
                    padding: 8px 16px;
                    background: transparent;
                    border: 1.5px solid transparent;
                    border-radius: var(--radius-md);
                    text-decoration: none;
                    color: var(--color-text-secondary);
                    font-weight: 600;
                    font-size: 14px;
                    transition: all 0.2s ease;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    font-family: var(--font-sans);
                    cursor: pointer;
                }
                .back-btn:hover {
                    background: var(--color-primary-light);
                    color: var(--color-primary);
                    border-color: var(--color-border);
                }
                .back-icon {
                    transition: transform 0.2s ease;
                    font-size: 18px;
                }
                .back-btn:hover .back-icon {
                    transform: translateX(-4px);
                }

                .manage-students-btn {
                    padding: 8px 16px;
                    background: var(--color-primary-light);
                    color: var(--color-primary);
                    border: 1.5px solid var(--color-border);
                    border-radius: var(--radius-md);
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    transition: all 0.2s ease;
                    font-family: var(--font-sans);
                }
                .manage-students-btn:hover {
                    background: var(--color-primary);
                    color: white;
                    border-color: var(--color-primary);
                }

                .refresh-btn {
                    padding: 8px 16px;
                    background: white;
                    color: var(--color-primary);
                    border: 1.5px solid var(--color-border);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 600;
                    transition: all 0.2s ease;
                    font-family: var(--font-sans);
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                .refresh-btn:hover:not(:disabled) {
                    background: var(--color-primary-light);
                    border-color: var(--color-primary);
                }
                .refresh-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                .flex-btn-icon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                }

                .save-btn {
                    padding: 8px 18px;
                    background: var(--color-primary);
                    color: white;
                    border: 1.5px solid transparent;
                    border-radius: var(--radius-md);
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    box-shadow: var(--shadow);
                    font-family: var(--font-sans);
                }
                .save-btn:hover:not(:disabled) {
                    background: var(--color-accent);
                    color: var(--color-primary);
                    box-shadow: 0 4px 12px rgba(78, 205, 196, 0.3);
                }
                .save-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                .mark-graded-btn {
                    background: var(--color-success) !important;
                    color: white !important;
                }
                .mark-graded-btn:hover:not(:disabled) {
                    background: #059669 !important;
                    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3) !important;
                }
                
                .grading-filters {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 32px;
                    flex-wrap: wrap;
                    font-family: var(--font-sans);
                }
                .grading-filters label {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--color-text-secondary);
                }
                .grading-filters select {
                    padding: 10px 14px;
                    border: 1.5px solid var(--color-border);
                    border-radius: var(--radius-md);
                    font-size: 14px;
                    font-family: var(--font-sans);
                    color: var(--color-text);
                    background-color: white;
                    outline: none;
                    transition: all 0.2s ease;
                }
                .grading-filters select:focus {
                    border-color: var(--color-accent);
                    box-shadow: 0 0 0 3px rgba(78, 205, 196, 0.25);
                }

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
                    width: 12px;
                    height: 12px;
                    background: var(--color-accent);
                    border-radius: 50%;
                    animation: bounce 1.4s infinite ease-in-out both;
                }
                .loading-dots span:nth-child(1) { animation-delay: -0.32s; }
                .loading-dots span:nth-child(2) { animation-delay: -0.16s; }
                @keyframes bounce {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1); }
                }

                .grading-section {
                    margin-bottom: 48px;
                }
                .recent-section {
                    margin-top: 48px;
                }
                .section-banner {
                    padding: 20px 24px;
                    border-radius: var(--radius-md);
                    margin-bottom: 24px;
                    border: 1.5px solid transparent;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    font-family: var(--font-sans);
                }
                .section-header-flex {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 700;
                    letter-spacing: -0.01em;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                }
                .banner-icon {
                    font-size: 22px;
                }
                .section-banner p { margin: 0; font-size: 14px; opacity: 0.9; }
                .section-banner.info { background: var(--color-primary-light); border-color: rgba(21, 65, 89, 0.15); color: var(--color-primary); }
                .section-banner.success { background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.2); color: var(--color-success); }
                .section-banner.neutral { background: var(--color-bg); border-color: var(--color-border); color: var(--color-text-secondary); }
                .offline-banner { background: rgba(245, 158, 11, 0.08); border-color: rgba(245, 158, 11, 0.2); color: #b45309; }
                
                .offline-alert-flex {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                .font-inline-alert {
                    font-size: 16px;
                }

                .no-submissions {
                    text-align: center;
                    padding: 64px 24px;
                    color: var(--color-text-secondary);
                    background: white;
                    border-radius: var(--radius-md);
                    border: 1.5px dashed var(--color-border);
                    font-size: 15px;
                    font-family: var(--font-sans);
                }
                .no-submissions-flex {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    font-size: 18px;
                    font-weight: 700;
                    color: var(--color-primary);
                    margin: 0 0 8px;
                }
                .satisfied-smiley {
                    font-size: 24px;
                    color: var(--color-accent-peach);
                }
                .no-submissions.small { padding: 32px 20px; }

                /* Recent table container */
                .recent-table-wrapper {
                    overflow-x: auto;
                    border: 1.5px solid var(--color-border);
                    border-radius: var(--radius-md);
                    background: white;
                    box-shadow: var(--shadow);
                }
                .recent-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 14px; font-family: var(--font-sans); }
                .recent-table th {
                    padding: 14px 16px;
                    background: var(--color-primary-light);
                    font-weight: 600;
                    text-align: left;
                    color: var(--color-primary);
                    border-bottom: 1.5px solid var(--color-border);
                    white-space: nowrap;
                    font-size: 13px;
                    font-family: var(--font-sans);
                }
                .recent-table td {
                    color: var(--color-text); vertical-align: middle; font-family: var(--font-sans);
                }
                .recent-table tr:last-child td { border-bottom: none; }
                .recent-table tr:hover td { background: var(--color-primary-light); }
                .student-name { font-weight: 600; color: var(--color-primary); white-space: nowrap; font-family: var(--font-sans); }
                .school-name { color: var(--color-text-secondary); font-size: 13px; max-width: 160px; font-family: var(--font-sans); }
                .assessment-name { max-width: 200px; color: var(--color-text); font-weight: 500; font-family: var(--font-sans); }
                .time-cell { color: var(--color-text-secondary); font-size: 13px; white-space: nowrap; font-family: var(--font-sans); }
                
                .status-pill {
                    display: inline-flex; align-items: center; justify-content: center;
                    padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;
                    white-space: nowrap; letter-spacing: 0.01em; height: 24px; font-family: var(--font-sans);
                }
                .status-pill.graded { background: rgba(16, 185, 129, 0.1); color: var(--color-success); }
                .status-pill.pending { background: rgba(245, 158, 11, 0.1); color: var(--color-warning); }
                .status-pill.auto-graded { background: var(--color-primary-light); color: var(--color-primary); }
                .status-pill.partial { background: rgba(245, 181, 151, 0.15); color: #c2410c; }

                /* Premium Modals Styles */
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(15, 23, 42, 0.6);
                    backdrop-filter: blur(8px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    padding: 20px;
                    animation: fadeIn 0.25s ease-out;
                }
                .modal-wrapper {
                    background: white;
                    width: 100%;
                    max-width: 480px;
                    border-radius: var(--radius-lg);
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                    border: 1.5px solid var(--color-border);
                    padding: 32px;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    font-family: var(--font-sans);
                    transform: scale(0.95);
                    animation: scaleUp 0.25s ease-out forwards;
                }
                .modal-title-flex {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 700;
                    letter-spacing: -0.02em;
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    font-family: var(--font-sans);
                }
                .warning-title {
                    color: #9a3412;
                }
                .modal-warn-icon {
                    font-size: 28px;
                    color: var(--color-accent-peach);
                }
                .modal-desc {
                    margin: 0;
                    font-size: 15px;
                    line-height: 1.6;
                    color: var(--color-text-secondary);
                    font-family: var(--font-sans);
                }
                .modal-desc strong {
                    color: var(--color-primary);
                }
                .modal-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    margin-top: 12px;
                }
                .modal-cancel-btn {
                    padding: 10px 20px;
                    background: white;
                    border: 1.5px solid var(--color-border);
                    border-radius: var(--radius-md);
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--color-text-secondary);
                    cursor: pointer;
                    transition: all 0.2s ease;
                    font-family: var(--font-sans);
                }
                .modal-cancel-btn:hover {
                    background: var(--color-primary-light);
                    color: var(--color-primary);
                    border-color: var(--color-border);
                }
                .modal-proceed-btn {
                    padding: 10px 24px;
                    border: 1.5px solid transparent;
                    border-radius: var(--radius-md);
                    font-size: 14px;
                    font-weight: 600;
                    color: white;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    font-family: var(--font-sans);
                    box-shadow: var(--shadow);
                }
                .warning-proceed {
                    background: var(--color-accent-peach);
                }
                .warning-proceed:hover {
                    background: #ea580c;
                    box-shadow: 0 4px 12px rgba(244, 117, 96, 0.3);
                }
                .success-proceed {
                    background: var(--color-success);
                }
                .success-proceed:hover {
                    background: #059669;
                    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes scaleUp {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>

            {/* Save message toast */}
            {saveMessage && (
                <div className="toast-notification">
                    <span className="material-symbols-rounded">check_circle</span>
                    <span>{saveMessage}</span>
                </div>
            )}

            {/* Upload Grades Confirmation Modal */}
            {showSyncWarning && (
                <div className="modal-overlay" onClick={() => setShowSyncWarning(false)}>
                    <div className="modal-wrapper" onClick={(e) => e.stopPropagation()}>
                        <h3 className="modal-title-flex warning-title">
                            <span className="material-symbols-rounded modal-warn-icon">warning</span>
                            Confirm Upload Grades
                        </h3>
                        <p className="modal-desc">
                            This will finalize and upload grades for <strong>{needsGrading.length} submission{needsGrading.length !== 1 ? 's' : ''}</strong>.
                            {online ? ' Once uploaded, grades cannot be changed from this dashboard.' : ' You are currently offline. These grades will be locked and queued to sync automatically when you reconnect.'}
                        </p>
                        <div className="modal-actions">
                            <button
                                onClick={() => setShowSyncWarning(false)}
                                className="modal-cancel-btn"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => { setShowSyncWarning(false); await handleUploadGrades(); }}
                                className="modal-proceed-btn warning-proceed"
                            >
                                Confirm &amp; Upload
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
    const [popupContent, setPopupContent] = useState<{title: string, text: string} | null>(null);
    if (submissions.length === 0) return null;

    // Group by assessment title + language
    const groups = submissions.reduce((acc, sub) => {
        const title = sub.selectedLanguage ? `${sub.assessmentTitle} (${sub.selectedLanguage})` : sub.assessmentTitle;
        if (!acc[title]) acc[title] = [];
        acc[title].push(sub);
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
                                            <th key={q.questionId} title="Click to view full question">
                                                <span
                                                    className="ans-text clickable"
                                                    style={{ cursor: 'pointer', color: 'inherit' }}
                                                    onClick={() => {
                                                        if (q.questionText) setPopupContent({ title: "Full Question Text", text: q.questionText });
                                                    }}
                                                >
                                                    {q.questionText.length > 28
                                                        ? q.questionText.substring(0, 28) + '…'
                                                        : q.questionText}
                                                </span>
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
                                                    {sub.selectedLanguage && (
                                                        <span className="student-lang-tag">
                                                            {sub.selectedLanguage}
                                                        </span>
                                                    )}
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
                                                                        if (ans.answerText) setPopupContent({ title: "Full Answer Text", text: ans.answerText });
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
                .grading-groups { display: flex; flex-direction: column; gap: 40px; font-family: var(--font-sans); }
                .assessment-group {
                    background: white; border-radius: var(--radius-md);
                    border: 1.5px solid var(--color-border); padding: 24px;
                    box-shadow: var(--shadow);
                    font-family: var(--font-sans);
                }
                .group-title {
                    margin: 0 0 20px; font-size: 20px; color: var(--color-primary);
                    font-weight: 700; letter-spacing: -0.01em;
                    display: flex; align-items: center; gap: 8px;
                    font-family: var(--font-sans);
                }
                .group-title::before {
                    content: ''; display: block; width: 6px; height: 24px;
                    background: var(--color-accent); border-radius: 4px;
                }
                .grading-table-wrapper {
                    overflow-x: auto; border: 1.5px solid var(--color-border); border-radius: var(--radius-md);
                    box-shadow: var(--shadow);
                }
                .grading-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 14px; font-family: var(--font-sans); }
                .grading-table th, .grading-table td {
                    padding: 14px 16px; border-bottom: 1px solid var(--color-border); text-align: left;
                    vertical-align: middle; font-family: var(--font-sans);
                }
                .grading-table th { 
                    background: var(--color-primary-light); font-weight: 600; color: var(--color-primary); white-space: nowrap; 
                    font-size: 13px; font-family: var(--font-sans);
                }
                .grading-table tr:last-child td { border-bottom: none; }
                .grading-table tbody tr:hover td { background: var(--color-primary-light); }
                .sticky-col {
                    position: sticky; left: 0; background: white; z-index: 1;
                    min-width: 140px; border-right: 1.5px solid var(--color-border);
                }
                .grading-table tbody tr:hover td.sticky-col { background: var(--color-primary-light); }
                .grading-table th.sticky-col { background: var(--color-primary-light); }
                .student-cell { max-width: 250px; }
                .student-name { font-weight: 600; color: var(--color-primary); font-family: var(--font-sans); }
                .student-lang-tag {
                    font-size: 10px;
                    background: var(--color-primary-light, #eef2f6);
                    color: var(--color-primary, #154159);
                    padding: 2px 6px;
                    border-radius: 4px;
                    margin-left: 8px;
                    font-weight: 600;
                    vertical-align: middle;
                    display: inline-block;
                    border: 1px solid var(--color-border);
                }
                .student-meta { font-size: 13px; color: var(--color-text-secondary); margin-top: 4px; font-family: var(--font-sans); }
                .grade-cell { min-width: 200px; }
                .grade-input {
                    width: 72px; padding: 8px 10px;
                    border: 1.5px solid var(--color-border); border-radius: var(--radius-sm);
                    text-align: center; font-size: 14px; font-weight: 500;
                    color: var(--color-text); transition: all 0.2s;
                    font-family: var(--font-sans);
                    background-color: white;
                    outline: none;
                }
                .grade-input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px rgba(78, 205, 196, 0.25); }
                .grade-badge {
                    display: inline-flex; align-items: center; justify-content: center;
                    padding: 4px 12px; height: 28px;
                    background: rgba(16, 185, 129, 0.1); color: var(--color-success);
                    border-radius: 14px; font-size: 13px; font-weight: 600;
                    white-space: nowrap; border: 1.5px solid rgba(16, 185, 129, 0.2);
                    font-family: var(--font-sans);
                }
                .grade-badge-zero {
                    background: var(--color-bg); color: var(--color-text-secondary);
                    border-color: var(--color-border);
                }
                .answer-preview {
                    margin-bottom: 8px; font-size: 13px;
                    background: var(--color-primary-light); padding: 6px 8px; border-radius: 6px;
                    border: 1px solid var(--color-border); max-height: 80px;
                    overflow-y: auto; word-wrap: break-word; font-family: var(--font-sans);
                }
                .ans-text { color: var(--color-text); }
                .ans-text.clickable {
                    cursor: pointer;
                }
                .ans-text.clickable:hover {
                    text-decoration: underline;
                    color: var(--color-accent);
                }
                .view-img-link {
                    display: inline-block; font-size: 12px;
                    color: var(--color-primary); text-decoration: underline; cursor: pointer;
                    font-weight: 600;
                }
                .view-img-link.disabled { color: var(--color-text-secondary); cursor: default; text-decoration: none; }
            `}</style>

            {popupContent && (
                <TextPopup text={popupContent.text} title={popupContent.title} onClose={() => setPopupContent(null)} />
            )}
        </div>
    );
}

// ─── TextPopup Component ──────────────────────────────────────────────────────

function TextPopup({ text, title, onClose }: { text: string; title?: string; onClose: () => void }) {
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
                <div className="text-popup-title">{title || "Full Text"}</div>
                <div className="text-popup-text">
                    {text}
                </div>
            </div>
            <style jsx>{`
                .text-popup-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(15, 23, 42, 0.5); backdrop-filter: blur(4px); display: flex;
                    align-items: center; justify-content: center; z-index: 10000;
                }
                .text-popup-content-wrapper {
                    background: white; padding: 40px 24px 24px;
                    border-radius: var(--radius-md); max-width: 650px; width: 90%;
                    max-height: 85vh; overflow-y: auto; position: relative;
                    box-shadow: var(--shadow-lg); border: 1.5px solid var(--color-border);
                    font-family: var(--font-sans);
                }
                .text-popup-controls {
                    position: absolute; top: 12px; right: 12px;
                }
                .close-btn {
                    background: none; border: none; font-size: 20px;
                    cursor: pointer; color: var(--color-text-secondary);
                    font-family: var(--font-sans);
                }
                .close-btn:hover { color: var(--color-error); }
                .text-popup-title {
                    font-size: 18px; font-weight: 700; color: var(--color-primary); margin-bottom: 12px;
                    border-bottom: 1.5px solid var(--color-border); padding-bottom: 8px;
                    font-family: var(--font-sans);
                }
                .text-popup-text {
                    font-size: 15px; line-height: 1.6; color: var(--color-text);
                    white-space: pre-wrap; word-wrap: break-word;
                    font-family: var(--font-sans);
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
        return (
            <span className="view-img-link loading" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span className="material-symbols-rounded" style={{ animation: 'spin 1.5s linear infinite', fontSize: '16px' }}>autorenew</span>
                Loading...
            </span>
        );
    }

    if (!displayUrl || error) {
        return (
            <span className="view-img-link disabled" title="Image not available offline" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>no_photography</span>
                Not cached
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
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '14px', color: 'white' }}>zoom_in</span>
                        View
                    </span>
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
                    font-family: var(--font-sans);
                }
                .thumbnail-preview {
                    position: relative;
                    width: 100px;
                    height: 60px;
                    border-radius: var(--radius-sm);
                    overflow: hidden;
                    border: 1.5px solid var(--color-border);
                    cursor: zoom-in;
                    background: var(--color-primary-light);
                    transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
                }
                .thumbnail-preview:hover {
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-md);
                    border-color: var(--color-accent);
                }
                .thumb-img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .thumb-overlay {
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(27, 43, 78, 0.4);
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
                    background: var(--color-primary);
                    padding: 2px 6px;
                    border-radius: 4px;
                }
                .loading { color: var(--color-text-secondary); font-style: italic; }
            `}</style>
        </div>
    );
}
