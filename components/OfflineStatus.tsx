/**
 * Offline Status Component
 * 
 * Minimal top-right indicator showing offline status and pending submissions.
 * Uses checkActualConnectivity for reliable offline detection.
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { checkActualConnectivity, onSyncStatusChange, type SyncStatus } from '@/lib/sync';
import { getPendingSubmissionCount } from '@/lib/db';

export function OfflineStatus() {
    const [online, setOnline] = useState<boolean | null>(null); // null = checking
    const [pendingCount, setPendingCount] = useState(0);
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
    const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // Check actual connectivity on mount
        checkActualConnectivity().then(setOnline);

        // Load pending count
        getPendingSubmissionCount().then(setPendingCount);

        // Listen for browser online/offline events to trigger recheck
        const handleNetworkChange = () => {
            checkActualConnectivity().then(setOnline);
        };

        window.addEventListener('online', handleNetworkChange);
        window.addEventListener('offline', handleNetworkChange);

        // Periodically recheck connectivity (every 10 seconds)
        checkIntervalRef.current = setInterval(() => {
            checkActualConnectivity().then(setOnline);
        }, 10000);

        // Listen for sync status changes
        const unsubscribe = onSyncStatusChange((status) => {
            setSyncStatus(status);
            setPendingCount(status.pendingCount);
        });

        return () => {
            window.removeEventListener('online', handleNetworkChange);
            window.removeEventListener('offline', handleNetworkChange);
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current);
            }
            unsubscribe();
        };
    }, []);

    // Don't show anything while checking or if online with no pending
    if (online === null) return null;
    if (online && pendingCount === 0 && !syncStatus?.isSyncing) return null;

    return (
        <div className="offline-status-minimal">
            {/* Offline indicator */}
            {!online && (
                <div className="offline-badge">
                    <span className="offline-icon">📡</span>
                    <span>Offline</span>
                </div>
            )}

            {/* Pending count - show when offline or syncing */}
            {pendingCount > 0 && (
                <div className="pending-badge-minimal">
                    <span className="pending-count">{pendingCount}</span>
                    <span className="pending-label">
                        pending
                    </span>
                </div>
            )}

            {/* Syncing indicator */}
            {syncStatus?.isSyncing && (
                <div className="syncing-badge">
                    <span className="sync-spinner-small" />
                    <span>Syncing...</span>
                </div>
            )}
        </div>
    );
}

/**
 * Compact offline indicator for form headers
 */
export function OfflineIndicator() {
    const [online, setOnline] = useState<boolean | null>(null);

    useEffect(() => {
        checkActualConnectivity().then(setOnline);

        const handleNetworkChange = () => {
            checkActualConnectivity().then(setOnline);
        };

        window.addEventListener('online', handleNetworkChange);
        window.addEventListener('offline', handleNetworkChange);

        return () => {
            window.removeEventListener('online', handleNetworkChange);
            window.removeEventListener('offline', handleNetworkChange);
        };
    }, []);

    if (online === null || online) return null;

    return (
        <div className="offline-indicator">
            <span className="offline-icon">📡</span>
            <span>Offline Mode</span>
        </div>
    );
}
