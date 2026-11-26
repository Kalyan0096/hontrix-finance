import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { DOCUMENT_CATEGORIES } from "@/lib/documents";
import { Banner } from "../loan-ui";
import { isAssistantEnabled } from "@/lib/ai/config";
import { getProvider } from "@/lib/ai/provider";
import { saveAssistantSetting, saveRequiredDocuments } from "./actions";

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const { t, lang } = await getT();
  const sp = await searchParams;
  const { data } = await (await createClient()).from("required_document_rules").select("category");
  const { data: aiSetting } = await (await createClient()).from("business_settings").select("value").eq("key", "ai_assistant").maybeSingle();
  const aiOn = isAssistantEnabled(aiSetting?.value);
  const provider = getProvider();
  const on = new Set((data ?? []).map((r) => r.category as string));
  const msg = (k?: string) => (k && k in messages[lang] ? messages[lang][k as MessageKey] : null);
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{t("set.title")}</h1>
      {msg(sp.ok) && <Banner kind="ok">{msg(sp.ok)}</Banner>}
      {msg(sp.err) && <Banner kind="bad">{msg(sp.err)}</Banner>}
      <form action={saveRequiredDocuments} className="max-w-xl space-y-4 border border-line bg-card p-5">
        <h2 className="text-lg font-semibold">{t("set.docs")}</h2>
        <p className="text-ink-soft">{t("set.docsHelp")}</p>
        <fieldset className="grid gap-1 sm:grid-cols-2">
          {DOCUMENT_CATEGORIES.filter((c) => c !== "payment_receipt").map((c) => (
            <label key={c} className="flex min-h-11 items-center gap-3"><input type="checkbox" name={c} defaultChecked={on.has(c)} className="size-5 accent-ink" />{t(`doc.cat.${c}` as MessageKey)}</label>))}
        </fieldset>
        <button className="btn">{t("common.save")}</button>
      </form>

      <form action={saveAssistantSetting} className="mt-8 max-w-xl space-y-3 border border-line bg-card p-5">
        <h2 className="text-lg font-semibold">{t("set.ai.title")}</h2>
        <p className="text-ink-soft">{t("set.ai.help")}</p>
        <p className={`font-semibold ${aiOn ? "text-ok" : "text-ink-soft"}`}>{aiOn ? t("set.ai.on") : t("set.ai.off")}</p>
        {!provider ? <p className="text-warn">{t("set.ai.keyMissing")}</p> : <p className="text-ink-soft">{t("set.ai.provider").replace("{provider}", provider.label)}</p>}
        {provider?.freeTier && provider.name === "gemini" && <p className="text-warn">{t("ai.freeBanner")}</p>}
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="enabled" defaultChecked={aiOn} className="size-5 accent-ink" />{t("set.ai.enable")}</label>
        <label className="flex items-start gap-3"><input type="checkbox" name="consent" className="mt-1 size-5 accent-ink" /><span>{t("set.ai.consent").replace("{provider}", provider?.label ?? "the AI provider")}</span></label>
        <button className="btn">{t("common.save")}</button>
      </form>

      <section className="mt-8 max-w-xl space-y-3 border border-line bg-card p-5">
        <h2 className="text-lg font-semibold">{t("backup.title")}</h2>
        <p className="text-ink-soft">{t("backup.help")}</p>
        <p className="text-sm text-ink-soft">{t("backup.limit")} {t("backup.note")}</p>
        <a className="btn inline-flex items-center" href="/settings/backup">{t("backup.download")}</a>
      </section>
    </>
  );
}
