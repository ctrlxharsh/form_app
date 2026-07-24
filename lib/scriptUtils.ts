/**
 * Utility functions for script detection and text direction determination.
 */

// Regex covering Arabic/Urdu script ranges (Urdu, Arabic, Persian, Pashto, Sindhi)
// and other RTL scripts (Hebrew, Syriac, Thaana, NKo, etc.)
const RTL_REGEX = /[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;

// Regex covering LTR scripts (Latin/English, Devanagari/Hindi/Marathi, Tamil, Telugu, etc.)
const LTR_REGEX = /[\u0041-\u005A\u0061-\u007A\u00C0-\u024F\u0900-\u0D7F]/;

/**
 * Detects whether the primary or first strong directional script in a text string is RTL or LTR.
 * Default is 'ltr' for empty strings or non-script characters (like numbers/punctuation).
 */
export function detectScriptDirection(text?: string | null): 'rtl' | 'ltr' {
    if (!text) return 'ltr';
    
    for (const char of text) {
        if (RTL_REGEX.test(char)) {
            return 'rtl';
        }
        if (LTR_REGEX.test(char)) {
            return 'ltr';
        }
    }
    
    return 'ltr';
}
