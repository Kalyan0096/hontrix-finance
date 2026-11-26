// Money is handled as integer paise everywhere in code; never floating-point rupees.

/** Parse "12345.67" | 12345.67 into integer paise. Rejects >2 decimals and invalid input. */
export function toPaise(value: string | number): number {
  const s = typeof value === "number" ? value.toFixed(2) : value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid money value: ${value}`);
  const neg = s.startsWith("-");
  const [r = "0", p = ""] = s.replace("-", "").split(".");
  const paise = Number(r) * 100 + Number(p.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) throw new Error(`Money value too large: ${value}`);
  return neg ? -paise : paise;
}

/** Integer paise → "12345.67" (plain decimal string, as stored in numeric(14,2)). */
export function fromPaise(paise: number): string {
  if (!Number.isInteger(paise)) throw new Error("paise must be an integer");
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const out = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${out}` : out;
}

/** Indian digit grouping for display: 1234567.5 → ₹12,34,567.50 */
export function formatINR(paise: number): string {
  const [r = "0", p = "00"] = fromPaise(Math.abs(paise)).split(".");
  const last3 = r.slice(-3);
  const rest = r.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${paise < 0 ? "-" : ""}₹${grouped}.${p}`;
}

/** Short Indian-style amounts for chart axes: ₹950, ₹12.5K, ₹1.2L, ₹3.4Cr. */
export function formatCompactINR(paise: number): string {
  const r = Math.abs(paise) / 100;
  const sign = paise < 0 ? "-" : "";
  const f = (n: number) => String(Number(n.toFixed(1)));
  if (r >= 1e7) return `${sign}₹${f(r / 1e7)}Cr`;
  if (r >= 1e5) return `${sign}₹${f(r / 1e5)}L`;
  if (r >= 1e3) return `${sign}₹${f(r / 1e3)}K`;
  return `${sign}₹${f(r)}`;
}
