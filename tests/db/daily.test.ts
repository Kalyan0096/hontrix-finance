import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb, ids, iso, seedTenants } from "./helpers";
import { generateBalanceSchedule, generateSchedule, toCreateLoanArgs } from "../../src/lib/finance";

let db: PGlite, cust: string, veh: string, daily: string;
const one = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!;
const all = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const num = (v: unknown) => Number(v);

beforeAll(async () => {
  db = await freshDb();
  await seedTenants(db);
  // ₹5,000 given, ₹600 a day for 10 days (Sundays skipped), first instalment 2 days ago
  const input = { principal: "5000", annualRatePercent: 0, method: "fixed_installment" as const, installment: "600", tenureInstallments: 10, frequency: "daily" as const, firstDueDate: iso(-2), skipSundays: true };
  const a = toCreateLoanArgs(input, generateSchedule(input));
  await asUser(db, ids.clerkA, async () => {
    cust = (await one("insert into customers (full_name, mobile) values ('Ravi Kumar','9876543210') returning id")).id;
    veh = (await one("insert into vehicles (customer_id, registration_number) values ($1,'AP04XX1234') returning id", [cust])).id;
    daily = (await one("select create_loan($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) as id", [cust, veh, a.p_principal, iso(-3), iso(-3), iso(-3), JSON.stringify(a.p_terms), JSON.stringify(a.p_schedule)])).id;
    await db.query("select record_payment($1, 600, $2, 'cash')", [daily, iso(-1)]);
  });
});

describe("daily loans", () => {
  it("stores the daily frequency, fixed instalment method and the no-Sundays rule", async () => {
    const t = await one("select frequency, interest_method, skip_sundays, tenure_installments, installment_amount from loan_terms where loan_id = $1", [daily]);
    expect(t).toMatchObject({ frequency: "daily", interest_method: "fixed_installment", skip_sundays: true, tenure_installments: 10 });
    expect(num(t.installment_amount)).toBe(600);
    expect(num((await one("select count(*) as n from repayment_schedules where loan_id = $1 and extract(dow from due_date) = 0", [daily])).n)).toBe(0);
  });
});

describe("collection sheet", () => {
  it("shows opening balance, arrears, collected and closing balance for the day", async () => {
    await asUser(db, ids.ownerA, async () => {
      const r = await one("select * from collection_sheet($1) where loan_id = $2", [iso(0), daily]);
      expect(num(r.opening_balance)).toBe(5400);   // 6,000 repayable − 600 paid yesterday
      expect(num(r.installment_amount)).toBe(600);
      expect(num(r.collected)).toBe(0);
      expect(num(r.closing_balance)).toBe(5400);
      expect(r.customer_name).toBe("Ravi Kumar");
      expect(r.mobile).toBe("9876543210");
    });
  });
  it("opening balance stays fixed for the day while entries are made", async () => {
    await asUser(db, ids.clerkA, async () => { await db.query("select record_payment($1, 600, $2, 'cash', null, 'paid at shop')", [daily, iso(0)]); });
    await asUser(db, ids.ownerA, async () => {
      const r = await one("select * from collection_sheet($1) where loan_id = $2", [iso(0), daily]);
      expect(num(r.opening_balance)).toBe(5400);
      expect(num(r.collected)).toBe(600);
      expect(num(r.closing_balance)).toBe(4800);
      expect(r.remarks).toBe("paid at shop");
      const y = await one("select * from collection_sheet($1) where loan_id = $2", [iso(-1), daily]); // yesterday: nothing was paid before it
      expect(num(y.opening_balance)).toBe(6000);
      expect(num(y.collected)).toBe(600);
      expect(num(y.closing_balance)).toBe(5400);
    });
  });
  it("a reversal is netted out of the day's collection", async () => {
    await asUser(db, ids.ownerA, async () => {
      const p = await one("select id from payments where loan_id = $1 and payment_date = $2 and kind = 'receipt'", [daily, iso(0)]);
      await db.query("select reverse_payment($1, 'entered twice')", [p.id]);
      const r = await one("select * from collection_sheet($1) where loan_id = $2", [iso(0), daily]);
      expect(num(r.collected)).toBe(0);
      expect(num(r.closing_balance)).toBe(5400);
    });
    await asUser(db, ids.clerkA, async () => { await db.query("select record_payment($1, 600, $2, 'cash')", [daily, iso(0)]); }); // restore for later tests
  });
  it("does not list loans with nothing due that day, and is private to the business", async () => {
    await asUser(db, ids.ownerA, async () => {
      expect((await all("select 1 from collection_sheet($1) where loan_id = $2", [iso(-6), daily]))).toHaveLength(0); // before the loan existed
    });
    await asUser(db, ids.ownerB, async () => { expect(await all("select * from collection_sheet($1)", [iso(0)])).toHaveLength(0); });
    await db.exec("set role anon");
    try { await expect(db.query("select * from collection_sheet($1)", [iso(0)])).rejects.toThrow(/permission denied/); } finally { await db.exec("reset role"); }
  });
});

