import { describe, expect, it } from "vitest";
import { AiError } from "../src/lib/ai/errors";
import { makeGeminiCaller, parseGeminiResponse, toGeminiContents, toGeminiTools } from "../src/lib/ai/gemini";
import { runAssistant, type ModelMessage } from "../src/lib/ai/loop";
import { chooseProvider, geminiModel, getProvider, DEFAULT_GEMINI_MODEL } from "../src/lib/ai/provider";
import { toolSchemas } from "../src/lib/ai/tools";

const SIG = "c2lnbmF0dXJl";
const callPart = { functionCall: { name: "overdue_loans", args: { limit: 5 } }, thoughtSignature: SIG };
const answer = (t: string) => ({ candidates: [{ content: { role: "model", parts: [{ text: t }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4, thoughtsTokenCount: 3 } });
const resp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("Gemini request format", () => {
  it("describes tools in Gemini's smaller schema dialect", () => {
    const decl = (toGeminiTools(toolSchemas())[0] as any).functionDeclarations;
    expect(decl).toHaveLength(12);
    const summary = decl.find((d: any) => d.name === "business_summary");
    expect(summary.parameters.required).toEqual(["from", "to"]);
    expect(summary.parameters.properties.from).toEqual({ type: "string", description: expect.any(String) });
    const json = JSON.stringify(decl);
    expect(json).not.toContain("additionalProperties");
    expect(json).not.toContain("pattern");
    expect(decl.find((d: any) => d.name === "collections").parameters.properties.group.enum).toEqual(["none", "day", "month"]);
  });
  it("converts a conversation, replaying the model's function call exactly (thought signature included) and naming each result", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "earlier question" }, { role: "assistant", content: "earlier answer" }, { role: "user", content: "who is overdue?" },
      { role: "assistant", content: [{ type: "tool_use", id: "call_0_x", name: "overdue_loans", input: { limit: 5 }, raw: callPart }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_0_x", content: JSON.stringify({ rows: [1] }) }] },
    ];
    const c = toGeminiContents(messages);
    expect(c.map((x) => x.role)).toEqual(["user", "model", "user", "model", "user"]);
    expect(c[3]!.parts[0]).toBe(callPart);
    expect(c[4]!.parts[0]).toEqual({ functionResponse: { name: "overdue_loans", response: { result: { rows: [1] } } } });
  });
  it("sends errors as errors", () => {
    const c = toGeminiContents([{ role: "assistant", content: [{ type: "tool_use", id: "a", name: "loan_detail", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "loan not found", is_error: true }] }]);
    expect(c[0]!.parts[0]).toEqual({ functionCall: { name: "loan_detail", args: {} } });
    expect(c[1]!.parts[0]).toEqual({ functionResponse: { name: "loan_detail", response: { error: "loan not found" } } });
  });
});

describe("Gemini responses", () => {
  it("reads function calls (keeping the original part) and text", () => {
    const r = parseGeminiResponse({ candidates: [{ content: { parts: [callPart, { text: "thinking…", thought: true }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2, thoughtsTokenCount: 5 } });
    expect(r.stop_reason).toBe("tool_use");
    expect(r.content).toHaveLength(1);
    expect(r.content[0]).toMatchObject({ type: "tool_use", name: "overdue_loans", input: { limit: 5 }, raw: callPart });
    expect(r.usage).toEqual({ input_tokens: 9, output_tokens: 7 });
    const t = parseGeminiResponse(answer("Hello"));
    expect(t.stop_reason).toBe("end_turn");
    expect(t.content).toEqual([{ type: "text", text: "Hello" }]);
  });
  it("turns refusals and empty answers into clear errors", () => {
    expect(() => parseGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } })).toThrowError(expect.objectContaining({ code: "blocked" }));
    expect(() => parseGeminiResponse({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] })).toThrowError(expect.objectContaining({ code: "blocked" }));
    expect(() => parseGeminiResponse({ candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] })).toThrowError(expect.objectContaining({ code: "unknown" }));
  });
});

