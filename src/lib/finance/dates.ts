// Calendar dates are plain "YYYY-MM-DD" strings (no timezone drift).

const pad = (n: number) => String(n).padStart(2, "0");

export function parseDate(iso: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Invalid date: ${iso}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`Invalid date: ${iso}`);
  }
  return { y, m, d };
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseDate(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Add whole months keeping the original day-of-month, clamped to month length (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parseDate(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}

/** Today's date in India (IST), as YYYY-MM-DD. Matches today_ist() in the database. */
export function todayIST(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Whole days from today (IST) until the given date; negative if in the past. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const a = parseDate(todayIST(now)), b = parseDate(iso);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}
