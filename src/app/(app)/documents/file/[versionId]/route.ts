import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/documents";

/** Opens a document through a 60-second signed link, after the database confirms the caller may see it, and logs the access. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !UUID_RE.test(versionId)) return new NextResponse("Not found", { status: 404 });
  const { data: v } = await supabase.from("document_versions").select("id, document_id, storage_path, file_name").eq("id", versionId).maybeSingle(); // RLS: own business only
  if (!v) return new NextResponse("Not found", { status: 404 });
  const download = req.nextUrl.searchParams.get("download") === "1";
  const { data: signed } = await supabase.storage.from("documents").createSignedUrl(v.storage_path, 60, download ? { download: v.file_name ?? true } : undefined);
  if (!signed) return new NextResponse("Not found", { status: 404 });
  await supabase.rpc("log_document_access", { p_document_id: v.document_id, p_version_id: v.id, p_action: download ? "download" : "preview" });
  const res = NextResponse.redirect(signed.signedUrl, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
