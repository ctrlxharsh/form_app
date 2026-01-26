/**
 * Login Page
 * 
 * Teacher authentication - must be online to login.
 * Stores session in IndexedDB for offline persistence.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loginTeacher, isTeacherLoggedIn } from '@/lib/auth';
import { forceSyncSchools } from '@/lib/sync';

export default function LoginPage() {
    const router = useRouter();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [online, setOnline] = useState(true);
    const [checkingSession, setCheckingSession] = useState(true);

    // Check if already logged in
    useEffect(() => {
        async function checkSession() {
            const loggedIn = await isTeacherLoggedIn();
            if (loggedIn) {
                router.push('/');
            } else {
                setCheckingSession(false);
            }
        }
        checkSession();

        setOnline(navigator.onLine);
        const handleOnline = () => setOnline(true);
        const handleOffline = () => setOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!online) {
            setError('You must be online to login');
            return;
        }

        if (!username.trim() || !password.trim()) {
            setError('Please enter both username and password');
            return;
        }

        setLoading(true);
        try {
            const result = await loginTeacher({ username: username.trim(), password });
            if (result.success) {
                // Force sync schools to ensure we cache only assigned schools
                try {
                    await forceSyncSchools();
                } catch (e) {
                    console.error('Failed to sync schools on login', e);
                }
                router.push('/');
            } else {
                setError(result.error || 'Login failed');
            }
            // ...
        } catch (err) {
            setError('An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    if (checkingSession) {
        return (
            <div className="login-container">
                <div className="login-card">
                    <div className="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <h1>🎓 PiJam</h1>
                    <p>Teacher Portal Login</p>
                </div>

                {!online && (
                    <div className="login-offline-banner">
                        <span>📡</span>
                        <span>You are offline. Login requires an internet connection.</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label htmlFor="username">Username</label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter your username"
                            disabled={loading || !online}
                            autoComplete="username"
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">Password</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            disabled={loading || !online}
                            autoComplete="current-password"
                        />
                    </div>

                    {error && (
                        <div className="login-error">
                            ⚠️ {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        className="login-button"
                        disabled={loading || !online}
                    >
                        {loading ? (
                            <>
                                <span className="mini-spinner"></span>
                                Signing in...
                            </>
                        ) : (
                            'Sign In'
                        )}
                    </button>
                </form>
            </div>

            <style jsx>{`
                .login-container {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                }

                .login-card {
                    background: white;
                    border-radius: 16px;
                    padding: 40px;
                    width: 100%;
                    max-width: 400px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
                }

                .login-header {
                    text-align: center;
                    margin-bottom: 32px;
                }

                .login-header h1 {
                    font-size: 2rem;
                    margin: 0 0 8px;
                    color: #333;
                }

                .login-header p {
                    color: #666;
                    margin: 0;
                }

                .login-offline-banner {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px;
                    background: #fff3cd;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    font-size: 14px;
                    color: #856404;
                }

                .login-form {
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }

                .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .form-group label {
                    font-weight: 500;
                    color: #333;
                }

                .form-group input {
                    padding: 12px 16px;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    font-size: 16px;
                    transition: border-color 0.2s, box-shadow 0.2s;
                }

                .form-group input:focus {
                    outline: none;
                    border-color: #667eea;
                    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
                }

                .form-group input:disabled {
                    background: #f5f5f5;
                    cursor: not-allowed;
                }

                .login-error {
                    padding: 12px;
                    background: #fee;
                    border: 1px solid #fcc;
                    border-radius: 8px;
                    color: #c00;
                    font-size: 14px;
                }

                .login-button {
                    padding: 14px 24px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    transition: transform 0.2s, box-shadow 0.2s;
                }

                .login-button:hover:not(:disabled) {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
                }

                .login-button:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                .login-footer {
                    margin-top: 24px;
                    text-align: center;
                }

                .login-footer a {
                    color: #667eea;
                    text-decoration: none;
                }

                .login-footer a:hover {
                    text-decoration: underline;
                }

                .mini-spinner {
                    width: 16px;
                    height: 16px;
                    border: 2px solid rgba(255, 255, 255, 0.3);
                    border-top-color: white;
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                .loading-dots {
                    display: flex;
                    gap: 8px;
                    justify-content: center;
                }

                .loading-dots span {
                    width: 8px;
                    height: 8px;
                    background: #667eea;
                    border-radius: 50%;
                    animation: bounce 1.4s infinite ease-in-out both;
                }

                .loading-dots span:nth-child(1) { animation-delay: -0.32s; }
                .loading-dots span:nth-child(2) { animation-delay: -0.16s; }

                @keyframes bounce {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1); }
                }
            `}</style>
        </div>
    );
}
