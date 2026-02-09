/**
 * Auto-Sync Logic
 * 
 * Handles synchronization of offline data when the device reconnects.
 * Schools are synced once per day (24 hours).
 */

import {
    db,
    getPendingSubmissions,
    getPendingImagesForSubmission,
    updateSubmissionStatus,
    updateImageStatus,
    cacheSchools,
    cacheAssessments,
    shouldSyncSchools,
    getPendingOfflineGrades,
    markGradesAsSynced,
    type OfflineSubmission,
    type CachedSchool,
    type CachedAssessment
} from './db';

// ============ SYNC STATE ============

let isSyncing = false;
let syncListenersRegistered = false;

type SyncCallback = (status: SyncStatus) => void;
const syncCallbacks: Set<SyncCallback> = new Set();

export interface SyncStatus {
    isSyncing: boolean;
    pendingCount: number;
    lastSyncAt: Date | null;
    error: string | null;
    syncingSchools: boolean;
    syncingAssessments: boolean;
}

// ============ PUBLIC API ============

export function onSyncStatusChange(callback: SyncCallback): () => void {
    syncCallbacks.add(callback);
    return () => syncCallbacks.delete(callback);
}

export function initSyncListeners(): void {
    if (syncListenersRegistered || typeof window === 'undefined') return;

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);

    syncListenersRegistered = true;
}

export function cleanupSyncListeners(): void {
    if (typeof window === 'undefined') return;

    window.removeEventListener('online', handleOnline);
    window.removeEventListener('focus', handleFocus);

    syncListenersRegistered = false;
}

export async function triggerSync(): Promise<void> {
    if (!navigator.onLine) return;
    if (isSyncing) return;
    // Verify actual connectivity before attempting sync
    const actuallyOnline = await checkActualConnectivity();
    if (!actuallyOnline) return;
    await performSync();
}

/**
 * Force sync schools (manual trigger, bypasses 24h check)
 */
export async function forceSyncSchools(): Promise<void> {
    if (!navigator.onLine) {
        throw new Error('Cannot sync while offline');
    }
    await syncSchools();
}

/**
 * Force sync assessments (manual trigger)
 */
export async function forceSyncAssessments(): Promise<CachedAssessment[]> {
    if (!navigator.onLine) {
        throw new Error('Cannot sync while offline');
    }
    return await syncAssessments();
}

export function isOnline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine;
}

// ============ CONNECTIVITY CHECK ============

/**
 * Check actual internet connectivity by making a real request.
 * navigator.onLine can be unreliable on flaky connections.
 * This is EXPORTED so components can use it before making API calls.
 */
export async function checkActualConnectivity(): Promise<boolean> {
    // Quick check first - if navigator says offline, trust it
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return false;
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const response = await fetch('/api/health', {
            method: 'HEAD',
            signal: controller.signal,
            cache: 'no-store'
        });
        clearTimeout(timeoutId);
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Check if an error is a network-related error (offline, timeout, etc.)
 */
function isNetworkError(error: unknown): boolean {
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        return true;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
        return true;
    }
    return false;
}

// ============ INTERNAL SYNC LOGIC ============

async function handleOnline(): Promise<void> {
    // Small delay to allow network to stabilize after coming online
    await new Promise(resolve => setTimeout(resolve, 1000));
    const actuallyOnline = await checkActualConnectivity();
    if (actuallyOnline) {
        await performSync();
    }
}

async function handleFocus(): Promise<void> {
    if (navigator.onLine && !isSyncing) {
        const actuallyOnline = await checkActualConnectivity();
        if (actuallyOnline) {
            await performSync();
        }
    }
}

