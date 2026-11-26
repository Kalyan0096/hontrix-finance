import { createBrowserClient } from "@supabase/ssr";

/** Browser client: carries the signed-in user's session, so storage and database rules apply to every call. */
export const createClient = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
