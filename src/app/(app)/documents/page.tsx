import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { DOCUMENT_CATEGORIES } from "@/lib/documents";
import { sanitizeSearch } from "@/lib/records";
import { Pill } from "../loan-ui";

const FILTERS = ["all", "expiring", "expired", "toVerify"] as const;

export default async function Documents({ searchParams }: { searchParams: Promise<{ q?: string; f?: string; c?: string }> }) {
  await requireProfile();
  const { t } = await getT();
  const sp = await searchParams;
  const q = sanitizeSearch(sp.q ?? "");
  const f = (FILTERS as readonly string[]).includes(sp.f ?? "") ? sp.f! : "all";
  const c = (DOCUMENT_CATEGORIES as readonly string[]).includes(sp.c ?? "") ? sp.c! : "";
  const supabase = await createClient();

  let query = supabase.from("v_documents").select("id, customer_id, category, title, status, effective_status, expiry_date, days_to_expiry, latest_version_no").order("expiry_date", { ascending: true, nullsFirst: false }).limit(51);
  if (c) query = query.eq("category", c);
  if (f === "expired") query = query.eq("effective_status", "expired");
  else if (f === "expiring") query = query.gte("days_to_expiry", 0).lte("days_to_expiry", 30);
  else if (f === "toVerify") query = query.in("status", ["uploaded", "pending_review"]);
  if (q) {
    const { data: cs } = await supabase.from("customers").select("id").ilike("full_name", `%${q}%`).limit(50);
    const ids = (cs ?? []).map((x) => x.id);
    query = query.or([`title.ilike."%${q}%"`, ...(ids.length ? [`customer_id.in.(${ids.join(",")})`] : [])].join(","));
  }
  const { data } = await query;
  const rows = (data ?? []).slice(0, 50);
  const cIds = [...new Set(rows.map((r) => r.customer_id))];
  const { data: cs } = cIds.length ? await supabase.from("customers").select("id, full_name").in("id", cIds) : { data: [] };
  const names = new Map((cs ?? []).map((x) => [x.id, x.full_name]));
  const href = (nf: string, nc = c) => `/documents?f=${nf}${nc ? `&c=${nc}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">{t("doc.title")}</h1>
      <nav className="mb-3 flex flex-wrap gap-2" aria-label="filter">
        {FILTERS.map((x) => <Link key={x} href={href(x)} aria-current={f === x ? "page" : undefined} className={`btn-quiet inline-flex items-center ${f === x ? "!border-ink font-semibold" : ""}`}>{t(`doc.filter.${x}` as MessageKey)}</Link>)}
      </nav>
      <form className="mb-6 flex flex-wrap gap-2" role="search">
        <input type="hidden" name="f" value={f} />
        <select className="field !w-auto" name="c" defaultValue={c} aria-label={t("doc.category")}>
          <option value="">{t("doc.allTypes")}</option>{DOCUMENT_CATEGORIES.map((k) => <option key={k} value={k}>{t(`doc.cat.${k}` as MessageKey)}</option>)}</select>
        <input className="field flex-1" name="q" defaultValue={q} placeholder={t("doc.searchHint")} aria-label={t("doc.searchHint")} />
        <button className="btn">{t("common.search")}</button>
      </form>
      {rows.length === 0 ? <p className="text-ink-soft">{q || f !== "all" || c ? t("doc.noMatch") : t("doc.none")}</p> : (
        <ul className="divide-y divide-line border-y border-line bg-card">
          {rows.map((d) => (
            <li key={d.id}><Link href={`/documents/${d.id}`} className="block min-h-16 px-4 py-3 hover:bg-paper">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-lg font-semibold">{names.get(d.customer_id) ?? "—"}</span>
                <Pill label={t(`doc.status.${d.effective_status}` as MessageKey)} kind={d.effective_status} />
              </span>
              <span className="flex flex-wrap justify-between gap-2 text-ink-soft">
                <span>{t(`doc.cat.${d.category}` as MessageKey)}{d.title ? ` · ${d.title}` : ""}</span>
                {d.expiry_date && <span className={`num ${Number(d.days_to_expiry) < 0 ? "font-semibold text-bad" : Number(d.days_to_expiry) <= 30 ? "font-semibold text-warn" : ""}`}>{t("doc.expiresOn")}: {d.expiry_date}</span>}
              </span></Link></li>
          ))}
        </ul>
      )}
      {(data ?? []).length > 50 && <p className="mt-3 text-sm text-ink-soft">{t("common.limit")}</p>}
    </>
  );
}
