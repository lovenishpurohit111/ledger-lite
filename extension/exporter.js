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

function buildSheet(stmtData, addGrowth = true) {
  const { unit, name } = stmtData;

  // Normalise: PDF uses {columns, rows:{label,values}} — web uses {headers, rows:[arrays]}
  const isPDF = stmtData.columns && !stmtData.headers;
  const headers = isPDF
    ? ["", ...(stmtData.columns || [])]
    : (stmtData.headers || [""]);
  const rawRows = isPDF
    ? (stmtData.rows || []).map(r => [r.label, ...(r.values || []).map(v => v ?? "")])
    : (stmtData.rows || []);

  const sheetRows = [];

  // Row 0: unit annotation
  if (unit) sheetRows.push([unit, ...Array(Math.max(0, headers.length - 1)).fill("")]);

  // Row 1: headers
  sheetRows.push(headers);

  // Data rows
  for (const row of rawRows) {
    if (!row || !row.length) continue;
    const label = row[0];
    const values = row.slice(1).map(cleanNum);
    sheetRows.push([label, ...values]);
  }

  // ── Add YoY growth rows (only for P&L, only if requested) ──────────────
  const isPL = /profit.*loss|income.*statement/i.test(name || "");
  if (!addGrowth || !isPL) return sheetRows;
  const dataStartIdx = unit ? 2 : 1;
  const yearCount = headers.length - 1;
  const growthRows = [];

  for (let ri = dataStartIdx; ri < sheetRows.length; ri++) {
    const label = sheetRows[ri][0] || "";
    const lbl = label.toLowerCase();
    const wantGrowth = ["sales","revenue","net profit","operating profit","profit before tax","profit after tax","ebitda","net income","total revenue"]
      .some(k => lbl.startsWith(k) || lbl === k);
    if (!wantGrowth) continue;
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

function exportToExcel(meta, statements, addGrowth = true) {
  const wb = XLSX.utils.book_new();

  // Preferred order for sheet tabs; fall back to any detected key
  const PREFERRED = ["profit-loss","balance-sheet","cash-flow","quarters"];
  const allKeys = [...new Set([...PREFERRED, ...Object.keys(statements)])];
  const stmtList = allKeys.filter(id => statements[id]).map(id => statements[id]);

  if (!stmtList.length) throw new Error("No financial statements found on this page.");

  for (const stmt of stmtList) {
    const sheetData = buildSheet(stmt, addGrowth);
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Column widths
    const colCount = (stmt.headers || stmt.columns || []).length;
    const isEquity = /equity/i.test(stmt.name || "");
    ws["!cols"] = [{ wch: isEquity ? 38 : 32 }, ...Array(Math.max(0, colCount)).fill({ wch: isEquity ? 14 : 11 })];

    const sheetName = stmt.name.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // File name: "RELIANCE_Financials_2025.xlsx"
  const safeName = (meta.ticker || meta.name).replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20);
  const year = new Date().getFullYear();
  XLSX.writeFile(wb, `${safeName}_Financials_${year}.xlsx`);
}
