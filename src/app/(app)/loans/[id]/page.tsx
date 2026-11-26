import { notFound } from "next/navigation";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { todayIST } from "@/lib/finance";
import { PAYMENT_METHODS, displayStatus } from "@/lib/loan-form";
import { Banner, Pill, inr, statusLabel } from "../../loan-ui";
import { recordPayment, reversePayment } from "../actions";
import { TaskForm, TaskList, loadStaff, type TaskRow } from "../../tasks-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LoanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const profile = await requireProfile();
  const { t, lang } = await getT();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: o } = await supabase.from("v_loan_outstanding").select("*").eq("loan_id", id).maybeSingle();
  if (!o) notFound();
  const [{ data: cust }, { data: veh }, { data: terms }, { data: sched }, { data: pays }] = await Promise.all([
    supabase.from("customers").select("id, full_name, mobile").eq("id", o.customer_id).maybeSingle(),
    supabase.from("vehicles").select("registration_number").eq("id", o.vehicle_id).maybeSingle(),
    supabase.from("loan_terms").select("*").eq("loan_id", id).eq("is_current", true).maybeSingle(),
    supabase.from("v_schedule_status").select("*").eq("loan_id", id).order("installment_no"),
    supabase.from("payments").select("id, kind, amount, payment_date, method, transaction_ref, notes, reverses_payment_id, reversal_reason, created_at").eq("loan_id", id).order("created_at", { ascending: false }),
  ]);
  const [{ data: rules }, { data: missing }, staff, { data: tasks }] = await Promise.all([
    supabase.from("required_document_rules").select("category").order("category"),
    supabase.from("v_loan_missing_documents").select("category").eq("loan_id", id),
    loadStaff(supabase),
    supabase.from("follow_up_tasks").select("id, title, due_date, customer_id, loan_id, assigned_to").eq("loan_id", id).eq("status", "open").order("due_date"),
  ]);
  const missingSet = new Set((missing ?? []).map((m) => m.category as string));
  const payments = pays ?? [];
  const reversed = new Set(payments.filter((p) => p.kind === "reversal").map((p) => p.reverses_payment_id));
  const st = displayStatus(o.status, Number(o.overdue_amount));
  const msg = (k?: string) => (k && k in messages[lang] ? messages[lang][k as MessageKey] : null);
  const open = ["disbursed", "active", "overdue"].includes(o.status);
  const today = todayIST();

  return (
    <>
      <Link href="/loans" className="mb-4 inline-block underline">{t("common.back")}</Link>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-bold">{cust?.full_name}</h1><Pill label={statusLabel(t, st)} kind={st} /></div>
      <p className="num mb-6 text-ink-soft">{o.loan_no} · {veh?.registration_number} · {cust?.mobile}</p>
      {msg(sp.ok) && <Banner kind="ok">{msg(sp.ok)}</Banner>}
      {msg(sp.err) && <Banner kind="bad">{msg(sp.err)}</Banner>}

      <section className="mb-6 border-l-8 border-ink bg-card p-6">
        <p className="text-ink-soft">{t("loan.receivable")}</p>
        <p className="num text-4xl font-bold md:text-5xl">{inr(o.total_receivable)}</p>
        {Number(o.overdue_amount) > 0 && <p className="num mt-1 text-xl font-semibold text-bad">{t("loan.overdue")}: {inr(o.overdue_amount)}</p>}
      </section>
      <dl className="mb-8 divide-y divide-line border-y border-line bg-card">
        {[[t("loan.principal"), inr(o.principal_amount)], [t("loan.outPrincipal"), inr(o.principal_outstanding)], [t("loan.outInterest"), inr(o.interest_outstanding)],
          [t("loan.nextDue"), o.next_due_date ?? "—"],
          ...(terms ? [[t("loan.method"), terms.interest_method === "fixed_installment" ? t("loan.method.fixed_installment") : `${Number(terms.interest_rate_pa)}% · ${t(`loan.method.${terms.interest_method}` as MessageKey)}`],
            [t("loan.instalment"), `${inr(terms.installment_amount)} · ${t(`loan.freq.${terms.frequency}` as MessageKey)}`],
            ...(Number(terms.processing_fee) + Number(terms.other_fees) > 0 ? [[`${t("loan.processingFee")} / ${t("loan.otherFees")}`, `${inr(terms.processing_fee)} / ${inr(terms.other_fees)}`]] : [])] : [])]
          .map(([k, v]) => (<div key={k} className="flex flex-wrap justify-between gap-4 px-4 py-3"><dt className="text-ink-soft">{k}</dt><dd className="num text-right text-lg font-semibold">{v}</dd></div>))}
      </dl>

      {open && can(profile, "payments.record") && (
        <form action={recordPayment} className="mb-10 space-y-4 border border-line bg-card p-5">
          <input type="hidden" name="loanId" value={id} />
          <h2 className="text-xl font-semibold">{t("pay.record")}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block"><span className="mb-1 block font-medium">{t("pay.amount")}</span><input className="field num" name="amount" inputMode="decimal" required /></label>
            <label className="block"><span className="mb-1 block font-medium">{t("pay.date")}</span><input className="field" type="date" name="date" max={today} defaultValue={today} required /></label>
            <label className="block"><span className="mb-1 block font-medium">{t("pay.method")}</span><select className="field" name="method">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`pay.method.${m}` as MessageKey)}</option>)}</select></label>
          </div>
          <label className="block"><span className="mb-1 block font-medium">{t("pay.ref")} ({t("common.optional")})</span><input className="field" name="ref" /></label>
          <label className="block"><span className="mb-1 block font-medium">{t("pay.notes")} ({t("common.optional")})</span><input className="field" name="notes" /></label>
          <p className="text-sm text-ink-soft">{t("pay.help")}</p>
          <button className="btn">{t("pay.record")}</button>
        </form>
      )}

      {(rules ?? []).length > 0 && ["active", "overdue"].includes(o.status) && (
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">{t("loan.docsTitle")}</h2>
          <ul className="divide-y divide-line border-y border-line bg-card">
            {(rules ?? []).map((r) => { const miss = missingSet.has(r.category as string); return (
              <li key={r.category as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>{t(`doc.cat.${r.category}` as MessageKey)}</span>
                {miss ? <span className="flex items-center gap-3"><Pill label={t("loan.docMissing")} kind="rejected" />
                  <Link className="btn-quiet inline-flex items-center" href={`/customers/${o.customer_id}#documents`}>{t("loan.docUpload")}</Link></span> : <Pill label={t("loan.docOk")} kind="verified" />}
              </li>); })}
          </ul>
        </section>)}

      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">{t("task.list")}</h2>
        <div className="mb-4"><TaskList tasks={(tasks ?? []) as TaskRow[]} returnTo={`/loans/${id}`} staff={staff} /></div>
        <details className="border border-line bg-card p-4"><summary className="cursor-pointer font-semibold">{t("task.add")}</summary>
          <div className="mt-4"><TaskForm returnTo={`/loans/${id}`} customerId={o.customer_id} loanId={id} staff={staff} /></div></details>
      </section>

      <h2 className="mb-3 text-xl font-semibold">{t("loan.schedule")}</h2>
      <div className="mb-10 overflow-x-auto border border-line bg-card">
        <table className="num w-full min-w-[34rem] text-right">
          <thead className="bg-paper"><tr><th className="p-2 text-left">{t("loan.col.no")}</th><th className="p-2 text-left">{t("loan.col.due")}</th><th className="p-2">{t("loan.col.amount")}</th><th className="p-2">{t("loan.col.paid")}</th><th className="p-2">{t("loan.col.balance")}</th><th className="p-2 text-left">{t("loan.col.status")}</th></tr></thead>
          <tbody>{(sched ?? []).map((r) => (
            <tr key={r.schedule_id} className="border-t border-line">
              <td className="p-2 text-left">{r.installment_no}</td><td className="p-2 text-left">{r.due_date}</td><td className="p-2">{inr(r.amount_due)}</td>
              <td className="p-2">{inr(r.paid_total)}</td><td className="p-2 font-semibold">{inr(r.total_outstanding)}</td>
              <td className="p-2 text-left"><Pill label={t(`sched.${r.status}` as MessageKey)} kind={r.status} />{r.status === "overdue" && Number(r.paid_total) > 0 && <span className="ml-1 text-sm text-warn">({t("loan.overdueNote")})</span>}</td>
            </tr>))}</tbody>
        </table>
      </div>

      <h2 className="mb-3 text-xl font-semibold">{t("pay.history")}</h2>
      {payments.length === 0 ? <p className="text-ink-soft">{t("pay.none")}</p> : (
        <ul className="space-y-3">
          {payments.map((p) => (
            <li key={p.id} className="border border-line bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={`num text-xl font-semibold ${p.kind === "reversal" ? "text-bad" : ""}`}>{inr(p.amount)}</span>
                <span className="num text-ink-soft">{p.payment_date} · {t(`pay.method.${p.method}` as MessageKey)}{p.transaction_ref ? ` · ${p.transaction_ref}` : ""}</span>
              </div>
              {p.kind === "reversal" && <p className="text-bad">{t("pay.reversal")}: {p.reversal_reason}</p>}
              {p.notes && <p className="text-ink-soft">{p.notes}</p>}
              {reversed.has(p.id) && <p className="font-semibold text-warn">{t("pay.reversed")}</p>}
              {p.kind === "receipt" && !reversed.has(p.id) && can(profile, "payments.reverse") && (
                <details className="mt-2"><summary className="btn-quiet inline-flex cursor-pointer items-center">{t("pay.reverse")}</summary>
                  <form action={reversePayment} className="mt-3 flex flex-wrap gap-2">
                    <input type="hidden" name="loanId" value={id} /><input type="hidden" name="paymentId" value={p.id} />
                    <input className="field flex-1" name="reason" placeholder={t("pay.reason")} aria-label={t("pay.reason")} required minLength={3} />
                    <button className="btn">{t("pay.reverse")}</button>
                  </form></details>)}
            </li>))}
        </ul>
      )}
    </>
  );
}
