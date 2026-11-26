"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validatePassword } from "@/lib/password";

export async function completeReset(f: FormData) {
  const jar = await cookies();
  if (!jar.get("pw_recovery")) redirect("/forgot-password?err=expired");
  const pw = String(f.get("password") ?? "");
  const bad = validatePassword(pw, String(f.get("confirm") ?? ""));
  if (bad) redirect(`/reset-password?err=${bad}`);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) redirect("/reset-password?err=err.generic");
  await supabase.auth.signOut({ scope: "others" });
  jar.delete("pw_recovery");
  redirect("/account?ok=auth.passwordChanged");
}
