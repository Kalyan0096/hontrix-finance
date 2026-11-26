import { cookies } from "next/headers";
import { LANGS, messages, type Lang, type MessageKey } from "./messages";

export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get("lang")?.value;
  return LANGS.includes(v as Lang) ? (v as Lang) : "en";
}

export async function getT() {
  const lang = await getLang();
  return { lang, t: (k: MessageKey) => messages[lang][k] };
}
