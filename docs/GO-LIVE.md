# Go-live guide

Do these in order. Nothing here is needed to keep testing on your own computer with made-up data. It is needed before **any real customer data** goes in.
Prices and plan limits change, so check each provider's current page before you pay.

## 0. Before you start (decisions, not code)
- [ ] The financier agrees to a pilot (see `PILOT-PLAN.md`).
- [ ] A lawyer who knows Indian financial services has answered: is the financier RBI-regulated, what the DPDP Act requires for customer data, and what the privacy notice must say. **Until then, use fictional data.**
- [ ] You know who in the business will be Owner, and who needs which permission (section 8).

## 1. Accounts you will need
| For | Why | Notes |
|---|---|---|
| **GitHub** | stores the code privately | Create a *private* repository. Never upload `.env.local`. |
| **Vercel** (or another host for Next.js) | runs the website over HTTPS | The free "Hobby" plan is not meant for commercial use, so check current terms and use a paid plan for the pilot. |
| **Supabase, paid plan** | database + login + file storage | The free plan pauses inactive projects and does not give the backups a finance business needs. Check what the paid plan's backups cover. |
| **A domain name** | a proper address such as `app.yourcompany.in` | Buy from any registrar. |
| **Email sending service** | password-reset emails | Supabase's built-in sender allows only a few emails an hour. Pick a service with good delivery in India. |
| **Uptime monitor** (free tiers exist) | tells you when the site is down | Point it at `https://your-domain/api/health`. |

## 2. Create the production Supabase project
Use a **new** project (not your test one), region Mumbai.
1. SQL Editor → paste and run `supabase/all-migrations.sql` once.
2. Authentication → Sign In / Providers: turn **off** "Allow new users to sign up". Set the minimum password length to 10.
3. Authentication → Multi-Factor: make sure **TOTP** is enabled (owners will use it).
4. Authentication → URL Configuration: Site URL = `https://your-domain`; Redirect URLs = `https://your-domain/**`.
5. Authentication → Emails → SMTP: enter your email service's details so reset emails are reliable.
6. Storage: confirm the `documents` bucket exists and is **Private**.
7. Locally, point `.env.local` at the new project, run `npm run check`, then `npm run bootstrap` to create the Owner.

## 3. Deploy the website
1. Push the code to your private GitHub repository.
2. In Vercel: import the repository. Add these environment variables (never in the code):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (mark it sensitive)
   - optional: `IDLE_MINUTES` (sign-out after inactivity, default 60)
3. Choose the region nearest Mumbai if offered, then deploy.
4. Add your domain in Vercel and follow its DNS instructions. HTTPS is automatic.
5. Open `https://your-domain/api/health`. It should show `{"status":"ok"}`.

## 4. Check it live
- [ ] Sign in as Owner, then work through `TEST-CHECKLIST.md` on the live site with fictional data (phone camera upload works now, because the site is on HTTPS).
- [ ] Browser developer tools → Console: look for messages starting "Content Security Policy". If there are none, set the environment variable `CSP_ENFORCE=1` in Vercel and redeploy. If there are some, send them to me.
- [ ] Owner → My account → set up **two-step sign-in** on the Owner's phone.
- [ ] Try five wrong passwords for one email → the sixth attempt shows the "too many attempts" message.

## 5. Backups
- [ ] Confirm in Supabase what the paid plan backs up and how long it keeps it.
- [ ] Do a **restore drill** once: restore a backup into a new empty project and sign in. A backup you have never restored is only a hope.
- [ ] Uploaded files (RC, insurance, agreements) live in Storage. Check whether your plan's backups include them; if not, plan a periodic copy of the `documents` bucket.
- [ ] Owner → Settings → **Download Excel export** once a month and keep it somewhere safe. It is a convenience copy of the data, not a replacement for database backups.

## 6. Monitoring
- [ ] Uptime monitor on `/api/health`, emailing the Owner and you.
- [ ] Know where the logs are: Vercel (website errors) and Supabase (database and login). Website errors are written as one line each with no personal data.
- [ ] Owner checks **Audit log** weekly during the pilot: unexpected deletes, exports or changes to staff accounts.

## 7. Security checklist
| Item | Where |
|---|---|
| No signing up by strangers | Supabase setting (section 2) |
| Passwords of 10+ characters; weak ones refused | built in |
| Sign-in pauses after repeated failures | built in (needs migration 0010) |
| Automatic sign-out after inactivity | built in (`IDLE_MINUTES`) |
| Two-step sign-in for the Owner | My account |
| Staff only see what they are permitted to | built in, tested |
| Files private, links expire in 60 seconds, every view logged | built in |
| Every export is recorded in the audit log | built in |
| HTTPS everywhere, security headers | built in + Vercel |
| Page-content policy | starts in report-only mode, then `CSP_ENFORCE=1` |
| Dependencies free of known vulnerabilities | checked with `npm audit` (0 found); re-check before each release |

## 8. Staff and permissions
Suggested starting set (Owner can change any time under Employees):
| Person | Tick |
|---|---|
| Collector | Record payments |
| Office staff | Customers, vehicles, loans, documents upload, record payments |
| Accountant / manager | all of the above + Verify documents. Keep "Reverse payments" with the Owner. |
- One login per person. Never share logins.
- If a phone is lost or someone leaves: Employees → switch the account off (immediate), then reset the password.
- If you suspect a password leaked: reset it, then read the Audit log for that person's recent actions.

## 9. Moving from Excel
1. Keep the paper/Excel sheet running **in parallel** for two weeks.
2. Pick a clean day. Owner → Import: load the current balances from the sheet.
3. Each day, enter collections in the app and compare each borrower's closing balance with the paper sheet. Fix differences the same day.
4. When five working days in a row match, make the app the main record and stop the parallel sheet.

## 10. Costs to plan for
Hosting, the paid database plan, the domain, the email service, and later an AI or OCR service charged by use. Get current prices from each provider and decide who pays.

## 11. The AI assistant and what comes next
The AI assistant is built but stays switched off until the Owner turns it on. It sends questions and looked-up business data to an outside AI service, so settle the points in `docs/AI-DATA-NOTE.md` with your lawyer **before** switching it on with real data. Document reading (OCR) and the borrower website come after the pilot; OCR sends document images to an outside service, so it needs the same decision.
