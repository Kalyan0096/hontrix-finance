import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLang, getT } from "@/lib/i18n";
import { messages } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { UUID_RE } from "@/lib/documents";
import { isAssistantEnabled } from "@/lib/ai/config";
import { getProvider } from "@/lib/ai/provider";
import type { TraceStep } from "@/lib/ai/loop";
import { AssistantChat, type ChatLabels, type ChatMsg } from "./chat";

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const profile = await requireProfile();
  const { t } = await getT();
  const lang = await getLang();
  const m = messages[lang];
  const sp = await searchParams;
  const head = <><h1 className="mb-2 text-2xl font-bold">{t("ai.title")}</h1><p className="mb-6 max-w-2xl text-ink-soft">{t("ai.help")}</p></>;
  if (!can(profile, "assistant.use")) return <>{head}<p className="text-ink-soft">{t("ai.noPerm")}</p></>;

  const supabase = await createClient();
  const { data: setting } = await supabase.from("business_settings").select("value").eq("key", "ai_assistant").maybeSingle();
  if (!isAssistantEnabled(setting?.value)) return <>{head}<p className="text-ink-soft">{t("ai.off")}</p>{profile.role === "owner" && <p className="mt-3"><Link className="underline" href="/settings">{t("nav.settings")}</Link></p>}</>;
  const provider = getProvider();
  if (!provider) return <>{head}<p className="rounded-md border border-warn bg-card p-4 text-warn">{t("ai.noKey")}</p></>;

  const cid = sp.c && UUID_RE.test(sp.c) ? sp.c : null;
  const [{ data: convs }, { data: msgs }] = await Promise.all([
    supabase.from("chat_conversations").select("id, title, updated_at").eq("user_id", profile.id).order("updated_at", { ascending: false }).limit(12),
    cid ? supabase.from("chat_messages").select("role, content, tool_trace").eq("conversation_id", cid).eq("user_id", profile.id).order("created_at") : Promise.resolve({ data: [] }),
  ]);
  const initial: ChatMsg[] = (msgs ?? []).map((x) => ({ role: x.role as "user" | "assistant", content: String(x.content), trace: (x.tool_trace as TraceStep[] | null) ?? null }));
  const labels: ChatLabels = {
    placeholder: m["ai.placeholder"], send: m["ai.send"], thinking: m["ai.thinking"], how: m["ai.how"], lookedUp: m["ai.lookedUp"], you: m["ai.you"], assistant: m["ai.assistant"], left: m["ai.left"], slow: m["ai.slow"], disclaimer: m["ai.disclaimer"],
    errors: Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith("ai.err."))), suggestions: [m["ai.s1"], m["ai.s2"], m["ai.s3"], m["ai.s4"], m["ai.s5"]],
  };
  return (
    <>
      {head}
      {provider.freeTier && provider.name === "gemini" && <p role="note" className="mb-4 max-w-2xl rounded-md border border-warn bg-card p-3 text-warn">{t("ai.freeBanner")}</p>}
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div><AssistantChat key={cid ?? "new"} initial={initial} conversationId={cid} labels={labels} /></div>
        <aside className="order-first lg:order-last">
          <Link href="/assistant" className="btn mb-4 inline-flex w-full items-center justify-center">{t("ai.new")}</Link>
          <h2 className="mb-2 font-semibold">{t("ai.recent")}</h2>
          {(convs ?? []).length === 0 ? <p className="text-sm text-ink-soft">{t("ai.none")}</p> : (
            <ul className="divide-y divide-line border-y border-line bg-card">{(convs ?? []).map((c) => (
              <li key={c.id}><Link href={`/assistant?c=${c.id}`} className={`block px-3 py-2 text-sm hover:bg-paper ${c.id === cid ? "font-semibold" : ""}`}>{String(c.title).slice(0, 60) || "…"}</Link></li>))}</ul>)}
        </aside>
      </div>
    </>
  );
}
