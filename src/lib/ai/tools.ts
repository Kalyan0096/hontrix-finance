import { parseDate } from "../finance/dates";
import { UUID_RE } from "../documents";

type F =
  | { type: "date" } | { type: "enum"; values: readonly string[] } | { type: "int"; min: number; max: number } | { type: "number"; min: number; max: number }
  | { type: "string"; min: number; max: number } | { type: "uuid" } | { type: "bool" };
type Field = F & { required?: boolean; description: string };
export interface ToolSpec { name: string; description: string; rpc: string; fields: Record<string, Field> }

const RANGE = {
  from: { type: "date", required: true, description: "Start date, inclusive, YYYY-MM-DD" } as Field,
  to: { type: "date", required: true, description: "End date, inclusive, YYYY-MM-DD" } as Field,
};
const LIMIT = (max: number): Field => ({ type: "int", min: 1, max, description: `How many rows to list (1 to ${max})` });
export const DOC_CATEGORIES = ["rc", "insurance", "kyc", "address_proof", "pan", "loan_application", "loan_agreement", "promissory_note", "hypothecation", "payment_receipt", "other"] as const;

/** The only things the assistant can do. Each maps to a fixed, read-only database function; the model never writes SQL. */
export const TOOLS: ToolSpec[] = [
  { name: "business_summary", rpc: "ai_business_summary", fields: { ...RANGE },
    description: "Totals for a date range: number and amount of loans given (new loans only), collections received (net of reversals), plus today's position (customers, active loans, principal and interest outstanding, overdue). Use for 'how many loans did I give in December', 'how much did I collect today' (from=to=today) and 'summary of this month'." },
  { name: "compare_periods", rpc: "ai_compare_periods", fields: { from_a: { ...RANGE.from, description: "Period A start" }, to_a: { ...RANGE.to, description: "Period A end" }, from_b: { ...RANGE.from, description: "Period B start" }, to_b: { ...RANGE.to, description: "Period B end" } },
    description: "Compares two date ranges (loans given and collections) and returns period A minus period B, calculated exactly. Use for 'compare this month with last month'." },
  { name: "collections", rpc: "ai_collections", fields: { ...RANGE, group: { type: "enum", values: ["none", "day", "month"], description: "Break the total down by day or month, or none" } },
    description: "Collections received (net of reversals) in a date range, optionally per day or per month." },
  { name: "loans_given", rpc: "ai_loans_given", fields: { ...RANGE, group: { type: "enum", values: ["none", "month", "vehicle_category"], description: "Break down by month or by vehicle type, or none (lists the largest loans)" }, min_amount: { type: "number", min: 0, max: 1e10, description: "Only loans of at least this many rupees" } },
    description: "Loans given in a date range (new loans, not imported balances): count and amount, by month or vehicle type, optionally above a minimum amount (3 lakh = 300000)." },
  { name: "overdue_loans", rpc: "ai_overdue_loans", fields: { min_installments: { type: "int", min: 1, max: 1000, description: "Only loans with at least this many overdue instalments (more than two = 3)" }, min_amount: { type: "number", min: 0, max: 1e10, description: "Only loans overdue by at least this many rupees" }, limit: LIMIT(50) },
    description: "Loans with money overdue today, largest first, with total count and amount. Use for 'who has not paid', 'how much is overdue', 'top 20 loans by overdue amount', 'customers with more than two overdue instalments'." },
  { name: "outstanding", rpc: "ai_outstanding", fields: { group: { type: "enum", values: ["none", "vehicle_category", "loan_status"], description: "Break down by vehicle type or loan status, or none" } },
    description: "What is still to be received on active loans: principal, interest, fees, total receivable and overdue, optionally by vehicle type or status." },
  { name: "find_customers", rpc: "ai_find_customers", fields: { query: { type: "string", min: 2, max: 60, required: true, description: "Name, customer number, mobile number, vehicle registration, loan number or register number" }, limit: LIMIT(20) },
    description: "Finds customers. Always use this first to get a customer_id when the user names a person or vehicle." },
  { name: "customer_detail", rpc: "ai_customer_detail", fields: { customer_id: { type: "uuid", required: true, description: "customer_id from find_customers or another result" } },
    description: "One customer's vehicles, loans (with outstanding and overdue), documents and open follow-ups." },
  { name: "loan_detail", rpc: "ai_loan_detail", fields: { loan: { type: "string", min: 1, max: 60, required: true, description: "loan_id, loan number (e.g. L00001) or the business's own register number" } },
    description: "One loan: terms, outstanding amounts, instalment status counts, the 10 most recent payments (repayment history) and missing required documents." },
  { name: "find_documents", rpc: "ai_find_documents", fields: { customer_id: { type: "uuid", description: "Only this customer's documents" }, category: { type: "enum", values: DOC_CATEGORIES, description: "Document type" },
      status: { type: "enum", values: ["uploaded", "pending_review", "verified", "rejected", "needs_attention", "expired"], description: "Effective status" }, expiring_within_days: { type: "int", min: 0, max: 365, description: "Expiring within this many days" },
      expired: { type: "bool", description: "Only documents past their expiry date" }, limit: LIMIT(50) },
    description: "Finds documents and the page where each opens. The assistant cannot open files; give the user the link. Use for 'show Ravi's RC', 'which documents have expired', 'agreements awaiting verification' (status pending_review)." },
  { name: "loans_missing_documents", rpc: "ai_loans_missing_documents", fields: { limit: LIMIT(50) },
    description: "Active loan files that lack a required document type, with what is missing." },
  { name: "insurance_expiry", rpc: "ai_insurance_expiry", fields: { within_days: { type: "int", min: 0, max: 365, description: "Insurance ending within this many days (default 30)" }, include_expired: { type: "bool", description: "Also list policies that have already ended (default true)" }, limit: LIMIT(50) },
    description: "Vehicles whose insurance has ended or ends soon, with customer and whether they have an open loan. Use for 'which insurance policies have expired'." },
];

