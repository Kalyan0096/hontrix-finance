import { DOCUMENT_CATEGORIES } from "@/lib/documents";
import { messages, type Lang, type MessageKey } from "@/lib/i18n/messages";
import type { UploadLabels } from "./upload-form";

/** Translated strings for the client-side upload form (client components cannot read the server's language cookie). */
export function uploadLabels(lang: Lang, submit: MessageKey): UploadLabels {
  const m = messages[lang];
  return {
    category: m["doc.category"], title: m["doc.docTitle"], expiry: m["doc.expiry"], vehicle: m["doc.vehicle"], loan: m["doc.loan"], none: m["doc.none2"],
    takePhoto: m["doc.takePhoto"], chooseFile: m["doc.chooseFile"], noFile: m["doc.noFile"], submit: m[submit], uploading: m["doc.uploading"], optional: m["common.optional"],
    hint: m["doc.hint"], duplicate: m["doc.duplicate"], tooBig: m["doc.tooBig"], badType: m["doc.badType"], failed: m["doc.uploadFailed"], saved: m["doc.saved"],
    cats: Object.fromEntries(DOCUMENT_CATEGORIES.map((c) => [c, m[`doc.cat.${c}` as MessageKey]])),
    errors: Object.fromEntries((Object.keys(m) as MessageKey[]).filter((k) => k.startsWith("err.") || k.startsWith("doc.")).map((k) => [k, m[k]])),
  };
}
