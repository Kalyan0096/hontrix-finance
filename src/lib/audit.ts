export interface AuditRow { id: number; created_at: string; actor_id: string | null; action: string; table_name: string; record_id: string | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null }

export const AUDIT_TABLES = ["customers", "vehicles", "loans", "loan_terms", "repayment_schedules", "payments", "payment_allocations", "documents", "document_versions", "profiles", "business_settings", "follow_up_tasks", "required_document_rules"] as const;
export const AUDIT_ACTIONS = ["INSERT", "UPDATE", "DELETE", "IMPORT", "EXPORT"] as const;

const SKIP = new Set(["updated_at", "created_at", "created_by", "financier_id", "id"]);
const short = (v: unknown) => { const s = v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v); return s.length > 48 ? `${s.slice(0, 45)}…` : s; };

/** One readable line per audit entry, e.g. "status: active → overdue" or "AP04XX1234". Never shows whole rows. */
export function summarizeAudit(r: Pick<AuditRow, "action" | "table_name" | "old_data" | "new_data">): string {
  const n = r.new_data ?? {}, o = r.old_data ?? {};
  if (r.action === "EXPORT") return String((n as { kind?: string }).kind ?? r.table_name.replace("export:", ""));
  if (r.action === "IMPORT") return `${short((n as { external_ref?: unknown }).external_ref)} · ${short((n as { balance?: unknown }).balance)}`;
  if (r.action === "UPDATE") {
    const changed = Object.keys(n).filter((k) => !SKIP.has(k) && JSON.stringify(n[k]) !== JSON.stringify(o[k])).slice(0, 4);
    return changed.length ? changed.map((k) => `${k}: ${short(o[k])} → ${short(n[k])}`).join("; ") : "—";
  }
  const d = r.action === "DELETE" ? o : n;
  const label = (d as Record<string, unknown>);
  switch (r.table_name) {
    case "customers": return short(label.full_name);
    case "vehicles": return short(label.registration_number);
    case "loans": return `${short(label.loan_no)} · ${short(label.principal_amount)}`;
    case "payments": return `${short(label.kind)} ${short(label.amount)} (${short(label.payment_date)})`;
    case "documents": return `${short(label.category)}${label.title ? ` · ${short(label.title)}` : ""}`;
    case "document_versions": return `v${short(label.version_no)} · ${short(label.file_name)}`;
    case "profiles": return `${short(label.full_name)} (${short(label.role)})`;
    case "follow_up_tasks": return short(label.title);
    case "required_document_rules": return short(label.category);
    case "loan_terms": return `${short(label.interest_method)} · ${short(label.frequency)} · ${short(label.tenure_installments)}`;
    default: return "—";
  }
}
