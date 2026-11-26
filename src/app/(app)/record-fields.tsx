import type { MessageKey } from "@/lib/i18n/messages";
import { CUSTOMER_STATUSES, VEHICLE_CATEGORIES } from "@/lib/records";

type T = (k: MessageKey) => string;
export type CustomerRow = { id: string; customer_no: string; full_name: string; mobile: string; address: string | null; district: string | null; state: string | null; status: string };
export type VehicleRow = { id: string; customer_id: string; registration_number: string; make: string | null; model: string | null; manufacture_year: number | null; category: string;
  chassis_number: string | null; engine_number: string | null; registered_owner: string | null; insurance_expiry: string | null; hypothecation_details: string | null };

const L = ({ label, children }: { label: string; children: React.ReactNode }) => (<label className="block"><span className="mb-1 block font-medium">{label}</span>{children}</label>);

export function CustomerFields({ t, c }: { t: T; c?: CustomerRow }) {
  return (
    <div className="space-y-4">
      <L label={t("cust.name")}><input className="field" name="fullName" defaultValue={c?.full_name} required /></L>
      <L label={t("cust.mobile")}><input className="field" name="mobile" inputMode="numeric" defaultValue={c?.mobile} required /></L>
      <L label={`${t("cust.address")} (${t("common.optional")})`}><textarea className="field" name="address" rows={2} defaultValue={c?.address ?? ""} /></L>
      <div className="grid gap-4 sm:grid-cols-2">
        <L label={t("cust.district")}><input className="field" name="district" defaultValue={c?.district ?? "Kadapa"} /></L>
        <L label={t("cust.state")}><input className="field" name="state" defaultValue={c?.state ?? "Andhra Pradesh"} /></L>
      </div>
      {c && <L label={t("cust.status")}><select className="field" name="status" defaultValue={c.status}>
        {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{t(`cust.status.${s}` as MessageKey)}</option>)}</select></L>}
    </div>
  );
}

export function VehicleFields({ t, v, showChassis = true }: { t: T; v?: VehicleRow; showChassis?: boolean }) {
  return (
    <div className="space-y-4">
      <L label={t("veh.reg")}><input className="field uppercase" name="registration" defaultValue={v?.registration_number} required /></L>
      <div className="grid gap-4 sm:grid-cols-2">
        <L label={t("veh.make")}><input className="field" name="make" defaultValue={v?.make ?? ""} /></L>
        <L label={t("veh.model")}><input className="field" name="model" defaultValue={v?.model ?? ""} /></L>
        <L label={t("veh.year")}><input className="field" name="year" inputMode="numeric" maxLength={4} defaultValue={v?.manufacture_year ?? ""} /></L>
        <L label={t("veh.category")}><select className="field" name="category" defaultValue={v?.category ?? "car"}>
          {VEHICLE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`veh.cat.${c}` as MessageKey)}</option>)}</select></L>
        {showChassis && <L label={t("veh.chassis")}><input className="field" name="chassis" defaultValue={v?.chassis_number ?? ""} /></L>}
        {showChassis && <L label={t("veh.engine")}><input className="field" name="engine" defaultValue={v?.engine_number ?? ""} /></L>}
        <L label={t("veh.owner")}><input className="field" name="owner" defaultValue={v?.registered_owner ?? ""} /></L>
        <L label={t("veh.insExpiry")}><input className="field" name="insuranceExpiry" type="date" defaultValue={v?.insurance_expiry ?? ""} /></L>
      </div>
      <L label={t("veh.hypo")}><textarea className="field" name="hypothecation" rows={2} defaultValue={v?.hypothecation_details ?? ""} /></L>
    </div>
  );
}

export function InsuranceBadge({ t, date, days }: { t: T; date: string | null; days: number | null }) {
  if (!date || days === null) return <span className="text-ink-soft">{t("veh.insUnknown")}</span>;
  if (days < 0) return <span className="font-semibold text-bad">{t("veh.insExpired")} ({date})</span>;
  if (days <= 30) return <span className="font-semibold text-warn">{t("veh.insSoon").replace("{n}", String(days))}</span>;
  return <span className="text-ok">{t("veh.insOk")} ({date})</span>;
}
