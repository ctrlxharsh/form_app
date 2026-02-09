/**
 * IndexedDB Setup with Dexie.js
 * 
 * This module manages all offline storage for the form app:
 * - cachedForms: Form definitions fetched from server, cached for offline use
 * - cachedSchools: Schools table cached locally for offline UDISE validation
 * - cachedAssessments: Assessment list for homepage
 * - offlineSubmissions: Form submissions created while offline
 * - pendingImages: Images queued for upload to Cloudinary
 * - syncMeta: Metadata about last sync times
 */

import Dexie, { type EntityTable } from 'dexie';

// ============ TYPE DEFINITIONS ============

/** Cached form structure for offline access */
export interface CachedForm {
    formId: number;           // assessment_id from PostgreSQL
    formData: FormData;       // Complete form structure with sections/questions
    cachedAt: Date;
    version: string;          // For cache invalidation
}

/** Complete form data structure */
export interface FormData {
    assessment_id: number;
    title: string;
    description: string | null;
    class_grade: number;
    status: string;
    language?: string;
    group_identifier?: string;
    academic_year?: string;
    total_marks?: number;
    sections: FormSection[];
}

export interface FormSection {
    section_id: number;
    section_title: string;
    section_instructions: string | null;
    order_index: number;
    questions: FormQuestion[];
}

export interface FormQuestion {
    question_id: number;
    question_type: QuestionType;
    question_text: string;
    question_image_url: string | null;
    marks: number | null;
    parameter_mapping?: string | null;
    is_required: boolean;
    order_index: number;
    correct_answer: string | null;
    min_value: number | null;
    max_value: number | null;
    options: QuestionOption[];
}

export type QuestionType =
    | 'mcq'
    | 'multiple_select'
    | 'fill_blank'
    | 'true_false'
    | 'range'
    | 'short_answer'
    | 'long_answer'
    | 'numerical'
    | 'ranking'
    | 'image_upload';

export interface QuestionOption {
    option_id: number;
    option_text: string;
    option_image_url: string | null;
    is_correct: boolean;
    marks?: number;
    order_index: number;
}

/** Cached school for offline UDISE validation */
export interface CachedSchool {
    school_id: number;
    school_name: string;
    udise_code: string;
    local_education_admin: string;
    state: string;
    district: string;
    intervention: 'Prototype' | 'Propagate';
}

/** Cached assessment for homepage */
export interface CachedAssessment {
    assessment_id: number;
    title: string;
    description: string | null;
    class_grade: number;
    language?: string;
    group_identifier?: string;
    academic_year?: string;
}

/** Offline submission awaiting sync */
export interface OfflineSubmission {
    localId?: number;         // Auto-incremented local ID
    clientSubmissionId: string; // UUID for deduplication
    formId: number;           // assessment_id
    formVersion: string;
    schoolId: number;
    studentFirstName: string;
    studentLastName: string;
    selectedLanguage: string;
    totalMarks?: number;
    geolocation?: string | null;
    gender: 'Male' | 'Female';
    classGrade: number;
    section: string;
    answers: Record<number, AnswerData>;
    status: 'pending' | 'syncing' | 'synced' | 'failed';
    createdAt: Date;
    syncedAt: Date | null;
    serverSubmissionId: number | null;
    errorMessage: string | null;
    submittedByTeacher?: number;  // User ID of teacher who submitted
}

// ... (AnswerData, PendingImage, SyncMeta, etc. remain unchanged)

// ... (AnswerData, PendingImage, SyncMeta, etc. remain unchanged)

/** Answer data structure matching the original Streamlit logic */
export interface AnswerData {
    text?: string;                // For text-based answers
    selectedOptions?: number[];   // For MCQ/multiple select
    rankingOrder?: number[];      // For ranking questions
    localImageId?: number;        // Reference to pendingImages table
    imageUrl?: string;            // Cloudinary URL after upload
}

/** Image pending upload to Cloudinary */
export interface PendingImage {
    localId?: number;             // Auto-incremented local ID
    submissionLocalId: number;    // Reference to offlineSubmissions
    questionId: number;
    imageBlob: Blob;
    fileName: string;
    status: 'pending' | 'uploading' | 'uploaded' | 'failed';
    cloudinaryUrl: string | null;
    createdAt: Date;
}

/** Sync metadata */
export interface SyncMeta {
    key: string;
    lastSyncAt: Date;
}

