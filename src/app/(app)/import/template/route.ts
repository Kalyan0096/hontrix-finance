import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildWorkbook } from "@/lib/excel";

/** A blank file with the headings the importer understands, plus two made-up example rows. Owner only. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (!me || !me.is_active || me.role !== "owner") return new NextResponse("Only the owner can use this", { status: 403 });
  const heads = ["S. No.", "Borrower", "Phone", "Loan No.", "Daily Due (₹)", "Opening Balance (₹)", "Collected Today (₹)", "Closing Balance (₹)", "Signature / Mark", "Remarks"];
  const buf = await buildWorkbook("Collection sheet", heads.map((h, i) => ({ header: h, width: i === 1 ? 26 : 16 })),
    [[1, "Example Borrower One", "9876500001", "D-001", 600, 5400, 600, 4800, "", "example row: delete me"], [2, "Example Borrower Two", "9876500002", "D-002", 300, 2000, 0, 2000, "", "example row: delete me"]]);
  return new NextResponse(buf, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="import_template.xlsx"', "Cache-Control": "no-store" } });
}
