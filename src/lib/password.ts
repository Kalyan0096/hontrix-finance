const COMMON = ["1234567890", "0123456789", "password12", "password123", "qwertyuiop", "1q2w3e4r5t", "iloveyou12", "abcdefghij"];

/** Returns a message key for the first problem, or null. App-side rule: at least 10 characters (Supabase allows up to 72). */
export function validatePassword(pw: string, confirm?: string): string | null {
  if (pw.length < 10 || pw.length > 72) return "err.password";
  if (/^(.)\1+$/.test(pw) || COMMON.includes(pw.toLowerCase())) return "err.passwordWeak";
  if (confirm !== undefined && pw !== confirm) return "err.passwordMismatch";
  return null;
}

/** Only ever redirect back to a page we expect; anything else falls back. Prevents open redirects through a hidden form field. */
export function sanitizeReturnTo(raw: string | null | undefined, allowed: string[], fallback: string): string {
  return raw && allowed.includes(raw) ? raw : fallback;
}