/** Teacher session for persistent login */
export interface TeacherSession {
    id: number;               // Always 1 (singleton)
    userId: number;
    username: string;
    fullName: string;
    role: string;
    passwordHash: string;     // Original hash from DB
    storedPassword: string;   // Encrypted password for offline verification
    canEdit: boolean;
    loggedInAt: Date;
}

/** Synced submission cached for offline grading */
export interface SyncedSubmission {
    submissionId: number;     // Server submission ID
    studentFirstName: string;
    studentLastName: string;
    classGrade: number;
    section: string;
    submittedAt: Date;
    status: 'pending' | 'graded';
    marksObtained: number | null;
    assessmentId: number;
    assessmentTitle: string;
    submittedByTeacher: number;
    subjectiveAnswers: SyncedAnswer[];
    cachedAt: Date;
}

export interface SyncedAnswer {
    answerId: number;
    questionId: number;
    answerText: string | null;
    answerImageUrl: string | null;
    marksAwarded: number | null;
    questionText: string;
    questionType: string;
    maxMarks: number;
}

/** Offline grade pending sync */
export interface OfflineGrade {
    id?: number;
    submissionId: number;
    answerId: number;
    marks: number;
    gradedAt: Date;
    synced: boolean;
}

/** User credentials cached for offline login */
export interface KnownUser {
    userId: number;
    username: string;
    fullName: string;
    role: string;
    passwordHash: string;
    storedPassword: string;
    canEdit: boolean;
    lastLoginAt: Date;
}

export interface CachedImage {
    url: string;
    blob: Blob;
    cachedAt: Date;
}

// ============ DATABASE DEFINITION ============

class FormDatabase extends Dexie {
    cachedForms!: EntityTable<CachedForm, 'formId'>;
    cachedSchools!: EntityTable<CachedSchool, 'school_id'>;
    cachedAssessments!: EntityTable<CachedAssessment, 'assessment_id'>;
    offlineSubmissions!: EntityTable<OfflineSubmission, 'localId'>;
    pendingImages!: EntityTable<PendingImage, 'localId'>;
    syncMeta!: EntityTable<SyncMeta, 'key'>;
    teacherSession!: EntityTable<TeacherSession, 'id'>;
    syncedSubmissions!: EntityTable<SyncedSubmission, 'submissionId'>;
    offlineGrades!: EntityTable<OfflineGrade, 'id'>;
    knownUsers!: EntityTable<KnownUser, 'userId'>;
    cachedImages!: EntityTable<CachedImage, 'url'>;

