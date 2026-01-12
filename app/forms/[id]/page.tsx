/**
 * Dynamic Form Page
 * 
 * Displays and handles submission of a specific assessment form.
 * Route: /forms/[id]
 */

'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { FormRenderer } from '@/components/FormRenderer';
import { OfflineStatus } from '@/components/OfflineStatus';
import { getCachedForm, type FormData } from '@/lib/db';
import { initSyncListeners, isOnline, triggerSync } from '@/lib/sync';

interface PageProps {
    params: Promise<{ id: string }>;
}

export default function FormPage({ params }: PageProps) {
    const { id } = use(params);
    const router = useRouter();
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

    // Fetch form data
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
                if (isOnline()) {
                    // Try to fetch from API
                    const response = await fetch(`/api/forms/${assessmentId}`);

                    if (response.ok) {
                        const data = await response.json();
                        setFormData(data);
                    } else if (response.status === 404) {
                        setError('Form not found');
                    } else {
                        throw new Error('Failed to fetch form');
                    }
                } else {
                    // Offline: Try to load from cache
                    const cached = await getCachedForm(assessmentId);

                    if (cached) {
                        setFormData(cached.formData);
                    } else {
                        setError('Form not available offline. Please save it for offline use while online.');
                    }
                }
            } catch (err) {
                console.error('Error loading form:', err);

                // Try cache as fallback
                const cached = await getCachedForm(assessmentId);
                if (cached) {
                    setFormData(cached.formData);
                } else {
                    setError('Failed to load form. Please try again.');
                }
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
                    <h1>Error</h1>
                    <p className="error-message">{error}</p>
                    <button onClick={() => router.push('/')} className="back-button">
                        ← Back to Home
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
                        <h1 className="completion-title">✅ Assessment Submitted!</h1>

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

                        <button onClick={handleSubmitAnother} className="submit-button primary">
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
                onComplete={handleComplete}
            />
        </div>
    );
}
