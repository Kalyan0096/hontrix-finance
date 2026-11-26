import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Landing point of the password-reset email link. Exchanges the one-time code for a short session, then asks for a new password. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
    if (!error) {
      const res = NextResponse.redirect(new URL("/reset-password", req.url));
      res.cookies.set("pw_recovery", "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 900, secure: req.nextUrl.protocol === "https:" });
      return res;
    }
  }
  return NextResponse.redirect(new URL("/forgot-password?err=expired", req.url));
}
