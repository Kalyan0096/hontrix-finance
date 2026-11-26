import { AiError } from "./errors";
import type { Block, CallModel, ModelMessage, ModelResponse } from "./loop";
import type { ToolSchema } from "./tools";

type GPart = Record<string, unknown>;
interface GContent { role: "user" | "model"; parts: GPart[] }

/** Gemini's tool schema is a smaller dialect than ours: keep type, description, enum, properties and required (values are checked on our side anyway). */
function schemaFor(s: unknown): unknown {
  if (!s || typeof s !== "object") return s;
  const o = s as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["type", "description", "enum", "required"]) if (o[k] !== undefined) out[k] = o[k];
  if (o.properties && typeof o.properties === "object") out.properties = Object.fromEntries(Object.entries(o.properties as Record<string, unknown>).map(([k, v]) => [k, schemaFor(v)]));
  return out;
}
export const toGeminiTools = (tools: ToolSchema[]) => [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: schemaFor(t.input_schema) })) }];

/** Converts our conversation into Gemini's. The model's own function-call parts are replayed exactly as received, because Gemini 3 and later reject a follow-up that lacks their thought signatures. */
export function toGeminiContents(messages: ModelMessage[]): GContent[] {
  const names = new Map<string, string>();
  const out: GContent[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") { out.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }); continue; }
    const parts: GPart[] = [];
    for (const b of m.content) {
      if (b.type === "text") parts.push({ text: b.text });
      else if (b.type === "tool_use") { names.set(b.id, b.name); parts.push((b.raw as GPart | undefined) ?? { functionCall: { name: b.name, args: b.input ?? {} } }); }
      else {
        let value: unknown = b.content;
        try { value = JSON.parse(b.content); } catch { /* plain text result */ }
        parts.push({ functionResponse: { name: names.get(b.tool_use_id) ?? "unknown", response: b.is_error ? { error: b.content } : { result: value } } });
      }
    }
    out.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  return out;
}

export function parseGeminiResponse(json: any): ModelResponse {
  const cand = json?.candidates?.[0];
  if (!cand) throw new AiError(json?.promptFeedback?.blockReason ? "blocked" : "unknown", "no candidate");
  const blocks: Block[] = [];
  let n = 0;
  for (const part of (cand.content?.parts ?? []) as GPart[]) {
    if (part.functionCall) {
      const fc = part.functionCall as { name: string; args?: unknown };
      blocks.push({ type: "tool_use", id: `call_${n++}_${Math.random().toString(36).slice(2, 8)}`, name: fc.name, input: fc.args ?? {}, raw: part });
    } else if (typeof part.text === "string" && part.thought !== true && part.text) blocks.push({ type: "text", text: part.text });
  }
  const hasCall = blocks.some((b) => b.type === "tool_use");
  if (!hasCall && !blocks.length) {
    const why = String(cand.finishReason ?? "");
    throw new AiError(/SAFETY|RECITATION|PROHIBITED|BLOCKLIST|SPII|IMAGE_SAFETY/.test(why) ? "blocked" : "unknown", why || "empty answer");
  }
  const u = json.usageMetadata ?? {};
  return { content: blocks, stop_reason: hasCall ? "tool_use" : "end_turn", usage: { input_tokens: u.promptTokenCount ?? 0, output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } };
}

export const THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

async function mapError(res: Response): Promise<AiError> {
  let msg = "", gstatus = "", quota = "", retry: number | undefined;
  try {
    const e = (await res.json())?.error ?? {};
    msg = String(e.message ?? ""); gstatus = String(e.status ?? "");
    for (const d of (e.details ?? []) as any[]) {
      if (typeof d?.retryDelay === "string") retry = Number.parseFloat(d.retryDelay);
      for (const v of (d?.violations ?? []) as any[]) quota ||= String(v?.quotaId ?? v?.quotaMetric ?? "");
    }
  } catch { /* no body */ }
  const detail = `HTTP ${res.status} ${gstatus} ${quota}`.trim();
  if (res.status === 429) return new AiError("rate", "rate limited", detail, Number.isFinite(retry) ? retry : undefined, /perday|daily/i.test(quota) || /per day/i.test(msg));
  if (res.status === 503 || res.status >= 500) return new AiError("overloaded", "overloaded", detail);
  if (res.status === 400 && /free tier is not available in your country|location is not supported/i.test(msg)) return new AiError("region", "region", detail);
  if (res.status === 401 || res.status === 403 || /api key not valid|api_key_invalid|permission denied/i.test(msg)) return new AiError("auth", "auth", detail);
  if (res.status === 404 || /not found|is not supported for generatecontent/i.test(msg)) return new AiError("model", "model not found", detail);
  return new AiError("bad_request", /thinking/i.test(msg) ? "thinking setting rejected" : "bad request", detail);
}

export interface GeminiOptions { thinking?: ThinkingLevel | null; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }

/**
 * Calls the Gemini API (generateContent) with function calling. Retry rules follow Google's guidance: only for busy/rate-limit errors,
 * waiting the delay Google asks for, and not at all when the daily quota is used up. Never logs prompts or answers.
 */
export function makeGeminiCaller(apiKey: string, model: string, opts: GeminiOptions | typeof fetch = {}, sleepArg?: (ms: number) => Promise<void>): CallModel {
  const o: GeminiOptions = typeof opts === "function" ? { fetchImpl: opts, sleep: sleepArg } : opts;
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async ({ system, messages, tools, maxTokens }) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let thinking = o.thinking ?? null;
    let retried = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST", signal: AbortSignal.timeout(45_000),
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          // Thinking models count their reasoning toward the output limit, so Gemini gets a larger allowance than the answer itself needs.
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: toGeminiContents(messages), tools: toGeminiTools(tools),
            generationConfig: { maxOutputTokens: Math.max(maxTokens, 4096), ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}) } }),
        });
      } catch (e) {
        const timedOut = (e as { name?: string })?.name === "TimeoutError" || (e as { name?: string })?.name === "AbortError";
        throw new AiError(timedOut ? "timeout" : "network", timedOut ? "timed out" : "network error");
      }
      if (res.ok) return parseGeminiResponse(await res.json());
      const err = await mapError(res);
      if (err.message === "thinking setting rejected" && thinking) { thinking = null; continue; }   // this model does not take that setting: ask again without it
      if (retried) throw err;
      if (err.code === "rate" && !err.daily && (err.retryAfterSec ?? 5) <= 20) { retried = true; await sleep(Math.ceil((err.retryAfterSec ?? 5) * 1000) + 500); continue; }
      if (err.code === "overloaded") { retried = true; await sleep(3000); continue; }
      throw err;
    }
    throw new AiError("unknown", "no response");
  };
}
