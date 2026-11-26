"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_CATEGORIES, MAX_BYTES, REVIEW_STATUSES, UUID_RE, buildStoragePath, detectMime, isValidStoragePath, safeFileName, type AllowedMime } from "@/lib/documents";
import { parseDate } from "@/lib/finance";
import { mapDbError } from "@/lib/loan-form";

export interface UploadMeta {
  isReplace?: boolean;
  customerId: string; documentId: string | null; category: string; title: string; expiry: string; vehicleId: string; loanId: string;
  fileName: string; mime: string; size: number; sha256: string;
}
type Prepared = { ok: true; documentId: string; path: string; duplicate: string | null } | { ok: false; error: string };
type Done = { ok: true; documentId: string } | { ok: false; error: string };

const MIMES = ["application/pdf", "image/jpeg", "image/png"];
function checkMeta(m: UploadMeta): string | null {
  if (!UUID_RE.test(m.customerId) || (m.documentId && !UUID_RE.test(m.documentId))) return "err.generic";
  if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(m.category)) return "err.generic";
  if (!MIMES.includes(m.mime)) return "doc.badType";
  if (!(m.size > 0 && m.size <= MAX_BYTES)) return "doc.tooBig";
  if (!/^[0-9a-f]{64}$/.test(m.sha256)) return "err.generic";
  if (m.expiry) { try { parseDate(m.expiry); } catch { return "err.date"; } }
  for (const id of [m.vehicleId, m.loanId]) if (id && !UUID_RE.test(id)) return "err.generic";
  return null;
}

/** Step 1: validate, check for an identical file, and hand back the private storage path to upload to. Writes nothing. */
export async function prepareUpload(m: UploadMeta): Promise<Prepared> {
  await requireProfile();
  const bad = checkMeta(m);
  if (bad) return { ok: false, error: bad };
  const supabase = await createClient();
  const { data: c } = await supabase.from("customers").select("id").eq("id", m.customerId).maybeSingle();
  if (!c) return { ok: false, error: "err.generic" };
  const { data: dup } = await supabase.from("document_versions").select("document_id").eq("sha256", m.sha256).limit(1).maybeSingle();
  let duplicate: string | null = null;
  if (dup) {
    const { data: d } = await supabase.from("documents").select("title, category, customer_id").eq("id", dup.document_id).maybeSingle();
    const { data: dc } = d ? await supabase.from("customers").select("full_name").eq("id", d.customer_id).maybeSingle() : { data: null };
    duplicate = [dc?.full_name, d?.title ?? d?.category].filter(Boolean).join(" · ") || "—";
  }
  const { data: me } = await supabase.rpc("auth_financier_id");
  if (!me) return { ok: false, error: "err.noPerm" };
  const documentId = m.documentId ?? crypto.randomUUID();
  const path = buildStoragePath(me as string, m.customerId, documentId, crypto.randomUUID(), safeFileName(m.fileName, m.mime as AllowedMime));
  return { ok: true, documentId, path, duplicate };
}

/** Step 2 (after the browser uploaded the file): confirm the stored bytes really are what was claimed, then register atomically. */
export async function finalizeUpload(m: UploadMeta & { path: string; documentId: string }): Promise<Done> {
  await requireProfile();
  const bad = checkMeta(m);
  if (bad) return { ok: false, error: bad };
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("auth_financier_id");
  if (!me || !isValidStoragePath(m.path, me as string, m.customerId, m.documentId)) return { ok: false, error: "err.docPath" };

  // Read the first bytes of the stored object and compare with what the browser told us.
  const { data: signed } = await supabase.storage.from("documents").createSignedUrl(m.path, 60);
  if (!signed) return { ok: false, error: "err.docPath" };
  const res = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-15" }, cache: "no-store" });
  const head = new Uint8Array(await res.arrayBuffer());
  const total = Number(/\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1] ?? res.headers.get("content-length"));
  if (detectMime(head) !== m.mime || (Number.isFinite(total) && total !== m.size)) return { ok: false, error: "err.docPath" };

  const { error } = await supabase.rpc("register_document_upload", {
    p_document_id: m.documentId, p_is_new: !m.isReplace, p_customer_id: m.customerId, p_vehicle_id: m.vehicleId || null, p_loan_id: m.loanId || null,
    p_category: m.category, p_title: m.title || null, p_expiry: m.expiry || null, p_storage_path: m.path,
    p_file_name: safeFileName(m.fileName, m.mime as AllowedMime), p_mime: m.mime, p_size: m.size, p_sha256: m.sha256,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath(`/customers/${m.customerId}`); revalidatePath("/documents"); revalidatePath(`/documents/${m.documentId}`);
  return { ok: true, documentId: m.documentId };
}

export async function setDocumentStatus(f: FormData) {
  await requireProfile();
  const id = String(f.get("id")), status = String(f.get("status"));
  if (!UUID_RE.test(id) || !(REVIEW_STATUSES as readonly string[]).includes(status)) redirect("/documents");
  const { data, error } = await (await createClient()).from("documents").update({ status }).eq("id", id).select("id");
  if (error || !data?.length) redirect(`/documents/${id}?err=${error ? mapDbError(error) : "err.noPerm"}`);
  revalidatePath(`/documents/${id}`); revalidatePath("/documents");
  redirect(`/documents/${id}?ok=doc.statusSaved`);
}

export async function updateDocumentMeta(f: FormData) {
  await requireProfile();
  const id = String(f.get("id"));
  if (!UUID_RE.test(id)) redirect("/documents");
  const expiry = String(f.get("expiry") ?? "").trim();
  if (expiry) { try { parseDate(expiry); } catch { redirect(`/documents/${id}?err=err.date`); } }
  const { data, error } = await (await createClient()).from("documents")
    .update({ title: String(f.get("title") ?? "").trim() || null, expiry_date: expiry || null, notes: String(f.get("notes") ?? "").trim() || null }).eq("id", id).select("id");
  if (error || !data?.length) redirect(`/documents/${id}?err=${error ? mapDbError(error) : "err.noPerm"}`);
  revalidatePath(`/documents/${id}`);
  redirect(`/documents/${id}?ok=doc.metaSaved`);
}
