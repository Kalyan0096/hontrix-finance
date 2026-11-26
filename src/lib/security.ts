import { createHash } from "node:crypto";

export const LOGIN_WINDOW_MINUTES = 15;
export const MAX_FAILS_PER_EMAIL = 5;
export const MAX_FAILS_PER_IP = 30;

/** True when too many recent failures exist for this email or this address. */
export const isLockedOut = (emailFails: number, ipFails: number) => emailFails >= MAX_FAILS_PER_EMAIL || ipFails >= MAX_FAILS_PER_IP;

export const hashEmail = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

/** The caller's address as reported by the hosting platform's proxy (first entry of x-forwarded-for). */
export const clientIp = (forwardedFor: string | null, realIp: string | null) => (forwardedFor?.split(",")[0]?.trim() || realIp?.trim() || "").slice(0, 64) || null;

export const IDLE_DEFAULT_MINUTES = 60;
/** Idle limit in minutes from the environment, kept between 5 minutes and 12 hours. */
export const idleLimitMinutes = (raw: string | undefined) => { const n = Number(raw); return Number.isFinite(n) && n >= 5 && n <= 720 ? Math.floor(n) : IDLE_DEFAULT_MINUTES; };
export const isIdle = (lastSeenMs: number | null, nowMs: number, limitMinutes: number) => lastSeenMs !== null && Number.isFinite(lastSeenMs) && nowMs - lastSeenMs > limitMinutes * 60_000;

export const isTotpCode = (v: string) => /^\d{6}$/.test(v.trim());

/** Content-Security-Policy. Scripts need 'unsafe-inline' for Next.js's own bootstrap code; everything else is locked to this site and Supabase. */
export function contentSecurityPolicy(isProd: boolean): string {
  const supabase = "https://*.supabase.co";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase}`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} wss://*.supabase.co${isProd ? "" : " ws:"}`,
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; ");
}
