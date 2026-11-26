import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { formatINR, toPaise } from "@/lib/finance";
import { alertHref, alertVars, fillTemplate, groupAlerts, type AlertRow } from "@/lib/alerts";
import { Banner } from "../loan-ui";
import { TaskForm, TaskList, loadStaff, type TaskRow } from "../tasks-panel";

export default async function Alerts({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireProfile();
  const { t, lang } = await getT();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data }, { data: tasks }, staff] = await Promise.all([
    supabase.from("v_alerts").select("*").limit(500),
    supabase.from("follow_up_tasks").select("id, title, due_date, customer_id, loan_id, assigned_to").eq("status", "open").order("due_date").limit(200),
    loadStaff(supabase),
  ]);
  const groups = groupAlerts((data ?? []) as AlertRow[]);
  const helpers = { money: (n: number) => formatINR(toPaise(n)), category: (c: string) => t(`doc.cat.${c}` as MessageKey) };
  const msg = (k?: string) => (k && k in messages[lang] ? messages[lang][k as MessageKey] : null);
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{t("alerts.title")}</h1>
      {msg(sp.ok) && <Banner kind="ok">{msg(sp.ok)}</Banner>}
      {msg(sp.err) && <Banner kind="bad">{msg(sp.err)}</Banner>}
      {groups.length === 0 ? <p className="mb-8 text-ink-soft">{t("alerts.none")}</p> : groups.map((g) => (
        <section key={g.kind} className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">{t(`alerts.kind.${g.kind}` as MessageKey)} <span className="num text-ink-soft">({g.items.length})</span></h2>
          <ul className="divide-y divide-line border-y border-line bg-card">
            {g.items.slice(0, 50).map((a, i) => (
              <li key={`${a.loan_id}${a.document_id}${a.task_id}${i}`}>
                <Link href={alertHref(a)} className={`block min-h-12 border-l-4 px-4 py-3 hover:bg-paper ${a.severity === "high" ? "border-bad" : a.severity === "medium" ? "border-warn" : "border-line"}`}>
                  {fillTemplate(t(`alerts.item.${a.kind}` as MessageKey), alertVars(a, helpers))}</Link></li>))}
          </ul>
          {g.items.length > 50 && <p className="mt-1 text-sm text-ink-soft">{t("common.limit")}</p>}
        </section>))}
      <h2 className="mb-3 mt-10 text-xl font-semibold">{t("alerts.followups")}</h2>
      <div className="mb-6"><TaskList tasks={(tasks ?? []) as TaskRow[]} returnTo="/alerts" staff={staff} /></div>
      <details className="border border-line bg-card p-4"><summary className="cursor-pointer font-semibold">{t("task.add")}</summary>
        <div className="mt-4"><TaskForm returnTo="/alerts" staff={staff} /></div></details>
    </>
  );
}
