import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook } from "../src/lib/excel";
import { safeCell } from "../src/lib/report-range";

describe("Excel export", () => {
  it("writes real numbers and dates, a bold frozen header, and a total row", async () => {
    const buf = await buildWorkbook("Reports",
      [{ header: "Date", width: 12, fmt: "dd-mmm-yyyy" }, { header: "Customer", width: 20 }, { header: "Amount (₹)", width: 14, fmt: "#,##0.00" }],
      [[new Date("2026-11-03T00:00:00Z"), safeCell("=cmd|' /C calc'!A0"), 1500.5], [new Date("2026-11-04T00:00:00Z"), "రవి కుమార్", 2499.5]],
      { label: "Total", col: 2, value: 4000 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Reports")!;
    expect(ws.getRow(1).values).toEqual([undefined, "Date", "Customer", "Amount (₹)"]);
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.getCell("C2").value).toBe(1500.5);               // a number, not text
    expect(ws.getCell("A2").value).toBeInstanceOf(Date);       // a date, not text
    expect(ws.getCell("B2").value).toBe("'=cmd|' /C calc'!A0"); // formula text neutralised
    expect(ws.getCell("B3").value).toBe("రవి కుమార్");           // Telugu survives
    expect(ws.getCell("A4").value).toBe("Total");
    expect(ws.getCell("C4").value).toBe(4000);
  });
  it("adds no total row for an empty report", async () => {
    const buf = await buildWorkbook("Empty", [{ header: "A", width: 10 }], [], { label: "Total", col: 0, value: 0 });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    expect(wb.getWorksheet("Empty")!.rowCount).toBe(1);
  });
});

import { buildMultiWorkbook } from "../src/lib/excel";
describe("multi-sheet export", () => {
  it("writes each sheet with its own header and real values", async () => {
    const buf = await buildMultiWorkbook([
      { name: "Customers", cols: [{ header: "Name", width: 10 }, { header: "Mobile", width: 12 }], rows: [["Ravi", "9876543210"]] },
      { name: "Payments", cols: [{ header: "Amount (₹)", width: 10, fmt: "#,##0.00" }, { header: "Date", width: 12, fmt: "dd-mmm-yyyy" }], rows: [[600, new Date("2026-11-20T00:00:00Z")]] },
    ]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Customers", "Payments"]);
    expect(wb.getWorksheet("Customers")!.getCell("B2").value).toBe("9876543210"); // phone stays text
    expect(wb.getWorksheet("Payments")!.getCell("A2").value).toBe(600);
    expect(wb.getWorksheet("Payments")!.getCell("B2").value).toBeInstanceOf(Date);
    expect(wb.getWorksheet("Payments")!.getRow(1).font?.bold).toBe(true);
  });
});
