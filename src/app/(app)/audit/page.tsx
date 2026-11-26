import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { AUDIT_ACTIONS, AUDIT_TABLES, summarizeAudit, type AuditRow } from "@/lib/audit";
import { parseDate } from "@/lib/finance";
import { UUID_RE } from "@/lib/documents";

const PAGE = 50;

export default async function AuditLog({ searchParams }: { searchParams: Promise<{ table?: string; action?: string; user?: string; from?: string; to?: string; page?: string }> }) {
  await requireOwner();
  const { t, lang } = await getT();
  const sp = await searchParams;
  const table = (AUDIT_TABLES as readonly string[]).includes(sp.table ?? "") ? sp.table! : "";
  const action = (AUDIT_ACTIONS as readonly string[]).includes(sp.action ?? "") ? sp.action! : "";
  const user = UUID_RE.test(sp.user ?? "") ? sp.user! : "";
  const ok = (d?: string) => { try { if (d) { parseDate(d); return d; } } catch { /* ignore */ } return ""; };
  const from = ok(sp.from), to = ok(sp.to);
  const page = Math.max(1, Math.min(2000, Number(sp.page) || 1));
  const supabase = await createClient();

  let q = supabase.from("audit_logs").select("id, created_at, actor_id, action, table_name, record_id, old_data, new_data", { count: "exact" }).order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (table) q = q.eq("table_name", table);
  if (action) q = q.eq("action", action);
  if (user) q = q.eq("actor_id", user);
  if (from) q = q.gte("created_at", `${from}T00:00:00+05:30`);
  if (to) q = q.lte("created_at", `${to}T23:59:59+05:30`);
  const [{ data, count }, { data: staff }] = await Promise.all([q, supabase.from("profiles").select("id, full_name").order("full_name")]);
  const rows = (data ?? []) as AuditRow[];
  const names = new Map((staff ?? []).map((p) => [p.id as string, p.full_name as string]));
  const fmt = new Intl.DateTimeFormat(lang === "te" ? "te-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const label = (name: string) => (name.startsWith("export:") ? t("audit.table.export") : t(`audit.table.${name}` as MessageKey));
  const qs = (p: number) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ table, action, user, from, to })) if (v) u.set(k, v); u.set("page", String(p)); return `/audit?${u}`; };
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{t("audit.title")}</h1>
      <p className="mb-5 max-w-2xl text-ink-soft">{t("audit.help")}</p>
      <form className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" role="search">
        <label className="block"><span className="mb-1 block text-sm font-medium">{t("audit.filterTable")}</span>
          <select className="field" name="table" defaultValue={table}><option value="">{t("audit.all")}</option>{AUDIT_TABLES.map((x) => <option key={x} value={x}>{t(`audit.table.${x}` as MessageKey)}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">{t("audit.filterAction")}</span>
          <select className="field" name="action" defaultValue={action}><option value="">{t("audit.all")}</option>{AUDIT_ACTIONS.map((x) => <option key={x} value={x}>{t(`audit.action.${x}` as MessageKey)}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">{t("audit.filterUser")}</span>
          <select className="field" name="user" defaultValue={user}><option value="">{t("audit.all")}</option>{(staff ?? []).map((p) => <option key={p.id as string} value={p.id as string}>{p.full_name as string}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">{t("rep.from")}</span><input className="field" type="date" name="from" defaultValue={from} /></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">{t("rep.to")}</span><input className="field" type="date" name="to" defaultValue={to} /></label>
        <div className="flex items-end"><button className="btn w-full">{t("rep.apply")}</button></div>
      </form>
      {rows.length === 0 ? <p className="text-ink-soft">{t("audit.none")}</p> : (
        <div className="overflow-x-auto border border-line bg-card">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-paper"><tr><th className="p-2 text-left">{t("audit.when")}</th><th className="p-2 text-left">{t("audit.who")}</th><th className="p-2 text-left">{t("audit.what")}</th><th className="p-2 text-left">{t("audit.record")}</th><th className="p-2 text-left">{t("audit.details")}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="num p-2 whitespace-nowrap">{fmt.format(new Date(r.created_at))}</td>
                <td className="p-2">{r.actor_id ? names.get(r.actor_id) ?? "—" : t("audit.system")}</td>
                <td className="p-2">{t(`audit.action.${r.action}` as MessageKey)}</td>
                <td className="p-2">{label(r.table_name)}</td>
                <td className="p-2 break-words">{summarizeAudit(r)}</td>
              </tr>))}</tbody>
          </table>
        </div>)}
      <nav className="mt-4 flex items-center justify-between" aria-label="pages">
        {page > 1 ? <Link className="btn-quiet inline-flex items-center" href={qs(page - 1)}>{t("audit.prev")}</Link> : <span />}
        <span className="num text-ink-soft">{t("audit.page")} {page} / {pages}</span>
        {page < pages ? <Link className="btn-quiet inline-flex items-center" href={qs(page + 1)}>{t("audit.next")}</Link> : <span />}
      </nav>
    </>
  );
}
