"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/documents";
import { parseDate, todayIST } from "@/lib/finance";
import { PAYMENT_METHODS, mapDbError, validatePayment } from "@/lib/loan-form";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Saves every amount typed on the sheet, one checked payment per borrower. A row that cannot be saved never blocks the others. */
export async function saveCollectionSheet(f: FormData) {
  await requireProfile();
  const today = todayIST(), day = s(f, "day");
  try { parseDate(day); } catch { redirect("/payments/sheet"); }
  const back = `/payments/sheet?day=${day}`;
  if (day > today) redirect(`${back}&err=sheet.future`);
  const method = s(f, "method");
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) redirect(`${back}&err=err.generic`);
  const batch = s(f, "batch").replace(/[^0-9a-f]/gi, "").slice(0, 8) || crypto.randomUUID().slice(0, 8);
  const ref = `SHEET-${batch}`; // marks this submission so a double-click or a re-sent form cannot record the same payments twice

  const entries: { id: string; amount: string; remark: string }[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("amt_")) continue;
    const id = k.slice(4), amount = String(v).trim();
    if (!UUID_RE.test(id) || amount === "") continue;
    entries.push({ id, amount, remark: s(f, `rem_${id}`).slice(0, 200) });
  }
  if (entries.length === 0) redirect(`${back}&saved=0`);
  if (entries.length > 2000) redirect(`${back}&err=err.generic`);

  const supabase = await createClient();
  const { data: already } = await supabase.from("payments").select("loan_id").eq("transaction_ref", ref).limit(3000);
  const done = new Set((already ?? []).map((p) => p.loan_id as string));
  let saved = 0;
  const failed: { id: string; why: string }[] = [];
  for (const e of entries) {
    if (done.has(e.id)) { saved++; continue; }
    const bad = validatePayment(e.amount, day, method, today);
    if (bad) { failed.push({ id: e.id, why: bad }); continue; }
    const { error } = await supabase.rpc("record_payment", { p_loan_id: e.id, p_amount: e.amount, p_payment_date: day, p_method: method, p_reference: ref, p_notes: e.remark || null });
    if (error) failed.push({ id: e.id, why: mapDbError(error) }); else saved++;
  }
  revalidatePath("/payments"); revalidatePath("/payments/sheet"); revalidatePath("/loans");
  const extra = failed.length ? `&failed=${failed.slice(0, 40).map((x) => x.id).join(",")}&why=${failed[0]!.why}&nfailed=${failed.length}` : "";
  redirect(`${back}&saved=${saved}${extra}`);
}
