/**
 * Auth Guard Component
 * 
 * Wraps protected pages and redirects to login if not authenticated.
 * Must be used as a client component wrapper.
 */

'use client';

import React, { useEffect, useState, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getTeacherSession, type TeacherSession } from '@/lib/auth';

interface AuthGuardProps {
    children: ReactNode;
}

// Pages that don't require authentication
const PUBLIC_PATHS = ['/login', '/manifest.webmanifest', '/manifest.json'];

export function AuthGuard({ children }: AuthGuardProps) {
    const router = useRouter();
    const pathname = usePathname();
    const [session, setSession] = useState<TeacherSession | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function checkAuth() {
            // Skip auth check for public paths
            if (PUBLIC_PATHS.includes(pathname)) {
                setLoading(false);
                return;
            }

            // Short timeout to prevent flash of loading screen if session retrieval is fast
            // but ensure we don't block forever
            const sess = await getTeacherSession();

            if (!sess) {
                // Not logged in - redirect to login
                router.replace('/login');
                return;
            }

            setSession(sess);
            setLoading(false);
        }

        checkAuth();
    }, [pathname, router]);

    // For public paths, render immediately
    if (PUBLIC_PATHS.includes(pathname)) {
        return <>{children}</>;
    }

    // Show loading while checking auth
    if (loading) {
        return (
            <div className="auth-loading">
                <div className="auth-loading-content">
                    <div className="loading-spinner"></div>
                    <p>Checking authentication...</p>
                </div>
                <style jsx>{`
                    .auth-loading {
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    .auth-loading-content {
                        text-align: center;
                        color: white;
                    }
                    .loading-spinner {
                        width: 40px;
                        height: 40px;
                        border: 3px solid rgba(255,255,255,0.3);
                        border-top-color: white;
                        border-radius: 50%;
                        animation: spin 0.8s linear infinite;
                        margin: 0 auto 16px;
                    }
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        );
    }

    // Not authenticated - will redirect
    if (!session) {
        return null;
    }

    // Authenticated - render children
    return <>{children}</>;
}

/**
 * Export session context for child components
 */
export { type TeacherSession };
