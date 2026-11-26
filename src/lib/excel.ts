import ExcelJS from "exceljs";

export type Cell = string | number | Date | null;
export interface Col { header: string; width: number; fmt?: string }

/** Builds a one-sheet workbook: bold frozen header, real numbers/dates, and a bold total row (computed here, not a formula). */
export async function buildWorkbook(sheetName: string, cols: Col[], rows: Cell[][], total?: { label: string; col: number; value: number; more?: { col: number; value: number }[] }): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hontrix-PDTR";
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  if (total && rows.length) {
    const tr = ws.addRow([]);
    tr.getCell(1).value = total.label;
    const c = tr.getCell(total.col + 1);
    c.value = total.value; c.numFmt = cols[total.col]?.fmt ?? "#,##0.00";
    for (const m of total.more ?? []) { const mc = tr.getCell(m.col + 1); mc.value = m.value; mc.numFmt = cols[m.col]?.fmt ?? "#,##0.00"; }
    tr.font = { bold: true };
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** A workbook with several sheets (used for the full data export). Same rules as buildWorkbook: bold frozen header, real numbers and dates. */
export async function buildMultiWorkbook(sheets: { name: string; cols: Col[]; rows: Cell[][] }[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hontrix-PDTR";
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = sh.cols.map((c) => ({ header: c.header, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
    ws.getRow(1).font = { bold: true };
    sh.rows.forEach((r) => ws.addRow(r));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
