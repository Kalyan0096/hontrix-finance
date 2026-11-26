import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { addDays, parseDate, todayIST } from "@/lib/finance";
import { PAYMENT_METHODS } from "@/lib/loan-form";
import { Banner, inr } from "../../loan-ui";
import { PrintButton } from "../../print-button";
import { saveCollectionSheet } from "./actions";

interface Row { loan_id: string; loan_no: string; external_ref: string | null; customer_name: string; mobile: string; installment_amount: number; arrears: number; opening_balance: number; collected: number; closing_balance: number; remarks: string | null }

export default async function CollectionSheet({ searchParams }: { searchParams: Promise<{ day?: string; saved?: string; failed?: string; why?: string; nfailed?: string; err?: string }> }) {
  const profile = await requireProfile();
  const { t, lang } = await getT();
  const sp = await searchParams;
  const today = todayIST();
  let day = today;
  try { if (sp.day) { parseDate(sp.day); day = sp.day <= addDays(today, 31) ? sp.day : today; } } catch { /* today */ }
  const supabase = await createClient();
  const [{ data }, { data: fin }] = await Promise.all([supabase.rpc("collection_sheet", { p_date: day }), supabase.from("financiers").select("name").maybeSingle()]);
  const rows = (data ?? []) as Row[];
  const canRecord = can(profile, "payments.record") && day <= today;
  const failedIds = new Set((sp.failed ?? "").split(",").filter(Boolean));
  const why = sp.why && sp.why in messages[lang] ? messages[lang][sp.why as MessageKey] : "";
  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  const anyCollected = rows.some((r) => Number(r.collected) !== 0);
  const msg = (k?: string) => (k && k in messages[lang] ? messages[lang][k as MessageKey] : null);
  const ref = (r: Row) => r.external_ref ?? r.loan_no;
  const th = "p-2 font-semibold";
  const H = (k: string) => t(`sheet.col.${k}` as MessageKey);

  return (
    <>
      <div className="print:hidden">
        <Link href="/payments" className="mb-4 inline-block underline">{t("common.back")}</Link>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-bold">{t("sheet.title")}</h1>
          <div className="flex flex-wrap gap-2">
            <PrintButton label={t("sheet.print")} />
            {profile.role === "owner" && <a className="btn-quiet inline-flex items-center" href={`/reports/export?type=sheet&day=${day}`}>{t("rep.exportExcel")}</a>}
          </div>
        </div>
        <form className="mb-5 flex flex-wrap items-end gap-2">
          <label className="block"><span className="mb-1 block text-sm font-medium">{t("pay.day")}</span><input className="field" type="date" name="day" defaultValue={day} /></label>
          <button className="btn-quiet">{t("rep.apply")}</button>
        </form>
        {sp.saved && <Banner kind="ok">{t("sheet.saved").replace("{n}", sp.saved)}</Banner>}
        {sp.failed && <Banner kind="bad">{t("sheet.failed").replace("{n}", sp.nfailed ?? "")}{why ? ` ${why}` : ""}</Banner>}
        {msg(sp.err) && <Banner kind="bad">{msg(sp.err)}</Banner>}
        {day > today && <p className="mb-4 text-ink-soft">{t("sheet.future")}</p>}
        {rows.length === 0 ? <p className="text-ink-soft">{t("sheet.none")}</p> : (
          <form action={saveCollectionSheet}>
            <input type="hidden" name="day" value={day} /><input type="hidden" name="batch" value={crypto.randomUUID()} />
            {canRecord && <p className="mb-3 text-ink-soft">{t("sheet.help")}</p>}
            <div className="overflow-x-auto border border-line bg-card">
              <table className="num w-full min-w-[64rem] text-sm">
                <thead className="bg-paper"><tr>
                  <th className={`${th} text-left`}>{H("sno")}</th><th className={`${th} text-left`}>{H("borrower")}</th><th className={`${th} text-left`}>{H("loanNo")}</th>
                  <th className={`${th} text-right`}>{H("dailyDue")}</th><th className={`${th} text-right`}>{H("arrears")}</th><th className={`${th} text-right`}>{H("opening")}</th>
                  <th className={`${th} text-right`}>{H("collected")}</th>{canRecord && <th className={`${th} text-right`}>{H("add")}</th>}<th className={`${th} text-right`}>{H("closing")}</th><th className={`${th} text-left`}>{H("remarks")}</th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const bad = failedIds.has(r.loan_id);
                    return (
                      <tr key={r.loan_id} className={`border-t border-line ${bad ? "bg-red-50" : ""}`}>
                        <td className="p-2">{i + 1}</td>
                        <td className="p-2"><Link href={`/loans/${r.loan_id}`} className="font-semibold underline">{r.customer_name}</Link>
                          <a className="block text-ink-soft" href={`tel:+91${r.mobile}`}>{r.mobile}</a>{bad && <span className="block font-semibold text-bad">{t("sheet.notSaved")}</span>}</td>
                        <td className="p-2">{ref(r)}</td>
                        <td className="p-2 text-right">{inr(r.installment_amount)}</td>
                        <td className={`p-2 text-right ${Number(r.arrears) > 0 ? "font-semibold text-bad" : ""}`}>{inr(r.arrears)}</td>
                        <td className="p-2 text-right">{inr(r.opening_balance)}</td>
                        <td className="p-2 text-right">{inr(r.collected)}</td>
                        {canRecord && <td className="p-2 text-right"><input className="field num !min-h-10 !w-28 !p-2 text-right" name={`amt_${r.loan_id}`} inputMode="decimal" aria-label={`${r.customer_name} ${t("sheet.col.add")}`} /></td>}
                        <td className="p-2 text-right font-semibold">{inr(r.closing_balance)}</td>
                        <td className="p-2">{canRecord ? <input className="field !min-h-10 !p-2" name={`rem_${r.loan_id}`} maxLength={200} defaultValue="" placeholder={r.remarks ?? ""} aria-label={`${r.customer_name} ${t("sheet.col.remarks")}`} /> : r.remarks}</td>
                      </tr>);
                  })}
                </tbody>
                <tfoot><tr className="border-t-2 border-ink font-bold">
                  <td className="p-2" colSpan={3}>{t("sheet.total")}</td><td className="p-2 text-right">{inr(sum((r) => Number(r.installment_amount)))}</td><td className="p-2 text-right">{inr(sum((r) => Number(r.arrears)))}</td>
                  <td className="p-2 text-right">{inr(sum((r) => Number(r.opening_balance)))}</td><td className="p-2 text-right">{inr(sum((r) => Number(r.collected)))}</td>{canRecord && <td />}<td className="p-2 text-right">{inr(sum((r) => Number(r.closing_balance)))}</td><td />
                </tr></tfoot>
              </table>
            </div>
            {canRecord && (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="block"><span className="mb-1 block text-sm font-medium">{t("sheet.method")}</span>
                  <select className="field !w-auto" name="method">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`pay.method.${m}` as MessageKey)}</option>)}</select></label>
                <button className="btn">{t("sheet.save")}</button>
              </div>)}
          </form>)}
      </div>

      {/* The printed sheet: same columns as the paper register; collected/closing stay blank until something is collected. */}
      <section className="hidden print:block">
        <h1 className="text-xl font-bold">{fin?.name} — {t("sheet.title")}</h1>
        <p className="num mb-2">{day}</p>
        <table className="num w-full border-collapse text-xs">
          <thead><tr>{["sno", "borrower", "phone", "loanNo", "dailyDue", "opening", "collected", "closing", "signature", "remarks"].map((k) => <th key={k} className="border border-ink p-1 text-left">{H(k)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.loan_id} className="h-9">
                <td className="border border-ink p-1">{i + 1}</td><td className="border border-ink p-1">{r.customer_name}</td><td className="border border-ink p-1">{r.mobile}</td><td className="border border-ink p-1">{ref(r)}</td>
                <td className="border border-ink p-1 text-right">{inr(r.installment_amount)}</td><td className="border border-ink p-1 text-right">{inr(r.opening_balance)}</td>
                <td className="border border-ink p-1 text-right">{Number(r.collected) !== 0 ? inr(r.collected) : ""}</td><td className="border border-ink p-1 text-right">{Number(r.collected) !== 0 ? inr(r.closing_balance) : ""}</td>
                <td className="border border-ink p-1 w-28" /><td className="border border-ink p-1">{r.remarks ?? ""}</td>
              </tr>))}
          </tbody>
          <tfoot><tr className="font-bold"><td className="border border-ink p-1" colSpan={4}>{t("sheet.total")}</td><td className="border border-ink p-1 text-right">{inr(sum((r) => Number(r.installment_amount)))}</td>
            <td className="border border-ink p-1 text-right">{inr(sum((r) => Number(r.opening_balance)))}</td><td className="border border-ink p-1 text-right">{anyCollected ? inr(sum((r) => Number(r.collected))) : ""}</td>
            <td className="border border-ink p-1 text-right">{anyCollected ? inr(sum((r) => Number(r.closing_balance))) : ""}</td><td className="border border-ink p-1" colSpan={2} /></tr></tfoot>
        </table>
      </section>
    </>
  );
}
