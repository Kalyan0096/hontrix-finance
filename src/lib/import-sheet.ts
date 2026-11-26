import { normalizeMobile } from "./records";
import { toPaise } from "./finance";

export interface ParsedRow { line: number; name: string; mobile: string; loanRef: string; dailyDue: string | null; opening: string | null; closing: string | null }
export interface ImportRow { line: number; name: string; mobile: string; loan_ref: string; daily_due: string; balance: string }
export interface ParseResult {
  ok: boolean; error?: string; headerLine?: number; rows: ParsedRow[];
  columns: { name?: string; mobile?: string; loanRef?: string; dailyDue?: string; opening?: string; closing?: string };
}
export type BalanceSource = "closing" | "opening";

const norm = (h: unknown) => String(h ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
const SYN: Record<string, string[]> = {
  name: ["borrower", "borrowername", "name", "customer", "customername", "party", "partyname"],
  mobile: ["phone", "phoneno", "phonenumber", "mobile", "mobileno", "mobilenumber", "contact", "contactno", "cell"],
  loanRef: ["loanno", "loannumber", "loanid", "loanref", "accountno", "accountnumber", "agreementno", "loan"],
  dailyDue: ["dailydue", "daily", "dailyinstalment", "dailyinstallment", "dailyamount", "dueamount", "installment", "instalment", "emi", "due"],
  opening: ["openingbalance", "opening", "openingbal"],
  closing: ["closingbalance", "closing", "closingbal", "balance", "outstanding", "balancedue", "currentbalance"],
};

/** "₹1,200.50", "Rs 300", 1200.5, "" → "1200.50" / null. More than two decimals are rounded to paise. */
export function parseMoney(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  let n: number;
  if (typeof v === "number") n = v;
  else { const s = String(v).replace(/[₹,\s]|rs\.?|inr/gi, ""); if (!/^-?\d+(\.\d+)?$/.test(s)) return null; n = Number(s); }
  if (!Number.isFinite(n)) return null;
  const paise = Math.round(n * 100);
  const neg = paise < 0, a = Math.abs(paise);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Math.round(v))) : String(v).trim());

/** Finds the heading row (within the first 15 rows) and reads every row below it. Works on any spreadsheet with these kinds of columns. */
export function parseSheet(grid: unknown[][]): ParseResult {
  const empty = { name: undefined, mobile: undefined, loanRef: undefined, dailyDue: undefined, opening: undefined, closing: undefined };
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const row = grid[r] ?? [];
    const idx: Record<string, number> = {};
    row.forEach((cell, c) => {
      const h = norm(cell);
      if (!h) return;
      for (const [field, words] of Object.entries(SYN)) if (!(field in idx) && words.includes(h)) { idx[field] = c; break; }
    });
    if (idx.name !== undefined && idx.dailyDue !== undefined && (idx.opening !== undefined || idx.closing !== undefined) && idx.loanRef !== undefined && idx.mobile !== undefined) {
      const label = (f: string) => (idx[f] === undefined ? undefined : String(row[idx[f]!]).trim());
      const rows: ParsedRow[] = [];
      for (let i = r + 1; i < grid.length; i++) {
        const g = grid[i] ?? [];
        const name = text(g[idx.name!]);
        if (!name && !text(g[idx.loanRef!])) continue;              // blank line
        if (/^(grand\s*)?total/i.test(name)) continue;              // totals row at the bottom
        rows.push({ line: i + 1, name, mobile: normalizeMobile(text(g[idx.mobile!])), loanRef: text(g[idx.loanRef!]), dailyDue: parseMoney(g[idx.dailyDue!]),
          opening: idx.opening === undefined ? null : parseMoney(g[idx.opening]), closing: idx.closing === undefined ? null : parseMoney(g[idx.closing]) });
      }
      return { ok: true, headerLine: r + 1, rows, columns: { name: label("name"), mobile: label("mobile"), loanRef: label("loanRef"), dailyDue: label("dailyDue"), opening: label("opening"), closing: label("closing") } };
    }
  }
  return { ok: false, error: "headings", rows: [], columns: empty };
}

export interface Checked { valid: ImportRow[]; zero: number[]; problems: { line: number; message: string }[] }

/** Applies the chosen balance column and checks every row. `zero` lists rows with nothing owed (skipped, not errors). */
export function checkRows(rows: ParsedRow[], source: BalanceSource): Checked {
  const out: Checked = { valid: [], zero: [], problems: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    const bal = source === "closing" ? (r.closing ?? r.opening) : (r.opening ?? r.closing);
    const bad = (message: string) => out.problems.push({ line: r.line, message });
    if (r.name.length < 2) { bad("name"); continue; }
    if (!/^[6-9]\d{9}$/.test(r.mobile)) { bad("mobile"); continue; }
    if (!r.loanRef) { bad("loanRef"); continue; }
    if (seen.has(r.loanRef)) { bad("duplicate"); continue; }
    if (!r.dailyDue || toPaise(r.dailyDue) <= 0) { bad("dailyDue"); continue; }
    if (bal === null) { bad("balance"); continue; }
    if (toPaise(bal) <= 0) { out.zero.push(r.line); continue; }
    if (Math.ceil(toPaise(bal) / toPaise(r.dailyDue)) > 3000) { bad("tooLong"); continue; }
    seen.add(r.loanRef);
    out.valid.push({ line: r.line, name: r.name.slice(0, 120), mobile: r.mobile, loan_ref: r.loanRef.slice(0, 60), daily_due: r.dailyDue, balance: bal });
  }
  return out;
}

/** Re-checks rows sent back by the browser before they are imported (nothing from the browser is trusted). */
export function revalidateRows(rows: ImportRow[]): { valid: ImportRow[]; problems: number } {
  const valid: ImportRow[] = [], seen = new Set<string>();
  let problems = 0;
  for (const r of rows) {
    const ok = typeof r.name === "string" && r.name.trim().length >= 2 && /^[6-9]\d{9}$/.test(r.mobile) && !!r.loan_ref && r.loan_ref.length <= 60 && !seen.has(r.loan_ref)
      && /^\d{1,10}\.\d{2}$/.test(r.daily_due) && /^\d{1,10}\.\d{2}$/.test(r.balance) && toPaise(r.daily_due) > 0 && toPaise(r.balance) > 0 && Number.isInteger(r.line);
    if (!ok) { problems++; continue; }
    seen.add(r.loan_ref); valid.push({ line: r.line, name: r.name.trim().slice(0, 120), mobile: r.mobile, loan_ref: r.loan_ref, daily_due: r.daily_due, balance: r.balance });
  }
  return { valid, problems };
}

export type PreviewResult =
  | { ok: false; error: string }
  | { ok: true; source: BalanceSource; headerLine: number; total: number; rows: ImportRow[]; zero: number; problems: { line: number; message: string }[]; problemCount: number; columns: ParseResult["columns"] };
