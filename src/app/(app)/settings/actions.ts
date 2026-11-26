"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_CATEGORIES } from "@/lib/documents";

export async function saveRequiredDocuments(f: FormData) {
  const owner = await requireOwner();
  const supabase = await createClient(); // owner-only by row-level security as well
  const want = new Set(DOCUMENT_CATEGORIES.filter((c) => f.get(c) === "on"));
  const { data, error } = await supabase.from("required_document_rules").select("category");
  if (error) redirect("/settings?err=err.generic");
  const have = new Set((data ?? []).map((r) => r.category as string));
  const add = [...want].filter((c) => !have.has(c)), remove = [...have].filter((c) => !want.has(c as never));
  if (add.length) { const { error: e } = await supabase.from("required_document_rules").insert(add.map((category) => ({ financier_id: owner.financier_id, category }))); if (e) redirect("/settings?err=err.generic"); }
  if (remove.length) { const { error: e } = await supabase.from("required_document_rules").delete().in("category", remove); if (e) redirect("/settings?err=err.generic"); }
  revalidatePath("/settings"); revalidatePath("/");
  redirect("/settings?ok=set.saved");
}

/** Owner switches the AI assistant on or off. Switching on records who confirmed that questions and the data needed to answer them go to the AI provider. */
export async function saveAssistantSetting(f: FormData) {
  const owner = await requireOwner();
  const enable = f.get("enabled") === "on";
  if (enable && f.get("consent") !== "on") redirect("/settings?err=err.consent");
  const value = enable ? { enabled: true, acknowledged_by: owner.id, acknowledged_at: new Date().toISOString() } : { enabled: false };
  const { error } = await (await createClient()).from("business_settings").upsert({ financier_id: owner.financier_id, key: "ai_assistant", value, updated_at: new Date().toISOString() }, { onConflict: "financier_id,key" });
  if (error) redirect("/settings?err=err.generic");
  revalidatePath("/settings"); revalidatePath("/assistant");
  redirect("/settings?ok=set.ai.saved");
}
