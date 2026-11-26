import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { daysUntil } from "@/lib/finance";
import { normalizeRegistration, sanitizeSearch } from "@/lib/records";
import { InsuranceBadge } from "../record-fields";

export default async function Vehicles({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const profile = await requireProfile();
  const { t } = await getT();
  const q = sanitizeSearch((await searchParams).q ?? "");
  const withChassis = can(profile, "vehicles.write"); // chassis/engine numbers are only searchable by staff who manage vehicles
  const supabase = await createClient();
  let query = supabase.from("vehicles").select("id, customer_id, registration_number, make, model, manufacture_year, category, insurance_expiry, customers(full_name)").order("registration_number").limit(51);
  if (q) {
    const reg = normalizeRegistration(q);
    const f = [`registration_number.ilike."%${reg}%"`, `make.ilike."%${q}%"`, `model.ilike."%${q}%"`];
    if (withChassis) f.push(`chassis_number.ilike."%${reg}%"`);
    query = query.or(f.join(","));
  }
  const { data } = await query;
  const rows = (data ?? []) as unknown as { id: string; customer_id: string; registration_number: string; make: string | null; model: string | null; manufacture_year: number | null; category: string; insurance_expiry: string | null; customers: { full_name: string } | null }[];
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{t("veh.title")}</h1>
      <form className="mb-6 flex gap-2" role="search">
        <input className="field" name="q" defaultValue={q} placeholder={withChassis ? t("veh.searchHintChassis") : t("veh.searchHint")} aria-label={t("veh.searchHint")} />
        <button className="btn">{t("common.search")}</button>
      </form>
      {rows.length === 0 ? <p className="text-ink-soft">{q ? t("veh.noMatch") : t("veh.none")}</p> : (
        <ul className="divide-y divide-line border-y border-line bg-card">
          {rows.slice(0, 50).map((v) => (
            <li key={v.id}>
              <Link href={`/customers/${v.customer_id}`} className="block min-h-16 px-4 py-3 hover:bg-paper">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="num text-lg font-semibold">{v.registration_number}</span>
                  <span className="text-ink-soft">{t("veh.owner.of")}: {v.customers?.full_name ?? "—"}</span>
                </span>
                <span className="block">{[v.make, v.model, v.manufacture_year].filter(Boolean).join(" ") || "—"} · {t(`veh.cat.${v.category}` as MessageKey)}</span>
                <span className="block text-sm"><InsuranceBadge t={t} date={v.insurance_expiry} days={v.insurance_expiry ? daysUntil(v.insurance_expiry) : null} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 50 && <p className="mt-3 text-sm text-ink-soft">{t("common.limit")}</p>}
    </>
  );
}