export interface ToolSchema { name: string; description: string; input_schema: { type: "object"; properties: Record<string, unknown>; required: string[] } }

export const toolSchemas = (): ToolSchema[] => TOOLS.map((t) => ({
  name: t.name, description: t.description,
  input_schema: { type: "object", additionalProperties: false, required: Object.entries(t.fields).filter(([, f]) => f.required).map(([k]) => k),
    properties: Object.fromEntries(Object.entries(t.fields).map(([k, f]) => [k, f.type === "enum" ? { type: "string", enum: [...f.values], description: f.description }
      : f.type === "date" ? { type: "string", description: f.description, pattern: "^\\d{4}-\\d{2}-\\d{2}$" } : f.type === "uuid" ? { type: "string", description: f.description }
      : f.type === "bool" ? { type: "boolean", description: f.description } : f.type === "string" ? { type: "string", description: f.description, minLength: f.min, maxLength: f.max }
      : { type: f.type === "int" ? "integer" : "number", description: f.description, minimum: f.min, maximum: f.max }])) } as ToolSchema["input_schema"],
}));

export type Validated = { ok: true; rpc: string; params: Record<string, unknown> } | { ok: false; error: string };

/** Checks what the model asked for. Anything unknown, missing or out of range is refused before it reaches the database. */
export function validateToolCall(name: string, input: unknown): Validated {
  const spec = TOOLS.find((t) => t.name === name);
  if (!spec) return { ok: false, error: `unknown tool: ${name}` };
  const src = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const params: Record<string, unknown> = {};
  for (const [key, f] of Object.entries(spec.fields)) {
    const v = src[key];
    if (v === undefined || v === null) { if (f.required) return { ok: false, error: `${key} is required` }; continue; }
    switch (f.type) {
      case "date": try { if (typeof v !== "string") throw 0; parseDate(v); } catch { return { ok: false, error: `${key} must be a real date as YYYY-MM-DD` }; } break;
      case "enum": if (typeof v !== "string" || !f.values.includes(v)) return { ok: false, error: `${key} must be one of: ${f.values.join(", ")}` }; break;
      case "int": if (typeof v !== "number" || !Number.isInteger(v) || v < f.min || v > f.max) return { ok: false, error: `${key} must be a whole number from ${f.min} to ${f.max}` }; break;
      case "number": if (typeof v !== "number" || !Number.isFinite(v) || v < f.min || v > f.max) return { ok: false, error: `${key} must be a number from ${f.min} to ${f.max}` }; break;
      case "string": if (typeof v !== "string" || v.trim().length < f.min || v.length > f.max) return { ok: false, error: `${key} must be text of ${f.min} to ${f.max} characters` }; break;
      case "uuid": if (typeof v !== "string" || !UUID_RE.test(v)) return { ok: false, error: `${key} must be an id taken from an earlier tool result` }; break;
      case "bool": if (typeof v !== "boolean") return { ok: false, error: `${key} must be true or false` }; break;
    }
    params[`p_${key}`] = typeof v === "string" ? v.trim() : v;
  }
  return { ok: true, rpc: spec.rpc, params };
}

/** Result text for the model: control characters removed and long text shortened, so record text cannot smuggle in formatting or instructions. */
export function cleanForModel(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.replace(/[\u0000-\u001f\u007f`<>]/g, " ").slice(0, 120);
  if (Array.isArray(v)) return depth > 6 ? [] : v.slice(0, 200).map((x) => cleanForModel(x, depth + 1));
  if (v && typeof v === "object") return depth > 6 ? {} : Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, cleanForModel(x, depth + 1)]));
  return v;
}

/** Database messages that are safe and useful to show the model; anything else becomes a generic message. */
export function friendlyDbError(message: string | undefined): string {
  const m = message ?? "";
  return /^(invalid date range|date range too long|group must be|query must be|loan reference must be|customer not found|loan not found)/.test(m) ? m : "The data could not be read for that request.";
}
