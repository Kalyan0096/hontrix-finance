import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { signOut } from "../../actions";
import { verifyLoginCode } from "./actions";

export default async function LoginMfa({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { t, lang } = await getT();
  const { err } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <h1 className="mb-2 text-3xl font-bold">{t("mfa.loginTitle")}</h1>
      <p className="mb-6 text-ink-soft">{t("mfa.loginHelp")}</p>
      <form action={verifyLoginCode} className="space-y-4">
        {err && err in messages[lang] && <p role="alert" className="rounded-md border border-bad bg-card p-3 text-bad">{messages[lang][err as MessageKey]}</p>}
        <label className="block"><span className="mb-1 block font-medium">{t("mfa.code")}</span>
          <input className="field num text-center text-2xl tracking-widest" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" required autoFocus /></label>
        <button className="btn w-full">{t("mfa.verify")}</button>
      </form>
      <p className="mt-6 text-sm text-ink-soft">{t("mfa.lost")}</p>
      <form action={signOut} className="mt-4"><button className="btn-quiet">{t("auth.signOut")}</button></form>
    </main>
  );
}
