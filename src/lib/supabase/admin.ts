import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Service-role client. Bypasses RLS. Only import from server actions/route handlers, after checking the caller's role. */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
