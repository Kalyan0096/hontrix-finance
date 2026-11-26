import Link from "next/link";
import { Suspense, cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { HBars, TrendChart } from "./charts";
import { Icon } from "./icons";
import { formatINR, toPaise } from "@/lib/finance";

const money = (v: unknown) => formatINR(toPaise(Number(v ?? 0)));
const count = (v: unknown) => new Intl.NumberFormat("en-IN").format(Number(v ?? 0));

/** One query shared by every section of this page in the same request. */
const getSummary = cache(async () => {
  const { data, error } = await (await createClient()).from("v_dashboard_summary").select("*").single();
  return { d: data, error };
});

/** ₹12,34,567.50 with the paise set smaller, so the rupees are what the eye reads. */
function Money({ value, className = "" }: { value: unknown; className?: string }) {
  const [whole, paise] = money(value).split(".");
  return <span className={`fig num ${className}`}>{whole}<span className="text-[0.55em] opacity-60">.{paise}</span></span>;
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="fig num mt-1 text-3xl leading-tight">{value}</p>
      {sub ? <p className="mt-0.5 text-sm text-ink-soft">{sub}</p> : null}
    </div>
  );
}

async function Summary() {
  const { t } = await getT();
  const { d, error } = await getSummary();
  if (error || !d) return <p role="alert" className="rounded-xl border border-bad bg-bad-soft p-4 text-bad">{t("dash.error")}</p>;

  const overdue = Number(d.overdue_amount ?? 0) > 0;
  const paid = Number(d.paid_installments ?? 0), unpaid = Number(d.unpaid_installments ?? 0);
  const paidShare = paid + unpaid > 0 ? Math.round((paid / (paid + unpaid)) * 100) : 0;
  const attentionAll: { label: string; n: number; href: string; icon: string; tone: "bad" | "warn" }[] = [
    { label: t("dash.insExpired"), n: Number(d.expired_insurance), href: "/alerts", icon: "alerts", tone: "bad" },
    { label: t("dash.followUps"), n: Number(d.follow_ups_due), href: "/alerts", icon: "customers", tone: "warn" },
    { label: t("dash.docsToVerify"), n: Number(d.documents_to_verify), href: "/documents?f=toVerify", icon: "documents", tone: "warn" },
    { label: t("dash.incompleteFiles"), n: Number(d.incomplete_loan_files), href: "/alerts", icon: "loans", tone: "warn" },
    { label: t("dash.insExpiring"), n: Number(d.insurance_expiring_30d), href: "/alerts", icon: "vehicles", tone: "warn" },
  ];
  const attention = attentionAll.filter((a) => a.n > 0);

  return (
    <>
      {/* the one bold moment: what is overdue today */}
      <section aria-label={t("dash.overdue")} className="relative overflow-hidden rounded-2xl bg-pine-deep p-6 text-white shadow-lift md:p-8"
        style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 39px, rgb(255 255 255 / 0.04) 39px, rgb(255 255 255 / 0.04) 40px)" }}>
        <div className="absolute inset-y-0 left-0 w-1.5 bg-mark" aria-hidden="true" />
        <div className="grid gap-8 md:grid-cols-[1.5fr_1fr] md:items-end">
          <div>
            <p className="text-white/70">{t("dash.overdue")}</p>
            <Money value={d.overdue_amount} className={`mt-2 block text-5xl leading-none sm:text-6xl lg:text-7xl ${overdue ? "text-white" : "text-[#8fe3b8]"}`} />
            <p className="mt-4 flex flex-wrap items-center gap-3">
              <span className={`num rounded-full px-3 py-1 text-sm font-semibold ${overdue ? "bg-bad text-white" : "bg-ok text-white"}`}>{count(d.overdue_installments)} {t("dash.overdueCount")}</span>
              <Link href="/payments" className="inline-flex min-h-11 items-center rounded-lg bg-mark px-4 font-semibold text-pine-deep hover:bg-[#f0b323]">{t("dash.collectNow")}</Link>
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-6 border-t border-white/15 pt-6 md:grid-cols-1 md:border-l md:border-t-0 md:pl-8 md:pt-0">
            <div><dt className="text-sm text-white/65">{t("dash.collected")}</dt><dd><Money value={d.collections_this_month} className="text-xl sm:text-2xl lg:text-3xl" /></dd></div>
            <div><dt className="text-sm text-white/65">{t("dash.principal")}</dt><dd><Money value={d.principal_outstanding} className="text-xl sm:text-2xl lg:text-3xl" /></dd></div>
          </dl>
        </div>
      </section>

      <section className="mt-8" aria-label={t("dash.needsAttention")}>
        <h2 className="mb-3 text-lg font-semibold">{t("dash.needsAttention")}</h2>
        {attention.length === 0 ? (
          <p className="card flex items-center gap-3 p-4 text-ok"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-ok-soft" aria-hidden="true"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.500" /></svg></span>{t("dash.allClear")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {attention.map((a) => (
              <li key={a.label}>
                <Link href={a.href} className="card group flex min-h-20 items-center gap-4 p-4 transition-shadow hover:shadow-lift">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${a.tone === "bad" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}><Icon name={a.icon} /></span>
                  <span className="min-w-0 flex-1 text-[15px] leading-snug">{a.label}</span>
                  <span className={`fig num text-3xl ${a.tone === "bad" ? "text-bad" : "text-warn"}`}>{count(a.n)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-label={t("dash.portfolio")}>
        <h2 className="mb-3 text-lg font-semibold">{t("dash.portfolio")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label={t("dash.activeLoans")} value={count(d.active_loans)} />
          <Kpi label={t("dash.customers")} value={count(d.total_customers)} />
          <Kpi label={t("dash.loansDisbursed")} value={count(d.loans_disbursed)} />
          <Kpi label={t("dash.disbursed")} value={money(d.amount_disbursed).replace(/\.00$/, "")} />
        </div>
        <div className="card mt-4 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold">{t("dash.instalments")}</p>
            <p className="fig num text-2xl">{paidShare}% <span className="font-sans text-sm font-normal text-ink-soft">{t("dash.paidShare")}</span></p>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-warn-soft" role="img" aria-label={`${paidShare}% ${t("dash.paidShare")}`}><div className="h-full rounded-full bg-ok" style={{ width: `${paidShare}%` }} /></div>
          <p className="num mt-2 flex justify-between text-sm text-ink-soft"><span>{t("dash.paidInst")}: <b className="font-semibold text-ink">{count(paid)}</b></span><span>{t("dash.unpaidInst")}: <b className="font-semibold text-ink">{count(unpaid)}</b></span></p>
        </div>
      </section>
    </>
  );
}

async function Charts() {
  const { t, lang } = await getT();
  const supabase = await createClient();
  const [{ d }, { data: monthly }, { data: cats }, { data: stats }] = await Promise.all([
    getSummary(),
    supabase.rpc("report_monthly", { p_months: 12 }),
    supabase.from("v_category_distribution").select("category, loans_count, disbursed_amount").order("loans_count", { ascending: false }),
    supabase.from("v_loan_status_distribution").select("status, loans_count").order("loans_count", { ascending: false }),
  ]);
  const fmt = new Intl.DateTimeFormat(lang === "te" ? "te-IN" : "en-IN", { month: "short", timeZone: "UTC" });
  const months = (monthly ?? []) as { month: string; disbursed_amount: number; collected: number; overdue_amount: number }[];
  const label = (m: string) => fmt.format(new Date(`${m}T00:00:00Z`));
  // the last overdue point is today's live figure, so the chart agrees with the card above
  const overdueSeries = months.map((m, i) => ({ label: label(m.month), value: i === months.length - 1 ? Number(d?.overdue_amount ?? 0) : Number(m.overdue_amount) }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TrendChart title={t("chart.disbursed")} points={months.map((m) => ({ label: label(m.month), value: Number(m.disbursed_amount) }))} empty={t("chart.noData")} />
      <TrendChart title={t("chart.collected")} points={months.map((m) => ({ label: label(m.month), value: Number(m.collected) }))} empty={t("chart.noData")} />
      <TrendChart title={t("chart.overdue")} kind="line" tone="bad" points={overdueSeries} empty={t("chart.noData")} />
      <HBars title={t("chart.byStatus")} empty={t("chart.noData")} rows={(stats ?? []).map((c) => ({ label: t(`loan.status.${c.status}` as MessageKey) ?? String(c.status), value: Number(c.loans_count) }))} />
      <HBars title={t("chart.byCategory")} money wide empty={t("chart.noData")} rows={(cats ?? []).map((c) => ({ label: t(`veh.cat.${c.category}` as MessageKey) ?? String(c.category), value: Number(c.disbursed_amount), note: `${c.loans_count} ${t("chart.loans")}` }))} />
    </div>
  );
}

export default async function Dashboard() {
  const { t, lang } = await getT();
  const today = new Intl.DateTimeFormat(lang === "te" ? "te-IN" : "en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold md:text-3xl">{t("dash.title")}</h1>
        <p className="text-ink-soft">{today}</p>
      </header>
      <Suspense fallback={<div className="space-y-5"><div className="skel h-56" /><div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skel h-20" />)}</div></div>}>
        <Summary />
      </Suspense>
      <h2 className="mb-3 mt-10 text-lg font-semibold">{t("dash.trends")}</h2>
      <Suspense fallback={<div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skel h-64" />)}</div>}>
        <Charts />
      </Suspense>
    </>
  );
}
