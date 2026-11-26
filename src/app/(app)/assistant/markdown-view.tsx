"use client";
import Link from "next/link";
import { parseBlocks, type Inline } from "@/lib/ai/markdown";

const Inl = ({ nodes }: { nodes: Inline[] }) => (
  <>{nodes.map((n, i) => n.t === "bold" ? <strong key={i}>{n.v}</strong> : n.t === "code" ? <code key={i} className="rounded bg-paper px-1">{n.v}</code>
    : n.t === "link" ? <Link key={i} href={n.href} className="underline">{n.v}</Link> : <span key={i}>{n.v}</span>)}</>
);

/** Shows the assistant's reply: paragraphs, lists, tables, bold and links to our own pages. Nothing is ever inserted as HTML. */
export function MarkdownView({ text }: { text: string }) {
  return (
    <div className="space-y-3">
      {parseBlocks(text).map((b, i) => {
        if (b.t === "p") return <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}<Inl nodes={l} /></span>)}</p>;
        if (b.t === "h") return <p key={i} className="font-semibold"><Inl nodes={b.inline} /></p>;
        if (b.t === "ul") return <ul key={i} className="list-disc space-y-1 pl-6">{b.items.map((it, j) => <li key={j}><Inl nodes={it} /></li>)}</ul>;
        if (b.t === "ol") return <ol key={i} className="list-decimal space-y-1 pl-6">{b.items.map((it, j) => <li key={j}><Inl nodes={it} /></li>)}</ol>;
        return (
          <div key={i} className="overflow-x-auto border border-line">
            <table className="num w-full min-w-[20rem] text-sm">
              <thead className="bg-paper"><tr>{b.head.map((h, j) => <th key={j} className="p-2 text-left font-semibold"><Inl nodes={h} /></th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j} className="border-t border-line">{r.map((c, k) => <td key={k} className="p-2"><Inl nodes={c} /></td>)}</tr>)}</tbody>
            </table>
          </div>);
      })}
    </div>
  );
}
