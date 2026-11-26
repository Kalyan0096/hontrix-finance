import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { generateSchedule, todayIST, formatINR, toPaise } from "@/lib/finance";
import { FREQUENCIES, LOAN_FIELDS, METHODS, readLoanValues, validateLoan } from "@/lib/loan-form";
import { Banner } from "../../loan-ui";
import { createLoan } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SP = Record<string, string | string[] | undefined>;

export default async function NewLoan({ searchParams }: { searchParams: Promise<SP> }) {
  const profile = await requireProfile();
  if (!can(profile, "loans.write")) redirect("/loans");
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const vehicleId = one("vehicle") ?? "";
  if (!UUID.test(vehicleId)) notFound();
  const { t, lang } = await getT();
  const supabase = await createClient();
  const { data: veh } = await supabase.from("vehicles").select("id, registration_number, customer_id").eq("id", vehicleId).maybeSingle();
  if (!veh) notFound();
  const { data: cust } = await supabase.from("customers").select("full_name").eq("id", veh.customer_id).maybeSingle();

  const today = todayIST();
  const v = readLoanValues(one);
  const hasInput = !!(v.principal || v.rate);
  const check = hasInput ? validateLoan(v, today) : null;
  const schedule = check?.input ? generateSchedule(check.input) : null;
  const err = one("err") ?? check?.error ?? null;
  const val = (k: keyof typeof v, d = "") => v[k] || d;
  const L = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block"><span className="mb-1 block font-medium">{label}</span>{children}</label>;

  return (
    <>
      <Link href={`/customers/${veh.customer_id}`} className="mb-4 inline-block underline">{t("common.back")}</Link>
      <h1 className="text-2xl font-bold">{t("loan.newFor")} {cust?.full_name}</h1>
      <p className="num mb-6 text-ink-soft">{veh.registration_number}</p>
      {err && err in messages[lang] && <Banner kind="bad">{messages[lang][err as MessageKey]}</Banner>}

      <form className="space-y-4 border border-line bg-card p-5">
        <input type="hidden" name="vehicle" value={vehicleId} />
        <L label={t("loan.principal")}><input className="field num" name="principal" inputMode="decimal" defaultValue={val("principal")} required /></L>
        <div className="grid gap-4 sm:grid-cols-2">
          <L label={t("loan.rate")}><input className="field num" name="rate" inputMode="decimal" defaultValue={val("rate")} /></L>
          <L label={t("loan.method")}><select className="field" name="method" defaultValue={val("method", "flat")}>{METHODS.map((m) => <option key={m} value={m}>{t(`loan.method.${m}` as MessageKey)}</option>)}</select></L>
          <L label={t("loan.installmentAmount")}><input className="field num" name="installment" inputMode="decimal" defaultValue={val("installment")} /></L>
          <label className="flex min-h-12 items-center gap-3 self-end"><input type="checkbox" name="skipSundays" value="on" defaultChecked={v.skipSundays === "on"} className="size-5 accent-ink" />{t("loan.skipSundays")}</label>
          <L label={t("loan.tenure")}><input className="field num" name="tenure" inputMode="numeric" defaultValue={val("tenure")} required /></L>
          <L label={t("loan.frequency")}><select className="field" name="frequency" defaultValue={val("frequency", "monthly")}>{FREQUENCIES.map((m) => <option key={m} value={m}>{t(`loan.freq.${m}` as MessageKey)}</option>)}</select></L>
          <L label={t("loan.disbursedOn")}><input className="field" type="date" name="disbursedOn" max={today} defaultValue={val("disbursedOn", today)} required /></L>
          <L label={t("loan.firstDue")}><input className="field" type="date" name="firstDue" defaultValue={val("firstDue")} required /></L>
          <L label={`${t("loan.appliedOn")} (${t("common.optional")})`}><input className="field" type="date" name="appliedOn" defaultValue={val("appliedOn")} /></L>
          <L label={`${t("loan.approvedOn")} (${t("common.optional")})`}><input className="field" type="date" name="approvedOn" defaultValue={val("approvedOn")} /></L>
          <L label={`${t("loan.processingFee")} (${t("common.optional")})`}><input className="field num" name="processingFee" inputMode="decimal" defaultValue={val("processingFee")} /></L>
          <L label={`${t("loan.otherFees")} (${t("common.optional")})`}><input className="field num" name="otherFees" inputMode="decimal" defaultValue={val("otherFees")} /></L>
        </div>
        <L label={`${t("loan.notes")} (${t("common.optional")})`}><textarea className="field" name="notes" rows={2} defaultValue={val("notes")} /></L>
        <p className="text-sm text-ink-soft">{t("loan.rateHelp")}</p>
        <p className="text-sm text-ink-soft">{t("loan.feeNote")}</p>
        <button className="btn">{t("loan.preview")}</button>
      </form>

      {schedule && check?.input && (
        <section className="mt-8">
          <h2 className="mb-3 text-xl font-semibold">{t("loan.previewTitle")}</h2>
          <dl className="mb-4 grid gap-px border border-line bg-line sm:grid-cols-3">
            {[[t("loan.instalment"), schedule.installmentAmount], [t("loan.totalInterest"), schedule.totalInterest], [t("loan.totalPayable"), schedule.totalPayable]].map(([k, a]) => (
              <div key={k} className="bg-card p-4"><dt className="text-ink-soft">{k}</dt><dd className="num text-2xl font-bold">{formatINR(toPaise(a!))}</dd></div>))}
          </dl>
          <div className="mb-6 max-h-96 overflow-auto border border-line bg-card">
            <table className="num w-full text-right">
              <thead className="sticky top-0 bg-paper"><tr><th className="p-2 text-left">{t("loan.col.no")}</th><th className="p-2 text-left">{t("loan.col.due")}</th><th className="p-2">{t("loan.col.amount")}</th></tr></thead>
              <tbody>{schedule.rows.map((r) => (<tr key={r.installmentNo} className="border-t border-line"><td className="p-2 text-left">{r.installmentNo}</td><td className="p-2 text-left">{r.dueDate}</td><td className="p-2">{formatINR(toPaise(r.amountDue))}</td></tr>))}</tbody>
            </table>
          </div>
          <form action={createLoan}>
            <input type="hidden" name="vehicleId" value={vehicleId} />
            {LOAN_FIELDS.map((k) => <input key={k} type="hidden" name={k} value={v[k]} />)}
            <button className="btn">{t("loan.confirm")}</button>
          </form>
        </section>
      )}
    </>
  );
}