async function performSync(): Promise<void> {
    if (isSyncing) return;

    isSyncing = true;
    notifyListeners({
        isSyncing: true,
        pendingCount: 0,
        lastSyncAt: null,
        error: null,
        syncingSchools: false,
        syncingAssessments: false
    });

    try {
        // Step 1: Check if schools need sync (once per day)
        const needsSchoolsSync = await shouldSyncSchools();
        if (needsSchoolsSync) {
            notifyListeners({
                isSyncing: true,
                pendingCount: 0,
                lastSyncAt: null,
                error: null,
                syncingSchools: true,
                syncingAssessments: false
            });
            await syncSchools();
        }

        // Step 2: Sync pending submissions
        const pendingSubmissions = await getPendingSubmissions();

        for (const submission of pendingSubmissions) {
            await syncSubmission(submission);
        }

        // Step 3: Push local offline grades BEFORE fetching new data
        // This prevents server state (which doesn't have our edits yet) from overwriting local work
        await pushOfflineGrades();

        // Step 4: Sync recent grading data for offline use
        // This ensures the teacher has the latest submissions to grade
        await syncGradingData();

        const remainingCount = await db.offlineSubmissions
            .where('status')
            .equals('pending')
            .count();

        notifyListeners({
            isSyncing: false,
            pendingCount: remainingCount,
            lastSyncAt: new Date(),
            error: null,
            syncingSchools: false,
            syncingAssessments: false
        });

    } catch (error) {
        notifyListeners({
            isSyncing: false,
            pendingCount: await db.offlineSubmissions.where('status').equals('pending').count(),
            lastSyncAt: null,
            error: error instanceof Error ? error.message : 'Sync failed',
            syncingSchools: false,
            syncingAssessments: false
        });
    } finally {
        isSyncing = false;
    }
}

async function syncSchools(): Promise<void> {
    try {
        // Get teacher session for RBAC filtering
        const session = await db.table('teacherSession').get(1);

        // Build URL with RBAC params
        const params = new URLSearchParams();
        if (session) {
            params.set('userId', String(session.userId));
            params.set('role', session.role);
        } else {
            params.set('all', 'true');
        }

        const response = await fetch(`/api/schools?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch schools: ${response.status}`);
        }

        const schools: CachedSchool[] = await response.json();
        await cacheSchools(schools);
    } catch (error) {
        console.error('[Sync] Failed to sync schools:', error);
    }
}

async function syncAssessments(): Promise<CachedAssessment[]> {
    // Get teacher session for RBAC filtering
    const session = await db.table('teacherSession').get(1);

    // Build URL with RBAC params
    const params = new URLSearchParams();
    if (session) {
        params.set('userId', String(session.userId));
        params.set('role', session.role);
    }

    const response = await fetch(`/api/assessments${params.toString() ? '?' + params.toString() : ''}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch assessments: ${response.status}`);
    }

    const assessments: CachedAssessment[] = await response.json();
    await cacheAssessments(assessments);
    return assessments;
}

/**
 * Sync grading data (submissions to be graded)
 * Fetches all pending submissions for the logged-in teacher and caches them.
 */
