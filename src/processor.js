import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const MONTH_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;
const YEAR_RE  = /^\d{4}$/;
const PCT_RE   = /%/;

const TOTAL_KEYWORDS = ["total","net profit","gross profit","operating profit",
  "profit before tax","profit after tax","ebitda","net income","net loss","profit before"];

const SKIP_RE = /^(eps|earning per|dividend payout|book value|face value|consolidated|standalone|rs\.?\s*crore|particulars|description)/i;

const SECTION_MAP = {
  Revenue:     ["sales","revenue","turnover","income from operation"],
  Expenses:    ["expense","cost of","depreciation","amortization","interest"],
  Profit:      ["profit","ebitda","ebit","other income","earnings"],
  Assets:      ["asset","investment","receivable","inventory","cash and"],
  Liabilities: ["liabilit","borrowing","payable","provision"],
  Equity:      ["equity","retained earning","reserve","share capital"]
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function classifyRow(label) {
  const l = label.toLowerCase();
  if (TOTAL_KEYWORDS.some(k => l.includes(k))) return "total";
  if (l.startsWith("sub-total") || l.startsWith("subtotal")) return "subtotal";
  return "line_item";
}

function detectSection(label) {
  const l = label.toLowerCase();
  for (const [sec, kws] of Object.entries(SECTION_MAP))
    if (kws.some(k => l.includes(k))) return sec;
  return null;
}

function detectStatementType(text) {
  const l = text.toLowerCase();
  const checks = [
    ["Profit & Loss", ["profit","loss","sales","revenue","expenses","operating"]],
    ["Balance Sheet",  ["balance sheet","assets","liabilities","equity"]],
    ["Cash Flow",      ["cash flow","operating activities","financing activities"]]
  ];
  let best = "Profit & Loss", top = 0;
  for (const [t, kws] of checks) {
    const s = kws.filter(k => l.includes(k)).length;
    if (s > top) { best = t; top = s; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORD-LEVEL TABLE RECONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────
function safeNum(text) {
  const n = parseFloat((text || "").replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function clusterIntoRows(words, yTol = 10) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const rows = [];
  for (const w of [...words].sort((a, b) => (a.bbox?.y0 ?? 0) - (b.bbox?.y0 ?? 0))) {
    const bbox = w.bbox || {};
    const cy = ((bbox.y0 || 0) + (bbox.y1 || 0)) / 2;
    const row = rows.find(r => Math.abs(r.cy - cy) < yTol);
    if (row) {
      row.words.push(w);
      row.cy = row.words.reduce((s, x) => s + ((x.bbox?.y0||0)+(x.bbox?.y1||0))/2, 0) / row.words.length;
    } else {
      rows.push({ cy, words: [w] });
    }
  }
  rows.forEach(r => r.words.sort((a, b) => (a.bbox?.x0||0) - (b.bbox?.x0||0)));
  return rows;
}

function detectColumns(rows) {
  for (let ri = 0; ri < rows.length; ri++) {
    const ws = rows[ri].words;
    const hasMonth = ws.some(w => MONTH_RE.test(w.text));
    const hasTTM   = ws.some(w => /^TTM$/i.test(w.text));
    if (!hasMonth && !hasTTM) continue;

    const cols = [];
    for (let i = 0; i < ws.length; i++) {
      const bbox = ws[i].bbox || {};
      if (MONTH_RE.test(ws[i].text) && ws[i+1] && YEAR_RE.test(ws[i+1].text)) {
        const nb = ws[i+1].bbox || {};
        cols.push({ header: `${ws[i].text} ${ws[i+1].text}`,
          centerX: (bbox.x0 + nb.x1) / 2, x0: bbox.x0, x1: nb.x1 });
        i++;
      } else if (/^TTM$/i.test(ws[i].text)) {
        cols.push({ header: "TTM",
          centerX: (bbox.x0 + bbox.x1) / 2, x0: bbox.x0, x1: bbox.x1 });
      }
    }
    if (cols.length >= 2) return { headerRowIdx: ri, columns: cols };
  }
  return null;
}

function assignValues(rowWords, columns, cutoffX) {
  const span = columns[columns.length-1].centerX - columns[0].centerX;
  const tol  = Math.max(50, (span / Math.max(columns.length-1, 1)) * 0.6);
  const result = columns.map(() => null);
  const taken  = new Set();

  for (const w of (rowWords || [])) {
    if (PCT_RE.test(w.text)) continue;
    const bbox = w.bbox || {};
    const cx = ((bbox.x0||0) + (bbox.x1||0)) / 2;
    if (cx < cutoffX - 5) continue;
    const n = safeNum(w.text);
    if (n === null) continue;

    let best = -1, bestDist = tol;
    for (let i = 0; i < columns.length; i++) {
      if (taken.has(i)) continue;
      const d = Math.abs(cx - columns[i].centerX);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best >= 0) { result[best] = n; taken.add(best); }
  }
  return result;
}

function reconstructTable(words, fullText) {
  try {
    const rows = clusterIntoRows(words);
    const colInfo = detectColumns(rows);
    if (!colInfo || colInfo.columns.length < 2) return null;

    const { headerRowIdx, columns } = colInfo;
    const cutoffX = columns[0].x0;
    const tableRows = [];
    let currentSection = "General";

    for (let ri = 0; ri < rows.length; ri++) {
      if (ri <= headerRowIdx) continue;
      const rowWords = rows[ri].words;
      if (!rowWords || rowWords.length === 0) continue;

      const pcts = rowWords.filter(w => PCT_RE.test(w.text)).length;
      if (pcts >= 2) continue;

      const labelWords = rowWords.filter(w => (w.bbox?.x1||0) < cutoffX - 5);
      const label = labelWords.map(w => w.text).join(" ")
        .replace(/[+*©®™|<>:]+$/, "").replace(/\s+/g, " ").trim();

      if (!label || label.length < 2 || /^\d+$/.test(label) || SKIP_RE.test(label)) continue;

      const values = assignValues(rowWords, columns, cutoffX);
      if (!values.some(v => v !== null)) continue;

      const sec = detectSection(label);
      if (sec) currentSection = sec;

      tableRows.push({
        id: crypto.randomUUID(), label, section: currentSection,
        row_type: classifyRow(label), values,
        amount: [...values].reverse().find(v => v !== null) || 0,
        level: 1, confidence: 0.9, issues: []
      });
    }
    return tableRows.length ? { columns: columns.map(c => c.header), rows: tableRows } : null;
  } catch (err) {
    console.warn("Table reconstruction failed:", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: processImages
// ─────────────────────────────────────────────────────────────────────────────
export async function processImages(files, onProgress) {
  const worker = await createWorker("eng", 1, {
    logger: m => { if (m.status === "recognizing text") onProgress?.(Math.round(m.progress * 100)); }
  });

  const allStatements = [];

  for (const file of files) {
    const url = URL.createObjectURL(file);
    try {
      const { data } = await worker.recognize(url);
      const text  = data?.text || "";
      const words = Array.isArray(data?.words) ? data.words : [];

      const stmtType  = detectStatementType(text);
      const tableData = words.length ? reconstructTable(words, text) : null;

      if (tableData && tableData.rows.length > 0) {
        allStatements.push({ id: crypto.randomUUID(), statement_type: stmtType,
          rows: tableData.rows, tableData });
      } else if (text.trim().length > 0) {
        // OCR worked but table detection failed — surface the raw text as one row for debugging
        allStatements.push({ id: crypto.randomUUID(), statement_type: stmtType,
          rows: [{ id: crypto.randomUUID(), label: "Could not parse table structure — see console",
            amount: 0, section: "Error", row_type: "line_item", confidence: 0.1, issues: [] }],
          tableData: null });
      }
    } catch (err) {
      console.error("OCR error:", err);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  await worker.terminate();
  if (allStatements.length === 0) throw new Error("No financial data could be extracted. Ensure the image is a clear screenshot.");
  return allStatements;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: exportToExcel
// ─────────────────────────────────────────────────────────────────────────────
export function exportToExcel(statements) {
  const wb = XLSX.utils.book_new();

  for (const stmt of statements) {
    const td = stmt.tableData;
    const yearCols = td ? td.columns : ["Amount (₹ Cr)"];
    const header   = ["Line Item", ...yearCols];
    const body     = (td ? td.rows : stmt.rows).map(r =>
      [r.label, ...(td ? r.values.map(v => (v !== null && v !== undefined ? v : "")) : [r.amount])]
    );

    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws["!cols"] = [{ wch: 28 }, ...yearCols.map(() => ({ wch: 11 }))];
    XLSX.utils.book_append_sheet(wb, ws, stmt.statement_type.substring(0, 31));
  }

  XLSX.writeFile(wb, "financials-export.xlsx");
}
