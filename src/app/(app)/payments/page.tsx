import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { addDays, parseDate, todayIST } from "@/lib/finance";
import { PAYMENT_METHODS } from "@/lib/loan-form";
import { Banner, inr } from "../loan-ui";
import { recordPayment } from "../loans/actions";

export default async function PaymentsDesk({ searchParams }: { searchParams: Promise<{ day?: string; ok?: string; err?: string }> }) {
  const profile = await requireProfile();
  const { t, lang } = await getT();
  const sp = await searchParams;
  const today = todayIST();
  let day = today;
  try { if (sp.day) { parseDate(sp.day); day = sp.day <= today ? sp.day : today; } } catch { /* keep today */ }
  const supabase = await createClient();
  const [{ data: over }, { data: soon }, { data: paid }] = await Promise.all([
    supabase.from("v_loan_outstanding").select("loan_id, loan_no, customer_id, vehicle_id, overdue_amount, overdue_installments, next_due_date").gt("overdue_amount", 0).in("status", ["active", "overdue"]).order("overdue_amount", { ascending: false }).limit(100),
    supabase.from("v_schedule_status").select("schedule_id, loan_id, installment_no, due_date, total_outstanding").gt("total_outstanding", 0).gte("due_date", today).lte("due_date", addDays(today, 7)).order("due_date").limit(100),
    supabase.from("payments").select("id, loan_id, kind, amount, method, transaction_ref").eq("payment_date", day).order("created_at", { ascending: false }).limit(200),
  ]);
  const loanIds = [...new Set([...(soon ?? []).map((r) => r.loan_id), ...(paid ?? []).map((r) => r.loan_id)])];
  const { data: extra } = loanIds.length ? await supabase.from("loans").select("id, loan_no, customer_id").in("id", loanIds) : { data: [] };
  const loanInfo = new Map((extra ?? []).map((l) => [l.id as string, l]));
  const custIds = [...new Set([...(over ?? []).map((o) => o.customer_id), ...(extra ?? []).map((l) => l.customer_id)])] as string[];
  const { data: cs } = custIds.length ? await supabase.from("customers").select("id, full_name, mobile").in("id", custIds) : { data: [] };
  const cust = new Map((cs ?? []).map((c) => [c.id as string, c]));
  const net = (paid ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const canRecord = can(profile, "payments.record");
  const msg = (k?: string) => (k && k in messages[lang] ? messages[lang][k as MessageKey] : null);
  const Call = ({ mobile }: { mobile?: string }) => mobile ? <a className="btn-quiet inline-flex items-center" href={`tel:+91${mobile}`}>{t("pay.call")} <span className="num ml-1">{mobile}</span></a> : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">{t("pay.title")}</h1><Link href="/payments/sheet" className="btn inline-flex items-center">{t("sheet.open")}</Link></div>
      {msg(sp.ok) && <Banner kind="ok">{msg(sp.ok)}</Banner>}
      {msg(sp.err) && <Banner kind="bad">{msg(sp.err)}</Banner>}

      <h2 className="mb-3 text-xl font-semibold">{t("pay.overdueList")}</h2>
      {(over ?? []).length === 0 ? <p className="mb-8 text-ink-soft">{t("pay.noOverdue")}</p> : (
        <ul className="mb-10 space-y-3">
          {(over ?? []).map((o) => { const c = cust.get(o.customer_id as string) as { full_name: string; mobile: string } | undefined; return (
            <li key={o.loan_id} className="border border-line border-l-8 border-l-bad bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/loans/${o.loan_id}`} className="text-lg font-semibold underline">{c?.full_name ?? "—"}</Link>
                <span className="num text-2xl font-bold text-bad">{inr(o.overdue_amount)}</span>
              </div>
              <p className="num text-ink-soft">{o.loan_no} · {o.overdue_installments} × · {o.next_due_date}</p>
              <div className="mt-3 flex flex-wrap items-start gap-2">
                <Call mobile={c?.mobile} />
                {canRecord && (
                  <details><summary className="btn-quiet inline-flex cursor-pointer items-center">{t("pay.quick")}</summary>
                    <form action={recordPayment} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="loanId" value={o.loan_id} /><input type="hidden" name="date" value={today} /><input type="hidden" name="returnTo" value="/payments" />
                      <label className="block"><span className="mb-1 block text-sm">{t("pay.amount")}</span><input className="field num !w-36" name="amount" inputMode="decimal" required /></label>
                      <label className="block"><span className="mb-1 block text-sm">{t("pay.method")}</span><select className="field !w-auto" name="method">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`pay.method.${m}` as MessageKey)}</option>)}</select></label>
                      <label className="block"><span className="mb-1 block text-sm">{t("pay.ref")}</span><input className="field !w-40" name="ref" /></label>
                      <button className="btn">{t("pay.quick")}</button>
                    </form></details>)}
              </div>
            </li>); })}
        </ul>)}

      <h2 className="mb-3 text-xl font-semibold">{t("pay.upcomingList")}</h2>
      {(soon ?? []).length === 0 ? <p className="mb-10 text-ink-soft">{t("pay.noUpcoming")}</p> : (
        <ul className="mb-10 divide-y divide-line border-y border-line bg-card">
          {(soon ?? []).map((r) => { const l = loanInfo.get(r.loan_id as string); const c = cust.get(l?.customer_id as string) as { full_name: string; mobile: string } | undefined; return (
            <li key={r.schedule_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span><Link href={`/loans/${r.loan_id}`} className="font-semibold underline">{c?.full_name ?? "—"}</Link><span className="num block text-sm text-ink-soft">{l?.loan_no} · #{r.installment_no} · {r.due_date}</span></span>
              <span className="flex items-center gap-3"><span className="num text-lg font-semibold">{inr(r.total_outstanding)}</span><Call mobile={c?.mobile} /></span>
            </li>); })}
        </ul>)}

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-semibold">{t("pay.collectedOn")} <span className="num">{day}</span></h2>
        <form className="flex items-end gap-2"><label className="block"><span className="mb-1 block text-sm">{t("pay.day")}</span><input className="field" type="date" name="day" max={today} defaultValue={day} /></label><button className="btn-quiet">{t("rep.apply")}</button></form>
      </div>
      <p className="num mb-3 text-2xl font-bold">{t("pay.net")}: {inr(net)}</p>
      {(paid ?? []).length === 0 ? <p className="text-ink-soft">{t("pay.noneToday")}</p> : (
        <ul className="divide-y divide-line border-y border-line bg-card">
          {(paid ?? []).map((p) => { const l = loanInfo.get(p.loan_id as string); const c = cust.get(l?.customer_id as string) as { full_name: string } | undefined; return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span><Link href={`/loans/${p.loan_id}`} className="font-semibold underline">{c?.full_name ?? "—"}</Link><span className="num block text-sm text-ink-soft">{l?.loan_no} · {t(`pay.method.${p.method}` as MessageKey)}{p.transaction_ref ? ` · ${p.transaction_ref}` : ""}</span></span>
              <span className={`num text-lg font-semibold ${p.kind === "reversal" ? "text-bad" : ""}`}>{inr(p.amount)}</span>
            </li>); })}
        </ul>)}
    </>
  );
}
