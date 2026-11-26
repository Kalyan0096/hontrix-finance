import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { PERMISSIONS } from "@/lib/permissions";
import { createEmployee, resetEmployeePassword, updateEmployee } from "./actions";

type Emp = { id: string; full_name: string; phone: string | null; permissions: string[]; is_active: boolean };

function PermBoxes({ t, checked = [] }: { t: (k: MessageKey) => string; checked?: string[] }) {
  return (
    <fieldset className="grid gap-1 sm:grid-cols-2">
      {PERMISSIONS.map((p) => (
        <label key={p} className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name={p} defaultChecked={checked.includes(p)} className="size-5 accent-ink" />{t(`perm.${p}` as MessageKey)}
        </label>
      ))}
    </fieldset>
  );
}

export default async function Employees({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const { t, lang } = await getT();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, phone, permissions, is_active").eq("role", "employee").order("full_name");
  const emps = (data ?? []) as Emp[];
  const msg = (k?: string) => (k && k in messages[lang] ? messages[lang][k as MessageKey] : null);

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{t("emp.title")}</h1>
      {msg(sp.ok) && <p role="status" className="mb-4 rounded-md border border-ok bg-card p-3 text-ok">{msg(sp.ok)}</p>}
      {msg(sp.err) && <p role="alert" className="mb-4 rounded-md border border-bad bg-card p-3 text-bad">{msg(sp.err)}</p>}

      <form action={createEmployee} className="mb-10 space-y-4 border border-line bg-card p-5">
        <h2 className="text-lg font-semibold">{t("emp.add")}</h2>
        <label className="block"><span className="mb-1 block">{t("emp.name")}</span><input className="field" name="fullName" required /></label>
        <label className="block"><span className="mb-1 block">{t("auth.email")}</span><input className="field" name="email" type="email" required autoComplete="off" /></label>
        <label className="block"><span className="mb-1 block">{t("emp.phone")}</span><input className="field" name="phone" inputMode="numeric" maxLength={10} /></label>
        <label className="block"><span className="mb-1 block">{t("emp.tempPassword")}</span><input className="field" name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
        <p className="font-medium">{t("emp.perms")}</p><PermBoxes t={t} />
        <p className="text-sm text-ink-soft">{t("emp.readOnly")}</p>
        <button className="btn">{t("emp.add")}</button>
      </form>

      {emps.length === 0 ? <p className="text-ink-soft">{t("emp.empty")}</p> : (
        <ul className="space-y-4">
          {emps.map((e) => (
            <li key={e.id} className="border border-line bg-card p-5">
              <form action={updateEmployee} className="space-y-3">
                <input type="hidden" name="id" value={e.id} />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-lg font-semibold">{e.full_name}</p>
                  <p className={e.is_active ? "text-ok" : "text-bad"}>{e.is_active ? t("emp.active") : t("emp.off")}</p>
                </div>
                <PermBoxes t={t} checked={e.permissions} />
                <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="is_active" defaultChecked={e.is_active} className="size-5 accent-ink" />{t("emp.active")}</label>
                <button className="btn-quiet">{t("emp.save")}</button>
              </form>
              <details className="mt-3"><summary className="btn-quiet inline-flex cursor-pointer items-center">{t("emp.resetPassword")}</summary>
                <form action={resetEmployeePassword} className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={e.id} />
                  <input className="field flex-1" name="password" type="password" minLength={10} required autoComplete="new-password" placeholder={t("emp.newTemp")} aria-label={t("emp.newTemp")} />
                  <button className="btn">{t("emp.resetPassword")}</button>
                </form></details>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
