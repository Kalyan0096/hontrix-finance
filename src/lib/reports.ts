import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const ROW_LIMIT = 5000;

export interface CollectionRow { date: string; customer: string; loanNo: string; type: "receipt" | "reversal"; amount: number; method: string; reference: string }
export interface OverdueRow { loanNo: string; customer: string; mobile: string; vehicle: string; overdueInstallments: number; overdue: number; principalOut: number; receivable: number; nextDue: string | null }
export interface DisbursedRow { date: string; loanNo: string; customer: string; vehicle: string; principal: number; rate: number | null; method: string; tenure: number | null; instalment: number | null }

async function lookups(db: SupabaseClient, customerIds: string[], vehicleIds: string[] = []) {
  const uniq = (a: string[]) => [...new Set(a)];
  const [c, v] = await Promise.all([
    customerIds.length ? db.from("customers").select("id, full_name, mobile").in("id", uniq(customerIds)) : { data: [] },
    vehicleIds.length ? db.from("vehicles").select("id, registration_number").in("id", uniq(vehicleIds)) : { data: [] },
  ]);
  return { cust: new Map((c.data ?? []).map((x) => [x.id as string, x as { full_name: string; mobile: string }])), veh: new Map((v.data ?? []).map((x) => [x.id as string, x.registration_number as string])) };
}

export async function fetchCollections(db: SupabaseClient, from: string, to: string): Promise<CollectionRow[]> {
  const { data } = await db.from("payments").select("loan_id, kind, amount, payment_date, method, transaction_ref").gte("payment_date", from).lte("payment_date", to)
    .order("payment_date").order("created_at").limit(ROW_LIMIT);
  const pays = data ?? [];
  const loanIds = [...new Set(pays.map((p) => p.loan_id as string))];
  const { data: loans } = loanIds.length ? await db.from("loans").select("id, loan_no, customer_id").in("id", loanIds) : { data: [] };
  const lm = new Map((loans ?? []).map((l) => [l.id as string, l]));
  const { cust } = await lookups(db, (loans ?? []).map((l) => l.customer_id as string));
  return pays.map((p) => { const l = lm.get(p.loan_id as string); return {
    date: p.payment_date as string, customer: cust.get(l?.customer_id as string)?.full_name ?? "", loanNo: (l?.loan_no as string) ?? "", type: p.kind as "receipt" | "reversal",
    amount: Number(p.amount), method: p.method as string, reference: (p.transaction_ref as string) ?? "" }; });
}

export async function fetchOverdue(db: SupabaseClient): Promise<OverdueRow[]> {
  const { data } = await db.from("v_loan_outstanding").select("loan_no, customer_id, vehicle_id, overdue_installments, overdue_amount, principal_outstanding, total_receivable, next_due_date")
    .gt("overdue_amount", 0).order("overdue_amount", { ascending: false }).limit(ROW_LIMIT);
  const rows = data ?? [];
  const { cust, veh } = await lookups(db, rows.map((r) => r.customer_id as string), rows.map((r) => r.vehicle_id as string));
  return rows.map((r) => ({ loanNo: r.loan_no as string, customer: cust.get(r.customer_id as string)?.full_name ?? "", mobile: cust.get(r.customer_id as string)?.mobile ?? "",
    vehicle: veh.get(r.vehicle_id as string) ?? "", overdueInstallments: Number(r.overdue_installments), overdue: Number(r.overdue_amount), principalOut: Number(r.principal_outstanding),
    receivable: Number(r.total_receivable), nextDue: (r.next_due_date as string) ?? null }));
}

export async function fetchDisbursed(db: SupabaseClient, from: string, to: string): Promise<DisbursedRow[]> {
  const { data } = await db.from("loans").select("id, loan_no, customer_id, vehicle_id, disbursement_date, principal_amount").eq("source", "new").gte("disbursement_date", from).lte("disbursement_date", to)
    .order("disbursement_date").order("loan_no").limit(ROW_LIMIT);
  const rows = data ?? [];
  const ids = rows.map((r) => r.id as string);
  const [{ data: terms }, { cust, veh }] = await Promise.all([
    ids.length ? db.from("loan_terms").select("loan_id, interest_rate_pa, interest_method, tenure_installments, installment_amount").eq("is_current", true).in("loan_id", ids) : Promise.resolve({ data: [] }),
    lookups(db, rows.map((r) => r.customer_id as string), rows.map((r) => r.vehicle_id as string)),
  ]);
  const tm = new Map((terms ?? []).map((t) => [t.loan_id as string, t]));
  return rows.map((r) => { const t = tm.get(r.id as string); return {
    date: r.disbursement_date as string, loanNo: r.loan_no as string, customer: cust.get(r.customer_id as string)?.full_name ?? "", vehicle: veh.get(r.vehicle_id as string) ?? "",
    principal: Number(r.principal_amount), rate: t ? Number(t.interest_rate_pa) : null, method: (t?.interest_method as string) ?? "", tenure: t ? Number(t.tenure_installments) : null,
    instalment: t ? Number(t.installment_amount) : null }; });
}
