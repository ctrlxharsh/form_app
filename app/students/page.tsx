
'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getTeacherSession, type TeacherSession } from '@/lib/auth';
import Fuse from 'fuse.js';
import Papa from 'papaparse';

interface School {
    school_id: number;
    school_name: string;
    udise_code: string;
    state: string;
}

interface Student {
    student_id: number;
    unique_id: string;
    unique_cohort_id: string;
    first_name: string;
    last_name: string;
    fathers_name: string;
    mothers_name: string;
    school_id: number;
    class_grade: number;
    section: string;
    password?: string;
    date_of_birth?: string;
    fathers_occupation?: string;
    mothers_occupation?: string;
    address?: string;
    email_id?: string;
    school_name?: string;
}

const STATE_CODES: Record<string, string> = {
    'Maharashtra': 'MH', 'MAHARASHTRA': 'MH', 'Karnataka': 'KA', 'KARNATAKA': 'KA',
    'Goa': 'GA', 'GOA': 'GA', 'Gujarat': 'GJ', 'GUJARAT': 'GJ', 'Telangana': 'TS', 'TELANGANA': 'TS',
};

function getStateCode(stateName: string): string {
    return STATE_CODES[stateName] || (stateName ? stateName.substring(0, 2).toUpperCase() : 'MH');
}

