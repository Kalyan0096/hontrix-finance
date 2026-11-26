import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb, ids, iso, seedTenants } from "./helpers";
import { generateSchedule, toCreateLoanArgs } from "../../src/lib/finance";

let db: PGlite;
let custA: string, vehA: string, loanA: string, custB: string;

const one = async <T = any>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

beforeAll(async () => {
  db = await freshDb();
  await seedTenants(db);
  // Tenant A data created through the real app path (clerk), tenant B by owner B
  await asUser(db, ids.clerkA, async () => {
    custA = (await one("insert into customers (full_name, mobile, district, state) values ('Ravi Kumar','9876543210','Kadapa','Andhra Pradesh') returning id")).id;
    vehA = (await one("insert into vehicles (customer_id, registration_number, make, model, manufacture_year, category, insurance_expiry) values ($1,'AP04XX1234','Tata','Ace',2019,'pickup',$2) returning id", [custA, iso(-10)])).id;
  });
  await asUser(db, ids.ownerB, async () => {
    custB = (await one("insert into customers (full_name, mobile) values ('Other Person','9123456780') returning id")).id;
  });
  // Loan: ₹1,20,000 reducing 12% for 6 monthly instalments, first due 3 days ago → instalment 1 is overdue
  const input = { principal: "120000", annualRatePercent: 12, method: "reducing" as const, tenureInstallments: 6, frequency: "monthly" as const, firstDueDate: iso(-3) };
  const s = generateSchedule(input);
  const a = toCreateLoanArgs(input, s);
  await asUser(db, ids.clerkA, async () => {
    loanA = (await one("select create_loan($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) as id",
      [custA, vehA, a.p_principal, iso(-40), iso(-35), iso(-33), JSON.stringify(a.p_terms), JSON.stringify(a.p_schedule)])).id;
  });
});

const outstanding = () => asUser(db, ids.ownerA, () => one("select * from v_loan_outstanding where loan_id = $1", [loanA]));

describe("tenant isolation and roles", () => {
  it("tenant B cannot see tenant A data", async () => {
    await asUser(db, ids.ownerB, async () => {
      expect((await db.query("select * from customers")).rows).toHaveLength(1);
      expect((await db.query("select * from loans")).rows).toHaveLength(0);
      expect((await db.query("select * from vehicles")).rows).toHaveLength(0);
    });
  });
  it("tenant B cannot call money RPCs on tenant A's loan", async () => {
    await asUser(db, ids.ownerB, async () => {
      await expect(db.query("select record_payment($1, 100, $2, 'cash')", [loanA, iso(0)])).rejects.toThrow(/loan not found/);
    });
  });
  it("composite FKs stop cross-tenant links at the database level", async () => {
    await expect(db.query("insert into vehicles (financier_id, customer_id, registration_number) values ($1,$2,'KA01AB0001')", [ids.finA, custB])).rejects.toThrow();
  });
  it("an employee with no permissions can read but not write", async () => {
    await asUser(db, ids.viewerA, async () => {
      expect((await db.query("select * from customers")).rows).toHaveLength(1);
      await expect(db.query("insert into customers (full_name, mobile) values ('X','9000000001')")).rejects.toThrow(/row-level security/);
      await expect(db.query("select record_payment($1, 100, $2, 'cash')", [loanA, iso(0)])).rejects.toThrow(/permission denied/);
    });
  });
  it("payments table cannot be written directly, even by an owner", async () => {
    await asUser(db, ids.ownerA, async () => {
      await expect(db.query("insert into payments (loan_id, amount, payment_date, method) values ($1, 500, $2, 'cash')", [loanA, iso(0)])).rejects.toThrow();
    });
  });
  it("only owners can read the audit log", async () => {
    await asUser(db, ids.clerkA, async () => { expect((await db.query("select * from audit_logs")).rows).toHaveLength(0); });
    await asUser(db, ids.ownerA, async () => { expect((await db.query("select * from audit_logs")).rows.length).toBeGreaterThan(0); });
  });
  it("employee cannot escalate their own permissions", async () => {
    await asUser(db, ids.clerkA, async () => {
      const r = await db.query("update profiles set permissions = '{payments.reverse}' where id = $1 returning id", [ids.clerkA]);
      expect(r.rows).toHaveLength(0);
    });
  });
});

