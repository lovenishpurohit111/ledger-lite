import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const MONTH_RE   = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;
const YEAR_RE    = /^\d{4}$/;
const PCT_RE     = /%/;

const TOTAL_KEYWORDS = [
  "total", "net profit", "gross profit", "operating profit",
  "profit before tax", "profit after tax", "ebitda", "net income",
  "net loss", "profit before"
];

const SKIP_RE = /^(eps|earning per|dividend payout|book value|face value|consolidated|standalone|rs\.?\s*crore|particulars|description)/i;

const SECTION_MAP = {
  Revenue:     ["sales", "revenue", "turnover", "income from operation"],
  Expenses:    ["expense", "cost of", "depreciation", "amortization", "interest"],
  Profit:      ["profit", "ebitda", "ebit", "other income", "earnings"],
  Assets:      ["asset", "investment", "receivable", "inventory", "cash and"],
  Liabilities: ["liabilit", "borrowing", "payable", "provision"],
  Equity:      ["equity", "retained earning", "reserve", "share capital"]
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
  const candidates = [
    ["Profit & Loss", ["profit", "loss", "sales", "revenue", "expenses", "operating"]],
    ["Balance Sheet",  ["balance sheet", "assets", "liabilities", "equity"]],
    ["Cash Flow",      ["cash flow", "operating activities", "financing activities"]]
  ];
  let best = "Profit & Loss", top = 0;
  for (const [t, kws] of candidates) {
    const s = kws.filter(k => l.includes(k)).length;
    if (s > top) { best = t; top = s; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — cluster Tesseract words into visual rows
// ─────────────────────────────────────────────────────────────────────────────
function clusterIntoRows(words, yTol = 10) {
  const rows = [];
  for (const w of [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0)) {
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    const row = rows.find(r => Math.abs(r.cy - cy) < yTol);
    if (row) {
      row.words.push(w);
      row.cy = row.words.reduce((s, x) => s + (x.bbox.y0 + x.bbox.y1) / 2, 0) / row.words.length;
    } else {
      rows.push({ cy, words: [w] });
    }
  }
  rows.forEach(r => r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — find the header row and extract column definitions
// ─────────────────────────────────────────────────────────────────────────────
function detectColumns(rows) {
  for (let ri = 0; ri < rows.length; ri++) {
    const ws = rows[ri].words;
    const hasMonth = ws.some(w => MONTH_RE.test(w.text));
    const hasTTM   = ws.some(w => /^TTM$/i.test(w.text));
    if (!hasMonth && !hasTTM) continue;

    const cols = [];
    for (let i = 0; i < ws.length; i++) {
      if (MONTH_RE.test(ws[i].text) && ws[i + 1] && YEAR_RE.test(ws[i + 1].text)) {
        cols.push({
          header:  `${ws[i].text} ${ws[i + 1].text}`,
          centerX: (ws[i].bbox.x0 + ws[i + 1].bbox.x1) / 2,
          x0: ws[i].bbox.x0, x1: ws[i + 1].bbox.x1
        });
        i++; // skip the year token
      } else if (/^TTM$/i.test(ws[i].text)) {
        cols.push({
          header:  "TTM",
          centerX: (ws[i].bbox.x0 + ws[i].bbox.x1) / 2,
          x0: ws[i].bbox.x0, x1: ws[i].bbox.x1
        });
      }
    }

    if (cols.length >= 2) return { headerRowIdx: ri, columns: cols };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — for a data row, map each numeric word to its nearest column
// ─────────────────────────────────────────────────────────────────────────────
function assignValuesToColumns(rowWords, columns, labelCutoffX) {
  // dynamic tolerance = half the typical column spacing
  const span = columns[columns.length - 1].centerX - columns[0].centerX;
  const tol  = (span / (columns.length - 1)) * 0.6;

  const nums = [];
  for (const w of rowWords) {
    if (PCT_RE.test(w.text)) continue;                    // skip percentages
    const cx = (w.bbox.x0 + w.bbox.x1) / 2;
    if (cx < labelCutoffX - 5) continue;                  // still in label area
    const n = parseFloat(w.text.replace(/,/g, ""));
    if (!isNaN(n)) nums.push({ n, cx });
  }

  const result   = columns.map(() => null);
  const taken    = new Set();
  // sort by distance first for greedy assignment
  for (const { n, cx } of nums) {
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

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — extract label (words left of the first column)
// ─────────────────────────────────────────────────────────────────────────────
function extractLabel(rowWords, cutoffX) {
  return rowWords
    .filter(w => w.bbox.x1 < cutoffX - 5)
    .map(w => w.text)
    .join(" ")
    .replace(/[+*©®™|<>:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN RECONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────
function reconstructTable(words, fullText) {
  const rows = clusterIntoRows(words);
  const colInfo = detectColumns(rows);

  if (!colInfo || colInfo.columns.length < 2) return null;

  const { headerRowIdx, columns } = colInfo;
  const cutoffX = columns[0].x0;         // label vs. value boundary
  const tableRows = [];
  let currentSection = "General";

  for (let ri = 0; ri < rows.length; ri++) {
    if (ri <= headerRowIdx) continue;

    const rowWords = rows[ri].words;
    if (!rowWords.length) continue;

    // skip rows dominated by %
    const pcts = rowWords.filter(w => PCT_RE.test(w.text)).length;
    if (pcts >= 2) continue;

    const label = extractLabel(rowWords, cutoffX);
    if (!label || label.length < 2 || /^\d+$/.test(label)) continue;
    if (SKIP_RE.test(label)) continue;

    const values = assignValuesToColumns(rowWords, columns, cutoffX);
    if (!values.some(v => v !== null)) continue;

    const sec = detectSection(label);
    if (sec) currentSection = sec;

    tableRows.push({
      id:        crypto.randomUUID(),
      label,
      section:   currentSection,
      row_type:  classifyRow(label),
      values,                                                 // all years
      amount:    [...values].reverse().find(v => v !== null) || 0, // latest for UI
      level:     1,
      confidence: 0.9,
      issues:    []
    });
  }

  return tableRows.length ? { columns: columns.map(c => c.header), rows: tableRows } : null;
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
      const stmtType  = detectStatementType(data.text);
      const tableData = reconstructTable(data.words, data.text);

      if (tableData) {
        allStatements.push({
          id: crypto.randomUUID(),
          statement_type: stmtType,
          rows: tableData.rows,
          tableData
        });
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  await worker.terminate();
  return allStatements;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: exportToExcel — full multi-year layout
// ─────────────────────────────────────────────────────────────────────────────
export function exportToExcel(statements) {
  const wb = XLSX.utils.book_new();

  for (const stmt of statements) {
    const td = stmt.tableData;

    // header row: Line Item | Mar 2014 | Mar 2015 | … | TTM
    const header = ["Line Item", ...(td ? td.columns : ["Amount (₹ Cr)"])];
    const body   = (td ? td.rows : stmt.rows).map(r =>
      td
        ? [r.label, ...r.values.map(v => (v !== null && v !== undefined ? v : ""))]
        : [r.label, r.amount]
    );

    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);

    // column widths
    ws["!cols"] = [{ wch: 28 }, ...(td ? td.columns : [""]).map(() => ({ wch: 11 }))];

    // bold + fill header row
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (!ws[addr]) continue;
      ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: "D9EAD3" } } };
    }

    // bold + light fill for total rows
    body.forEach((row, idx) => {
      const srcRow = (td ? td.rows : stmt.rows)[idx];
      if (srcRow.row_type === "total") {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r: idx + 1, c });
          if (!ws[addr]) continue;
          ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: "FFF2CC" } } };
        }
      }
    });

    XLSX.utils.book_append_sheet(wb, ws, stmt.statement_type.substring(0, 31));
  }

  XLSX.writeFile(wb, "financials-export.xlsx");
}
