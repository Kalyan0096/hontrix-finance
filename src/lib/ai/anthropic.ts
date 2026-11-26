import type { CallModel, ModelResponse } from "./loop";

import { AiError, type AiErrorCode } from "./errors";
export { AiError };
export type { AiErrorCode };

const URL = "https://api.anthropic.com/v1/messages";
const mapStatus = (s: number): AiErrorCode => (s === 401 || s === 403 ? "auth" : s === 429 ? "rate" : s === 529 || s >= 500 ? "overloaded" : s === 400 || s === 404 || s === 413 ? "bad_request" : "unknown");

/** Calls the Anthropic Messages API (no SDK needed). Retries once on rate-limit or overload. Never logs prompts or answers. */
export function makeAnthropicCaller(apiKey: string, model: string, fetchImpl: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): CallModel {
  return async ({ system, messages, tools, maxTokens }) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(URL, {
          method: "POST", signal: AbortSignal.timeout(60_000),
          headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, tools }),
        });
      } catch (e) {
        const timedOut = (e as { name?: string })?.name === "TimeoutError" || (e as { name?: string })?.name === "AbortError";
        throw new AiError(timedOut ? "timeout" : "network", timedOut ? "timed out" : "network error");
      }
      if (res.ok) return (await res.json()) as ModelResponse;
      const code = mapStatus(res.status);
      if ((code === "rate" || code === "overloaded") && attempt === 0) { await sleep(Math.min(5000, Number(res.headers.get("retry-after") ?? 1) * 1000 || 1000)); continue; }
      throw new AiError(code, `HTTP ${res.status}`);
    }
    throw new AiError("unknown", "no response");
  };
}
