# Setup guide — first run (about 30 minutes)

You need: a computer (Windows, Mac or Linux), internet, and an email address. Everything here is free.
**Never paste passwords or keys into a chat.** If something fails, copy only the error *message* and send that.

## A. Install the tools (once)
1. Install **Node.js version 22 or newer** (the "LTS" button; Node 20 is too old) from https://nodejs.org . Accept the defaults.
2. Unzip `the latest Hontrix-PDTR zip` (or the latest zip). You get a folder called `Hontrix-PDTR`.
3. Open a terminal **inside that folder**:
   - Windows: open the folder, click the address bar, type `cmd`, press Enter.
   - Mac: right-click the folder → "New Terminal at Folder".
4. Run: `npm install`   (takes a minute or two)
5. Check it works: `npm test`  → should end with "Tests 71 passed".

## B. Create the Supabase project
1. Go to https://supabase.com → sign up → **New project**.
2. Name: `vehicle-finance-test`. Region: **Mumbai (ap-south-1)** if offered (closest to Kadapa). Set a database password and save it somewhere safe (the app does not need it).
3. Wait until the project finishes creating (1–2 minutes).

## C. Create the database
1. In Supabase, left menu → **SQL Editor** → **New query**.
2. Open the file `supabase/all-migrations.sql` from the folder in a text editor, select all, copy.
3. Paste into the SQL Editor and press **Run**.
4. You should see "Success". Notices about `pg_cron` are fine (see "Optional" below).
   - If you see a red error: copy the message and send it to me. Then, **only on this brand-new test project**, you can run `supabase/reset-dev.sql` to wipe it and try again.

## D. Lock the door against strangers
Supabase → **Authentication** → **Sign In / Providers** (or "Providers" → Email) → turn **OFF** "Allow new users to sign up". Save.
(Only the owner will create logins, from inside the app.)

## E. Connect the app
1. Supabase → **Project Settings** → **API** (or "API Keys").
2. In the app folder, copy `.env.example` to a new file named `.env.local` (same folder).
3. Fill in the three values:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the **anon** key (or "publishable" key)
   - `SUPABASE_SERVICE_ROLE_KEY` = the **service_role** key (or "secret" key). **Private. Never share, never commit.**
4. Run the checker: `npm run check`
   It prints ✓ or ✗ for each item with what to fix. Repeat until it says "All checks passed" (the last item, "First owner", will fail until step F).

## F. Create your owner login
Run (replace the values; the password needs 10+ characters):
```
npm run bootstrap
```
Then `npm run check` again — everything should pass.

## G. Start the app
`npm run dev` → open http://localhost:3000 → sign in with the owner email and password.
Stop it any time with Ctrl+C.

## Then test
Open `TEST-CHECKLIST.md` and tick through it. Send me anything that doesn't behave as described, with the exact message you saw.

## Optional (later)
- **Daily overdue refresh:** Supabase → Database → Extensions → enable `pg_cron`, then run `supabase/migrations/0004_daily_status_refresh.sql` once in the SQL Editor. The app shows overdue correctly without it; this keeps stored statuses in step.
- **Phone testing:** with `npm run dev` running, open `http://<your-computer's-IP>:3000` on a phone on the same Wi-Fi. (Camera upload on phones may need HTTPS, which you get once the app is deployed.)
- **Deploying online** (Vercel) comes after testing.

## Use fictional data only
Use made-up names, numbers (e.g. mobile 9876500001) and documents until the legal and privacy checks in the project blueprint are complete.


## Updating to a newer version of the app
1. Rename your old `Hontrix-PDTR` folder to `Hontrix-PDTR-old`. Unzip the new zip next to it.
2. Copy the file **`.env.local`** from the old folder into the new one. (It is hidden: in Finder press Cmd + Shift + . to show hidden files.)
3. In the new folder run `npm install`, then `npm test`.
4. If the update says a new database file is needed (for example `0010_hardening.sql`; if you skipped one earlier, run them in number order), open **only that file** from `supabase/migrations`, copy it, and run it in the Supabase SQL Editor. Do **not** run `all-migrations.sql` again on a project that already has data.
5. `npm run check`, then `npm run dev`.

## Password-reset emails (one-time Supabase setting)
Supabase → **Authentication** → **URL Configuration**:
- **Site URL:** `http://localhost:3000`
- **Redirect URLs:** add `http://localhost:3000/**`
Supabase's built-in email sender is limited to a few emails per hour, which is fine for testing. A real email service is needed before going live.


## The AI assistant (optional, needs its own key)
You can use **Google Gemini** (has a free tier) or **Anthropic Claude** (paid). Use one.

### Option A: Google Gemini (free tier, for testing with made-up data)
1. Go to Google AI Studio (aistudio.google.com), sign in with a Google account, and create an API key.
2. Put it in `.env.local` (never in chat or code):
   ```
   GEMINI_API_KEY=your-key-here
   ```
   Optional: `GEMINI_MODEL=` to choose another model (the default is `gemini-3.1-flash-lite`, which has much larger free limits than `gemini-3.8-flash`; model names change, so if you see "model name is not available", pick a current Flash model from AI Studio's model list).
3. **Free tier = made-up data only.** Under Google's terms for unpaid use, Google may use what you send to improve its products, and its staff may read it. The assistant shows a warning banner while it is in this mode. Do **not** put real customer data through it.
4. For real data later: switch on billing for the Google project (Google's terms say that once billing is active, use counts as a paid service for data purposes even within the free quota; read the current terms to confirm), then add `GEMINI_TIER=paid` to `.env.local` to remove the banner.
5. The free tier has small limits (requests per minute, tokens per minute, and requests per day), set per model and per project. One question uses 2 to 4 requests. Your own limits are shown in Google AI Studio (the usage / rate-limit page).
6. Gemini 3 models "think" before answering, which is slow. The app asks for low thinking by default (`GEMINI_THINKING=low`; other values: minimal, medium, high, or none). If the main model is busy or over its limit, the app automatically tries a second model (`GEMINI_FALLBACK_MODEL`, default `gemini-3.8-flash`; set `none` to switch this off).

**If answers are slow or you see "the AI service is busy":** look at the black terminal window where `npm run dev` runs. Each failure prints one line starting `{"level":"error","where":"assistant"...` with a `code` and a `detail` such as `HTTP 429 RESOURCE_EXHAUSTED ...PerDay...` (daily limit used up) or `HTTP 503 UNAVAILABLE` (Google is out of capacity). It contains no questions, answers or keys, so it is safe to send to me. `HTTP 503 UNAVAILABLE` means Google's model is out of capacity (nothing to do with your limits); the app already retries and tries the backup model, and the log shows what both said. Wait a minute and ask again.

### Option B: Anthropic Claude (paid)
1. Create an account at the Anthropic Console (console.anthropic.com), add billing, create an API key.
2. `.env.local`: `ANTHROPIC_API_KEY=your-key-here`
3. If both keys exist, choose with `AI_PROVIDER=gemini` or `AI_PROVIDER=anthropic`.

### Then, for either option
1. Run `0011_assistant.sql` in the Supabase SQL Editor (only that file), restart `npm run dev`, run `npm run check` (it says which service will be used).
2. Owner → Settings → **AI assistant** → tick both boxes → Save.
3. Employees who may use it need the permission "Use the AI assistant" (Employees page).
4. Read `docs/AI-DATA-NOTE.md` first, and use made-up data until the questions in it are answered.
