import { describe, expect, it } from "vitest";
import { PERMISSIONS, can, sanitizePermissions, validateEmployee } from "../src/lib/permissions";
import { messages } from "../src/lib/i18n/messages";

describe("permissions", () => {
  it("owners can do everything; employees only what is granted", () => {
    expect(can({ role: "owner", permissions: [] }, "payments.reverse")).toBe(true);
    expect(can({ role: "employee", permissions: ["payments.record"] }, "payments.record")).toBe(true);
    expect(can({ role: "employee", permissions: ["payments.record"] }, "payments.reverse")).toBe(false);
  });
  it("drops unknown permission strings", () => {
    expect(sanitizePermissions(["payments.record", "root.everything"])).toEqual(["payments.record"]);
  });
  it("permission list matches the strings the database checks", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/all-migrations.sql", "utf8");
    for (const p of PERMISSIONS) expect(sql).toContain(`'${p}'`);
  });
});

describe("employee validation", () => {
  const ok = { fullName: "Anil Reddy", email: "anil@example.com", password: "long-enough-pw", phone: "9876543210" };
  it("accepts a good record, and an empty phone", () => {
    expect(validateEmployee(ok)).toBeNull();
    expect(validateEmployee({ ...ok, phone: "" })).toBeNull();
  });
  it("rejects bad fields with a message key", () => {
    expect(validateEmployee({ ...ok, fullName: "A" })).toBe("err.name");
    expect(validateEmployee({ ...ok, email: "nope" })).toBe("err.email");
    expect(validateEmployee({ ...ok, password: "short" })).toBe("err.password");
    expect(validateEmployee({ ...ok, phone: "12345" })).toBe("err.phone");
  });
});

describe("translations", () => {
  it("Telugu has every English key and no empty values", () => {
    expect(Object.keys(messages.te).sort()).toEqual(Object.keys(messages.en).sort());
    for (const v of Object.values(messages.te)) expect(v.trim().length).toBeGreaterThan(0);
  });
  it("every validation error key exists as a message", () => {
    for (const k of ["err.name", "err.email", "err.password", "err.phone"]) expect(k in messages.en).toBe(true);
  });
});

import { daysUntil, todayIST } from "../src/lib/finance";
import { normalizeMobile, normalizeRegistration, sanitizeSearch, validateCustomer, validateVehicle } from "../src/lib/records";

describe("customer and vehicle input", () => {
  it("normalises mobile numbers", () => {
    expect(normalizeMobile("+91 98765 43210")).toBe("9876543210");
    expect(normalizeMobile("098765-43210")).toBe("9876543210");
    expect(validateCustomer({ fullName: "Ravi Kumar", mobile: "+91 98765 43210" })).toBeNull();
    expect(validateCustomer({ fullName: "Ravi Kumar", mobile: "12345" })).toBe("err.mobile");
    expect(validateCustomer({ fullName: "R", mobile: "9876543210" })).toBe("err.name");
  });
  it("normalises registration numbers to what the database requires", () => {
    expect(normalizeRegistration("ap 04 xx-1234")).toBe("AP04XX1234");
    expect(validateVehicle({ registration: "ap 04 xx 1234", year: "2019", category: "pickup" })).toBeNull();
    expect(validateVehicle({ registration: "AP1", year: null, category: "car" })).toBe("err.reg");
    expect(validateVehicle({ registration: "AP04XX1234", year: "1900", category: "car" })).toBe("err.year");
    expect(validateVehicle({ registration: "AP04XX1234", year: null, category: "spaceship" })).toBe("err.generic");
  });
  it("search text cannot inject filter syntax but keeps Telugu", () => {
    expect(sanitizeSearch('a,id.eq.1) or (x"')).toBe("aid.eq.1 or x");
    expect(sanitizeSearch("రవి కుమార్")).toBe("రవి కుమార్");
    expect(sanitizeSearch("100%_")).toBe("100");
  });
  it("counts days to insurance expiry in IST", () => {
    const now = new Date("2026-11-17T20:00:00Z"); // already 18 Nov 01:30 in India
    expect(todayIST(now)).toBe("2026-11-18");
    expect(daysUntil("2026-11-18", now)).toBe(0);
    expect(daysUntil("2026-11-17", now)).toBe(-1);
    expect(daysUntil("2026-12-18", now)).toBe(30);
  });
});

