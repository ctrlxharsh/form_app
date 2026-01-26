/**
 * Client Layout Wrapper
 * 
 * Wraps the app with client-side components that need 'use client'.
 * This includes the AuthGuard for route protection.
 */

'use client';

import React, { ReactNode } from 'react';
import { AuthGuard } from './AuthGuard';

interface ClientLayoutProps {
    children: ReactNode;
}

export function ClientLayout({ children }: ClientLayoutProps) {
    return <AuthGuard>{children}</AuthGuard>;
}
