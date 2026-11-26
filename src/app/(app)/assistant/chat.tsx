"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { askAssistant } from "./actions";
import { MarkdownView } from "./markdown-view";
import type { TraceStep } from "@/lib/ai/loop";

export interface ChatMsg { role: "user" | "assistant"; content: string; trace?: TraceStep[] | null }
export interface ChatLabels { placeholder: string; send: string; thinking: string; how: string; lookedUp: string; you: string; assistant: string; left: string; slow: string; disclaimer: string; errors: Record<string, string>; suggestions: string[] }

export function AssistantChat({ initial, conversationId, labels: L }: { initial: ChatMsg[]; conversationId: string | null; labels: ChatLabels }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(initial);
  const [cid, setCid] = useState(conversationId);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [slow, setSlow] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!pending) { setSlow(false); return; } const id = setTimeout(() => setSlow(true), 12000); return () => clearTimeout(id); }, [pending]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, pending]);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    setError(null); setText(""); setMsgs((m) => [...m, { role: "user", content: question }]);
    start(async () => {
      const r = await askAssistant({ conversationId: cid, question });
      if (!r.ok) { setError(L.errors[r.error] ?? L.errors["ai.err.generic"] ?? r.error); return; }
      if (!cid) window.history.replaceState(null, "", `/assistant?c=${r.conversationId}`);
      setCid(r.conversationId); setLeft(r.remaining);
      setMsgs((m) => [...m, { role: "assistant", content: r.answer, trace: r.trace }]);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {msgs.length === 0 && (
        <div className="flex flex-wrap gap-2">{L.suggestions.map((s) => <button key={s} className="btn-quiet text-left" onClick={() => send(s)} disabled={pending}>{s}</button>)}</div>)}
      <ol className="space-y-4" aria-live="polite">
        {msgs.map((m, i) => (
          <li key={i} className={m.role === "user" ? "ml-auto max-w-[85%] border border-line bg-paper p-4" : "max-w-full border border-line border-l-8 border-l-ink bg-card p-4"}>
            <p className="mb-1 text-sm font-semibold text-ink-soft">{m.role === "user" ? L.you : L.assistant}</p>
            {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : <MarkdownView text={m.content} />}
            {m.role === "assistant" && m.trace && m.trace.length > 0 && (
              <details className="mt-3 text-sm text-ink-soft"><summary className="cursor-pointer font-medium">{L.how}</summary>
                <ul className="mt-2 space-y-2">{m.trace.map((t, j) => (
                  <li key={j}><span className="font-semibold">{L.lookedUp}: {t.tool}</span> <code className="break-all">{JSON.stringify(t.input)}</code>{!t.ok && <span className="text-bad"> — {t.error}</span>}
                    {t.method && <ul className="ml-4 list-disc">{t.method.map((x, k) => <li key={k}>{x}</li>)}</ul>}</li>))}</ul></details>)}
          </li>))}
        {pending && <li className="max-w-full border border-line border-l-8 border-l-ink bg-card p-4 text-ink-soft">{L.thinking}{slow && <span className="mt-1 block text-sm">{L.slow}</span>}</li>}
      </ol>
      {error && <p role="alert" className="rounded-md border border-bad bg-card p-3 text-bad">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="sticky bottom-0 flex gap-2 bg-paper py-2">
        <textarea className="field min-h-14 flex-1" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={L.placeholder} aria-label={L.placeholder}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
        <button className="btn self-end disabled:opacity-50" disabled={pending || !text.trim()}>{L.send}</button>
      </form>
      <p className="text-sm text-ink-soft">{L.disclaimer}{left !== null ? ` ${L.left.replace("{n}", String(left))}` : ""}</p>
      <div ref={end} />
    </div>
  );
}
