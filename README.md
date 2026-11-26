# Hontrix-PDTR

**First time? Follow `SETUP.md`, then tick through `TEST-CHECKLIST.md`.**

Milestones 1–10 done (**Phase 1 complete, essentials, daily collection, go-live readiness, and the AI assistant**): database + loan maths, app shell, customers + vehicles, loans + payments, documents, and **dashboard charts + reports + exports**.

## What exists
| Path | Purpose |
|---|---|
| `supabase/migrations/0001_core_schema.sql` | Tenants, users/roles, customers, vehicles, loans, versioned terms, repayment schedules, documents (+versions), append-only payment ledger, audit log |
| `supabase/migrations/0002_views_functions_rls.sql` | Outstanding/overdue views, dashboard view, `create_loan`, `record_payment`, `reverse_payment`, RLS policies, least-privilege grants |
| `supabase/migrations/0003_storage_private_bucket.sql` | Private `documents` bucket + tenant-folder policies (only runs on Supabase) |
| `src/lib/finance/` | Money (integer paise), dates, flat and reducing-balance schedule generator |
| `tests/` | 30 tests: loan maths, tenant isolation, permissions, ledger, documents, audit |

## Run the tests (no accounts needed)
```
npm install
npm test
```
The DB tests run the real migrations on an in-process Postgres (PGlite) with stand-ins for Supabase's `auth` schema.

## Key design rules
- Money is `numeric(14,2)` in the database and integer paise in code. No floats.
- Payments are **append-only**. Mistakes are fixed by a reversal entry, never an edit/delete (enforced by triggers).
- Payments can only be written through `record_payment` / `reverse_payment`, which check permissions, allocate (fees → interest → principal, oldest instalment first) and refuse overpayment.
- Every table has `financier_id`; composite foreign keys make cross-tenant links impossible; RLS limits every query to the caller's tenant.
- Platform administrators have **no** access to a financier's customer/loan data.
- Employee permissions: `customers.write`, `vehicles.write`, `loans.write`, `payments.record`, `payments.reverse`, `documents.upload`, `documents.verify`. Owners hold all.

## Milestone 2 additions
| Path | Purpose |
|---|---|
| `src/middleware.ts`, `src/lib/supabase/` | Session handling; user-scoped client (RLS applies); server-only admin client |
| `src/app/login`, `src/app/(app)/` | Login, responsive navigation, dashboard (real figures from `v_dashboard_summary`), owner-only Employees page |
| `src/lib/i18n/` | English + Telugu (a test fails if any Telugu string is missing) |
| `scripts/bootstrap-owner.mjs` | Creates the first business and owner login |

## Milestone 3 additions
Customers (search by name, mobile, customer number or vehicle number; add/edit), customer page with vehicles (add/edit, insurance status), and a Vehicles search page. Input is normalised (`+91 98765 43210` → `9876543210`, `ap 04 xx-1234` → `AP04XX1234`). Staff without the vehicles permission see records read-only and cannot search by chassis number.
Note: chassis/engine numbers are hidden in the UI for read-only staff, but the database still lets any member of the business read them; true column-level hiding is a later hardening step.

## Milestone 4 additions
- **New loan** (button on each vehicle): enter terms → preview the full schedule → confirm. The server recomputes the schedule; the preview is never trusted.
- **Loan page:** totals (principal, interest, overdue, receivable), schedule with per-instalment status, payments, record payment, reverse payment (with reason). Payments apply to the oldest unpaid instalment first; overpayment is refused.
- **Loans list:** filter All / Active / Overdue / Closed, search by loan number or customer name.
- Processing/other fees are recorded on the loan but are **not** added to instalments; late-payment charges are not built yet.
- `0004_daily_status_refresh.sql` schedules a daily status refresh (needs the pg_cron extension enabled in Supabase).

