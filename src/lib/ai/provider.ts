import type { CallModel } from "./loop";
import { makeAnthropicCaller } from "./anthropic";
import { THINKING_LEVELS, makeGeminiCaller, type ThinkingLevel } from "./gemini";
import { AiError } from "./errors";
import { assistantModel } from "./config";

export type ProviderName = "gemini" | "anthropic";
export interface Provider { name: ProviderName; label: string; model: string; callModel: CallModel; freeTier: boolean }

// Flash Lite has much larger free-tier limits than Flash (on one project: 15 requests/minute and 500/day against 5 and 20), so it is the main model; Flash is the backup.
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_GEMINI_FALLBACK = "gemini-3.8-flash";
export const geminiModel = (raw: string | undefined) => (raw && /^[a-z0-9._-]{3,80}$/i.test(raw) ? raw : DEFAULT_GEMINI_MODEL);

/** Thinking effort for Gemini 3 models (they think by default, which is slow). "none" leaves it to Google. Default: low. */
export const thinkingLevel = (raw: string | undefined): ThinkingLevel | null => { const v = (raw ?? "low").toLowerCase(); return (THINKING_LEVELS as readonly string[]).includes(v) ? (v as ThinkingLevel) : v === "none" ? null : "low"; };
/** A second model to try when the first is overloaded or over its quota (each model has its own limits). "none" turns it off. */
export const fallbackModel = (raw: string | undefined, primary: string): string | null => { const v = (raw ?? DEFAULT_GEMINI_FALLBACK).trim(); return v.toLowerCase() === "none" || !/^[a-z0-9._-]{3,80}$/i.test(v) || v === primary ? null : v; };

/** Tries the main model; if it is busy, over quota or unavailable, tries the fallback once. Other errors are reported straight away. */
export function withFallback(primary: CallModel, fallback: CallModel | null, fallbackName = "fallback"): CallModel {
  if (!fallback) return primary;
  return async (req) => {
    try { return await primary(req); }
    catch (e) {
      if (!(e instanceof AiError) || !["rate", "overloaded", "model", "timeout"].includes(e.code)) throw e;
      try { return await fallback(req); }
      catch (e2) {
        // Report the first problem, but record what the second model said too so the log shows both.
        const second = e2 instanceof AiError ? `${e2.code} ${e2.detail ?? ""}`.trim() : "failed";
        throw new AiError(e.code, e.message, `${e.detail ?? e.code}; ${fallbackName}: ${second}`, e.retryAfterSec, e.daily);
      }
    }
  };
}

/** Which AI service is configured. AI_PROVIDER decides when both keys exist; otherwise whichever key is present is used. */
export function chooseProvider(env: Record<string, string | undefined>): ProviderName | null {
  const want = env.AI_PROVIDER?.toLowerCase();
  if (want === "gemini" && env.GEMINI_API_KEY) return "gemini";
  if (want === "anthropic" && env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.GEMINI_API_KEY) return "gemini";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function getProvider(env: Record<string, string | undefined> = process.env): Provider | null {
  const name = chooseProvider(env);
  if (name === "gemini") {
    const model = geminiModel(env.GEMINI_MODEL);
    // Google treats free-quota use as "unpaid" (data may be used to improve its products) unless billing is switched on for the project.
    const level = thinkingLevel(env.GEMINI_THINKING), fb = fallbackModel(env.GEMINI_FALLBACK_MODEL, model);
    const main = makeGeminiCaller(env.GEMINI_API_KEY!, model, { thinking: level });
    const second = fb ? makeGeminiCaller(env.GEMINI_API_KEY!, fb, { thinking: level }) : null;
    return { name, label: "Google (Gemini)", model, callModel: withFallback(main, second, fb ?? "fallback"), freeTier: env.GEMINI_TIER?.toLowerCase() !== "paid" };
  }
  if (name === "anthropic") { const model = assistantModel(env.ANTHROPIC_MODEL); return { name, label: "Anthropic (Claude)", model, callModel: makeAnthropicCaller(env.ANTHROPIC_API_KEY!, model), freeTier: false }; }
  return null;
}
