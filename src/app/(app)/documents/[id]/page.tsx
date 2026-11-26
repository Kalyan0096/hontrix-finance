import { notFound } from "next/navigation";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLang, getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { UUID_RE } from "@/lib/documents";
import { Banner, Pill } from "../../loan-ui";
import { setDocumentStatus, updateDocumentMeta } from "../actions";
import { UploadForm } from "../upload-form";
import { uploadLabels } from "../labels";

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const profile = await requireProfile();
  const { t } = await getT();
  const lang = await getLang();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: d } = await supabase.from("v_documents").select("*").eq("id", id).maybeSingle();
  if (!d) notFound();
  const [{ data: cust }, { data: veh }, { data: versions }] = await Promise.all([
    supabase.from("customers").select("id, full_name").eq("id", d.customer_id).maybeSingle(),
    d.vehicle_id ? supabase.from("vehicles").select("registration_number").eq("id", d.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("document_versions").select("id, version_no, file_name, mime_type, size_bytes, uploaded_at").eq("document_id", id).order("version_no", { ascending: false }),
  ]);
  const canUpload = can(profile, "documents.upload"), canVerify = can(profile, "documents.verify");
  const msg = (k?: string) => (k && k in messages[lang] ? messages[lang][k as MessageKey] : null);
  const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const statusBtn = (status: string, label: string, primary = false) => (
    <form action={setDocumentStatus}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={status} /><button className={primary ? "btn" : "btn-quiet"}>{label}</button></form>);

  return (
    <>
      <Link href={`/customers/${d.customer_id}`} className="mb-4 inline-block underline">{t("common.back")}</Link>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t(`doc.cat.${d.category}` as MessageKey)}{d.title ? ` · ${d.title}` : ""}</h1>
        <Pill label={t(`doc.status.${d.effective_status}` as MessageKey)} kind={d.effective_status} />
      </div>
      <p className="mb-6 text-ink-soft">{cust?.full_name}{veh ? <span className="num"> · {veh.registration_number}</span> : null}{d.expiry_date ? <span className="num"> · {t("doc.expiresOn")}: {d.expiry_date}</span> : null}</p>
      {msg(sp.ok) && <Banner kind="ok">{msg(sp.ok)}</Banner>}
      {msg(sp.err) && <Banner kind="bad">{msg(sp.err)}</Banner>}
      {d.status === "verified" && <p className="mb-4 text-sm text-ink-soft">{t("doc.verifiedNote")}</p>}

      <h2 className="mb-3 text-xl font-semibold">{t("doc.versions")}</h2>
      <ul className="mb-8 divide-y divide-line border-y border-line bg-card">
        {(versions ?? []).map((v, i) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span><span className="font-semibold">{t("doc.version")} {v.version_no}</span>{i === 0 && <span className="ml-2 text-sm text-ok">{t("doc.current")}</span>}
              <span className="num block text-sm text-ink-soft">{v.file_name} · {kb(Number(v.size_bytes))} · {String(v.uploaded_at).slice(0, 10)}</span></span>
            <span className="flex gap-2">
              <a className="btn-quiet inline-flex items-center" href={`/documents/file/${v.id}`} target="_blank" rel="noopener noreferrer">{t("doc.view")}</a>
              <a className="btn-quiet inline-flex items-center" href={`/documents/file/${v.id}?download=1`}>{t("doc.download")}</a>
            </span>
          </li>))}
      </ul>

      {canUpload && (
        <section className="mb-8 border border-line bg-card p-5">
          <h2 className="mb-3 text-lg font-semibold">{t("doc.setStatus")}</h2>
          <div className="mb-6 flex flex-wrap gap-2">
            {canVerify && statusBtn("verified", t("doc.markVerified"), true)}
            {canVerify && statusBtn("rejected", t("doc.reject"))}
            {statusBtn("needs_attention", t("doc.needsAttention"))}
            {statusBtn("pending_review", t("doc.pendingReview"))}
          </div>
          <form action={updateDocumentMeta} className="space-y-4">
            <input type="hidden" name="id" value={id} />
            <label className="block"><span className="mb-1 block font-medium">{t("doc.docTitle")}</span><input className="field" name="title" defaultValue={d.title ?? ""} /></label>
            <label className="block"><span className="mb-1 block font-medium">{t("doc.expiry")}</span><input className="field" type="date" name="expiry" defaultValue={d.expiry_date ?? ""} /></label>
            <label className="block"><span className="mb-1 block font-medium">{t("doc.notes")}</span><textarea className="field" name="notes" rows={2} defaultValue={d.notes ?? ""} /></label>
            <button className="btn-quiet">{t("doc.metaSave")}</button>
          </form>
        </section>)}

      {canUpload && (
        <section className="border border-line bg-card p-5">
          <h2 className="mb-3 text-lg font-semibold">{t("doc.replace")}</h2>
          <UploadForm customerId={d.customer_id} documentId={id} fixedCategory={d.category} labels={uploadLabels(lang, "doc.replace")} />
        </section>)}
    </>
  );
}
