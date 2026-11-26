import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { completeReset } from "./actions";

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  if (!(await cookies()).get("pw_recovery")) redirect("/forgot-password?err=expired"); // only reachable through the emailed link
  const { t, lang } = await getT();
  const { err } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <h1 className="mb-6 text-3xl font-bold">{t("auth.resetTitle")}</h1>
      <form action={completeReset} className="space-y-4">
        {err && err in messages[lang] && <p role="alert" className="rounded-md border border-bad bg-card p-3 text-bad">{messages[lang][err as MessageKey]}</p>}
        <label className="block"><span className="mb-1 block font-medium">{t("auth.newPassword")}</span><input className="field" name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
        <label className="block"><span className="mb-1 block font-medium">{t("auth.confirmPassword")}</span><input className="field" name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
        <button className="btn w-full">{t("auth.changePassword")}</button>
      </form>
    </main>
  );
}
