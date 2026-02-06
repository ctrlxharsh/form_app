/**
 * Error Logging Utility
 * 
 * Logs errors to the database for monitoring and debugging.
 * Exception-safe - won't crash if logging fails.
 */

import { sql } from './postgres';

interface ErrorLogData {
    error: Error | unknown;
    endpoint?: string;
    userId?: number | string | null;
    requestData?: Record<string, unknown>;
}

/**
 * Log an error to the database.
 * This function is exception-safe - it won't crash if logging fails.
 */
export async function logError({
    error,
    endpoint,
    userId,
    requestData
}: ErrorLogData): Promise<void> {
    try {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        const errorType = errorObj.name || 'UnknownError';
        const errorMessage = errorObj.message || String(error);
        const stackTrace = errorObj.stack || null;

        // Sanitize request data - remove sensitive fields
        let sanitizedData: Record<string, unknown> | null = null;
        if (requestData) {
            const sensitiveKeys = ['password', 'token', 'secret', 'api_key', 'apikey'];
            sanitizedData = Object.fromEntries(
                Object.entries(requestData).filter(
                    ([key]) => !sensitiveKeys.includes(key.toLowerCase())
                )
            );
        }

        const userIdNum = userId ? parseInt(String(userId), 10) : null;
        const validUserId = userIdNum && !isNaN(userIdNum) ? userIdNum : null;

        await sql`
            INSERT INTO error_logs 
                (source, error_type, error_message, stack_trace, endpoint, user_id, request_data)
            VALUES 
                ('nextjs', ${errorType}, ${errorMessage}, ${stackTrace}, ${endpoint || null}, ${validUserId}, ${sanitizedData ? JSON.stringify(sanitizedData) : null}::jsonb)
        `;
    } catch (logErr) {
        // Logging failed - print to console but don't crash
        console.error('[ERROR LOGGER] Failed to log error to database:', logErr);
        console.error('[ERROR LOGGER] Original error:', error);
    }
}

/**
 * Wrapper to log error and return a standard error response.
 * Useful in API routes.
 */
export async function logAndReturnError(
    error: Error | unknown,
    endpoint: string,
    statusCode: number = 500,
    userId?: number | string | null,
    requestData?: Record<string, unknown>
): Promise<{ error: string; status: number }> {
    await logError({ error, endpoint, userId, requestData });

    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return { error: message, status: statusCode };
}
