// Pure helpers for customer and vehicle forms. The database re-checks everything; this gives friendly errors.

export const VEHICLE_CATEGORIES = ["car", "commercial", "truck", "pickup", "two_wheeler", "other"] as const;
export const CUSTOMER_STATUSES = ["active", "inactive", "blocked"] as const;

/** "+91 98765 43210" / "098765-43210" → "9876543210" */
export function normalizeMobile(v: string): string {
  let d = v.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

/** "ap 04 xx-1234" → "AP04XX1234" (the form the database requires). */
export const normalizeRegistration = (v: string) => v.toUpperCase().replace(/[\s-]/g, "");

/** Keeps letters (any script, including Telugu), digits, spaces, dot and hyphen. Safe to put inside a filter. */
export const sanitizeSearch = (q: string) => q.normalize("NFKC").replace(/[^\p{L}\p{N}\p{M}\s.\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);

export const emptyToNull = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };

export function validateCustomer(i: { fullName: string; mobile: string }): string | null {
  if (i.fullName.trim().length < 2) return "err.name";
  if (!/^[6-9]\d{9}$/.test(normalizeMobile(i.mobile))) return "err.mobile";
  return null;
}

export function validateVehicle(i: { registration: string; year: string | null; category: string }, thisYear = new Date().getFullYear()): string | null {
  if (!/^[A-Z0-9]{6,12}$/.test(normalizeRegistration(i.registration))) return "err.reg";
  if (i.year !== null) {
    const y = Number(i.year);
    if (!Number.isInteger(y) || y < 1950 || y > thisYear + 1) return "err.year";
  }
  if (!(VEHICLE_CATEGORIES as readonly string[]).includes(i.category)) return "err.generic";
  return null;
}
