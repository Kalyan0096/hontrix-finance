import { parseDate, toPaise, type Frequency, type InterestMethod, type ScheduleInput } from "./finance";

export const METHODS: InterestMethod[] = ["flat", "reducing", "fixed_installment"];
export const FREQUENCIES: Frequency[] = ["monthly", "daily", "weekly", "fortnightly"];
export const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "cheque", "other"] as const;

export interface LoanFormValues {
  principal: string; rate: string; method: string; tenure: string; frequency: string;
  firstDue: string; disbursedOn: string; approvedOn: string; appliedOn: string;
  processingFee: string; otherFees: string; notes: string; installment: string; skipSundays: string;
}
export const LOAN_FIELDS: (keyof LoanFormValues)[] = ["principal", "rate", "method", "tenure", "frequency", "firstDue", "disbursedOn", "approvedOn", "appliedOn", "processingFee", "otherFees", "notes", "installment", "skipSundays"];

export const readLoanValues = (get: (k: string) => string | undefined | null): LoanFormValues =>
  Object.fromEntries(LOAN_FIELDS.map((k) => [k, String(get(k) ?? "").trim()])) as unknown as LoanFormValues;

const validDate = (s: string) => { try { parseDate(s); return true; } catch { return false; } };
const money = /^\d{1,10}(\.\d{1,2})?$/;

export function validateLoan(v: LoanFormValues, today: string): { error: string | null; input?: ScheduleInput } {
  if (!money.test(v.principal) || toPaise(v.principal) <= 0 || toPaise(v.principal) > 10_000_000_000) return { error: "err.principal" };
  if (!/^\d{1,3}$/.test(v.tenure) || Number(v.tenure) < 1 || Number(v.tenure) > 400) return { error: "err.tenure" };
  if (!METHODS.includes(v.method as InterestMethod) || !FREQUENCIES.includes(v.frequency as Frequency)) return { error: "err.generic" };
  const fixed = v.method === "fixed_installment";
  if (fixed) {
    if (!money.test(v.installment) || toPaise(v.installment) <= 0) return { error: "err.installment" };
    if (toPaise(v.installment) * Number(v.tenure) < toPaise(v.principal)) return { error: "err.installmentLow" }; // would not even repay the amount given
  } else if (!/^\d{1,2}(\.\d{1,4})?$/.test(v.rate) || Number(v.rate) > 60) return { error: "err.rate" };
  if (!validDate(v.firstDue) || !validDate(v.disbursedOn)) return { error: "err.date" };
  for (const d of [v.approvedOn, v.appliedOn]) if (d && !validDate(d)) return { error: "err.date" };
  if (v.disbursedOn > today) return { error: "err.futureDate" };
  if (v.firstDue <= v.disbursedOn) return { error: "err.firstDue" };
  for (const f of [v.processingFee, v.otherFees]) if (f && !money.test(f)) return { error: "err.fee" };
  return { error: null, input: { principal: v.principal, annualRatePercent: fixed ? 0 : Number(v.rate), method: v.method as InterestMethod, tenureInstallments: Number(v.tenure),
    frequency: v.frequency as Frequency, firstDueDate: v.firstDue, installment: fixed ? v.installment : undefined, skipSundays: v.frequency === "daily" && v.skipSundays === "on" } };
}

export function validatePayment(amount: string, date: string, method: string, today: string): string | null {
  if (!money.test(amount) || toPaise(amount) <= 0) return "err.amount";
  if (!validDate(date)) return "err.date";
  if (date > today) return "err.futureDate";
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) return "err.generic";
  return null;
}

export type DisplayStatus = string;
/** Stored status only changes when the daily job runs; show overdue as soon as money is past due. */
export const displayStatus = (status: string, overdueAmount: number): DisplayStatus => (status === "active" && overdueAmount > 0 ? "overdue" : status);

/** Maps database error text to a translation key. */
export function mapDbError(e: { code?: string; message?: string }): string {
  const m = e.message ?? "";
  if (/exceeds total receivable/.test(m)) return "err.overpay";
  if (/does not accept payments/.test(m)) return "err.loanClosed";
  if (/already reversed/.test(m)) return "err.alreadyReversed";
  if (/permission denied|row-level security/.test(m) || e.code === "42501") return "err.noPerm";
  if (/future/.test(m)) return "err.futureDate";
  if (/schedule principal|vehicle does not belong/.test(m)) return "err.generic";
  return "err.generic";
}