describe("import of balances", () => {
  const rows = [
    { line: 2, name: "Sita Devi", mobile: "9000000001", loan_ref: "D-101", daily_due: "300", balance: "1000" },
    { line: 3, name: "Sita Devi", mobile: "9000000001", loan_ref: "D-102", daily_due: "100", balance: "250.50" },
    { line: 4, name: "Bad Phone", mobile: "12345", loan_ref: "D-103", daily_due: "100", balance: "500" },
    { line: 5, name: "Gopal", mobile: "9000000002", loan_ref: "D-104", daily_due: "50", balance: "400" },
  ];
  let result: any;
  it("only the owner can import", async () => {
    await asUser(db, ids.clerkA, async () => { await expect(db.query("select import_legacy_loans($1::jsonb,$2,$3,'daily',true)", [JSON.stringify(rows), iso(-1), iso(0)])).rejects.toThrow(/only the owner/); });
  });
  it("creates customers, placeholder vehicles and loans; one bad row does not stop the rest", async () => {
    await asUser(db, ids.ownerA, async () => {
      result = (await one("select import_legacy_loans($1::jsonb,$2,$3,'daily',true) as r", [JSON.stringify(rows), iso(-1), iso(1)])).r;
      expect(result.created).toBe(3);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].line).toBe(4);
      const loans = await all("select l.external_ref, l.principal_amount, l.source, v.registration_number from loans l join vehicles v on v.id = l.vehicle_id where l.source = 'imported' order by l.external_ref");
      expect(loans.map((l) => l.external_ref)).toEqual(["D-101", "D-102", "D-104"]);
      expect(loans.map((l) => l.registration_number)).toEqual(["PENDING-D101", "PENDING-D102", "PENDING-D104"]);
      expect(loans.map((l) => num(l.principal_amount))).toEqual([1000, 250.5, 400]);
      // same name + mobile → one customer for two loans; the failed row left no stray customer behind
      expect(num((await one("select count(*) as n from customers where mobile = '9000000001'")).n)).toBe(1);
      expect(num((await one("select count(*) as n from customers where mobile = '12345' or full_name = 'Bad Phone'")).n)).toBe(0);
    });
  });
  it("receivable equals the stated balance and the schedule matches the app's own calculation", async () => {
    await asUser(db, ids.ownerA, async () => {
      const o = await one("select total_receivable, interest_outstanding from v_loan_outstanding where loan_no = (select loan_no from loans where external_ref = 'D-101')");
      expect(num(o.total_receivable)).toBe(1000);
      expect(num(o.interest_outstanding)).toBe(0);
      for (const [ref, bal, due] of [["D-101", "1000", "300"], ["D-102", "250.50", "100"], ["D-104", "400", "50"]] as const) {
        const sql = await all("select s.installment_no, s.due_date::text as d, s.principal_due from repayment_schedules s join loans l on l.id = s.loan_id where l.external_ref = $1 order by 1", [ref]);
        const ts = generateBalanceSchedule({ balance: bal, installment: due, firstDueDate: iso(1), frequency: "daily", skipSundays: true });
        expect(sql.map((r) => [r.installment_no, r.d, num(r.principal_due)])).toEqual(ts.map((r) => [r.installmentNo, r.dueDate, Number(r.principalDue)]));
      }
    });
  });
  it("running the same file again skips what already exists", async () => {
    await asUser(db, ids.ownerA, async () => {
      const again = (await one("select import_legacy_loans($1::jsonb,$2,$3,'daily',true) as r", [JSON.stringify(rows), iso(-1), iso(1)])).r;
      expect(again.created).toBe(0);
      expect(again.skipped).toHaveLength(3);
    });
  });
  it("imported balances are not counted as money given, but are counted as receivable and overdue", async () => {
    await asUser(db, ids.ownerA, async () => {
      const d = await one("select loans_disbursed, amount_disbursed, principal_outstanding from v_dashboard_summary");
      expect(num(d.loans_disbursed)).toBe(1);        // only the loan created through the app
      expect(num(d.amount_disbursed)).toBe(5000);
      expect(num(d.principal_outstanding)).toBeGreaterThan(5000); // includes the imported balances
      const m = await all("select disbursed_count, disbursed_amount from report_monthly(1)");
      expect(num(m[0].disbursed_amount)).toBe(5000);
    });
  });
  it("is audited per loan without writing thousands of schedule rows", async () => {
    expect(num((await one("select count(*) as n from audit_logs where action = 'IMPORT'")).n)).toBe(3);
    expect(num((await one("select count(*) as n from audit_logs a join loans l on l.id = a.record_id where a.table_name = 'repayment_schedules' and l.source = 'imported'")).n)).toBe(0);
    expect(num((await one("select count(*) as n from audit_logs where table_name = 'repayment_schedules' and action = 'INSERT'")).n)).toBe(10); // the app-created loan's 10 rows
  });
  it("tenant B cannot import into or see tenant A's imported loans", async () => {
    await asUser(db, ids.ownerB, async () => { expect(await all("select * from loans")).toHaveLength(0); });
  });
});
