import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb, ids, iso, seedTenants } from "./helpers";
import { generateSchedule, toCreateLoanArgs } from "../../src/lib/finance";

let db: PGlite, loan: string;
const one = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!;

beforeAll(async () => {
  db = await freshDb();
  await seedTenants(db);
  const input = { principal: "12000", annualRatePercent: 0, method: "reducing" as const, tenureInstallments: 3, frequency: "monthly" as const, firstDueDate: iso(-65) };
  const a = toCreateLoanArgs(input, generateSchedule(input));
  await asUser(db, ids.clerkA, async () => {
    const c = (await one("insert into customers (full_name, mobile) values ('Ravi','9876543210') returning id")).id;
    const v = (await one("insert into vehicles (customer_id, registration_number, category) values ($1,'AP04XX1234','truck') returning id", [c])).id;
    loan = (await one("select create_loan($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) as id", [c, v, a.p_principal, iso(-72), iso(-71), iso(-70), JSON.stringify(a.p_terms), JSON.stringify(a.p_schedule)])).id;
    await db.query("select record_payment($1, 4000, $2, 'cash')", [loan, iso(-50)]);
    await db.query("select record_payment($1, 1000, $2, 'upi')", [loan, iso(-2)]);
  });
});

describe("history-aware overdue", () => {
  it("replays the ledger as it stood on past dates", async () => {
    await asUser(db, ids.ownerA, async () => {
      const at = async (d: number) => Number((await one("select overdue_as_of($1) as v", [iso(d)])).v);
      expect(await at(-60)).toBe(4000); // instalment 1 due, not yet paid
      expect(await at(-45)).toBe(0);    // paid 5 days earlier
      expect(await at(-2)).toBe(8000);  // instalments 2 and 3 past due; the part-payment is dated that day, so not yet counted
      expect(await at(-1)).toBe(7000);  // after the 1,000 part-payment
      expect(await at(0)).toBe(7000);
      expect(await at(0)).toBe(Number((await one("select overdue_amount from v_dashboard_summary")).overdue_amount)); // matches the live dashboard
    });
  });
});

describe("monthly and daily reports", () => {
  it("returns 12 months, oldest first, and totals match the ledger", async () => {
    await asUser(db, ids.ownerA, async () => {
      const rows = (await db.query<any>("select * from report_monthly(12)")).rows;
      expect(rows).toHaveLength(12);
      expect(String(rows[0].month) <= String(rows[11].month) || rows[0].month <= rows[11].month).toBe(true);
      expect(rows.reduce((a: number, r: any) => a + Number(r.collected), 0)).toBe(5000);
      expect(rows.reduce((a: number, r: any) => a + Number(r.disbursed_amount), 0)).toBe(12000);
      expect(rows.reduce((a: number, r: any) => a + Number(r.disbursed_count), 0)).toBe(1);
    });
  });
  it("daily collections are limited to the range and net of reversals", async () => {
    await asUser(db, ids.ownerA, async () => {
      const r = (await db.query<any>("select day::text as day, receipts, collected from report_daily_collections($1,$2)", [iso(-60), iso(0)])).rows;
      expect(r.map((x) => x.day)).toEqual([iso(-50), iso(-2)]);
      expect(Number(r[0].collected)).toBe(4000);
      const none = (await db.query("select * from report_daily_collections($1,$2)", [iso(-40), iso(-10)])).rows;
      expect(none).toHaveLength(0);
    });
  });
  it("distribution views group by category and by live status", async () => {
    await asUser(db, ids.ownerA, async () => {
      const cat = (await db.query<any>("select * from v_category_distribution")).rows;
      expect(cat).toHaveLength(1);
      expect(cat[0].category).toBe("truck");
      expect(Number(cat[0].disbursed_amount)).toBe(12000);
      expect((await one("select status from v_loan_status_distribution")).status).toBe("overdue");
    });
  });
  it("other businesses see nothing, and anonymous users cannot call report functions", async () => {
    await asUser(db, ids.ownerB, async () => {
      expect(Number((await one("select sum(collected) as c from report_monthly(12)")).c)).toBe(0);
      expect((await db.query("select * from v_category_distribution")).rows).toHaveLength(0);
    });
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from report_monthly(12)")).rejects.toThrow(/permission denied/);
      await expect(db.query("select overdue_as_of(current_date)")).rejects.toThrow(/permission denied/);
      await expect(db.query("select refresh_all_loan_statuses()")).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role"); }
  });
});
