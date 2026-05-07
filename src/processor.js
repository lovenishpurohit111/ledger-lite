import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

// ── Statement type detection ──────────────────────────────────────────────────
const STATEMENT_SIGNALS = {
  "Profit & Loss": ["profit", "loss", "p&l", "income statement", "revenue", "sales", "expenses", "operating"],
  "Balance Sheet": ["balance sheet", "assets", "liabilities", "equity", "net worth"],
  "Cash Flow":     ["cash flow", "cash from", "operating activities", "investing activities", "financing"]
};

function detectStatementType(text) {
  const lower = text.toLowerCase();
  for (const [type, signals] of Object.entries(STATEMENT_SIGNALS)) {
    if (signals.filter(s => lower.includes(s)).length >= 2) return type;
  }
  return "Profit & Loss";
}

// ── Section detection ─────────────────────────────────────────────────────────
const SECTION_SIGNALS = {
  "Revenue":     ["sales", "revenue", "turnover", "income from operations", "net sales"],
  "Expenses":    ["expenses", "cost of", "raw material", "employee", "depreciation", "interest"],
  "Profit":      ["profit", "ebitda", "ebit", "earnings", "other income"],
  "Assets":      ["fixed assets", "current assets", "investments", "receivables", "inventory"],
  "Liabilities": ["liabilities", "borrowings", "payables", "provisions"],
  "Equity":      ["equity", "retained earnings", "reserves", "share capital"]
};

function detectSection(label) {
  const lower = label.toLowerCase();
  for (const [section, signals] of Object.entries(SECTION_SIGNALS)) {
    if (signals.some(s => lower.includes(s))) return section;
  }
  return null;
}

// ── Row type classification ───────────────────────────────────────────────────
const TOTAL_LABELS = ["total", "net profit", "gross profit", "operating profit",
  "profit before tax", "profit after tax", "ebitda", "net income", "net loss", "profit before"];

function classifyRow(label) {
  const lower = label.toLowerCase();
  if (TOTAL_LABELS.some(s => lower.includes(s))) return "total";
  if (lower.startsWith("sub-total") || lower.startsWith("subtotal")) return "subtotal";
  return "line_item";
}

// ── Rows to always skip ───────────────────────────────────────────────────────
const SKIP_LABEL_PATTERNS = [
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\s|$)/i,  // month headers
  /^(fy|q[1-4]|ttm|quarter|annual|year)(\s|$)/i,                // period labels
  /^(eps|earning per share|dividend payout|book value|face value)/i, // ratio rows
  /^consolidated|standalone|rs\.?\s*crore/i                      // footnotes
];

function shouldSkipLabel(label) {
  return SKIP_LABEL_PATTERNS.some(re => re.test(label.trim()));
}

// ── Core text → rows parser ───────────────────────────────────────────────────
function parseOCRText(rawText) {
  const lines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 1);
  const rows = [];
  let currentSection = "General";

  for (const line of lines) {
    // ── 1. Skip lines dominated by percentages (OPM%, Tax%, Dividend%) ──
    const percentCount = (line.match(/%/g) || []).length;
    if (percentCount >= 2) continue; // row full of % values = ratio row, skip

    // ── 2. Find numbers NOT followed by % ──
    const numberMatches = [...line.matchAll(/(-?[\d,]+(?:\.\d+)?)(?!%|\.\d)/g)]
      .map(m => ({ val: parseFloat(m[0].replace(/,/g, "")), idx: m.index }))
      .filter(m => !isNaN(m.val));

    if (numberMatches.length === 0) continue;

    // ── 3. Extract label (everything before first number) ──
    const firstIdx = numberMatches[0].idx;
    const rawLabel = line.substring(0, firstIdx)
      .replace(/[+\-*©®™|<>:]+$/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!rawLabel || rawLabel.length < 2 || /^\d+$/.test(rawLabel)) continue;
    if (shouldSkipLabel(rawLabel)) continue;

    // ── 4. Use LAST number = most recent column ──
    const amount = numberMatches[numberMatches.length - 1].val;

    // ── 5. Section + type ──
    const detectedSection = detectSection(rawLabel);
    if (detectedSection) currentSection = detectedSection;

    rows.push({
      label: rawLabel,
      amount,
      section: currentSection,
      row_type: classifyRow(rawLabel),
      level: 1,
      confidence: rawLabel.length < 3 ? 0.65 : 0.9,
      issues: []
    });
  }

  return rows;
}

// ── Main entry point ──────────────────────────────────────────────────────────
export async function processImages(files, onProgress) {
  const worker = await createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") onProgress?.(Math.round(m.progress * 100));
    }
  });

  const allStatements = [];

  for (const file of files) {
    const url = URL.createObjectURL(file);
    try {
      const { data } = await worker.recognize(url);
      const statementType = detectStatementType(data.text);
      const rows = parseOCRText(data.text);
      if (rows.length > 0) {
        allStatements.push({
          id: crypto.randomUUID(),
          statement_type: statementType,
          rows: rows.map(r => ({ ...r, id: crypto.randomUUID() }))
        });
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  await worker.terminate();
  return allStatements;
}

// ── Client-side Excel export ──────────────────────────────────────────────────
export function exportToExcel(statements) {
  const wb = XLSX.utils.book_new();

  for (const stmt of statements) {
    const header = [["Section", "Line Item", "Amount (₹ Cr)", "Type"]];
    const dataRows = stmt.rows.map(r => [r.section, r.label, r.amount, r.row_type]);
    const ws = XLSX.utils.aoa_to_sheet([...header, ...dataRows]);
    ws["!cols"] = [{ wch: 18 }, { wch: 36 }, { wch: 16 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, stmt.statement_type.substring(0, 31));
  }

  XLSX.writeFile(wb, "financials-export.xlsx");
}
