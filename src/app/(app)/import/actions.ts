"use server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseDate, todayIST } from "@/lib/finance";
import { FREQUENCIES, mapDbError } from "@/lib/loan-form";
import { readGrid } from "@/lib/read-sheet";
import { checkRows, parseSheet, revalidateRows, type BalanceSource, type ImportRow, type PreviewResult } from "@/lib/import-sheet";

const MAX_BYTES = 5 * 1024 * 1024;

/** Reads the file and shows what would be imported. Writes nothing. */
export async function previewImport(fd: FormData): Promise<PreviewResult> {
  await requireOwner();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "import.badFile" };
  if (file.size > MAX_BYTES) return { ok: false, error: "import.tooBig" };
  const lower = file.name.toLowerCase();
  const isCsv = lower.endsWith(".csv");
  if (!isCsv && !lower.endsWith(".xlsx")) return { ok: false, error: "import.badFile" };

  let grid: unknown[][];
  try {
    const g = await readGrid(Buffer.from(await file.arrayBuffer()), isCsv);
    if (g === "tooMany") return { ok: false, error: "import.tooMany" };
    grid = g;
  } catch { return { ok: false, error: "import.badFile" }; }

  const parsed = parseSheet(grid);
  if (!parsed.ok) return { ok: false, error: "import.noHeadings" };
  const chosen = String(fd.get("balanceFrom") ?? "");
  const source: BalanceSource = chosen === "opening" || chosen === "closing" ? chosen : parsed.columns.closing ? "closing" : "opening";
  const checked = checkRows(parsed.rows, source);
  if (checked.valid.length > 2000) return { ok: false, error: "import.tooMany" };
  return { ok: true, source, headerLine: parsed.headerLine!, total: parsed.rows.length, rows: checked.valid, zero: checked.zero.length,
    problems: checked.problems.slice(0, 50), problemCount: checked.problems.length, columns: parsed.columns };
}

export interface CommitInput { rows: ImportRow[]; balanceDate: string; firstDue: string; frequency: string; skipSundays: boolean }
export type CommitResult = { ok: true; created: number; skipped: number; failed: { line: number; message: string }[] } | { ok: false; error: string };

/** Imports the rows. The database creates customers, placeholder vehicles and loans in one go; one bad row never blocks the others. */
export async function commitImport(input: CommitInput): Promise<CommitResult> {
  await requireOwner();
  try { parseDate(input.balanceDate); parseDate(input.firstDue); } catch { return { ok: false, error: "err.date" }; }
  if (input.balanceDate > todayIST()) return { ok: false, error: "err.futureDate" };
  if (input.firstDue <= input.balanceDate) return { ok: false, error: "err.firstDue" };
  if (!(FREQUENCIES as string[]).includes(input.frequency)) return { ok: false, error: "err.generic" };
  const { valid } = revalidateRows(Array.isArray(input.rows) ? input.rows : []);
  if (valid.length === 0 || valid.length > 2000) return { ok: false, error: "import.tooMany" };
  const { data, error } = await (await createClient()).rpc("import_legacy_loans", {
    p_rows: valid, p_balance_date: input.balanceDate, p_first_due: input.firstDue, p_frequency: input.frequency, p_skip_sundays: !!input.skipSundays && input.frequency === "daily" });
  if (error || !data) return { ok: false, error: error ? mapDbError(error) : "err.generic" };
  for (const p of ["/loans", "/customers", "/vehicles", "/payments", "/"]) revalidatePath(p);
  const r = data as { created: number; skipped: unknown[]; failed: { line: number; message: string }[] };
  return { ok: true, created: r.created, skipped: r.skipped.length, failed: r.failed.slice(0, 50) };
}
