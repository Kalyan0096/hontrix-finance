"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { LANGS } from "@/lib/i18n/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOGIN_WINDOW_MINUTES, clientIp, hashEmail, isLockedOut } from "@/lib/security";

export async function setLanguage(formData: FormData) {
  const lang = String(formData.get("lang"));
  if (LANGS.includes(lang as never)) (await cookies()).set("lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

/** Signs in with email and password. Repeated failures for one email or one address pause sign-in for a while. */
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const h = await headers();
  const ip = clientIp(h.get("x-forwarded-for"), h.get("x-real-ip"));
  const emailHash = hashEmail(email);
  const admin = createAdminClient();
  let locked = false;
  try {
    const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000).toISOString();
    const [byEmail, byIp] = await Promise.all([
      admin.from("login_attempts").select("id", { head: true, count: "exact" }).eq("email_hash", emailHash).eq("success", false).gte("created_at", since),
      ip ? admin.from("login_attempts").select("id", { head: true, count: "exact" }).eq("ip", ip).eq("success", false).gte("created_at", since) : Promise.resolve({ count: 0 }),
    ]);
    locked = isLockedOut(byEmail.count ?? 0, byIp.count ?? 0);
  } catch { /* if the throttle table cannot be read, sign-in still works */ }
  if (locked) redirect("/login?error=locked");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: String(formData.get("password") ?? "") });
  try {
    if (error) {
      await admin.from("login_attempts").insert({ email_hash: emailHash, ip, success: false });
      if (Math.random() < 0.02) await admin.from("login_attempts").delete().lt("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString());
    } else {
      await admin.from("login_attempts").delete().eq("email_hash", emailHash);
    }
  } catch { /* bookkeeping only */ }
  if (error) redirect("/login?error=bad");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