describe("loan creation and ledger", () => {
  it("created a schedule whose principal equals the loan", async () => {
    const o = await outstanding();
    expect(Number(o.principal_outstanding)).toBe(120000);
    expect(Number(o.overdue_installments)).toBe(1);
    expect(o.status).toBe("overdue");
  });
  it("rejects a schedule whose principal does not match", async () => {
    const input = { principal: "50000", annualRatePercent: 10, method: "flat" as const, tenureInstallments: 3, frequency: "monthly" as const, firstDueDate: iso(30) };
    const a = toCreateLoanArgs(input, generateSchedule(input));
    await asUser(db, ids.clerkA, async () => {
      await expect(db.query("select create_loan($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)",
        [custA, vehA, "60000.00", iso(-1), iso(-1), iso(0), JSON.stringify(a.p_terms), JSON.stringify(a.p_schedule)])).rejects.toThrow(/schedule principal/);
    });
  });
  let firstPay: string;
  it("partial payment is allocated fees → interest → principal on the oldest instalment", async () => {
    const before = await outstanding();
    const interest1 = 1200; // 120000 × 1%
    await asUser(db, ids.clerkA, async () => {
      firstPay = (await one("select record_payment($1, 5000, $2, 'upi', 'UPI-REF-1', 'partial') as id", [loanA, iso(0)])).id;
    });
    const alloc = await one("select * from payment_allocations where payment_id = $1", [firstPay]);
    expect(Number(alloc.interest_amount)).toBe(interest1);
    expect(Number(alloc.principal_amount)).toBe(3800);
    const after = await outstanding();
    expect(Number(before.total_receivable) - Number(after.total_receivable)).toBe(5000);
    expect(Number(after.principal_outstanding)).toBe(120000 - 3800);
    expect(Number(after.interest_outstanding)).toBeCloseTo(Number(before.interest_outstanding) - interest1, 2);
    // instalment 1 still overdue (partially paid), with the remainder owed
    const s1 = await one("select * from v_schedule_status where loan_id = $1 and installment_no = 1", [loanA]);
    expect(s1.status).toBe("overdue");
    expect(Number(s1.paid_total)).toBe(5000);
  });
  it("multiple payments against one instalment work and clear it", async () => {
    const s1 = await one("select total_outstanding from v_schedule_status where loan_id = $1 and installment_no = 1", [loanA]);
    await asUser(db, ids.clerkA, async () => { await db.query("select record_payment($1, $2, $3, 'cash')", [loanA, s1.total_outstanding, iso(0)]); });
    const s1b = await one("select status from v_schedule_status where loan_id = $1 and installment_no = 1", [loanA]);
    expect(s1b.status).toBe("paid");
    expect((await outstanding()).status).toBe("active"); // nothing overdue any more
  });
  it("rejects overpayment, future dates and non-positive amounts", async () => {
    await asUser(db, ids.clerkA, async () => {
      await expect(db.query("select record_payment($1, 99999999, $2, 'cash')", [loanA, iso(0)])).rejects.toThrow(/exceeds total receivable/);
      await expect(db.query("select record_payment($1, 100, $2, 'cash')", [loanA, iso(5)])).rejects.toThrow(/future/);
      await expect(db.query("select record_payment($1, 0, $2, 'cash')", [loanA, iso(0)])).rejects.toThrow(/positive/);
    });
  });
  it("failed payments leave no partial ledger rows", async () => {
    const n = await one("select count(*)::int as n from payments where loan_id = $1", [loanA]);
    expect(n.n).toBe(2);
  });
  it("ledger rows cannot be updated or deleted, even by a superuser session", async () => {
    await expect(db.query("update payments set amount = 1")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from payment_allocations")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from audit_logs")).rejects.toThrow(/append-only/);
  });
  it("reversal needs permission and a reason, restores balances, and cannot be repeated", async () => {
    const before = await outstanding();
    await asUser(db, ids.clerkA, async () => {
      await expect(db.query("select reverse_payment($1, 'oops')", [firstPay])).rejects.toThrow(/payments.reverse/);
    });
    await asUser(db, ids.ownerA, async () => {
      await expect(db.query("select reverse_payment($1, '  ')", [firstPay])).rejects.toThrow(/reason/);
      await db.query("select reverse_payment($1, 'Entered against wrong loan')", [firstPay]);
      await expect(db.query("select reverse_payment($1, 'again')", [firstPay])).rejects.toThrow(/already reversed/);
    });
    const after = await outstanding();
    expect(Number(after.total_receivable) - Number(before.total_receivable)).toBe(5000);
    // ledger invariant: payments always equal their allocations
    const inv = await one(`select (select sum(amount) from payments where loan_id = $1) as pay,
      (select sum(principal_amount + interest_amount + fees_amount) from payment_allocations a join payments p on p.id = a.payment_id where p.loan_id = $1) as alloc`, [loanA]);
    expect(Number(inv.pay)).toBeCloseTo(Number(inv.alloc), 2);
  });
  it("paying everything closes the loan", async () => {
    const o = await outstanding();
    await asUser(db, ids.clerkA, async () => { await db.query("select record_payment($1, $2, $3, 'bank_transfer')", [loanA, o.total_receivable, iso(0)]); });
    const c = await outstanding();
    expect(c.status).toBe("closed");
    expect(Number(c.principal_outstanding)).toBe(0);
    expect(Number(c.total_receivable)).toBe(0);
  });
});

