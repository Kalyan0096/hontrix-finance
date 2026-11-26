import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { todayIST } from "@/lib/finance";
import { PRESETS, resolveRange } from "@/lib/report-range";
import { ROW_LIMIT, fetchCollections, fetchDisbursed, fetchOverdue } from "@/lib/reports";
import { PrintButton } from "../print-button";
import { Banner, inr } from "../loan-ui";

export default async function Reports({ searchParams }: { searchParams: Promise<{ preset?: string; from?: string; to?: string }> }) {
  const profile = await requireProfile();
  const { t } = await getT();
  const range = resolveRange(await searchParams, todayIST());
  const supabase = await createClient();
  const [collections, overdue, disbursed, { data: daily }] = await Promise.all([
    fetchCollections(supabase, range.from, range.to), fetchOverdue(supabase), fetchDisbursed(supabase, range.from, range.to),
    supabase.rpc("report_daily_collections", { p_from: range.from, p_to: range.to }),
  ]);
  const collected = collections.reduce((a, r) => a + r.amount, 0);
  const given = disbursed.reduce((a, r) => a + r.principal, 0);
  const overdueTotal = overdue.reduce((a, r) => a + r.overdue, 0);
  const qs = `from=${range.from}&to=${range.to}`;
  const owner = profile.role === "owner";
  const th = "p-2 font-semibold";
  const capped = collections.length >= ROW_LIMIT || overdue.length >= ROW_LIMIT || disbursed.length >= ROW_LIMIT;
  const Export = ({ type }: { type: string }) => owner
    ? <a className="btn-quiet inline-flex items-center print:hidden" href={`/reports/export?type=${type}&${qs}`}>{t("rep.exportExcel")}</a> : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("rep.title")}</h1>
        <span className="print:hidden"><PrintButton label={t("rep.print")} /></span>
      </div>
      <form className="mb-3 flex flex-wrap items-end gap-3 print:hidden" aria-label={t("rep.range")}>
        <label className="block"><span className="mb-1 block text-sm font-medium">{t("rep.from")}</span><input className="field" type="date" name="from" defaultValue={range.from} required /></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">{t("rep.to")}</span><input className="field" type="date" name="to" defaultValue={range.to} required /></label>
        <button className="btn">{t("rep.apply")}</button>
      </form>
      <nav className="mb-6 flex flex-wrap gap-2 print:hidden" aria-label={t("rep.range")}>
        {PRESETS.map((p) => <Link key={p} href={`/reports?preset=${p}`} aria-current={range.preset === p ? "page" : undefined} className={`btn-quiet inline-flex items-center ${range.preset === p ? "!border-ink font-semibold" : ""}`}>{t(`rep.preset.${p}` as MessageKey)}</Link>)}
      </nav>
      <p className="num mb-4 text-lg font-semibold">{range.from} → {range.to}</p>
      {range.error && <Banner kind="bad">{t(range.error as MessageKey)}</Banner>}
      {capped && <Banner kind="bad">{t("rep.limit")}</Banner>}
      {!owner && <p className="mb-4 text-sm text-ink-soft print:hidden">{t("rep.ownerExport")}</p>}

      <dl className="mb-10 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {[[t("rep.collected"), inr(collected), ""], [t("rep.disbursedAmount"), inr(given), `${disbursed.length} ${t("rep.disbursedCount")}`], [t("rep.receipts"), String(collections.filter((c) => c.type === "receipt").length), ""],
          [t("rep.overdueNow"), inr(overdueTotal), `${overdue.length} ${t("chart.loans")}`]].map(([k, v, n]) => (
          <div key={k} className="bg-card p-4"><dt className="text-ink-soft">{k}</dt><dd className={`num text-2xl font-bold ${k === t("rep.overdueNow") && overdueTotal > 0 ? "text-bad" : ""}`}>{v}</dd>{n && <dd className="text-sm text-ink-soft">{n}</dd>}</div>))}
      </dl>

      <Section title={t("rep.collections")} action={<Export type="collections" />}>
        {collections.length === 0 ? <p className="text-ink-soft">{t("rep.noData")}</p> : (<>
          {(daily ?? []).length > 1 && (<details className="mb-3 print:open"><summary className="btn-quiet inline-flex cursor-pointer items-center print:hidden">{t("rep.daily")}</summary>
            <table className="num mt-2 w-full max-w-md text-right"><thead><tr className="bg-paper"><th className={`${th} text-left`}>{t("col.date")}</th><th className={th}>{t("col.receipts")}</th><th className={th}>{t("col.amount")}</th></tr></thead>
              <tbody>{(daily ?? []).map((d: { day: string; receipts: number; collected: number }) => <tr key={d.day} className="border-t border-line"><td className="p-2 text-left">{d.day}</td><td className="p-2">{d.receipts}</td><td className="p-2">{inr(d.collected)}</td></tr>)}</tbody></table></details>)}
          <Table head={[t("col.date"), t("col.customer"), t("col.loanNo"), t("col.type"), t("col.method"), t("col.amount")]} right={[5]}
            rows={collections.map((r) => [r.date, r.customer, r.loanNo, r.type === "reversal" ? t("col.reversal") : t("col.receipt"), t(`pay.method.${r.method}` as MessageKey), inr(r.amount)])} total={[t("col.total"), inr(collected)]} />
        </>)}
      </Section>

      <Section title={t("rep.overdueLoans")} action={<Export type="overdue" />}>
        {overdue.length === 0 ? <p className="text-ink-soft">{t("rep.noData")}</p> :
          <Table head={[t("col.customer"), t("col.mobile"), t("col.loanNo"), t("col.vehicle"), t("col.overdueInst"), t("col.overdueAmt"), t("col.receivable")]} right={[4, 5, 6]}
            rows={overdue.map((r) => [r.customer, r.mobile, r.loanNo, r.vehicle, String(r.overdueInstallments), inr(r.overdue), inr(r.receivable)])} total={[t("col.total"), inr(overdueTotal)]} totalCol={5} />}
      </Section>

      <Section title={t("rep.disbursedLoans")} action={<Export type="disbursed" />}>
        {disbursed.length === 0 ? <p className="text-ink-soft">{t("rep.noData")}</p> :
          <Table head={[t("col.date"), t("col.customer"), t("col.loanNo"), t("col.vehicle"), t("col.principal"), t("col.rate")]} right={[4, 5]}
            rows={disbursed.map((r) => [r.date, r.customer, r.loanNo, r.vehicle, inr(r.principal), r.rate === null ? "—" : String(r.rate)])} total={[t("col.total"), inr(given)]} totalCol={4} />}
      </Section>
      <p className="mt-6 hidden text-sm text-ink-soft print:block">{t("app.name")} · {todayIST()}</p>
    </>
  );
}

function Section({ title, action, children }: { title: string; action: React.ReactNode; children: React.ReactNode }) {
  return (<section className="mb-10"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">{title}</h2>{action}</div>{children}</section>);
}

function Table({ head, rows, right, total, totalCol }: { head: string[]; rows: string[][]; right: number[]; total: string[]; totalCol?: number }) {
  const tc = totalCol ?? head.length - 1;
  return (
    <div className="overflow-x-auto border border-line bg-card">
      <table className="num w-full min-w-[34rem] text-sm">
        <thead className="bg-paper"><tr>{head.map((h, i) => <th key={h} className={`p-2 font-semibold ${right.includes(i) ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className={`p-2 ${right.includes(j) ? "text-right" : ""}`}>{c}</td>)}</tr>)}</tbody>
        <tfoot><tr className="border-t-2 border-ink font-bold"><td className="p-2" colSpan={tc}>{total[0]}</td><td className="p-2 text-right">{total[1]}</td>{head.length - tc - 1 > 0 && <td colSpan={head.length - tc - 1} />}</tr></tfoot>
      </table>
    </div>
  );
}
