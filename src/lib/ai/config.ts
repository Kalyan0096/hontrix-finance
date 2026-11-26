export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const assistantModel = (raw: string | undefined) => (raw && /^[a-z0-9._-]{3,80}$/i.test(raw) ? raw : DEFAULT_MODEL);
/** Questions per person per day: from the environment, kept between 5 and 1000, default 100. */
export const assistantDailyLimit = (raw: string | undefined) => { const n = Number(raw); return Number.isInteger(n) && n >= 5 && n <= 1000 ? n : 100; };
export const isAssistantEnabled = (value: unknown) => !!value && typeof value === "object" && (value as { enabled?: unknown }).enabled === true;
