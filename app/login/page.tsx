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
    const [showPassword, setShowPassword] = useState(false);
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
                    <img src="/pijamLogo.svg" alt="PiJam Logo" className="login-logo" />
                    <p>Teacher Portal Login</p>
                </div>

                {!online && (
                    <div className="login-offline-banner flex items-center gap-2">
                        <span className="material-symbols-rounded" style={{ fontSize: '20px', color: '#856404' }}>wifi_off</span>
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
                        <div className="password-input-wrapper">
                            <input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter your password"
                                disabled={loading || !online}
                                autoComplete="current-password"
                            />
                            <button
                                type="button"
                                className="password-toggle"
                                onClick={() => setShowPassword(!showPassword)}
                                title={showPassword ? "Hide password" : "Show password"}
                            >
                                {showPassword ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                )}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="login-error flex items-center gap-2">
                            <span className="material-symbols-rounded" style={{ fontSize: '18px', color: 'var(--color-error)' }}>warning</span>
                            <span>{error}</span>
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
                    background: linear-gradient(135deg, var(--color-primary) 0%, #15223e 100%);
                }

                .login-card {
                    background: white;
                    border-radius: var(--radius-lg);
                    padding: 40px;
                    width: 100%;
                    max-width: 400px;
                    box-shadow: var(--shadow-lg);
                    border: 1px solid var(--color-border);
                }

                .login-header {
                    text-align: center;
                    margin-bottom: 32px;
                }

                .login-logo {
                    height: 56px;
                    width: auto;
                    margin: 0 auto 16px;
                    display: block;
                }

                .login-header p {
                    color: var(--color-text-secondary);
                    margin: 0;
                    font-size: 15px;
                    font-weight: 500;
                }

                .login-offline-banner {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px;
                    background: #fff3cd;
                    border-radius: var(--radius-sm);
                    margin-bottom: 20px;
                    font-size: 14px;
                    color: #856404;
                    border: 1px solid #ffeeba;
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
                    font-weight: 600;
                    color: var(--color-primary);
                    font-size: 14px;
                }

                .form-group input {
                    padding: 12px 16px;
                    border: 1.5px solid var(--color-border);
                    border-radius: var(--radius-md);
                    font-size: 16px;
                    font-family: var(--font-sans);
                    transition: border-color 0.2s, box-shadow 0.2s;
                    color: var(--color-text);
                    background-color: var(--color-bg);
                }

                .form-group input:focus {
                    outline: none;
                    border-color: var(--color-accent);
                    box-shadow: 0 0 0 3px rgba(78, 205, 196, 0.25);
                    background-color: white;
                }

                .form-group input:disabled {
                    background: #e2e8f0;
                    cursor: not-allowed;
                    opacity: 0.7;
                }

                .password-input-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                }

                .password-input-wrapper input {
                    width: 100%;
                    padding-right: 44px;
                }

                .password-toggle {
                    position: absolute;
                    right: 12px;
                    background: none;
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 6px;
                    transition: opacity 0.2s;
                }

                .password-toggle:hover {
                    opacity: 0.7;
                }
                
                .password-toggle:focus {
                    outline: none;
                }

                .login-error {
                    padding: 12px;
                    background: #fee2e2;
                    border: 1.5px solid #fca5a5;
                    border-radius: var(--radius-sm);
                    color: var(--color-error);
                    font-size: 14px;
                    font-weight: 500;
                }

                .login-button {
                    padding: 14px 24px;
                    background: linear-gradient(135deg, var(--color-primary) 0%, #1c2e54 100%);
                    color: white;
                    border: none;
                    border-radius: var(--radius-md);
                    font-size: 16px;
                    font-weight: 600;
                    font-family: var(--font-sans);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    transition: transform 0.2s, box-shadow 0.2s, background-color 0.2s;
                }

                .login-button:hover:not(:disabled) {
                    transform: translateY(-1.5px);
                    box-shadow: 0 6px 20px rgba(27, 43, 78, 0.35);
                    background: linear-gradient(135deg, #223762 0%, #172647 100%);
                }

                .login-button:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
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
                    background: var(--color-accent);
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
