"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requestReset(f: FormData) {
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    // The same answer is shown whether or not the email has an account, so the form cannot be used to find out who is registered.
    await (await createClient()).auth.resetPasswordForEmail(email, { redirectTo: `${proto}://${host}/auth/callback` });
  }
  redirect("/forgot-password?sent=1");
}
