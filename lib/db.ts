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
    formId: number;           // assessment_id
    formVersion: string;
    schoolId: number;
    studentFirstName: string;
    studentLastName: string;
    selectedLanguage: string;
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
}

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

// ============ DATABASE DEFINITION ============

class FormDatabase extends Dexie {
    cachedForms!: EntityTable<CachedForm, 'formId'>;
    cachedSchools!: EntityTable<CachedSchool, 'school_id'>;
    cachedAssessments!: EntityTable<CachedAssessment, 'assessment_id'>;
    offlineSubmissions!: EntityTable<OfflineSubmission, 'localId'>;
    pendingImages!: EntityTable<PendingImage, 'localId'>;
    syncMeta!: EntityTable<SyncMeta, 'key'>;

    constructor() {
        super('FormAppDB');

        this.version(2).stores({
            cachedForms: 'formId, cachedAt',
            cachedSchools: 'school_id, intervention, udise_code',
            cachedAssessments: 'assessment_id, class_grade, group_identifier',
            offlineSubmissions: '++localId, formId, status, createdAt',
            pendingImages: '++localId, submissionLocalId, questionId, status',
            syncMeta: 'key'
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
    await db.cachedForms.put({
        formId: formData.assessment_id,
        formData,
        cachedAt: new Date(),
        version: new Date().toISOString()
    });
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
    submission: Omit<OfflineSubmission, 'localId' | 'createdAt' | 'syncedAt' | 'serverSubmissionId' | 'errorMessage'>
): Promise<number> {
    const localId = await db.offlineSubmissions.add({
        ...submission,
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
