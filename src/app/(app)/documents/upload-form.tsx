"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENT_CATEGORIES, MAX_BYTES, detectMime, sha256Hex } from "@/lib/documents";
import { finalizeUpload, prepareUpload } from "./actions";

export interface UploadLabels {
  category: string; title: string; expiry: string; vehicle: string; loan: string; none: string; takePhoto: string; chooseFile: string; noFile: string; submit: string;
  uploading: string; optional: string; hint: string; duplicate: string; tooBig: string; badType: string; failed: string; saved: string; cats: Record<string, string>; errors: Record<string, string>;
}

/** Phone photos are often 5–10 MB; shrink big images before upload to save mobile data. PDFs are sent as they are. */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
    return out && out.size < file.size ? out : file;
  } catch { return file; }
}

export function UploadForm(props: { customerId: string; labels: UploadLabels; vehicles?: { id: string; label: string }[]; loans?: { id: string; label: string }[];
  documentId?: string; fixedCategory?: string }) {
  const { labels: L } = props;
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || busy) return;
    const fd = new FormData(e.currentTarget);
    setMsg(null); setBusy(true);
    try {
      const blob = await shrink(file);
      if (blob.size > MAX_BYTES) throw new Error(L.tooBig);
      const buf = await blob.arrayBuffer();
      const mime = detectMime(new Uint8Array(buf.slice(0, 16)));
      if (!mime) throw new Error(L.badType);
      const meta = {
        customerId: props.customerId, documentId: props.documentId ?? null, isReplace: !!props.documentId,
        category: props.fixedCategory ?? String(fd.get("category")), title: String(fd.get("title") ?? ""), expiry: String(fd.get("expiry") ?? ""),
        vehicleId: String(fd.get("vehicleId") ?? ""), loanId: String(fd.get("loanId") ?? ""), fileName: file.name, mime, size: buf.byteLength, sha256: await sha256Hex(buf),
      };
      const prep = await prepareUpload(meta);
      if (!prep.ok) throw new Error(L.errors[prep.error] ?? L.failed);
      if (prep.duplicate && !window.confirm(L.duplicate.replace("{where}", prep.duplicate))) { setBusy(false); return; }
      const { error } = await createClient().storage.from("documents").upload(prep.path, new Blob([buf], { type: mime }), { contentType: mime, upsert: false });
      if (error) throw new Error(L.failed);
      const done = await finalizeUpload({ ...meta, documentId: prep.documentId, path: prep.path });
      if (!done.ok) throw new Error(L.errors[done.error] ?? L.failed);
      setMsg({ kind: "ok", text: L.saved }); setFile(null); form.current?.reset(); router.refresh();
    } catch (err) {
      setMsg({ kind: "bad", text: err instanceof Error && err.message ? err.message : L.failed });
    } finally { setBusy(false); }
  }

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null);
  const btn = "btn-quiet inline-flex cursor-pointer items-center focus-within:outline focus-within:outline-[3px] focus-within:outline-mark";
  return (
    <form ref={form} onSubmit={onSubmit} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className={btn}>{L.takePhoto}<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} /></label>
        <label className={btn}>{L.chooseFile}<input type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={pick} /></label>
        <span className="text-ink-soft">{file ? file.name : L.noFile}</span>
      </div>
      <p className="text-sm text-ink-soft">{L.hint}</p>
      {!props.fixedCategory && (
        <label className="block"><span className="mb-1 block font-medium">{L.category}</span>
          <select className="field" name="category" defaultValue="rc">{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{L.cats[c]}</option>)}</select></label>)}
      {!props.documentId && <label className="block"><span className="mb-1 block font-medium">{L.title} ({L.optional})</span><input className="field" name="title" /></label>}
      <label className="block"><span className="mb-1 block font-medium">{L.expiry} ({L.optional})</span><input className="field" type="date" name="expiry" /></label>
      {!props.documentId && props.vehicles && props.vehicles.length > 0 && (
        <label className="block"><span className="mb-1 block font-medium">{L.vehicle} ({L.optional})</span>
          <select className="field" name="vehicleId" defaultValue=""><option value="">{L.none}</option>{props.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>)}
      {!props.documentId && props.loans && props.loans.length > 0 && (
        <label className="block"><span className="mb-1 block font-medium">{L.loan} ({L.optional})</span>
          <select className="field" name="loanId" defaultValue=""><option value="">{L.none}</option>{props.loans.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>)}
      {msg && <p role={msg.kind === "ok" ? "status" : "alert"} className={`rounded-md border bg-card p-3 ${msg.kind === "ok" ? "border-ok text-ok" : "border-bad text-bad"}`}>{msg.text}</p>}
      <button className="btn disabled:opacity-50" disabled={!file || busy}>{busy ? L.uploading : L.submit}</button>
    </form>
  );
}
