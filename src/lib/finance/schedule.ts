import { addDays, addMonths } from "./dates";
import { fromPaise, toPaise } from "./money";

export type InterestMethod = "flat" | "reducing" | "fixed_installment";
export type Frequency = "daily" | "weekly" | "fortnightly" | "monthly";

export interface ScheduleInput {
  /** Principal in rupees, e.g. "300000.00" */
  principal: string | number;
  /** Annual rate in percent. Ignored for fixed_installment (the rate is implied by the instalment). */
  annualRatePercent: number;
  method: InterestMethod;
  tenureInstallments: number;
  frequency: Frequency;
  firstDueDate: string; // YYYY-MM-DD
  /** Required for fixed_installment: the amount collected each time, in rupees. */
  installment?: string | number;
  /** Daily loans only: no instalment falls on a Sunday. */
  skipSundays?: boolean;
}

export interface ScheduleRow { installmentNo: number; dueDate: string; principalDue: string; interestDue: string; feesDue: string; amountDue: string }
export interface Schedule { rows: ScheduleRow[]; installmentAmount: string; totalInterest: string; totalPayable: string }

export const PERIODS_PER_YEAR: Record<Frequency, number> = { daily: 365, weekly: 52, fortnightly: 26, monthly: 12 };

export const isSunday = (iso: string) => { const [y, m, d] = iso.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0; };

/** The n due dates, in order. Daily loans can skip Sundays (a first date that is a Sunday moves to Monday). */
export function dueDates(frequency: Frequency, firstDueDate: string, n: number, skipSundays = false): string[] {
  const out: string[] = [];
  if (frequency === "daily") {
    let d = firstDueDate;
    for (let k = 0; k < n; k++) {
      if (skipSundays && isSunday(d)) d = addDays(d, 1);
      out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }
  for (let k = 0; k < n; k++) out.push(frequency === "monthly" ? addMonths(firstDueDate, k) : addDays(firstDueDate, (frequency === "weekly" ? 7 : 14) * k));
  return out;
}

/**
 * Generates a repayment schedule. All arithmetic is in integer paise; the last instalment absorbs rounding
 * so principal always sums exactly to the loan amount.
 *
 * flat:              total interest = P × rate × (n / periods-per-year), split evenly across instalments.
 * reducing:          standard EMI on the declining balance, periodic rate = rate / periods-per-year.
 * fixed_installment: the financier states the amount collected each time (e.g. ₹600 a day for 100 days).
 *                    Total repayable = instalment × n; interest = that minus the loan amount, spread evenly.
 */
export function generateSchedule(input: ScheduleInput): Schedule {
  const n = input.tenureInstallments;
  if (!Number.isInteger(n) || n < 1 || n > 600) throw new Error("tenureInstallments must be an integer between 1 and 600");
  const P = toPaise(input.principal);
  if (P <= 0) throw new Error("principal must be positive");
  const ppy = PERIODS_PER_YEAR[input.frequency];
  const principals: number[] = [];
  const interests: number[] = [];

  if (input.method === "fixed_installment") {
    const inst = toPaise(input.installment ?? "0");
    if (inst <= 0) throw new Error("installment must be positive");
    if (inst * n < P) throw new Error("installment × number of instalments must cover the loan amount");
    const pEach = Math.round(P / n);
    for (let k = 0; k < n; k++) {
      const p = k === n - 1 ? P - pEach * (n - 1) : pEach;
      principals.push(p);
      interests.push(Math.max(0, inst - p));
    }
  } else {
    if (!(input.annualRatePercent >= 0) || input.annualRatePercent > 100) throw new Error("annualRatePercent must be between 0 and 100");
    if (input.method === "flat") {
      const totalInterest = Math.round((P * input.annualRatePercent * n) / (100 * ppy));
      const pEach = Math.round(P / n);
      const iEach = Math.round(totalInterest / n);
      for (let k = 0; k < n; k++) {
        const last = k === n - 1;
        principals.push(last ? P - pEach * (n - 1) : pEach);
        interests.push(last ? totalInterest - iEach * (n - 1) : iEach);
      }
    } else {
      const i = input.annualRatePercent / 100 / ppy;
      const emi = i === 0 ? Math.round(P / n) : Math.round((P * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1));
      let balance = P;
      for (let k = 0; k < n; k++) {
        const interest = Math.round(balance * i);
        const principal = k === n - 1 ? balance : Math.min(balance, emi - interest);
        principals.push(principal);
        interests.push(interest);
        balance -= principal;
      }
    }
  }

  const dates = dueDates(input.frequency, input.firstDueDate, n, input.skipSundays);
  const rows: ScheduleRow[] = principals.map((p, idx) => ({
    installmentNo: idx + 1, dueDate: dates[idx]!, principalDue: fromPaise(p), interestDue: fromPaise(interests[idx]!), feesDue: "0.00", amountDue: fromPaise(p + interests[idx]!),
  }));
  const totalInterest = interests.reduce((a, b) => a + b, 0);
  return { rows, installmentAmount: fromPaise(principals[0]! + interests[0]!), totalInterest: fromPaise(totalInterest), totalPayable: fromPaise(P + totalInterest) };
}

/**
 * Schedule for a balance carried forward from another system (e.g. an Excel register): the borrower owes `balance`, pays `installment`
 * each time, and the last instalment is whatever remains. No interest is added; the balance already includes it.
 */
export function generateBalanceSchedule(p: { balance: string | number; installment: string | number; firstDueDate: string; frequency: Frequency; skipSundays?: boolean }): ScheduleRow[] {
  const B = toPaise(p.balance), d = toPaise(p.installment);
  if (B <= 0 || d <= 0) throw new Error("balance and installment must be positive");
  const n = Math.ceil(B / d);
  if (n > 3000) throw new Error("too many instalments");
  const dates = dueDates(p.frequency, p.firstDueDate, n, p.skipSundays);
  return dates.map((dueDate, k) => { const amt = k === n - 1 ? B - d * (n - 1) : d; return { installmentNo: k + 1, dueDate, principalDue: fromPaise(amt), interestDue: "0.00", feesDue: "0.00", amountDue: fromPaise(amt) }; });
}

/** Builds the jsonb arguments expected by the create_loan() database function. */
export function toCreateLoanArgs(input: ScheduleInput, s: Schedule, extras: { processingFee?: string; otherFees?: string; notes?: string } = {}) {
  const P = toPaise(input.principal);
  const rate = input.method === "fixed_installment"
    ? Math.min(999.9999, Number(((toPaise(s.totalInterest) / P / (input.tenureInstallments / PERIODS_PER_YEAR[input.frequency])) * 100).toFixed(4)))
    : input.annualRatePercent;
  return {
    p_principal: fromPaise(P),
    p_terms: {
      interest_rate_pa: rate, interest_method: input.method, tenure_installments: input.tenureInstallments, frequency: input.frequency,
      installment_amount: s.installmentAmount, processing_fee: extras.processingFee ?? "0", other_fees: extras.otherFees ?? "0", notes: extras.notes ?? null,
      skip_sundays: !!input.skipSundays && input.frequency === "daily",
    },
    p_schedule: s.rows.map((r) => ({ installment_no: r.installmentNo, due_date: r.dueDate, principal_due: r.principalDue, interest_due: r.interestDue, fees_due: r.feesDue })),
  };
}
