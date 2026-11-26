import ExcelJS from "exceljs";
import { Readable } from "node:stream";

const cell = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if ("result" in o) return o.result;                       // formula cell: use its value
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (o.text !== undefined) return o.text;
  }
  return v;
};

/** Reads the first sheet of an .xlsx or .csv file into rows of plain values. Throws on unreadable files. */
export async function readGrid(data: Buffer, isCsv: boolean, maxRows = 5000): Promise<unknown[][] | "tooMany"> {
  const wb = new ExcelJS.Workbook();
  const ws = isCsv ? await wb.csv.read(Readable.from(data)) : (await wb.xlsx.load(data as unknown as ExcelJS.Buffer), wb.worksheets[0]);
  if (!ws) throw new Error("no sheet");
  if (ws.rowCount > maxRows) return "tooMany";
  const grid: unknown[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) grid.push((ws.getRow(r).values as unknown[]).slice(1).map(cell));
  return grid;
}
