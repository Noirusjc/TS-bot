/**
 * Generate a secure random password from a given charset.
 */
export declare function generatePassword(length: number, charset: string): string;
/**
 * Escape a string for safe use in TeamSpeak ServerQuery commands.
 * TS3 ServerQuery escaping rules:
 *   \  -> \\
 *   /  -> \/
 *   space -> \s
 *   |  -> \p
 *   newline -> \n
 *   carriage return -> \r
 *   tab -> \t
 *   bell -> \a
 *   backspace -> \b
 *   form feed -> \f
 *   vertical tab -> \v
 */
export declare function escapeTsString(str: string): string;
/**
 * Sanitize a user nickname for use inside a channel name.
 * Strips dangerous characters while preserving readability.
 */
export declare function sanitizeNickname(nick: string): string;
/**
 * Replace template placeholders with actual values.
 */
export declare function fillTemplate(template: string, vars: Record<string, string>): string;
/**
 * Sleep for a given number of milliseconds.
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Clamp a number between min and max.
 */
export declare function clamp(value: number, min: number, max: number): number;
/**
 * Calculate exponential backoff delay.
 * @param attempt  0-indexed attempt number
 * @param base     Base delay in ms (default 2000)
 * @param cap      Max delay in ms (default 60000)
 */
export declare function exponentialBackoff(attempt: number, base?: number, cap?: number): number;
/**
 * Format uptime seconds into a human-readable string.
 */
export declare function formatUptime(seconds: number): string;
//# sourceMappingURL=helpers.d.ts.map