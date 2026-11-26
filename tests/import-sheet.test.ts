import { describe, expect, it } from "vitest";
import { checkRows, parseMoney, parseSheet } from "../src/lib/import-sheet";

const HEAD = ["S. No.", "Borrower", "Phone", "Loan No.", "Daily Due (₹)", "Opening Balance (₹)", "Collected Today (₹)", "Closing Balance (₹)", "Signature / Mark", "Remarks"];

describe("parseMoney", () => {
  it("reads numbers and money-looking text", () => {
    expect(parseMoney(1200.5)).toBe("1200.50");
    expect(parseMoney("₹1,200")).toBe("1200.00");
    expect(parseMoney("Rs. 300")).toBe("300.00");
    expect(parseMoney("0.1")).toBe("0.10");
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });
});

describe("parseSheet", () => {
  const grid = [
    ["Daily collection — Kadapa route 1"], [],
    HEAD,
    [1, "Ravi Kumar", 9876543210, "D-101", 600, 5400, 600, 4800, "", "paid"],
    [2, "Sita Devi", "+91 90000 00001", "D-102", "₹300", "1,000", "", "", "", ""],
    [null, null, null, null, null, null, null, null, null, null],
    ["", "Total", "", "", 900, 6400, 600, 4800, "", ""],
  ];
  it("finds the heading row below a title and reads the rows, skipping blanks and totals", () => {
    const p = parseSheet(grid);
    expect(p.ok).toBe(true);
    expect(p.headerLine).toBe(3);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ line: 4, name: "Ravi Kumar", mobile: "9876543210", loanRef: "D-101", dailyDue: "600.00", opening: "5400.00", closing: "4800.00" });
    expect(p.rows[1]).toMatchObject({ mobile: "9000000001", dailyDue: "300.00", opening: "1000.00", closing: null });
    expect(p.columns.dailyDue).toBe("Daily Due (₹)");
  });
  it("copes with different heading wording", () => {
    const p = parseSheet([["Name", "Mobile No", "Loan Number", "Installment", "Outstanding"], ["Gopal", 9000000002, 77, 50, 400]]);
    expect(p.ok).toBe(true);
    expect(p.rows[0]).toMatchObject({ name: "Gopal", loanRef: "77", dailyDue: "50.00", closing: "400.00" });
  });
  it("says so when there is no heading row", () => {
    expect(parseSheet([["a", "b"], [1, 2]])).toMatchObject({ ok: false, error: "headings" });
  });
});

describe("checkRows", () => {
  const base = { line: 2, name: "Ravi Kumar", mobile: "9876543210", loanRef: "D-101", dailyDue: "600.00", opening: "5400.00", closing: "4800.00" };
  it("uses the chosen balance column", () => {
    expect(checkRows([base], "closing").valid[0]!.balance).toBe("4800.00");
    expect(checkRows([base], "opening").valid[0]!.balance).toBe("5400.00");
    expect(checkRows([{ ...base, closing: null }], "closing").valid[0]!.balance).toBe("5400.00"); // falls back when one column is empty
  });
  it("reports each kind of problem, skips zero balances, and catches repeated loan numbers", () => {
    const r = checkRows([
      { ...base, line: 2 }, { ...base, line: 3, name: "R" }, { ...base, line: 4, mobile: "123" }, { ...base, line: 5, loanRef: "" },
      { ...base, line: 6, loanRef: "D-6", dailyDue: null }, { ...base, line: 7, loanRef: "D-7", closing: "0.00", opening: "0.00" }, { ...base, line: 8 }, { ...base, line: 9, loanRef: "D-9", dailyDue: "1.00", closing: "99999.00", opening: null },
    ], "closing");
    expect(r.valid.map((x) => x.line)).toEqual([2]);
    expect(r.zero).toEqual([7]);
    expect(r.problems).toEqual([{ line: 3, message: "name" }, { line: 4, message: "mobile" }, { line: 5, message: "loanRef" }, { line: 6, message: "dailyDue" }, { line: 8, message: "duplicate" }, { line: 9, message: "tooLong" }]);
  });
});

import ExcelJS from "exceljs";
import { buildWorkbook } from "../src/lib/excel";
import { readGrid } from "../src/lib/read-sheet";
import { revalidateRows } from "../src/lib/import-sheet";

describe("reading real files", () => {
  it("reads an .xlsx made like the financier's sheet, including numbers stored as numbers and formula cells", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Kadapa daily collection"]);
    ws.addRow(HEAD);
    ws.addRow([1, "Ravi Kumar", 9876543210, "D-101", 600, { formula: "F3-G3", result: 4800 }, 0, 4800, "", ""]);
    ws.addRow([2, "Sita Devi", "9000000001", "D-102", 300, 1000, 0, 1000, "", "late"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const grid = await readGrid(buf, false);
    expect(grid).not.toBe("tooMany");
    const p = parseSheet(grid as unknown[][]);
    expect(p.ok).toBe(true);
    expect(p.rows.map((r) => [r.name, r.mobile, r.loanRef, r.dailyDue, r.opening, r.closing])).toEqual([
      ["Ravi Kumar", "9876543210", "D-101", "600.00", "4800.00", "4800.00"], ["Sita Devi", "9000000001", "D-102", "300.00", "1000.00", "1000.00"]]);
  });
  it("reads the downloadable template and a CSV with commas inside quotes", async () => {
    const buf = Buffer.from(await buildWorkbook("T", HEAD.map((h) => ({ header: h, width: 10 })), [[1, "Example", "9876500001", "D-001", 600, 5400, 600, 4800, "", ""]]));
    expect(parseSheet((await readGrid(buf, false)) as unknown[][]).rows).toHaveLength(1);
    const csv = Buffer.from(`${HEAD.join(",")}\n1,"Kumar, Ravi",9876543210,D-101,"1,200",5400,0,5400,,\n`);
    const p = parseSheet((await readGrid(csv, true)) as unknown[][]);
    expect(p.rows[0]).toMatchObject({ name: "Kumar, Ravi", dailyDue: "1200.00", closing: "5400.00" });
  });
  it("rejects files that are not spreadsheets, and too-long ones", async () => {
    await expect(readGrid(Buffer.from("not a spreadsheet at all"), false)).rejects.toThrow();
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("x"); for (let i = 0; i < 30; i++) ws.addRow([i]);
    expect(await readGrid(Buffer.from(await wb.xlsx.writeBuffer()), false, 10)).toBe("tooMany");
  });
  it("re-checks rows sent back from the browser", () => {
    const ok = { line: 2, name: "Ravi", mobile: "9876543210", loan_ref: "D-1", daily_due: "600.00", balance: "5400.00" };
    const r = revalidateRows([ok, { ...ok, line: 3, loan_ref: "D-1" }, { ...ok, line: 4, loan_ref: "D-2", mobile: "1" }, { ...ok, line: 5, loan_ref: "D-3", balance: "-5.00" }, { ...ok, line: 6, loan_ref: "D-4", daily_due: "abc" }]);
    expect(r.valid.map((x) => x.line)).toEqual([2]);
    expect(r.problems).toBe(4);
  });
});
