import { redirect } from "next/navigation";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { CustomerFields } from "../../record-fields";
import { createCustomer } from "../actions";

export default async function NewCustomer({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const profile = await requireProfile();
  if (!can(profile, "customers.write")) redirect("/customers");
  const { t, lang } = await getT();
  const { err } = await searchParams;
  return (
    <>
      <Link href="/customers" className="mb-4 inline-block underline">{t("common.back")}</Link>
      <h1 className="mb-6 text-2xl font-bold">{t("cust.add")}</h1>
      {err && err in messages[lang] && <p role="alert" className="mb-4 rounded-md border border-bad bg-card p-3 text-bad">{messages[lang][err as MessageKey]}</p>}
      <form action={createCustomer} className="space-y-5 border border-line bg-card p-5">
        <CustomerFields t={t} />
        <button className="btn">{t("cust.add")}</button>
      </form>
    </>
  );
}
