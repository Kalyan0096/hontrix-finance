import { notFound } from "next/navigation";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { daysUntil } from "@/lib/finance";
import { displayStatus } from "@/lib/loan-form";
import { Pill, inr, statusLabel } from "../../loan-ui";
import { CustomerFields, InsuranceBadge, VehicleFields, type CustomerRow, type VehicleRow } from "../../record-fields";
import { DocumentsSection } from "./documents-section";
import { TaskForm, TaskList, loadStaff, type TaskRow } from "../../tasks-panel";
import { createVehicle, updateCustomer, updateVehicle } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const profile = await requireProfile();
  const { t, lang } = await getT();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: c } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const { data: vs } = await supabase.from("vehicles").select("*").eq("customer_id", id).order("created_at");
  const vehicles = (vs ?? []) as VehicleRow[];
  const canCustomer = can(profile, "customers.write"), canVehicle = can(profile, "vehicles.write"), canLoan = can(profile, "loans.write");
  const { data: loans } = await supabase.from("v_loan_outstanding").select("loan_id, loan_no, status, total_receivable, overdue_amount").eq("customer_id", id).order("loan_no");
  const [staff, { data: tasks }] = await Promise.all([loadStaff(supabase), supabase.from("follow_up_tasks").select("id, title, due_date, customer_id, loan_id, assigned_to").eq("customer_id", id).eq("status", "open").order("due_date")]);
  const msg = (k?: string) => (k && k in messages[lang] ? messages[lang][k as MessageKey] : null);

  return (
    <>
      <Link href="/customers" className="mb-4 inline-block underline">{t("common.back")}</Link>
      <h1 className="text-2xl font-bold">{c.full_name}</h1>
      <p className="mb-6 text-ink-soft">{t("cust.no")} {c.customer_no}</p>
      {msg(sp.ok) && <p role="status" className="mb-4 rounded-md border border-ok bg-card p-3 text-ok">{msg(sp.ok)}</p>}
      {msg(sp.err) && <p role="alert" className="mb-4 rounded-md border border-bad bg-card p-3 text-bad">{msg(sp.err)}</p>}

      {canCustomer ? (
        <form action={updateCustomer} className="mb-10 space-y-5 border border-line bg-card p-5">
          <input type="hidden" name="id" value={c.id} />
          <CustomerFields t={t} c={c as CustomerRow} />
          <button className="btn">{t("common.save")}</button>
        </form>
      ) : (
        <dl className="mb-10 divide-y divide-line border-y border-line bg-card">
          {[[t("cust.mobile"), c.mobile], [t("cust.address"), c.address], [t("cust.district"), c.district], [t("cust.state"), c.state]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-3"><dt className="text-ink-soft">{k}</dt><dd className="num text-right">{v ?? "—"}</dd></div>))}
        </dl>
      )}

      {(loans ?? []).length > 0 && (<>
        <h2 className="mb-3 text-xl font-semibold">{t("loan.loans")}</h2>
        <ul className="mb-10 divide-y divide-line border-y border-line bg-card">
          {(loans ?? []).map((l) => { const st = displayStatus(l.status, Number(l.overdue_amount)); return (
            <li key={l.loan_id}><Link href={`/loans/${l.loan_id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-paper">
              <span className="font-semibold">{l.loan_no}</span><Pill label={statusLabel(t, st)} kind={st} /><span className="num">{inr(l.total_receivable)}</span></Link></li>); })}
        </ul></>)}
      <h2 className="mb-3 text-xl font-semibold">{t("veh.title")}</h2>
      {vehicles.length === 0 && <p className="mb-4 text-ink-soft">{t("veh.none")}</p>}
      <ul className="mb-6 space-y-3">
        {vehicles.map((v) => (
          <li key={v.id} className="border border-line bg-card p-4">
            <p className="num text-lg font-semibold">{v.registration_number}</p>
            <p>{[v.make, v.model, v.manufacture_year].filter(Boolean).join(" ") || "—"} · {t(`veh.cat.${v.category}` as MessageKey)}</p>
            <p className="text-sm"><InsuranceBadge t={t} date={v.insurance_expiry} days={v.insurance_expiry ? daysUntil(v.insurance_expiry) : null} /></p>
            {canLoan && <Link href={`/loans/new?vehicle=${v.id}`} className="btn-quiet mt-3 mr-2 inline-flex items-center">{t("loan.new")}</Link>}
            {canVehicle && (
              <details className="mt-3"><summary className="btn-quiet inline-flex cursor-pointer items-center">{t("veh.edit")}</summary>
                <form action={updateVehicle} className="mt-4 space-y-5">
                  <input type="hidden" name="id" value={v.id} /><input type="hidden" name="customerId" value={id} />
                  <VehicleFields t={t} v={v} /><button className="btn">{t("common.save")}</button>
                </form></details>
            )}
          </li>
        ))}
      </ul>
      {canVehicle && (
        <form action={createVehicle} className="space-y-5 border border-line bg-card p-5">
          <input type="hidden" name="customerId" value={id} />
          <h3 className="text-lg font-semibold">{t("veh.add")}</h3>
          <VehicleFields t={t} /><button className="btn">{t("veh.add")}</button>
        </form>
      )}
      <section className="mt-10">
        <h2 className="mb-3 text-xl font-semibold">{t("task.list")}</h2>
        <div className="mb-4"><TaskList tasks={(tasks ?? []) as TaskRow[]} returnTo={`/customers/${id}`} staff={staff} /></div>
        <details className="border border-line bg-card p-4"><summary className="cursor-pointer font-semibold">{t("task.add")}</summary>
          <div className="mt-4"><TaskForm returnTo={`/customers/${id}`} customerId={id} staff={staff} /></div></details>
      </section>
      <DocumentsSection supabase={supabase} customerId={id} canUpload={can(profile, "documents.upload")}
        vehicles={vehicles.map((v) => ({ id: v.id, label: v.registration_number }))} loans={(loans ?? []).map((l) => ({ id: l.loan_id, label: l.loan_no }))} />
    </>
  );
}
