# PiJam Repository Skills and Guidelines

This document outlines the architectural patterns, styling standards, and development constraints for this repository. All future agents and developers must adhere strictly to these guidelines.

## Repository Overview

This application is a school assessment and grading portal designed for offline-first resilience. It allows teachers to grade student submissions, view student management rosters, and sync grades to a central server when online connectivity is available.

## Core Architectural Components

### 1. Offline Data Architecture (IndexedDB)
The application utilizes IndexedDB via Dexie.js for complete offline functionality.
- Database configurations reside in `lib/db.ts`.
- Local tables store schools, students, forms, recent submissions, offline pending grades, and image blobs.
- Offline grades are saved locally using `saveOfflineGrade` and marked as synced using `markGradesAsSynced`.

### 2. Synchronization Mechanisms
- Sync logic is managed in `lib/sync.ts` and `lib/connectivity.ts`.
- Submissions are synchronized individually or in batches to the central API when connectivity transitions from offline to online.
- High-priority handlers verify and push grades without interrupting active teaching sessions.

### 3. Authentication Flow
- Session management and teacher validation are handled in `lib/auth.ts`.
- Validation checks cache teacher sessions and verify localized dashboard passwords.

## Design and Styling System

The application has been overhauled to match thepijam.org brand identity, using Outfit as the default typography and a premium Navy and Sky Cyan color palette.

### 1. Brand Tokens
The global design tokens are declared in `app/globals.css` under the `:root` pseudo-class:
- Deep Navy: `var(--color-primary)` (#1b2b4e)
- Soft Sky Tint: `var(--color-primary-light)` (#f0f7ff)
- Accent Sky Cyan: `var(--color-accent)` (#4ecdc4)
- Text Color: `var(--color-text)` (#0f172a)
- Secondary Text: `var(--color-text-secondary)` (#475569)
- Rounded Corners: `var(--radius-sm)` (10px), `var(--radius-md)` (16px), `var(--radius-lg)` (24px)
- Shadows: `var(--shadow)`, `var(--shadow-md)`, `var(--shadow-lg)`

### 2. Typography
The primary typeface is Outfit, defined as `var(--font-sans)`. Every component, card, header, input field, and list container must use this font family.

### 3. Styling Methods
This Next.js application uses a hybrid styling architecture:
- Global utility layout styling via global CSS and Tailwind imports.
- Component-level styling via localized `<style jsx>` blocks.
- Inline styles are permitted only for quick, dynamic, or state-based attribute overlays.

When editing component styles, always modify the local `<style jsx>` block or globals.css directly to ensure consistency.

## Responsive Design Rules

Teachers frequently access this application on smartphones or tablets during classroom grading sessions. All layouts must be highly compact and responsive:
- Limit maximum content widths to 1400px, centering containers.
- Maintain high-contrast touch targets for input elements (minimum 44px height).
- Keep vertical margins and padding compact on smaller viewports to prevent excess vertical scrolling.
- Use CSS Flexbox or Grid with percentage-based or fractional layout structures rather than fixed pixel widths.

## Critical Developer Constraints

To prevent regression and logic breaks, all developers must observe the following strict constraints:

### 1. Strictly Do Not Modify Core Logic
Under no circumstances should you modify:
- Offline IndexedDB database tables, schemas, or migrations (`lib/db.ts`).
- Offline synchronization sequences, triggerSync functions, or background service workers (`lib/sync.ts`).
- Student credential validations, IndexedDB queries, and submission save pathways.
- Teacher session verification and role checks.
- API route handlers under `app/api`.

Focus your changes exclusively on layout adjustments, design polishes, styled-jsx rules, and markup updates.

### 2. Emoji Usage Ban
- Do not include any emojis in markdown files, source code files, or code comments.
- In tables and documents, use plain text values (such as "Yes", "No", "Pending", "Success") instead of emoji status markers or checkmarks.

### 3. Code Example Formats
When writing code examples or introducing new UI components, use explicit "Bad" vs "Good" labels for comparison.

// Bad: Using hardcoded color strings or non-brand typefaces
```tsx
const BadComponent = () => {
    return (
        <div style={{ fontFamily: 'Inter', color: '#667eea', padding: '10px' }}>
            Submission Graded
        </div>
    );
};
```

// Good: Utilizing brand variables and Outfit font family
```tsx
const GoodComponent = () => {
    return (
        <div className="status-badge" style={{ fontFamily: 'var(--font-sans)', color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '8px 12px' }}>
            Submission Graded
        </div>
    );
};
```

## Quick Reference Summary

| Parameter | Standard / Constraint |
| --- | --- |
| Primary Font | Outfit |
| Primary Color | Deep Navy |
| Accent Color | Sky Cyan |
| Component Styles | local styled-jsx blocks and globals.css |
| Allowed Edits | CSS, layout, styled-jsx, responsive updates |
| Banned Edits | IndexedDB schema, Auth functions, Sync triggers, API routes |
| Emoji Usage | Banned in code, comments, and markdown |
