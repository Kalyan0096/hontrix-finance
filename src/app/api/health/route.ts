import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** For uptime monitors: 200 when the app can reach its database, 503 otherwise. Reveals nothing else. */
export async function GET() {
  try {
    const { error } = await createAdminClient().from("financiers").select("id", { head: true }).limit(1);
    if (error) throw error;
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
