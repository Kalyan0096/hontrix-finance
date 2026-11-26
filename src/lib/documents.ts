export const DOCUMENT_CATEGORIES = ["rc", "insurance", "kyc", "address_proof", "pan", "loan_application", "loan_agreement", "promissory_note", "hypothecation", "payment_receipt", "other"] as const;
export const REVIEW_STATUSES = ["uploaded", "pending_review", "verified", "rejected", "needs_attention"] as const;
export const MAX_BYTES = 15 * 1024 * 1024;
export type AllowedMime = "application/pdf" | "image/jpeg" | "image/png";

/** Identifies the real file type from its first bytes, ignoring the file name and the browser's claim. */
export function detectMime(b: Uint8Array): AllowedMime | null {
  const at = (...s: number[]) => s.every((v, i) => b[i] === v);
  if (at(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (at(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  return null;
}

const EXT: Record<AllowedMime, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/** Storage-safe file name: no folders, no odd characters, correct extension for the real type. */
export function safeFileName(name: string, mime: AllowedMime): string {
  const base = name.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${base || "document"}.${EXT[mime]}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildStoragePath(financierId: string, customerId: string, documentId: string, uploadId: string, fileName: string): string {
  return `${financierId}/${customerId}/${documentId}/${uploadId}-${fileName}`;
}

/** True only for paths this app would generate for the given tenant/customer/document. */
export function isValidStoragePath(path: string, financierId: string, customerId: string, documentId: string): boolean {
  const prefix = `${financierId}/${customerId}/${documentId}/`;
  return path.startsWith(prefix) && /^[0-9a-f-]{36}-[A-Za-z0-9_-]{1,60}\.(pdf|jpg|png)$/i.test(path.slice(prefix.length));
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}