describe("Gemini caller", () => {
  const req = { system: "sys", messages: [{ role: "user" as const, content: "hi" }], tools: toolSchemas(), maxTokens: 1500 };
  it("sends the key in a header (not the address) and the request in Gemini's shape", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return resp(answer("ok")); }) as unknown as typeof fetch;
    const r = await makeGeminiCaller("g-secret", "gemini-3.8-flash", f)(req);
    expect(r.content[0]).toMatchObject({ text: "ok" });
    expect(seen!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(seen!.url).not.toContain("g-secret");
    expect((seen!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-secret");
    const body = JSON.parse(seen!.init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.contents[0]).toEqual({ role: "user", parts: [{ text: "hi" }] });
    expect(body.tools[0].functionDeclarations).toHaveLength(12);
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(4096);
  });
  it("retries once when busy, then reports it", async () => {
    const seq = [resp({ error: { message: "quota" } }, 429), resp(answer("ok"))];
    expect((await makeGeminiCaller("k", "m", (async () => seq.shift()!) as unknown as typeof fetch, async () => {})(req)).stop_reason).toBe("end_turn");
    await expect(makeGeminiCaller("k", "m", (async () => resp({}, 429)) as unknown as typeof fetch, async () => {})(req)).rejects.toMatchObject({ code: "rate" });
  });
  it("maps a bad key, an unknown model, a blocked region and network failure", async () => {
    const run = (status: number, message: string) => makeGeminiCaller("sk-secret", "m", (async () => resp({ error: { message } }, status)) as unknown as typeof fetch, async () => {})(req).catch((e) => e);
    const bad = await run(400, "API key not valid. Please pass a valid API key.");
    expect(bad).toBeInstanceOf(AiError); expect(bad.code).toBe("auth"); expect(bad.message).not.toContain("sk-secret");
    expect((await run(404, "models/x is not found")).code).toBe("model");
    expect((await run(400, "User location is not supported for the API use.")).code).toBe("region");
    expect((await run(403, "forbidden")).code).toBe("auth");
    await expect(makeGeminiCaller("k", "m", (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch)(req)).rejects.toMatchObject({ code: "network" });
  });
});

describe("the assistant loop on Gemini", () => {
  it("makes a lookup, returns its result to Gemini with the thought signature intact, and gets the final answer", async () => {
    const bodies: any[] = [];
    const seq = [resp({ candidates: [{ content: { parts: [callPart] }, finishReason: "STOP" }] }), resp(answer("Ravi is overdue."))];
    const f = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(init.body as string)); return seq.shift()!; }) as unknown as typeof fetch;
    const r = await runAssistant({ system: "s", history: [], question: "who is overdue?", tools: toolSchemas(), callModel: makeGeminiCaller("k", "m", f), runTool: async () => ({ ok: true, data: { rows: [{ customer: "Ravi" }], method: ["m"] } }) });
    expect(r.answer).toBe("Ravi is overdue.");
    expect(r.trace).toHaveLength(1);
    const second = bodies[1].contents;
    expect(second.at(-2)).toEqual({ role: "model", parts: [callPart] });                 // replayed unchanged, signature included
    expect(second.at(-1).parts[0].functionResponse.name).toBe("overdue_loans");
    expect(second.at(-1).parts[0].functionResponse.response.result.rows[0].customer).toBe("Ravi");
  });
});

