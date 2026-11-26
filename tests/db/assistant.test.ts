import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb, ids, iso, seedTenants } from "./helpers";
import { generateSchedule, toCreateLoanArgs } from "../../src/lib/finance";

let db: PGlite, ravi: string, sita: string, raviVeh: string, raviLoan: string, sitaLoan: string;
const one = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!;
const fn = async (call: string, p: unknown[] = []) => (await one(`select ${call} as r`, p)).r as any;
const num = (v: unknown) => Number(v);
const uuid = () => crypto.randomUUID();

async function makeLoan(customer: string, vehicle: string, input: Parameters<typeof generateSchedule>[0], given: string) {
  const a = toCreateLoanArgs(input, generateSchedule(input));
  return (await one("select create_loan($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) as id", [customer, vehicle, a.p_principal, given, given, given, JSON.stringify(a.p_terms), JSON.stringify(a.p_schedule)])).id as string;
}
async function addDoc(customer: string, category: string, o: { vehicle?: string | null; expiry?: string | null } = {}) {
  const d = uuid();
  await db.query("select register_document_upload($1,true,$2,$3,null,$4,'t',$5,$6,'f.pdf','application/pdf',100,$7)", [d, customer, o.vehicle ?? null, category, o.expiry ?? null, `${ids.finA}/${customer}/${d}/${uuid()}-f.pdf`, uuid().replace(/-/g, "").repeat(2)]);
  return d;
}

beforeAll(async () => {
  db = await freshDb();
  await seedTenants(db);
  await asUser(db, ids.clerkA, async () => {
    ravi = (await one("insert into customers (full_name, mobile) values ('Ravi Kumar','9876543210') returning id")).id;
    sita = (await one("insert into customers (full_name, mobile) values ('Sita Devi','9000000099') returning id")).id;
    raviVeh = (await one("insert into vehicles (customer_id, registration_number, category, insurance_expiry) values ($1,'AP04XX1234','pickup',$2) returning id", [ravi, iso(-3)])).id;
    const sitaVeh = (await one("insert into vehicles (customer_id, registration_number, category) values ($1,'AP39ZZ0001','truck') returning id", [sita])).id;
    raviLoan = await makeLoan(ravi, raviVeh, { principal: "12000", annualRatePercent: 0, method: "reducing", tenureInstallments: 3, frequency: "monthly", firstDueDate: iso(-65) }, iso(-70));
    sitaLoan = await makeLoan(sita, sitaVeh, { principal: "100000", annualRatePercent: 12, method: "flat", tenureInstallments: 12, frequency: "monthly", firstDueDate: iso(30) }, iso(-1));
    await db.query("select record_payment($1, 4000, $2, 'cash')", [raviLoan, iso(-50)]);
    await addDoc(ravi, "insurance", { vehicle: raviVeh, expiry: iso(-5) });
    await addDoc(ravi, "rc", { vehicle: raviVeh });
    await addDoc(ravi, "kyc", { expiry: iso(10) });
  });
  await asUser(db, ids.ownerA, async () => {
    await db.query("select import_legacy_loans($1::jsonb,$2,$3,'daily',false)", [JSON.stringify([{ line: 2, name: "Gopal Rao", mobile: "9111111111", loan_ref: "D-101", daily_due: "300", balance: "1000" }]), iso(0), iso(1)]);
  });
});

const asOwner = <T>(f: () => Promise<T>) => asUser(db, ids.ownerA, f);

describe("business summary and comparison", () => {
  it("counts money given (excluding imported balances), collections, and today's position", async () => {
    await asOwner(async () => {
      const r = await fn("ai_business_summary($1,$2)", [iso(-80), iso(0)]);
      expect(r.loans_given).toEqual({ count: 2, amount: 112000 });
      expect(r.collections.net).toBe(4000);
      expect(r.position_today.customers).toBe(3);
      expect(r.position_today.active_loans).toBe(3);
      expect(r.position_today.overdue_amount).toBe(8000);
      expect(r.position_today.overdue_loans).toBe(1);
      expect(r.position_today.principal_outstanding).toBe(8000 + 100000 + 1000);
      expect(r.position_today.interest_outstanding).toBe(12000);
      expect(Array.isArray(r.method)).toBe(true);
      const narrow = await fn("ai_business_summary($1,$2)", [iso(-60), iso(0)]);
      expect(narrow.loans_given.count).toBe(1);
    });
  });
  it("compares two periods with the arithmetic done in the database", async () => {
    await asOwner(async () => {
      const r = await fn("ai_compare_periods($1,$2,$3,$4)", [iso(-60), iso(0), iso(-130), iso(-61)]);
      expect(r.a_minus_b).toEqual({ loans_given_count: 0, loans_given_amount: 88000, collections_net: 4000 });
    });
  });
  it("rejects backwards or very long ranges", async () => {
    await asOwner(async () => {
      await expect(fn("ai_business_summary($1,$2)", [iso(0), iso(-5)])).rejects.toThrow(/invalid date range/);
      await expect(fn("ai_business_summary($1,$2)", [iso(-2000), iso(0)])).rejects.toThrow(/too long/);
    });
  });
});

