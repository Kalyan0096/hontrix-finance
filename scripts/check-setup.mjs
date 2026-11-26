// Checks a live Supabase project against what the app needs. Prints what passed and what to fix. Changes nothing.
// Usage:  npm run check      (reads .env.local; never prints your keys)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let failed = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m, fix) => { failed++; console.log(`  ✗ ${m}\n      → ${fix}`); };
const section = (t) => console.log(`\n${t}`);

section("1. Settings file (.env.local)");
if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) fail("NEXT_PUBLIC_SUPABASE_URL missing or not like https://xxxx.supabase.co", "Copy the Project URL from Supabase → Project Settings → API.");
else pass("Project URL looks right");
if (!anonKey) fail("NEXT_PUBLIC_SUPABASE_ANON_KEY is empty", "Copy the anon (or publishable) key from Project Settings → API.");
else pass("Anon key present");
if (!svcKey) fail("SUPABASE_SERVICE_ROLE_KEY is empty", "Copy the service_role (or secret) key from Project Settings → API. Keep it private.");
else if (svcKey === anonKey) fail("Service key is the same as the anon key", "You pasted the same key twice. Use the service_role / secret key for this one.");
else pass("Service key present");
if (failed) { console.log("\nFix the items above first, then run this again."); process.exit(1); }

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, svcKey, opts), anon = createClient(url, anonKey, opts);

section("2. Database tables (from all-migrations.sql)");
const tables = ["financiers", "profiles", "customers", "vehicles", "loans", "loan_terms", "repayment_schedules", "payments", "payment_allocations", "documents", "document_versions", "document_access_logs", "audit_logs", "business_settings", "required_document_rules", "follow_up_tasks"];
let missing = [];
for (const t of tables) { const { error } = await admin.from(t).select("id").limit(1); if (error) missing.push(`${t} (${error.code ?? ""} ${error.message})`); }
if (missing.length === tables.length) fail(`The database refused every table: ${missing[0]}`, "If it says permission denied, run supabase/migrations/0007_service_role_grants.sql in the SQL Editor. If it says the table is not found, run all-migrations.sql first.");
else if (missing.length) fail(`Missing: ${missing.join("; ")}`, "The SQL stopped partway. Send me the error text it showed (never your keys).");
else pass(`All ${tables.length} tables exist`);

section("3. Latest migrations applied");
{ const { error } = await admin.from("v_dashboard_summary").select("documents_to_verify").limit(1);
  error ? fail("Migration 0005 (documents) not applied", "Run all-migrations.sql, or the missing file(s) in order.") : pass("0005 documents"); }
{ const { error } = await admin.rpc("overdue_as_of", { p_date: "2026-01-01" });
  error ? fail(`Migration 0006 check failed: ${error.message}`, "Fix section 2 first, then run again.") : pass("0006 reports"); }

{ const { error } = await admin.from("v_alerts").select("kind").limit(1);
  error ? fail(`Migration 0008 (alerts, follow-ups, required documents) check failed: ${error.message}`, "Run supabase/migrations/0008_essentials.sql in the SQL Editor (only that file).") : pass("0008 essentials"); }

{ const { error } = await admin.rpc("collection_sheet", { p_date: "2026-01-01" });
  error ? fail(`Migration 0009 (daily collection, import) check failed: ${error.message}`, "Run supabase/migrations/0009_daily_collection.sql in the SQL Editor (only that file).") : pass("0009 daily collection"); }

{ const { error } = await admin.from("login_attempts").select("id").limit(1);
  error ? fail(`Migration 0010 (sign-in protection, export logging) check failed: ${error.message}`, "Run supabase/migrations/0010_hardening.sql in the SQL Editor (only that file).") : pass("0010 hardening"); }

{ const { error } = await admin.rpc("ai_overdue_loans", {});
  error ? fail(`Migration 0011 (AI assistant) check failed: ${error.message}`, "Run supabase/migrations/0011_assistant.sql in the SQL Editor (only that file).") : pass("0011 assistant"); }
{ const g = !!process.env.GEMINI_API_KEY, a = !!process.env.ANTHROPIC_API_KEY;
  const which = process.env.AI_PROVIDER?.toLowerCase();
  const use = which === "anthropic" && a ? "Anthropic" : which === "gemini" && g ? "Gemini" : g ? "Gemini" : a ? "Anthropic" : null;
  console.log(use ? `  ✓ AI key present: the assistant will use ${use}${use === "Gemini" && process.env.GEMINI_TIER?.toLowerCase() !== "paid" ? " (free test mode: made-up data only)" : ""}` : "  · No AI key set: the assistant stays unavailable until you add GEMINI_API_KEY or ANTHROPIC_API_KEY (optional)"); }

section("4. Private file storage");
{ const { data, error } = await admin.storage.getBucket("documents");
  if (error || !data) fail("Storage bucket 'documents' not found", "Re-run 0003_storage_private_bucket.sql, or create a PRIVATE bucket named documents in Storage.");
  else data.public ? fail("Bucket 'documents' is PUBLIC", "Storage → documents → edit → turn Public OFF immediately.") : pass("Bucket 'documents' exists and is private"); }

section("5. Strangers are locked out");
{ const r = await anon.from("customers").select("id").limit(1);
  r.error || (r.data ?? []).length === 0 ? pass("Anonymous visitors cannot read customers") : fail("Anonymous visitors can read customers!", "Stop and send me this result. Do not use real data."); }
{ const r = await anon.rpc("report_monthly", { p_months: 1 });
  r.error ? pass("Anonymous visitors cannot run reports") : fail("Anonymous visitors can run report functions", "Re-run 0006_reports.sql."); }
try {
  const s = await (await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } })).json();
  s.disable_signup ? pass("Public sign-up is switched off") : fail("Public sign-up is ON (anyone could create a login)", "Supabase → Authentication → Sign In / Providers → turn off “Allow new users to sign up”.");
} catch { fail("Could not read auth settings", "Check your internet connection and the Project URL."); }

section("6. First owner");
{ const { count, error } = await admin.from("profiles").select("id", { count: "exact" }).eq("role", "owner").limit(1);
  error ? fail(`Could not read profiles: ${error.code ?? ""} ${error.message}`, "Fix section 2 first.") : count > 0 ? pass(`${count} owner account(s) exist`) : fail("No owner account yet", 'Run: npm run bootstrap -- "Business Name" owner@email.com "Your Name" "a-long-password"'); }

console.log(failed ? `\n${failed} problem(s) found. Fix them and run again.` : "\nAll checks passed. Start the app with: npm run dev");
process.exit(failed ? 1 : 0);
