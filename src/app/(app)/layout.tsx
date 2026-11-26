import Link from "next/link";
import { Suspense, cache } from "react";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { setLanguage, signOut } from "../actions";
import { MobileNav, SideNav, type NavGroup } from "./nav-links";
import { BrandMark, Icon } from "./icons";

/** The red count on the Alerts link. It sits in its own Suspense boundary so a slow alerts query never delays the page. */
const urgentCount = cache(async () => {
  const { count } = await (await createClient()).from("v_alerts").select("kind", { count: "exact", head: true }).eq("severity", "high");
  return count ?? 0;
});
async function AlertBadge() {
  const count = await urgentCount(); // cached per request: the sidebar and the phone menu share one query
  return count ? <span className="num rounded-full bg-bad px-2 py-0.5 text-xs font-semibold leading-none text-white" aria-label={`${count}`}>{count}</span> : null;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const { t, lang } = await getT();
  const badge = <Suspense fallback={null}><AlertBadge /></Suspense>;
  const owner = profile.role === "owner";
  const dashboard = { href: "/", label: t("nav.dashboard"), icon: "dashboard" };
  const alerts = { href: "/alerts", label: t("nav.alerts"), icon: "alerts", badge };
  const payments = { href: "/payments", label: t("nav.payments"), icon: "payments" };
  const customers = { href: "/customers", label: t("nav.customers"), icon: "customers" };
  const loans = { href: "/loans", label: t("nav.loans"), icon: "loans" };
  // Screens appear here as their milestones ship; nothing is listed that does not work.
  const groups: NavGroup[] = [
    { items: [dashboard, alerts, payments, ...(can(profile, "assistant.use") ? [{ href: "/assistant", label: t("nav.assistant"), icon: "assistant" }] : [])], title: t("nav.group.work") },
    { title: t("nav.group.records"), items: [customers, { href: "/vehicles", label: t("nav.vehicles"), icon: "vehicles" }, loans, { href: "/documents", label: t("nav.documents"), icon: "documents" }, { href: "/reports", label: t("nav.reports"), icon: "reports" }] },
    ...(owner ? [{ title: t("nav.group.admin"), items: [
      { href: "/employees", label: t("nav.employees"), icon: "employees" }, { href: "/settings", label: t("nav.settings"), icon: "settings" },
      { href: "/import", label: t("nav.import"), icon: "import" }, { href: "/audit", label: t("nav.audit"), icon: "audit" }] }] : []),
  ];
  const initial = profile.full_name.trim().charAt(0).toUpperCase() || "?";
  const nextLang = lang === "en" ? "te" : "en";
  const actionClass = "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/80 hover:bg-white/8 hover:text-white";
  const actions = (
    <>
      <form action={setLanguage}><input type="hidden" name="lang" value={nextLang} /><button className={actionClass}><Icon name="language" className="h-5 w-5 text-white/55" />{t("lang.switch")}</button></form>
      <Link href="/account" className={actionClass}><Icon name="account" className="h-5 w-5 text-white/55" />{t("nav.account")}</Link>
      <form action={signOut}><button className={actionClass}><Icon name="signout" className="h-5 w-5 text-white/55" />{t("auth.signOut")}</button></form>
    </>
  );
  return (
    <div className="min-h-screen md:grid md:grid-cols-[16.5rem_1fr] print:block">
      <aside className="hidden bg-pine-deep text-white md:sticky md:top-0 md:flex md:h-screen md:flex-col print:hidden">
        <div className="flex items-center gap-3 px-5 py-6">
          <BrandMark />
          <p className="text-[17px] font-semibold leading-tight">{t("app.name")}</p>
        </div>
        <SideNav groups={groups} />
        <div className="relative border-t border-white/10 p-3">
          <details className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/8 [&::-webkit-details-marker]:hidden">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pine text-sm font-semibold" aria-hidden="true">{initial}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{profile.full_name}</span><span className="block text-xs text-white/55">{owner ? t("dash.owner") : t("dash.staff")}</span></span>
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-white/55 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
            </summary>
            <div className="absolute inset-x-3 bottom-[4.75rem] rounded-xl border border-white/10 bg-[#0f3a33] p-1.5 shadow-lift">{actions}</div>
          </details>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center gap-3 bg-pine-deep px-4 py-3 text-white md:hidden print:hidden">
          <BrandMark className="h-8 w-8" /><p className="flex-1 truncate font-semibold">{t("app.name")}</p>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pine text-sm font-semibold" aria-hidden="true">{initial}</span>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-9 print:max-w-none print:p-0">{children}</main>
      </div>

      <MobileNav primary={[dashboard, payments, customers, loans].map((i) => ({ ...i, badge: undefined }))} groups={groups} moreLabel={t("nav.more")} closeLabel={t("nav.close")}
        footer={<>{actions}</>} />
    </div>
  );
}