import { displayStatus, mapDbError, readLoanValues, validateLoan, validatePayment } from "../src/lib/loan-form";

describe("loan form", () => {
  const base = { principal: "300000", rate: "12", method: "flat", tenure: "24", frequency: "monthly", firstDue: "2026-12-05", disbursedOn: "2026-11-05", approvedOn: "", appliedOn: "", processingFee: "2000", otherFees: "", notes: "", installment: "", skipSundays: "" };
  const today = "2026-11-17";
  it("accepts a good loan", () => {
    const r = validateLoan(base, today);
    expect(r.error).toBeNull();
    expect(r.input?.tenureInstallments).toBe(24);
  });
  it("rejects bad numbers and dates with a message key", () => {
    expect(validateLoan({ ...base, principal: "0" }, today).error).toBe("err.principal");
    expect(validateLoan({ ...base, principal: "12.345" }, today).error).toBe("err.principal");
    expect(validateLoan({ ...base, rate: "75" }, today).error).toBe("err.rate");
    expect(validateLoan({ ...base, tenure: "0" }, today).error).toBe("err.tenure");
    expect(validateLoan({ ...base, tenure: "401" }, today).error).toBe("err.tenure");
    expect(validateLoan({ ...base, firstDue: "2026-02-30" }, today).error).toBe("err.date");
    expect(validateLoan({ ...base, disbursedOn: "2026-12-01", firstDue: "2027-01-01" }, today).error).toBe("err.futureDate");
    expect(validateLoan({ ...base, firstDue: "2026-11-05" }, today).error).toBe("err.firstDue");
    expect(validateLoan({ ...base, processingFee: "abc" }, today).error).toBe("err.fee");
  });
  it("validates fixed-instalment daily loans", () => {
    const d = { ...base, method: "fixed_installment", frequency: "daily", rate: "", principal: "50000", tenure: "100", installment: "600", skipSundays: "on" };
    const ok = validateLoan(d, today);
    expect(ok.error).toBeNull();
    expect(ok.input).toMatchObject({ method: "fixed_installment", frequency: "daily", installment: "600", skipSundays: true, annualRatePercent: 0 });
    expect(validateLoan({ ...d, installment: "" }, today).error).toBe("err.installment");
    expect(validateLoan({ ...d, installment: "400" }, today).error).toBe("err.installmentLow");
    expect(validateLoan({ ...base, rate: "" }, today).error).toBe("err.rate"); // flat still needs a rate
    expect(validateLoan({ ...base, skipSundays: "on" }, today).input?.skipSundays).toBe(false); // only daily loans skip Sundays
  });
  it("reads values and trims", () => {
    expect(readLoanValues((k) => (k === "principal" ? " 5000 " : undefined)).principal).toBe("5000");
  });
  it("validates payments", () => {
    expect(validatePayment("5000", "2026-11-17", "upi", today)).toBeNull();
    expect(validatePayment("0", "2026-11-17", "upi", today)).toBe("err.amount");
    expect(validatePayment("10.999", "2026-11-17", "upi", today)).toBe("err.amount");
    expect(validatePayment("500", "2026-11-18", "upi", today)).toBe("err.futureDate");
    expect(validatePayment("500", "2026-11-17", "barter", today)).toBe("err.generic");
  });
  it("shows overdue immediately and maps database errors", () => {
    expect(displayStatus("active", 100)).toBe("overdue");
    expect(displayStatus("active", 0)).toBe("active");
    expect(displayStatus("closed", 100)).toBe("closed");
    expect(mapDbError({ message: "payment exceeds total receivable by 10" })).toBe("err.overpay");
    expect(mapDbError({ message: "permission denied: payments.record", code: "42501" })).toBe("err.noPerm");
    expect(mapDbError({ message: "payment already reversed" })).toBe("err.alreadyReversed");
  });
});