export default function StudentsPage() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [session, setSession] = useState<TeacherSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [schools, setSchools] = useState<School[]>([]);
    const [students, setStudents] = useState<Student[]>([]);
    const [selectedSchool, setSelectedSchool] = useState<string>('');
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    // const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    // const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
    
    // const [newStudent, setNewStudent] = useState({
    //     uniqueId: '', cohortId: '', firstName: '', lastName: '', fathersName: '', mothersName: '',
    //     schoolId: '', classGrade: '', section: 'A', password: '', 
    //     dateOfBirth: '', fathersOccupation: '', mothersOccupation: '', address: '', emailId: ''
    // });

    // const [bulkFile, setBulkFile] = useState<File | null>(null);
    // const [bulkErrors, setBulkErrors] = useState<string[]>([]);
    // const [bulkStatus, setBulkStatus] = useState<'idle' | 'parsing' | 'uploading' | 'success' | 'error'>('idle');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function init() {
            const sess = await getTeacherSession();
            if (!sess) { router.push('/login'); return; }
            setSession(sess);
            try {
                const schoolRes = await fetch(`/api/schools?userId=${sess.userId}&role=${sess.role}`);
                if (schoolRes.ok) {
                    const data = await schoolRes.json();
                    setSchools(data);
                    if (data.length === 1) setSelectedSchool(data[0].school_id.toString());
                    else setSelectedSchool('');
                }
                const studentRes = await fetch(`/api/students?teacherId=${sess.userId}&role=${sess.role}`);
                if (studentRes.ok) setStudents(await studentRes.json());
            } catch (err) { console.error('Init error:', err); } finally { setLoading(false); }
        }
        init();
    }, [router]);

    // useEffect(() => {
    //     if (!newStudent.schoolId || !newStudent.classGrade) return;
    //     async function generateIds() {
    //         const school = schools.find(s => s.school_id === parseInt(newStudent.schoolId));
    //         if (!school) return;
    //         const stateCode = getStateCode(school.state);
    //         const udiseLast5 = school.udise_code.slice(-5);
    //         const currentYear = 2026;
    //         const passingYear = (currentYear + (10 - parseInt(newStudent.classGrade))).toString().slice(-2);
    //         const cohortId = `PJM${stateCode}${passingYear}${udiseLast5}`;
    //         try {
    //             const res = await fetch(`/api/students/next-id?cohortId=${cohortId}`);
    //             if (res.ok) {
    //                 const { nextSeq } = await res.json();
    //                 const uniqueId = `${cohortId}${nextSeq.toString().padStart(4, '0')}`;
    //                 setNewStudent(prev => ({ ...prev, cohortId, uniqueId }));
    //             }
    //         } catch (err) { console.error('ID gen error:', err); }
    //     }
    //     generateIds();
    // }, [newStudent.schoolId, newStudent.classGrade, schools]);

    const filteredStudents = useMemo(() => {
        let list = students;
        if (selectedSchool) list = list.filter(s => s.school_id === parseInt(selectedSchool));
        if (selectedClass) list = list.filter(s => s.class_grade === parseInt(selectedClass));
        if (searchQuery.trim()) {
            const fuse = new Fuse(list, { keys: ['first_name', 'last_name', 'unique_id', 'fathers_name', 'email_id'], threshold: 0.3 });
            return fuse.search(searchQuery).map(r => r.item);
        }
        return list;
    }, [students, selectedSchool, selectedClass, searchQuery]);

    // const handleAddStudent = async (e: React.FormEvent) => {
    //     e.preventDefault();
    //     setIsSubmitting(true);
    //     setError(null);
    //     try {
    //         const res = await fetch('/api/students', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({...newStudent, teacherId: session?.userId, role: session?.role}) });
    //         if (res.ok) {
    //             const addedStudent = await res.json();
    //             setStudents(prev => [addedStudent, ...prev]);
    //             setIsAddModalOpen(false);
    //             setNewStudent({ uniqueId: '', cohortId: '', firstName: '', lastName: '', fathersName: '', mothersName: '', schoolId: '', classGrade: '', section: 'A', password: '', dateOfBirth: '', fathersOccupation: '', mothersOccupation: '', address: '', emailId: '' });
    //         } else { setError((await res.json()).error || 'Failed to add student'); }
    //     } catch (err) { setError('An error occurred'); } finally { setIsSubmitting(false); }
    // };

    // const downloadTemplate = () => {
    //     const headers = ['schoolName', 'classGrade', 'firstName', 'lastName', 'password', 'section', 'fatherName', 'motherName', 'dateOfBirth', 'fathersOccupation', 'mothersOccupation', 'address', 'emailId'];
    //     const blob = new Blob([headers.join(',') + '\nExample School,10,John,Doe,01012001,A,Father,Mother,2010-01-01,Engineer,Teacher,123 St,john@ex.com'], { type: 'text/csv' });
    //     const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pijam_students_template.csv'; a.click();
    // };

    // const handleBulkUpload = async () => {
    //     if (!bulkFile) return;
    //     setBulkStatus('parsing');
    //     Papa.parse(bulkFile, {
    //         header: true, skipEmptyLines: true,
    //         complete: async (results) => {
    //             setBulkStatus('uploading');
    //             try {
    //                 const res = await fetch('/api/students/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ students: results.data, teacherId: session?.userId, role: session?.role }) });
    //                 const data = await res.json();
    //                 if (res.ok) {
    //                     setBulkStatus('success');
    //                     const studentRes = await fetch(`/api/students?teacherId=${session?.userId}&role=${session?.role}`);
    //                     if (studentRes.ok) setStudents(await studentRes.json());
    //                     setTimeout(() => setIsBulkModalOpen(false), 2000);
    //                 } else { setBulkErrors(data.errors || [data.error || 'Upload failed']); setBulkStatus('error'); }
    //             } catch (err) { setBulkErrors(['Network error']); setBulkStatus('error'); }
    //         }
    //     });
    // };

    if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div></div>;

    return (
        <div className="students-container">
            <header className="students-header">
                <div className="header-left">
                    <button onClick={() => router.push('/grading')} className="back-btn">← Grading</button>
                    <div><h1>👥 Student Management</h1><p>View and manage students in your assigned schools</p></div>
                </div>
                <div className="header-actions">
                    {/* <button onClick={() => setIsBulkModalOpen(true)} className="bulk-btn">📤 Bulk Upload</button>
                    <button onClick={() => setIsAddModalOpen(true)} className="add-student-btn">+ Add Student</button> */}
                </div>
            </header>

            <div className="controls-card">
                <div className="filters-grid">
                    <div className="filter-item"><label>School</label><select value={selectedSchool} onChange={e => setSelectedSchool(e.target.value)}><option value="">All Schools</option>{schools.map(s => <option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}</select></div>
                    <div className="filter-item"><label>Class</label><select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}><option value="">All Classes</option>{[4, 5, 6, 7, 8, 9, 10].map(c => <option key={c} value={c}>Class {c}</option>)}</select></div>
                    <div className="filter-item search-filter"><label>Search Students</label><input type="text" placeholder="Search by name, ID, or contact..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
                </div>
            </div>

            <div className="table-container">
                {filteredStudents.length > 0 ? (
                    <table>
                        <thead><tr><th>Unique ID</th><th>Full Name</th><th>School</th><th>Class/Sec</th><th>Contact</th><th>Parents Info</th></tr></thead>
                        <tbody>
                            {filteredStudents.map(s => (
                                <tr key={s.student_id}>
                                    <td><span className="font-mono text-xs block">{s.unique_id}</span><span className="text-[10px] text-gray-400">PW: {s.password || '01012001'}</span></td>
                                    <td><div className="font-semibold">{s.first_name} {s.last_name}</div><div className="text-[10px] text-gray-400">DOB: {s.date_of_birth || 'N/A'}</div></td>
                                    <td className="text-sm">{s.school_name}</td>
                                    <td>Class {s.class_grade} ({s.section})</td>
                                    <td><div className="text-xs">{s.email_id || '-'}</div><div className="text-[10px] text-gray-400 truncate max-w-[150px]">{s.address || 'No address'}</div></td>
                                    <td><div className="text-xs">F: {s.fathers_name || '-'}</div><div className="text-xs">M: {s.mothers_name || '-'}</div></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="no-results">
                        <p>No students found matching your criteria.</p>
                        <div className="debug-info mt-8 pt-8 border-t border-gray-100 text-[10px] text-gray-400">User: {session?.userId} | Role: {session?.role} | Total: {students.length}</div>
                    </div>
                )}
            </div>

            {/* Manual Add Modal commented out */}
            {/* isAddModalOpen && ( ... ) */}

            {/* Bulk Upload Modal commented out */}
            {/* isBulkModalOpen && ( ... ) */}

            <style jsx>{`
                .students-container { max-width: 1400px; margin: 0 auto; padding: 40px 20px; font-family: 'Inter', sans-serif; }
                .students-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
                .header-left { display: flex; align-items: center; gap: 20px; }
                .header-actions { display: flex; gap: 12px; }
                .back-btn { padding: 8px 16px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; color: #475569; font-weight: 600; cursor: pointer; transition: all 0.2s; }
                .h1 { font-size: 28px; color: #0f172a; margin: 0; letter-spacing: -0.02em; }
                .add-student-btn { background: #4f46e5; color: white; padding: 12px 24px; border-radius: 10px; font-weight: 600; border: none; cursor: pointer; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2); }
                .bulk-btn { background: white; color: #4f46e5; border: 2px solid #4f46e5; padding: 10px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; }
                .controls-card { background: white; padding: 24px; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; margin-bottom: 24px; }
                .filters-grid { display: grid; grid-template-columns: 1.5fr 1fr 2fr; gap: 20px; }
                .filter-item label { display: block; font-size: 13px; font-weight: 600; color: #64748b; margin-bottom: 8px; }
                .filter-item select, .filter-item input { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 15px; outline: none; }
                .table-container { background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; overflow: hidden; }
                table { width: 100%; border-collapse: collapse; text-align: left; }
                th { background: #f8fafc; padding: 16px; font-size: 12px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; text-transform: uppercase; letter-spacing: 0.05em; }
                td { padding: 14px 16px; font-size: 14px; color: #334155; border-bottom: 1px solid #f1f5f9; }
                
                /* Modal Fixes */
                .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
                .modal-content-wrapper { background: white; width: 100%; max-width: 550px; border-radius: 20px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); display: flex; flex-direction: column; max-height: 90vh; overflow: hidden; }
                .modal-header { padding: 20px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
                .modal-header h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin: 0; }
                .close-btn { background: none; border: none; font-size: 24px; color: #94a3b8; cursor: pointer; }
                .modal-body-scroll { padding: 24px; overflow-y: auto; flex-grow: 1; }
                .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .col-span-2 { grid-column: span 2; }
                .form-group label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px; }
                .form-group input, .form-group select { width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
                .bg-gray-50 { background-color: #f9fafb; }
                .modal-footer { margin-top: 24px; display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #f1f5f9; pt: 16px; }
                .cancel-btn { padding: 8px 16px; background: white; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; font-weight: 600; color: #64748b; cursor: pointer; }
                .submit-btn { padding: 8px 20px; background: #4f46e5; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
                .error-message { background: #fef2f2; color: #b91c1c; padding: 10px; border-radius: 8px; margin-top: 12px; font-size: 12px; }
            `}</style>
        </div>
    );
}