## Milestone 5 additions
- **Upload** (customer page): take a photo or choose a file; large phone photos are shrunk in the browser. The file goes straight from the browser to the **private** `documents` bucket (path `<business>/<customer>/<document>/<id>-<name>`).
- **Checks before saving:** the real file type is read from the file's bytes (PDF/JPG/PNG only, max 15 MB); the server re-reads the stored file's first bytes and size; an identical file already saved triggers a warning; document, version and related vehicle/loan are registered in one atomic database call (`register_document_upload`).
- **Versions:** replacing a file adds a new version and sends the document back for checking. Old versions stay.
- **Viewing:** every view/download goes through a 60-second signed link and is written to the access log.
- **Review:** staff with `documents.verify` can mark Checked/Rejected. "Checked" is a staff decision, never an AI or legal verification.
- **Expiry:** list filters for Expiring in 30 days / Expired / To check; an insurance document with an expiry date also updates the vehicle's insurance date; dashboard shows documents waiting for checking.
- Not yet: OCR/extraction, mismatch detection and missing-document alerts (Milestone 7).

## Milestone 6 additions
- **Dashboard charts** (last 12 months): money given, collections (net of reversals), overdue at each month-end (replayed from the ledger; the last point is today's live figure), loans by vehicle type, loans by status. Drawn as plain SVG with a hidden data table for screen readers.
- **Reports page:** date range (this month / last month / last 30 days / this financial year Apr–Mar / custom, max 1 year), totals, daily collections, collections list, overdue loans, loans given.
- **Excel export (owner only):** Collections, Overdue loans, Loans given. Real numbers and dates, frozen bold header, total row. Text from users is neutralised so it cannot run as a spreadsheet formula.
- **PDF:** use "Save as PDF / Print" on the Reports page (the browser renders Telugu correctly; the menu and buttons are hidden when printing).
- `0006_reports.sql` also tightens function permissions: nothing is callable by anonymous users.

## Milestone 7 additions (essentials)
- **Passwords:** My account → change password (asks for the current one); "Forgot password?" email link; owner can set a new temporary password for an employee. App rule: at least 10 characters, no trivial or very common passwords.
- **Alerts page** (live, nothing to go stale): overdue loans, instalments due in 7 days, insurance ended/ending, documents expired/expiring, loan files missing required documents, documents to check, follow-ups due. The menu shows a red count of urgent items.
- **Follow-ups:** add from a customer page, a loan page or the Alerts page; assign to a staff member; mark done or cancel. Nothing is deleted.
- **Payments page** for collection staff: overdue loans with a Call button and quick payment entry, instalments due in 7 days, and the day's collections (any past day).
- **Required documents:** the owner chooses which documents every active loan needs (Settings). Missing ones show on the loan page, the Alerts page and the dashboard card "Loan files missing documents". Defaults: RC, insurance, KYC, address proof, loan agreement.
- `0008_essentials.sql` adds this. For password-reset emails, set Supabase → Authentication → URL Configuration (see SETUP.md).

## Milestone 8 additions (daily collection)
- **Daily loans:** new frequency "Daily" (optionally skipping Sundays) and a new method "Fixed instalment" (e.g. ₹600 a day for 100 days; total repayable = instalment × days, interest = the difference). Up to 400 instalments.
- **Daily collection sheet** (Payments → Open collection sheet): one row per borrower with money due: Daily Due, Arrears, Opening Balance, Collected, Closing Balance, Remarks. Type the amounts received and save them all at once (each becomes a normal checked payment; a failed row never blocks the others; a double-click cannot record twice). Print it (columns match the paper register, signature column blank) or, as owner, download it as Excel. Pick any day.
- **Import from Excel** (owner → Import): reads Borrower, Phone, Loan No., Daily Due and Opening/Closing Balance from a sheet like the financier's register (or the downloadable template). Preview first, then import. Customers are reused when name + phone match; each loan gets a placeholder vehicle `PENDING-<loan no>`; re-importing skips loans already imported. Only the current balance is imported (no payment history), and imported balances are kept out of the "money given" figures.
- `0009_daily_collection.sql` adds this.

## Milestone 9 additions (go-live readiness)
- **Sign-in protection:** five wrong passwords for one email (or 30 from one address) pause sign-in for 15 minutes; automatic sign-out after inactivity (`IDLE_MINUTES`, default 60); optional **two-step sign-in** with an authenticator app (My account).
- **Audit log** (owner): who changed what and when, filterable and paged, with readable summaries. Every Excel export and the full data export are recorded there too, and nothing is exported if recording fails.
- **Export all data** (owner, Settings): one Excel file with customers, vehicles, loans, instalments, payments, document details and follow-ups.
- **Security headers:** frame blocking, no-sniff, referrer and permissions policies, HSTS on HTTPS, and a page-content policy that starts in report-only mode (`CSP_ENFORCE=1` to enforce).
- **Platform:** Next.js 16 (clears all known dependency vulnerabilities; `npm audit` reports 0), `/api/health` for uptime monitors, friendly error and not-found pages, one-line error logging.
- **Guides:** `docs/GO-LIVE.md` (accounts, production setup, deployment, backups, monitoring, staff permissions, moving from Excel) and `docs/PILOT-PLAN.md` (4-week pilot, measures, pricing test).
- `0010_hardening.sql` adds the sign-in attempts table and export logging.

## Milestone 10 additions (AI assistant)
- **AI assistant** (menu: AI assistant): ask about the business in plain words (English or Telugu): "how much did we collect this month?", "who is overdue?", "compare this month with last month", "show Ravi's RC", "which insurance has expired?". Every answer shows **how it was worked out** (which lookups, with which dates).
- **Read-only by design:** the model never writes SQL. It can call 12 fixed lookups (`ai_*` database functions, tested), each with checked inputs, run with the signed-in person's own access. All arithmetic is done in the database. Links in answers are checked: only to our own pages and only for records that really came from a lookup. It cannot change records, record payments, send messages or open files.
- **Switched off until the Owner turns it on** (Settings → AI assistant, with a confirmation that questions and the data needed to answer them go to the AI provider). Staff need the new permission "Use the AI assistant"; owners always have it. A per-person daily question limit applies (default 100).
- **Chats are saved** (append-only) with the lookups used and token counts; the Owner can read all chats.
- **Works with Google Gemini (free tier, made-up data only) or Anthropic Claude (paid).** Needs `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` in `.env.local` (see SETUP.md). Optional: `GEMINI_MODEL`, `GEMINI_THINKING` (default low), `GEMINI_FALLBACK_MODEL`, `GEMINI_TIER=paid`, `AI_PROVIDER`, `ANTHROPIC_MODEL`, `ASSISTANT_DAILY_LIMIT`. While on Gemini's free tier the assistant shows a warning banner.
- `docs/AI-DATA-NOTE.md` lists exactly what leaves the system, for you and your lawyer.
- `0011_assistant.sql` adds this.

## Milestone 11 additions (speed and look)
- **Faster pages:** the signed-in user is looked up once per request (cached, read from the signed token), the red Alerts count loads in its own boundary so it never blocks a page, the dashboard streams in sections behind skeleton placeholders, and every screen shows an instant loading state.
- **New look:** one design system in `globals.css` (colours, fonts, cards, buttons, inputs; Noto Sans + Telugu, figures in Source Serif, all self-hosted), grouped sidebar with icons, phone bottom bar with a "More" menu, redesigned dashboard and sign-in page. Other screens already pick up the new colours, fonts, buttons and inputs; they are restyled page by page.

The navigation lists only screens that work. Customers, Loans, Payments, Documents etc. appear as their milestones ship.

## When you set up Supabase (the only manual steps)
1. Create a Supabase project. 2. Run the eleven migration files in order (SQL Editor, or `supabase db push`).
3. Copy `.env.example` to `.env.local` and fill in the project URL, anon key and service-role key (Supabase → Project Settings → API). Never paste them in chat or commit them.
4. Create the first business and owner:  `npm run bootstrap`
5. `npm run dev`, open http://localhost:3000 and sign in.

Not yet verified against a live Supabase project: sign-in, employee creation and the storage policies. Tell me about any error you see and I'll fix it.
