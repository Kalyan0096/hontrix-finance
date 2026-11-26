import { addDays, addMonths, parseDate } from "./finance";

export const PRESETS = ["thisMonth", "lastMonth", "last30", "thisFY"] as const;
export type Preset = (typeof PRESETS)[number];
export interface Range { from: string; to: string; preset: Preset | "custom"; error: string | null }

const pad = (n: number) => String(n).padStart(2, "0");
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const MAX_DAYS = 366;

/** Resolves ?preset= / ?from=&to= into a validated inclusive date range. Falls back to "this month" with an error key. */
export function resolveRange(p: { preset?: string; from?: string; to?: string }, today: string): Range {
  const fallback = (error: string | null): Range => ({ from: monthStart(today), to: today, preset: "thisMonth", error });
  if (p.from || p.to) {
    try {
      if (!p.from || !p.to) return fallback("err.range");
      parseDate(p.from); parseDate(p.to);
      if (p.from > p.to) return fallback("err.range");
      if (addDays(p.from, MAX_DAYS) < p.to) return fallback("err.rangeLong");
      return { from: p.from, to: p.to, preset: "custom", error: null };
    } catch { return fallback("err.range"); }
  }
  switch (p.preset) {
    case "lastMonth": { const s = addMonths(monthStart(today), -1); return { from: s, to: addDays(monthStart(today), -1), preset: "lastMonth", error: null }; }
    case "last30": return { from: addDays(today, -29), to: today, preset: "last30", error: null };
    case "thisFY": { // Indian financial year: 1 April – 31 March
      const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
      return { from: `${m >= 4 ? y : y - 1}-04-01`, to: today, preset: "thisFY", error: null };
    }
    default: return fallback(null);
  }
}

/** Excel/CSV cells that start with = + - @ can run as formulas; neutralise text that came from users. */
export const safeCell = (v: string | null | undefined): string => { const s = v ?? ""; return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
export { pad };
