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
    const hits = signals.filter(s => lower.includes(s)).length;
    if (hits >= 2) return type;
  }
  return "Profit & Loss";
}

// ── Section detection ─────────────────────────────────────────────────────────
const SECTION_SIGNALS = {
  "Revenue":      ["sales", "revenue", "turnover", "income from operations", "net sales"],
  "Expenses":     ["expenses", "cost of", "raw material", "employee", "depreciation", "interest"],
  "Profit":       ["profit", "ebitda", "ebit", "earnings"],
  "Assets":       ["fixed assets", "current assets", "investments", "receivables", "inventory", "cash and"],
  "Liabilities":  ["current liabilities", "long-term", "borrowings", "payables", "provisions"],
  "Equity":       ["equity", "retained earnings", "reserves", "share capital", "net worth"]
};

function detectSection(label) {
  const lower = label.toLowerCase();
  for (const [section, signals] of Object.entries(SECTION_SIGNALS)) {
    if (signals.some(s => lower.includes(s))) return section;
  }
  return null;
}

// ── Row type classification ───────────────────────────────────────────────────
const TOTAL_SIGNALS   = ["total", "net profit", "gross profit", "operating profit", "profit before tax",
                          "profit after tax", "ebitda", "net income", "net loss"];
const HEADER_SIGNALS  = ["particulars", "description", "items", "schedule"];

function classifyRow(label) {
  const lower = label.toLowerCase();
  if (HEADER_SIGNALS.some(s => lower.includes(s))) return "header";
  if (TOTAL_SIGNALS.some(s => lower.startsWith(s) || lower.includes(s))) return "total";
  if (lower.startsWith("sub-total") || lower.startsWith("subtotal")) return "subtotal";
  return "line_item";
}

// ── Core OCR text → rows parser ───────────────────────────────────────────────
function parseOCRText(rawText) {
  const lines = rawText
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 1);

  const rows = [];
  let currentSection = "General";

  for (const line of lines) {
    // Find all numbers (including negatives, commas, decimals)
    const allNumbers = [...line.matchAll(/(-?[\d,]+(?:\.\d+)?)/g)]
      .map(m => parseFloat(m[0].replace(/,/g, "")))
      .filter(n => !isNaN(n));

    // Skip lines with no numbers
    if (allNumbers.length === 0) continue;

    // Skip lines that look like a header row (years, dates)
    const labelPart = line.substring(0, line.search(/(-?[\d,]+)/) ).trim();
    if (!labelPart || labelPart.length < 2) continue;

    // Skip pure percentage rows (OPM%, EPS, Tax%, etc.)
    const nonPctNumbers = [...line.matchAll(/(-?[\d,]+(?:\.\d+)?)(?!%)/g)]
      .map(m => parseFloat(m[0].replace(/,/g, ""))).filter(n => !isNaN(n));
    if (nonPctNumbers.length === 0) continue;

    // Clean label
    const label = labelPart
      .replace(/[+\-*©®™|<>:]+$/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!label || /^\d+$/.test(label)) continue;

    // Use the LAST number (most recent column in multi-year tables)
    const amount = nonPctNumbers[nonPctNumbers.length - 1];

    // Update running section
    const detectedSection = detectSection(label);
    if (detectedSection) currentSection = detectedSection;

    const rowType = classifyRow(label);
    const level = /^\s{2,}/.test(line) ? 2 : 1;

    // Confidence: lower for short labels or unusual amounts
    const confidence = label.length < 3 ? 0.65
      : Math.abs(amount) > 1e9 ? 0.7
      : 0.9;

    rows.push({ label, amount, section: currentSection, row_type: rowType, level, confidence });
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
          rows: rows.map(r => ({ ...r, id: crypto.randomUUID(), issues: [] }))
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

    // Column widths
    ws["!cols"] = [{ wch: 18 }, { wch: 36 }, { wch: 16 }, { wch: 12 }];

    // Bold header row
    for (let c = 0; c < 4; c++) {
      const cell = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[cell]) ws[cell].s = { font: { bold: true } };
    }

    const sheetName = stmt.statement_type.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  XLSX.writeFile(wb, "financials-export.xlsx");
}
