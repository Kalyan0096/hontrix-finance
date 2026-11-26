import type { SupabaseClient } from "@supabase/supabase-js";
import { getT } from "@/lib/i18n";
import { todayIST } from "@/lib/finance";
import { createTask, setTaskStatus } from "./alerts/actions";

export interface TaskRow { id: string; title: string; due_date: string; customer_id: string | null; loan_id: string | null; assigned_to: string | null }

export async function loadStaff(supabase: SupabaseClient) {
  const { data } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  return (data ?? []) as { id: string; full_name: string }[];
}

export async function TaskForm({ returnTo, customerId, loanId, staff }: { returnTo: string; customerId?: string; loanId?: string; staff: { id: string; full_name: string }[] }) {
  const { t } = await getT();
  return (
    <form action={createTask} className="space-y-3">
      <input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="customerId" value={customerId ?? ""} /><input type="hidden" name="loanId" value={loanId ?? ""} />
      <label className="block"><span className="mb-1 block font-medium">{t("task.title")}</span><input className="field" name="title" required minLength={2} maxLength={200} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block font-medium">{t("task.due")}</span><input className="field" type="date" name="due" defaultValue={todayIST()} required /></label>
        <label className="block"><span className="mb-1 block font-medium">{t("task.assign")}</span>
          <select className="field" name="assignedTo" defaultValue=""><option value="">{t("task.anyone")}</option>{staff.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
      </div>
      <label className="block"><span className="mb-1 block font-medium">{t("task.notes")} ({t("common.optional")})</span><input className="field" name="notes" /></label>
      <button className="btn">{t("task.add")}</button>
    </form>
  );
}

export async function TaskList({ tasks, returnTo, staff }: { tasks: TaskRow[]; returnTo: string; staff: { id: string; full_name: string }[] }) {
  const { t } = await getT();
  const name = new Map(staff.map((p) => [p.id, p.full_name]));
  const today = todayIST();
  if (tasks.length === 0) return <p className="text-ink-soft">{t("task.none")}</p>;
  return (
    <ul className="divide-y divide-line border-y border-line bg-card">
      {tasks.map((k) => (
        <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span><span className="block font-semibold">{k.title}</span>
            <span className={`num text-sm ${k.due_date < today ? "font-semibold text-bad" : "text-ink-soft"}`}>{k.due_date}{k.assigned_to ? ` · ${name.get(k.assigned_to) ?? ""}` : ""}</span></span>
          <span className="flex gap-2">
            {(["done", "cancelled"] as const).map((st) => (
              <form key={st} action={setTaskStatus}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="status" value={st} /><input type="hidden" name="returnTo" value={returnTo} />
                <button className={st === "done" ? "btn" : "btn-quiet"}>{t(st === "done" ? "task.done" : "task.cancel")}</button></form>))}
          </span>
        </li>))}
    </ul>
  );
}
