# Architecture (summary)

**Stack:** Next.js + React + TypeScript + Tailwind (UI) → Supabase (Postgres, Auth, private Storage). AI features call an LLM API from server-side code only.

**Trust boundaries**
- Browser: anon/user JWT only. Never holds the service-role key.
- Server (Next.js route handlers / Edge Functions): service-role actions (create employee accounts, daily `refresh_all_loan_statuses()`, OCR, AI assistant).
- Database: final authority. RLS + RPCs enforce tenancy, permissions and ledger integrity even if the app has a bug.

**AI assistant (Phase 3):** the LLM may only call a fixed set of read-only, parameterised query tools that run as the signed-in user (so RLS applies). No free-form SQL. Numbers come from SQL; the model only interprets and explains.

**Known limits of Milestone 1**
- Interest outstanding = scheduled interest on unpaid instalments (not accrued-to-date interest). Penal interest/late fees are not modelled yet.
- Only flat and reducing-balance methods. Add the financier's real method once confirmed.
- Tested on PGlite (Postgres in WASM), not a live Supabase project; storage policies (0003) are untested until you run them on Supabase.
- Restructuring/loan-status transitions beyond active/overdue/closed are not built yet.

**Regulatory dependencies (need a lawyer, not code):** whether the financier is RBI-regulated (Digital Lending Directions, LSP rules), DPDP Act consent/retention, collection-conduct rules. Required before Phase 4 and before any real borrower data.

## Milestones
1. ✅ DB foundation + loan maths
2. Next.js app shell: login, roles, English/Telugu, layout
3. Customers + vehicles screens
4. Loans + schedule + payments screens
5. Documents upload + expiry
6. Dashboard + Excel/PDF export
7. Phase 2: OCR + discrepancy detection
8. Phase 3: AI assistant
