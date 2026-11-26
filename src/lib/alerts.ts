export interface AlertRow {
  kind: string; severity: string; customer_id: string | null; customer_name: string | null; loan_id: string | null; loan_no: string | null; vehicle_id: string | null;
  registration_number: string | null; document_id: string | null; task_id: string | null; due_date: string | null; amount: number | null; count_value: number | null; label: string | null;
}
export const ALERT_KINDS = ["overdue_loan", "follow_up", "upcoming_installment", "insurance_expired", "insurance_expiring", "missing_documents", "document_expired", "document_expiring", "documents_to_verify"] as const;
const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export const fillTemplate = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "—");

/** Where clicking an alert should go. */
export function alertHref(a: AlertRow): string {
  if (a.kind === "documents_to_verify") return "/documents?f=toVerify";
  if (a.kind.startsWith("document_") && a.document_id) return `/documents/${a.document_id}`;
  if (a.loan_id) return `/loans/${a.loan_id}`;
  if (a.customer_id) return `/customers/${a.customer_id}`;
  return "/alerts";
}

export function alertVars(a: AlertRow, h: { money: (n: number) => string; category: (c: string) => string }): Record<string, string> {
  return { customer: a.customer_name ?? "—", loan: a.loan_no ?? "—", vehicle: a.registration_number ?? "—", date: a.due_date ?? "—", amount: a.amount === null ? "—" : h.money(Number(a.amount)),
    count: String(a.count_value ?? 0), label: a.kind.startsWith("document_") && a.label ? h.category(a.label) : (a.label ?? "—") };
}

/** Groups alerts by kind (in a fixed order); inside each group the most urgent and oldest come first. */
export function groupAlerts(rows: AlertRow[]): { kind: string; items: AlertRow[] }[] {
  return ALERT_KINDS.map((kind) => ({ kind, items: rows.filter((r) => r.kind === kind).sort((a, b) => (RANK[a.severity]! - RANK[b.severity]!) || String(a.due_date ?? "").localeCompare(String(b.due_date ?? ""))) }))
    .filter((g) => g.items.length > 0);
}
