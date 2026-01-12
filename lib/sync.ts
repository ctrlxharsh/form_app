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

// ============ INTERNAL SYNC LOGIC ============

async function handleOnline(): Promise<void> {
    await performSync();
}

async function handleFocus(): Promise<void> {
    if (navigator.onLine && !isSyncing) {
        await performSync();
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
        const response = await fetch('/api/schools?all=true');
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
    const response = await fetch('/api/assessments');
    if (!response.ok) {
        throw new Error(`Failed to fetch assessments: ${response.status}`);
    }

    const assessments: CachedAssessment[] = await response.json();
    await cacheAssessments(assessments);
    return assessments;
}

async function syncSubmission(submission: OfflineSubmission): Promise<void> {
    const localId = submission.localId!;

    try {
        await updateSubmissionStatus(localId, 'syncing');

        const updatedAnswers = await uploadPendingImages(submission);

        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assessmentId: submission.formId,
                schoolId: submission.schoolId,
                studentFirstName: submission.studentFirstName,
                studentLastName: submission.studentLastName,
                selectedLanguage: submission.selectedLanguage,
                geolocation: submission.geolocation,
                gender: submission.gender,
                classGrade: submission.classGrade,
                section: submission.section,
                answers: updatedAnswers
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Server error: ${error}`);
        }

        const result = await response.json();
        await updateSubmissionStatus(localId, 'synced', result.submissionId);

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

function notifyListeners(status: SyncStatus): void {
    syncCallbacks.forEach(callback => callback(status));
}
