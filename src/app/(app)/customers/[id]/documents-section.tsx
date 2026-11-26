import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLang, getT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { Pill } from "../../loan-ui";
import { UploadForm } from "../../documents/upload-form";
import { uploadLabels } from "../../documents/labels";

export async function DocumentsSection({ supabase, customerId, canUpload, vehicles, loans }: {
  supabase: SupabaseClient; customerId: string; canUpload: boolean; vehicles: { id: string; label: string }[]; loans: { id: string; label: string }[] }) {
  const { t } = await getT();
  const lang = await getLang();
  const { data } = await supabase.from("v_documents").select("id, category, title, effective_status, expiry_date").eq("customer_id", customerId).order("created_at", { ascending: false });
  const docs = data ?? [];
  return (
    <section id="documents" className="mt-10">
      <h2 className="mb-3 text-xl font-semibold">{t("doc.inUse")}</h2>
      {docs.length === 0 ? <p className="mb-4 text-ink-soft">{t("doc.none")}</p> : (
        <ul className="mb-6 divide-y divide-line border-y border-line bg-card">
          {docs.map((d) => (
            <li key={d.id}><Link href={`/documents/${d.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-paper">
              <span>{t(`doc.cat.${d.category}` as MessageKey)}{d.title ? ` · ${d.title}` : ""}{d.expiry_date && <span className="num block text-sm text-ink-soft">{t("doc.expiresOn")}: {d.expiry_date}</span>}</span>
              <Pill label={t(`doc.status.${d.effective_status}` as MessageKey)} kind={d.effective_status} /></Link></li>))}
        </ul>)}
      {canUpload && (
        <div className="border border-line bg-card p-5">
          <h3 className="mb-3 text-lg font-semibold">{t("doc.upload")}</h3>
          <UploadForm customerId={customerId} vehicles={vehicles} loans={loans} labels={uploadLabels(lang, "doc.upload")} />
        </div>)}
    </section>
  );
}
