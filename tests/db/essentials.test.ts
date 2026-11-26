import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb, ids, iso, seedTenants } from "./helpers";
import { generateSchedule, toCreateLoanArgs } from "../../src/lib/finance";

let db: PGlite, cust: string, veh: string, loan: string;
const one = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!;
const all = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const uuid = () => crypto.randomUUID();

async function addDoc(category: string, o: { vehicle?: string | null; expiry?: string | null } = {}) {
  const d = uuid();
  await db.query("select register_document_upload($1,true,$2,$3,null,$4,'t',$5,$6,'f.pdf','application/pdf',100,$7)",
    [d, cust, o.vehicle === undefined ? null : o.vehicle, category, o.expiry ?? null, `${ids.finA}/${cust}/${d}/${uuid()}-f.pdf`, uuid().replace(/-/g, "").repeat(2)]);
  return d;
}

beforeAll(async () => {
  db = await freshDb();
  await seedTenants(db);
  const input = { principal: "12000", annualRatePercent: 0, method: "reducing" as const, tenureInstallments: 3, frequency: "monthly" as const, firstDueDate: iso(-35) };
  const a = toCreateLoanArgs(input, generateSchedule(input));
  await asUser(db, ids.clerkA, async () => {
    cust = (await one("insert into customers (full_name, mobile) values ('Ravi','9876543210') returning id")).id;
    veh = (await one("insert into vehicles (customer_id, registration_number, insurance_expiry) values ($1,'AP04XX1234',$2) returning id", [cust, iso(-3)])).id;
    loan = (await one("select create_loan($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) as id", [cust, veh, a.p_principal, iso(-40), iso(-40), iso(-38), JSON.stringify(a.p_terms), JSON.stringify(a.p_schedule)])).id;
  });
});

describe("required documents", () => {
  it("every new business starts with sensible defaults", async () => {
    const r = await all("select category from required_document_rules where financier_id = $1 order by category", [ids.finA]);
    expect(r.map((x) => x.category).sort()).toEqual(["address_proof", "insurance", "kyc", "loan_agreement", "rc"]);
  });
  it("only the owner can change the rules", async () => {
    await asUser(db, ids.clerkA, async () => { await expect(db.query("insert into required_document_rules (category) values ('pan')")).rejects.toThrow(/row-level security/); });
    await asUser(db, ids.ownerA, async () => {
      await db.query("insert into required_document_rules (category) values ('pan')");
      await db.query("delete from required_document_rules where category = 'pan'");
    });
    expect((await one("select count(*)::int as n from audit_logs where table_name = 'required_document_rules' and actor_id = $1", [ids.ownerA])).n).toBe(2);
  });
  it("detects missing documents and clears them as they are uploaded; rejected ones do not count", async () => {
    await asUser(db, ids.ownerA, async () => {
      expect((await all("select category from v_loan_missing_documents where loan_id = $1", [loan]))).toHaveLength(5);
      expect(Number((await one("select incomplete_loan_files from v_dashboard_summary")).incomplete_loan_files)).toBe(1);
    });
    let rc: string;
    await asUser(db, ids.clerkA, async () => { rc = await addDoc("rc", { vehicle: veh }); await addDoc("kyc"); });
    await asUser(db, ids.ownerA, async () => {
      const m = (await all("select category from v_loan_missing_documents where loan_id = $1", [loan])).map((x) => x.category).sort();
      expect(m).toEqual(["address_proof", "insurance", "loan_agreement"]);
      await db.query("update documents set status = 'rejected' where id = $1", [rc!]);
      expect((await all("select category from v_loan_missing_documents where loan_id = $1", [loan])).map((x) => x.category)).toContain("rc");
    });
  });
  it("a document tied to a different vehicle does not satisfy this loan", async () => {
    let other: string;
    await asUser(db, ids.clerkA, async () => {
      other = (await one("insert into vehicles (customer_id, registration_number) values ($1,'AP04XX7777') returning id", [cust])).id;
      await addDoc("address_proof", { vehicle: other });
    });
    await asUser(db, ids.ownerA, async () => {
      expect((await all("select category from v_loan_missing_documents where loan_id = $1", [loan])).map((x) => x.category)).toContain("address_proof");
    });
  });
  it("other businesses see nothing", async () => {
    await asUser(db, ids.ownerB, async () => {
      expect(await all("select * from v_loan_missing_documents")).toHaveLength(0);
      expect(await all("select * from required_document_rules where financier_id = $1", [ids.finA])).toHaveLength(0);
    });
  });
});