describe("documents", () => {
  const hash = "a".repeat(64);
  let docId: string;
  it("employee can upload; versions auto-number; path must sit in the tenant folder", async () => {
    await asUser(db, ids.clerkA, async () => {
      docId = (await one("insert into documents (customer_id, vehicle_id, category, expiry_date) values ($1,$2,'insurance',$3) returning id", [custA, vehA, iso(-1)])).id;
      await db.query("insert into document_versions (document_id, storage_path, mime_type, size_bytes, sha256) values ($1,$2,'application/pdf',1000,$3)", [docId, `${ids.finA}/${custA}/${docId}/1-policy.pdf`, hash]);
      await db.query("insert into document_versions (document_id, storage_path, mime_type, size_bytes, sha256) values ($1,$2,'image/png',2000,$3)", [docId, `${ids.finA}/${custA}/${docId}/2-policy.png`, "b".repeat(64)]);
      const v = await db.query("select version_no from document_versions where document_id = $1 order by version_no", [docId]);
      expect(v.rows.map((r: any) => r.version_no)).toEqual([1, 2]);
      await expect(db.query("insert into document_versions (document_id, storage_path, mime_type, size_bytes, sha256) values ($1,'other-tenant/x.pdf','application/pdf',10,$2)", [docId, hash])).rejects.toThrow();
      await expect(db.query("insert into document_versions (document_id, storage_path, mime_type, size_bytes, sha256) values ($1,$2,'application/exe',10,$3)", [docId, `${ids.finA}/x`, hash])).rejects.toThrow();
    });
  });
  it("expired insurance is reported as expired and counted on the dashboard", async () => {
    await asUser(db, ids.ownerA, async () => {
      expect((await one("select effective_status from v_documents where id = $1", [docId])).effective_status).toBe("expired");
      expect(Number((await one("select expired_insurance from v_dashboard_summary")).expired_insurance)).toBe(1);
    });
  });
  it("only staff with documents.verify can mark a document verified", async () => {
    await asUser(db, ids.clerkA, async () => {
      await expect(db.query("update documents set status = 'verified' where id = $1", [docId])).rejects.toThrow(/documents.verify/);
      await expect(db.query("insert into documents (customer_id, category, status) values ($1,'rc','verified')", [custA])).rejects.toThrow();
    });
    await asUser(db, ids.ownerA, async () => {
      await db.query("update documents set status = 'verified' where id = $1", [docId]);
      expect((await one("select verified_by from documents where id = $1", [docId])).verified_by).toBe(ids.ownerA);
    });
  });
  it("document versions are immutable and tenant B cannot see them", async () => {
    await expect(db.query("delete from document_versions")).rejects.toThrow(/append-only/);
    await asUser(db, ids.ownerB, async () => { expect((await db.query("select * from document_versions")).rows).toHaveLength(0); });
  });
});

describe("audit trail", () => {
  it("records every financial write with actor and before/after", async () => {
    const r = await one("select count(*)::int as n from audit_logs where table_name = 'payments' and action = 'INSERT' and actor_id is not null");
    expect(r.n).toBeGreaterThanOrEqual(4); // receipts + reversal + final payoff
    const loanStatus = await one("select count(*)::int as n from audit_logs where table_name = 'loans' and action = 'UPDATE' and old_data->>'status' <> new_data->>'status'");
    expect(loanStatus.n).toBeGreaterThanOrEqual(2);
  });
});
