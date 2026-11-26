import { UUID_RE } from "../documents";
import { cleanForModel } from "./tools";
import type { ToolSchema } from "./tools";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown; raw?: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export interface ModelMessage { role: "user" | "assistant"; content: string | Block[] }
export interface ModelResponse { content: Block[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } }
export type CallModel = (req: { system: string; messages: ModelMessage[]; tools: ToolSchema[]; maxTokens: number }) => Promise<ModelResponse>;
export type ToolOutcome = { ok: true; data: unknown } | { ok: false; error: string };
export interface TraceStep { tool: string; input: unknown; ok: boolean; error?: string; method?: string[] }

export interface RunResult { answer: string; trace: TraceStep[]; usage: { input: number; output: number }; stopped: "done" | "max_rounds" }

const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ENTITY_PATH = /^\/(customers|loans|documents)\/([0-9a-f-]{36})$/i;
const STATIC_PATH = /^\/(reports|alerts|payments|payments\/sheet|loans|customers|documents|vehicles)(\?[A-Za-z0-9=&_-]{0,60})?$/;

/** Links in the answer may only go to our own pages, and only to records whose ids really appeared in tool results. */
export function sanitizeLinks(text: string, knownIds: Set<string>): string {
  return text.replace(/\[([^\]]{1,200})\]\(([^)\s]{1,200})\)/g, (_, label: string, url: string) => {
    const e = ENTITY_PATH.exec(url);
    if (e) return knownIds.has(e[2]!.toLowerCase()) ? `[${label}](${url})` : label;
    return STATIC_PATH.test(url) ? `[${label}](${url})` : label;
  });
}

export const MAX_TOOLS_PER_ROUND = 4;

/** Runs one question: the model may call tools (up to maxRounds times); the final text answer is returned with a trace of what was looked up. */
export async function runAssistant(o: {
  system: string; history: { role: "user" | "assistant"; content: string }[]; question: string; tools: ToolSchema[];
  callModel: CallModel; runTool: (name: string, input: unknown) => Promise<ToolOutcome>; maxRounds?: number; maxTokens?: number;
}): Promise<RunResult> {
  const messages: ModelMessage[] = [...o.history.map((h) => ({ role: h.role, content: h.content })), { role: "user", content: o.question }];
  const known = new Set<string>();
  for (const h of o.history) for (const id of h.content.match(UUID_G) ?? []) known.add(id.toLowerCase());
  const trace: TraceStep[] = [];
  const usage = { input: 0, output: 0 };
  const maxRounds = o.maxRounds ?? 6;

  for (let round = 0; round <= maxRounds; round++) {
    const res = await o.callModel({ system: o.system, messages, tools: o.tools, maxTokens: o.maxTokens ?? 1500 });
    usage.input += res.usage?.input_tokens ?? 0; usage.output += res.usage?.output_tokens ?? 0;
    const calls = res.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (calls.length === 0) {
      const text = res.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
      return { answer: sanitizeLinks(text || "—", known), trace, usage, stopped: "done" };
    }
    if (round === maxRounds) break;
    messages.push({ role: "assistant", content: res.content });
    const results: Block[] = [];
    for (const [i, c] of calls.entries()) {
      if (i >= MAX_TOOLS_PER_ROUND) { results.push({ type: "tool_result", tool_use_id: c.id, is_error: true, content: "Too many lookups at once; ask for fewer." }); continue; }
      const out = await o.runTool(c.name, c.input);
      if (out.ok) {
        const clean = cleanForModel(out.data);
        const json = JSON.stringify(clean);
        for (const id of json.match(UUID_G) ?? []) known.add(id.toLowerCase());
        const method = (out.data as { method?: unknown })?.method;
        trace.push({ tool: c.name, input: c.input, ok: true, method: Array.isArray(method) ? method.map(String) : undefined });
        results.push({ type: "tool_result", tool_use_id: c.id, content: json.length > 30000 ? `${json.slice(0, 30000)}…(cut off)` : json });
      } else {
        trace.push({ tool: c.name, input: c.input, ok: false, error: out.error });
        results.push({ type: "tool_result", tool_use_id: c.id, is_error: true, content: out.error });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { answer: "", trace, usage, stopped: "max_rounds" };
}
