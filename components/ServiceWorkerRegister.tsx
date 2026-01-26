'use client';

import { useEffect } from 'react';

// Production (Subpath): When deploying to a server where the app lives at /pijamfront, you just need to set one environment variable:
// bash
// NEXT_PUBLIC_BASE_PATH=/pijamfront

export function ServiceWorkerRegister() {
    useEffect(() => {
        if ('serviceWorker' in navigator) {
            const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
            navigator.serviceWorker
                .register(`${basePath}/sw.js`)
                .then((registration) => {
                    console.log('SW registered:', registration.scope);
                })
                .catch((error) => {
                    console.log('SW registration failed:', error);
                });
        }
    }, []);

    return null;
}