describe("follow-up tasks", () => {
  let task: string;
  it("any signed-in member can add a task; links and assignees must belong to the business", async () => {
    await asUser(db, ids.viewerA, async () => {
      task = (await one("insert into follow_up_tasks (customer_id, loan_id, title, due_date, assigned_to) values ($1,$2,'Call Ravi about overdue',$3,$4) returning id", [cust, loan, iso(0), ids.clerkA])).id;
      await expect(db.query("insert into follow_up_tasks (title, due_date, assigned_to) values ('x y',$1,$2)", [iso(0), ids.ownerB])).rejects.toThrow();
      await expect(db.query("insert into follow_up_tasks (title, due_date) values ('x',$1)", [iso(0)])).rejects.toThrow(); // title too short
    });
    await asUser(db, ids.ownerB, async () => { expect(await all("select * from follow_up_tasks")).toHaveLength(0); });
  });
  it("completing records who and when; links cannot be rewired", async () => {
    await asUser(db, ids.clerkA, async () => {
      await expect(db.query("update follow_up_tasks set customer_id = null where id = $1", [task])).rejects.toThrow(/cannot be changed/);
      await db.query("update follow_up_tasks set status = 'done' where id = $1", [task]);
      const t = await one("select completed_by, completed_at from follow_up_tasks where id = $1", [task]);
      expect(t.completed_by).toBe(ids.clerkA);
      expect(t.completed_at).not.toBeNull();
      await expect(db.query("delete from follow_up_tasks")).rejects.toThrow();
      await db.query("update follow_up_tasks set status = 'open' where id = $1", [task]); // reopen for the alerts test
    });
  });
});

describe("alerts", () => {
  it("shows overdue, upcoming, insurance, missing documents, to-check and due follow-ups", async () => {
    await asUser(db, ids.ownerA, async () => {
      const kinds = (await all("select kind, severity from v_alerts")).map((x) => `${x.kind}:${x.severity}`);
      expect(kinds).toContain("overdue_loan:high");
      expect(kinds).toContain("insurance_expired:high");
      expect(kinds).toContain("missing_documents:medium");
      expect(kinds).toContain("documents_to_verify:low");
      expect(kinds).toContain("follow_up:medium");
      const o = await one("select amount, count_value, customer_name, registration_number from v_alerts where kind = 'overdue_loan'");
      expect(Number(o.amount)).toBe(8000);          // instalments 1 and 2 are past due (4,000 each)
      expect(Number(o.count_value)).toBe(2);
      expect(o.customer_name).toBe("Ravi");
      expect(o.registration_number).toBe("AP04XX1234");
    });
  });
  it("an instalment due soon appears as upcoming; past tasks turn high", async () => {
    await asUser(db, ids.clerkA, async () => { await db.query("insert into follow_up_tasks (customer_id, title, due_date) values ($1,'Old task',$2)", [cust, iso(-4)]); });
    await asUser(db, ids.ownerA, async () => {
      expect((await all("select 1 from v_alerts where kind = 'follow_up' and severity = 'high'"))).toHaveLength(1);
      expect(Number((await one("select follow_ups_due from v_dashboard_summary")).follow_ups_due)).toBe(2);
    });
  });
  it("other businesses and anonymous visitors see no alerts", async () => {
    await asUser(db, ids.ownerB, async () => { expect(await all("select * from v_alerts")).toHaveLength(0); });
    await db.exec("set role anon");
    try { await expect(db.query("select * from v_alerts")).rejects.toThrow(/permission denied/); await expect(db.query("select * from follow_up_tasks")).rejects.toThrow(/permission denied/); }
    finally { await db.exec("reset role"); }
  });
});
