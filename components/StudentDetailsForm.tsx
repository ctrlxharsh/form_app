
/**
 * Student Details Form Component (Login Flow)
 * 
 * Step 1 of the assessment submission flow.
 * Students enter their ID and Password to auto-fetch details.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { isOnline, checkActualConnectivity } from '@/lib/sync';
import { verifyStudentOffline, db } from '@/lib/db';
import { getTeacherSession } from '@/lib/auth';

export interface StudentDetails {
    studentFirstName: string;
    studentLastName: string;
    studentName: string;
    studentId: number;
    gender: 'Male' | 'Female';
    classGrade: number;
    section: string;
    schoolId: number;
    schoolName: string;
    intervention: 'Prototype' | 'Propagate';
    udiseCode: string;
    geolocation?: string | null;
    hasSubmitted?: boolean;
}

export const isDropoutOrAlumni = (grade: any): boolean => {
    if (!grade) return false;
    const gStr = String(grade).toLowerCase().trim();
    return gStr === 'dropout' || gStr === 'alumni' || gStr === 'd' || gStr === 'a';
};

interface StudentDetailsFormProps {
    assessmentGrade?: number;
    assessmentId?: number;
    onSubmit: (details: StudentDetails) => void;
}

export function StudentDetailsForm({ assessmentGrade, assessmentId, onSubmit }: StudentDetailsFormProps) {
    const [studentId, setStudentId] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [lookupResult, setLookupResult] = useState<StudentDetails | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [geolocation, setGeolocation] = useState<string | null>(null);

    // Capture geolocation
    useEffect(() => {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => setGeolocation(`${pos.coords.latitude},${pos.coords.longitude}`),
                () => console.log('Geo denied')
            );
        }
    }, []);

    // Get all sibling assessment IDs (same group or same title+class) for duplicate checking
    const getSiblingAssessmentIds = async (currentAssessmentId: number): Promise<number[]> => {
        try {
            const { getCachedAssessments } = await import('@/lib/db');
            const allAssessments = await getCachedAssessments();
            const current = allAssessments.find(a => a.assessment_id === currentAssessmentId);
            if (!current) return [currentAssessmentId];

            const siblings = allAssessments.filter(a => {
                if (current.group_identifier && a.group_identifier) {
                    return a.group_identifier === current.group_identifier;
                }
                // Fallback: same title + class_grade
                return a.title.trim().toLowerCase() === current.title.trim().toLowerCase()
                    && a.class_grade === current.class_grade;
            });
            return siblings.length > 0 ? siblings.map(a => a.assessment_id) : [currentAssessmentId];
        } catch {
            return [currentAssessmentId];
        }
    };

    // Check offline + synced submissions across a set of assessment IDs
    const checkOfflineDuplicate = async (siblingIds: number[], studentId: number | null | undefined, firstName: string, lastName: string): Promise<boolean> => {
        try {
            const { db } = await import('@/lib/db');
            const fnLower = firstName.toLowerCase().trim();
            const lnLower = lastName.toLowerCase().trim();

            for (const aId of siblingIds) {
                const existingOffline = await db.offlineSubmissions
                    .where('formId')
                    .equals(aId)
                    .filter(s => {
                        if (studentId && s.studentId) {
                            return s.studentId === studentId;
                        }
                        return s.studentFirstName.toLowerCase().trim() === fnLower && s.studentLastName.toLowerCase().trim() === lnLower;
                    })
                    .first();
                if (existingOffline) return true;

                const existingSynced = await db.syncedSubmissions
                    .where('assessmentId')
                    .equals(aId)
                    .filter(s => {
                        if (studentId && s.studentId) {
                            return s.studentId === studentId;
                        }
                        return s.studentFirstName.toLowerCase().trim() === fnLower && s.studentLastName.toLowerCase().trim() === lnLower;
                    })
                    .first();
                if (existingSynced) return true;
            }
            return false;
        } catch (dbErr) {
            console.error('Error checking offline submissions duplicate:', dbErr);
            return false;
        }
    };

    // Check if current user has offline access to student's school
    const checkOfflineStudentAccess = async (schoolId: number): Promise<boolean> => {
        const session = await getTeacherSession();
        if (session) {
            const isPrivileged = ['M&E', 'Lead', 'Admin', 'Program Lead'].includes(session.role);
            if (!isPrivileged) {
                const cachedSchool = await db.cachedSchools.get(schoolId);
                if (!cachedSchool) {
                    return false;
                }
            }
        }
        return true;
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setLookupResult(null);

        const session = await getTeacherSession();
        const online = await checkActualConnectivity();

        if (!online) {
            // Offline verification
            const student = await verifyStudentOffline(studentId, password);
            if (student) {
                const hasAccess = await checkOfflineStudentAccess(student.school_id);
                if (!hasAccess) {
                    setError('You do not have access to this student');
                    setLoading(false);
                    return;
                }

                let hasSubmittedOffline = false;
                if (assessmentId) {
                    const siblingIds = await getSiblingAssessmentIds(assessmentId);
                    hasSubmittedOffline = await checkOfflineDuplicate(siblingIds, student.student_id, student.first_name, student.last_name);
                }

                setLookupResult({
                    studentId: student.student_id,
                    studentFirstName: student.first_name,
                    studentLastName: student.last_name,
                    studentName: `${student.first_name} ${student.last_name}`,
                    classGrade: student.class_grade,
                    section: student.section,
                    schoolId: student.school_id,
                    schoolName: student.school_name,
                    udiseCode: student.udise_code,
                    intervention: (student.intervention as any) || 'Prototype',
                    gender: student.gender,
                    hasSubmitted: hasSubmittedOffline
                });
            } else {
                setError('Offline: Student not found or incorrect password. (Note: Student data must be synced while online first)');
            }
            setLoading(false);
            return;
        }

        try {
            const res = await fetch('/api/students/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId,
                    password,
                    assessmentId,
                    teacherId: session?.userId,
                    role: session?.role
                })
            });

            if (res.ok) {
                const data = await res.json();
                setLookupResult(data);
            } else {
                const err = await res.json();
                setError(err.error || 'Invalid Student ID or Password');
            }
        } catch (err: any) {
            console.error('[StudentLogin] Network/Server Error:', err);
            
            // Fallback to offline verification if online request fails
            const student = await verifyStudentOffline(studentId, password);
            if (student) {
                const hasAccess = await checkOfflineStudentAccess(student.school_id);
                if (!hasAccess) {
                    setError('You do not have access to this student');
                    setLoading(false);
                    return;
                }

                let hasSubmittedOffline = false;
                if (assessmentId) {
                    const siblingIds = await getSiblingAssessmentIds(assessmentId);
                    hasSubmittedOffline = await checkOfflineDuplicate(siblingIds, student.student_id, student.first_name, student.last_name);
                }

                setLookupResult({
                    studentId: student.student_id,
                    studentFirstName: student.first_name,
                    studentLastName: student.last_name,
                    studentName: `${student.first_name} ${student.last_name}`,
                    classGrade: student.class_grade,
                    section: student.section,
                    schoolId: student.school_id,
                    schoolName: student.school_name,
                    udiseCode: student.udise_code,
                    intervention: (student.intervention as any) || 'Prototype',
                    gender: student.gender,
                    hasSubmitted: hasSubmittedOffline
                });
            } else {
                setError(`Connection failed: ${err.message || 'Unknown network error'}. Also could not find student locally.`);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleConfirm = () => {
        if (lookupResult) {
            onSubmit({ ...lookupResult, geolocation });
        }
    };

    return (
        <div className="student-login-container">
            {!lookupResult ? (
                <form onSubmit={handleLogin} className="login-form">
                    <div className="form-section">
                        <div className="section-label">Student Login</div>
                        <p className="section-desc">Enter your unique Student ID and Password to begin the assessment.</p>
                        
                        <div className="form-field">
                            <label className="field-label">Student Unique ID *</label>
                            <input 
                                type="text" 
                                value={studentId} 
                                onChange={e => setStudentId(e.target.value)}
                                className="text-input"
                                placeholder="e.g. PJMMH26..."
                                required
                            />
                        </div>

                        <div className="form-field">
                            <label className="field-label">Password *</label>
                            <div className="password-input-wrapper">
                                <input 
                                    type={showPassword ? "text" : "password"} 
                                    value={password} 
                                    onChange={e => setPassword(e.target.value)}
                                    className="text-input"
                                    placeholder="Enter password"
                                    required
                                />
                                <button
                                    type="button"
                                    className="password-toggle"
                                    onClick={() => setShowPassword(!showPassword)}
                                    title={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                    )}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="error-message" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="material-symbols-rounded" style={{ color: 'var(--color-error)' }}>warning</span>
                                <span>{error}</span>
                            </div>
                        )}

                        <button type="submit" disabled={loading} className="submit-button primary">
                            {loading ? 'Verifying...' : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%' }}>
                                    Login
                                    <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>arrow_forward</span>
                                </span>
                            )}
                        </button>
                    </div>
                </form>
            ) : (
                (() => {
                    const isDropout = String(lookupResult.classGrade).toLowerCase().trim() === 'dropout' || String(lookupResult.classGrade).toLowerCase().trim() === 'd';
                    const isAlumni = String(lookupResult.classGrade).toLowerCase().trim() === 'alumni' || String(lookupResult.classGrade).toLowerCase().trim() === 'a';
                    const isAlreadySubmitted = !!lookupResult.hasSubmitted;
                    const isBlocked = isDropout || isAlumni || isAlreadySubmitted;
                    const isMismatch = assessmentGrade !== undefined && !isBlocked && String(lookupResult.classGrade).trim() !== String(assessmentGrade).trim();
                    let gradeText = `Class ${lookupResult.classGrade}`;
                    if (isDropout) gradeText = "Dropout";
                    if (isAlumni) gradeText = "Alumni";

                    return (
                        <div className="confirmation-card">
                            <div className="confirm-header">
                                <div className="confirm-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <span className="material-symbols-rounded" style={{ fontSize: '32px', color: isBlocked ? 'var(--color-error)' : 'var(--color-primary)' }}>
                                        {isBlocked ? 'block' : 'account_circle'}
                                    </span>
                                </div>
                                <h3>Confirm Your Identity</h3>
                            </div>

                            {isAlreadySubmitted && (
                                <div className="error-message" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', background: '#fee2e2', border: '1.5px solid #fca5a5' }}>
                                    <span className="material-symbols-rounded" style={{ color: 'var(--color-error)' }}>block</span>
                                    <span><strong>Submission Blocked:</strong> You have already submitted this assessment. Duplicates are not allowed.</span>
                                </div>
                            )}

                            {!isAlreadySubmitted && isBlocked && (
                                <div className="error-message" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', background: '#fee2e2', border: '1.5px solid #fca5a5' }}>
                                    <span className="material-symbols-rounded" style={{ color: 'var(--color-error)' }}>block</span>
                                    <span><strong>Submission Blocked:</strong> Students marked as Dropout or Alumni are not allowed to submit assessments.</span>
                                </div>
                            )}

                            {isMismatch && (
                                <div className="warning-message" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', padding: '12px', borderRadius: 'var(--radius-md)', fontSize: '14px', background: '#fef3c7', border: '1.5px solid #fcd34d', color: '#92400e', fontFamily: 'var(--font-sans)', textAlign: 'left' }}>
                                    <span className="material-symbols-rounded" style={{ color: '#d97706' }}>warning</span>
                                    <span><strong>Grade Mismatch:</strong> Your grade ({gradeText}) is different from this assessment's grade (Class {assessmentGrade}).</span>
                                </div>
                            )}
                            
                            <div className="details-grid">
                                <div className="detail-item">
                                    <label>Name</label>
                                    <div className="detail-value">{lookupResult.studentName}</div>
                                </div>
                                <div className="detail-item">
                                    <label>Class & Section</label>
                                    <div className="detail-value">{gradeText} ({lookupResult.section})</div>
                                </div>
                                <div className="detail-item">
                                    <label>School</label>
                                    <div className="detail-value">{lookupResult.schoolName}</div>
                                </div>
                            </div>

                            <p className="confirm-text" style={{ color: isBlocked ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
                                {isAlreadySubmitted
                                    ? "You have already completed this assessment."
                                    : isBlocked 
                                        ? "You are not permitted to submit this assessment." 
                                        : "Is this you? If yes, click below to start."
                                }
                            </p>

                            <div className="confirm-actions">
                                <button onClick={() => setLookupResult(null)} className="nav-button secondary">
                                    Not Me (Back)
                                </button>
                                <button 
                                    onClick={handleConfirm} 
                                    disabled={isBlocked} 
                                    className="submit-button primary"
                                    style={{ 
                                        opacity: isBlocked ? 0.5 : 1, 
                                        cursor: isBlocked ? 'not-allowed' : 'pointer',
                                        background: isBlocked ? 'var(--color-border)' : 'var(--color-primary)',
                                        color: isBlocked ? 'var(--color-text-secondary)' : 'white'
                                    }}
                                >
                                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%' }}>
                                        {isAlreadySubmitted ? 'Already Submitted' : isBlocked ? 'Blocked' : 'Yes, Start Assessment'}
                                        <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>arrow_forward</span>
                                    </span>
                                </button>
                            </div>
                        </div>
                    );
                })()
            )}

            <style jsx>{`
                .student-login-container { max-width: 600px; margin: 0 auto; font-family: var(--font-sans); }
                .login-form, .confirmation-card { background: white; padding: 40px; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); border: 1px solid var(--color-border); }
                .section-label { font-size: 22px; font-weight: 700; color: var(--color-primary); margin-bottom: 8px; font-family: var(--font-sans); }
                .section-desc { color: var(--color-text-secondary); font-size: 14px; margin-bottom: 32px; font-family: var(--font-sans); }
                .form-field { margin-bottom: 24px; }
                .field-label { display: block; font-size: 13px; font-weight: 600; color: var(--color-primary); margin-bottom: 8px; font-family: var(--font-sans); }
                .password-input-wrapper { position: relative; display: flex; align-items: center; width: 100%; }
                .password-input-wrapper input { width: 100%; padding-right: 44px; }
                .password-toggle { position: absolute; right: 12px; background: none; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 6px; transition: opacity 0.2s; }
                .password-toggle:hover { opacity: 0.7; }
                .password-toggle:focus { outline: none; }
                .text-input { width: 100%; padding: 12px 16px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); font-size: 16px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; font-family: var(--font-sans); background: var(--color-bg); color: var(--color-text); }
                .text-input:focus { border-color: var(--color-accent); box-shadow: 0 0 0 4px rgba(78, 205, 196, 0.2); background: white; }
                .error-message { background: #fee2e2; color: var(--color-error); padding: 12px; border-radius: var(--radius-md); font-size: 14px; margin-bottom: 24px; border: 1.5px solid #fca5a5; font-family: var(--font-sans); }
                .submit-button { width: 100%; padding: 14px; border-radius: var(--radius-md); font-weight: 700; font-size: 16px; cursor: pointer; transition: all 0.2s; font-family: var(--font-sans); }
                .primary { background: var(--color-primary); color: white; border: none; }
                .primary:hover { background: #1c2e54; transform: translateY(-1.5px); box-shadow: 0 4px 12px rgba(27, 43, 78, 0.25); }
                .primary:disabled { background: var(--color-border); color: var(--color-text-secondary); cursor: not-allowed; }
                
                .confirm-header { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
                .confirm-icon { font-size: 32px; }
                .confirm-header h3 { font-size: 22px; font-weight: 800; color: var(--color-primary); margin: 0; font-family: var(--font-sans); }
                .details-grid { display: grid; gap: 20px; margin-bottom: 32px; padding: 24px; background: var(--color-bg); border-radius: var(--radius-md); border: 1.5px solid var(--color-border); }
                .detail-item label { font-size: 11px; font-weight: 700; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 4px; font-family: var(--font-sans); }
                .detail-value { font-size: 18px; font-weight: 600; color: var(--color-primary); font-family: var(--font-sans); }
                .confirm-text { color: var(--color-text-secondary); font-size: 14px; text-align: center; margin-bottom: 24px; font-family: var(--font-sans); }
                .confirm-actions { display: flex; gap: 12px; }
                .secondary { background: white; border: 1.5px solid var(--color-border); color: var(--color-text-secondary); padding: 14px; border-radius: var(--radius-md); font-weight: 600; flex: 1; cursor: pointer; transition: all 0.2s; font-family: var(--font-sans); }
                .secondary:hover { background: var(--color-bg); border-color: var(--color-text-secondary); }
            `}</style>
        </div>
    );
}