    constructor() {
        super('FormAppDB');


        // Version 2: Original schema
        this.version(2).stores({
            cachedForms: 'formId, cachedAt',
            cachedSchools: 'school_id, intervention, udise_code',
            cachedAssessments: 'assessment_id, class_grade, group_identifier',
            offlineSubmissions: '++localId, formId, status, createdAt',
            pendingImages: '++localId, submissionLocalId, questionId, status',
            syncMeta: 'key'
        });

        // Version 3: Add teacher session and submittedByTeacher index
        this.version(3).stores({
            cachedForms: 'formId, cachedAt',
            cachedSchools: 'school_id, intervention, udise_code',
            cachedAssessments: 'assessment_id, class_grade, group_identifier',
            offlineSubmissions: '++localId, formId, status, createdAt, submittedByTeacher',
            pendingImages: '++localId, submissionLocalId, questionId, status',
            syncMeta: 'key',
            teacherSession: 'id'
        });

        // Version 4: Add synced submissions and offline grades for offline grading
        this.version(4).stores({
            cachedForms: 'formId, cachedAt',
            cachedSchools: 'school_id, intervention, udise_code',
            cachedAssessments: 'assessment_id, class_grade, group_identifier',
            offlineSubmissions: '++localId, formId, status, createdAt, submittedByTeacher',
            pendingImages: '++localId, submissionLocalId, questionId, status',
            syncMeta: 'key',
            teacherSession: 'id',
            syncedSubmissions: 'submissionId, submittedByTeacher, assessmentId',
            offlineGrades: '++id, submissionId, answerId, synced'
        });

        // Version 5: Add knownUsers for offline login cache
        this.version(5).stores({
            cachedForms: 'formId, cachedAt',
            cachedSchools: 'school_id, intervention, udise_code',
            cachedAssessments: 'assessment_id, class_grade, group_identifier',
            offlineSubmissions: '++localId, formId, status, createdAt, submittedByTeacher',
            pendingImages: '++localId, submissionLocalId, questionId, status',
            syncMeta: 'key',
            teacherSession: 'id',
            syncedSubmissions: 'submissionId, submittedByTeacher, assessmentId',
            offlineGrades: '++id, submissionId, answerId, synced',
            knownUsers: 'userId, username'
        });

        // Version 6: Add cachedImages for offline grading of images
        this.version(6).stores({
            cachedForms: 'formId, cachedAt',
            cachedSchools: 'school_id, intervention, udise_code',
            cachedAssessments: 'assessment_id, class_grade, group_identifier',
            offlineSubmissions: '++localId, formId, status, createdAt, submittedByTeacher',
            pendingImages: '++localId, submissionLocalId, questionId, status',
            syncMeta: 'key',
            teacherSession: 'id',
            syncedSubmissions: 'submissionId, submittedByTeacher, assessmentId',
            offlineGrades: '++id, submissionId, answerId, synced',
            knownUsers: 'userId, username',
            cachedImages: 'url'
        });

        // Version 7: Add compound indexes for efficient querying
        this.version(7).stores({
            cachedForms: 'formId, cachedAt',
            cachedSchools: 'school_id, intervention, udise_code',
            cachedAssessments: 'assessment_id, class_grade, group_identifier',
            offlineSubmissions: '++localId, formId, status, createdAt, submittedByTeacher',
            pendingImages: '++localId, submissionLocalId, questionId, status',
            syncMeta: 'key',
            teacherSession: 'id',
            syncedSubmissions: 'submissionId, submittedByTeacher, assessmentId, [submittedByTeacher+assessmentId]',
            offlineGrades: '++id, submissionId, answerId, synced, [submissionId+answerId]',
            knownUsers: 'userId, username',
            cachedImages: 'url'
        });
    }
}

// Singleton instance
export const db = new FormDatabase();

// ============ SYNC METADATA HELPERS ============

const SCHOOLS_SYNC_KEY = 'schools_last_sync';
const SCHOOLS_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if schools need to be synced (once per day)
 */
export async function shouldSyncSchools(): Promise<boolean> {
    const meta = await db.syncMeta.get(SCHOOLS_SYNC_KEY);
    if (!meta) return true;

    const elapsed = Date.now() - meta.lastSyncAt.getTime();
    return elapsed >= SCHOOLS_SYNC_INTERVAL_MS;
}

// ============ USER CACHING ============

/**
 * Save user credentials for offline login
 */
export async function saveKnownUser(user: KnownUser) {
    await db.knownUsers.put(user);
}

/**
 * Get known user for offline login verification
 */
export async function getKnownUser(username: string): Promise<KnownUser | undefined> {
    return await db.knownUsers.where('username').equals(username).first();
}

/**
 * Mark schools as synced
 */
export async function markSchoolsSynced(): Promise<void> {
    await db.syncMeta.put({
        key: SCHOOLS_SYNC_KEY,
        lastSyncAt: new Date()
    });
}

/**
 * Get last schools sync time
 */
export async function getLastSchoolsSyncTime(): Promise<Date | null> {
    const meta = await db.syncMeta.get(SCHOOLS_SYNC_KEY);
    return meta?.lastSyncAt ?? null;
}

// ============ FORM HELPERS ============

export async function cacheForm(formData: FormData): Promise<void> {
    // 1. Cache the form definition
    await db.cachedForms.put({
        formId: formData.assessment_id,
        formData,
        cachedAt: new Date(),
        version: new Date().toISOString()
    });

    // 2. Identify all images to cache
    const urlsToCache = new Set<string>();

    for (const section of formData.sections) {
        for (const question of section.questions) {
            if (question.question_image_url) {
                urlsToCache.add(question.question_image_url);
            }
            if (question.options) {
                for (const option of question.options) {
                    if (option.option_image_url) {
                        urlsToCache.add(option.option_image_url);
                    }
                }
            }
        }
    }

    // 3. Fetch and store images
    // We execute these in parallel but with a concurrency limit if needed? 
    // For now, Promise.all is likely fine for typical forms (10-50 images).
    const fetchPromises = Array.from(urlsToCache).map(async (url) => {
        try {
            // Check if already cached to avoid re-fetching
            const existing = await db.cachedImages.get(url);
            if (existing) return;

            const response = await fetch(url, { mode: 'cors' });
            if (!response.ok) throw new Error(`Failed to fetch ${url}`);
            const blob = await response.blob();

            await db.cachedImages.put({
                url,
                blob,
                cachedAt: new Date()
            });
            console.log(`[Cache] Cached image: ${url}`);
        } catch (err) {
            console.error(`[Cache] Failed to cache image ${url}:`, err);
            // We continue even if one fails
        }
    });

    await Promise.all(fetchPromises);
}

