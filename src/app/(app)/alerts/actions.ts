"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/documents";
import { parseDate } from "@/lib/finance";
import { mapDbError } from "@/lib/loan-form";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
/** Only come back to a page of ours: /alerts, /customers/<id> or /loans/<id>. */
const safeReturn = (r: string) => (r === "/alerts" || /^\/(customers|loans)\/[0-9a-f-]{36}$/i.test(r) ? r : "/alerts");

export async function createTask(f: FormData) {
  await requireProfile();
  const back = safeReturn(s(f, "returnTo"));
  const title = s(f, "title"), due = s(f, "due"), assigned = s(f, "assignedTo"), customerId = s(f, "customerId"), loanId = s(f, "loanId");
  if (title.length < 2 || title.length > 200) redirect(`${back}?err=err.task`);
  try { parseDate(due); } catch { redirect(`${back}?err=err.date`); }
  for (const id of [assigned, customerId, loanId]) if (id && !UUID_RE.test(id)) redirect(`${back}?err=err.generic`);
  const { error } = await (await createClient()).from("follow_up_tasks").insert({
    title, due_date: due, notes: s(f, "notes") || null, assigned_to: assigned || null, customer_id: customerId || null, loan_id: loanId || null });
  if (error) redirect(`${back}?err=${mapDbError(error)}`);
  revalidatePath("/alerts"); revalidatePath(back);
  redirect(`${back}?ok=task.saved`);
}

export async function setTaskStatus(f: FormData) {
  await requireProfile();
  const back = safeReturn(s(f, "returnTo")), id = s(f, "id"), status = s(f, "status");
  if (!UUID_RE.test(id) || !["done", "cancelled"].includes(status)) redirect(back);
  const { data, error } = await (await createClient()).from("follow_up_tasks").update({ status }).eq("id", id).eq("status", "open").select("id");
  if (error || !data?.length) redirect(`${back}?err=${error ? mapDbError(error) : "err.generic"}`);
  revalidatePath("/alerts"); revalidatePath(back);
  redirect(`${back}?ok=task.updated`);
}
