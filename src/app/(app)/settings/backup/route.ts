import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buildMultiWorkbook, type Cell } from "@/lib/excel";
import { safeCell } from "@/lib/report-range";
import { todayIST } from "@/lib/finance";

const MAX_ROWS = 20000, PAGE = 1000;
const MONEY = "#,##0.00", DATE = "dd-mmm-yyyy";
const d = (v: unknown) => (typeof v === "string" && v ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : null);
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => safeCell(v === null || v === undefined ? "" : String(v));

type Row = Record<string, unknown>;
async function fetchAll(db: SupabaseClient, table: string, columns: string, order: string, filter?: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = db.from(table).select(columns).order(order).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

/** Owner-only: one Excel file with all the business's records. Read through the owner's own session, so database rules still apply. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (!me || !me.is_active || me.role !== "owner") return new NextResponse("Only the owner can export", { status: 403 });

  try {
    const [customers, vehicles, loans, terms, schedule, payments, documents, tasks] = await Promise.all([
      fetchAll(supabase, "customers", "id, customer_no, full_name, mobile, address, district, state, status, created_at", "customer_no"),
      fetchAll(supabase, "vehicles", "customer_id, registration_number, make, model, manufacture_year, category, chassis_number, engine_number, registered_owner, insurance_expiry, hypothecation_details", "registration_number"),
      fetchAll(supabase, "loans", "id, loan_no, external_ref, source, customer_id, vehicle_id, status, application_date, approval_date, disbursement_date, principal_amount", "loan_no"),
      fetchAll(supabase, "loan_terms", "loan_id, interest_rate_pa, interest_method, frequency, tenure_installments, installment_amount, first_due_date, final_due_date, processing_fee, other_fees, skip_sundays", "loan_id", (q) => q.eq("is_current", true)),
      fetchAll(supabase, "v_schedule_status", "loan_id, installment_no, due_date, principal_due, interest_due, fees_due, paid_total, total_outstanding, status", "due_date"),
      fetchAll(supabase, "payments", "loan_id, kind, amount, payment_date, method, transaction_ref, notes, reversal_reason, created_at", "payment_date"),
      fetchAll(supabase, "documents", "customer_id, vehicle_id, loan_id, category, title, status, expiry_date, created_at", "created_at"),
      fetchAll(supabase, "follow_up_tasks", "title, due_date, status, customer_id, loan_id, created_at, completed_at", "due_date"),
    ]);
    const cust = new Map(customers.map((c) => [c.id as string, c]));
    const loanBy = new Map(loans.map((l) => [l.id as string, l]));
    const cNo = (id: unknown) => String(cust.get(id as string)?.customer_no ?? "");
    const lNo = (id: unknown) => String(loanBy.get(id as string)?.loan_no ?? "");

    const col = (header: string, width = 16, fmt?: string) => ({ header, width, fmt });
    const sheets = [
      { name: "Customers", cols: [col("Customer no.", 13), col("Name", 26), col("Mobile", 14), col("Address", 30), col("District"), col("State"), col("Status", 10), col("Created", 13, DATE)],
        rows: customers.map((c): Cell[] => [txt(c.customer_no), txt(c.full_name), txt(c.mobile), txt(c.address), txt(c.district), txt(c.state), txt(c.status), d(c.created_at)]) },
      { name: "Vehicles", cols: [col("Customer no.", 13), col("Registration", 16), col("Make"), col("Model"), col("Year", 8), col("Type", 12), col("Chassis", 20), col("Engine", 20), col("Registered owner", 24), col("Insurance until", 14, DATE), col("Hypothecation", 28)],
        rows: vehicles.map((v): Cell[] => [cNo(v.customer_id), txt(v.registration_number), txt(v.make), txt(v.model), n(v.manufacture_year), txt(v.category), txt(v.chassis_number), txt(v.engine_number), txt(v.registered_owner), d(v.insurance_expiry), txt(v.hypothecation_details)]) },
      { name: "Loans", cols: [col("Loan no.", 11), col("Register no.", 13), col("Source", 10), col("Customer no.", 13), col("Customer", 24), col("Status", 12), col("Given on", 13, DATE), col("Amount (₹)", 15, MONEY), col("Rate % p.a.", 11), col("Method", 16), col("Frequency", 12), col("Instalments", 11), col("Instalment (₹)", 15, MONEY), col("First due", 13, DATE), col("Final due", 13, DATE), col("Skip Sundays", 12)],
        rows: loans.map((l): Cell[] => { const t = terms.find((x) => x.loan_id === l.id); return [txt(l.loan_no), txt(l.external_ref), txt(l.source), cNo(l.customer_id), txt(cust.get(l.customer_id as string)?.full_name), txt(l.status), d(l.disbursement_date), n(l.principal_amount),
          n(t?.interest_rate_pa), txt(t?.interest_method), txt(t?.frequency), n(t?.tenure_installments), n(t?.installment_amount), d(t?.first_due_date), d(t?.final_due_date), t ? (t.skip_sundays ? "yes" : "no") : ""]; }) },
      { name: "Instalments", cols: [col("Loan no.", 11), col("No.", 6), col("Due date", 13, DATE), col("Principal (₹)", 15, MONEY), col("Interest (₹)", 15, MONEY), col("Fees (₹)", 12, MONEY), col("Paid (₹)", 15, MONEY), col("Outstanding (₹)", 16, MONEY), col("Status", 14)],
        rows: schedule.map((s): Cell[] => [lNo(s.loan_id), n(s.installment_no), d(s.due_date), n(s.principal_due), n(s.interest_due), n(s.fees_due), n(s.paid_total), n(s.total_outstanding), txt(s.status)]) },
      { name: "Payments", cols: [col("Loan no.", 11), col("Date", 13, DATE), col("Type", 10), col("Amount (₹)", 15, MONEY), col("Method", 14), col("Reference", 20), col("Notes", 28), col("Reversal reason", 28)],
        rows: payments.map((p): Cell[] => [lNo(p.loan_id), d(p.payment_date), txt(p.kind), n(p.amount), txt(p.method), txt(p.transaction_ref), txt(p.notes), txt(p.reversal_reason)]) },
      { name: "Documents", cols: [col("Customer no.", 13), col("Loan no.", 11), col("Type", 18), col("Title", 24), col("Status", 14), col("Expires", 13, DATE), col("Added", 13, DATE)],
        rows: documents.map((x): Cell[] => [cNo(x.customer_id), lNo(x.loan_id), txt(x.category), txt(x.title), txt(x.status), d(x.expiry_date), d(x.created_at)]) },
      { name: "Follow-ups", cols: [col("Task", 36), col("Due", 13, DATE), col("Status", 11), col("Customer no.", 13), col("Loan no.", 11), col("Created", 13, DATE), col("Completed", 13, DATE)],
        rows: tasks.map((x): Cell[] => [txt(x.title), d(x.due_date), txt(x.status), cNo(x.customer_id), lNo(x.loan_id), d(x.created_at), d(x.completed_at)]) },
    ];
    const counts = Object.fromEntries(sheets.map((s) => [s.name, s.rows.length]));
    const { error: logErr } = await supabase.rpc("log_export", { p_kind: "backup", p_detail: { kind: "backup", rows: counts } });
    if (logErr) return new NextResponse("Could not record this export in the audit log, so it was not created.", { status: 500 });
    const buf = await buildMultiWorkbook(sheets);
    return new NextResponse(buf, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="data_export_${todayIST()}.xlsx"`, "Cache-Control": "no-store" } });
  } catch {
    return new NextResponse("The export could not be completed. Try again.", { status: 500 });
  }
}
