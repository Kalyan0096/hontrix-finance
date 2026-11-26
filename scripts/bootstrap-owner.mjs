// One-time setup: creates a business (financier) and its first owner login.
// Usage:  npm run bootstrap        (asks four questions; the password is not shown while you type)
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local. Never commit that file.
import readline from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error('NEXT_PUBLIC_SUPABASE_URL in .env.local must look exactly like  https://abcdxyz.supabase.co  (no path after ".co", no quotes, no spaces).');
  console.error(`It currently starts with: ${String(url ?? "(empty)").slice(0, 40)}`);
  process.exit(1);
}
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY is empty in .env.local"); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const name = (await rl.question("Business name (e.g. Test Finance Co): ")).trim();
const email = (await rl.question("Owner email (you will sign in with this): ")).trim();
const fullName = (await rl.question("Owner full name: ")).trim();
rl.close();

// Password: typed keys are not echoed to the screen.
function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let buf = "";
    process.stdout.write(question);
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") { stdin.setRawMode?.(false); stdin.removeListener("data", onData); stdin.pause(); process.stdout.write("\n"); return resolve(buf); }
        if (c === "\u0003") process.exit(1);
        if (c === "\u007f" || c === "\b") buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on("data", onData);
  });
}
const password = (await askHidden("Password (at least 10 characters; nothing shows while you type): ")).trim();

if (name.length < 2) { console.error("Business name is too short."); process.exit(1); }
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error(`"${email}" is not a valid email address. It needs an @, for example you@gmail.com`); process.exit(1); }
if (fullName.length < 2) { console.error("Owner name is too short."); process.exit(1); }
if (password.length < 10) { console.error("Password must be at least 10 characters."); process.exit(1); }

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: fin, error: fErr } = await admin.from("financiers").insert({ name }).select("id").single();
if (fErr) { console.error("Could not create business:", fErr.message); process.exit(1); }
const { data: u, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (uErr) { await admin.from("financiers").delete().eq("id", fin.id); console.error("Could not create user:", uErr.message); process.exit(1); }
const { error: pErr } = await admin.from("profiles").insert({ id: u.user.id, financier_id: fin.id, role: "owner", full_name: fullName });
if (pErr) { await admin.auth.admin.deleteUser(u.user.id); await admin.from("financiers").delete().eq("id", fin.id); console.error("Could not create profile:", pErr.message); process.exit(1); }
console.log(`\nDone. Created "${name}" and owner ${email}. Next: npm run check, then npm run dev`);
