import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) => readFileSync(join(__dirname, "..", "..", "supabase", f), "utf8");
const stubs = readFileSync(join(__dirname, "stubs.sql"), "utf8");

describe("setup files", () => {
  it("all-migrations.sql builds a complete database in one go", async () => {
    const db = new PGlite();
    await db.exec(stubs);
    await db.exec(read("all-migrations.sql"));
    const t = await db.query<{ n: string }>("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
    expect(Number(t.rows[0]!.n)).toBeGreaterThanOrEqual(20);
    const fn = await db.query("select 1 from pg_proc where proname = 'report_monthly'");
    expect(fn.rows).toHaveLength(1);
  });
  it("reset-dev.sql wipes the schema so setup can be run again from scratch", async () => {
    const db = new PGlite();
    await db.exec(stubs);
    await db.exec(read("all-migrations.sql"));
    await db.exec(read("reset-dev.sql"));
    expect((await db.query("select 1 from information_schema.tables where table_schema = 'public'")).rows).toHaveLength(0);
    await db.exec(read("all-migrations.sql")); // runs cleanly a second time
    expect((await db.query("select 1 from pg_proc where proname = 'record_payment'")).rows).toHaveLength(1);
  });
});

describe("service role access", () => {
  it("the server-side service role can read tables and call functions after setup", async () => {
    const db = new PGlite();
    await db.exec(stubs);
    await db.exec(read("all-migrations.sql"));
    await db.exec("set role service_role");
    try {
      expect((await db.query("select count(*)::int as n from financiers")).rows[0]).toEqual({ n: 0 });
      expect((await db.query("select count(*)::int as n from profiles")).rows[0]).toEqual({ n: 0 });
      await db.query("select today_ist()");
      await db.query("select overdue_as_of(current_date)");
    } finally { await db.exec("reset role"); }
  });
});
