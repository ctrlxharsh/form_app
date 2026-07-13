/**
 * Landing Page
 * 
 * Full-width layout with cached forms, manual sync buttons, and subtle loading.
 * Mobile-friendly with bottom navigation.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getPendingSubmissionCount,
  hasSchoolsCache,
  getCachedAssessments,
  getAllCachedForms,
  getLastSchoolsSyncTime,
  getPendingSubmissions,
  type CachedAssessment,
  type CachedForm,
  type OfflineSubmission
} from '@/lib/db';
import {
  initSyncListeners,
  triggerSync,
  forceSyncSchools,
  forceSyncAssessments,
  forceSyncStudents,
  onSyncStatusChange,
  checkActualConnectivity,
  type SyncStatus
} from '@/lib/sync';
import { getTeacherSession, logoutTeacher, type TeacherSession } from '@/lib/auth';

interface Assessment {
  assessment_id: number;
  title: string;
  description: string | null;
  class_grade: number;
  language?: string;
  languages?: string[];
  group_identifier?: string;
  academic_year?: string;
}

export default function HomePage() {
  const router = useRouter();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [cachedForms, setCachedForms] = useState<CachedForm[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = useState<OfflineSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingAssessments, setSyncingAssessments] = useState(false);
  const [syncingSchools, setSyncingSchools] = useState(false);
  const [syncingStudents, setSyncingStudents] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [hasCache, setHasCache] = useState(false);
  const [lastSchoolsSync, setLastSchoolsSync] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [selectedClass, setSelectedClass] = useState<number | 'all'>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [teacherSession, setTeacherSession] = useState<TeacherSession | null>(null);

  // Prefetch language variants for all cached forms when online
  useEffect(() => {
    if (online && cachedForms.length > 0) {
      for (const form of cachedForms) {
        const languages = form.formData.languages && form.formData.languages.length > 0
          ? form.formData.languages
          : ['English'];
        for (const lang of languages) {
          router.prefetch(`/forms/${form.formId}?lang=${lang}`);
        }
      }
    }
  }, [online, cachedForms, router]);

  // Load cached forms
  const loadCachedForms = useCallback(async () => {
    const forms = await getAllCachedForms();
    setCachedForms(forms);
  }, []);

  // Load pending submissions
  const loadPendingSubmissions = useCallback(async () => {
    const pending = await getPendingSubmissions();
    setPendingSubmissions(pending);
    setPendingCount(pending.length);
  }, []);

  // Load cached student count
  const loadStudentCount = useCallback(async () => {
    try {
      const { db } = await import('@/lib/db');
      const count = await db.cachedStudents.count();
      setStudentCount(count);
    } catch (e) {
      console.error('Failed to load student count:', e);
    }
  }, []);

  // Load assessments (from cache first, then API if online)
  const loadAssessments = useCallback(async () => {
    // Always load from cache first
    let cached = await getCachedAssessments();

    // Filter by class if needed
    if (selectedClass !== 'all') {
      cached = cached.filter(a => a.class_grade === selectedClass);
    }

    if (cached.length > 0) {
      setAssessments(cached);
    }

    // If online, fetch fresh data from API
    if (online) {
      try {
        // Use forceSyncAssessments so it goes through the cache and pruning pipeline
        const data = await forceSyncAssessments();

        let filtered = data;
        if (selectedClass !== 'all') {
          filtered = filtered.filter(a => a.class_grade === selectedClass);
        }

        setAssessments(filtered);
        await loadCachedForms();
      } catch (err) {
        console.error('Failed to sync assessments on load:', err);
      }
    }
  }, [selectedClass, loadCachedForms, online]);

  // Initial load
  useEffect(() => {
    initSyncListeners();
    checkActualConnectivity().then(setOnline);
    setMounted(true);

    const handleNetworkChange = () => {
      checkActualConnectivity().then(setOnline);
    };

    window.addEventListener('online', handleNetworkChange);
    window.addEventListener('offline', handleNetworkChange);

    // Periodic recheck every 15 seconds
    const connectivityInterval = setInterval(() => {
      checkActualConnectivity().then(setOnline);
    }, 15000);

    // Listen for sync status changes
    const unsubscribe = onSyncStatusChange((status) => {
      setSyncStatus(status);
      if (!status.isSyncing) {
        loadPendingSubmissions();
        loadCachedForms();
        loadStudentCount();
      }
    });

    async function loadData() {
      setLoading(true);

      const [cached, lastSync, session] = await Promise.all([
        hasSchoolsCache(),
        getLastSchoolsSyncTime(),
        getTeacherSession()
      ]);

      setHasCache(cached);
      setLastSchoolsSync(lastSync);
      setTeacherSession(session);

      await loadCachedForms();
      await loadAssessments();
      await loadPendingSubmissions();
      await loadStudentCount();

      if (session) {
        // Count removal per user request
      }

      const actuallyOnline = await checkActualConnectivity();
      if (actuallyOnline) {
        triggerSync().catch(console.error);
      }

      setLoading(false);
    }

    loadData();

    return () => {
      window.removeEventListener('online', handleNetworkChange);
      window.removeEventListener('offline', handleNetworkChange);
      clearInterval(connectivityInterval);
      unsubscribe();
    };
  }, [loadCachedForms, loadAssessments, loadPendingSubmissions]);

  // Refresh assessments when class filter changes
  useEffect(() => {
    if (!loading) {
      loadAssessments();
    }
  }, [selectedClass, loadAssessments, loading]);

  // Manual sync handlers
  const handleSyncSchools = async () => {
    if (!online) return;
    setSyncingSchools(true);
    try {
      await forceSyncSchools();
      setHasCache(true);
      setLastSchoolsSync(new Date());
    } catch (err) {
      setError('Failed to sync schools');
    } finally {
      setSyncingSchools(false);
    }
  };

  const handleSyncAssessments = async () => {
    if (!online) return;
    setSyncingAssessments(true);
    try {
      const data = await forceSyncAssessments();
      setAssessments(data);
      await loadCachedForms();
    } catch (err) {
      setError('Failed to sync assessments');
    } finally {
      setSyncingAssessments(false);
    }
  };

  const handleSyncStudents = async () => {
    if (!online) return;
    setSyncingStudents(true);
    try {
      await forceSyncStudents();
      await loadStudentCount();
    } catch (err) {
      setError('Failed to sync students');
    } finally {
      setSyncingStudents(false);
    }
  };

  const handleSyncAll = async () => {
    if (!online) return;
    await triggerSync();
    await loadPendingSubmissions();
    await loadStudentCount();
  };

  // Get cached form IDs for highlighting
  const cachedFormIds = new Set(cachedForms.map(f => f.formId));

  // Filter assessments: when offline, only show cached ones
  // If assessments is empty but we have cached forms, derive from cached forms
  let displayedAssessments: Assessment[];
  if (!online) {
    const filteredFromAssessments = assessments.filter(a => cachedFormIds.has(a.assessment_id));
    if (filteredFromAssessments.length > 0) {
      displayedAssessments = filteredFromAssessments;
    } else {
      // Derive from cached forms if assessments cache is empty
      displayedAssessments = cachedForms.map(f => ({
        assessment_id: f.formId,
        title: f.formData.title,
        description: f.formData.description || null,
        class_grade: f.formData.class_grade || 0,
        language: undefined,
        languages: f.formData.languages || ['English'],
        group_identifier: undefined,
        academic_year: undefined
      }));
    }
  } else {
    displayedAssessments = assessments;
  }

  // Apply class filter (critical for offline when deriving from cached forms)
  if (selectedClass !== 'all') {
    displayedAssessments = displayedAssessments.filter(a => a.class_grade === selectedClass);
  }

  // Group assessments by class
  const groupedAssessments = displayedAssessments.reduce((groups, assessment) => {
    const grade = assessment.class_grade;
    if (!groups[grade]) {
      groups[grade] = [];
    }
    groups[grade].push(assessment);
    return groups;
  }, {} as Record<number, Assessment[]>);

  const classOptions = [4, 5, 6, 7, 8, 9, 10];

  return (
    <div className="app-container">
      {/* Sidebar - Desktop */}
      <aside className="app-sidebar">
        <div className="sidebar-header" style={{ paddingBottom: '16px', borderBottom: '1.5px solid var(--color-border)' }}>
          <img src="/pijamLogo.svg" alt="PiJam Logo" style={{ height: '36px', width: 'auto', display: 'block' }} />
          {mounted && (
            <span className={`status-badge ${online ? 'online' : 'offline'}`} style={{ fontSize: '11px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>{online ? 'wifi' : 'wifi_off'}</span>
              {online ? 'Online' : 'Offline'}
            </span>
          )}
        </div>

        {/* Sync Controls */}
        <div className="sidebar-section">
          <h3>Data Sync</h3>

          <div className="sync-item">
            <div className="sync-info">
              <span className="sync-label">Schools</span>
              {lastSchoolsSync ? (
                <span className="sync-time">
                  {formatTimeAgo(lastSchoolsSync)}
                </span>
              ) : (
                <span className="sync-time never">Never synced</span>
              )}
            </div>
            <button
              onClick={handleSyncSchools}
              disabled={!online || syncingSchools}
              className="sync-btn"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {syncingSchools ? (
                <span className="mini-spinner" />
              ) : (
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>sync</span>
              )}
            </button>
          </div>

          <div className="sync-item">
            <div className="sync-info">
              <span className="sync-label">Assessments</span>
              <span className="sync-count">{assessments.length} loaded</span>
            </div>
            <button
              onClick={handleSyncAssessments}
              disabled={!online || syncingAssessments}
              className="sync-btn"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {syncingAssessments ? (
                <span className="mini-spinner" />
              ) : (
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>sync</span>
              )}
            </button>
          </div>

          <div className="sync-item">
            <div className="sync-info">
              <span className="sync-label">Students</span>
              <span className="sync-count">{studentCount} loaded</span>
            </div>
            <button
              onClick={handleSyncStudents}
              disabled={!online || syncingStudents}
              className="sync-btn"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {syncingStudents ? (
                <span className="mini-spinner" />
              ) : (
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>sync</span>
              )}
            </button>
          </div>
        </div>

        {/* Pending Submissions */}
        {pendingCount > 0 && (
          <div className="sidebar-section">
            <h3>Pending Submissions</h3>
            <div className="pending-submissions-list">
              {pendingSubmissions.slice(0, 5).map((sub) => (
                <div key={sub.localId} className="pending-submission-item">
                  <div className="pending-sub-info">
                    <span className="pending-sub-name">{sub.studentFirstName} {sub.studentLastName}</span>
                    <span className={`pending-sub-status ${sub.status}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                      {sub.status === 'pending' && <><span className="material-symbols-rounded" style={{ fontSize: '12px' }}>schedule</span> Waiting</>}
                      {sub.status === 'syncing' && <><span className="material-symbols-rounded" style={{ fontSize: '12px', animation: 'spin 1s linear infinite' }}>sync</span> Syncing</>}
                      {sub.status === 'failed' && <><span className="material-symbols-rounded" style={{ fontSize: '12px' }}>error</span> Failed</>}
                    </span>
                  </div>
                </div>
              ))}
              {pendingSubmissions.length > 5 && (
                <span className="pending-more">
                  +{pendingSubmissions.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}



        {/* Teacher Portal */}
        <div className="sidebar-section teacher-section">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>school</span>
            Teacher Portal
          </h3>
          {teacherSession ? (
            <>
              <div className="teacher-info">
                <span className="teacher-name">{teacherSession.fullName}</span>
                <span className="teacher-role">{teacherSession.role}</span>
              </div>
              <Link href="/grading" className="teacher-link" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>edit_note</span>
                Grading Dashboard
              </Link>
              <button
                onClick={async () => {
                  await logoutTeacher();
                  setTeacherSession(null);
                }}
                className="logout-btn"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>logout</span>
                Logout
              </button>
            </>
          ) : (
            <Link href="/login" className="teacher-login-link" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>vpn_key</span>
              Teacher Login
            </Link>
          )}
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="mobile-header">
        <img src="/pijamLogo.svg" alt="PiJam Logo" style={{ height: '30px', width: 'auto', display: 'block' }} />
        <div className="mobile-header-right">
          {mounted && (
            <span className={`status-badge ${online ? 'online' : 'offline'}`} style={{ fontSize: '11px', padding: '2px 6px', display: 'inline-flex', alignItems: 'center' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>{online ? 'wifi' : 'wifi_off'}</span>
            </span>
          )}
          {pendingCount > 0 && (
            <span className="mobile-pending-badge">{pendingCount}</span>
          )}
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            <span className="material-symbols-rounded">menu</span>
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMobileMenuOpen(false)}>
          <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-menu-header">
              <span>Menu</span>
              <button onClick={() => setMobileMenuOpen(false)} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>close</span>
              </button>
            </div>

            {pendingCount > 0 && (
              <div className="mobile-menu-section">
                <h4>Pending Submissions ({pendingCount})</h4>
                {pendingSubmissions.slice(0, 3).map((sub) => (
                  <div key={sub.localId} className="mobile-pending-item">
                    {sub.studentFirstName} {sub.studentLastName} - {sub.status}
                  </div>
                ))}
              </div>
            )}

            {cachedForms.length > 0 && (
              <div className="mobile-menu-section">
                <h4>Saved Offline ({cachedForms.length})</h4>
                {cachedForms.map(form => (
                  <Link
                    key={form.formId}
                    href={`/forms/${form.formId}`}
                    className="mobile-cached-item"
                    onClick={() => setMobileMenuOpen(false)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>save</span>
                    {form.formData.title}
                  </Link>
                ))}
              </div>
            )}

            {/* Teacher Portal - Mobile */}
            <div className="mobile-menu-section" style={{ borderTop: '1px solid #eee', paddingTop: '16px', marginTop: '16px' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>school</span>
                Teacher Portal
              </h4>
              {teacherSession ? (
                <>
                  <div style={{ marginBottom: '12px', fontSize: '14px', color: '#666' }}>
                     {teacherSession.fullName}
                  </div>
                  <Link
                    href="/grading"
                    className="mobile-cached-item"
                    onClick={() => setMobileMenuOpen(false)}
                    style={{ background: '#f0f4ff', color: '#4c6ef5', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>edit_note</span>
                    Grading Dashboard
                  </Link>
                  <button
                    onClick={async () => {
                      await logoutTeacher();
                      setTeacherSession(null);
                      setMobileMenuOpen(false);
                    }}
                    className="logout-btn"
                    style={{ width: '100%', marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>logout</span>
                    Logout
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  className="mobile-cached-item"
                  onClick={() => setMobileMenuOpen(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>vpn_key</span>
                  Teacher Login
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="app-main">
        <header className="main-header" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '32px',
          paddingBottom: '16px',
          borderBottom: '1px solid var(--color-border)'
        }}>
          <img src="/pijamLogo.svg" alt="PiJam Logo" style={{ height: '32px', width: 'auto' }} />
          <h1 style={{
            fontSize: '24px',
            fontWeight: 600,
            margin: 0,
            color: 'var(--color-text)',
            fontFamily: 'var(--font-sans)'
          }}>
            PiPulse Assessment Portal
          </h1>
        </header>

        {/* Class Filter */}
        <div className="filter-bar">
          <label className="filter-label">Class:</label>
          <div className="filter-chips">
            <button
              className={`filter-chip ${selectedClass === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedClass('all')}
            >
              All
            </button>
            {classOptions.map((grade) => (
              <button
                key={grade}
                className={`filter-chip ${selectedClass === grade ? 'active' : ''}`}
                onClick={() => setSelectedClass(grade)}
              >
                {grade}
              </button>
            ))}
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="loading-state">
            <div className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <p>Loading assessments...</p>
          </div>
        )}

        {/* Offline Mode Banner */}
        {mounted && !online && !loading && (
          <div className="offline-banner">
            <span className="offline-banner-icon">
              <span className="material-symbols-rounded" style={{ fontSize: '28px', color: '#b06000' }}>wifi_off</span>
            </span>
            <div className="offline-banner-content">
              <strong>You are offline</strong>
              <span>Only showing saved forms. {cachedForms.length} form(s) available.</span>
            </div>
          </div>
        )}

        {/* Syncing Banner */}
        {syncStatus?.isSyncing && (
          <div className="sync-banner">
            <span className="mini-spinner" />
            <span>Syncing data...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="error-banner">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px', color: 'var(--color-error)' }}>warning</span>
              {error}
            </span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* Assessments Grid */}
        {!loading && (
          <div className="assessments-grid">
            {selectedClass === 'all' ? (
              Object.entries(groupedAssessments)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([grade, items]) => (
                  <div key={grade} className="class-group">
                    <h2 className="class-header">Class {grade}</h2>
                    <div className="cards-row">
                      {groupAssessmentsByIdentifier(items).map((group) => (
                        <AssessmentGroupCard
                          key={group.id}
                          group={group}
                          cachedFormIds={cachedFormIds}
                          isOffline={!online}
                        />
                      ))}
                    </div>
                  </div>
                ))
            ) : (
              <div className="cards-row">
                {groupAssessmentsByIdentifier(displayedAssessments).map((group) => (
                  <AssessmentGroupCard
                    key={group.id}
                    group={group}
                    cachedFormIds={cachedFormIds}
                    isOffline={!online}
                  />
                ))}
              </div>
            )}

            {displayedAssessments.length === 0 && !loading && (
              <div className="empty-state">
                {!online ? (
                  <>
                    <p>No saved forms available offline.</p>
                    <p className="hint">Save forms while online to use them offline.</p>
                  </>
                ) : (
                  <p>No assessments available{selectedClass !== 'all' ? ` for Class ${selectedClass}` : ''}.</p>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// Helper to group assessments by group_identifier
interface AssessmentGroup {
  id: string;
  title: string;
  description: string | null;
  class_grade: number;
  assessments: Assessment[];
}

function groupAssessmentsByIdentifier(assessments: Assessment[]): AssessmentGroup[] {
  const groups: Record<string, AssessmentGroup> = {};

  for (const a of assessments) {
    // If group_identifier exists, use it.
    // Otherwise, generate a composite key from class and title to group identical assessments
    // that might just differ by language.
    const key = a.group_identifier || `${a.class_grade}_${a.title.trim().toLowerCase()}`;

    if (!groups[key]) {
      groups[key] = {
        id: key,
        title: a.title,
        description: a.description,
        class_grade: a.class_grade,
        assessments: []
      };
    }

    groups[key].assessments.push(a);
  }

  return Object.values(groups);
}

function AssessmentGroupCard({
  group,
  cachedFormIds,
  isOffline
}: {
  group: AssessmentGroup;
  cachedFormIds: Set<number>;
  isOffline: boolean;
}) {
  const [showLanguages, setShowLanguages] = useState(false);

  // Derive the list of all language variants for this assessment group.
  const variants: { assessment_id: number; language: string }[] = [];
  
  for (const a of group.assessments) {
    if (a.languages && a.languages.length > 0) {
      for (const lang of a.languages) {
        if (!variants.some(v => v.assessment_id === a.assessment_id && v.language === lang)) {
          variants.push({ assessment_id: a.assessment_id, language: lang });
        }
      }
    } else {
      const lang = a.language || 'English';
      if (!variants.some(v => v.assessment_id === a.assessment_id && v.language === lang)) {
        variants.push({ assessment_id: a.assessment_id, language: lang });
      }
    }
  }

  // Sorting: English first, then others alphabetically
  const sortedVariants = [...variants].sort((a, b) => {
    if (a.language === 'English') return -1;
    if (b.language === 'English') return 1;
    return a.language.localeCompare(b.language);
  });

  // If only 1 language variant exists in the entire group, show direct link
  if (sortedVariants.length === 1) {
    const variant = sortedVariants[0];
    const isCached = cachedFormIds.has(variant.assessment_id);
    const isDisabled = isOffline && !isCached;
    const lang = variant.language;

    return (
      <Link
        href={isDisabled ? '#' : `/forms/${variant.assessment_id}?lang=${lang}`}
        className={`assessment-card ${isDisabled ? 'disabled' : ''}`}
        aria-disabled={isDisabled}
      >
        <div className="card-header">
          <span className="card-class">Class {group.class_grade}</span>
          {isCached && <span className="card-cached" style={{ display: 'inline-flex', alignItems: 'center' }}><span className="material-symbols-rounded" style={{ fontSize: '16px', color: 'var(--color-success)' }}>save</span></span>}
          {lang && lang !== 'English' && (
            <span
              className="card-lang-badge"
              style={{
                fontSize: '10px',
                background: 'var(--color-secondary)',
                padding: '2px 6px',
                borderRadius: '4px',
                marginLeft: '6px',
                color: 'var(--color-text-secondary)',
                verticalAlign: 'middle'
              }}
            >
              {lang}
            </span>
          )}
        </div>
        <h3 className="card-title">{group.title}</h3>
        {group.description && <p className="card-desc">{group.description}</p>}
        <div className="card-footer">
          <span className="card-action" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {isDisabled ? (
              <>
                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>cloud_off</span>
                Not saved
              </>
            ) : (
              <>
                Start
                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>arrow_forward</span>
              </>
            )}
          </span>
        </div>
      </Link>
    );
  }

  // Multiple languages -> Selection UI
  return (
    <div className={`assessment-card ${showLanguages ? 'expanded' : ''}`}>
      <div className="card-header">
        <span className="card-class">Class {group.class_grade}</span>
        <span
          className="card-lang-count"
          style={{
            fontSize: '11px',
            background: 'var(--color-secondary)',
            padding: '2px 8px',
            borderRadius: '10px',
            color: 'var(--color-text-secondary)'
          }}
        >
          {sortedVariants.length} Languages
        </span>
      </div>
      <h3 className="card-title">{group.title}</h3>
      {group.description && !showLanguages && (
        <p className="card-desc">{group.description}</p>
      )}

      {showLanguages ? (
        <div
          className="lang-selection"
          style={{
            marginTop: '16px',
            paddingTop: '16px',
            borderTop: '1px solid var(--color-border)',
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <p
            className="lang-label"
            style={{
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
              margin: '0 0 12px'
            }}
          >
            Select Language:
          </p>
          <div
            className="lang-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: '8px',
              marginBottom: '16px'
            }}
          >
            {sortedVariants.map(v => {
              const isCached = cachedFormIds.has(v.assessment_id);
              const isDisabled = isOffline && !isCached;
              return (
                <Link
                  key={`${v.assessment_id}-${v.language}`}
                  href={isDisabled ? '#' : `/forms/${v.assessment_id}?lang=${v.language}`}
                  className={`lang-btn ${isDisabled ? 'disabled' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    background: isDisabled ? 'var(--color-bg)' : 'var(--color-secondary)',
                    border: '1px solid transparent',
                    borderRadius: 'var(--radius)',
                    textDecoration: 'none',
                    fontSize: '13px',
                    color: 'var(--color-text)',
                    opacity: isDisabled ? 0.5 : 1,
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  <span>{v.language}</span>
                  {isCached && (
                    <span className="material-symbols-rounded" style={{ fontSize: '14px', color: 'var(--color-success)' }}>
                      save
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
          <button
            className="cancel-lang-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowLanguages(false);
            }}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline'
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="card-footer">
          <button
            className="card-action-btn"
            onClick={() => setShowLanguages(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            Select Language
            <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>arrow_forward</span>
          </button>
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
