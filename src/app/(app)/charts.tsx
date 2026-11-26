import { formatCompactINR, toPaise } from "@/lib/finance";

export interface Point { label: string; value: number }
const niceMax = (v: number) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
const rupee = (v: number) => formatCompactINR(toPaise(v));

/** Server-rendered SVG bar/line chart with a screen-reader table. No client JavaScript; hover a mark to see its exact value. */
export function TrendChart({ title, points, kind = "bar", tone = "pine", empty }: { title: string; points: Point[]; kind?: "bar" | "line"; tone?: "pine" | "bad"; empty: string }) {
  const W = 640, H = 250, L = 56, R = 12, T = 14, B = 32;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const iw = W - L - R, ih = H - T - B, step = iw / Math.max(points.length, 1);
  const y = (v: number) => T + ih - (v / max) * ih;
  const strong = tone === "bad" ? "var(--color-bad)" : "var(--color-pine)";
  const soft = tone === "bad" ? "#f1b9b4" : "#a9d3c6";
  const any = points.some((p) => p.value !== 0);
  const last = points.length - 1;
  const cx = (i: number) => L + step * i + step / 2;
  const gid = `g-${tone}-${kind}`;
  return (
    <figure className="card relative p-5">
      <figcaption className="mb-3 flex items-baseline justify-between gap-3">
        <span className="font-semibold">{title}</span>
        {any ? <span className="fig num text-lg text-ink-soft">{rupee(points[last]?.value ?? 0)}</span> : null}
      </figcaption>
      {!any ? <p className="py-10 text-center text-ink-soft">{empty}</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="h-auto w-full">
          <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={strong} stopOpacity="0.22" /><stop offset="1" stopColor={strong} stopOpacity="0" /></linearGradient></defs>
          {[0, 1, 2, 3, 4].map((i) => { const v = (max / 4) * i, yy = y(v); return (
            <g key={i}><line x1={L} x2={W - R} y1={yy} y2={yy} stroke="var(--color-line)" strokeDasharray={i ? "3 4" : undefined} /><text x={L - 8} y={yy + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-soft)">{rupee(v)}</text></g>); })}
          {kind === "bar" ? points.map((p, i) => { const bw = Math.min(step * 0.6, 30), x = cx(i) - bw / 2, h = Math.max(T + ih - y(p.value), p.value ? 2 : 0); return (
            <rect key={i} x={x} y={T + ih - h} width={bw} height={h} rx="4" fill={i === last ? strong : soft}><title>{`${p.label}: ${rupee(p.value)}`}</title></rect>); })
            : (<>
                <polygon fill={`url(#${gid})`} points={`${cx(0)},${T + ih} ${points.map((p, i) => `${cx(i)},${y(p.value)}`).join(" ")} ${cx(last)},${T + ih}`} />
                <polyline fill="none" stroke={strong} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={points.map((p, i) => `${cx(i)},${y(p.value)}`).join(" ")} />
                {points.map((p, i) => <circle key={i} cx={cx(i)} cy={y(p.value)} r={i === last ? 5 : 3} fill={i === last ? strong : "#fff"} stroke={strong} strokeWidth="2"><title>{`${p.label}: ${rupee(p.value)}`}</title></circle>)}
              </>)}
          {points.map((p, i) => <text key={i} x={cx(i)} y={H - 10} textAnchor="middle" fontSize="11" fontWeight={i === last ? 600 : 400} fill={i === last ? "var(--color-ink)" : "var(--color-ink-soft)"}>{p.label}</text>)}
        </svg>)}
      <div className="sr-only"><table><caption>{title}</caption><tbody>{points.map((p) => <tr key={p.label}><th scope="row">{p.label}</th><td>{rupee(p.value)}</td></tr>)}</tbody></table></div>
    </figure>
  );
}

export function HBars({ title, rows, empty, money = false, wide = false }: { title: string; rows: { label: string; value: number; note?: string }[]; empty: string; money?: boolean; wide?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className={`card p-5 ${wide ? "lg:col-span-2" : ""}`}>
      <figcaption className="mb-4 font-semibold">{title}</figcaption>
      {rows.length === 0 ? <p className="py-8 text-center text-ink-soft">{empty}</p> : (
        <ul className="space-y-4">{rows.map((r) => (
          <li key={r.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{r.label}{r.note ? <span className="ml-2 font-normal text-ink-soft">{r.note}</span> : null}</span>
              <span className="fig num text-base">{money ? rupee(r.value) : new Intl.NumberFormat("en-IN").format(r.value)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-pine-tint" aria-hidden="true"><div className="h-full rounded-full bg-pine" style={{ width: `${Math.max((r.value / max) * 100, 2)}%` }} /></div>
          </li>))}
        </ul>)}
    </figure>
  );
}
