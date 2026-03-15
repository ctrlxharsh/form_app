'use client';

import React, { useState, useEffect } from 'react';

interface ImagePopupProps {
    src: string;
    alt?: string;
    onClose: () => void;
}

export function ImagePopup({ src, alt, onClose }: ImagePopupProps) {
    const [scale, setScale] = useState(1);
    
    // Prevent scrolling when popup is open
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === '+' || e.key === '=') setScale(s => Math.min(s + 0.25, 4));
            if (e.key === '-') setScale(s => Math.max(s - 0.25, 0.5));
        };
        
        window.addEventListener('keydown', handleKeyDown);
        
        return () => {
            document.body.style.overflow = 'unset';
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    const handleZoomIn = () => setScale(s => Math.min(s + 0.25, 4));
    const handleZoomOut = () => setScale(s => Math.max(s - 0.25, 0.5));
    const handleReset = () => setScale(1);

    return (
        <div className="image-popup-overlay" onClick={onClose}>
            <div className="image-popup-controls" onClick={e => e.stopPropagation()}>
                <button onClick={handleZoomOut} className="zoom-btn" title="Zoom Out">-</button>
                <span className="zoom-level">{Math.round(scale * 100)}%</span>
                <button onClick={handleZoomIn} className="zoom-btn" title="Zoom In">+</button>
                <button onClick={handleReset} className="zoom-btn reset-btn" title="Reset Zoom">↺</button>
                <button onClick={onClose} className="zoom-btn close-btn" title="Close">✕</button>
            </div>
            
            <div className="image-popup-content-wrapper" onClick={e => e.stopPropagation()}>
                <img 
                    src={src} 
                    alt={alt || "Popup image"} 
                    className="image-popup-img"
                    style={{ transform: `scale(${scale})` }}
                />
            </div>
        </div>
    );
}