export async function getCachedForm(formId: number): Promise<CachedForm | undefined> {
    return db.cachedForms.get(formId);
}

export async function getAllCachedForms(): Promise<CachedForm[]> {
    return db.cachedForms.toArray();
}

export async function removeCachedForm(formId: number): Promise<void> {
    await db.cachedForms.delete(formId);
}

// ============ SCHOOLS HELPERS ============

export async function cacheSchools(schools: CachedSchool[]): Promise<void> {
    await db.transaction('rw', db.cachedSchools, async () => {
        await db.cachedSchools.clear();
        await db.cachedSchools.bulkPut(schools);
    });
    await markSchoolsSynced();
}

export async function getCachedSchoolsByIntervention(
    intervention: 'Prototype' | 'Propagate'
): Promise<CachedSchool[]> {
    return db.cachedSchools.where('intervention').equals(intervention).toArray();
}

export async function validateSchoolUdiseOffline(
    schoolId: number,
    udiseCode: string
): Promise<boolean> {
    const school = await db.cachedSchools.get(schoolId);
    return school?.udise_code === udiseCode;
}

export async function hasSchoolsCache(): Promise<boolean> {
    const count = await db.cachedSchools.count();
    return count > 0;
}

// ============ ASSESSMENTS HELPERS ============

export async function cacheAssessments(assessments: CachedAssessment[]): Promise<void> {
    await db.transaction('rw', db.cachedAssessments, async () => {
        await db.cachedAssessments.clear();
        await db.cachedAssessments.bulkPut(assessments);
    });
}

export async function getCachedAssessments(): Promise<CachedAssessment[]> {
    return db.cachedAssessments.orderBy('class_grade').toArray();
}

export async function getCachedAssessmentsByClass(classGrade: number): Promise<CachedAssessment[]> {
    return db.cachedAssessments.where('class_grade').equals(classGrade).toArray();
}

// ============ SUBMISSION HELPERS ============

export async function createOfflineSubmission(
    submission: Omit<OfflineSubmission, 'localId' | 'clientSubmissionId' | 'createdAt' | 'syncedAt' | 'serverSubmissionId' | 'errorMessage'>
): Promise<number> {
    const localId = await db.offlineSubmissions.add({
        ...submission,
        clientSubmissionId: crypto.randomUUID(),
        createdAt: new Date(),
        syncedAt: null,
        serverSubmissionId: null,
        errorMessage: null
    });
    return localId as number;
}

export async function getPendingSubmissions(): Promise<OfflineSubmission[]> {
    return db.offlineSubmissions
        .where('status')
        .equals('pending')
        .toArray();
}

export async function updateSubmissionStatus(
    localId: number,
    status: OfflineSubmission['status'],
    serverSubmissionId?: number,
    errorMessage?: string
): Promise<void> {
    await db.offlineSubmissions.update(localId, {
        status,
        syncedAt: status === 'synced' ? new Date() : null,
        serverSubmissionId: serverSubmissionId ?? null,
        errorMessage: errorMessage ?? null
    });
}

export async function getPendingSubmissionCount(): Promise<number> {
    return db.offlineSubmissions
        .where('status')
        .equals('pending')
        .count();
}

export async function saveSubmissionWithImages(
    submission: Omit<OfflineSubmission, 'localId' | 'clientSubmissionId' | 'createdAt' | 'syncedAt' | 'serverSubmissionId' | 'errorMessage'>,
    images: { questionId: number; file: File }[]
): Promise<number> {
    return db.transaction('rw', db.offlineSubmissions, db.pendingImages, async () => {
        const localId = await db.offlineSubmissions.add({
            ...submission,
            clientSubmissionId: crypto.randomUUID(),
            createdAt: new Date(),
            syncedAt: null,
            serverSubmissionId: null,
            errorMessage: null
        });

        const imageRecords = images.map(img => ({
            submissionLocalId: localId as number,
            questionId: img.questionId,
            imageBlob: img.file,
            fileName: img.file.name,
            status: 'pending' as const,
            cloudinaryUrl: null,
            createdAt: new Date()
        }));

        if (imageRecords.length > 0) {
            await db.pendingImages.bulkAdd(imageRecords as any);
        }

        return localId as number;
    });
}

