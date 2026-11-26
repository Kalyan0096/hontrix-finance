import { NextResponse, type NextRequest } from "next/server";
import { buildWorkbook } from "@/lib/excel";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { todayIST } from "@/lib/finance";
import { resolveRange, safeCell } from "@/lib/report-range";
import { fetchCollections, fetchDisbursed, fetchOverdue } from "@/lib/reports";
import { parseDate } from "@/lib/finance";

const toDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const MONEY = "#,##0.00", DATE = "dd-mmm-yyyy";

/** Owner-only Excel export. Reads through the signed-in user's session, so database rules still apply. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (!me || !me.is_active || me.role !== "owner") return new NextResponse("Only the owner can export", { status: 403 });

  const q = req.nextUrl.searchParams;
  const range = resolveRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined }, todayIST());
  const type = q.get("type");
  const { t } = await getT();
  let name: string, cols: { header: MessageKey; width: number; fmt?: string }[], rows: (string | number | Date | null)[][], totals: { col: number; value: number; more?: { col: number; value: number }[] } | null;

  if (type === "collections") {
    const d = await fetchCollections(supabase, range.from, range.to);
    name = `collections_${range.from}_to_${range.to}`;
    cols = [{ header: "col.date", width: 13, fmt: DATE }, { header: "col.customer", width: 26 }, { header: "col.loanNo", width: 11 }, { header: "col.type", width: 11 }, { header: "col.method", width: 14 }, { header: "col.ref", width: 18 }, { header: "col.amount", width: 15, fmt: MONEY }];
    rows = d.map((r) => [toDate(r.date), safeCell(r.customer), r.loanNo, r.type === "reversal" ? t("col.reversal") : t("col.receipt"), t(`pay.method.${r.method}` as MessageKey), safeCell(r.reference), r.amount]);
    totals = { col: 6, value: d.reduce((a, r) => a + r.amount, 0) };
  } else if (type === "overdue") {
    const d = await fetchOverdue(supabase);
    name = `overdue_loans_${todayIST()}`;
    cols = [{ header: "col.customer", width: 26 }, { header: "col.mobile", width: 14 }, { header: "col.loanNo", width: 11 }, { header: "col.vehicle", width: 14 }, { header: "col.overdueInst", width: 12 },
      { header: "col.overdueAmt", width: 16, fmt: MONEY }, { header: "col.principalOut", width: 18, fmt: MONEY }, { header: "col.receivable", width: 18, fmt: MONEY }, { header: "col.nextDue", width: 13, fmt: DATE }];
    rows = d.map((r) => [safeCell(r.customer), r.mobile, r.loanNo, r.vehicle, r.overdueInstallments, r.overdue, r.principalOut, r.receivable, toDate(r.nextDue)]);
    totals = { col: 5, value: d.reduce((a, r) => a + r.overdue, 0) };
  } else if (type === "disbursed") {
    const d = await fetchDisbursed(supabase, range.from, range.to);
    name = `loans_given_${range.from}_to_${range.to}`;
    cols = [{ header: "col.date", width: 13, fmt: DATE }, { header: "col.customer", width: 26 }, { header: "col.loanNo", width: 11 }, { header: "col.vehicle", width: 14 }, { header: "col.principal", width: 16, fmt: MONEY },
      { header: "col.rate", width: 11 }, { header: "col.interestMethod", width: 16 }, { header: "col.tenure", width: 11 }, { header: "col.instalment", width: 15, fmt: MONEY }];
    rows = d.map((r) => [toDate(r.date), safeCell(r.customer), r.loanNo, r.vehicle, r.principal, r.rate, r.method ? t(`loan.method.${r.method}` as MessageKey) : "", r.tenure, r.instalment]);
    totals = { col: 4, value: d.reduce((a, r) => a + r.principal, 0) };
  } else if (type === "sheet") {
    let day = todayIST();
    try { const dq = q.get("day"); if (dq) { parseDate(dq); day = dq; } } catch { /* today */ }
    const { data } = await supabase.rpc("collection_sheet", { p_date: day });
    const d = (data ?? []) as { external_ref: string | null; loan_no: string; customer_name: string; mobile: string; installment_amount: number; opening_balance: number; collected: number; closing_balance: number; remarks: string | null }[];
    name = `collection_sheet_${day}`;
    cols = [{ header: "sheet.col.sno", width: 7 }, { header: "sheet.col.borrower", width: 26 }, { header: "sheet.col.phone", width: 14 }, { header: "sheet.col.loanNo", width: 12 }, { header: "sheet.col.dailyDue", width: 15, fmt: MONEY },
      { header: "sheet.col.opening", width: 19, fmt: MONEY }, { header: "sheet.col.collected", width: 19, fmt: MONEY }, { header: "sheet.col.closing", width: 19, fmt: MONEY }, { header: "sheet.col.signature", width: 18 }, { header: "sheet.col.remarks", width: 28 }];
    rows = d.map((r, i) => [i + 1, safeCell(r.customer_name), r.mobile, r.external_ref ?? r.loan_no, Number(r.installment_amount), Number(r.opening_balance),
      Number(r.collected) !== 0 ? Number(r.collected) : null, Number(r.collected) !== 0 ? Number(r.closing_balance) : null, "", safeCell(r.remarks)]);
    const sum = (f: (r: (typeof d)[number]) => number) => d.reduce((a, r) => a + f(r), 0);
    totals = { col: 4, value: sum((r) => Number(r.installment_amount)), more: [{ col: 5, value: sum((r) => Number(r.opening_balance)) }, { col: 6, value: sum((r) => Number(r.collected)) }, { col: 7, value: sum((r) => Number(r.closing_balance)) }] };
  } else return new NextResponse("Unknown report", { status: 400 });

  // Every export is written to the audit log first; if that fails nothing is handed over.
  const { error: logErr } = await supabase.rpc("log_export", { p_kind: type, p_detail: { kind: type, from: range.from, to: range.to, rows: rows.length } });
  if (logErr) return new NextResponse("Could not record this export in the audit log, so it was not created.", { status: 500 });
  const buf = await buildWorkbook(t("rep.title"), cols.map((c) => ({ header: t(c.header), width: c.width, fmt: c.fmt })), rows, rows.length ? { label: t("col.total"), col: totals!.col, value: totals!.value, more: totals!.more } : undefined);
  return new NextResponse(buf, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" } });
}
