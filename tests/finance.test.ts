import { describe, expect, it } from "vitest";
import { addMonths, formatINR, fromPaise, generateSchedule, toPaise } from "../src/lib/finance";

const sum = (xs: string[]) => xs.reduce((a, x) => a + toPaise(x), 0);

describe("money", () => {
  it("round-trips without float error", () => {
    expect(toPaise("0.10") + toPaise("0.20")).toBe(30);
    expect(fromPaise(toPaise("12345.6"))).toBe("12345.60");
    expect(toPaise(19.99)).toBe(1999);
  });
  it("rejects bad input", () => {
    expect(() => toPaise("12.345")).toThrow();
    expect(() => toPaise("abc")).toThrow();
  });
  it("formats Indian grouping", () => {
    expect(formatINR(toPaise("1234567.5"))).toBe("₹12,34,567.50");
    expect(formatINR(toPaise("999"))).toBe("₹999.00");
    expect(formatINR(toPaise("100000"))).toBe("₹1,00,000.00");
  });
});

describe("dates", () => {
  it("clamps month ends and keeps the original day", () => {
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2025-01-31", 2)).toBe("2025-03-31");
    expect(addMonths("2025-11-15", 3)).toBe("2026-02-15");
  });
});

describe("flat-rate schedule", () => {
  const s = generateSchedule({ principal: "300000", annualRatePercent: 12, method: "flat", tenureInstallments: 24, frequency: "monthly", firstDueDate: "2026-01-05" });
  it("matches hand calculation: 3,00,000 @12% flat for 2 years", () => {
    expect(s.totalInterest).toBe("72000.00");
    expect(s.totalPayable).toBe("372000.00");
    expect(s.installmentAmount).toBe("15500.00");
    expect(s.rows).toHaveLength(24);
    expect(s.rows[23]!.dueDate).toBe("2027-12-05");
  });
  it("principal sums exactly to the loan amount even when it does not divide evenly", () => {
    const odd = generateSchedule({ principal: "100000", annualRatePercent: 15, method: "flat", tenureInstallments: 7, frequency: "monthly", firstDueDate: "2026-01-31" });
    expect(sum(odd.rows.map((r) => r.principalDue))).toBe(toPaise("100000"));
    expect(sum(odd.rows.map((r) => r.interestDue))).toBe(toPaise(odd.totalInterest));
    expect(odd.rows[1]!.dueDate).toBe("2026-02-28");
  });
});

describe("reducing-balance schedule", () => {
  it("matches the standard EMI: 1,00,000 @12% for 12 months = 8,884.88", () => {
    const s = generateSchedule({ principal: "100000", annualRatePercent: 12, method: "reducing", tenureInstallments: 12, frequency: "monthly", firstDueDate: "2026-02-01" });
    expect(s.installmentAmount).toBe("8884.88");
    expect(s.rows[0]!.interestDue).toBe("1000.00");
    expect(sum(s.rows.map((r) => r.principalDue))).toBe(toPaise("100000"));
    // balance never goes negative and last instalment is within a few rupees of the EMI
    expect(Math.abs(toPaise(s.rows[11]!.amountDue) - toPaise("8884.88"))).toBeLessThan(500);
  });
  it("supports zero interest and weekly frequency", () => {
    const s = generateSchedule({ principal: "50000", annualRatePercent: 0, method: "reducing", tenureInstallments: 10, frequency: "weekly", firstDueDate: "2026-03-01" });
    expect(s.totalInterest).toBe("0.00");
    expect(s.rows[1]!.dueDate).toBe("2026-03-08");
    expect(sum(s.rows.map((r) => r.principalDue))).toBe(toPaise("50000"));
  });
});

describe("validation", () => {
  it("rejects nonsense", () => {
    const base = { principal: "1000", annualRatePercent: 10, method: "flat" as const, tenureInstallments: 5, frequency: "monthly" as const, firstDueDate: "2026-01-01" };
    expect(() => generateSchedule({ ...base, tenureInstallments: 0 })).toThrow();
    expect(() => generateSchedule({ ...base, principal: "0" })).toThrow();
    expect(() => generateSchedule({ ...base, annualRatePercent: -1 })).toThrow();
    expect(() => generateSchedule({ ...base, firstDueDate: "2026-13-01" })).toThrow();
  });
});

import { dueDates, generateBalanceSchedule, isSunday, toCreateLoanArgs } from "../src/lib/finance";

describe("daily loans", () => {
  it("daily due dates, with and without Sundays", () => {
    expect(isSunday("2026-11-22")).toBe(true);
    expect(dueDates("daily", "2026-11-20", 4)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]);
    expect(dueDates("daily", "2026-11-20", 4, true)).toEqual(["2026-11-20", "2026-11-21", "2026-11-23", "2026-11-24"]);
    expect(dueDates("daily", "2026-11-22", 2, true)).toEqual(["2026-11-23", "2026-11-24"]); // a Sunday start moves to Monday
  });
  it("fixed instalment: ₹50,000 given, ₹600 a day for 100 days", () => {
    const s = generateSchedule({ principal: "50000", annualRatePercent: 0, method: "fixed_installment", installment: "600", tenureInstallments: 100, frequency: "daily", firstDueDate: "2026-12-01" });
    expect(s.rows).toHaveLength(100);
    expect(s.installmentAmount).toBe("600.00");
    expect(s.totalPayable).toBe("60000.00");
    expect(s.totalInterest).toBe("10000.00");
    expect(sum(s.rows.map((r) => r.principalDue))).toBe(toPaise("50000"));
    expect(s.rows.every((r) => r.amountDue === "600.00")).toBe(true);
    expect(s.rows[99]!.dueDate).toBe("2027-03-10");
  });
  it("fixed instalment rejects an instalment too small to repay the loan", () => {
    expect(() => generateSchedule({ principal: "50000", annualRatePercent: 0, method: "fixed_installment", installment: "400", tenureInstallments: 100, frequency: "daily", firstDueDate: "2026-12-01" })).toThrow();
  });
  it("flat interest uses 365 days a year for daily loans", () => {
    const s = generateSchedule({ principal: "36500", annualRatePercent: 10, method: "flat", tenureInstallments: 100, frequency: "daily", firstDueDate: "2026-12-01" });
    expect(s.totalInterest).toBe("1000.00");
  });
  it("create_loan arguments carry skip-Sundays and an implied yearly rate", () => {
    const input = { principal: "50000", annualRatePercent: 0, method: "fixed_installment" as const, installment: "600", tenureInstallments: 100, frequency: "daily" as const, firstDueDate: "2026-12-01", skipSundays: true };
    const a = toCreateLoanArgs(input, generateSchedule(input));
    expect(a.p_terms.skip_sundays).toBe(true);
    expect(a.p_terms.interest_rate_pa).toBeCloseTo(73, 0); // 20% over 100/365 of a year
  });
});

describe("balance carried forward", () => {
  it("equal instalments with the remainder last, no interest added", () => {
    const rows = generateBalanceSchedule({ balance: "1000", installment: "300", firstDueDate: "2026-12-01", frequency: "daily" });
    expect(rows.map((r) => r.amountDue)).toEqual(["300.00", "300.00", "300.00", "100.00"]);
    expect(rows.every((r) => r.interestDue === "0.00")).toBe(true);
    expect(generateBalanceSchedule({ balance: "250", installment: "600", firstDueDate: "2026-12-01", frequency: "daily" }).map((r) => r.amountDue)).toEqual(["250.00"]);
  });
});