// ============ IMAGE HELPERS ============

export async function queueImageForUpload(
    submissionLocalId: number,
    questionId: number,
    imageBlob: Blob,
    fileName: string
): Promise<number> {
    const localId = await db.pendingImages.add({
        submissionLocalId,
        questionId,
        imageBlob,
        fileName,
        status: 'pending',
        cloudinaryUrl: null,
        createdAt: new Date()
    });
    return localId as number;
}

export async function getPendingImagesForSubmission(
    submissionLocalId: number
): Promise<PendingImage[]> {
    return db.pendingImages
        .where('submissionLocalId')
        .equals(submissionLocalId)
        .toArray();
}

export async function updateImageStatus(
    localId: number,
    status: PendingImage['status'],
    cloudinaryUrl?: string
): Promise<void> {
    await db.pendingImages.update(localId, {
        status,
        cloudinaryUrl: cloudinaryUrl ?? null
    });
}

// ============ GRADING HELPERS ============

/**
 * Cache submissions from server for offline grading
 */
export async function cacheSyncedSubmissions(
    submissions: SyncedSubmission[]
): Promise<void> {
    await db.syncedSubmissions.bulkPut(submissions);
}

/**
 * Get cached submissions for a teacher
 */
export async function getCachedSubmissionsForTeacher(
    teacherId: number,
    assessmentId?: number
): Promise<SyncedSubmission[]> {
    if (assessmentId) {
        return db.syncedSubmissions
            .where('[submittedByTeacher+assessmentId]')
            .equals([teacherId, assessmentId])
            .toArray();
    }
    return db.syncedSubmissions
        .where('submittedByTeacher')
        .equals(teacherId)
        .toArray();
}

/**
 * Get unique assessments from cached submissions AND offline submissions
 */
export async function getCachedAssessmentsForTeacher(
    teacherId: number
): Promise<{ assessmentId: number; title: string }[]> {
    const seen = new Map<number, string>();

    // 1. Get from synced submissions (previously cached from server)
    const syncedSubmissions = await db.syncedSubmissions
        .where('submittedByTeacher')
        .equals(teacherId)
        .toArray();

    for (const sub of syncedSubmissions) {
        if (!seen.has(sub.assessmentId)) {
            seen.set(sub.assessmentId, sub.assessmentTitle);
        }
    }

    // 2. Get from offline submissions (pending sync)
    const offlineSubs = await db.offlineSubmissions
        .where('submittedByTeacher')
        .equals(teacherId)
        .filter(s => s.status === 'pending')
        .toArray();

    for (const sub of offlineSubs) {
        if (!seen.has(sub.formId)) {
            // Get form title from cached forms
            const form = await db.cachedForms.get(sub.formId);
            if (form) {
                seen.set(sub.formId, form.formData.title);
            }
        }
    }

    return Array.from(seen.entries()).map(([assessmentId, title]) => ({
        assessmentId,
        title
    }));
}

/**
 * Save an offline grade
 */
export async function saveOfflineGrade(
    submissionId: number,
    answerId: number,
    marks: number
): Promise<void> {
    // Check if grade already exists
    const existing = await db.offlineGrades
        .where('[submissionId+answerId]')
        .equals([submissionId, answerId])
        .first();

    if (existing) {
        await db.offlineGrades.update(existing.id!, {
            marks,
            gradedAt: new Date(),
            synced: false
        });
    } else {
        await db.offlineGrades.add({
            submissionId,
            answerId,
            marks,
            gradedAt: new Date(),
            synced: false
        });
    }

    // Also update the cached submission's answer
    const submission = await db.syncedSubmissions.get(submissionId);
    if (submission) {
        const updatedAnswers = submission.subjectiveAnswers.map(ans =>
            ans.answerId === answerId ? { ...ans, marksAwarded: marks } : ans
        );
        await db.syncedSubmissions.update(submissionId, {
            subjectiveAnswers: updatedAnswers
        });
    }
}

/**
 * Get pending (unsynced) offline grades
 */
