
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

                        {error && <div className="error-message">⚠️ {error}</div>}

                        <button type="submit" disabled={loading} className="submit-button primary">
                            {loading ? 'Verifying...' : 'Login →'}
                        </button>
                    </div>
                </form>
            ) : (
                <div className="confirmation-card">
                    <div className="confirm-header">
                        <div className="confirm-icon">👤</div>
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
                            Yes, Start Assessment →
                        </button>
                    </div>
                </div>
            )}

            <style jsx>{`
                .student-login-container { max-width: 600px; margin: 0 auto; }
                .login-form, .confirmation-card { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
                .section-label { font-size: 20px; font-weight: 700; color: #1e293b; margin-bottom: 8px; }
                .section-desc { color: #64748b; font-size: 14px; margin-bottom: 32px; }
                .form-field { margin-bottom: 24px; }
                .field-label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 8px; }
                .text-input { width: 100%; padding: 12px 16px; border: 1px solid #cbd5e1; border-radius: 12px; font-size: 16px; outline: none; transition: border-color 0.2s; }
                .text-input:focus { border-color: #4f46e5; box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.1); }
                .error-message { background: #fef2f2; color: #b91c1c; padding: 12px; border-radius: 12px; font-size: 14px; margin-bottom: 24px; border: 1px solid #fecaca; }
                .submit-button { width: 100%; padding: 14px; border-radius: 12px; font-weight: 700; font-size: 16px; cursor: pointer; transition: all 0.2s; }
                .primary { background: #4f46e5; color: white; border: none; }
                .primary:hover { background: #4338ca; transform: translateY(-1px); }
                .primary:disabled { background: #94a3b8; cursor: not-allowed; }
                
                .confirm-header { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
                .confirm-icon { font-size: 32px; }
                .confirm-header h3 { font-size: 22px; font-weight: 800; color: #0f172a; margin: 0; }
                .details-grid { display: grid; gap: 20px; margin-bottom: 32px; padding: 24px; background: #f8fafc; border-radius: 16px; border: 1px solid #f1f5f9; }
                .detail-item label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 4px; }
                .detail-value { font-size: 18px; font-weight: 600; color: #334155; }
                .confirm-text { color: #64748b; font-size: 14px; text-align: center; margin-bottom: 24px; }
                .confirm-actions { display: flex; gap: 12px; }
                .secondary { background: white; border: 1px solid #cbd5e1; color: #475569; padding: 14px; border-radius: 12px; font-weight: 600; flex: 1; cursor: pointer; }
                .secondary:hover { background: #f8fafc; }
            `}</style>
        </div>
    );
}
