import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Profile } from "./permissions";

/**
 * Current user's active business profile, or redirect to login.
 * Wrapped in React's cache(): the layout and the page both call this, but it runs once per request.
 * The proxy has already validated the session with Supabase on this request, so here the id is read from the
 * signed token (getClaims) instead of paying for a second network round trip.
 */
export const requireProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) redirect("/login");
  const { data } = await supabase.from("profiles").select("id, financier_id, role, full_name, permissions, is_active").eq("id", uid).maybeSingle();
  const p = data as Profile | null;
  if (!p || !p.is_active || p.role === "platform_admin" || !p.financier_id) redirect("/login?error=access");
  return p;
});

export async function requireOwner(): Promise<Profile> {
  const p = await requireProfile();
  if (p.role !== "owner") redirect("/");
  return p;
}
