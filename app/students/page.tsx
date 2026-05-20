
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
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 100;

    // Reset to page 1 on filter changes
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedSchool, selectedClass, searchQuery]);
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
        if (selectedSchool) list = list.filter(s => String(s.school_id) === String(selectedSchool));
        if (selectedClass) list = list.filter(s => String(s.class_grade) === String(selectedClass));
        if (searchQuery.trim()) {
            const fuse = new Fuse(list, { keys: ['first_name', 'last_name', 'unique_id', 'fathers_name', 'email_id'], threshold: 0.3 });
            return fuse.search(searchQuery).map(r => r.item);
        }
        return list;
    }, [students, selectedSchool, selectedClass, searchQuery]);

    const paginatedStudents = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredStudents.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredStudents, currentPage]);

    const totalPages = Math.max(1, Math.ceil(filteredStudents.length / ITEMS_PER_PAGE));

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

    if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[var(--color-primary)]"></div></div>;

    return (
        <div className="students-container">
            <header className="students-header">
                <div className="header-left">
                    <button onClick={() => router.push('/grading')} className="back-btn flex items-center gap-1">
                        <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>arrow_back</span>
                        Grading
                    </button>
                    <div>
                        <h1 className="flex items-center gap-2">
                            <span className="material-symbols-rounded text-3xl" style={{ color: 'var(--color-primary)' }}>group</span>
                            Student Management
                        </h1>
                        <p>View and manage students in your assigned schools</p>
                    </div>
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
                    <>
                        <table>
                            <thead><tr><th>Unique ID</th><th>Full Name</th><th>School</th><th>Class/Sec</th><th>Contact</th><th>Parents Info</th></tr></thead>
                            <tbody>
                                {paginatedStudents.map(s => (
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
                        {totalPages > 1 && (
                            <div className="pagination-controls">
                                <button
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={currentPage === 1}
                                    className="pagination-btn"
                                >
                                    <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>chevron_left</span>
                                    Previous
                                </button>
                                <span className="pagination-info">
                                    Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
                                    <span className="pagination-count">
                                        (Showing {Math.min(filteredStudents.length, (currentPage - 1) * ITEMS_PER_PAGE + 1)}-{Math.min(filteredStudents.length, currentPage * ITEMS_PER_PAGE)} of {filteredStudents.length} students)
                                    </span>
                                </span>
                                <button
                                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={currentPage === totalPages}
                                    className="pagination-btn"
                                >
                                    Next
                                    <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>chevron_right</span>
                                </button>
                            </div>
                        )}
                    </>
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
                .students-container { max-width: 1400px; margin: 0 auto; padding: 40px 24px; font-family: var(--font-sans); }
                .students-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; font-family: var(--font-sans); }
                .header-left { display: flex; align-items: center; gap: 20px; }
                .header-actions { display: flex; gap: 12px; }
                .back-btn {
                    padding: 8px 16px; background: transparent; border: 1.5px solid transparent; 
                    border-radius: var(--radius-sm); color: var(--color-text-secondary); font-weight: 600; 
                    cursor: pointer; transition: all 0.2s; font-family: var(--font-sans);
                    display: inline-flex; align-items: center; gap: 6px;
                }
                .back-btn:hover { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-border); }
                .students-header h1 { font-size: 28px; color: var(--color-primary); margin: 0; letter-spacing: -0.02em; font-family: var(--font-sans); font-weight: 700; }
                .students-header p { color: var(--color-text-secondary); margin: 4px 0 0 0; font-size: 14px; font-family: var(--font-sans); }
                .add-student-btn {
                    background: var(--color-primary); color: white; padding: 12px 24px; border-radius: var(--radius-sm);
                    font-weight: 600; border: 1.5px solid transparent; cursor: pointer; box-shadow: var(--shadow);
                    transition: all 0.2s; font-family: var(--font-sans);
                }
                .add-student-btn:hover { background: var(--color-accent); color: var(--color-primary); box-shadow: 0 4px 12px rgba(78, 205, 196, 0.3); }
                .bulk-btn {
                    background: white; color: var(--color-primary); border: 2px solid var(--color-primary); 
                    padding: 10px 20px; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer;
                    transition: all 0.2s; font-family: var(--font-sans);
                }
                .bulk-btn:hover { background: var(--color-primary-light); }
                .controls-card { background: white; padding: 24px; border-radius: var(--radius-md); box-shadow: var(--shadow); border: 1.5px solid var(--color-border); margin-bottom: 24px; }
                .filters-grid { display: grid; grid-template-columns: 1.5fr 1fr 2fr; gap: 20px; }
                .filter-item label { display: block; font-size: 13px; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 8px; font-family: var(--font-sans); }
                .filter-item select, .filter-item input {
                    width: 100%; padding: 10px 12px; border: 1.5px solid var(--color-border); 
                    border-radius: var(--radius-sm); font-size: 15px; outline: none; transition: all 0.2s;
                    color: var(--color-text); background-color: white; font-family: var(--font-sans);
                }
                .filter-item select:focus, .filter-item input:focus {
                    border-color: var(--color-accent); box-shadow: 0 0 0 3px rgba(78, 205, 196, 0.25);
                }
                .table-container { background: white; border-radius: var(--radius-md); box-shadow: var(--shadow); border: 1.5px solid var(--color-border); overflow: hidden; }
                .pagination-controls {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 24px;
                    background: var(--color-primary-light);
                    border-top: 1.5px solid var(--color-border);
                }
                .pagination-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    background: white;
                    border: 1.5px solid var(--color-border);
                    border-radius: var(--radius-sm);
                    color: var(--color-primary);
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    font-family: var(--font-sans);
                }
                .pagination-btn:hover:not(:disabled) {
                    background: var(--color-primary);
                    color: white;
                    border-color: var(--color-primary);
                    transform: translateY(-1px);
                    box-shadow: 0 2px 6px rgba(21, 65, 89, 0.15);
                }
                .pagination-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                    background: #f1f5f9;
                    color: #94a3b8;
                    border-color: #cbd5e1;
                    transform: none;
                    box-shadow: none;
                }
                .pagination-info {
                    font-size: 14px;
                    color: var(--color-text-secondary);
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .pagination-info strong {
                    color: var(--color-primary);
                }
                .pagination-count {
                    font-size: 12px;
                    color: #64748b;
                    margin-left: 8px;
                }
                table { width: 100%; border-collapse: collapse; text-align: left; font-family: var(--font-sans); }
                th { background: var(--color-primary-light); padding: 16px; font-size: 12px; font-weight: 600; color: var(--color-primary); border-bottom: 1.5px solid var(--color-border); text-transform: uppercase; letter-spacing: 0.05em; font-family: var(--font-sans); }
                td { padding: 14px 16px; font-size: 14px; color: var(--color-text); border-bottom: 1px solid var(--color-border); font-family: var(--font-sans); }
                tr:hover td { background: var(--color-primary-light); }
                .no-results { text-align: center; padding: 48px 24px; color: var(--color-text-secondary); font-family: var(--font-sans); }
                
                /* Modal Fixes */
                .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
                .modal-content-wrapper { background: white; width: 100%; max-width: 550px; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); border: 1.5px solid var(--color-border); display: flex; flex-direction: column; max-height: 90vh; overflow: hidden; font-family: var(--font-sans); }
                .modal-header { padding: 20px 24px; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; font-family: var(--font-sans); }
                .modal-header h2 { font-size: 18px; font-weight: 700; color: var(--color-primary); margin: 0; font-family: var(--font-sans); }
                .close-btn { background: none; border: none; font-size: 24px; color: var(--color-text-secondary); cursor: pointer; }
                .close-btn:hover { color: var(--color-error); }
                .modal-body-scroll { padding: 24px; overflow-y: auto; flex-grow: 1; font-family: var(--font-sans); }
                .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .col-span-2 { grid-column: span 2; }
                .form-group label { display: block; font-size: 12px; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 4px; font-family: var(--font-sans); }
                .form-group input, .form-group select {
                    width: 100%; padding: 8px 12px; border: 1.5px solid var(--color-border); border-radius: var(--radius-sm);
                    font-size: 14px; font-family: var(--font-sans); outline: none; transition: all 0.2s;
                }
                .form-group input:focus, .form-group select:focus {
                    border-color: var(--color-accent); box-shadow: 0 0 0 3px rgba(78, 205, 196, 0.25);
                }
                .bg-gray-50 { background-color: var(--color-bg); }
                .modal-footer { margin-top: 24px; display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--color-border); padding-top: 16px; }
                .cancel-btn {
                    padding: 8px 16px; background: white; border: 1.5px solid var(--color-border); border-radius: var(--radius-sm);
                    font-size: 14px; font-weight: 600; color: var(--color-text-secondary); cursor: pointer; transition: all 0.2s;
                    font-family: var(--font-sans);
                }
                .cancel-btn:hover { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-primary); }
                .submit-btn {
                    padding: 8px 20px; background: var(--color-primary); color: white; border: 1.5px solid transparent;
                    border-radius: var(--radius-sm); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;
                    font-family: var(--font-sans); box-shadow: var(--shadow);
                }
                .submit-btn:hover { background: var(--color-accent); color: var(--color-primary); box-shadow: 0 4px 12px rgba(78, 205, 196, 0.3); }
                .error-message { background: #fef2f2; color: var(--color-error); padding: 10px; border-radius: var(--radius-sm); border: 1.5px solid #fca5a5; margin-top: 12px; font-size: 12px; font-family: var(--font-sans); }
            `}</style>
        </div>
    );
}