describe("collections and loans given", () => {
  it("groups collections by day and month", async () => {
    await asOwner(async () => {
      const day = await fn("ai_collections($1,$2,'day')", [iso(-80), iso(0)]);
      expect(day.rows).toEqual([{ period: iso(-50), net: 4000, receipts: 1 }]);
      expect(day.total.net).toBe(4000);
      const month = await fn("ai_collections($1,$2,'month')", [iso(-80), iso(0)]);
      expect(month.rows.reduce((a: number, r: any) => a + r.net, 0)).toBe(4000);
      await expect(fn("ai_collections($1,$2,'week')", [iso(-80), iso(0)])).rejects.toThrow(/group must be/);
    });
  });
  it("lists loans given, by vehicle type, and above a minimum amount", async () => {
    await asOwner(async () => {
      const cat = await fn("ai_loans_given($1,$2,'vehicle_category')", [iso(-80), iso(0)]);
      expect(cat.rows.map((r: any) => [r.vehicle_category, r.amount])).toEqual([["truck", 100000], ["pickup", 12000]]);
      const big = await fn("ai_loans_given($1,$2,'none',50000)", [iso(-80), iso(0)]);
      expect(big.total).toEqual({ count: 1, amount: 100000 });
      expect(big.rows).toHaveLength(1);
      expect(big.rows[0].customer).toBe("Sita Devi");
    });
  });
});

describe("overdue and outstanding", () => {
  it("lists overdue loans with filters and a capped list size", async () => {
    await asOwner(async () => {
      const r = await fn("ai_overdue_loans()");
      expect(r.total).toEqual({ loans: 1, overdue_amount: 8000 });
      expect(r.rows[0]).toMatchObject({ customer: "Ravi Kumar", overdue_amount: 8000, overdue_installments: 2, vehicle: "AP04XX1234" });
      expect((await fn("ai_overdue_loans(3)")).rows).toHaveLength(0);           // "more than two overdue instalments"
      expect((await fn("ai_overdue_loans(1, 9000)")).rows).toHaveLength(0);
      expect((await fn("ai_overdue_loans(1, 0, 100000)")).rows_limit).toBe(50);
    });
  });
  it("totals what is outstanding, by vehicle type and by status", async () => {
    await asOwner(async () => {
      const t = await fn("ai_outstanding('none')");
      expect(t.total.principal_outstanding).toBe(109000);
      expect(t.total.overdue_amount).toBe(8000);
      const cats = await fn("ai_outstanding('vehicle_category')");
      expect(Object.fromEntries(cats.rows.map((r: any) => [r.vehicle_category, r.principal_outstanding]))).toEqual({ truck: 100000, pickup: 8000, other: 1000 });
      const st = await fn("ai_outstanding('loan_status')");
      expect(st.rows.map((r: any) => r.status).sort()).toEqual(["active", "overdue"]);
    });
  });
});

describe("finding people and loans", () => {
  it("finds customers by name, mobile, registration or register number, treating the text literally", async () => {
    await asOwner(async () => {
      const names = async (q: string) => (await fn("ai_find_customers($1)", [q])).rows.map((r: any) => r.name);
      expect(await names("ravi")).toEqual(["Ravi Kumar"]);
      expect(await names("9876543210")).toEqual(["Ravi Kumar"]);
      expect(await names("ap 04 xx")).toEqual(["Ravi Kumar"]);
      expect(await names("d-101")).toEqual(["Gopal Rao"]);
      expect(await names("%%")).toEqual([]);
      expect(await names("'; drop table customers; --")).toEqual([]);
      await expect(fn("ai_find_customers($1)", ["a"])).rejects.toThrow(/2 to 60/);
      expect(num((await one("select count(*) as n from customers")).n)).toBe(3);
    });
  });
  it("gives a customer's full picture, and refuses another business's customer", async () => {
    await asOwner(async () => {
      const r = await fn("ai_customer_detail($1)", [ravi]);
      expect(r.customer.name).toBe("Ravi Kumar");
      expect(r.vehicles[0].registration).toBe("AP04XX1234");
      expect(r.loans[0]).toMatchObject({ loan_no: expect.any(String), overdue_amount: 8000, principal_outstanding: 8000 });
      expect(r.documents.map((d: any) => d.category).sort()).toEqual(["insurance", "kyc", "rc"]);
      await expect(fn("ai_customer_detail($1)", [uuid()])).rejects.toThrow(/customer not found/);
    });
    await asUser(db, ids.ownerB, async () => { await expect(fn("ai_customer_detail($1)", [ravi])).rejects.toThrow(/customer not found/); });
  });
  it("looks up a loan by number, register number or id", async () => {
    await asOwner(async () => {
      const byId = await fn("ai_loan_detail($1)", [raviLoan]);
      expect(byId.schedule).toMatchObject({ instalments: 3, paid: 1, overdue: 2 });
      expect(byId.outstanding.overdue_amount).toBe(8000);
      expect(byId.recent_payments).toHaveLength(1);
      expect(byId.missing_required_documents.sort()).toEqual(["address_proof", "loan_agreement"]);
      const byNo = await fn("ai_loan_detail($1)", [byId.loan.loan_no.toLowerCase()]);
      expect(byNo.loan.loan_id).toBe(raviLoan);
      const byRef = await fn("ai_loan_detail('d-101')");
      expect(byRef.loan.source).toBe("imported");
      expect(byRef.outstanding.total_receivable).toBe(1000);
      await expect(fn("ai_loan_detail('nope')")).rejects.toThrow(/loan not found/);
    });
  });
});

