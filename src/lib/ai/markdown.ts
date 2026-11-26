export type Inline = { t: "text"; v: string } | { t: "bold"; v: string } | { t: "code"; v: string } | { t: "link"; v: string; href: string };
export type Block =
  | { t: "p"; lines: Inline[][] } | { t: "h"; inline: Inline[] } | { t: "ul"; items: Inline[][] } | { t: "ol"; items: Inline[][] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] };

const SAFE_HREF = /^\/(customers|loans|documents|vehicles|payments|reports|alerts)(\/[0-9a-f-]{36}|\/sheet)?(\?[A-Za-z0-9=&_-]{0,60})?$/i;

/** **bold**, `code` and [text](/our/page) only. Any other link is shown as plain text; nothing is ever treated as HTML. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "bold", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
    else out.push(SAFE_HREF.test(m[4]!) ? { t: "link", v: m[3]!, href: m[4]! } : { t: "text", v: m[3]! });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSep(lines[i + 1]!)) {
      const head = cells(line).map(parseInline); i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) { rows.push(cells(lines[i]!).map(parseInline)); i++; }
      blocks.push({ t: "table", head, rows }); continue;
    }
    if (/^#{1,4}\s+/.test(line)) { blocks.push({ t: "h", inline: parseInline(line.replace(/^#{1,4}\s+/, "")) }); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) { const items: Inline[][] = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) { items.push(parseInline(lines[i]!.replace(/^\s*[-*]\s+/, ""))); i++; } blocks.push({ t: "ul", items }); continue; }
    if (/^\s*\d+[.)]\s+/.test(line)) { const items: Inline[][] = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) { items.push(parseInline(lines[i]!.replace(/^\s*\d+[.)]\s+/, ""))); i++; } blocks.push({ t: "ol", items }); continue; }
    const para: Inline[][] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i]!) && !(lines[i]!.trim().startsWith("|") && i + 1 < lines.length && isSep(lines[i + 1]!))) { para.push(parseInline(lines[i]!)); i++; }
    blocks.push({ t: "p", lines: para });
  }
  return blocks;
}
