import crypto from 'crypto';

/**
 * Generate a secure random password from a given charset.
 */
export function generatePassword(length: number, charset: string): string {
  if (charset.length === 0) charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length * 2);
  let result = '';
  for (let i = 0; i < bytes.length && result.length < length; i++) {
    const idx = bytes[i] % charset.length;
    result += charset[idx];
  }
  return result;
}

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
export function escapeTsString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\//g, '\\/')
    .replace(/ /g, '\\s')
    .replace(/\|/g, '\\p')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\x07/g, '\\a')
    .replace(/\x08/g, '\\b')
    .replace(/\x0C/g, '\\f')
    .replace(/\x0B/g, '\\v');
}

/**
 * Sanitize a user nickname for use inside a channel name.
 * Strips dangerous characters while preserving readability.
 */
export function sanitizeNickname(nick: string): string {
  // Remove null bytes and control characters
  // eslint-disable-next-line no-control-regex
  return nick.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 30);
}

/**
 * Replace template placeholders with actual values.
 */
export function fillTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{${key}}`).join(value);
  }
  return result;
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clamp a number between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate exponential backoff delay.
 * @param attempt  0-indexed attempt number
 * @param base     Base delay in ms (default 2000)
 * @param cap      Max delay in ms (default 60000)
 */
export function exponentialBackoff(attempt: number, base = 2000, cap = 60000): number {
  const delay = Math.min(base * Math.pow(2, attempt), cap);
  // Add ±20% jitter
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

/**
 * Format uptime seconds into a human-readable string.
 */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}
