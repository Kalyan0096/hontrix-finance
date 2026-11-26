import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { Banner } from "../loan-ui";
import { createClient } from "@/lib/supabase/server";
import { changePassword } from "./actions";
import { MfaPanel } from "./mfa-panel";

export default async function Account({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const profile = await requireProfile();
  const { t, lang } = await getT();
  const sp = await searchParams;
  const { data: factors } = await (await createClient()).auth.mfa.listFactors();
  const m = messages[lang];
  const msg = (k?: string) => (k && k in messages[lang] ? messages[lang][k as MessageKey] : null);
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">{t("acct.title")}</h1>
      <p className="mb-6 text-ink-soft">{profile.full_name} · {t(`acct.role.${profile.role === "owner" ? "owner" : "employee"}` as MessageKey)}</p>
      {msg(sp.ok) && <Banner kind="ok">{msg(sp.ok)}</Banner>}
      {msg(sp.err) && <Banner kind="bad">{msg(sp.err)}</Banner>}
      <form action={changePassword} className="max-w-md space-y-4 border border-line bg-card p-5">
        <h2 className="text-lg font-semibold">{t("auth.changePassword")}</h2>
        <label className="block"><span className="mb-1 block font-medium">{t("auth.currentPassword")}</span><input className="field" name="current" type="password" autoComplete="current-password" required /></label>
        <label className="block"><span className="mb-1 block font-medium">{t("auth.newPassword")}</span><input className="field" name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
        <label className="block"><span className="mb-1 block font-medium">{t("auth.confirmPassword")}</span><input className="field" name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
        <button className="btn">{t("auth.changePassword")}</button>
      </form>
      <MfaPanel enabledFactorId={factors?.totp?.[0]?.id ?? null} labels={{ title: m["mfa.title"], help: m["mfa.help"], enable: m["mfa.enable"], scan: m["mfa.scan"], code: m["mfa.code"], verify: m["mfa.verify"], on: m["mfa.on"],
        disable: m["mfa.disable"], enabledMsg: m["mfa.enabledMsg"], disabledMsg: m["mfa.disabledMsg"], errors: { "err.mfaCode": m["err.mfaCode"], "err.mfaOff": m["err.mfaOff"], "err.generic": m["err.generic"] } }} />
    </>
  );
}
