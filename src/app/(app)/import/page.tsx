import { requireOwner } from "@/lib/auth";
import { getLang, getT } from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import { addDays, todayIST } from "@/lib/finance";
import { FREQUENCIES } from "@/lib/loan-form";
import { ImportWizard, type WizardLabels } from "./wizard";

export default async function ImportPage() {
  await requireOwner();
  const { t } = await getT();
  const lang = await getLang();
  const m = messages[lang];
  const today = todayIST();
  const labels: WizardLabels = {
    file: m["import.file"], balanceFrom: m["import.balanceFrom"], closing: m["import.closing"], opening: m["import.opening"], balanceDate: m["import.balanceDate"], firstDue: m["import.firstDue"],
    frequency: m["import.frequency"], skipSundays: m["loan.skipSundays"], check: m["import.check"], found: m["import.found"], zero: m["import.zero"], problems: m["import.problems"], confirm: m["import.confirm"],
    doing: m["import.doing"], done: m["import.done"], line: m["import.line"], borrower: m["sheet.col.borrower"], phone: m["sheet.col.phone"], loanNo: m["sheet.col.loanNo"], dailyDue: m["sheet.col.dailyDue"],
    balance: m["import.balance"], preview: m["import.preview"], failedRows: m["import.failedRows"], note: m["import.note"],
    freqs: Object.fromEntries(FREQUENCIES.map((f) => [f, m[`loan.freq.${f}` as MessageKey]])),
    errors: Object.fromEntries((Object.keys(m) as MessageKey[]).filter((k) => k.startsWith("err.") || k.startsWith("import.")).map((k) => [k, m[k]])),
    problemText: Object.fromEntries(["name", "mobile", "loanRef", "duplicate", "dailyDue", "balance", "tooLong"].map((k) => [k, m[`import.p.${k}` as MessageKey]])),
  };
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{t("import.title")}</h1>
      <p className="mb-4 max-w-2xl text-ink-soft">{t("import.help")}</p>
      <p className="mb-6"><a className="underline" href="/import/template">{t("import.template")}</a></p>
      <ImportWizard labels={labels} today={today} tomorrow={addDays(today, 1)} />
    </>
  );
}
