import type { MessageKey } from "@/lib/i18n/messages";
import { formatINR, toPaise } from "@/lib/finance";

export const inr = (v: unknown) => formatINR(toPaise(Number(v ?? 0)));
const TONE: Record<string, string> = { overdue: "border-bad text-bad", closed: "border-ink-soft text-ink-soft", active: "border-ok text-ok", paid: "border-ok text-ok",
  partially_paid: "border-warn text-warn", due: "border-warn text-warn", upcoming: "border-line text-ink-soft",
  verified: "border-ok text-ok", rejected: "border-bad text-bad", expired: "border-bad text-bad", needs_attention: "border-warn text-warn", uploaded: "border-line text-ink-soft", pending_review: "border-warn text-warn" };

export function Pill({ label, kind }: { label: string; kind: string }) {
  return <span className={`inline-block rounded-full border-2 px-3 py-0.5 text-sm font-semibold ${TONE[kind] ?? "border-line text-ink-soft"}`}>{label}</span>;
}
export const statusLabel = (t: (k: MessageKey) => string, status: string) => t(`loan.status.${status}` as MessageKey);

export function Banner({ kind, children }: { kind: "ok" | "bad"; children: React.ReactNode }) {
  return kind === "ok" ? <p role="status" className="mb-4 rounded-md border border-ok bg-card p-3 text-ok">{children}</p>
    : <p role="alert" className="mb-4 rounded-md border border-bad bg-card p-3 text-bad">{children}</p>;
}
