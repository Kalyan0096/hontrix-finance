"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disableTotp, enrollTotp, verifyTotpEnrollment } from "./actions";

export interface MfaLabels { title: string; help: string; enable: string; scan: string; code: string; verify: string; on: string; disable: string; enabledMsg: string; disabledMsg: string; errors: Record<string, string> }

export function MfaPanel({ enabledFactorId, labels: L }: { enabledFactorId: string | null; labels: MfaLabels }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const begin = () => start(async () => {
    setMsg(null);
    const r = await enrollTotp();
    if (!r.ok) setMsg({ kind: "bad", text: L.errors[r.error] ?? r.error }); else setSetup(r);
  });
  const confirm = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    start(async () => {
      const r = await verifyTotpEnrollment(setup!.factorId, code);
      if (!r.ok) setMsg({ kind: "bad", text: L.errors[r.error] ?? r.error });
      else { setSetup(null); setMsg({ kind: "ok", text: L.enabledMsg }); router.refresh(); }
    });
  };
  const turnOff = () => start(async () => {
    const r = await disableTotp(enabledFactorId!);
    if (!r.ok) setMsg({ kind: "bad", text: L.errors[r.error] ?? r.error }); else { setMsg({ kind: "ok", text: L.disabledMsg }); router.refresh(); }
  });

  return (
    <section className="mt-8 max-w-md space-y-3 border border-line bg-card p-5">
      <h2 className="text-lg font-semibold">{L.title}</h2>
      <p className="text-ink-soft">{L.help}</p>
      {msg && <p role={msg.kind === "ok" ? "status" : "alert"} className={`rounded-md border bg-card p-3 ${msg.kind === "ok" ? "border-ok text-ok" : "border-bad text-bad"}`}>{msg.text}</p>}
      {enabledFactorId ? (<><p className="font-semibold text-ok">{L.on}</p><button className="btn-quiet" onClick={turnOff} disabled={pending}>{L.disable}</button></>)
        : setup ? (
          <form onSubmit={confirm} className="space-y-3">
            <p>{L.scan}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="" width={180} height={180} className="border border-line" />
            <p className="num break-all text-sm">{setup.secret}</p>
            <label className="block"><span className="mb-1 block font-medium">{L.code}</span>
              <input className="field num text-center text-xl tracking-widest" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" required /></label>
            <button className="btn" disabled={pending}>{L.verify}</button>
          </form>)
        : <button className="btn" onClick={begin} disabled={pending}>{L.enable}</button>}
    </section>
  );
}
