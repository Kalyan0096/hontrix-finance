import Link from "next/link";
import { getT } from "@/lib/i18n";
import { setLanguage, signIn, signOut } from "../actions";
import { BrandMark } from "../(app)/icons";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { t, lang } = await getT();
  const { error } = await searchParams;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-pine-deep p-12 text-white lg:flex lg:flex-col lg:justify-between"
        style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 39px, rgb(255 255 255 / 0.05) 39px, rgb(255 255 255 / 0.05) 40px)" }}>
        <div className="absolute inset-y-0 left-0 w-1.5 bg-mark" aria-hidden="true" />
        <div className="flex items-center gap-3"><BrandMark className="h-11 w-11" /><p className="text-xl font-semibold">{t("app.name")}</p></div>
        <p className="max-w-md text-4xl font-semibold leading-tight tracking-tight" style={{ fontFamily: "var(--font-fig)" }}>{t("auth.tagline")}</p>
      </aside>
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-10">
        <div className="mb-8 flex items-center gap-3 lg:hidden"><BrandMark /><p className="text-xl font-semibold">{t("app.name")}</p></div>
        <h1 className="mb-1 text-2xl font-bold">{t("auth.signIn")}</h1>
        <p className="mb-7 text-ink-soft">{t("auth.welcome")}</p>
        {error === "access" ? (
          <div role="alert" className="mb-6 rounded-xl border border-bad bg-bad-soft p-4 text-bad">
            <p>{t("auth.noAccess")}</p>
            <form action={signOut} className="mt-3"><button className="btn-quiet">{t("auth.signOut")}</button></form>
          </div>
        ) : (
          <form action={signIn} className="space-y-4">
            {error === "bad" && <p role="alert" className="rounded-xl border border-bad bg-bad-soft p-3 text-bad">{t("auth.bad")}</p>}
            {error === "locked" && <p role="alert" className="rounded-xl border border-bad bg-bad-soft p-3 text-bad">{t("auth.locked")}</p>}
            {error === "idle" && <p role="status" className="rounded-xl border border-line bg-card p-3">{t("auth.idle")}</p>}
            <label className="block"><span className="mb-1.5 block text-sm font-medium">{t("auth.email")}</span>
              <input className="field" name="email" type="email" autoComplete="username" required /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-medium">{t("auth.password")}</span>
              <input className="field" name="password" type="password" autoComplete="current-password" required /></label>
            <button className="btn w-full">{t("auth.signIn")}</button>
            <p><Link href="/forgot-password" className="text-pine underline underline-offset-4">{t("auth.forgot")}</Link></p>
          </form>
        )}
        <form action={setLanguage} className="mt-8"><input type="hidden" name="lang" value={lang === "en" ? "te" : "en"} />
          <button className="btn-quiet">{t("lang.switch")}</button></form>
      </main>
    </div>
  );
}
