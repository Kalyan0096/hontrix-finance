"use server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { todayIST } from "@/lib/finance";
import { friendlyDbError, toolSchemas, validateToolCall } from "@/lib/ai/tools";
import { getLang } from "@/lib/i18n";
import { messages } from "@/lib/i18n/messages";
import { buildSystemPrompt } from "@/lib/ai/prompt";
import { runAssistant, type ToolOutcome, type TraceStep } from "@/lib/ai/loop";
import { AiError } from "@/lib/ai/errors";
import { getProvider } from "@/lib/ai/provider";
import { assistantDailyLimit, isAssistantEnabled } from "@/lib/ai/config";
import { UUID_RE } from "@/lib/documents";

export type AskResult = { ok: true; conversationId: string; answer: string; trace: TraceStep[]; remaining: number } | { ok: false; error: string };

/** Answers one question. The assistant only reads: every lookup is a fixed database function run with the signed-in person's own access. */
export async function askAssistant(input: { conversationId: string | null; question: string }): Promise<AskResult> {
  const profile = await requireProfile();
  const question = String(input?.question ?? "").trim();
  if (!question) return { ok: false, error: "ai.err.empty" };
  if (question.length > 2000) return { ok: false, error: "ai.err.long" };
  if (!can(profile, "assistant.use")) return { ok: false, error: "ai.err.noPerm" };
  const provider = getProvider();
  if (!provider) return { ok: false, error: "ai.err.generic" };

  const supabase = await createClient();
  const { data: setting } = await supabase.from("business_settings").select("value").eq("key", "ai_assistant").maybeSingle();
  if (!isAssistantEnabled(setting?.value)) return { ok: false, error: "ai.err.off" };

  const limit = assistantDailyLimit(process.env.ASSISTANT_DAILY_LIMIT);
  const { data: used } = await supabase.rpc("ai_questions_today");
  if (Number(used ?? 0) >= limit) return { ok: false, error: "ai.err.limit" };

  let conversationId = input.conversationId && UUID_RE.test(input.conversationId) ? input.conversationId : null;
  if (conversationId) {
    const { data: c } = await supabase.from("chat_conversations").select("id").eq("id", conversationId).eq("user_id", profile.id).maybeSingle();
    if (!c) conversationId = null;
  }
  if (!conversationId) {
    const { data: c, error } = await supabase.from("chat_conversations").insert({ title: question.slice(0, 60) }).select("id").single();
    if (error || !c) return { ok: false, error: "ai.err.noPerm" };
    conversationId = c.id as string;
  }
  const { data: past } = await supabase.from("chat_messages").select("role, content").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(12);
  const history = (past ?? []).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 4000) }));
  // The question is saved first, so it counts toward the daily limit even if the AI service fails.
  const { error: insErr } = await supabase.from("chat_messages").insert({ conversation_id: conversationId, role: "user", content: question });
  if (insErr) return { ok: false, error: "ai.err.noPerm" };

  const { data: fin } = await supabase.from("financiers").select("name").maybeSingle();
  const lang = await getLang();
  const model = provider.model;
  const runTool = async (name: string, toolInput: unknown): Promise<ToolOutcome> => {
    const v = validateToolCall(name, toolInput);
    if (!v.ok) return { ok: false, error: v.error };
    const { data, error } = await supabase.rpc(v.rpc, v.params);
    return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true, data };
  };

  try {
    const r = await runAssistant({
      system: buildSystemPrompt({ today: todayIST(), userName: profile.full_name, role: profile.role, lang, businessName: fin?.name ?? "this business" }),
      history, question, tools: toolSchemas(), callModel: provider.callModel, runTool,
    });
    const text = r.stopped === "max_rounds" || !r.answer ? messages[lang]["ai.err.rounds"] : r.answer;
    await supabase.from("chat_messages").insert({ conversation_id: conversationId, role: "assistant", content: text, tool_trace: r.trace, model, input_tokens: r.usage.input, output_tokens: r.usage.output });
    await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    return { ok: true, conversationId, answer: text, trace: r.trace, remaining: Math.max(0, limit - Number(used ?? 0) - 1) };
  } catch (e) {
    const code = e instanceof AiError ? e.code : "unknown";
    console.error(JSON.stringify({ level: "error", where: "assistant", provider: provider.name, model: provider.model, code, detail: e instanceof AiError ? e.detail : undefined })); // status and quota names only; no question, answer or key is logged
    return { ok: false, error: code === "auth" ? "ai.err.auth" : code === "rate" && e instanceof AiError && e.daily ? "ai.err.daily" : code === "rate" || code === "overloaded" ? "ai.err.rate" : code === "timeout" ? "ai.err.timeout" : code === "blocked" ? "ai.err.blocked" : code === "model" ? "ai.err.model" : code === "region" ? "ai.err.region" : "ai.err.generic" };
  }
}
