"use server";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { validatePassword } from "@/lib/password";
import { isTotpCode } from "@/lib/security";

export async function changePassword(f: FormData) {
  await requireProfile();
  const current = String(f.get("current") ?? ""), pw = String(f.get("password") ?? "");
  const bad = validatePassword(pw, String(f.get("confirm") ?? ""));
  if (bad) redirect(`/account?err=${bad}`);
  if (pw === current) redirect("/account?err=err.passwordSame");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: current }); // proves the person at the keyboard knows the old password
  if (authErr) redirect("/account?err=err.wrongCurrent");
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) redirect("/account?err=err.generic");
  await supabase.auth.signOut({ scope: "others" });
  redirect("/account?ok=auth.passwordChanged");
}

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Starts two-step setup: returns a QR code (an SVG image) and the key to type in manually. Old unfinished attempts are cleared first. */
export async function enrollTotp(): Promise<Res<{ factorId: string; qr: string; secret: string }>> {
  await requireProfile();
  const supabase = await createClient();
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16)}` });
  if (error || !data) return { ok: false, error: "err.mfaOff" };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyTotpEnrollment(factorId: string, code: string): Promise<Res> {
  await requireProfile();
  if (!isTotpCode(code) || typeof factorId !== "string") return { ok: false, error: "err.mfaCode" };
  const supabase = await createClient();
  const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
  if (cErr || !ch) return { ok: false, error: "err.mfaCode" };
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
  return error ? { ok: false, error: "err.mfaCode" } : { ok: true };
}

export async function disableTotp(factorId: string): Promise<Res> {
  await requireProfile();
  const { error } = await (await createClient()).auth.mfa.unenroll({ factorId });
  return error ? { ok: false, error: "err.generic" } : { ok: true };
}
