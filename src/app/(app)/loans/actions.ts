"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateSchedule, todayIST, toCreateLoanArgs } from "@/lib/finance";
import { sanitizeReturnTo } from "@/lib/password";
import { LOAN_FIELDS, mapDbError, readLoanValues, validateLoan, validatePayment } from "@/lib/loan-form";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createLoan(f: FormData) {
  await requireProfile();
  const vehicleId = s(f, "vehicleId");
  if (!UUID.test(vehicleId)) redirect("/loans");
  const v = readLoanValues((k) => f.get(k) as string | null);
  const back = (err: string) => redirect(`/loans/new?vehicle=${vehicleId}&${new URLSearchParams({ ...Object.fromEntries(LOAN_FIELDS.map((k) => [k, v[k]])), err })}`);
  const { error, input } = validateLoan(v, todayIST());
  if (error || !input) return back(error ?? "err.generic");

  const supabase = await createClient();
  const { data: veh } = await supabase.from("vehicles").select("id, customer_id").eq("id", vehicleId).maybeSingle();
  if (!veh) return back("err.generic");
  const schedule = generateSchedule(input); // recomputed on the server; the preview on screen is never trusted
  const a = toCreateLoanArgs(input, schedule, { processingFee: v.processingFee || "0", otherFees: v.otherFees || "0", notes: v.notes || undefined });
  const { data, error: dbErr } = await supabase.rpc("create_loan", {
    p_customer_id: veh.customer_id, p_vehicle_id: veh.id, p_principal: a.p_principal,
    p_application_date: v.appliedOn || null, p_approval_date: v.approvedOn || null, p_disbursement_date: v.disbursedOn,
    p_terms: a.p_terms, p_schedule: a.p_schedule,
  });
  if (dbErr || !data) return back(dbErr ? mapDbError(dbErr) : "err.generic");
  revalidatePath("/loans");
  redirect(`/loans/${data}?ok=loan.created`);
}

export async function recordPayment(f: FormData) {
  await requireProfile();
  const loanId = s(f, "loanId");
  if (!UUID.test(loanId)) redirect("/loans");
  const amount = s(f, "amount"), date = s(f, "date"), method = s(f, "method");
  const back = sanitizeReturnTo(s(f, "returnTo"), ["/payments"], `/loans/${loanId}`);
  const bad = validatePayment(amount, date, method, todayIST());
  if (bad) redirect(`${back}?err=${bad}`);
  const { error } = await (await createClient()).rpc("record_payment", {
    p_loan_id: loanId, p_amount: amount, p_payment_date: date, p_method: method, p_reference: s(f, "ref") || null, p_notes: s(f, "notes") || null,
  });
  if (error) redirect(`${back}?err=${mapDbError(error)}`);
  revalidatePath(`/loans/${loanId}`); revalidatePath("/payments");
  redirect(`${back}?ok=pay.recorded`);
}

export async function reversePayment(f: FormData) {
  await requireProfile();
  const loanId = s(f, "loanId"), paymentId = s(f, "paymentId"), reason = s(f, "reason");
  if (!UUID.test(loanId) || !UUID.test(paymentId)) redirect("/loans");
  if (reason.length < 3) redirect(`/loans/${loanId}?err=err.reason`);
  const { error } = await (await createClient()).rpc("reverse_payment", { p_payment_id: paymentId, p_reason: reason });
  if (error) redirect(`/loans/${loanId}?err=${mapDbError(error)}`);
  revalidatePath(`/loans/${loanId}`);
  redirect(`/loans/${loanId}?ok=pay.reverseDone`);
}
