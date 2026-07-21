/**
 * Dynamic Form Page
 * 
 * Displays and handles submission of a specific assessment form.
 * Route: /forms/[id]
 */

'use client';

import React, { useState, useEffect, use, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormRenderer } from '@/components/FormRenderer';
import { OfflineStatus } from '@/components/OfflineStatus';
import { getCachedForm, type FormData } from '@/lib/db';
import { initSyncListeners, isOnline, triggerSync, checkActualConnectivity } from '@/lib/sync';

interface PageProps {
    params: Promise<{ id: string }>;
}

function FormPageContent({ params }: PageProps) {
    const { id } = use(params);
    const router = useRouter();
    const searchParams = useSearchParams();
    const selectedLanguage = searchParams ? (searchParams.get('lang') || 'English') : 'English';

    const [rawFormData, setRawFormData] = useState<FormData | null>(null);
    const [formData, setFormData] = useState<FormData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [submissionResult, setSubmissionResult] = useState<{
        success: boolean;
        id: string | number;
        isOffline: boolean;
    } | null>(null);

    // Initialize sync listeners on mount
    useEffect(() => {
        initSyncListeners();

        // Trigger initial sync to cache schools
        if (isOnline()) {
            triggerSync().catch(console.error);
        }
    }, []);

    // Apply translations whenever rawFormData or selectedLanguage changes
    useEffect(() => {
        if (!rawFormData) {
            setFormData(null);
            return;
        }

        if (!selectedLanguage || selectedLanguage === 'English') {
            setFormData(rawFormData);
            return;
        }

        const translated: FormData = {
            ...rawFormData,
            sections: rawFormData.sections.map((section) => {
                const secTrans = section.translations?.[selectedLanguage];
                return {
                    ...section,
                    section_title: secTrans?.section_title || section.section_title,
                    section_instructions: secTrans?.section_instructions !== undefined 
                        ? secTrans.section_instructions 
                        : section.section_instructions,
                    questions: section.questions.map((q) => {
                        const qTrans = q.translations?.[selectedLanguage];
                        return {
                            ...q,
                            question_text: qTrans?.question_text || q.question_text,
                            options: q.options.map((opt) => {
                                const optTrans = opt.translations?.[selectedLanguage];
                                return {
                                    ...opt,
                                    option_text: optTrans?.option_text || opt.option_text
                                };
                            })
                        };
                    })
                };
            })
        };
        setFormData(translated);
    }, [rawFormData, selectedLanguage]);

    // Fetch form data — cache-first strategy
    useEffect(() => {
        async function loadForm() {
            setLoading(true);
            setError(null);

            const assessmentId = parseInt(id, 10);
            if (isNaN(assessmentId)) {
                setError('Invalid form ID');
                setLoading(false);
                return;
            }

            try {
                // Step 1: Try cache immediately (no network wait)
                const cached = await getCachedForm(assessmentId);

                if (cached) {
                    // Show cached form instantly
                    setRawFormData(cached.formData);
                    setLoading(false);

                    // Background refresh: fetch from API if online, update cache silently
                    checkActualConnectivity().then(async (online) => {
                        if (!online) return;
                        try {
                            const response = await fetch(`/api/forms/${assessmentId}`);
                            if (response.ok) {
                                const data = await response.json();
                                setRawFormData(data);
                                // Update cache in background
                                const { cacheForm } = await import('@/lib/db');
                                cacheForm(data).catch(console.error);
                            }
                        } catch {
                            // Ignore — we already have the cached version showing
                        }
                    });
                    return;
                }

                // Step 2: No cache — must fetch from network
                const online = await checkActualConnectivity();

                if (online) {
                    const response = await fetch(`/api/forms/${assessmentId}`);

                    if (response.ok) {
                        const data = await response.json();
                        setRawFormData(data);
                    } else if (response.status === 404) {
                        setError('Form not found');
                    } else {
                        const data = await response.json().catch(() => null);
                        setError(data?.error || `Failed to load form (${response.status}). Please try again.`);
                    }
                } else {
                    setError('Form not available offline. Please save it for offline use while online.');
                }
            } catch (err) {
                console.error('Error loading form:', err);
                setError('Failed to load form. Please try again.');
            } finally {
                setLoading(false);
            }
        }

        loadForm();
    }, [id]);

    // Handle form completion
    const handleComplete = (submissionId: number | string) => {
        const isOffline = String(submissionId).startsWith('offline-');
        setSubmissionResult({
            success: true,
            id: submissionId,
            isOffline
        });
    };

    // Handle submitting another assessment
    const handleSubmitAnother = () => {
        router.push('/');
    };

    // Loading state
    if (loading) {
        return (
            <div className="page-container">
                <OfflineStatus />
                <div className="loading-container">
                    <div className="loading-spinner" />
                    <p>Loading form...</p>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="page-container">
                <OfflineStatus />
                <div className="error-page">
                    <h1 className="flex items-center justify-center gap-2 text-error">
                        <span className="material-symbols-rounded text-3xl">error</span>
                        Error
                    </h1>
                    <p className="error-message">{error}</p>
                    <button onClick={() => router.push('/')} className="back-button flex items-center justify-center gap-2">
                        <span className="material-symbols-rounded">arrow_back</span>
                        Back to Home
                    </button>
                </div>
            </div>
        );
    }

    // Submission complete state
    if (submissionResult) {
        return (
            <div className="page-container">
                <OfflineStatus />
                <div className="completion-container">
                    <div className="completion-card">
                        <h1 className="completion-title flex items-center justify-center gap-2">
                            <span className="material-symbols-rounded text-success text-3xl">check_circle</span>
                            Assessment Submitted!
                        </h1>

                        {submissionResult.isOffline ? (
                            <>
                                <p className="completion-message">
                                    Your submission has been saved locally and will be synced when you&apos;re back online.
                                </p>
                                <p className="completion-id">
                                    Local ID: {submissionResult.id}
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="completion-message">
                                    Your submission has been recorded successfully.
                                </p>
                                <p className="completion-id">
                                    Submission ID: #{submissionResult.id}
                                </p>
                            </>
                        )}

                        <button onClick={handleSubmitAnother} className="submit-button primary flex items-center justify-center gap-2">
                            Submit Another Assessment
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Form rendering
    if (!formData) {
        return null;
    }

    return (
        <div className="page-container">
            <OfflineStatus />
            <FormRenderer
                formData={formData}
                rawFormData={rawFormData!}
                selectedLanguage={selectedLanguage}
                onComplete={handleComplete}
            />
        </div>
    );
}

export default function FormPage(props: PageProps) {
    return (
        <Suspense fallback={
            <div className="page-container">
                <div className="loading-container">
                    <div className="loading-spinner" />
                    <p>Loading form...</p>
                </div>
            </div>
        }>
            <FormPageContent {...props} />
        </Suspense>
    );
}
