'use client';
import React, { useState, useEffect } from 'react';
import { db } from '@/lib/db';

export function OfflineImage({ src, alt, className, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
    const [imgSrc, setImgSrc] = useState(src);

    useEffect(() => {
        if (!src) return;

        // Ensure src is a string before checking methods
        if (typeof src !== 'string') return;

        // If it's already a blob or data URL, ignore
        if (src.startsWith('blob:') || src.startsWith('data:')) {
            setImgSrc(src);
            return;
        }

        let active = true;
        let objectUrl: string | null = null;

        const loadCached = async () => {
            try {
                // Try fetching from local DB
                const cached = await db.cachedImages.get(src);
                if (active && cached) {
                    objectUrl = URL.createObjectURL(cached.blob);
                    setImgSrc(objectUrl);
                }
            } catch (e) {
                console.error('Error loading offline image:', e);
            }
        };

        loadCached();

        return () => {
            active = false;
            // Clean up object URL when component unmounts or src changes
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [src]);

    return <img src={imgSrc} alt={alt} className={className} {...props} />;
}
