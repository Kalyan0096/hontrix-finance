"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isTotpCode } from "@/lib/security";

/** Second step of sign-in: checks the 6-digit code from the authenticator app. */
export async function verifyLoginCode(f: FormData) {
  const code = String(f.get("code") ?? "").trim();
  if (!isTotpCode(code)) redirect("/login/mfa?err=err.mfaCode");
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) redirect("/");
  const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (cErr || !challenge) redirect("/login/mfa?err=err.mfaCode");
  const { error } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code });
  if (error) redirect("/login/mfa?err=err.mfaCode");
  redirect("/");
}
