// exporter.js — builds the Excel workbook from extracted data
// Loaded by popup.js after SheetJS is available.

"use strict";

const TOTAL_KEYWORDS = [
  "total", "net profit", "gross profit", "operating profit",
  "profit before tax", "profit after tax", "ebitda", "net income",
  "net loss", "profit before", "net worth", "total assets",
  "total liabilities", "net cash"
];

function isTotal(label) {
  const l = (label || "").toLowerCase();
  return TOTAL_KEYWORDS.some(k => l.includes(k));
}

function cleanNum(val) {
  if (val === null || val === undefined || val === "") return "";
  const s = String(val).trim();
  if (s.endsWith("%")) return s;                  // keep percentages as text
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? s : n;
}

function buildSheet(stmtData) {
  const { headers, rows, unit, name } = stmtData;

  const sheetRows = [];

  // Row 0: unit annotation
  if (unit) sheetRows.push([unit, ...Array(headers.length - 1).fill("")]);

  // Row 1: headers (label col + year cols)
  sheetRows.push(headers);

  // Data rows
  for (const row of rows) {
    if (!row.length) continue;
    const label = row[0];
    const values = row.slice(1).map(cleanNum);
    sheetRows.push([label, ...values]);
  }

  // ── Add YoY growth rows for key numeric metrics ───────────────────────────
  const dataStartIdx = unit ? 2 : 1;           // skip unit + header rows
  const yearCount = headers.length - 1;
  const growthRows = [];

  for (let ri = dataStartIdx; ri < sheetRows.length; ri++) {
    const label = sheetRows[ri][0] || "";
    if (!isTotal(label) && label.toLowerCase() !== "sales" && label.toLowerCase() !== "revenue") continue;
    if (sheetRows[ri].slice(1).some(v => typeof v !== "number")) continue;

    const growth = [label + " YoY %"];
    for (let c = 1; c <= yearCount; c++) {
      const curr = sheetRows[ri][c];
      const prev = sheetRows[ri][c - 1];
      if (c === 1 || typeof curr !== "number" || typeof prev !== "number" || prev === 0) {
        growth.push("");
      } else {
        growth.push(Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10 + "%");
      }
    }
    growthRows.push({ afterIdx: ri, row: growth });
  }

  // Insert growth rows in reverse so indices stay valid
  for (const { afterIdx, row } of [...growthRows].reverse()) {
    sheetRows.splice(afterIdx + 1, 0, row);
  }

  return sheetRows;
}

function exportToExcel(meta, statements) {
  const wb = XLSX.utils.book_new();

  // Preferred order for sheet tabs; fall back to any detected key
  const PREFERRED = ["profit-loss","balance-sheet","cash-flow","quarters"];
  const allKeys = [...new Set([...PREFERRED, ...Object.keys(statements)])];
  const stmtList = allKeys.filter(id => statements[id]).map(id => statements[id]);

  if (!stmtList.length) throw new Error("No financial statements found on this page.");

  for (const stmt of stmtList) {
    const sheetData = buildSheet(stmt);
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Column widths
    const colCount = (stmt.headers || []).length;
    ws["!cols"] = [{ wch: 32 }, ...Array(colCount - 1).fill({ wch: 11 })];

    const sheetName = stmt.name.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // File name: "RELIANCE_Financials_2025.xlsx"
  const safeName = (meta.ticker || meta.name).replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20);
  const year = new Date().getFullYear();
  XLSX.writeFile(wb, `${safeName}_Financials_${year}.xlsx`);
}