export async function getPendingOfflineGrades(): Promise<OfflineGrade[]> {
    return db.offlineGrades
        .where('synced')
        .equals(0)  // false is stored as 0
        .toArray();
}

/**
 * Mark grades as synced
 */
export async function markGradesAsSynced(gradeIds: number[]): Promise<void> {
    for (const id of gradeIds) {
        await db.offlineGrades.update(id, { synced: true });
    }
}

/**
 * Get unique submission IDs that have pending (unsynced) grades
 */
export async function getSubmissionIdsWithPendingGrades(): Promise<Set<number>> {
    const pendingGrades = await db.offlineGrades
        .where('synced')
        .equals(0)
        .toArray();
    return new Set(pendingGrades.map(g => g.submissionId));
}

/**
 * Get offline grade for an answer
 */
export async function getOfflineGradeForAnswer(
    submissionId: number,
    answerId: number
): Promise<number | null> {
    const grade = await db.offlineGrades
        .where('[submissionId+answerId]')
        .equals([submissionId, answerId])
        .first();
    return grade?.marks ?? null;
}

/**
 * Get offline (unsynced) submissions formatted for grading UI
 * Shows ALL pending submissions (not just those with subjective questions)
 */
export async function getOfflineGradingSubmissions(teacherId: number): Promise<SyncedSubmission[]> {
    const offlineSubs = await db.offlineSubmissions
        .where('submittedByTeacher')
        .equals(teacherId)
        .filter(s => s.status === 'pending')
        .toArray();

    const result: SyncedSubmission[] = [];

    for (const sub of offlineSubs) {
        const form = await db.cachedForms.get(sub.formId);
        if (!form) continue;

        // Build question map
        const qMap = new Map<number, FormQuestion>();
        form.formData.sections.forEach(s => s.questions.forEach(q => qMap.set(q.question_id, q)));

        // Get grades
        const grades = await db.offlineGrades.where('submissionId').equals(-sub.localId!).toArray();
        const gradeMap = new Map(grades.map(g => [g.answerId, g.marks]));

        const subjectiveAnswers: SyncedAnswer[] = [];

        const answers = sub.answers as Record<string, any>; // Cast for access

        for (const [qIdStr, ansVal] of Object.entries(answers)) {
            const qId = parseInt(qIdStr);
            const qDef = qMap.get(qId);
            if (!qDef) continue;

            // Only include subjective questions for grading
            if (['short_answer', 'long_answer'].includes(qDef.question_type)) {
                subjectiveAnswers.push({
                    answerId: -qId, // NEGATIVE ID indicates offline/fake
                    questionId: qId,
                    answerText: ansVal.text || '',
                    answerImageUrl: ansVal.imageUrl || null,
                    marksAwarded: gradeMap.get(-qId) ?? null,
                    questionText: qDef.question_text,
                    questionType: qDef.question_type,
                    maxMarks: qDef.marks || 0
                });
            }
        }

        // Add ALL pending submissions (not just those with subjective answers)
        result.push({
            submissionId: -sub.localId!, // NEGATIVE ID indicates offline
            studentFirstName: sub.studentFirstName,
            studentLastName: sub.studentLastName,
            classGrade: sub.classGrade,
            section: sub.section,
            submittedAt: sub.createdAt,
            status: 'pending',
            marksObtained: null,
            assessmentId: sub.formId,
            assessmentTitle: form.formData.title,
            submittedByTeacher: teacherId,
            subjectiveAnswers, // May be empty if no subjective questions
            cachedAt: new Date()
        });
    }
    return result;
}

/**
 * Get count of submissions pending grading for a teacher
 */
export async function getPendingGradingCount(teacherId: number): Promise<number> {
    return db.syncedSubmissions
        .where('submittedByTeacher')
        .equals(teacherId)
        .filter(sub => sub.status === 'pending')
        .count();
}

// ============ IMAGE CACHING ============

export async function cacheImage(url: string, blob: Blob) {
    if (!url || !blob) return;
    try {
        await db.cachedImages.put({
            url,
            blob,
            cachedAt: new Date()
        });
    } catch (e) {
        console.warn('Failed to cache image:', url, e);
    }
}

export async function getCachedImageBlob(url: string): Promise<Blob | undefined> {
    if (!url) return undefined;
    try {
        const record = await db.cachedImages.get(url);
        return record?.blob;
    } catch {
        return undefined;
    }
}
