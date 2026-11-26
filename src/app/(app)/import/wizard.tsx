"use client";
import { useState, useTransition } from "react";
import { commitImport, previewImport, type CommitResult } from "./actions";
import type { PreviewResult } from "@/lib/import-sheet";

export interface WizardLabels {
  file: string; balanceFrom: string; closing: string; opening: string; balanceDate: string; firstDue: string; frequency: string; skipSundays: string; check: string; found: string; zero: string; problems: string;
  confirm: string; doing: string; done: string; line: string; borrower: string; phone: string; loanNo: string; dailyDue: string; balance: string; preview: string; failedRows: string; note: string;
  freqs: Record<string, string>; errors: Record<string, string>; problemText: Record<string, string>;
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

export function ImportWizard({ labels: L, today, tomorrow }: { labels: WizardLabels; today: string; tomorrow: string }) {
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<Extract<PreviewResult, { ok: true }> | null>(null);
  const [opts, setOpts] = useState<{ balanceDate: string; firstDue: string; frequency: string; skipSundays: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<CommitResult, { ok: true }> | null>(null);

  function onCheck(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const o = { balanceDate: String(fd.get("balanceDate")), firstDue: String(fd.get("firstDue")), frequency: String(fd.get("frequency")), skipSundays: fd.get("skipSundays") === "on" };
    setError(null); setPreview(null); setResult(null);
    start(async () => {
      const r = await previewImport(fd);
      if (!r.ok) setError(L.errors[r.error] ?? r.error); else { setPreview(r); setOpts(o); }
    });
  }

  function onImport() {
    if (!preview || !opts) return;
    setError(null);
    start(async () => {
      const r = await commitImport({ rows: preview.rows, ...opts });
      if (!r.ok) setError(L.errors[r.error] ?? r.error); else { setResult(r); setPreview(null); }
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onCheck} className="max-w-2xl space-y-4 border border-line bg-card p-5">
        <label className="block"><span className="mb-1 block font-medium">{L.file}</span><input className="field" type="file" name="file" accept=".xlsx,.csv" required /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block font-medium">{L.balanceFrom}</span>
            <select className="field" name="balanceFrom" defaultValue="closing"><option value="closing">{L.closing}</option><option value="opening">{L.opening}</option></select></label>
          <label className="block"><span className="mb-1 block font-medium">{L.frequency}</span>
            <select className="field" name="frequency" defaultValue="daily">{Object.entries(L.freqs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="block"><span className="mb-1 block font-medium">{L.balanceDate}</span><input className="field" type="date" name="balanceDate" max={today} defaultValue={today} required /></label>
          <label className="block"><span className="mb-1 block font-medium">{L.firstDue}</span><input className="field" type="date" name="firstDue" defaultValue={tomorrow} required /></label>
        </div>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="skipSundays" defaultChecked className="size-5 accent-ink" />{L.skipSundays}</label>
        <p className="text-sm text-ink-soft">{L.note}</p>
        <button className="btn disabled:opacity-50" disabled={pending}>{pending && !preview ? L.doing : L.check}</button>
      </form>

      {error && <p role="alert" className="max-w-2xl rounded-md border border-bad bg-card p-3 text-bad">{error}</p>}

      {preview && (
        <section className="space-y-4">
          <p className="rounded-md border border-ok bg-card p-3 text-ok" role="status">{fill(L.found, { n: preview.rows.length })}{preview.zero > 0 ? ` ${fill(L.zero, { n: preview.zero })}` : ""}</p>
          {preview.problemCount > 0 && (
            <div className="rounded-md border border-bad bg-card p-3">
              <p className="mb-2 font-semibold text-bad">{fill(L.problems, { n: preview.problemCount })}</p>
              <ul className="num space-y-1 text-sm">{preview.problems.map((p) => <li key={p.line}>{L.line} {p.line}: {L.problemText[p.message] ?? p.message}</li>)}</ul>
            </div>)}
          {preview.rows.length > 0 && (<>
            <h2 className="font-semibold">{L.preview}</h2>
            <div className="overflow-x-auto border border-line bg-card"><table className="num w-full min-w-[34rem] text-sm">
              <thead className="bg-paper"><tr><th className="p-2 text-left">{L.line}</th><th className="p-2 text-left">{L.borrower}</th><th className="p-2 text-left">{L.phone}</th><th className="p-2 text-left">{L.loanNo}</th><th className="p-2 text-right">{L.dailyDue}</th><th className="p-2 text-right">{L.balance}</th></tr></thead>
              <tbody>{preview.rows.slice(0, 10).map((r) => <tr key={r.line} className="border-t border-line"><td className="p-2">{r.line}</td><td className="p-2">{r.name}</td><td className="p-2">{r.mobile}</td><td className="p-2">{r.loan_ref}</td><td className="p-2 text-right">{r.daily_due}</td><td className="p-2 text-right">{r.balance}</td></tr>)}</tbody>
            </table></div>
            <button className="btn disabled:opacity-50" onClick={onImport} disabled={pending}>{pending ? L.doing : fill(L.confirm, { n: preview.rows.length })}</button>
          </>)}
        </section>)}

      {result && (
        <section className="max-w-2xl space-y-3">
          <p role="status" className="rounded-md border border-ok bg-card p-3 text-ok">{fill(L.done, { c: result.created, s: result.skipped, f: result.failed.length })}</p>
          {result.failed.length > 0 && (<div className="rounded-md border border-bad bg-card p-3"><p className="mb-2 font-semibold text-bad">{L.failedRows}</p>
            <ul className="num space-y-1 text-sm">{result.failed.map((f) => <li key={f.line}>{L.line} {f.line}: {f.message}</li>)}</ul></div>)}
        </section>)}
    </div>
  );
}
