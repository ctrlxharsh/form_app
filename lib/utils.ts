/**
 * Formats and normalizes a UDISE code to a standard 11-digit string.
 * Zero-pads numeric values if they lost a leading '0' (e.g. 10 digits).
 * Returns empty string for invalid/null/undefined inputs.
 */
export function formatUdise(val: any): string {
    if (val === null || val === undefined) {
        return '';
    }
    
    const str = String(val).split('.')[0].trim();
    if (!str || str.toLowerCase() === 'nan' || str.toLowerCase() === 'null' || str.toLowerCase() === 'n/a') {
        return '';
    }
    
    if (/^\d+$/.test(str)) {
        return str.padStart(11, '0');
    }
    
    return str;
}
