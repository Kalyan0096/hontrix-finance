import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { idleLimitMinutes, isIdle } from "@/lib/security";

const SEEN = "vf_seen";

/** Runs on every request: refreshes the session, signs out idle users, and sends signed-in users who turned on two-step sign-in to enter their code. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser(); // validates the token with Supabase
  const path = request.nextUrl.pathname;
  const isLogin = path.startsWith("/login");
  const isMfaPage = path === "/login/mfa";
  const isPublic = isLogin || path.startsWith("/forgot-password") || path.startsWith("/auth/") || path === "/api/health";
  const go = (to: string) => { const r = NextResponse.redirect(new URL(to, request.url)); response.cookies.getAll().forEach((c) => r.cookies.set(c)); return r; };

  if (!user) return isPublic ? response : go("/login");

  const now = Date.now();
  const seenRaw = request.cookies.get(SEEN)?.value;
  const seen = seenRaw ? Number(seenRaw) : null;
  if (isIdle(seen, now, idleLimitMinutes(process.env.IDLE_MINUTES))) {
    await supabase.auth.signOut();
    const r = go("/login?error=idle");
    r.cookies.delete(SEEN);
    return r;
  }
  if (seen === null || now - seen > 60_000) {
    response.cookies.set(SEEN, String(now), { httpOnly: true, sameSite: "lax", path: "/", secure: request.nextUrl.protocol === "https:", maxAge: 60 * 60 * 24 * 30 });
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsMfa = aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2";
  if (needsMfa && !isMfaPage && !path.startsWith("/auth/") && path !== "/api/health") return go("/login/mfa");
  if (!needsMfa && isMfaPage) return go("/");
  if (isLogin && !isMfaPage && !request.nextUrl.searchParams.has("error")) return go("/");
  return response;
}