describe("documents, missing documents and insurance", () => {
  it("filters documents and points to the screen where they open", async () => {
    await asOwner(async () => {
      const exp = await fn("ai_find_documents(null, null, null, null, true)");
      expect(exp.rows.map((r: any) => r.category)).toEqual(["insurance"]);
      expect(exp.rows[0].page).toMatch(/^\/documents\/[0-9a-f-]{36}$/);
      const soon = await fn("ai_find_documents(null, null, null, 30)");
      expect(soon.rows.map((r: any) => r.category)).toEqual(["kyc"]);
      expect((await fn("ai_find_documents($1, 'rc')", [ravi])).rows).toHaveLength(1);
      expect((await fn("ai_find_documents($1, null, 'expired')", [ravi])).matching).toBe(1);
      await expect(fn("ai_find_documents(null, 'passport')")).rejects.toThrow();
    });
  });
  it("lists loan files with missing documents and insurance that has ended", async () => {
    await asOwner(async () => {
      const m = await fn("ai_loans_missing_documents()");
      expect(m.loans_with_missing_documents).toBe(3);
      const r = m.rows.find((x: any) => x.customer === "Ravi Kumar");
      expect(r.missing.sort()).toEqual(["address_proof", "loan_agreement"]);
      const ins = await fn("ai_insurance_expiry(30)");
      expect(ins.rows).toHaveLength(1);
      // the insurance document uploaded for the vehicle (expiry 5 days ago) is the date that counts
      expect(ins.rows[0]).toMatchObject({ vehicle: "AP04XX1234", days_left: -5, has_open_loan: true });
      expect((await fn("ai_insurance_expiry(30, false)")).rows).toHaveLength(0);
    });
  });
});

describe("privacy and access", () => {
  it("another business sees nothing, and anonymous visitors cannot call any assistant function", async () => {
    await asUser(db, ids.ownerB, async () => {
      expect((await fn("ai_business_summary($1,$2)", [iso(-80), iso(0)])).loans_given.count).toBe(0);
      expect((await fn("ai_overdue_loans()")).rows).toEqual([]);
      expect((await fn("ai_find_customers('ravi')")).rows).toEqual([]);
      expect((await fn("ai_outstanding('none')")).total.principal_outstanding).toBe(0);
    });
    await db.exec("set role anon");
    try {
      await expect(db.query("select ai_business_summary($1,$2)", [iso(-1), iso(0)])).rejects.toThrow(/permission denied/);
      await expect(db.query("select ai_find_customers('ravi')")).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role"); }
  });
});

describe("chat history", () => {
  let conv: string;
  beforeAll(async () => { await db.exec(`update profiles set permissions = array_append(permissions, 'assistant.use') where id = '${ids.clerkA}'`); });
  it("needs the assistant permission (owners always have it)", async () => {
    await asUser(db, ids.viewerA, async () => { await expect(db.query("insert into chat_conversations (title) values ('x')")).rejects.toThrow(/row-level security/); });
    await asOwner(async () => { conv = (await one("insert into chat_conversations (title) values ('Overdue loans') returning id")).id; await db.query("insert into chat_messages (conversation_id, role, content) values ($1,'user','who is overdue?')", [conv]); });
  });
  it("employees see only their own chats; the owner can read everyone's; nobody can write into another person's chat", async () => {
    let clerkConv = "";
    await asUser(db, ids.clerkA, async () => {
      expect((await db.query("select * from chat_conversations")).rows).toHaveLength(0);
      clerkConv = (await one("insert into chat_conversations (title) values ('mine') returning id")).id;
      await expect(db.query("insert into chat_messages (conversation_id, role, content) values ($1,'user','hi')", [conv])).rejects.toThrow(/row-level security/);
      await db.query("insert into chat_messages (conversation_id, role, content) values ($1,'user','hello')", [clerkConv]);
      expect(num(await fn("ai_questions_today()"))).toBe(1);
    });
    await asOwner(async () => { expect((await db.query("select * from chat_conversations")).rows).toHaveLength(2); });
    await asUser(db, ids.ownerB, async () => { expect((await db.query("select * from chat_messages")).rows).toHaveLength(0); });
  });
  it("messages cannot be edited or deleted", async () => {
    await expect(db.query("update chat_messages set content = 'changed'")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from chat_messages")).rejects.toThrow(/append-only/);
  });
});