describe("choosing the AI service", () => {
  it("uses the key that is present, and AI_PROVIDER when both are", () => {
    expect(chooseProvider({})).toBeNull();
    expect(chooseProvider({ GEMINI_API_KEY: "g" })).toBe("gemini");
    expect(chooseProvider({ ANTHROPIC_API_KEY: "a" })).toBe("anthropic");
    expect(chooseProvider({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toBe("gemini");
    expect(chooseProvider({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", AI_PROVIDER: "anthropic" })).toBe("anthropic");
    expect(chooseProvider({ ANTHROPIC_API_KEY: "a", AI_PROVIDER: "gemini" })).toBe("anthropic"); // chosen service has no key: fall back to the one that has
  });
  it("treats Gemini as free-tier (test data only) until the owner declares billing is on", () => {
    expect(getProvider({ GEMINI_API_KEY: "g" })).toMatchObject({ name: "gemini", model: DEFAULT_GEMINI_MODEL, freeTier: true });
    expect(getProvider({ GEMINI_API_KEY: "g", GEMINI_TIER: "paid", GEMINI_MODEL: "gemini-3.8-flash" })).toMatchObject({ freeTier: false, model: "gemini-3.8-flash" });
    expect(getProvider({ ANTHROPIC_API_KEY: "a" })).toMatchObject({ name: "anthropic", freeTier: false });
    expect(geminiModel("bad model; drop")).toBe(DEFAULT_GEMINI_MODEL);
  });
});

import { DEFAULT_GEMINI_FALLBACK, fallbackModel, thinkingLevel, withFallback } from "../src/lib/ai/provider";

describe("Gemini slowness and limits", () => {
  const req = { system: "s", messages: [{ role: "user" as const, content: "hi" }], tools: toolSchemas(), maxTokens: 1500 };
  const quotaBody = (quotaId: string, retryDelay?: string) => ({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] }, ...(retryDelay ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] : [])] } });
  const caller = (seq: Response[], opts: { thinking?: "low" | null } = {}, bodies: any[] = [], sleeps: number[] = []) =>
    makeGeminiCaller("k", "m", { ...opts, fetchImpl: (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(init.body as string)); return seq.shift()!; }) as unknown as typeof fetch, sleep: async (ms) => { sleeps.push(ms); } });

  it("asks Gemini to think less (it thinks by default, which is slow), when configured", async () => {
    const b1: any[] = [], b2: any[] = [];
    await caller([resp(answer("ok"))], { thinking: "low" }, b1)(req);
    await caller([resp(answer("ok"))], { thinking: null }, b2)(req);
    expect(b1[0].generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(b2[0].generationConfig.thinkingConfig).toBeUndefined();
  });
  it("tries again without the thinking setting if the model rejects it", async () => {
    const bodies: any[] = [];
    const r = await caller([resp({ error: { status: "INVALID_ARGUMENT", message: "Unknown name \"thinkingLevel\": thinking is not supported" } }, 400), resp(answer("fine"))], { thinking: "low" }, bodies)(req);
    expect(r.content[0]).toMatchObject({ text: "fine" });
    expect(bodies[0].generationConfig.thinkingConfig).toBeDefined();
    expect(bodies[1].generationConfig.thinkingConfig).toBeUndefined();
  });
  it("waits as long as Google asks (when short), then succeeds", async () => {
    const sleeps: number[] = [];
    const r = await caller([resp(quotaBody("GenerateRequestsPerMinutePerProjectPerModel", "2s"), 429), resp(answer("ok"))], {}, [], sleeps)(req);
    expect(r.stop_reason).toBe("end_turn");
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(2000);
    expect(sleeps[0]).toBeLessThanOrEqual(3000);
  });
  it("does not make the user wait when the daily limit is used up, and says why", async () => {
    const sleeps: number[] = [];
    const e = await caller([resp(quotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier"), 429)], {}, [], sleeps)(req).catch((x) => x);
    expect(e).toBeInstanceOf(AiError);
    expect(e).toMatchObject({ code: "rate", daily: true });
    expect(e.detail).toContain("RESOURCE_EXHAUSTED");
    expect(e.detail).toContain("PerDay");
    expect(sleeps).toEqual([]);
  });
  it("does not wait a long time either: a delay over 20 seconds is reported straight away", async () => {
    const sleeps: number[] = [];
    const e = await caller([resp(quotaBody("PerMinute", "55s"), 429)], {}, [], sleeps)(req).catch((x) => x);
    expect(e).toMatchObject({ code: "rate", retryAfterSec: 55 });
    expect(sleeps).toEqual([]);
  });
  it("retries once when Google is out of capacity (503), then reports it", async () => {
    const sleeps: number[] = [];
    expect((await caller([resp({ error: { status: "UNAVAILABLE", message: "overloaded" } }, 503), resp(answer("ok"))], {}, [], sleeps)(req)).stop_reason).toBe("end_turn");
    expect(sleeps).toEqual([3000]);
    await expect(caller([resp({}, 503), resp({}, 503), resp(answer("late"))])(req)).rejects.toMatchObject({ code: "overloaded" });
  });
  it("recognises 'free tier not available in your country'", async () => {
    await expect(caller([resp({ error: { status: "FAILED_PRECONDITION", message: "Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio." } }, 400)])(req)).rejects.toMatchObject({ code: "region" });
  });
});

describe("model fallback", () => {
  const ok = async () => ({ content: [{ type: "text" as const, text: "from fallback" }] });
  const req = { system: "s", messages: [], tools: [], maxTokens: 10 };
  it("tries the second model when the first is busy, over quota or missing", async () => {
    for (const code of ["overloaded", "rate", "model", "timeout"] as const) {
      const r = await withFallback(async () => { throw new AiError(code, "x"); }, ok)(req);
      expect((r.content[0] as any).text).toBe("from fallback");
    }
  });
  it("does not try again for a bad key or a refused answer, and reports the first error if both fail", async () => {
    for (const code of ["auth", "blocked", "region"] as const) await expect(withFallback(async () => { throw new AiError(code, "x"); }, ok)(req)).rejects.toMatchObject({ code });
    const both = await withFallback(async () => { throw new AiError("rate", "first", "HTTP 429 daily", undefined, true); }, async () => { throw new AiError("overloaded", "second", "HTTP 503 UNAVAILABLE"); }, "model-b")(req).catch((x) => x);
    expect(both).toMatchObject({ code: "rate", daily: true });
    expect(both.detail).toContain("HTTP 429 daily");
    expect(both.detail).toContain("model-b: overloaded HTTP 503 UNAVAILABLE");   // the log shows what both models said
  });
  it("reads the settings safely", () => {
    expect(thinkingLevel(undefined)).toBe("low");
    expect(thinkingLevel("HIGH")).toBe("high");
    expect(thinkingLevel("none")).toBeNull();
    expect(thinkingLevel("garbage")).toBe("low");
    expect(fallbackModel(undefined, "something-else")).toBe(DEFAULT_GEMINI_FALLBACK);
    expect(fallbackModel(undefined, DEFAULT_GEMINI_FALLBACK)).toBeNull(); // never the same model twice
    expect(fallbackModel("none", "x")).toBeNull();
    expect(fallbackModel("same", "same")).toBeNull();
    expect(fallbackModel("bad name;", "x")).toBeNull();
  });
});
