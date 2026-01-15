/**
 * Landing Page
 * 
 * Full-width layout with cached forms, manual sync buttons, and subtle loading.
 * Mobile-friendly with bottom navigation.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
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
  isOnline,
  forceSyncSchools,
  forceSyncAssessments,
  onSyncStatusChange,
  type SyncStatus
} from '@/lib/sync';

interface Assessment {
  assessment_id: number;
  title: string;
  description: string | null;
  class_grade: number;
  language?: string;
  group_identifier?: string;
  academic_year?: string;
}

export default function HomePage() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [cachedForms, setCachedForms] = useState<CachedForm[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = useState<OfflineSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingAssessments, setSyncingAssessments] = useState(false);
  const [syncingSchools, setSyncingSchools] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [hasCache, setHasCache] = useState(false);
  const [lastSchoolsSync, setLastSchoolsSync] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [selectedClass, setSelectedClass] = useState<number | 'all'>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    if (isOnline()) {
      try {
        const url = selectedClass === 'all'
          ? '/api/assessments'
          : `/api/assessments?class=${selectedClass}`;
        const response = await fetch(url);

        if (response.ok) {
          const data = await response.json();
          setAssessments(data);
        }
      } catch (err) {
        console.error('Failed to fetch assessments:', err);
      }
    }
  }, [selectedClass]);

  // Initial load
  useEffect(() => {
    initSyncListeners();
    setOnline(isOnline());
    setMounted(true);

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listen for sync status changes
    const unsubscribe = onSyncStatusChange((status) => {
      setSyncStatus(status);
      if (!status.isSyncing) {
        loadPendingSubmissions();
      }
    });

    async function loadData() {
      setLoading(true);

      const [cached, lastSync] = await Promise.all([
        hasSchoolsCache(),
        getLastSchoolsSyncTime()
      ]);

      setHasCache(cached);
      setLastSchoolsSync(lastSync);

      await loadCachedForms();
      await loadAssessments();
      await loadPendingSubmissions();

      if (isOnline()) {
        triggerSync().catch(console.error);
      }

      setLoading(false);
    }

    loadData();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
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
    } catch (err) {
      setError('Failed to sync assessments');
    } finally {
      setSyncingAssessments(false);
    }
  };

  const handleSyncAll = async () => {
    if (!online) return;
    await triggerSync();
    await loadPendingSubmissions();
  };

  // Get cached form IDs for highlighting
  const cachedFormIds = new Set(cachedForms.map(f => f.formId));

  // Filter assessments: when offline, only show cached ones
  const displayedAssessments = !online
    ? assessments.filter(a => cachedFormIds.has(a.assessment_id))
    : assessments;

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
        <div className="sidebar-header">
          <h2>📝 PiJam</h2>
          {mounted && (
            <span className={`status-badge ${online ? 'online' : 'offline'}`}>
              {online ? '● Online' : '○ Offline'}
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
            >
              {syncingSchools ? <span className="mini-spinner" /> : '↻'}
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
            >
              {syncingAssessments ? <span className="mini-spinner" /> : '↻'}
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
                    <span className={`pending-sub-status ${sub.status}`}>
                      {sub.status === 'pending' && '⏳ Waiting'}
                      {sub.status === 'syncing' && '⟳ Syncing'}
                      {sub.status === 'failed' && '✗ Failed'}
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
            {online && (
              <button
                onClick={handleSyncAll}
                className="sync-all-btn"
                disabled={syncStatus?.isSyncing}
              >
                {syncStatus?.isSyncing ? (
                  <>
                    <span className="mini-spinner" /> Syncing...
                  </>
                ) : (
                  '↻ Sync All'
                )}
              </button>
            )}
          </div>
        )}

        {/* Saved Forms */}
        {cachedForms.length > 0 && (
          <div className="sidebar-section">
            <h3>Saved for Offline</h3>
            <div className="cached-forms-list">
              {cachedForms.map(form => (
                <Link
                  key={form.formId}
                  href={`/forms/${form.formId}`}
                  className="cached-form-item"
                >
                  <span className="cached-icon">💾</span>
                  <span className="cached-title">{form.formData.title}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Header */}
      <div className="mobile-header">
        <h2>📝 PiJam</h2>
        <div className="mobile-header-right">
          {mounted && (
            <span className={`status-badge ${online ? 'online' : 'offline'}`}>
              {online ? '●' : '○'}
            </span>
          )}
          {pendingCount > 0 && (
            <span className="mobile-pending-badge">{pendingCount}</span>
          )}
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            ☰
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMobileMenuOpen(false)}>
          <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-menu-header">
              <span>Menu</span>
              <button onClick={() => setMobileMenuOpen(false)}>✕</button>
            </div>

            {pendingCount > 0 && (
              <div className="mobile-menu-section">
                <h4>Pending Submissions ({pendingCount})</h4>
                {pendingSubmissions.slice(0, 3).map((sub) => (
                  <div key={sub.localId} className="mobile-pending-item">
                    {sub.studentFirstName} {sub.studentLastName} - {sub.status}
                  </div>
                ))}
                {online && (
                  <button onClick={handleSyncAll} className="mobile-sync-btn">
                    ↻ Sync All
                  </button>
                )}
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
                  >
                    💾 {form.formData.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="app-main">
        <header className="main-header">
          <h1>Submit Assessment</h1>
          <p>Select an assessment to complete and submit</p>
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
            <span className="offline-banner-icon">📡</span>
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
            <span>⚠️ {error}</span>
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

  // Sorting: English first, then others
  const sortedAssessments = [...group.assessments].sort((a, b) => {
    if (a.language === 'English') return -1;
    if (b.language === 'English') return 1;
    return (a.language || '').localeCompare(b.language || '');
  });

  // If only 1 assessment, show direct link
  if (sortedAssessments.length === 1) {
    const assessment = sortedAssessments[0];
    const isCached = cachedFormIds.has(assessment.assessment_id);
    const isDisabled = isOffline && !isCached;
    const lang = assessment.language || 'English';

    return (
      <Link
        href={isDisabled ? '#' : `/forms/${assessment.assessment_id}`}
        className={`assessment-card ${isDisabled ? 'disabled' : ''}`}
        aria-disabled={isDisabled}
      >
        <div className="card-header">
          <span className="card-class">Class {group.class_grade}</span>
          {isCached && <span className="card-cached">💾</span>}
          {assessment.language && assessment.language !== 'English' && (
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
              {assessment.language}
            </span>
          )}
        </div>
        <h3 className="card-title">{group.title}</h3>
        {group.description && <p className="card-desc">{group.description}</p>}
        <div className="card-footer">
          <span className="card-action">
            {isDisabled ? '🔒 Not saved' : 'Start →'}
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
          {group.assessments.length} Languages
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
            {sortedAssessments.map(a => {
              const isCached = cachedFormIds.has(a.assessment_id);
              const isDisabled = isOffline && !isCached;
              return (
                <Link
                  key={a.assessment_id}
                  href={isDisabled ? '#' : `/forms/${a.assessment_id}`}
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
                  <span>{a.language || 'English'}</span>
                  {isCached && <span className="mini-disk">💾</span>}
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
          >
            Select Language →
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
