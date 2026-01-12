/**
 * Offline Status Component
 * 
 * Displays current network status and pending sync information.
 * Shows a banner when offline or when there are pending submissions.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { isOnline, onSyncStatusChange, triggerSync, type SyncStatus } from '@/lib/sync';
import { getPendingSubmissionCount } from '@/lib/db';

export function OfflineStatus() {
    const [online, setOnline] = useState(true);
    const [pendingCount, setPendingCount] = useState(0);
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

    useEffect(() => {
        // Set initial state
        setOnline(isOnline());

        // Load pending count
        getPendingSubmissionCount().then(setPendingCount);

        // Listen for online/offline events
        const handleOnline = () => setOnline(true);
        const handleOffline = () => setOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Listen for sync status changes
        const unsubscribe = onSyncStatusChange((status) => {
            setSyncStatus(status);
            setPendingCount(status.pendingCount);
        });

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            unsubscribe();
        };
    }, []);

    const handleManualSync = async () => {
        await triggerSync();
        const count = await getPendingSubmissionCount();
        setPendingCount(count);
    };

    // Don't show anything if online and no pending
    if (online && pendingCount === 0 && !syncStatus?.isSyncing) {
        return null;
    }

    return (
        <div className={`offline-status ${online ? 'online' : 'offline'}`}>
            <div className="status-content">
                {/* Status indicator */}
                <div className="status-indicator">
                    <span className={`status-dot ${online ? 'online' : 'offline'}`} />
                    <span className="status-text">
                        {online ? 'Online' : 'Offline'}
                    </span>
                </div>

                {/* Pending submissions */}
                {pendingCount > 0 && (
                    <div className="pending-info">
                        <span className="pending-badge">{pendingCount}</span>
                        <span className="pending-text">
                            pending submission{pendingCount !== 1 ? 's' : ''}
                        </span>
                    </div>
                )}

                {/* Sync status */}
                {syncStatus?.isSyncing && (
                    <div className="sync-info">
                        <span className="sync-spinner" />
                        <span>Syncing...</span>
                    </div>
                )}

                {/* Sync error */}
                {syncStatus?.error && (
                    <div className="sync-error">
                        <span className="error-text">Sync failed: {syncStatus.error}</span>
                    </div>
                )}

                {/* Manual sync button */}
                {online && pendingCount > 0 && !syncStatus?.isSyncing && (
                    <button onClick={handleManualSync} className="sync-button">
                        Sync Now
                    </button>
                )}
            </div>
        </div>
    );
}

/**
 * Compact offline indicator for form headers
 */
export function OfflineIndicator() {
    const [online, setOnline] = useState(true);

    useEffect(() => {
        setOnline(isOnline());

        const handleOnline = () => setOnline(true);
        const handleOffline = () => setOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    if (online) return null;

    return (
        <div className="offline-indicator">
            <span className="offline-icon">📡</span>
            <span>Offline Mode</span>
        </div>
    );
}
