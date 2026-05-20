
/**
 * Student Details Form Component (Login Flow)
 * 
 * Step 1 of the assessment submission flow.
 * Students enter their ID and Password to auto-fetch details.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { isOnline, checkActualConnectivity } from '@/lib/sync';
import { verifyStudentOffline } from '@/lib/db';

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
}

interface StudentDetailsFormProps {
    initialClassGrade?: number;
    onSubmit: (details: StudentDetails) => void;
}

export function StudentDetailsForm({ onSubmit }: StudentDetailsFormProps) {
    const [studentId, setStudentId] = useState('');
    const [password, setPassword] = useState('');
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

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setLookupResult(null);

        const online = await checkActualConnectivity();

        if (!online) {
            // Offline verification
            const student = await verifyStudentOffline(studentId, password);
            if (student) {
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
                    gender: student.gender
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
                body: JSON.stringify({ studentId, password })
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
                    gender: student.gender
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
                            <input 
                                type="password" 
                                value={password} 
                                onChange={e => setPassword(e.target.value)}
                                className="text-input"
                                placeholder="Enter password"
                                required
                            />
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
                <div className="confirmation-card">
                    <div className="confirm-header">
                        <div className="confirm-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="material-symbols-rounded" style={{ fontSize: '32px', color: 'var(--color-primary)' }}>account_circle</span>
                        </div>
                        <h3>Confirm Your Identity</h3>
                    </div>
                    
                    <div className="details-grid">
                        <div className="detail-item">
                            <label>Name</label>
                            <div className="detail-value">{lookupResult.studentName}</div>
                        </div>
                        <div className="detail-item">
                            <label>Class & Section</label>
                            <div className="detail-value">Class {lookupResult.classGrade} ({lookupResult.section})</div>
                        </div>
                        <div className="detail-item">
                            <label>School</label>
                            <div className="detail-value">{lookupResult.schoolName}</div>
                        </div>
                    </div>

                    <p className="confirm-text">Is this you? If yes, click below to start.</p>

                    <div className="confirm-actions">
                        <button onClick={() => setLookupResult(null)} className="nav-button secondary">
                            Not Me (Back)
                        </button>
                        <button onClick={handleConfirm} className="submit-button primary">
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%' }}>
                                Yes, Start Assessment
                                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>arrow_forward</span>
                            </span>
                        </button>
                    </div>
                </div>
            )}

            <style jsx>{`
                .student-login-container { max-width: 600px; margin: 0 auto; font-family: var(--font-sans); }
                .login-form, .confirmation-card { background: white; padding: 40px; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); border: 1px solid var(--color-border); }
                .section-label { font-size: 22px; font-weight: 700; color: var(--color-primary); margin-bottom: 8px; font-family: var(--font-sans); }
                .section-desc { color: var(--color-text-secondary); font-size: 14px; margin-bottom: 32px; font-family: var(--font-sans); }
                .form-field { margin-bottom: 24px; }
                .field-label { display: block; font-size: 13px; font-weight: 600; color: var(--color-primary); margin-bottom: 8px; font-family: var(--font-sans); }
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
