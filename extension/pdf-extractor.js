// pdf-extractor.js — position-aware PDF table extractor using PDF.js

const PERIOD_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,.\s]*['`]?\s*\d{2,4}\b|\bFY\s*\d{2,4}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,.\s]*\d{4}\b|\b20\d{2}\b|\b(TTM|LTM)\b|\b\d+\s*mths?\b/i;

const STMT_PATTERNS = [
  { re: /(?:statement\s+of\s+)?profit\s+(?:and|&)\s+loss|income\s+statement|p\s*[&]\s*l/i, name: "Profit & Loss"  },
  { re: /balance\s+sheet|statement\s+of\s+financial\s+position/i,                           name: "Balance Sheet"  },
  { re: /cash\s+flow/i,                                                                      name: "Cash Flow"      },
];

const TOTAL_KW = ["total","net profit","gross profit","operating profit",
  "profit before","profit after","ebitda","total assets","total liabilities",
  "total equity","net worth","net cash"];

function isTotal(label) {
  const l = (label||"").toLowerCase();
  return TOTAL_KW.some(k => l.startsWith(k) || l.includes(k));
}

async function loadPDFJS() {
  const lib = await import(chrome.runtime.getURL("pdf.min.mjs"));
  lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
  return lib;
}

async function fetchPDF(url) {
  const res = await fetch(url);
  return res.arrayBuffer();
}

// Get total page count
async function getPDFPageCount(url) {
  const lib = await loadPDFJS();
  const buf = await fetchPDF(url);
  const pdf = await lib.getDocument({ data: buf }).promise;
  return pdf.numPages;
}

// ── Position-aware page reader ────────────────────────────────────────────────
async function getPageItems(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items
    .filter(item => item.str.trim())
    .map(item => ({
      text: item.str.trim(),
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
      w: Math.round(item.width)
    }));
}

// ── Cluster items into rows by y-position ─────────────────────────────────────
function clusterRows(items, yTol = 4) {
  const rows = [];
  for (const item of [...items].sort((a,b) => b.y - a.y)) {
    const row = rows.find(r => Math.abs(r.y - item.y) < yTol);
    if (row) { row.items.push(item); row.y = (row.y + item.y) / 2; }
    else rows.push({ y: item.y, items: [item] });
  }
  rows.forEach(r => r.items.sort((a,b) => a.x - b.x));
  return rows.sort((a,b) => b.y - a.y); // top to bottom
}

// ── Detect column positions from a header row ─────────────────────────────────
function detectColumns(rows) {
  for (const row of rows) {
    const texts = row.items.map(i => i.text).join(" ");
    const periodItems = row.items.filter(i => PERIOD_RE.test(i.text) || PERIOD_RE.test(texts.slice(texts.indexOf(i.text), texts.indexOf(i.text)+30)));
    if (periodItems.length >= 2) {
      return periodItems.map(i => ({
        header: i.text,
        cx: i.x + i.w / 2
      }));
    }
    // Also detect year-like numbers (2024, 2025) as columns
    const yearItems = row.items.filter(i => /^20\d{2}$/.test(i.text));
    if (yearItems.length >= 2) {
      return yearItems.map(i => ({ header: i.text, cx: i.x + i.w / 2 }));
    }
  }
  return null;
}

// ── Assign numbers to nearest column ─────────────────────────────────────────
function assignToColumns(rowItems, cols, labelCutX) {
  const span = cols[cols.length-1].cx - cols[0].cx;
  const tol = Math.max(40, (span / Math.max(cols.length-1,1)) * 0.7);
  const result = cols.map(() => null);
  const used = new Set();

  for (const item of rowItems) {
    const cx = item.x + item.w/2;
    if (cx < labelCutX - 10) continue;
    const num = parseFloat(item.text.replace(/,/g,""));
    if (isNaN(num)) continue;
    let best = -1, bd = tol;
    cols.forEach((c,i) => { if(!used.has(i)){const d=Math.abs(cx-c.cx); if(d<bd){bd=d;best=i;}} });
    if (best >= 0) { result[best] = num; used.add(best); }
  }
  return result;
}

// ── Extract financial tables from page items ──────────────────────────────────
function extractTablesFromItems(allItems) {
  const rows = clusterRows(allItems);
  const cols = detectColumns(rows);

  if (!cols || cols.length < 2) return null;

  const labelCutX = cols[0].cx - (cols.length > 1 ? (cols[1].cx - cols[0].cx) * 0.5 : 60);
  const tableRows = [];

  for (const row of rows) {
    const labelParts = row.items.filter(i => (i.x + i.w/2) < labelCutX).map(i => i.text);
    const label = labelParts.join(" ")
      .replace(/^\([a-z]+\)\s+/i, "")   // strip (a), (b) etc
      .replace(/\s+\d+[A-Z]?\s*$/, "")  // strip note refs like "3A"
      .trim();

    if (!label || label.length < 2) continue;
    if (/^\d+$/.test(label)) continue;

    const vals = assignToColumns(row.items, cols, labelCutX);
    if (!vals.some(v => v !== null)) continue;

    tableRows.push({
      label,
      values: vals,
      row_type: isTotal(label) ? "total" : "line_item"
    });
  }

  return tableRows.length >= 3 ? { columns: cols.map(c => c.header), rows: tableRows } : null;
}

// ── Detect statement name from page text ──────────────────────────────────────
function detectStmtName(items) {
  const lines = clusterRows(items).map(r => r.items.map(i=>i.text).join(" "));
  for (const line of lines) {
    for (const { re, name } of STMT_PATTERNS) if (re.test(line)) return name;
  }
  return "Financial Statement";
}

// ── Detect unit ────────────────────────────────────────────────────────────────
function detectUnit(items) {
  const text = items.map(i => i.text).join(" ");
  const m = text.match(/(?:Rs\.?|INR|₹)\s*(?:in\s+)?(?:Crore|Lakh|Million|Billion)s?/i)
         || text.match(/(?:Crore|Lakh|Million)s?\s+(?:of\s+Rupees|INR)/i);
  return m ? m[0].trim() : null;
}

// ── Main extractor ────────────────────────────────────────────────────────────
async function extractPDF(url, fromPage = 1, toPage = null) {
  const lib = await loadPDFJS();
  const buf = await fetchPDF(url);
  const pdf = await lib.getDocument({ data: buf }).promise;
  const endPage = toPage ? Math.min(toPage, pdf.numPages) : Math.min(pdf.numPages, fromPage + 49);

  const statements = {};
  let currentStmt = null;
  let accItems = [];

  for (let p = fromPage; p <= endPage; p++) {
    const items = await getPageItems(pdf, p);

    // Detect if this page starts a new statement
    const stmtName = detectStmtName(items);
    if (stmtName !== "Financial Statement" && stmtName !== currentStmt) {
      // Try to extract from accumulated items before resetting
      if (currentStmt && accItems.length > 0) {
        const table = extractTablesFromItems(accItems);
        if (table) {
          const key = currentStmt.toLowerCase().replace(/[^a-z]/g,"-");
          statements[key] = { name: currentStmt, ...table, unit: detectUnit(accItems) };
        }
      }
      currentStmt = stmtName;
      accItems = [];
    }

    accItems.push(...items);

    // Try extraction every page (running window)
    if (currentStmt) {
      const table = extractTablesFromItems(accItems);
      if (table && table.rows.length >= 3) {
        const key = currentStmt.toLowerCase().replace(/[^a-z]/g,"-");
        statements[key] = { name: currentStmt, ...table, unit: detectUnit(accItems) };
      }
    }
  }

  // Company name: try first page text
  const firstItems = await getPageItems(pdf, fromPage);
  const firstLines = clusterRows(firstItems).map(r => r.items.map(i=>i.text).join(" "));
  const companyLine = firstLines.find(l => l.length > 3 && l.length < 80 && /Ltd|Limited|Inc|Corp|Industries|Bank/i.test(l));

  return {
    ok: Object.keys(statements).length > 0,
    meta: { name: companyLine || "Company", ticker: "" },
    statements
  };
}

window.extractPDF = extractPDF;
window.getPDFPageCount = getPDFPageCount;
