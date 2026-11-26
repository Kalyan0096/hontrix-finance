import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { normalizeRegistration, sanitizeSearch } from "@/lib/records";

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const profile = await requireProfile();
  const { t } = await getT();
  const q = sanitizeSearch((await searchParams).q ?? "");
  const supabase = await createClient();

  let query = supabase.from("customers").select("id, customer_no, full_name, mobile, district, status").order("full_name").limit(51);
  if (q) {
    const filters = [`full_name.ilike."%${q}%"`, `customer_no.ilike."%${q}%"`, `mobile.like."%${q.replace(/\D/g, "") || "~"}%"`];
    const reg = normalizeRegistration(q);
    if (reg.length >= 3) {
      const { data: vs } = await supabase.from("vehicles").select("customer_id").ilike("registration_number", `%${reg}%`).limit(50);
      const ids = [...new Set((vs ?? []).map((v) => v.customer_id))];
      if (ids.length) filters.push(`id.in.(${ids.join(",")})`);
    }
    query = query.or(filters.join(","));
  }
  const { data } = await query;
  const rows = data ?? [];
  const shown = rows.slice(0, 50);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("cust.title")}</h1>
        {can(profile, "customers.write") && <Link href="/customers/new" className="btn inline-flex items-center">{t("cust.add")}</Link>}
      </div>
      <form className="mb-6 flex gap-2" role="search">
        <input className="field" name="q" defaultValue={q} placeholder={t("cust.searchHint")} aria-label={t("cust.searchHint")} />
        <button className="btn">{t("common.search")}</button>
      </form>
      {shown.length === 0 ? <p className="text-ink-soft">{q ? t("cust.noMatch") : t("cust.none")}</p> : (
        <ul className="divide-y divide-line border-y border-line bg-card">
          {shown.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 hover:bg-paper">
                <span><span className="block text-lg font-semibold">{c.full_name}</span>
                  <span className="text-ink-soft">{c.customer_no}{c.district ? ` · ${c.district}` : ""}</span></span>
                <span className="text-right"><span className="num block text-lg">{c.mobile}</span>
                  {c.status !== "active" && <span className="text-sm text-warn">{t(`cust.status.${c.status}` as MessageKey)}</span>}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 50 && <p className="mt-3 text-sm text-ink-soft">{t("common.limit")}</p>}
    </>
  );
}
