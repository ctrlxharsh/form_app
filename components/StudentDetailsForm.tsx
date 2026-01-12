/**
 * Student Details Form Component
 * 
 * Step 1 of the assessment submission flow.
 * Google Forms style - clean inputs with underlines.
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
    getCachedSchoolsByIntervention,
    validateSchoolUdiseOffline,
    hasSchoolsCache,
    type CachedSchool
} from '@/lib/db';
import { isOnline } from '@/lib/sync';

export interface StudentDetails {
    studentFirstName: string;
    studentLastName: string;
    studentName: string; // Keep for backward compat if needed, or derived
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

export function StudentDetailsForm({ initialClassGrade = 4, onSubmit }: StudentDetailsFormProps) {
    const [intervention, setIntervention] = useState<'Prototype' | 'Propagate'>('Prototype');
    const [schools, setSchools] = useState<CachedSchool[]>([]);
    const [selectedSchoolId, setSelectedSchoolId] = useState<number | ''>('');
    const [udiseCode, setUdiseCode] = useState('');
    const [studentFirstName, setStudentFirstName] = useState('');
    const [studentLastName, setStudentLastName] = useState('');
    const [geolocation, setGeolocation] = useState<string | null>(null);
    const [gender, setGender] = useState<'Male' | 'Female'>('Male');
    const [classGrade, setClassGrade] = useState(initialClassGrade);
    const [section, setSection] = useState('A');

    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [hasCache, setHasCache] = useState(false);
    const [online, setOnline] = useState(true);

    useEffect(() => {
        setOnline(isOnline());
        hasSchoolsCache().then(setHasCache);

        const handleOnline = () => setOnline(true);
        const handleOffline = () => setOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    useEffect(() => {
        async function fetchSchools() {
            setLoading(true);

            try {
                if (online) {
                    const response = await fetch(`/api/schools?intervention=${intervention}`);
                    if (response.ok) {
                        const data = await response.json();
                        setSchools(data);
                    }
                } else if (hasCache) {
                    const cached = await getCachedSchoolsByIntervention(intervention);
                    setSchools(cached);
                } else {
                    setSchools([]);
                }
            } catch (error) {
                console.error('Failed to fetch schools:', error);
                const cached = await getCachedSchoolsByIntervention(intervention);
                setSchools(cached);
            } finally {
                setLoading(false);
            }
        }

        fetchSchools();
    }, [intervention, online, hasCache]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const newErrors: string[] = [];

        if (!studentFirstName.trim()) newErrors.push('Please enter first name');
        if (!studentLastName.trim()) newErrors.push('Please enter last name');
        if (!selectedSchoolId) newErrors.push('Please select a school');
        if (!udiseCode || udiseCode.length !== 11 || !/^\d{11}$/.test(udiseCode)) {
            newErrors.push('UDISE code must be exactly 11 digits');
        }

        if (selectedSchoolId && udiseCode.length === 11) {
            let isValid = false;

            if (online) {
                try {
                    const response = await fetch('/api/schools', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ schoolId: selectedSchoolId, udiseCode })
                    });
                    const result = await response.json();
                    isValid = result.valid;
                } catch {
                    isValid = await validateSchoolUdiseOffline(selectedSchoolId, udiseCode);
                }
            } else {
                isValid = await validateSchoolUdiseOffline(selectedSchoolId, udiseCode);
            }

            if (!isValid) {
                newErrors.push('School and UDISE code do not match');
            }
        }

        if (newErrors.length > 0) {
            setErrors(newErrors);
            return;
        }

        const selectedSchool = schools.find(s => s.school_id === selectedSchoolId);

        onSubmit({
            studentFirstName: studentFirstName.trim(),
            studentLastName: studentLastName.trim(),
            studentName: `${studentFirstName.trim()} ${studentLastName.trim()}`,
            gender,
            classGrade,
            section,
            schoolId: selectedSchoolId as number,
            schoolName: selectedSchool?.school_name || '',
            intervention,
            udiseCode,
            geolocation
        });
    };

    // Auto-capture geolocation on mount/interaction
    useEffect(() => {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude } = position.coords;
                    setGeolocation(`${latitude},${longitude}`);
                },
                (error) => {
                    console.log('Geolocation permission denied or error', error);
                }
            );
        }
    }, []);

    const classOptions = [4, 5, 6, 7, 8, 9, 10];
    const sectionOptions = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

    return (
        <form onSubmit={handleSubmit} className="student-form">
            {errors.length > 0 && (
                <div className="error-container">
                    {errors.map((error, idx) => (
                        <p key={idx} className="error-message">{error}</p>
                    ))}
                </div>
            )}

            {/* School Section */}
            <div className="form-section">
                <div className="section-label">School Information</div>

                <div className="form-row">
                    <div className="form-field">
                        <label className="field-label">Intervention Type *</label>
                        <select
                            value={intervention}
                            onChange={(e) => setIntervention(e.target.value as 'Prototype' | 'Propagate')}
                            className="select-input"
                        >
                            <option value="Prototype">Prototype</option>
                            <option value="Propagate">Propagate</option>
                        </select>
                    </div>

                    <div className="form-field">
                        <label className="field-label">School *</label>
                        <select
                            value={selectedSchoolId}
                            onChange={(e) => setSelectedSchoolId(e.target.value ? parseInt(e.target.value, 10) : '')}
                            className="select-input"
                            disabled={loading || schools.length === 0}
                        >
                            <option value="">Select school</option>
                            {schools.map((school) => (
                                <option key={school.school_id} value={school.school_id}>
                                    {school.school_name}
                                </option>
                            ))}
                        </select>
                        {loading && <span className="loading-text">Loading...</span>}
                    </div>
                </div>

                <div className="form-field">
                    <label className="field-label">UDISE Code *</label>
                    <input
                        type="text"
                        value={udiseCode}
                        onChange={(e) => setUdiseCode(e.target.value.replace(/\D/g, '').slice(0, 11))}
                        className="text-input"
                        placeholder="Enter 11-digit code"
                        maxLength={11}
                    />
                    <span className="field-hint">Your school&apos;s unique 11-digit UDISE code</span>
                </div>
            </div>

            {/* Student Section */}
            <div className="form-section">
                <div className="section-label">Student Information</div>

                <div className="form-row">
                    <div className="form-field">
                        <label className="field-label">First Name *</label>
                        <input
                            type="text"
                            value={studentFirstName}
                            onChange={(e) => setStudentFirstName(e.target.value)}
                            className="text-input"
                            placeholder="First Name"
                        />
                    </div>
                    <div className="form-field">
                        <label className="field-label">Last Name *</label>
                        <input
                            type="text"
                            value={studentLastName}
                            onChange={(e) => setStudentLastName(e.target.value)}
                            className="text-input"
                            placeholder="Last Name"
                        />
                    </div>
                </div>

                <div className="form-row" style={{ marginBottom: 0 }}>
                    <div className="form-field">
                        <label className="field-label">Gender *</label>
                        <select
                            value={gender}
                            onChange={(e) => setGender(e.target.value as 'Male' | 'Female')}
                            className="select-input"
                        >
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                        </select>
                    </div>

                    <div className="form-field">
                        <label className="field-label">Class *</label>
                        <select
                            value={classGrade}
                            onChange={(e) => setClassGrade(parseInt(e.target.value, 10))}
                            className="select-input"
                        >
                            {classOptions.map((grade) => (
                                <option key={grade} value={grade}>Class {grade}</option>
                            ))}
                        </select>
                    </div>

                    <div className="form-field">
                        <label className="field-label">Section *</label>
                        <select
                            value={section}
                            onChange={(e) => setSection(e.target.value)}
                            className="select-input"
                        >
                            {sectionOptions.map((sec) => (
                                <option key={sec} value={sec}>{sec}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <button type="submit" className="submit-button primary">
                Next →
            </button>
        </form>
    );
}
