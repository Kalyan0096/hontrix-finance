import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb, ids, seedTenants } from "./helpers";

let db: PGlite;
const one = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!;
beforeAll(async () => { db = await freshDb(); await seedTenants(db); });

describe("login attempts table", () => {
  it("is invisible to signed-in and anonymous users, and usable by the server", async () => {
    await db.exec("set role service_role");
    try { await db.query("insert into login_attempts (email_hash, ip, success) values ('abc', '1.2.3.4', false)"); expect(Number((await one("select count(*) as n from login_attempts")).n)).toBe(1); }
    finally { await db.exec("reset role"); }
    await asUser(db, ids.ownerA, async () => { await expect(db.query("select * from login_attempts")).rejects.toThrow(/permission denied/); });
    await db.exec("set role anon");
    try { await expect(db.query("insert into login_attempts (email_hash) values ('x')")).rejects.toThrow(/permission denied/); } finally { await db.exec("reset role"); }
  });
});

describe("export logging", () => {
  it("owner can log an export; it appears in their audit trail with who and what", async () => {
    await asUser(db, ids.ownerA, async () => {
      await db.query("select log_export('backup', '{\"kind\":\"backup\",\"rows\":12}'::jsonb)");
      const r = await one("select actor_id, action, table_name, new_data from audit_logs where action = 'EXPORT'");
      expect(r.actor_id).toBe(ids.ownerA);
      expect(r.table_name).toBe("export:backup");
      expect(r.new_data.rows).toBe(12);
    });
  });
  it("employees cannot log or perform owner exports, and unknown kinds are refused", async () => {
    await asUser(db, ids.clerkA, async () => { await expect(db.query("select log_export('backup')")).rejects.toThrow(/only the owner/); });
    await asUser(db, ids.ownerA, async () => { await expect(db.query("select log_export('everything')")).rejects.toThrow(/unknown export kind/); });
    await db.exec("set role anon");
    try { await expect(db.query("select log_export('backup')")).rejects.toThrow(/permission denied/); } finally { await db.exec("reset role"); }
  });
  it("another business's owner cannot see these entries", async () => {
    await asUser(db, ids.ownerB, async () => { expect((await db.query("select * from audit_logs where action = 'EXPORT'")).rows).toHaveLength(0); });
  });
});