import { DOCUMENT_CATEGORIES, buildStoragePath, detectMime, isValidStoragePath, safeFileName, sha256Hex } from "../src/lib/documents";

describe("document upload helpers", () => {
  const bytes = (...n: number[]) => new Uint8Array([...n, 0, 0, 0, 0, 0, 0, 0, 0]);
  it("detects the real file type from content", () => {
    expect(detectMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe("application/pdf");
    expect(detectMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectMime(bytes(0x4d, 0x5a))).toBeNull(); // Windows executable
    expect(detectMime(new TextEncoder().encode("<html><script>"))).toBeNull();
  });
  it("makes file names safe and gives them the right extension", () => {
    expect(safeFileName("../../etc/passwd.exe", "application/pdf")).toBe("passwd.pdf");
    expect(safeFileName("RC book (front).JPG", "image/jpeg")).toBe("RC-book-front.jpg");
    expect(safeFileName("రసీదు.png", "image/png")).toBe("document.png");
  });
  it("builds and checks storage paths", () => {
    const [f, c, d, u] = ["fin-id", "cust-id", "doc-id", crypto.randomUUID()];
    const p = buildStoragePath(f, c, d, u, "policy.pdf");
    expect(p).toBe(`fin-id/cust-id/doc-id/${u}-policy.pdf`);
    expect(isValidStoragePath(p, f, c, d)).toBe(true);
    expect(isValidStoragePath(p, "other", c, d)).toBe(false);
    expect(isValidStoragePath(`${f}/${c}/${d}/${u}-../x.pdf`, f, c, d)).toBe(false);
    expect(isValidStoragePath(`${f}/${c}/${d}/${u}-a.exe`, f, c, d)).toBe(false);
  });
  it("hashes files (SHA-256 of 'abc')", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("categories match the database enum", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/0001_core_schema.sql", "utf8");
    const m = /create type document_category as enum \(([^)]*)\)/.exec(sql)![1]!.match(/'([a-z_]+)'/g)!.map((x) => x.replace(/'/g, ""));
    expect([...DOCUMENT_CATEGORIES].sort()).toEqual(m.sort());
  });
});

import { resolveRange, safeCell } from "../src/lib/report-range";
import { formatCompactINR, toPaise as tp } from "../src/lib/finance";

describe("report ranges and exports", () => {
  const today = "2026-11-17";
  it("resolves presets", () => {
    expect(resolveRange({}, today)).toMatchObject({ from: "2026-11-01", to: today, preset: "thisMonth" });
    expect(resolveRange({ preset: "lastMonth" }, today)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolveRange({ preset: "last30" }, today)).toMatchObject({ from: "2026-10-19", to: today });
    expect(resolveRange({ preset: "thisFY" }, today).from).toBe("2026-04-01");
    expect(resolveRange({ preset: "thisFY" }, "2027-02-10").from).toBe("2026-04-01");
  });
  it("validates custom ranges", () => {
    expect(resolveRange({ from: "2026-11-01", to: "2026-11-10" }, today)).toMatchObject({ preset: "custom", error: null });
    expect(resolveRange({ from: "2026-11-10", to: "2026-11-01" }, today).error).toBe("err.range");
    expect(resolveRange({ from: "2026-02-30", to: "2026-03-01" }, today).error).toBe("err.range");
    expect(resolveRange({ from: "2020-01-01", to: "2026-11-01" }, today).error).toBe("err.rangeLong");
    expect(resolveRange({ from: "2026-11-01" }, today).error).toBe("err.range");
  });
  it("neutralises spreadsheet formulas in user text", () => {
    expect(safeCell("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(safeCell("+91 98765")).toBe("'+91 98765");
    expect(safeCell("Ravi Kumar")).toBe("Ravi Kumar");
    expect(safeCell(null)).toBe("");
  });
  it("formats compact Indian amounts", () => {
    expect(formatCompactINR(tp("950"))).toBe("₹950");
    expect(formatCompactINR(tp("12500"))).toBe("₹12.5K");
    expect(formatCompactINR(tp("120000"))).toBe("₹1.2L");
    expect(formatCompactINR(tp("34000000"))).toBe("₹3.4Cr");
    expect(formatCompactINR(0)).toBe("₹0");
  });
});

import { sanitizeReturnTo, validatePassword } from "../src/lib/password";
describe("passwords and redirects", () => {
  it("enforces length, weak patterns and confirmation", () => {
    expect(validatePassword("short")).toBe("err.password");
    expect(validatePassword("a".repeat(73))).toBe("err.password");
    expect(validatePassword("aaaaaaaaaaaa")).toBe("err.passwordWeak");
    expect(validatePassword("Kadapa-Loans-2026")).toBeNull();
    expect(validatePassword("Password123")).toBe("err.passwordWeak"); // common password, any capitalisation
    expect(validatePassword("long-enough-pw", "different-one!")).toBe("err.passwordMismatch");
    expect(validatePassword("long-enough-pw", "long-enough-pw")).toBeNull();
  });
  it("only redirects to allowed pages", () => {
    expect(sanitizeReturnTo("/payments", ["/payments"], "/loans")).toBe("/payments");
    expect(sanitizeReturnTo("https://evil.example", ["/payments"], "/loans")).toBe("/loans");
    expect(sanitizeReturnTo("//evil.example", ["/payments"], "/loans")).toBe("/loans");
    expect(sanitizeReturnTo(null, ["/payments"], "/loans")).toBe("/loans");
  });
});

import { ALERT_KINDS, alertHref, alertVars, fillTemplate, groupAlerts, type AlertRow } from "../src/lib/alerts";
describe("alerts", () => {
  const base: AlertRow = { kind: "overdue_loan", severity: "high", customer_id: "c1", customer_name: "Ravi", loan_id: "l1", loan_no: "L00001", vehicle_id: "v1", registration_number: "AP04XX1234",
    document_id: null, task_id: null, due_date: "2026-11-01", amount: 8000, count_value: 2, label: null };
  it("every alert kind has a heading and a message in both languages", () => {
    for (const lang of ["en", "te"] as const) for (const k of ALERT_KINDS) {
      expect(messages[lang][`alerts.kind.${k}` as keyof typeof messages.en]).toBeTruthy();
      expect(messages[lang][`alerts.item.${k}` as keyof typeof messages.en]).toBeTruthy();
    }
  });
  it("fills message templates and links to the right page", () => {
    const text = fillTemplate(messages.en["alerts.item.overdue_loan"], alertVars(base, { money: (n) => `₹${n}`, category: (c) => c }));
    expect(text).toBe("Ravi: ₹8000 overdue on L00001 (2 instalments, oldest due 2026-11-01)");
    expect(alertHref(base)).toBe("/loans/l1");
    expect(alertHref({ ...base, kind: "document_expired", document_id: "d1" })).toBe("/documents/d1");
    expect(alertHref({ ...base, kind: "insurance_expired", loan_id: null })).toBe("/customers/c1");
    expect(alertHref({ ...base, kind: "documents_to_verify" })).toBe("/documents?f=toVerify");
  });
  it("groups in a fixed order, most urgent first", () => {
    const rows = [{ ...base, kind: "missing_documents", severity: "medium" }, { ...base, due_date: "2026-11-10" }, { ...base, due_date: "2026-10-01" }];
    const g = groupAlerts(rows);
    expect(g.map((x) => x.kind)).toEqual(["overdue_loan", "missing_documents"]);
    expect(g[0]!.items.map((i) => i.due_date)).toEqual(["2026-10-01", "2026-11-10"]);
  });
});
