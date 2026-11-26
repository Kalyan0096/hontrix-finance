import { describe, expect, it } from "vitest";
import { MAX_FAILS_PER_EMAIL, MAX_FAILS_PER_IP, clientIp, contentSecurityPolicy, hashEmail, idleLimitMinutes, isIdle, isLockedOut, isTotpCode } from "../src/lib/security";
import { summarizeAudit } from "../src/lib/audit";

describe("sign-in throttling", () => {
  it("locks after repeated failures for one email or one address", () => {
    expect(isLockedOut(MAX_FAILS_PER_EMAIL - 1, 0)).toBe(false);
    expect(isLockedOut(MAX_FAILS_PER_EMAIL, 0)).toBe(true);
    expect(isLockedOut(0, MAX_FAILS_PER_IP)).toBe(true);
    expect(isLockedOut(0, MAX_FAILS_PER_IP - 1)).toBe(false);
  });
  it("hashes emails the same way regardless of case and spaces, and never stores the email", () => {
    expect(hashEmail(" Owner@Example.com ")).toBe(hashEmail("owner@example.com"));
    expect(hashEmail("a@b.co")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmail("a@b.co")).not.toContain("a@b.co");
  });
  it("reads the caller's address from proxy headers", () => {
    expect(clientIp("203.0.113.9, 10.0.0.1", null)).toBe("203.0.113.9");
    expect(clientIp(null, "198.51.100.2")).toBe("198.51.100.2");
    expect(clientIp(null, null)).toBeNull();
  });
});

describe("idle sign-out", () => {
  it("applies the limit and keeps it within sane bounds", () => {
    expect(idleLimitMinutes(undefined)).toBe(60);
    expect(idleLimitMinutes("30")).toBe(30);
    expect(idleLimitMinutes("1")).toBe(60);
    expect(idleLimitMinutes("99999")).toBe(60);
    const now = Date.UTC(2026, 10, 23, 12, 0, 0);
    expect(isIdle(now - 59 * 60_000, now, 60)).toBe(false);
    expect(isIdle(now - 61 * 60_000, now, 60)).toBe(true);
    expect(isIdle(null, now, 60)).toBe(false); // first visit: nothing to compare
  });
});

describe("two-step codes and page policy", () => {
  it("accepts exactly six digits", () => {
    expect(isTotpCode("123456")).toBe(true);
    expect(isTotpCode(" 123456 ")).toBe(true);
    expect(isTotpCode("12345")).toBe(false);
    expect(isTotpCode("12345a")).toBe(false);
  });
  it("policy blocks plugins, framing and foreign scripts, and allows only this site and Supabase to be contacted", () => {
    const p = contentSecurityPolicy(true);
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).toContain("connect-src 'self' https://*.supabase.co");
    expect(p).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy(false)).toContain("unsafe-eval"); // development tooling only
  });
});

describe("audit summaries", () => {
  it("describes changes without dumping whole rows", () => {
    expect(summarizeAudit({ action: "UPDATE", table_name: "loans", old_data: { status: "active", updated_at: "x", id: 1 }, new_data: { status: "overdue", updated_at: "y", id: 1 } })).toBe("status: active → overdue");
    expect(summarizeAudit({ action: "INSERT", table_name: "customers", old_data: null, new_data: { full_name: "Ravi Kumar", mobile: "9876543210" } })).toBe("Ravi Kumar");
    expect(summarizeAudit({ action: "INSERT", table_name: "payments", old_data: null, new_data: { kind: "receipt", amount: 600, payment_date: "2026-11-20" } })).toBe("receipt 600 (2026-11-20)");
    expect(summarizeAudit({ action: "EXPORT", table_name: "export:backup", old_data: null, new_data: { kind: "backup" } })).toBe("backup");
    expect(summarizeAudit({ action: "IMPORT", table_name: "loans", old_data: null, new_data: { external_ref: "D-101", balance: 5400 } })).toBe("D-101 · 5400");
  });
});
