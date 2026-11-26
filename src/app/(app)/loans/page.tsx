import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { displayStatus } from "@/lib/loan-form";
import { sanitizeSearch } from "@/lib/records";
import { Pill, inr, statusLabel } from "../loan-ui";

const FILTERS = ["all", "active", "overdue", "closed"] as const;

export default async function Loans({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  await requireProfile();
  const { t } = await getT();
  const sp = await searchParams;
  const q = sanitizeSearch(sp.q ?? "");
  const f = (FILTERS as readonly string[]).includes(sp.f ?? "") ? sp.f! : "all";
  const supabase = await createClient();

  let query = supabase.from("v_loan_outstanding").select("loan_id, loan_no, status, customer_id, vehicle_id, principal_outstanding, overdue_amount, total_receivable, next_due_date")
    .order("overdue_amount", { ascending: false }).order("loan_no").limit(51);
  if (f === "overdue") query = query.gt("overdue_amount", 0);
  else if (f === "closed") query = query.eq("status", "closed");
  else if (f === "active") query = query.in("status", ["active", "overdue"]);
  if (q) {
    const [{ data: cs }, { data: byRef }] = await Promise.all([
      supabase.from("customers").select("id").ilike("full_name", `%${q}%`).limit(50),
      supabase.from("loans").select("id").ilike("external_ref", `%${q}%`).limit(50),
    ]);
    const ids = (cs ?? []).map((c) => c.id), refIds = (byRef ?? []).map((l) => l.id);
    query = query.or([`loan_no.ilike."%${q}%"`, ...(ids.length ? [`customer_id.in.(${ids.join(",")})`] : []), ...(refIds.length ? [`loan_id.in.(${refIds.join(",")})`] : [])].join(","));
  }
  const { data } = await query;
  const rows = (data ?? []).slice(0, 50);
  const cIds = [...new Set(rows.map((r) => r.customer_id))], vIds = [...new Set(rows.map((r) => r.vehicle_id))];
  const loanIds = rows.map((r) => r.loan_id);
  const [{ data: cs }, { data: vs }, { data: refs }] = await Promise.all([
    cIds.length ? supabase.from("customers").select("id, full_name").in("id", cIds) : { data: [] },
    vIds.length ? supabase.from("vehicles").select("id, registration_number").in("id", vIds) : { data: [] },
    loanIds.length ? supabase.from("loans").select("id, external_ref").in("id", loanIds) : { data: [] },
  ]);
  const extRef = new Map((refs ?? []).map((l) => [l.id as string, l.external_ref as string | null]));
  const cName = new Map((cs ?? []).map((c) => [c.id, c.full_name])), vReg = new Map((vs ?? []).map((v) => [v.id, v.registration_number]));

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">{t("loan.title")}</h1>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="filter">
        {FILTERS.map((x) => (
          <Link key={x} href={`/loans?f=${x}${q ? `&q=${encodeURIComponent(q)}` : ""}`} aria-current={f === x ? "page" : undefined}
            className={`btn-quiet inline-flex items-center ${f === x ? "!border-ink font-semibold" : ""}`}>{t(`loan.filter.${x}` as MessageKey)}</Link>
        ))}
      </nav>
      <form className="mb-6 flex gap-2" role="search"><input type="hidden" name="f" value={f} />
        <input className="field" name="q" defaultValue={q} placeholder={t("loan.searchHint")} aria-label={t("loan.searchHint")} />
        <button className="btn">{t("common.search")}</button></form>
      {rows.length === 0 ? <p className="text-ink-soft">{q || f !== "all" ? t("loan.noMatch") : t("loan.none")}</p> : (
        <ul className="divide-y divide-line border-y border-line bg-card">
          {rows.map((r) => {
            const st = displayStatus(r.status, Number(r.overdue_amount));
            return (
              <li key={r.loan_id}>
                <Link href={`/loans/${r.loan_id}`} className="block min-h-16 px-4 py-3 hover:bg-paper">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-lg font-semibold">{cName.get(r.customer_id) ?? "—"}</span>
                    <Pill label={statusLabel(t, st)} kind={st} />
                  </span>
                  <span className="flex flex-wrap justify-between gap-2 text-ink-soft">
                    <span>{r.loan_no}{extRef.get(r.loan_id) ? ` (${extRef.get(r.loan_id)})` : ""} · <span className="num">{vReg.get(r.vehicle_id) ?? ""}</span></span>
                    <span className="num">{t("loan.receivable")}: {inr(r.total_receivable)}</span>
                  </span>
                  {Number(r.overdue_amount) > 0 && <span className="num block font-semibold text-bad">{t("loan.overdue")}: {inr(r.overdue_amount)}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {(data ?? []).length > 50 && <p className="mt-3 text-sm text-ink-soft">{t("common.limit")}</p>}
    </>
  );
}
