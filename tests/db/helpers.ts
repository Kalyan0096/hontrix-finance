import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(__dirname, "stubs.sql"), "utf8"));
  const dir = join(root, "supabase", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  return db;
}

export const ids = {
  finA: "00000000-0000-0000-0000-00000000000a",
  finB: "00000000-0000-0000-0000-00000000000b",
  ownerA: "10000000-0000-0000-0000-00000000000a",
  clerkA: "10000000-0000-0000-0000-0000000000a1", // employee: customers/vehicles/loans/payments/documents.upload
  viewerA: "10000000-0000-0000-0000-0000000000a2", // employee: no permissions
  ownerB: "10000000-0000-0000-0000-00000000000b",
};

/** Seed as superuser (fictional data only). */
export async function seedTenants(db: PGlite) {
  await db.exec(`
    insert into financiers (id, name) values ('${ids.finA}', 'Test Finance A'), ('${ids.finB}', 'Test Finance B');
    insert into auth.users (id) values ('${ids.ownerA}'), ('${ids.clerkA}'), ('${ids.viewerA}'), ('${ids.ownerB}');
    insert into profiles (id, financier_id, role, full_name, permissions) values
      ('${ids.ownerA}', '${ids.finA}', 'owner',    'Owner A',  '{}'),
      ('${ids.clerkA}', '${ids.finA}', 'employee', 'Clerk A',  '{customers.write,vehicles.write,loans.write,payments.record,documents.upload}'),
      ('${ids.viewerA}','${ids.finA}', 'employee', 'Viewer A', '{}'),
      ('${ids.ownerB}', '${ids.finB}', 'owner',    'Owner B',  '{}');
  `);
}

/** Run fn as a signed-in Supabase user (RLS applies). Always resets afterwards. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { return await fn(); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

export const iso = (offsetDays: number) => {
  // today in IST, shifted — mirrors today_ist() in SQL
  const now = new Date(Date.now() + 5.5 * 3600 * 1000 + offsetDays * 86400000);
  return now.toISOString().slice(0, 10);
};
