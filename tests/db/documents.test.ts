import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb, ids, iso, seedTenants } from "./helpers";

let db: PGlite, cust: string, veh: string, otherCust: string, otherVeh: string;
const one = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!;
const hash = (c: string) => c.repeat(64);
const uuid = () => crypto.randomUUID();

async function register(doc: string, isNew: boolean, o: { vehicle?: string | null; cat?: string; expiry?: string | null; path?: string; sha?: string; customer?: string } = {}) {
  const c = o.customer ?? cust;
  const path = o.path ?? `${ids.finA}/${c}/${doc}/${uuid()}-file.pdf`;
  return one("select register_document_upload($1,$2,$3,$4,null,$5,'Policy',$6,$7,'file.pdf','application/pdf',1000,$8) as v",
    [doc, isNew, c, o.vehicle === undefined ? veh : o.vehicle, o.cat ?? "insurance", o.expiry ?? null, path, o.sha ?? hash("a")]);
}

beforeAll(async () => {
  db = await freshDb();
  await seedTenants(db);
  await asUser(db, ids.clerkA, async () => {
    cust = (await one("insert into customers (full_name, mobile) values ('Ravi','9876543210') returning id")).id;
    otherCust = (await one("insert into customers (full_name, mobile) values ('Sita','9876543211') returning id")).id;
    veh = (await one("insert into vehicles (customer_id, registration_number) values ($1,'AP04XX1234') returning id", [cust])).id;
    otherVeh = (await one("insert into vehicles (customer_id, registration_number) values ($1,'AP04XX9999') returning id", [otherCust])).id;
  });
});

describe("register_document_upload", () => {
  const doc = uuid();
  it("creates the document and version 1 atomically; replacement makes version 2 and resets verification", async () => {
    await asUser(db, ids.clerkA, async () => { expect((await register(doc, true, { expiry: iso(200) })).v).toBe(1); });
    await asUser(db, ids.ownerA, async () => { await db.query("update documents set status = 'verified' where id = $1", [doc]); });
    await asUser(db, ids.clerkA, async () => { expect((await register(doc, false, { sha: hash("b") })).v).toBe(2); });
    const d = await one("select status, verified_by from documents where id = $1", [doc]);
    expect(d.status).toBe("uploaded");
    expect(d.verified_by).toBeNull();
  });
  it("rejects a path outside the document's folder, or another tenant's folder", async () => {
    await asUser(db, ids.clerkA, async () => {
      await expect(register(uuid(), true, { path: `${ids.finB}/${cust}/x/1-file.pdf` })).rejects.toThrow(/path/);
      await expect(register(uuid(), true, { path: `${ids.finA}/${cust}/${uuid()}/1-file.pdf` })).rejects.toThrow(/path/);
    });
  });
  it("rejects a vehicle that belongs to a different customer", async () => {
    await asUser(db, ids.clerkA, async () => { await expect(register(uuid(), true, { vehicle: otherVeh })).rejects.toThrow(/vehicle does not belong/); });
  });
  it("needs documents.upload, and other tenants cannot add to it", async () => {
    await asUser(db, ids.viewerA, async () => { await expect(register(uuid(), true)).rejects.toThrow(/permission denied/); });
    await asUser(db, ids.ownerB, async () => { await expect(register(doc, false)).rejects.toThrow(); });
  });
});

describe("insurance sync and dashboard", () => {
  it("vehicle insurance date follows the latest non-rejected insurance document", async () => {
    const a = uuid(), b = uuid();
    await asUser(db, ids.clerkA, async () => {
      await register(a, true, { expiry: iso(30) });
      expect((await one("select insurance_expiry::text as d from vehicles where id = $1", [veh])).d).toBe(iso(200)); // earlier test's doc has the later date
      await register(b, true, { expiry: iso(400) });
      expect((await one("select insurance_expiry::text as d from vehicles where id = $1", [veh])).d).toBe(iso(400));
    });
    await asUser(db, ids.ownerA, async () => {
      await db.query("update documents set status = 'rejected' where id = $1", [b]);
      expect((await one("select insurance_expiry::text as d from vehicles where id = $1", [veh])).d).toBe(iso(200));
    });
  });
  it("dashboard counts documents awaiting verification", async () => {
    await asUser(db, ids.ownerA, async () => {
      const r = await one("select documents_to_verify from v_dashboard_summary");
      expect(Number(r.documents_to_verify)).toBeGreaterThanOrEqual(2);
    });
  });
  it("document list view marks past-expiry documents as expired", async () => {
    const d = uuid();
    await asUser(db, ids.clerkA, async () => { await register(d, true, { expiry: iso(-5), cat: "insurance", vehicle: null }); });
    await asUser(db, ids.ownerA, async () => {
      const r = await one("select effective_status, days_to_expiry from v_documents where id = $1", [d]);
      expect(r.effective_status).toBe("expired");
      expect(Number(r.days_to_expiry)).toBe(-5);
    });
  });
});
