export type AiErrorCode = "auth" | "rate" | "overloaded" | "bad_request" | "timeout" | "network" | "blocked" | "model" | "region" | "unknown";
export class AiError extends Error {
  /** `detail` is safe to log: status codes and quota names only, never prompts, answers or keys. */
  constructor(public code: AiErrorCode, message: string, public detail?: string, public retryAfterSec?: number, public daily?: boolean) { super(message); }
}