export async function syncGradingData(): Promise<void> {
    try {
        const session = await db.table('teacherSession').get(1);
        if (!session) return;

        const response = await fetch(`/api/grading?teacherId=${session.userId}`);
        if (!response.ok) return;

        const data = await response.json();

        // Use dynamic import to avoid circular dependency if possible, or just duplicate mapped logic?
        // Better to import the types and helper from db.ts. 
        // Note: We need to import cacheSyncedSubmissions from db.ts
        const { cacheSyncedSubmissions } = await import('./db');

        const syncedSubs = data.submissions.map((sub: any) => ({
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

        await cacheSyncedSubmissions(syncedSubs);

        // Cache images for offline viewing
        const { cacheImage } = await import('./db');

        // Process sequentially to avoid overwhelming network/db
        for (const sub of syncedSubs) {
            for (const ans of sub.subjectiveAnswers) {
                if (ans.answerImageUrl) {
                    try {
                        const imgRes = await fetch(ans.answerImageUrl);
                        if (imgRes.ok) {
                            const blob = await imgRes.blob();
                            await cacheImage(ans.answerImageUrl, blob);
                        }
                    } catch (e) {
                        console.warn('[Sync] Failed to cache image:', ans.answerImageUrl);
                        // Ignore failure - image just won't be cached
                    }
                }
            }
        }

        console.log('[Sync] Grading data synced:', syncedSubs.length);

    } catch (error) {
        console.error('[Sync] Failed to sync grading data:', error);
    }
}

async function syncSubmission(submission: OfflineSubmission): Promise<void> {
    const localId = submission.localId!;

    try {
        await updateSubmissionStatus(localId, 'syncing');

        const updatedAnswers = await uploadPendingImages(submission);

        // Attach offline grades if present (stored with negative IDs for offline submissions)
        const offlineGrades = await db.offlineGrades.where('submissionId').equals(-localId).toArray();
        for (const grade of offlineGrades) {
            const questionId = -grade.answerId;
            if (updatedAnswers[questionId]) {
                (updatedAnswers[questionId] as any).marksAwarded = grade.marks;
            }
        }

        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assessmentId: submission.formId,
                clientSubmissionId: submission.clientSubmissionId,
                schoolId: submission.schoolId,
                studentFirstName: submission.studentFirstName,
                studentLastName: submission.studentLastName,
                selectedLanguage: submission.selectedLanguage,
                geolocation: submission.geolocation,
                gender: submission.gender,
                classGrade: submission.classGrade,
                section: submission.section,
                answers: updatedAnswers,
                submittedByTeacher: submission.submittedByTeacher || null
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Server error: ${error}`);
        }

        const result = await response.json();
        await updateSubmissionStatus(localId, 'synced', result.submissionId);

        // Clean up temporary offline grades
        if (offlineGrades.length > 0) {
            await db.offlineGrades.where('submissionId').equals(-localId).delete();
        }

    } catch (error) {
        await updateSubmissionStatus(
            localId,
            'failed',
            undefined,
            error instanceof Error ? error.message : 'Unknown error'
        );
    }
}

async function uploadPendingImages(
    submission: OfflineSubmission
): Promise<Record<number, { text?: string; selectedOptions?: number[]; rankingOrder?: number[]; imageUrl?: string }>> {
    const pendingImages = await getPendingImagesForSubmission(submission.localId!);
    const updatedAnswers = { ...submission.answers };

    for (const image of pendingImages) {
        if (image.status === 'uploaded' && image.cloudinaryUrl) {
            updatedAnswers[image.questionId] = {
                ...updatedAnswers[image.questionId],
                imageUrl: image.cloudinaryUrl
            };
            continue;
        }

        try {
            await updateImageStatus(image.localId!, 'uploading');

            const formData = new FormData();
            formData.append('file', image.imageBlob, image.fileName);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status}`);
            }

            const result = await response.json();

            await updateImageStatus(image.localId!, 'uploaded', result.url);
            updatedAnswers[image.questionId] = {
                ...updatedAnswers[image.questionId],
                imageUrl: result.url
            };

        } catch (error) {
            await updateImageStatus(image.localId!, 'failed');
            throw error;
        }
    }

    return updatedAnswers;
}

/**
 * Push offline grades to server
 * Should be called BEFORE fetching new data to prevent overwrite.
 */
async function pushOfflineGrades(): Promise<void> {
    try {
        const pendingGrades = await getPendingOfflineGrades();
        if (pendingGrades.length === 0) return;

        const session = await db.table('teacherSession').get(1);
        if (!session) return; // Can't sync without user ID

        // Group by submission
        const gradesBySubmission: Record<number, Record<number, number>> = {};
        for (const grade of pendingGrades) {
            if (!gradesBySubmission[grade.submissionId]) {
                gradesBySubmission[grade.submissionId] = {};
            }
            gradesBySubmission[grade.submissionId][grade.answerId] = grade.marks;
        }

        // Gather status for each submission
        const completionStatus: Record<number, string> = {};
        const submissionIds = Object.keys(gradesBySubmission).map(Number);

        for (const subId of submissionIds) {
            const sub = await db.syncedSubmissions.get(subId);
            if (sub) {
                completionStatus[subId] = sub.status; // 'pending' or 'graded'
            }
        }

        const response = await fetch('/api/grading', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grades: gradesBySubmission,
                completionStatus,
                graderId: session.userId
            })
        });

        if (response.ok) {
            await markGradesAsSynced(pendingGrades.map(g => g.id!));
            console.log('[Sync] Offline grades pushed:', pendingGrades.length);
        } else {
            console.error('[Sync] Failed to push grades:', response.status);
        }
    } catch (error) {
        console.error('[Sync] Failed to push grades:', error);
    }
}

function notifyListeners(status: SyncStatus): void {
    syncCallbacks.forEach(callback => callback(status));
}
