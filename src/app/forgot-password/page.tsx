import Link from "next/link";
import { getT } from "@/lib/i18n";
import { requestReset } from "./actions";

export default async function ForgotPassword({ searchParams }: { searchParams: Promise<{ sent?: string; err?: string }> }) {
  const { t } = await getT();
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <h1 className="mb-4 text-3xl font-bold">{t("auth.forgotTitle")}</h1>
      {sp.sent ? <p role="status" className="mb-6 rounded-md border border-ok bg-card p-4 text-ok">{t("auth.linkSent")}</p> : (
        <form action={requestReset} className="space-y-4">
          {sp.err === "expired" && <p role="alert" className="rounded-md border border-bad bg-card p-3 text-bad">{t("auth.resetExpired")}</p>}
          <p className="text-ink-soft">{t("auth.forgotHelp")}</p>
          <label className="block"><span className="mb-1 block font-medium">{t("auth.email")}</span><input className="field" name="email" type="email" autoComplete="username" required /></label>
          <button className="btn w-full">{t("auth.sendLink")}</button>
        </form>)}
      <Link href="/login" className="mt-6 underline">{t("auth.backToLogin")}</Link>
    </main>
  );
}
